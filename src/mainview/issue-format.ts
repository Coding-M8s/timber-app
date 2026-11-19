import type { Issue, IssueFailureReason, IssueStatusCategory } from "../shared/issues";
import type { IssueLink, IssueTracker } from "../shared/model";
import type { IssueEntry } from "./store/state";

/**
 * The words for the issue a worktree belongs to. Pure. They say only what
 * Timber reported: the key and address from the saved link, and the title
 * and status from the tracker when Timber could read them. A failure is said
 * quietly, in a word and a tooltip, never as a dialog or a prompt to sign in.
 */

export interface IssueDescription {
	/** The short form, for the workspace header and the row's tooltip, such as "PROJ-123 · In Review". */
	text: string;
	/** Whole sentences in plain words, for a tooltip. */
	sentence: string;
	/** The saved `https` address of the issue, or null when the link cannot be used. */
	url: string | null;
	/** The tooltip of a control that opens the issue, or null when there is nothing to open. */
	openTitle: string | null;
	/** The tracker's grouping of the status, for color only. Null until it is known. */
	category: IssueStatusCategory | null;
	/** A quiet word on why the status is not shown, such as "offline". Null when nothing went wrong. */
	problem: string | null;
	/** True when saved metadata exists and cannot be used, so the issue is not known. */
	warning: boolean;
	/** The issue as the tracker answered, when it did. */
	issue: Issue | null;
}

export const TRACKER_NAMES: Record<IssueTracker, string> = { github: "GitHub", jira: "Jira", linear: "Linear" };

/** The short marker for link metadata Timber cannot use. */
export const ISSUE_UNKNOWN = "Issue unknown";

const PROBLEM_WORDS: Record<IssueFailureReason, string> = {
	"offline": "offline",
	"sign-in-needed": "sign-in needed",
	"not-found": "issue not found",
	"forbidden": "no access",
	"failed": "issue not read",
};

const LINK_PROBLEMS: Record<"malformed" | "stale" | "unreadable", string> = {
	malformed: "it is not in the form Timber expects",
	stale: "it does not match this worktree, or Timber could not verify the worktree",
	unreadable: "it could not be read",
};

/** How a key is written: a GitHub issue by its number after "#", a Jira or Linear issue by its key. */
export function issueKeyLabel(tracker: IssueTracker, key: string): string {
	return tracker === "github" ? `#${key}` : key;
}

/** The words for opening an issue in the browser, as a control's tooltip. */
export function describeOpenIssue(tracker: IssueTracker, key: string): string {
	return `Open ${TRACKER_NAMES[tracker]} issue ${issueKeyLabel(tracker, key)} in the browser`;
}

/**
 * What to show for a worktree's issue, or null for nothing: no link saved,
 * or a Timber from before the field. `entry` is the store's last answer for
 * the worktree; an answer for another link than the one saved now is not used.
 */
export function describeIssue(link: IssueLink | null, entry: IssueEntry | undefined): IssueDescription | null {
	if (link === null || link.kind === "none") return null;
	if (link.kind === "invalid") {
		return {
			text: ISSUE_UNKNOWN,
			sentence: `Timber found a saved issue link for this worktree but cannot use it: ${LINK_PROBLEMS[link.reason]}. The issue is not known, and the app does not guess one.`,
			url: null,
			openTitle: null,
			category: null,
			problem: null,
			warning: true,
			issue: null,
		};
	}
	const { tracker, key, url } = link;
	const label = issueKeyLabel(tracker, key);
	const named = `${TRACKER_NAMES[tracker]} issue ${label}`;
	const base = { text: label, url, openTitle: describeOpenIssue(tracker, key), category: null, problem: null, warning: false, issue: null };
	const lookup = entry && entry.tracker === tracker && entry.key === key ? entry.lookup : undefined;
	if (lookup === undefined) return { ...base, sentence: `${named}. Its status has not been read yet.` };
	if (!lookup.ok) return { ...base, problem: PROBLEM_WORDS.failed, sentence: `${named}. Its status could not be read: ${lookup.message}` };
	switch (lookup.outcome) {
		case "found": {
			const { issue } = lookup;
			const assignee = issue.assignee === null ? "Unassigned." : `Assigned to ${issue.assignee}.`;
			return {
				...base,
				text: `${label} · ${issue.status.name}`,
				sentence: `${named}: ${sentenceOf(issue.title)} Status: ${issue.status.name}. ${assignee}`,
				category: issue.status.category,
				issue,
			};
		}
		case "none":
			// Timber read no link, though the list showed one: the list is older than the answer.
			return { ...base, sentence: `${named}. Timber found no saved link when it looked again; the list will catch up.` };
		case "failed":
			return { ...base, problem: PROBLEM_WORDS[lookup.reason], sentence: `${named}. Timber could not read its status: ${lookup.diagnostic}` };
	}
}

/** Text as a sentence: a full stop added unless it already ends like one. */
function sentenceOf(text: string): string {
	return /[.?!…]$/.test(text) ? text : `${text}.`;
}

/** The short form for a row's tooltip: the text, and the quiet reason after it when there is one. */
export function issueTitlePart(description: IssueDescription): string {
	return description.problem === null ? description.text : `${description.text}, ${description.problem}`;
}
