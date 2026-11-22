import { ISSUE_LISTS, type IssueList, type IssueListResult, isSprintList, listOf, togglesOf } from "../../shared/issue-lists";
import type { IssueTrackers } from "../../shared/issue-trackers";
import type { IssueTracker } from "../../shared/model";
import { boardTracker, shownList } from "../issue-board-format";

/**
 * The issues board of one repository, as the store holds it, and what it
 * shows. Pure. Lists are read only when the board opens, when another list or
 * tracker is picked, and on Refresh: never on a timer.
 *
 * Every answer is kept by tracker and list, so an answer that comes back
 * after the person moved on lands where it belongs and never on another list.
 */

/** One answer, and when it came. */
export interface BoardRead {
	result: IssueListResult;
	at: number;
}

/** A list Timber read: found, or none. */
export type GoodRead = BoardRead & { result: Extract<IssueListResult, { ok: true; outcome: "found" | "none" }> };

export interface IssueBoard {
	/** The trackers the repository has set up, as last read. Undefined until the first read answered. */
	trackers: IssueTrackers | undefined;
	/** The tracker picked in the board's Tracker field, for this run. Null follows Timber's default. */
	picked: IssueTracker | null;
	/** The latest answer of each list, by `boardKey`. */
	latest: Readonly<Record<string, BoardRead>>;
	/** The latest answer that listed something (found or none), by `boardKey`. A failed read keeps it on screen. */
	good: Readonly<Record<string, GoodRead>>;
	/** The lists being read now, by `boardKey`. */
	reading: readonly string[];
}

export const emptyBoard = (): IssueBoard => ({ trackers: undefined, picked: null, latest: {}, good: {}, reading: [] });

export const boardKey = (tracker: IssueTracker, list: IssueList) => `${tracker} ${list}`;

const isGood = (read: BoardRead): read is GoodRead => read.result.ok && (read.result.outcome === "found" || read.result.outcome === "none");

const notConfigured = (read: BoardRead | undefined) => read !== undefined && read.result.ok && read.result.outcome === "failed" && read.result.reason === "not-configured";

/**
 * The lists of a tracker that Timber said are not set up. `sprint` and
 * `my-sprint` need the same setting, so they are one family: both are not
 * set up when the newer answer of the two says so.
 */
export function hiddenLists(board: IssueBoard, tracker: IssueTracker): IssueList[] {
	const sprint = board.latest[boardKey(tracker, "sprint")];
	const mine = board.latest[boardKey(tracker, "my-sprint")];
	const newer = sprint === undefined ? mine : mine === undefined || sprint.at >= mine.at ? sprint : mine;
	const sprintHidden = notConfigured(newer);
	return ISSUE_LISTS.filter(list => isSprintList(list) ? sprintHidden : notConfigured(board.latest[boardKey(tracker, list)]));
}

/** Timber's words on what sets up a list that is not set up: for the sprint, those of the newer answer of the two sprint lists. */
export function hiddenDiagnostic(board: IssueBoard, tracker: IssueTracker, list: IssueList): string {
	const reads = (isSprintList(list) ? (["sprint", "my-sprint"] as const) : [list]).map(one => board.latest[boardKey(tracker, one)]).filter(read => read !== undefined && notConfigured(read));
	const newest = reads.sort((one, other) => other!.at - one!.at)[0]?.result;
	return newest?.ok && newest.outcome === "failed" ? newest.diagnostic : "";
}

/** One toggle as the board shows it: on or off, and, when it cannot be flipped, the list that is not set up in the way. */
export interface BoardToggle {
	on: boolean;
	/** The list flipping it would show, when that list is not set up. Null when it can be flipped. */
	blockedBy: IssueList | null;
}

/** The board's two toggles over the list shown, or over the remembered one when no list is set up. */
export function boardToggles(list: IssueList, hidden: readonly IssueList[]): { sprint: BoardToggle; assigned: BoardToggle } {
	const toggles = togglesOf(list);
	const toggle = (flipped: IssueList, on: boolean): BoardToggle => ({ on, blockedBy: hidden.includes(flipped) ? flipped : null });
	return {
		sprint: toggle(listOf({ ...toggles, sprint: !toggles.sprint }), toggles.sprint),
		assigned: toggle(listOf({ ...toggles, assigned: !toggles.assigned }), toggles.assigned),
	};
}

/** What the board shows now. */
export interface BoardView {
	/** Null when no tracker is set up, or while the trackers are read for the first time. */
	tracker: IssueTracker | null;
	/** The list shown, or null when none is set up for the tracker. */
	list: IssueList | null;
	/** The lists the picker leaves out, because they are not set up. */
	hidden: IssueList[];
	/** The latest answer of the list shown, when there is one. */
	latest: BoardRead | null;
	/** The latest answer of the list shown that listed something, kept on screen when a later read failed. */
	good: GoodRead | null;
	/** Whether the list shown, or the trackers, are being read. */
	reading: boolean;
}

export function boardView(board: IssueBoard, remembered: IssueList | undefined): BoardView {
	const tracker = boardTracker(board.trackers, board.picked);
	if (tracker === null) return { tracker, list: null, hidden: [], latest: null, good: null, reading: board.reading.includes("trackers") };
	const hidden = hiddenLists(board, tracker);
	const list = shownList(remembered, hidden);
	if (list === null) {
		// Every list is not set up: the latest of the remembered one says why.
		const latest = board.latest[boardKey(tracker, remembered ?? "sprint")] ?? null;
		return { tracker, list, hidden, latest, good: null, reading: board.reading.length > 0 };
	}
	const key = boardKey(tracker, list);
	return {
		tracker, list, hidden,
		latest: board.latest[key] ?? null,
		good: board.good[key] ?? null,
		reading: board.reading.includes(key) || board.reading.includes("trackers"),
	};
}

/** The board with one answer kept. A failure leaves the last good answer as it was. */
export function withRead(board: IssueBoard, key: string, read: BoardRead): IssueBoard {
	return {
		...board,
		latest: { ...board.latest, [key]: read },
		good: isGood(read) ? { ...board.good, [key]: read } : board.good,
		reading: board.reading.filter(other => other !== key),
	};
}

/** The board with a read of `key` started. */
export function withReading(board: IssueBoard, key: string): IssueBoard {
	return board.reading.includes(key) ? board : { ...board, reading: [...board.reading, key] };
}

/**
 * The lists a Refresh, or opening the board, reads: the one shown, and each
 * one hidden as not set up, so a list set up since shows again. Asking
 * Timber about a list that is still not set up contacts nothing. A sprint
 * that is not set up is asked about once, as `sprint`, never as
 * `my-sprint` too, which a Timber without `--assigned` reads in two runs.
 */
export function listsToRead(board: IssueBoard, remembered: IssueList | undefined): IssueList[] {
	const view = boardView(board, remembered);
	if (view.tracker === null) return [];
	const lists = view.list === null ? [] : [view.list];
	for (const list of view.hidden) if (list !== "my-sprint" && !lists.includes(list)) lists.push(list);
	return lists;
}
