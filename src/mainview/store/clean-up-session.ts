import type { TimberFailure, Worktree } from "../../shared/model";
import { DEFAULT_DONE_OPTIONS, type DonePreview, type DonePreviewRequest, type DonePreviewResult, previewMatchesOptions } from "../../shared/timber-done";
import { BEING_REMOVED_ALREADY, CLEAN_UP_LIMIT, CLEAN_UP_PREVIEWS_AT_ONCE, OVER_LIMIT_REASON, SESSIONS_REASON, describeReadyWarning, skipReason } from "../clean-up-format";
import { DONE_EXPIRED_NOTE } from "../done-format";
import type { Schedule } from "./store";

/** Where one candidate of Clean up merged stands in the dialog. */
export type CleanUpRow = { worktree: Worktree } & (
	/** Timber has been asked for its preview and has not answered yet. */
	| { kind: "loading" }
	/** Remove removes it, approving this preview. `warning` is what its row adds about commits. */
	| { kind: "ready"; id: string; preview: DonePreview; warning: string | null }
	/**
	 * It is left alone, for the reason given. `failure` is Timber's answer
	 * when the preview failed. Its own Done dialog can still remove it.
	 */
	| { kind: "skipped"; reason: string; failure: TimberFailure | null }
);

export interface CleanUpSessionState {
	rows: readonly CleanUpRow[];
}

/** One worktree to remove, with the preview its removal approves. */
export interface CleanUpItem {
	worktree: Worktree;
	preview: string;
	shown: DonePreview;
}

export interface CleanUpSessionDependencies {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktrees whose pull request merged, in the order of the list (`mergedCandidates`). */
	candidates: readonly Worktree[];
	preview(request: DonePreviewRequest): Promise<DonePreviewResult>;
	/** The worktree at this registered path as the list has it now, or null once it left the list. */
	current(path: string): Worktree | null;
	/** How many sessions run in the worktree right now. */
	runningSessions(worktree: Worktree): number;
	/** Whether a removal of the worktree at this path runs or waits right now. */
	beingRemoved(path: string): boolean;
	/** Start the removals, one at a time, in the background (`cleanUpMerged` in ./store.ts). */
	apply(items: readonly CleanUpItem[]): void;
	/** How the session waits for a preview to expire. Tests pass their own clock. */
	schedule?: Schedule;
	/** The time in Unix milliseconds. */
	now?: () => number;
}

/**
 * What an open Clean up merged dialog knows: one preview per candidate, with
 * Timber's default options, sorted into Ready and Skipped. It keeps the Done
 * dialog's promises for every row on its own.
 *
 * - An older preview never replaces a newer one: every round of questions
 *   takes a ticket, and answers to an earlier one are dropped.
 * - A preview that expires takes its row out of Ready at once, and Remove
 *   checks the time again, so an expired preview is never approved.
 * - Nothing is removed before `remove`, and `remove` approves only the
 *   Ready rows, each with its own preview.
 */
export interface CleanUpSession {
	getState(): CleanUpSessionState;
	subscribe(listener: () => void): () => void;
	/** Ask for every preview. Also restarts a session that was stopped. */
	start(): void;
	/** The dialog is gone: answers that arrive from now on are dropped. */
	stop(): void;
	/** Ask for every preview again. */
	refresh(): void;
	/**
	 * Start removing every row that is Ready right now, checked once more
	 * against the clock, the list, and running sessions. False, with nothing
	 * started, when there is none.
	 */
	remove(): boolean;
}

const scheduleWithTimer: Schedule = (task, milliseconds) => {
	const timer = setTimeout(task, milliseconds);
	return () => clearTimeout(timer);
};

/** The rows Remove would remove. */
export function readyRows(state: CleanUpSessionState): Extract<CleanUpRow, { kind: "ready" }>[] {
	return state.rows.filter((row): row is Extract<CleanUpRow, { kind: "ready" }> => row.kind === "ready");
}

const skipped = (worktree: Worktree, reason: string, failure: TimberFailure | null = null): CleanUpRow => ({ worktree, kind: "skipped", reason, failure });
const GONE_REASON = "It is no longer in the list.";

export function createCleanUpSession(dependencies: CleanUpSessionDependencies): CleanUpSession {
	const { repository, schedule = scheduleWithTimer, now = Date.now } = dependencies;
	const previewed = dependencies.candidates.slice(0, CLEAN_UP_LIMIT);
	const over = dependencies.candidates.slice(CLEAN_UP_LIMIT).map(worktree => skipped(worktree, OVER_LIMIT_REASON));
	let state: CleanUpSessionState = { rows: [...previewed.map((worktree): CleanUpRow => ({ worktree, kind: "loading" })), ...over] };
	const listeners = new Set<() => void>();
	let ticket = 0;
	const timers: (() => void)[] = [];

	function update(rows: readonly CleanUpRow[]): void {
		state = { rows };
		for (const listener of [...listeners]) listener();
	}

	function setRow(path: string, row: CleanUpRow): void {
		update(state.rows.map(candidate => candidate.worktree.path === path ? row : candidate));
	}

	function forgetTimers(): void {
		for (const cancel of timers.splice(0)) cancel();
	}

	/** Why a worktree is left alone before Timber is even asked, or null. */
	function blocked(worktree: Worktree): string | null {
		if (dependencies.beingRemoved(worktree.path)) return BEING_REMOVED_ALREADY;
		if (dependencies.runningSessions(worktree) > 0) return SESSIONS_REASON;
		return null;
	}

	function classify(snapshot: Worktree, result: DonePreviewResult): CleanUpRow {
		const worktree = dependencies.current(snapshot.path);
		if (!worktree) return skipped(snapshot, GONE_REASON);
		if (result.outcome === "failed") return skipped(worktree, "Timber gave no preview.", result.failure);
		// A preview for other options than the defaults is not one to approve.
		if (!previewMatchesOptions(result.preview, DEFAULT_DONE_OPTIONS)) return skipped(worktree, "The preview that arrived is for other options than Timber's defaults. It was not used.");
		if (result.preview.expiresAt <= now()) return skipped(worktree, DONE_EXPIRED_NOTE);
		const reason = blocked(worktree) ?? skipReason(result.preview, worktree);
		if (reason !== null) return skipped(worktree, reason);
		return { worktree, kind: "ready", id: result.id, preview: result.preview, warning: describeReadyWarning(result.preview, worktree) };
	}

	function expire(path: string, id: string): void {
		const row = state.rows.find(candidate => candidate.worktree.path === path);
		if (row?.kind === "ready" && row.id === id) setRow(path, skipped(row.worktree, DONE_EXPIRED_NOTE));
	}

	function ask(): void {
		const mine = ++ticket;
		forgetTimers();
		update([...previewed.map((snapshot): CleanUpRow => {
			const worktree = dependencies.current(snapshot.path) ?? snapshot;
			const reason = blocked(worktree);
			return reason === null ? { worktree, kind: "loading" } : skipped(worktree, reason);
		}), ...over]);
		// Previews only read, and each is its own process, so a few are asked for at a time.
		const waiting = state.rows.filter(row => row.kind === "loading").map(row => row.worktree);
		const next = (): void => {
			const snapshot = waiting.shift();
			if (!snapshot || mine !== ticket) return;
			void dependencies.preview({ repository, path: snapshot.path, options: DEFAULT_DONE_OPTIONS }).then(
				result => result,
				(error: unknown): DonePreviewResult => ({ outcome: "failed", failure: { command: null, diagnostic: error instanceof Error ? error.message : String(error), output: null } }),
			).then(result => {
				if (mine !== ticket) return;
				const row = classify(snapshot, result);
				setRow(snapshot.path, row);
				if (row.kind === "ready") {
					const { id } = row;
					timers.push(schedule(() => expire(snapshot.path, id), row.preview.expiresAt - now()));
				}
				next();
			});
		};
		for (let started = 0; started < CLEAN_UP_PREVIEWS_AT_ONCE; started++) next();
	}

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		start: ask,
		stop() {
			ticket++;
			forgetTimers();
		},
		refresh: ask,
		remove() {
			const items: CleanUpItem[] = [];
			const rows = state.rows.map((row): CleanUpRow => {
				if (row.kind !== "ready") return row;
				// The timer may be late, for example after the computer slept, and the list and sessions move on meanwhile.
				if (row.preview.expiresAt <= now()) return skipped(row.worktree, DONE_EXPIRED_NOTE);
				const worktree = dependencies.current(row.worktree.path);
				if (!worktree) return skipped(row.worktree, GONE_REASON);
				const reason = blocked(worktree);
				if (reason !== null) return skipped(worktree, reason);
				items.push({ worktree, preview: row.id, shown: row.preview });
				return row;
			});
			if (rows.some((row, index) => row !== state.rows[index])) update(rows);
			if (items.length === 0) return false;
			ticket++;
			forgetTimers();
			dependencies.apply(items);
			return true;
		},
	};
}
