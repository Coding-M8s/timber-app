import type { TimberStatus } from "../shared/model";
import { APP_PR_ARGUMENTS, APP_PR_COMMAND, type PullRequestList, readPullRequestList } from "../shared/pull-requests";
import { runTimberRecord, withReadyTimber } from "./timber-record";

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

/**
 * Run `timber __app-pr` in a folder and read its record. Timber is run as an
 * executable plus an argument array, never through a shell, with standard
 * input closed so it can never ask for a login. It reads GitHub or
 * Bitbucket, after the remote, with its own login and changes no file or ref.
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
	const output = await runTimberRecord({
		executable, arguments: APP_PR_ARGUMENTS, folder, environment, timeoutMs, limitBytes: RECORD_LIMIT_BYTES,
		command: APP_PR_COMMAND, where: `in ${folder}`, tooLong: "a pull request record holds. Its pull requests were not read.",
	});
	if (!output.ok) return output;
	return readPullRequestList(output.record, output.diagnostic, output.exitCode);
}

/** Reading pull requests, only for a repository in the app's list and only while Timber is ready. */
export function createPullRequestReader(options: PullRequestReaderOptions): PullRequestReader {
	const { timber, isListed, environment, timeoutMs } = options;
	return {
		async read(repository) {
			// The request comes over the bridge, so its shape is checked and not assumed.
			if (typeof repository !== "string" || repository === "") return { ok: false, message: "The request for pull requests names no repository." };
			return withReadyTimber({
				timber, isListed, repository, couldNot: `read the pull requests of ${repository}`,
				fail: message => ({ ok: false, message }),
				run: executable => readPullRequests(executable, repository, environment ?? process.env, timeoutMs),
			});
		},
	};
}
