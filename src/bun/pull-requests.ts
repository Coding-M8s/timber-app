import { createOutputCapture } from "../shared/captured-output";
import type { TimberStatus } from "../shared/model";
import { APP_PR_ARGUMENTS, APP_PR_COMMAND, type PullRequestList, readPullRequestList } from "../shared/pull-requests";
import { describeTimberStatus } from "./timber";
import { createRecordCapture } from "./workflows";

/**
 * Timber stops its own network part after 15 seconds. Reading the worktrees
 * comes on top, so anything this slow is stuck.
 */
export const READ_PULL_REQUESTS_TIMEOUT_MS = 30_000;

/**
 * Descriptions can be long, and the record holds one for every worktree.
 * Anything past this is not a record Timber would print, and is not read.
 */
const RECORD_LIMIT_BYTES = 16 * 1024 * 1024;

export interface PullRequestReaderOptions {
	/** Where Timber is, as of the last look (see ./timber.ts). */
	timber: () => Promise<TimberStatus>;
	/** Whether a path is the primary checkout of a repository in the app's list. */
	isListed: (repository: string) => Promise<boolean>;
	environment?: Record<string, string | undefined>;
	/** How long Timber may take. Thirty seconds by default. */
	timeoutMs?: number;
}

export interface PullRequestReader {
	/** The pull request of each worktree of a repository from the list, named by the path of its primary checkout. */
	read(repository: string): Promise<PullRequestList>;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Run `timber __app-pr` in a folder and read its record. Timber is run as an
 * executable plus an argument array, never through a shell, with standard
 * input closed so it can never ask for a login. It reads GitHub with its own
 * login and changes no file or ref.
 *
 * Nothing Timber printed is logged here: descriptions are other people's
 * text, and a diagnostic is shown only.
 */
export async function readPullRequests(
	executable: string,
	folder: string,
	environment: Record<string, string | undefined> = process.env,
	timeoutMs: number = READ_PULL_REQUESTS_TIMEOUT_MS,
): Promise<PullRequestList> {
	const stdout = createRecordCapture(RECORD_LIMIT_BYTES);
	const stderr = createOutputCapture();
	let exitCode: number | null;
	let stopped: boolean;
	try {
		const child = Bun.spawn([executable, ...APP_PR_ARGUMENTS], {
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
		return { ok: false, message: `Could not run ${APP_PR_COMMAND} in ${folder}: ${messageOf(error)}` };
	}
	if (stopped) {
		return { ok: false, message: `${APP_PR_COMMAND} in ${folder} was stopped before it finished. The app waits ${timeoutMs / 1000} seconds for it.` };
	}
	const record = stdout.finish();
	if (record.truncated) {
		return { ok: false, message: `${APP_PR_COMMAND} printed more than a pull request record holds. Its pull requests were not read.` };
	}
	return readPullRequestList(record.text, stderr.finish().text, exitCode);
}

/** Reading pull requests, only for a repository in the app's list and only while Timber is ready. */
export function createPullRequestReader(options: PullRequestReaderOptions): PullRequestReader {
	const { timber, isListed, environment, timeoutMs } = options;
	return {
		async read(repository) {
			// The request comes over the bridge, so its shape is checked and not assumed.
			if (typeof repository !== "string" || repository === "") return { ok: false, message: "The request for pull requests names no repository." };
			try {
				if (!await isListed(repository)) return { ok: false, message: `${repository} is not a repository in the app's list.` };
				const status = await timber();
				if (status.state !== "ready") return { ok: false, message: `${describeTimberStatus(status)}.` };
				return await readPullRequests(status.path, repository, environment ?? process.env, timeoutMs);
			} catch (error) {
				return { ok: false, message: `Could not read the pull requests of ${repository}: ${messageOf(error)}.` };
			}
		},
	};
}
