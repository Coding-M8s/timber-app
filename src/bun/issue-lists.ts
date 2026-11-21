import { ISSUE_TRACKERS } from "../shared/issue-trackers";
import { APP_ISSUES_COMMAND } from "../shared/issue-search";
import { ISSUE_LISTS, type IssueList, type IssueListRequest, type IssueListResult, issueListArguments, readIssueListRecord } from "../shared/issue-lists";
import type { IssueTracker, TimberStatus } from "../shared/model";
import { runTimberRecord, withReadyTimber } from "./timber-record";

/** Timber stops its own network part after 15 seconds, so anything this slow is stuck. */
export const LIST_ISSUES_TIMEOUT_MS = 30_000;

/**
 * A whole sprint is at most 500 issues. With long titles, a worktree, and a
 * few linked pull requests each, that is well under 2 MB. Anything past 8 MB
 * is not a record Timber would print, and is not read.
 */
const RECORD_LIMIT_BYTES = 8 * 1024 * 1024;

export interface IssueListerOptions {
	/** Where Timber is, as of the last look (see ./timber.ts). */
	timber: () => Promise<TimberStatus>;
	/** Whether a path is the primary checkout of a repository in the app's list. */
	isListed: (repository: string) => Promise<boolean>;
	environment?: Record<string, string | undefined>;
	/** How long Timber may take. Thirty seconds by default. */
	timeoutMs?: number;
}

export interface IssueLister {
	list(request: IssueListRequest): Promise<IssueListResult>;
}

/**
 * Run `timber __app-issues <list> --tracker <tracker>` in a repository's
 * primary checkout and read its record. Timber is run as an executable plus
 * an argument array, never through a shell. Standard input is closed, so
 * Timber can never ask for a login. It changes no file, ref, or issue, and
 * does not take the repository's turn, so it never waits behind a command
 * that changes the repository.
 *
 * Nothing Timber printed is logged here: titles are other people's text.
 */
export async function listIssues(
	executable: string,
	folder: string,
	list: IssueList,
	tracker: IssueTracker,
	environment: Record<string, string | undefined> = process.env,
	timeoutMs: number = LIST_ISSUES_TIMEOUT_MS,
): Promise<IssueListResult> {
	const output = await runTimberRecord({
		executable, arguments: issueListArguments(list, tracker), folder, environment, timeoutMs, limitBytes: RECORD_LIMIT_BYTES,
		command: APP_ISSUES_COMMAND, where: `in ${folder}`, tooLong: "a list of issues holds. Nothing was listed.",
	});
	if (!output.ok) return { ok: false, unsupported: false, message: output.message };
	return readIssueListRecord(output.record, output.diagnostic, output.exitCode, list, tracker);
}

/** Listing only for a repository in the app's list, only a list and a tracker the app knows, and only while Timber is ready. */
export function createIssueLister(options: IssueListerOptions): IssueLister {
	const { timber, isListed, environment, timeoutMs } = options;
	const fail = (message: string): IssueListResult => ({ ok: false, unsupported: false, message });
	return {
		async list(request) {
			// The request comes over the bridge, so its shape is checked and not assumed.
			const { repository, list, tracker } = (typeof request === "object" && request !== null ? request : {}) as Partial<IssueListRequest>;
			if (typeof repository !== "string" || repository === "") return fail("The issue list names no repository.");
			if (typeof list !== "string" || !(ISSUE_LISTS as readonly string[]).includes(list)) return fail("The issue list names no list this app knows.");
			if (typeof tracker !== "string" || !(ISSUE_TRACKERS as readonly string[]).includes(tracker)) return fail("The issue list names no tracker this app knows.");
			return withReadyTimber({
				timber, isListed, repository, couldNot: `list the issues of ${repository}`, fail,
				run: executable => listIssues(executable, repository, list as IssueList, tracker as IssueTracker, environment ?? process.env, timeoutMs),
			});
		},
	};
}
