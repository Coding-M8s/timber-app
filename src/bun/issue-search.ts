import { ISSUE_TRACKERS } from "../shared/issue-trackers";
import { APP_ISSUES_COMMAND, type IssueSearchRequest, type IssueSearchResult, SEARCH_TEXT_LIMIT, issueSearchArguments, readIssueSearchRecord } from "../shared/issue-search";
import type { IssueTracker, TimberStatus } from "../shared/model";
import { runTimberRecord, withReadyTimber } from "./timber-record";

/** Timber stops its own network part after 15 seconds, so anything this slow is stuck. */
export const SEARCH_ISSUES_TIMEOUT_MS = 30_000;

/** Ten issues fit in far less. Anything past this is not a record Timber would print, and is not read. */
const RECORD_LIMIT_BYTES = 512 * 1024;

export interface IssueSearcherOptions {
	/** Where Timber is, as of the last look (see ./timber.ts). */
	timber: () => Promise<TimberStatus>;
	/** Whether a path is the primary checkout of a repository in the app's list. */
	isListed: (repository: string) => Promise<boolean>;
	environment?: Record<string, string | undefined>;
	/** How long Timber may take. Thirty seconds by default. */
	timeoutMs?: number;
}

export interface IssueSearcher {
	search(request: IssueSearchRequest): Promise<IssueSearchResult>;
}

/**
 * Run `timber __app-issues search --tracker <tracker> -- <text>` in a
 * repository's primary checkout and read its record. Timber is run as an
 * executable plus an argument array, never through a shell, and the text
 * comes after `--`, so it is never read as an option. Standard input is
 * closed, so Timber can never ask for a login. It changes no file, ref, or
 * issue. It does not take the repository's turn: it changes nothing, so it
 * never waits behind a command that does.
 *
 * Nothing Timber printed is logged here: titles are other people's text.
 */
export async function searchIssues(
	executable: string,
	folder: string,
	tracker: IssueTracker,
	text: string,
	environment: Record<string, string | undefined> = process.env,
	timeoutMs: number = SEARCH_ISSUES_TIMEOUT_MS,
): Promise<IssueSearchResult> {
	const output = await runTimberRecord({
		executable, arguments: issueSearchArguments(tracker, text), folder, environment, timeoutMs, limitBytes: RECORD_LIMIT_BYTES,
		command: APP_ISSUES_COMMAND, where: `in ${folder}`, tooLong: "a list of suggested issues holds. Nothing was suggested.",
	});
	if (!output.ok) return { ok: false, unsupported: false, message: output.message };
	return readIssueSearchRecord(output.record, output.diagnostic, output.exitCode, tracker);
}

/** Searching only a repository in the app's list, only a tracker the app knows, and only while Timber is ready. */
export function createIssueSearcher(options: IssueSearcherOptions): IssueSearcher {
	const { timber, isListed, environment, timeoutMs } = options;
	const fail = (message: string): IssueSearchResult => ({ ok: false, unsupported: false, message });
	return {
		async search(request) {
			// The request comes over the bridge, so its shape is checked and not assumed.
			const { repository, tracker, text } = (typeof request === "object" && request !== null ? request : {}) as Partial<IssueSearchRequest>;
			if (typeof repository !== "string" || repository === "") return fail("The issue search names no repository.");
			if (typeof tracker !== "string" || !(ISSUE_TRACKERS as readonly string[]).includes(tracker)) return fail("The issue search names no tracker this app knows.");
			if (typeof text !== "string" || text.trim() === "" || Array.from(text).length > SEARCH_TEXT_LIMIT) return fail(`The issue search needs text of 1 to ${SEARCH_TEXT_LIMIT} characters.`);
			return withReadyTimber({
				timber, isListed, repository, couldNot: `search the issues of ${repository}`, fail,
				run: executable => searchIssues(executable, repository, tracker as IssueTracker, text, environment ?? process.env, timeoutMs),
			});
		},
	};
}
