import type { TimberFailure } from "../../shared/model";

/** What a dialog's operation came to. */
export type SubmissionOutcome =
	/**
	 * It worked. `toast` is the short note to show, for example "Worktree
	 * created". `problem` marks a toast that also says something went wrong on
	 * the way, such as a pull whose fetch failed.
	 */
	| { ok: true; toast: string; problem?: boolean }
	| { ok: false; failure: TimberFailure };

export interface SubmissionState {
	/** The operation is in progress: controls are disabled and nothing else can be submitted. */
	running: boolean;
	/** Why the latest attempt failed. Null while one runs and after one worked. */
	failure: TimberFailure | null;
}

/**
 * The one way a dialog runs its operation, so every dialog behaves the same:
 * one run at a time, a failure that stays in the dialog for a correction and
 * a retry, and a success that is handed on to be shown as a toast.
 */
export interface Submission {
	getState(): SubmissionState;
	/** Hear about every change of state. Returns a function that stops listening. */
	subscribe(listener: () => void): () => void;
	/**
	 * Run the operation. While one is running a second call does nothing and
	 * answers false. Answers true when the operation worked. A task that throws
	 * counts as failed, with the error as the diagnostic.
	 */
	submit(task: () => Promise<SubmissionOutcome>): Promise<boolean>;
	/** Put the failure away, for example when the person edits a field. */
	clearFailure(): void;
}

const idle: SubmissionState = { running: false, failure: null };

/** `onSuccess` gets the toast text of every run that worked, and whether it points at a problem, after the running state has ended. */
export function createSubmission(onSuccess: (toast: string, problem: boolean) => void): Submission {
	let state = idle;
	const listeners = new Set<() => void>();

	function update(next: SubmissionState): void {
		state = next;
		for (const listener of [...listeners]) listener();
	}

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		async submit(task) {
			if (state.running) return false;
			update({ running: true, failure: null });
			let outcome: SubmissionOutcome;
			try {
				outcome = await task();
			} catch (error) {
				const diagnostic = error instanceof Error ? error.message : String(error);
				outcome = { ok: false, failure: { command: null, diagnostic, output: null } };
			}
			if (!outcome.ok) {
				update({ running: false, failure: outcome.failure });
				return false;
			}
			update(idle);
			onSuccess(outcome.toast, outcome.problem === true);
			return true;
		},
		clearFailure() {
			if (state.failure && !state.running) update(idle);
		},
	};
}
