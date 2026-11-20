import { createOutputCapture } from "../shared/captured-output";
import { messageOf } from "../shared/error-message";
import type { TimberStatus } from "../shared/model";
import { describeTimberStatus } from "./timber";

/**
 * Keeps the start of what a process printed, up to `limit` bytes, as it was.
 * The record is decoded untouched: cleaning it as text would change values
 * inside it, such as an agent's arguments.
 */
export function createRecordCapture(limit: number) {
	const chunks: Uint8Array[] = [];
	let size = 0;
	let truncated = false;
	return {
		add(chunk: Uint8Array) {
			if (size + chunk.length > limit) truncated = true;
			const kept = chunk.subarray(0, Math.max(0, limit - size));
			if (kept.length > 0) {
				chunks.push(kept);
				size += kept.length;
			}
		},
		finish: () => ({ text: new TextDecoder().decode(Buffer.concat(chunks)), truncated }),
	};
}

export interface TimberRecordRun {
	executable: string;
	arguments: readonly string[];
	folder: string;
	environment: Record<string, string | undefined>;
	timeoutMs: number;
	/** The most a record may hold. A longer one is not read. */
	limitBytes: number;
	/** The command as the person reads it, such as `timber __app-pr`. */
	command: string;
	/** Where it ran, as the messages say it, such as `in /home/me/repo`. */
	where: string;
	/** What follows "printed more than" when the record is too long. */
	tooLong: string;
}

/** What Timber printed and how it ended, or why there is no record to read. */
export type TimberRecordOutput =
	| { ok: true; record: string; diagnostic: string; exitCode: number | null }
	| { ok: false; message: string };

/**
 * Run a Timber command that prints one record on standard output. Timber is
 * run as an executable plus an argument array, never through a shell, with
 * standard input closed. The record is kept as it was, and the diagnostic as
 * plain text, since it is only shown. Nothing of either is logged here.
 */
export async function runTimberRecord(run: TimberRecordRun): Promise<TimberRecordOutput> {
	const stdout = createRecordCapture(run.limitBytes);
	const stderr = createOutputCapture();
	let exitCode: number | null;
	let stopped: boolean;
	try {
		const child = Bun.spawn([run.executable, ...run.arguments], {
			cwd: run.folder,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			env: run.environment,
			timeout: run.timeoutMs,
		});
		const collect = async (stream: ReadableStream<Uint8Array>, capture: { add(chunk: Uint8Array): void }) => {
			for await (const chunk of stream) capture.add(chunk);
		};
		// Both streams are read at once, so a full pipe never holds Timber up.
		await Promise.all([collect(child.stdout, stdout), collect(child.stderr, stderr), child.exited]);
		exitCode = child.exitCode;
		stopped = child.signalCode !== null;
	} catch (error) {
		return { ok: false, message: `Could not run ${run.command} ${run.where}: ${messageOf(error)}` };
	}
	if (stopped) {
		return { ok: false, message: `${run.command} ${run.where} was stopped before it finished. The app waits ${run.timeoutMs / 1000} seconds for it.` };
	}
	const record = stdout.finish();
	if (record.truncated) return { ok: false, message: `${run.command} printed more than ${run.tooLong}` };
	return { ok: true, record: record.text, diagnostic: stderr.finish().text, exitCode };
}

export interface ReadyTimberCheck<Result> {
	/** Where Timber is, as of the last look (see ./timber.ts). */
	timber: () => Promise<TimberStatus>;
	/** Whether a path is the primary checkout of a repository in the app's list. */
	isListed: (repository: string) => Promise<boolean>;
	repository: string;
	/** What follows "Could not" when something throws, such as `read the workflows of /home/me/repo`. */
	couldNot: string;
	/** The result for a refusal or failure, from its message. */
	fail: (message: string) => Result;
	run: (executable: string) => Promise<Result>;
}

/** Runs only for a repository in the app's list and only while Timber is ready. */
export async function withReadyTimber<Result>(check: ReadyTimberCheck<Result>): Promise<Result> {
	const { timber, isListed, repository, fail } = check;
	try {
		if (!await isListed(repository)) return fail(`${repository} is not a repository in the app's list.`);
		const status = await timber();
		if (status.state !== "ready") return fail(`${describeTimberStatus(status)}.`);
		return await check.run(status.path);
	} catch (error) {
		return fail(`Could not ${check.couldNot}: ${messageOf(error)}.`);
	}
}
