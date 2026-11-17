import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { createOutputCapture } from "../shared/captured-output";
import { RESULT_FILE_PLACEHOLDER, type ResultCommand, type TimberRun, describeTimberCommand, readTimberResult } from "../shared/timber-result";

export interface TimberRunRequest {
	/** The Timber executable found on start (see ./timber.ts). */
	executable: string;
	/** Which command this is. The record in the result file must be for it. */
	command: ResultCommand;
	/**
	 * Everything after `timber`, given the path of the result file. Called once
	 * with the real path to run, and once with `RESULT_FILE_PLACEHOLDER` for the
	 * text that is shown, so it must put the path in as it is. The same holds
	 * for `inputFile`, which stands for the file made from `input` and is shown
	 * as `input.shownAs`.
	 */
	arguments: (resultFile: string, inputFile: string) => string[];
	/**
	 * A file Timber reads, such as the preview the person approved for
	 * `timber __ide-done apply`, exactly the bytes Timber printed, or the
	 * settings draft for `timber __app-config apply`, which can hold
	 * credentials. It is written unchanged to a new file that only this user
	 * can read, beside the result file in the same private folder, before
	 * Timber runs, and is removed with that folder. Never logged.
	 */
	input?: { bytes: Uint8Array; shownAs: string };
	/** The working directory: the repository's primary checkout or one of its worktrees. */
	folder: string;
	environment?: Record<string, string | undefined>;
	/** Where the private folder for the result file is made. The system's temporary folder by default. */
	temporaryRoot?: string;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isInside(folder: string, candidate: string): boolean {
	const path = relative(folder, candidate);
	return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

async function resolved(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch {
		return path;
	}
}

/**
 * Run one Timber command that reports through a result file, and read the
 * result once the process has ended.
 *
 * - The result file is a fresh name in a new folder that only this user can
 *   open, outside the repository. Timber creates the file itself and refuses
 *   one that exists, so every run gets a new folder, and so does a retry.
 * - Timber is run as an executable plus an argument array, never through a
 *   shell, with standard input closed.
 * - The file is read only after the process ended, and the folder is removed
 *   whatever happened.
 * - An input file, when the command takes one, is saved in that same
 *   folder, byte for byte as it was given, readable by this user only.
 * - There is no time limit, because setup scripts take as long as they take.
 *
 * What the command printed comes back limited in size and is never logged
 * here: setup scripts can print private content. Callers must not log it
 * either. Never throws: every problem is a failed result with a message.
 */
export async function runTimberWithResultFile(request: TimberRunRequest): Promise<TimberRun> {
	const { executable, command, folder, environment = process.env } = request;
	const shown = describeTimberCommand(request.arguments(RESULT_FILE_PLACEHOLDER, request.input?.shownAs ?? "<input file>"));
	const capture = createOutputCapture();
	const failed = (diagnostic: string): TimberRun => ({ command: shown, result: { outcome: "failed", diagnostic, record: null }, output: capture.finish() });

	let privateFolder: string;
	try {
		// mkdtemp makes the folder with access for this user only (mode 0700).
		privateFolder = await mkdtemp(join(request.temporaryRoot ?? tmpdir(), "timber-app-result-"));
	} catch (error) {
		return failed(`Could not make a temporary folder for the result of timber ${command}: ${messageOf(error)}. Nothing was run.`);
	}

	try {
		if (isInside(await resolved(folder), await resolved(privateFolder))) {
			return failed(`The temporary folder ${privateFolder} is inside ${folder}, and the result of timber ${command} must stay outside the repository. Nothing was run.`);
		}
		const resultFile = join(privateFolder, "result.json");
		const inputFile = join(privateFolder, "input.json");
		if (request.input !== undefined) {
			try {
				// A new file that only this user can read. Only the path is ever logged, never what it holds.
				await writeFile(inputFile, request.input.bytes, { flag: "wx", mode: 0o600 });
			} catch (error) {
				return failed(`Could not save the input file for timber ${command}: ${messageOf(error)}. Nothing was run.`);
			}
		}

		let exitCode: number | null;
		try {
			const child = Bun.spawn([executable, ...request.arguments(resultFile, inputFile)], {
				cwd: folder,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
				env: environment,
			});
			const collect = async (stream: ReadableStream<Uint8Array>) => {
				for await (const chunk of stream) capture.add(chunk);
			};
			await Promise.all([collect(child.stdout), collect(child.stderr), child.exited]);
			exitCode = child.exitCode;
		} catch (error) {
			return failed(`Could not run timber ${command} in ${folder}: ${messageOf(error)}`);
		}

		let text: string | null;
		try {
			text = await readFile(resultFile, "utf8");
		} catch {
			text = null;
		}
		return { command: shown, result: readTimberResult(command, text, exitCode), output: capture.finish() };
	} finally {
		// Only the path is logged, never what the file held.
		await rm(privateFolder, { recursive: true, force: true }).catch(error => console.warn(`Could not remove the temporary folder ${privateFolder}: ${messageOf(error)}`));
	}
}
