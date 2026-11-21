import { type IssueList, type IssueListFailureReason, LIST_LIMIT, type Sprint, type SprintSource } from "../shared/issue-lists";
import type { SuggestedIssue } from "../shared/issue-search";
import type { IssueTrackers } from "../shared/issue-trackers";
import type { IssueStatusCategory } from "../shared/issues";
import type { IssueTracker } from "../shared/model";
import { TRACKER_NAMES } from "./issue-format";

/**
 * The words and the shape of the issues board. Pure. The board shows only
 * what Timber listed: the tracker's own status names, the sprint's name, and
 * each issue's assignee. A failure is said quietly, in a word and a line,
 * never as a dialog or a prompt to sign in.
 */

export const ISSUES_ROW_LABEL = "Issues";

export const LIST_LABELS: Record<IssueList, string> = { sprint: "Current sprint", assigned: "Assigned to me", open: "Open issues" };

/** The board's columns, by the tracker's grouping of each status. */
export type BoardColumnId = "open" | "in-progress" | "done";

const COLUMN_ORDER: readonly BoardColumnId[] = ["open", "in-progress", "done"];
const COLUMN_LABELS: Record<BoardColumnId, string> = { "open": "Open", "in-progress": "In progress", "done": "Done" };
const COLUMN_OF: Record<IssueStatusCategory, BoardColumnId> = { "open": "open", "in-progress": "in-progress", "closed": "done" };

export interface BoardColumn {
	id: BoardColumnId;
	label: string;
	/** The tracker's own status names in this column, in the order the list first has them. */
	statuses: string[];
	issues: SuggestedIssue[];
}

/**
 * The columns of one list. GitHub issues are only open or closed, so a
 * GitHub board has no In progress column. Assigned to me and Open issues hold
 * only issues that are not done, so they have no Done column. An issue whose
 * status falls outside those columns still gets its column: nothing Timber
 * listed is ever left out.
 */
export function boardColumns(issues: readonly SuggestedIssue[], list: IssueList, tracker: IssueTracker): BoardColumn[] {
	const wanted = new Set<BoardColumnId>(COLUMN_ORDER.filter(id => !(id === "in-progress" && tracker === "github") && !(id === "done" && list !== "sprint")));
	for (const issue of issues) wanted.add(COLUMN_OF[issue.status.category]);
	const columns = COLUMN_ORDER.filter(id => wanted.has(id)).map((id): BoardColumn => ({ id, label: COLUMN_LABELS[id], statuses: [], issues: [] }));
	for (const issue of issues) {
		const column = columns.find(candidate => candidate.id === COLUMN_OF[issue.status.category])!;
		column.issues.push(issue);
		if (issue.status.name !== "" && !column.statuses.includes(issue.status.name)) column.statuses.push(issue.status.name);
	}
	return columns;
}

const SOURCE_WORDS: Record<SprintSource, string> = {
	"jira-board": "Jira board",
	"jira-jql": "saved Jira query",
	"github-iteration": "GitHub project iteration",
	"github-milestone": "GitHub milestone",
	"linear-cycle": "Linear cycle",
};

const count = (issues: number, truncated: boolean) => `${issues}${truncated ? "+" : ""} ${issues === 1 && !truncated ? "issue" : "issues"}`;

/** The line under the board's title, such as "Sprint 42, Jira board, 12 issues". */
export function describeListSummary(list: IssueList, tracker: IssueTracker, sprint: Sprint | null, issues: number, truncated: boolean): string {
	if (list === "sprint" && sprint !== null) {
		const name = sprint.name === null ? `The ${SOURCE_WORDS[sprint.source]}` : `${sprint.name}, ${SOURCE_WORDS[sprint.source]}`;
		return `${name}, ${count(issues, truncated)}`;
	}
	return `${LIST_LABELS[list]} in ${TRACKER_NAMES[tracker]}, ${count(issues, truncated)}`;
}

/** The short label beside the sidebar's Issues row: the sprint's name, once a read found one. */
export function sprintLabel(sprint: Sprint | null): string | null {
	return sprint?.name ?? null;
}

/** The line at the end of a list the tracker cut off. */
export function describeTruncated(list: IssueList, tracker: IssueTracker): string {
	return list === "sprint"
		? `${TRACKER_NAMES[tracker]} has more issues in this sprint than Timber lists.`
		: `The first ${LIST_LIMIT} are shown. ${TRACKER_NAMES[tracker]} has more.`;
}

/** The line for a list with nothing in it. */
export function describeEmptyList(list: IssueList, tracker: IssueTracker): { title: string; text: string } {
	if (list === "sprint") return { title: "Nothing in the current sprint", text: `The sprint has no issues in ${TRACKER_NAMES[tracker]}.` };
	if (list === "assigned") return { title: "Nothing assigned to you", text: `Open ${TRACKER_NAMES[tracker]} issues assigned to you show here.` };
	return { title: "No open issues", text: `Open ${TRACKER_NAMES[tracker]} issues show here, newest first.` };
}

export const NO_CURRENT_SPRINT = { title: "No current sprint", text: "The sprint is set up, and nothing is running in it right now." };

/** The quiet word for a list that could not be read, beside the board's title, and the line for when nothing was read before. */
export function describeListFailure(reason: IssueListFailureReason, tracker: IssueTracker): { word: string; title: string; text: string; command: string | null } {
	const name = TRACKER_NAMES[tracker];
	switch (reason) {
		case "offline": return { word: "offline", title: `Could not reach ${name}.`, text: "Check the connection, then Refresh.", command: null };
		case "sign-in-needed": return { word: "sign-in needed", title: `Timber has no login for ${name}.`, text: "Sign in through Timber, then Refresh.", command: "timber setup" };
		case "not-found": return { word: "not found", title: `Timber cannot find what this list reads in ${name}.`, text: "Check the board, project, milestone, or team in Timber's settings.", command: null };
		case "forbidden": return { word: "no access", title: `Timber's ${name} login may not read this list.`, text: "Timber's reason is below.", command: null };
		case "not-configured": return { word: "not set up", title: `This list is not set up for ${name}.`, text: "Timber's reason is below.", command: null };
		case "failed": return { word: "not read", title: `Timber could not read this list from ${name}.`, text: "Timber's reason is below.", command: null };
	}
}

/**
 * The hint under the picker for one list that is not set up, with Timber's
 * own words on which setting adds it. The app does not guess the setting:
 * Timber knows what each list of each tracker needs.
 */
export function describeHiddenList(list: IssueList, tracker: IssueTracker, diagnostic: string): string {
	return `${LIST_LABELS[list]} is not set up for ${TRACKER_NAMES[tracker]}. ${diagnostic}`;
}

/**
 * The list the board shows: the one remembered for the repository, unless
 * it is not set up, then the first that is, in the picker's order. Null when
 * no list is set up. The remembered pick is kept, so a list that is set up
 * again later shows again.
 */
export function shownList(remembered: IssueList | undefined, hidden: readonly IssueList[]): IssueList | null {
	const order: IssueList[] = remembered === undefined ? ["sprint", "assigned", "open"] : [remembered, "sprint", "assigned", "open"];
	return order.find(list => !hidden.includes(list)) ?? null;
}

/** The tracker the board reads: the one picked on the board when it is still set up, else Timber's default, else the first set up. */
export function boardTracker(trackers: IssueTrackers | undefined, picked: IssueTracker | null): IssueTracker | null {
	if (trackers === undefined || !trackers.ok) return null;
	if (picked !== null && trackers.available.includes(picked)) return picked;
	if (trackers.defaultTracker !== null) return trackers.defaultTracker;
	return trackers.available[0] ?? null;
}

/** The trackers the board's Tracker field offers: none unless two or more are set up. */
export function boardTrackerChoices(trackers: IssueTrackers | undefined): IssueTracker[] {
	return trackers?.ok && trackers.available.length >= 2 ? trackers.available : [];
}

/** The words of one of the Tracker field's options. Timber's default says so. */
export function boardTrackerOption(trackers: IssueTrackers | undefined, tracker: IssueTracker): string {
	return trackers?.ok && trackers.defaultTracker === tracker ? `${TRACKER_NAMES[tracker]} (default)` : TRACKER_NAMES[tracker];
}

export const NO_TRACKER = {
	title: "No issue tracker is set up",
	text: "Timber reads GitHub issues through a GitHub remote, and Jira or Linear issues once it has a login. Set one up with timber setup, then Refresh.",
};

/** The quiet word for when the latest read ended in a failure that is not a tracker's reason, such as a Timber that could not be run. */
export const LIST_NOT_READ = "not read";
