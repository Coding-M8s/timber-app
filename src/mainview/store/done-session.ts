import type { TimberFailure } from "../../shared/model";
import {
	DEFAULT_DONE_OPTIONS, type DoneApplyRequest, type DoneApplyResult, type DoneOptions, type DonePreview,
	type DonePreviewRequest, type DonePreviewResult, previewMatchesOptions,
} from "../../shared/timber-done";
import type { Schedule } from "./store";

/** The preview part of the Done dialog. It is always about the options on screen, or on its way. */
export type DonePreviewState =
	/** Timber has been asked and has not answered yet. */
	| { kind: "loading" }
	| {
		kind: "ready";
		/** The engine's name for this preview, which is what Remove approves. */
		id: string;
		preview: DonePreview;
		/** Its time ran out. Timber would refuse it, so it cannot be submitted. */
		expired: boolean;
	}
	/** There is no preview, so nothing can be removed. */
	| { kind: "failed"; failure: TimberFailure };

export interface DoneSessionState {
	/** The options on screen. */
	options: DoneOptions;
	preview: DonePreviewState;
	/** A removal was tried and failed. The preview on screen was asked for after it. */
	attempted: boolean;
}

export interface DoneSessionDependencies {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's registered path. */
	path: string;
	preview(request: DonePreviewRequest): Promise<DonePreviewResult>;
	/**
	 * Run the removal, approving `request.preview`, which is `shown` on screen.
	 * Null when it was not run, for example because a removal of the same
	 * worktree runs already.
	 */
	apply(request: DoneApplyRequest, shown: DonePreview): Promise<DoneApplyResult | null>;
	/** A removal failed before this session started, for example while its dialog was closed. */
	attempted?: boolean;
	/** Whether the worktree is in the list right now. Asked after a removal that failed. */
	listed(): boolean;
	/** How the session waits for a preview to expire. Tests pass their own clock. */
	schedule?: Schedule;
	/** The time in Unix milliseconds. */
	now?: () => number;
}

/**
 * What one open Done dialog knows: the options, the preview for them, and
 * whether Remove may be pressed. It keeps three promises.
 *
 * - An older preview never replaces a newer one. Every question takes a
 *   ticket, and only the answer to the latest one is used.
 * - Remove is possible only for a preview that is on screen, is for the
 *   options on screen, and has not expired. Changing an option takes the old
 *   preview off the screen at once.
 * - A removal is asked for once. When it fails, nothing is tried again: a new
 *   preview is asked for, and the person decides again.
 */
export interface DoneSession {
	getState(): DoneSessionState;
	/** Hear about every change of state. Returns a function that stops listening. */
	subscribe(listener: () => void): () => void;
	/** Ask for the first preview. Also restarts a session that was stopped. */
	start(): void;
	/**
	 * The dialog is gone: answers that arrive from now on are dropped, and a
	 * removal that fails from now on asks for no new preview.
	 */
	stop(): void;
	/** Change the options and ask for the preview that goes with them. */
	setOptions(options: DoneOptions): void;
	/** Ask for a new preview with the options as they are. */
	refresh(): void;
	/**
	 * Remove the worktree, approving the preview on screen. Null when that is
	 * not possible right now, in which case nothing was asked of the engine.
	 */
	remove(): Promise<DoneApplyResult | null>;
}

const scheduleWithTimer: Schedule = (task, milliseconds) => {
	const timer = setTimeout(task, milliseconds);
	return () => clearTimeout(timer);
};

/** Whether Remove may be pressed: only for a current preview that is for the options on screen. */
export function canRemove(state: DoneSessionState): boolean {
	const { preview } = state;
	return preview.kind === "ready" && !preview.expired && previewMatchesOptions(preview.preview, state.options);
}

export function createDoneSession(dependencies: DoneSessionDependencies): DoneSession {
	const { repository, path, schedule = scheduleWithTimer, now = Date.now } = dependencies;
	let state: DoneSessionState = { options: DEFAULT_DONE_OPTIONS, preview: { kind: "loading" }, attempted: dependencies.attempted ?? false };
	const listeners = new Set<() => void>();
	/** The ticket of the latest question. An answer to an earlier one is dropped. */
	let ticket = 0;
	let removing = false;
	let stopped = false;
	let cancelExpiry: (() => void) | null = null;

	function update(change: Partial<DoneSessionState>): void {
		state = { ...state, ...change };
		for (const listener of [...listeners]) listener();
	}

	function forgetExpiry(): void {
		cancelExpiry?.();
		cancelExpiry = null;
	}

	function expire(id: string): void {
		if (state.preview.kind === "ready" && state.preview.id === id && !state.preview.expired) update({ preview: { ...state.preview, expired: true } });
	}

	function ask(): void {
		const mine = ++ticket;
		const { options } = state;
		forgetExpiry();
		update({ preview: { kind: "loading" } });
		void dependencies.preview({ repository, path, options }).then(
			(result): DonePreviewState => result.outcome === "failed"
				? { kind: "failed", failure: result.failure }
				// A preview for other options than the ones asked for is not one to approve.
				: previewMatchesOptions(result.preview, options)
					? { kind: "ready", id: result.id, preview: result.preview, expired: result.preview.expiresAt <= now() }
					: { kind: "failed", failure: { command: null, diagnostic: "The preview that arrived is for other options than the ones on screen. It was not used.", output: null } },
			(error: unknown): DonePreviewState =>
				({ kind: "failed", failure: { command: null, diagnostic: error instanceof Error ? error.message : String(error), output: null } }),
		).then(preview => {
			if (mine !== ticket) return;
			update({ preview });
			if (preview.kind === "ready" && !preview.expired) {
				const { id } = preview;
				cancelExpiry = schedule(() => expire(id), preview.preview.expiresAt - now());
			}
		});
	}

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		start() {
			stopped = false;
			ask();
		},
		stop() {
			stopped = true;
			ticket++;
			forgetExpiry();
		},
		setOptions(options) {
			if (removing) return;
			state = { ...state, options };
			ask();
		},
		refresh() {
			if (!removing) ask();
		},
		async remove() {
			const shown = state.preview;
			if (removing || shown.kind !== "ready" || !canRemove(state)) return null;
			// The timer may be late, for example after the computer slept.
			if (shown.preview.expiresAt <= now()) {
				expire(shown.id);
				return null;
			}
			removing = true;
			let result: DoneApplyResult | null;
			try {
				result = await dependencies.apply({ repository, path, preview: shown.id }, shown.preview);
			} catch (error) {
				const diagnostic = `The removal did not answer, so what it did is unknown: ${error instanceof Error ? error.message : String(error)}`;
				result = { outcome: "failed", ran: true, failure: { command: null, diagnostic, output: null } };
			} finally {
				removing = false;
			}
			// Nothing ran, so the preview on screen still holds.
			if (result === null) return null;
			if (result.outcome === "removed") {
				ticket++;
				forgetExpiry();
				return result;
			}
			// The preview is used up. Never try again with it: show the state as it is now and let the person decide.
			state = { ...state, attempted: true };
			// The dialog closed while the removal ran. A dialog opened again asks for its own preview.
			if (stopped) return result;
			if (dependencies.listed()) {
				ask();
			} else {
				ticket++;
				forgetExpiry();
				const gone: TimberFailure = { command: null, diagnostic: "The worktree is no longer in the list, so there is nothing to preview.", output: null };
				update({ preview: { kind: "failed", failure: gone } });
			}
			return result;
		},
	};
}
