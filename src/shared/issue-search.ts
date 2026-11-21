import { type Issue, readIssueValue } from "./issues";
import type { IssueTracker } from "./model";
import { describeExit, describeFailedRun, displayText, isFields, readEnvelope } from "./timber-record";

/**
 * Searching a tracker's issues with `timber __app-issues search`, version 1
 * of Timber's issue list record (docs/ide-contract.md in the Timber
 * repository), for suggestions while a worktree's name is typed. Pure: the
 * main process runs Timber and hands the output here (see
 * src/bun/issue-search.ts).
 *
 * Timber reads the tracker with its own login, so the app never holds a
 * token. It matches the text itself: key prefixes and title words.
 */
export const APP_ISSUES_COMMAND = "timber __app-issues";
export const SUPPORTED_APP_ISSUES_SCHEMA_VERSION = 1;
/** Timber takes at most this many characters of search text. */
export const SEARCH_TEXT_LIMIT = 200;
/** How many suggestions are asked for. Timber's own default for a search. */
export const SEARCH_LIMIT = 10;

/** The search command's arguments. The text is one argument after `--`, so it is never read as an option. */
export function issueSearchArguments(tracker: IssueTracker, text: string, limit: number = SEARCH_LIMIT): string[] {
	return ["__app-issues", "search", "--tracker", tracker, "--limit", String(limit), "--", text];
}

/**
 * Why Timber could not search.
 * - `offline`: the tracker could not be reached, or did not answer in time.
 * - `sign-in-needed`: no usable login, a rejected one, or, for Jira, no configured site.
 * - `not-configured`: a setting the search needs is missing.
 * - `not-found`: the configured project or team does not exist, or is hidden from this login.
 * - `forbidden`: the login may not read the issues.
 * - `failed`: anything else, such as a rate limit.
 */
export type IssueSearchFailureReason = "offline" | "sign-in-needed" | "not-configured" | "not-found" | "forbidden" | "failed";

/** One issue Timber found, and the worktree already linked to it, if any. */
export interface SuggestedIssue extends Issue {
	worktree: { path: string; branch: string | null } | null;
}

/** What to search: a repository in the app's list, by its primary checkout, one tracker, and the typed text. */
export interface IssueSearchRequest {
	repository: string;
	tracker: IssueTracker;
	text: string;
}

/** What Timber answered, or why there is no answer. */
export type IssueSearchResult =
	/** `truncated` is true when the tracker had more matches, or, on GitHub, more open issues than Timber searched. */
	| { ok: true; outcome: "found"; issues: SuggestedIssue[]; truncated: boolean }
	| { ok: true; outcome: "failed"; reason: IssueSearchFailureReason; diagnostic: string }
	/** The Timber found has no `__app-issues`. It is on Timber's main branch and in no release yet. */
	| { ok: false; unsupported: true; message: string }
	/** Timber could not be run, or its answer could not be read. */
	| { ok: false; unsupported: false; message: string };

const REASONS: readonly IssueSearchFailureReason[] = ["offline", "sign-in-needed", "not-configured", "not-found", "forbidden", "failed"];
const DIAGNOSTIC_LIMIT = 300;
/** A Timber without the command exits with 1, prints nothing, and says so on standard error. */
const UNKNOWN_TO_TIMBER = /^error: unknown command '__app-issues'/m;

const oneOf = <Value extends string>(values: readonly Value[], value: unknown): value is Value => typeof value === "string" && (values as readonly string[]).includes(value);
const failed = (message: string): IssueSearchResult => ({ ok: false, unsupported: false, message });
const unreadable = (detail: string) => failed(`${APP_ISSUES_COMMAND} did not answer with a record this app can read: ${detail}.`);

/** Null when the value is not one listed issue. */
function readSuggested(value: unknown): SuggestedIssue | null {
	const issue = readIssueValue(value);
	if (issue === null || !isFields(value)) return null;
	const { worktree } = value;
	if (worktree === null) return { ...issue, worktree: null };
	if (!isFields(worktree) || typeof worktree.path !== "string" || worktree.path === "") return null;
	if (worktree.branch !== null && typeof worktree.branch !== "string") return null;
	return { ...issue, worktree: { path: worktree.path, branch: worktree.branch } };
}

/**
 * Read what one run of `timber __app-issues search --tracker <tracker>`
 * printed. `exitCode` is that process's, or null when it did not exit by
 * itself.
 *
 * Timber exits with 0 for found or none and with 1 for failed, printing its
 * record either way. An answer is accepted only when it is one version 1
 * search record for the tracker asked about, whose outcome, fields, and exit
 * code agree, with every issue readable. Anything else is a failure, never a
 * guess.
 */
export function readIssueSearchRecord(stdout: string, stderr: string, exitCode: number | null, tracker: IssueTracker): IssueSearchResult {
	if (exitCode === 1 && stdout.trim() === "" && UNKNOWN_TO_TIMBER.test(stderr)) {
		return { ok: false, unsupported: true, message: `This Timber has no ${APP_ISSUES_COMMAND}. Issue suggestions need a Timber built from its main branch.` };
	}
	const explained = () => failed(describeFailedRun(APP_ISSUES_COMMAND, stderr, exitCode));
	if (exitCode !== 0 && exitCode !== 1) return explained();

	const envelope = readEnvelope(stdout, APP_ISSUES_COMMAND, SUPPORTED_APP_ISSUES_SCHEMA_VERSION);
	if (!envelope.ok) {
		if (envelope.problem === "not-json" && exitCode !== 0) return explained();
		return envelope.problem === "version" ? failed(envelope.message) : unreadable(envelope.detail);
	}
	const { query, outcome, issues, truncated, reason, diagnostic } = envelope.record;
	if (query !== "search") return unreadable("it is not a search");
	if (envelope.record.tracker !== tracker) return unreadable("it is about another tracker");
	if (!Array.isArray(issues) || typeof truncated !== "boolean") return unreadable("its issues cannot be read");

	if (outcome === "found" || outcome === "none") {
		if (exitCode !== 0) return unreadable(`it ${describeExit(exitCode)}, which does not match its outcome`);
		if (reason !== null || diagnostic !== null) return unreadable("its fields do not match its outcome");
		const read = issues.map(readSuggested);
		if (read.some(issue => issue === null)) return unreadable("an issue in it cannot be read");
		return { ok: true, outcome: "found", issues: read as SuggestedIssue[], truncated };
	}
	if (outcome === "failed") {
		if (exitCode !== 1) return unreadable(`it ${describeExit(exitCode)}, which does not match its outcome`);
		if (issues.length !== 0 || !oneOf(REASONS, reason) || typeof diagnostic !== "string") return unreadable("its fields do not match its outcome");
		const text = diagnostic.trim() === "" ? "Timber did not say why." : displayText(diagnostic.trim(), DIAGNOSTIC_LIMIT);
		return { ok: true, outcome, reason, diagnostic: text };
	}
	return unreadable("its outcome is not one this app knows");
}
