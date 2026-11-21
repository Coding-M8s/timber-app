import type { IssueTrackers } from "../../../shared/issue-trackers";
import { type IssueSearchRequest, type IssueSearchResult, SEARCH_TEXT_LIMIT, type SuggestedIssue } from "../../../shared/issue-search";
import type { IssueTracker } from "../../../shared/model";
import { TRACKER_NAMES } from "../../issue-format";
import { chosenTracker } from "./tracker-choice";

/**
 * Issue suggestions under the New worktree dialog's Name field, without
 * markup. Plain code and one small holder of state, so all of it is tested
 * without a window, with a clock the test moves.
 *
 * Typing never waits for a search: the Name changes at once, and the list
 * follows when Timber answers. A search starts only once typing has paused
 * (`SUGGEST_DEBOUNCE_MS`), at most one runs at a time, and only the latest
 * text waits behind it. Answers are kept for the dialog's life, so typing
 * back to an earlier text shows its list at once. An answer for text that is
 * no longer in the field is kept but never shown, so an older answer never
 * replaces a newer one.
 */

/** How long typing must pause before a search starts. */
export const SUGGEST_DEBOUNCE_MS = 250;

/** Run `task` after `milliseconds`. Returns a function that calls it off. */
export type Schedule = (task: () => void, milliseconds: number) => () => void;

const realSchedule: Schedule = (task, milliseconds) => {
	const timer = setTimeout(task, milliseconds);
	return () => clearTimeout(timer);
};

export interface SuggestionsState {
	/** The issues on screen, for `text`. Empty when there is no list. */
	issues: SuggestedIssue[];
	/** Whether the list shows. Escape closes it until the Name changes. */
	open: boolean;
	/** The position of the highlighted issue, or -1 for none. Nothing is highlighted until an arrow key moves there, so Enter on typed text still creates. */
	highlighted: number;
	/** A search for the text in the field is waiting or running. */
	searching: boolean;
	/** A quiet line about why there are no suggestions, or null. */
	hint: string | null;
}

export interface IssueSuggestions {
	getState(): SuggestionsState;
	subscribe(listener: () => void): () => void;
	/** The Name or the tracker changed. Never waits. */
	type(name: string, tracker: IssueTracker | null): void;
	/**
	 * A key pressed in the Name field. Returns the issue Enter picked, true
	 * for a key the list used, or false for a key it left alone (so Enter
	 * with nothing highlighted still submits, and Escape with no list still
	 * closes the dialog).
	 */
	key(key: string): SuggestedIssue | boolean;
	/** Name lost the keyboard: the list closes, so it never covers the fields below. An arrow key opens it again. */
	blur(): void;
	/** The Name a pick fills in: `github:42` or `jira:ENG-42`. Closes the list. */
	pick(issue: SuggestedIssue): string;
	/**
	 * Stop while the dialog is gone: the waiting search never starts, and the
	 * running one's answer is kept but not shown. Typing again starts over.
	 */
	pause(): void;
}

/** What searches and when. Only the search is needed; tests pass their own clock. */
export interface SuggestionsOptions {
	search: (request: IssueSearchRequest) => Promise<IssueSearchResult>;
	repository: string;
	schedule?: Schedule;
	debounceMs?: number;
}

/**
 * The tracker suggestions come from: the one picked in the Tracker field,
 * else Timber's default tracker, else the only tracker set up. Null while
 * the trackers are read, or when none applies.
 */
export function suggestionTracker(options: IssueTrackers | undefined, pick: IssueTracker | null): IssueTracker | null {
	if (!options?.ok) return null;
	const chosen = chosenTracker(options, pick);
	if (chosen !== null) return chosen;
	if (options.defaultTracker !== null) return options.defaultTracker;
	return options.available.length === 1 ? options.available[0]! : null;
}

/** The text to search for a Name, or null when the Name is not something to search: empty, too long, or already naming a tracker. */
export function searchText(name: string): string | null {
	const text = name.trim();
	if (text === "" || Array.from(text).length > SEARCH_TEXT_LIMIT) return null;
	if (/^(github|jira|linear):/i.test(text)) return null;
	return text;
}

/** The Name a picked issue fills in. Timber still decides the branch. */
export function pickedName(issue: Pick<SuggestedIssue, "tracker" | "key">): string {
	return `${issue.tracker}:${issue.key}`;
}

/** The quiet line for a search that found nothing to show. Null for an answer that is a list. */
export function suggestionHint(tracker: IssueTracker, result: IssueSearchResult): string | null {
	const name = TRACKER_NAMES[tracker];
	if (!result.ok) return result.unsupported ? "Issue suggestions need a Timber built from its main branch." : `No suggestions: could not search ${name}.`;
	if (result.outcome === "found") return null;
	switch (result.reason) {
		case "offline": return `No suggestions: ${name} could not be reached.`;
		case "sign-in-needed": return `No suggestions: ${name} needs a sign-in. Run timber setup.`;
		case "not-configured": return `No suggestions: ${name} is not set up for searching.`;
		case "not-found":
		case "forbidden": return `No suggestions: this ${name} login cannot search these issues.`;
		case "failed": return `No suggestions: ${name} did not answer the search.`;
	}
}

/** Whether a failure will not change while the dialog is open, so the tracker is not asked again. */
function lasting(result: IssueSearchResult): boolean {
	if (!result.ok) return result.unsupported;
	return result.outcome === "failed" && (result.reason === "sign-in-needed" || result.reason === "not-configured" || result.reason === "not-found" || result.reason === "forbidden");
}

const EMPTY: SuggestionsState = { issues: [], open: false, highlighted: -1, searching: false, hint: null };

export function createIssueSuggestions(options: SuggestionsOptions): IssueSuggestions {
	const { search, repository, schedule = realSchedule, debounceMs = SUGGEST_DEBOUNCE_MS } = options;
	const listeners = new Set<() => void>();
	/** Answers by tracker and text, for the dialog's life. Only lists are kept, so a passing failure is asked again. */
	const answers = new Map<string, Extract<IssueSearchResult, { ok: true; outcome: "found" }>>();
	/** A failure that will not change, by tracker, or under "*" for a Timber without the command. */
	const stopped = new Map<string, string>();
	let state: SuggestionsState = EMPTY;
	/** What the field asks for now, or null for nothing. */
	let wanted: { tracker: IssueTracker; text: string } | null = null;
	let cancelWait: (() => void) | null = null;
	let running = false;
	/** The latest text waiting for the running search to end. */
	let queued: { tracker: IssueTracker; text: string } | null = null;

	const keyOf = (query: { tracker: IssueTracker; text: string }) => `${query.tracker}\n${query.text}`;
	const isWanted = (query: { tracker: IssueTracker; text: string }) => wanted !== null && keyOf(wanted) === keyOf(query);

	function update(change: Partial<SuggestionsState>): void {
		state = { ...state, ...change };
		for (const listener of [...listeners]) listener();
	}

	/** Show what is known for the wanted text: a kept list, a lasting failure, or wait for a search. */
	function show(): boolean {
		if (wanted === null) return true;
		const reason = stopped.get("*") ?? stopped.get(wanted.tracker);
		if (reason !== undefined) {
			update({ ...EMPTY, hint: reason });
			return true;
		}
		const kept = answers.get(keyOf(wanted));
		if (kept) {
			update({ issues: kept.issues, open: kept.issues.length > 0, highlighted: -1, searching: false, hint: null });
			return true;
		}
		return false;
	}

	async function run(query: { tracker: IssueTracker; text: string }): Promise<void> {
		running = true;
		let result: IssueSearchResult;
		try {
			result = await search({ repository, ...query });
		} catch {
			result = { ok: false, unsupported: false, message: "The search did not answer." };
		}
		running = false;
		if (result.ok && result.outcome === "found") answers.set(keyOf(query), result);
		else if (lasting(result)) stopped.set(!result.ok ? "*" : query.tracker, suggestionHint(query.tracker, result)!);
		if (isWanted(query)) {
			if (!show()) update({ ...EMPTY, hint: suggestionHint(query.tracker, result) });
		}
		const next = queued;
		queued = null;
		if (next !== null && isWanted(next) && !show()) void run(next);
	}

	function start(query: { tracker: IssueTracker; text: string }): void {
		cancelWait = null;
		if (!isWanted(query) || show()) return;
		if (running) queued = query;
		else void run(query);
	}

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		type(name, tracker) {
			cancelWait?.();
			cancelWait = null;
			const text = searchText(name);
			if (tracker === null || text === null) {
				wanted = null;
				queued = null;
				if (state !== EMPTY) update(EMPTY);
				return;
			}
			const query = { tracker, text };
			if (wanted !== null && keyOf(wanted) === keyOf(query)) return;
			const sameTracker = wanted?.tracker === tracker;
			wanted = query;
			if (show()) return;
			// The old list stays while the next is found, so the field does not jump, but nothing in it is highlighted.
			// Another tracker's list is dropped: those issues are not what a pick would now mean.
			update({ ...(sameTracker ? {} : { issues: [], open: false }), highlighted: -1, searching: true, hint: null });
			cancelWait = schedule(() => start(query), debounceMs);
		},
		key(key) {
			const { issues, open, highlighted } = state;
			if (key === "Escape") {
				if (!open) return false;
				update({ open: false, highlighted: -1 });
				return true;
			}
			if (key === "ArrowDown" || key === "ArrowUp") {
				if (issues.length === 0 || state.searching) return false;
				const step = key === "ArrowDown" ? 1 : -1;
				const from = open ? highlighted : -1;
				const next = from === -1 ? (step === 1 ? 0 : issues.length - 1) : (from + step + issues.length) % issues.length;
				update({ open: true, highlighted: next });
				return true;
			}
			if (key === "Enter" && open && highlighted >= 0) return issues[highlighted] ?? false;
			return false;
		},
		blur() {
			if (state.open) update({ open: false, highlighted: -1 });
		},
		pick(issue) {
			update({ ...EMPTY });
			return pickedName(issue);
		},
		pause() {
			cancelWait?.();
			cancelWait = null;
			queued = null;
			wanted = null;
			state = EMPTY;
		},
	};
}
