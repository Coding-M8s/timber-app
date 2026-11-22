import type { IssueTracker } from "./model";
import { APP_ISSUES_COMMAND, type IssueSearchFailureReason, type SuggestedIssue, SUPPORTED_APP_ISSUES_SCHEMA_VERSION, readListedIssue } from "./issue-search";
import { describeExit, describeFailedRun, displayText, isFields, readEnvelope } from "./timber-record";

/**
 * Reading a list of a tracker's issues with `timber __app-issues sprint`,
 * `sprint --assigned`, `assigned`, or `open`, version 1 of Timber's issue list record
 * (docs/ide-contract.md in the Timber repository), for the issues board.
 * Pure: the main process runs Timber and hands the output here (see
 * src/bun/issue-lists.ts).
 *
 * Timber reads the tracker with its own login, so the app never holds a
 * token. The search for suggestions reads the same record (./issue-search.ts).
 */

/**
 * The lists of the board. The board shows two toggles, Current sprint and
 * Assigned to me, and each of their four combinations is one list: neither
 * is `open`, Current sprint alone is `sprint`, Assigned to me alone is
 * `assigned`, and both are `my-sprint`, read with `sprint --assigned`.
 */
export const ISSUE_LISTS = ["sprint", "assigned", "open", "my-sprint"] as const;
export type IssueList = typeof ISSUE_LISTS[number];

/** The board's two toggles. */
export interface ListToggles {
	sprint: boolean;
	assigned: boolean;
}

/** The list a combination of the toggles shows. */
export function listOf(toggles: ListToggles): IssueList {
	if (toggles.sprint) return toggles.assigned ? "my-sprint" : "sprint";
	return toggles.assigned ? "assigned" : "open";
}

/** The toggles that show a list. */
export function togglesOf(list: IssueList): ListToggles {
	return { sprint: list === "sprint" || list === "my-sprint", assigned: list === "assigned" || list === "my-sprint" };
}

/** Whether a list is of the current sprint, so its record names the sprint and it has a Done column. */
export const isSprintList = (list: IssueList) => togglesOf(list).sprint;

/** The query Timber's record names for a list: `my-sprint` is `sprint` with `--assigned`. */
export const queryOf = (list: IssueList): "sprint" | "assigned" | "open" => list === "my-sprint" ? "sprint" : list;

/** How many issues `assigned` and `open` ask for. A sprint is listed whole, up to Timber's 500. */
export const LIST_LIMIT = 50;

/** The list's arguments. The tracker is always named, so the board never depends on a default the app did not see. */
export function issueListArguments(list: IssueList, tracker: IssueTracker): string[] {
	const options = list === "my-sprint" ? ["--assigned"] : list === "sprint" ? [] : ["--limit", String(LIST_LIMIT)];
	return ["__app-issues", queryOf(list), "--tracker", tracker, ...options];
}

/** What to list: a repository in the app's list, by its primary checkout, one list, and one tracker. */
export interface IssueListRequest {
	repository: string;
	list: IssueList;
	tracker: IssueTracker;
}

/** Where a sprint came from, as Timber names it. */
export type SprintSource = "jira-board" | "jira-jql" | "github-iteration" | "github-milestone" | "linear-cycle";

/** The sprint, iteration, milestone, or cycle a sprint list is of. `name` is null for a saved Jira query. */
export interface Sprint {
	name: string | null;
	source: SprintSource;
}

/** The same reasons as a search: see `IssueSearchFailureReason`. `not-configured` means the list is not set up here. */
export type IssueListFailureReason = IssueSearchFailureReason;

/** What Timber answered, or why there is no answer. */
export type IssueListResult =
	/**
	 * `sprint` is set for a sprint list and null for the others. `truncated` is
	 * true when the tracker had more issues than listed. `partial` is set only
	 * on `my-sprint` from a Timber without `--assigned`: the app kept the
	 * sprint's issues found in the `assigned` list, which can miss some of
	 * mine (see `intersectMySprint`).
	 */
	| { ok: true; outcome: "found"; issues: SuggestedIssue[]; truncated: boolean; sprint: Sprint | null; partial?: true }
	/** For a sprint: it is set up, but nothing is current. For the other lists: nothing in them. */
	| { ok: true; outcome: "none" }
	| { ok: true; outcome: "failed"; reason: IssueListFailureReason; diagnostic: string }
	/** The Timber found has no `__app-issues`. */
	| { ok: false; unsupported: true; message: string }
	/** Timber could not be run, or its answer could not be read. */
	| { ok: false; unsupported: false; message: string };

const REASONS: readonly IssueListFailureReason[] = ["offline", "sign-in-needed", "not-configured", "not-found", "forbidden", "failed"];
const SOURCES: readonly SprintSource[] = ["jira-board", "jira-jql", "github-iteration", "github-milestone", "linear-cycle"];
const DIAGNOSTIC_LIMIT = 300;
const SPRINT_NAME_LIMIT = 100;
/** A Timber without the command exits with 1, prints nothing, and says so on standard error. */
const UNKNOWN_TO_TIMBER = /^error: unknown command '__app-issues'/m;
/** A Timber older than `sprint --assigned` rejects the option the same way. */
const ASSIGNED_UNKNOWN_TO_TIMBER = /^error: unknown option '--assigned'/m;

/**
 * Whether a run of `sprint --assigned` came from a Timber without the
 * option: exit 1, nothing printed, and Commander's words on standard error.
 * Anything else, a crash included, is read as usual and never falls back.
 */
export function isAssignedOptionUnknown(stdout: string, stderr: string, exitCode: number | null): boolean {
	return exitCode === 1 && stdout.trim() === "" && ASSIGNED_UNKNOWN_TO_TIMBER.test(stderr);
}

export const UNSUPPORTED_LIST_MESSAGE = `This Timber has no ${APP_ISSUES_COMMAND}. The issues board needs a Timber built from its main branch.`;

const oneOf = <Value extends string>(values: readonly Value[], value: unknown): value is Value => typeof value === "string" && (values as readonly string[]).includes(value);
const failed = (message: string): IssueListResult => ({ ok: false, unsupported: false, message });
const unreadable = (detail: string) => failed(`${APP_ISSUES_COMMAND} did not answer with a record this app can read: ${detail}.`);

/** Null when the value is not a sprint. */
function readSprint(value: unknown): Sprint | null {
	if (!isFields(value) || !oneOf(SOURCES, value.source)) return null;
	const { name } = value;
	if (name === null) return { name: null, source: value.source };
	if (typeof name !== "string") return null;
	const shown = displayText(name.trim(), SPRINT_NAME_LIMIT);
	return { name: shown === "" ? null : shown, source: value.source };
}

/**
 * Read what one run of `timber __app-issues <list> --tracker <tracker>`
 * printed. `exitCode` is that process's, or null when it did not exit by
 * itself.
 *
 * Timber exits with 0 for found or none and with 1 for failed, printing its
 * record either way. An answer is accepted only when it is one version 1
 * record of the list and tracker asked about, whose outcome, fields, and exit
 * code agree, with every issue readable. Anything else is a failure, never a
 * guess.
 */
export function readIssueListRecord(stdout: string, stderr: string, exitCode: number | null, list: IssueList, tracker: IssueTracker): IssueListResult {
	if (exitCode === 1 && stdout.trim() === "" && UNKNOWN_TO_TIMBER.test(stderr)) {
		return { ok: false, unsupported: true, message: UNSUPPORTED_LIST_MESSAGE };
	}
	const explained = () => failed(describeFailedRun(APP_ISSUES_COMMAND, stderr, exitCode));
	if (exitCode !== 0 && exitCode !== 1) return explained();

	const envelope = readEnvelope(stdout, APP_ISSUES_COMMAND, SUPPORTED_APP_ISSUES_SCHEMA_VERSION);
	if (!envelope.ok) {
		if (envelope.problem === "not-json" && exitCode !== 0) return explained();
		return envelope.problem === "version" ? failed(envelope.message) : unreadable(envelope.detail);
	}
	const { query, outcome, issues, truncated, reason, diagnostic, sprint } = envelope.record;
	if (query !== queryOf(list)) return unreadable("it is about another list");
	if (envelope.record.tracker !== tracker) return unreadable("it is about another tracker");
	if (!Array.isArray(issues) || typeof truncated !== "boolean") return unreadable("its issues cannot be read");

	if (outcome === "found" || outcome === "none") {
		if (exitCode !== 0) return unreadable(`it ${describeExit(exitCode)}, which does not match its outcome`);
		if (reason !== null || diagnostic !== null) return unreadable("its fields do not match its outcome");
		if (outcome === "none") {
			if (issues.length !== 0 || sprint !== null) return unreadable("its fields do not match its outcome");
			return { ok: true, outcome };
		}
		let read: Sprint | null = null;
		if (isSprintList(list)) {
			read = readSprint(sprint);
			if (read === null) return unreadable("its sprint cannot be read");
		} else if (sprint !== null) {
			return unreadable("its fields do not match its outcome");
		}
		const listed = issues.map(readListedIssue);
		if (listed.some(issue => issue === null)) return unreadable("an issue in it cannot be read");
		// The record of `sprint --assigned` is shaped as `sprint`'s, so only this shows the filter was applied: Timber marks every issue in it as mine.
		if (list === "my-sprint" && listed.some(issue => issue!.assignedToMe !== true)) return unreadable("an issue in it is not assigned to you");
		return { ok: true, outcome, issues: listed as SuggestedIssue[], truncated, sprint: read };
	}
	if (outcome === "failed") {
		if (exitCode !== 1) return unreadable(`it ${describeExit(exitCode)}, which does not match its outcome`);
		if (issues.length !== 0 || sprint !== null || !oneOf(REASONS, reason) || typeof diagnostic !== "string") return unreadable("its fields do not match its outcome");
		const text = diagnostic.trim() === "" ? "Timber did not say why." : displayText(diagnostic.trim(), DIAGNOSTIC_LIMIT);
		return { ok: true, outcome, reason, diagnostic: text };
	}
	return unreadable("its outcome is not one this app knows");
}

/**
 * My issues in the current sprint from a Timber without `sprint --assigned`,
 * out of its `sprint` and `assigned` answers. A sprint that is not found
 * (none, failed, or not read) is the answer as it is. Each sprint issue
 * whose `assignedToMe` is known is kept or dropped by it. Only when some
 * issue's is unknown is the `assigned` list needed: such an issue is kept
 * when that list has its address. The address, not the key, because a
 * GitHub project can hold issues of several repositories.
 *
 * That last way is lossy, so the result is then `partial`: `assigned` holds
 * only open issues, at most `LIST_LIMIT` of them, and on GitHub only the
 * selected remote's repository. When it was not read, its failure is the
 * answer, except that its `not-configured` is said as `failed`, since only a
 * sprint that is not set up hides the Current sprint toggle.
 */
export function intersectMySprint(sprint: IssueListResult, assigned: IssueListResult | null): IssueListResult {
	if (!sprint.ok || sprint.outcome !== "found") return sprint;
	const unknown = sprint.issues.some(issue => issue.assignedToMe === null);
	if (!unknown) return { ...sprint, issues: sprint.issues.filter(issue => issue.assignedToMe === true) };
	if (assigned === null || !assigned.ok) return assigned ?? failed("The issues assigned to you were not read.");
	if (assigned.outcome === "failed") return assigned.reason === "not-configured" ? { ...assigned, reason: "failed" } : assigned;
	const mine = new Set(assigned.outcome === "found" ? assigned.issues.map(issue => issue.url) : []);
	const issues = sprint.issues
		.filter(issue => issue.assignedToMe === true || (issue.assignedToMe === null && mine.has(issue.url)))
		.map(issue => ({ ...issue, assignedToMe: true }));
	return { ok: true, outcome: "found", issues, truncated: sprint.truncated, sprint: sprint.sprint, partial: true };
}
