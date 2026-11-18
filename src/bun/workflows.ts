import { createOutputCapture } from "../shared/captured-output";
import type { TimberStatus } from "../shared/model";
import { APP_CONFIG_READ_ARGUMENTS, APP_CONFIG_READ_COMMAND, type WorkflowList, readWorkflowList } from "../shared/workflows";
import { describeTimberStatus } from "./timber";

/** Reading settings is offline and takes well under a second, so anything this slow is stuck. */
export const READ_WORKFLOWS_TIMEOUT_MS = 10_000;

/** A settings record is small. Anything past this is not one, and is not read. */
const RECORD_LIMIT_BYTES = 1024 * 1024;

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

export interface WorkflowReaderOptions {
	/** Where Timber is, as of the last look (see ./timber.ts). */
	timber: () => Promise<TimberStatus>;
	/** Whether a path is the primary checkout of a repository in the app's list. */
	isListed: (repository: string) => Promise<boolean>;
	environment?: Record<string, string | undefined>;
	/** How long Timber may take. Ten seconds by default. */
	timeoutMs?: number;
}

export interface WorkflowReader {
	/** The named workflows of a repository from the list, named by the path of its primary checkout. */
	list(repository: string): Promise<WorkflowList>;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Run `timber __app-config read --scope repository` in a folder and read its
 * workflows. Timber is run as an executable plus an argument array, never
 * through a shell, with standard input closed, and reading changes nothing.
 *
 * What Timber printed is private: the record says whether credentials are
 * saved, and workflow arguments can hold tokens. It goes only to the reader,
 * and nothing of it is logged here.
 */
export async function readWorkflows(
	executable: string,
	folder: string,
	environment: Record<string, string | undefined> = process.env,
	timeoutMs: number = READ_WORKFLOWS_TIMEOUT_MS,
): Promise<WorkflowList> {
	const stdout = createRecordCapture(RECORD_LIMIT_BYTES);
	// Timber's diagnostic is only shown, so it is kept as plain text.
	const stderr = createOutputCapture();
	let exitCode: number | null;
	let stopped: boolean;
	try {
		const child = Bun.spawn([executable, ...APP_CONFIG_READ_ARGUMENTS], {
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
		return { ok: false, message: `Could not run ${APP_CONFIG_READ_COMMAND} in ${folder}: ${messageOf(error)}` };
	}
	if (stopped) {
		return { ok: false, message: `${APP_CONFIG_READ_COMMAND} in ${folder} was stopped before it finished. The app waits ${timeoutMs / 1000} seconds for it.` };
	}
	const record = stdout.finish();
	if (record.truncated) {
		return { ok: false, message: `${APP_CONFIG_READ_COMMAND} printed more than a settings record holds. Its workflows were not read.` };
	}
	return readWorkflowList(record.text, stderr.finish().text, exitCode);
}

/** Reading workflows, only for a repository in the app's list and only while Timber is ready. */
export function createWorkflowReader(options: WorkflowReaderOptions): WorkflowReader {
	const { timber, isListed, environment, timeoutMs } = options;
	return {
		async list(repository) {
			// The request comes over the bridge, so its shape is checked and not assumed.
			if (typeof repository !== "string" || repository === "") return { ok: false, message: "The request for workflows names no repository." };
			try {
				if (!await isListed(repository)) return { ok: false, message: `${repository} is not a repository in the app's list.` };
				const status = await timber();
				if (status.state !== "ready") return { ok: false, message: `${describeTimberStatus(status)}.` };
				return await readWorkflows(status.path, repository, environment ?? process.env, timeoutMs);
			} catch (error) {
				return { ok: false, message: `Could not read the workflows of ${repository}: ${messageOf(error)}.` };
			}
		},
	};
}
