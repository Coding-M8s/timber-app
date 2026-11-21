import type { IssueTracker } from "./model";
import { ISSUE_TRACKERS, isHttpsLink } from "./timber-ls";
import { describeExit, describeFailedRun, displayText, isFields, readEnvelope } from "./timber-record";

/**
 * Reading a worktree's linked issue from `timber __app-issue`, version 1 of
 * Timber's issue record (docs/ide-contract.md in the Timber repository).
 * Pure: the main process runs Timber and hands the output here (see
 * src/bun/issues.ts).
 *
 * Timber reads the tracker with its own login, so the app never holds a
 * token and never signs in.
 */
export const APP_ISSUE_ARGUMENTS = ["__app-issue", "--"] as const;
export const APP_ISSUE_COMMAND = "timber __app-issue";
export const SUPPORTED_APP_ISSUE_SCHEMA_VERSION = 1;

/** The tracker's own grouping of the status. Used for color only; the words are the tracker's status name. */
export type IssueStatusCategory = "open" | "in-progress" | "closed";

/**
 * Why Timber could not read the issue.
 * - `offline`: the tracker could not be reached, or did not answer in time.
 * - `sign-in-needed`: no usable login, a rejected one, or, for Jira, no configured site.
 * - `not-found`: the tracker has no such issue, or hides it from this login.
 * - `forbidden`: the login is known but may not read the issue.
 * - `failed`: anything else, such as a rate limit or damaged link metadata.
 */
export type IssueFailureReason = "offline" | "sign-in-needed" | "not-found" | "forbidden" | "failed";

/** One issue, as much of it as the interface shows. Text from the tracker is made safe to show and is never trusted markup. */
export interface Issue {
	tracker: IssueTracker;
	/** As saved in the link: the GitHub number as decimal text, or the Jira or Linear key. */
	key: string;
	/** The `https` address saved in the link. */
	url: string;
	title: string;
	status: { name: string; category: IssueStatusCategory };
	/** Display name, or the login for GitHub. Null when unassigned. */
	assignee: string | null;
}

/** Which worktree to read the issue of: a repository in the app's list, by its primary checkout, and the worktree's Git-registered path. */
export interface IssueRequest {
	repository: string;
	worktree: string;
}

/** What Timber answered for one worktree, or why there is no answer. */
export type IssueLookup =
	| { ok: true; outcome: "found"; issue: Issue }
	/** No link is saved. Timber contacted nothing. */
	| { ok: true; outcome: "none" }
	| { ok: true; outcome: "failed"; reason: IssueFailureReason; diagnostic: string }
	/** Timber could not be run, or its answer could not be read. */
	| { ok: false; message: string };

const CATEGORIES: readonly IssueStatusCategory[] = ["open", "in-progress", "closed"];
const REASONS: readonly IssueFailureReason[] = ["offline", "sign-in-needed", "not-found", "forbidden", "failed"];

/** How much of a diagnostic is passed on. */
const DIAGNOSTIC_LIMIT = 300;
/** How much of a title is passed on. */
const TITLE_LIMIT = 300;
/** A status name goes into the header and a tooltip, so it is kept short. */
const STATUS_LIMIT = 40;
const NAME_LIMIT = 100;

const oneOf = <Value extends string>(values: readonly Value[], value: unknown): value is Value => typeof value === "string" && (values as readonly string[]).includes(value);

const failed = (message: string): IssueLookup => ({ ok: false, message });
const unreadable = (detail: string) => failed(`${APP_ISSUE_COMMAND} did not answer with a record this app can read: ${detail}.`);

/** Null when the value is not one issue. Fields this app does not use are ignored. */
export function readIssueValue(value: unknown): Issue | null {
	if (!isFields(value)) return null;
	const { tracker, key, url, title, status, assignee } = value;
	if (!oneOf(ISSUE_TRACKERS, tracker) || typeof key !== "string" || key.trim() === "" || !isHttpsLink(url)) return null;
	if (typeof title !== "string" || !isFields(status) || typeof status.name !== "string" || !oneOf(CATEGORIES, status.category)) return null;
	if (assignee !== null && typeof assignee !== "string") return null;
	const name = assignee === null ? "" : displayText(assignee.trim(), NAME_LIMIT);
	return {
		tracker,
		// Kept as Timber printed it, so it can be compared with the saved link. React shows it as text.
		key,
		url,
		title: displayText(title.trim(), TITLE_LIMIT),
		status: { name: displayText(status.name.trim(), STATUS_LIMIT), category: status.category },
		assignee: name === "" ? null : name,
	};
}

/**
 * Read what one run of `timber __app-issue -- <worktree>` printed.
 * `exitCode` is the exit code of that process, or null when it did not exit
 * by itself. `worktree` is the path that was asked about.
 *
 * Timber exits with 0 for found or none and with 1 for failed, printing its
 * record either way. An answer is accepted only when it is one version 1
 * record whose outcome, fields, and exit code agree, and which is about the
 * worktree that was asked about. Anything else is a failure with a message
 * for the person, never a guess.
 */
export function readIssueRecord(stdout: string, stderr: string, exitCode: number | null, worktree: string): IssueLookup {
	const ending = describeExit(exitCode);
	const explained = () => failed(describeFailedRun(APP_ISSUE_COMMAND, stderr, exitCode));
	if (exitCode !== 0 && exitCode !== 1) return explained();

	const envelope = readEnvelope(stdout, APP_ISSUE_COMMAND, SUPPORTED_APP_ISSUE_SCHEMA_VERSION);
	if (!envelope.ok) {
		// An older Timber without the command prints nothing and says so on standard error.
		if (envelope.problem === "not-json" && exitCode !== 0) return explained();
		return envelope.problem === "version" ? failed(envelope.message) : unreadable(envelope.detail);
	}
	const { record } = envelope;

	// The worktree is null only when nothing matched, which is a failure. Otherwise it must be the one asked about.
	const named = record.worktree;
	if (named !== null && (!isFields(named) || named.path !== worktree)) return unreadable("it is about another worktree");

	const { outcome, issue, reason, diagnostic } = record;
	if (outcome === "found" || outcome === "none") {
		if (exitCode !== 0) return unreadable(`it ${ending}, which does not match its outcome`);
		if (named === null || reason !== null || diagnostic !== null) return unreadable("its fields do not match its outcome");
		if (outcome === "none") return issue === null ? { ok: true, outcome } : unreadable("its fields do not match its outcome");
		const read = readIssueValue(issue);
		return read === null ? unreadable("its issue is not one this app can read") : { ok: true, outcome, issue: read };
	}
	if (outcome === "failed") {
		if (exitCode !== 1) return unreadable(`it ${ending}, which does not match its outcome`);
		if (issue !== null || !oneOf(REASONS, reason) || typeof diagnostic !== "string") return unreadable("its fields do not match its outcome");
		const text = diagnostic.trim() === "" ? "Timber did not say why." : displayText(diagnostic.trim(), DIAGNOSTIC_LIMIT);
		return { ok: true, outcome, reason, diagnostic: text };
	}
	return unreadable("its outcome is not one this app knows");
}
