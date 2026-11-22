import { type IssueList, type IssueListFailureReason, LIST_LIMIT, type Sprint, type SprintSource, isSprintList } from "../shared/issue-lists";
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

export const LIST_LABELS: Record<IssueList, string> = { "sprint": "Current sprint", "assigned": "Assigned to me", "open": "Open issues", "my-sprint": "My issues in the current sprint" };

/** The board's two toggles, in the order they show. */
export const TOGGLE_LABELS = { sprint: "Current sprint", assigned: "Assigned to me" } as const;

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
 * GitHub board has no In progress column. Only a sprint list has a Done
 * column: Assigned to me alone and Open issues hold only issues that are
 * not done. An issue whose
 * status falls outside those columns still gets its column: nothing Timber
 * listed is ever left out.
 */
export function boardColumns(issues: readonly SuggestedIssue[], list: IssueList, tracker: IssueTracker): BoardColumn[] {
	const wanted = new Set<BoardColumnId>(COLUMN_ORDER.filter(id => !(id === "in-progress" && tracker === "github") && !(id === "done" && !isSprintList(list))));
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

/**
 * The line under the board's title, such as "Sprint 42, Jira board, 12
 * issues", or "Sprint 42, Jira board, assigned to you, 3 issues" with both
 * toggles on. `partial` adds that the list may be incomplete.
 */
export function describeListSummary(list: IssueList, tracker: IssueTracker, sprint: Sprint | null, issues: number, truncated: boolean, partial = false): string {
	const mine = list === "my-sprint" ? ", assigned to you" : "";
	const incomplete = partial ? ", may be incomplete" : "";
	if (isSprintList(list) && sprint !== null) {
		const name = sprint.name === null ? `The ${SOURCE_WORDS[sprint.source]}` : `${sprint.name}, ${SOURCE_WORDS[sprint.source]}`;
		return `${name}${mine}, ${count(issues, truncated)}${incomplete}`;
	}
	return `${LIST_LABELS[list]} in ${TRACKER_NAMES[tracker]}, ${count(issues, truncated)}${incomplete}`;
}

/** The line for my issues in the sprint from a Timber without `sprint --assigned`, which the app joined from two lists. */
export function describePartial(tracker: IssueTracker): string {
	const others = tracker === "github" ? ", issues of other repositories in the project," : "";
	return `This Timber cannot list only your issues in the sprint, so these are the sprint's issues among the first ${LIST_LIMIT} open issues assigned to you. Done issues${others} and any past those ${LIST_LIMIT} may be missing. A Timber built from its main branch lists them all.`;
}

/** The short label beside the sidebar's Issues row: the sprint's name, once a read found one. */
export function sprintLabel(sprint: Sprint | null): string | null {
	return sprint?.name ?? null;
}

/** The line at the end of a list the tracker cut off. */
export function describeTruncated(list: IssueList, tracker: IssueTracker): string {
	return isSprintList(list)
		? `${TRACKER_NAMES[tracker]} has more issues in this sprint than Timber lists.`
		: `The first ${LIST_LIMIT} are shown. ${TRACKER_NAMES[tracker]} has more.`;
}

/** The line for a list with nothing in it. */
export function describeEmptyList(list: IssueList, tracker: IssueTracker): { title: string; text: string } {
	if (list === "sprint") return { title: "Nothing in the current sprint", text: `The sprint has no issues in ${TRACKER_NAMES[tracker]}.` };
	if (list === "my-sprint") return { title: "Nothing assigned to you in the current sprint", text: `Your ${TRACKER_NAMES[tracker]} issues in the sprint show here, in every status.` };
	if (list === "assigned") return { title: "Nothing assigned to you", text: `Open ${TRACKER_NAMES[tracker]} issues assigned to you show here.` };
	return { title: "No open issues", text: `Open ${TRACKER_NAMES[tracker]} issues show here, newest first.` };
}

/** The button that opens Settings at the repository's Issue tracking, where the default tracker, the Jira site, the sprint, project, milestone, and team, and the Jira and Linear logins are set. */
export const OPEN_TRACKING_SETTINGS = "Open Issue tracking settings";

/** Where Issue tracking is, in words, for text that points there. */
export const TRACKING_SETTINGS_PLACE = "Settings, Repository, Issue tracking";

/**
 * Whether a list that failed for this reason offers Issue tracking
 * settings: one not set up, one whose board, project, milestone, or team
 * Timber cannot find, and one with no usable login, which is saved or
 * replaced there for Jira and Linear, and tested there for GitHub.
 */
export function offersTrackingSettings(reason: IssueListFailureReason): boolean {
	return reason === "not-configured" || reason === "not-found" || reason === "sign-in-needed";
}

/**
 * The line for a tracker with no usable login, and the command to run in a
 * terminal when Settings cannot sign in: Jira and Linear logins are saved
 * in Settings, and saving there reads the board again; a GitHub login comes
 * from the GitHub CLI, which Settings can only test. For Jira, Timber says
 * the same when no site is set. Saving in Settings reads an open board
 * again, but a test of the login saves nothing, so each ends with Refresh.
 */
function signInNeeded(tracker: IssueTracker): { text: string; command: string | null } {
	if (tracker === "github") return { text: `${TRACKING_SETTINGS_PLACE} can test the GitHub login. To sign in, run gh auth login in a terminal, or set GH_TOKEN, then Refresh.`, command: "gh auth login" };
	if (tracker === "jira") return { text: `Check the Jira site and its login in ${TRACKING_SETTINGS_PLACE}, then Refresh.`, command: null };
	return { text: `Check or replace the Linear key in ${TRACKING_SETTINGS_PLACE}, then Refresh.`, command: null };
}

export const NO_CURRENT_SPRINT = { title: "No current sprint", text: "The sprint is set up, and nothing is running in it right now." };

/** The quiet word for a list that could not be read, beside the board's title, and the line for when nothing was read before. */
export function describeListFailure(reason: IssueListFailureReason, tracker: IssueTracker): { word: string; title: string; text: string; command: string | null } {
	const name = TRACKER_NAMES[tracker];
	switch (reason) {
		case "offline": return { word: "offline", title: `Could not reach ${name}.`, text: "Check the connection, then Refresh.", command: null };
		case "sign-in-needed": return { word: "sign-in needed", title: tracker === "jira" ? "Timber has no usable Jira site or login." : `Timber has no usable login for ${name}.`, ...signInNeeded(tracker) };
		case "not-found": return { word: "not found", title: `Timber cannot find what this list reads in ${name}.`, text: "Check the board, project, milestone, or team in Timber's settings.", command: null };
		case "forbidden": return { word: "no access", title: `Timber's ${name} login may not read this list.`, text: "Timber's reason is below.", command: null };
		case "not-configured": return { word: "not set up", title: `This list is not set up for ${name}.`, text: "Timber's reason is below.", command: null };
		case "failed": return { word: "not read", title: `Timber could not read this list from ${name}.`, text: "Timber's reason is below.", command: null };
	}
}

/**
 * The hint under the toggles for one list that is not set up, with Timber's
 * own words on which setting adds it. The app does not guess the setting:
 * Timber knows what each list of each tracker needs. The sprint's hint
 * stands for both sprint lists.
 */
export function describeHiddenList(list: IssueList, tracker: IssueTracker, diagnostic: string): string {
	const label = isSprintList(list) ? LIST_LABELS.sprint : LIST_LABELS[list];
	return `${label} is not set up for ${TRACKER_NAMES[tracker]}. ${diagnostic}`.trim();
}

/** Why a toggle cannot be flipped: flipping it would show a list that is not set up. */
export function describeBlockedToggle(on: boolean, blockedBy: IssueList, tracker: IssueTracker): string {
	const name = TRACKER_NAMES[tracker];
	if (isSprintList(blockedBy)) return `${LIST_LABELS.sprint} is not set up for ${name}.`;
	return `Turning this ${on ? "off" : "on"} shows ${LIST_LABELS[blockedBy]}, which is not set up for ${name}.`;
}

/**
 * The list the board shows: the one remembered for the repository, unless
 * it is not set up, then the first that is, in the order Current sprint,
 * Assigned to me, Open issues, both. Null when no list is set up. The
 * remembered toggles are kept, so a list that is set up again later shows
 * again.
 */
export function shownList(remembered: IssueList | undefined, hidden: readonly IssueList[]): IssueList | null {
	const fallbacks: IssueList[] = ["sprint", "assigned", "open", "my-sprint"];
	const order: IssueList[] = remembered === undefined ? fallbacks : [remembered, ...fallbacks];
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
	text: `Set up Jira or Linear in ${TRACKING_SETTINGS_PLACE}: a Jira site and its login, or a Linear key. GitHub issues need a github.com remote on this repository. Then Refresh.`,
};

/** The quiet word for when the latest read ended in a failure that is not a tracker's reason, such as a Timber that could not be run. */
export const LIST_NOT_READ = "not read";
