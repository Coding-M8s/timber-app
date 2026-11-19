import { isAbsolute } from "node:path";
import { createOutputCapture } from "../shared/captured-output";
import { APP_ISSUE_ARGUMENTS, APP_ISSUE_COMMAND, type IssueLookup, type IssueRequest, readIssueRecord } from "../shared/issues";
import type { TimberStatus } from "../shared/model";
import { describeTimberStatus } from "./timber";
import { createRecordCapture } from "./workflows";

/**
 * Timber stops its own network part after 15 seconds. Finding the worktree
 * comes on top, so anything this slow is stuck.
 */
export const READ_ISSUE_TIMEOUT_MS = 30_000;

/** One issue record is small. Anything past this is not a record Timber would print, and is not read. */
const RECORD_LIMIT_BYTES = 256 * 1024;

export interface IssueReaderOptions {
	/** Where Timber is, as of the last look (see ./timber.ts). */
	timber: () => Promise<TimberStatus>;
	/** Whether a path is the primary checkout of a repository in the app's list. */
	isListed: (repository: string) => Promise<boolean>;
	environment?: Record<string, string | undefined>;
	/** How long Timber may take. Thirty seconds by default. */
	timeoutMs?: number;
}

export interface IssueReader {
	/** The linked issue of one worktree of a repository from the list. */
	read(request: IssueRequest): Promise<IssueLookup>;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Run `timber __app-issue -- <worktree>` in a repository's primary checkout
 * and read its record. Timber is run as an executable plus an argument
 * array, never through a shell, and the path comes after `--`, so it is
 * never read as an option. Standard input is closed, so Timber can never ask
 * for a login. It reads the tracker with its own login and changes no file,
 * ref, or issue.
 *
 * Nothing Timber printed is logged here: titles are other people's text, and
 * a diagnostic is shown only.
 */
export async function readIssue(
	executable: string,
	folder: string,
	worktree: string,
	environment: Record<string, string | undefined> = process.env,
	timeoutMs: number = READ_ISSUE_TIMEOUT_MS,
): Promise<IssueLookup> {
	const stdout = createRecordCapture(RECORD_LIMIT_BYTES);
	const stderr = createOutputCapture();
	let exitCode: number | null;
	let stopped: boolean;
	try {
		const child = Bun.spawn([executable, ...APP_ISSUE_ARGUMENTS, worktree], {
			cwd: folder,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: environment,
			timeout: timeoutMs,
		});
		const collect = async (stream: ReadableStream<Uint8Array>, capture: { add(chunk: Uint8Array): void }) => {
			for await (const chunk of stream) capture.add(chunk);
		};
		// Both streams are read at once, so a full pipe never holds Timber up.
		await Promise.all([collect(child.stdout, stdout), collect(child.stderr, stderr), child.exited]);
		exitCode = child.exitCode;
		stopped = child.signalCode !== null;
	} catch (error) {
		return { ok: false, message: `Could not run ${APP_ISSUE_COMMAND} for ${worktree}: ${messageOf(error)}` };
	}
	if (stopped) {
		return { ok: false, message: `${APP_ISSUE_COMMAND} for ${worktree} was stopped before it finished. The app waits ${timeoutMs / 1000} seconds for it.` };
	}
	const record = stdout.finish();
	if (record.truncated) {
		return { ok: false, message: `${APP_ISSUE_COMMAND} printed more than an issue record holds. The issue was not read.` };
	}
	return readIssueRecord(record.text, stderr.finish().text, exitCode, worktree);
}

/**
 * Reading linked issues, only for a repository in the app's list, only for
 * a full worktree path, and only while Timber is ready. Timber itself refuses
 * a path that is not a registered worktree of that repository.
 */
export function createIssueReader(options: IssueReaderOptions): IssueReader {
	const { timber, isListed, environment, timeoutMs } = options;
	return {
		async read(request) {
			// The request comes over the bridge, so its shape is checked and not assumed.
			const { repository, worktree } = (typeof request === "object" && request !== null ? request : {}) as Partial<IssueRequest>;
			if (typeof repository !== "string" || repository === "") return { ok: false, message: "The request for an issue names no repository." };
			if (typeof worktree !== "string" || !isAbsolute(worktree)) return { ok: false, message: "The request for an issue names no full worktree path." };
			try {
				if (!await isListed(repository)) return { ok: false, message: `${repository} is not a repository in the app's list.` };
				const status = await timber();
				if (status.state !== "ready") return { ok: false, message: `${describeTimberStatus(status)}.` };
				return await readIssue(status.path, repository, worktree, environment ?? process.env, timeoutMs);
			} catch (error) {
				return { ok: false, message: `Could not read the issue of ${worktree}: ${messageOf(error)}.` };
			}
		},
	};
}
