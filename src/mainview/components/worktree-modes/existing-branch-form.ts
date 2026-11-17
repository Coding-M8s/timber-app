import type { BranchSuggestion, OpenWorktreeRequest, ReportedWorktree } from "../../../shared/model";
import { reportedLabel } from "./new-branch-model";
import type { AppStore } from "../../store/store";
import type { Submission } from "../../store/submission";
import type { ModeRun } from "./agent-choice";

/** A worktree that a failed run left behind or found, and whether that run created it. */
export interface KeptWorktree {
	worktree: ReportedWorktree;
	created: boolean;
}

export interface ExistingBranchFormState {
	/** What to open, as typed or picked. Timber alone decides what it means. */
	selector: string;
	/** "Rerun setup". */
	setup: boolean;
	/** The branches to pick from. Undefined while they are read, null when they could not be read. */
	branches: readonly BranchSuggestion[] | null | undefined;
	/** Set after a run that failed although Timber reported a worktree, until the person edits a field. */
	kept: KeptWorktree | null;
}

/**
 * The fields of the "Existing branch" mode and what running them does, kept
 * apart from React so it can be tested without a window (see
 * ./existing-branch.tsx for the hook and the fields themselves).
 */
export interface ExistingBranchForm {
	getState(): ExistingBranchFormState;
	/** Hear about every change of state. Returns a function that stops listening. */
	subscribe(listener: () => void): () => void;
	setSelector(selector: string): void;
	setSetup(setup: boolean): void;
	/** Read the branches to pick from. Only the latest read counts. */
	readBranches(): Promise<void>;
	/**
	 * Run `timber open` with the fields as they are now. Runs once: a failure
	 * is shown, never tried again. A run that worked reports the worktree as
	 * created when Timber made it, or when it finishes the setup of a
	 * worktree an earlier run of this form made. A worktree that was already
	 * there is never reported as created.
	 */
	run(): Promise<ModeRun>;
}

/** Whether two reports name the same worktree: by identity, or by the registered path. */
function sameReported(one: ReportedWorktree, other: ReportedWorktree): boolean {
	return one.id === other.id || one.path === other.path;
}

/**
 * The request the fields make: the selector without the spaces around it,
 * and otherwise exactly as given. The dialog words its command from this, and
 * `run` sends this.
 */
export function openRequest(repository: string, state: Pick<ExistingBranchFormState, "selector" | "setup">): OpenWorktreeRequest {
	return { repository, selector: state.selector.trim(), setup: state.setup };
}

/** False while there is nothing to open. Timber judges everything else about the text. */
export function canOpen(state: Pick<ExistingBranchFormState, "selector">): boolean {
	return state.selector.trim() !== "";
}

/**
 * The toast after `timber open` worked. A worktree that was already there was
 * only opened, and the toast says so instead of claiming something was made.
 */
export function describeOpened(worktree: ReportedWorktree, created: boolean): string {
	const label = reportedLabel(worktree);
	return created ? `Created worktree ${label}` : `Opened ${label}. Its worktree was already there.`;
}

/** `repository` is the path of the primary checkout. An edit puts away the failure of `submission`. */
export function createExistingBranchForm(
	store: Pick<AppStore, "openWorktree" | "listBranches">,
	repository: string,
	submission: Pick<Submission, "clearFailure">,
): ExistingBranchForm {
	let state: ExistingBranchFormState = { selector: "", setup: false, branches: undefined, kept: null };
	const listeners = new Set<() => void>();
	let latestRead = 0;
	/** Counts edits, so a run can tell whether the fields changed while it ran. */
	let edits = 0;

	function update(change: Partial<ExistingBranchFormState>): void {
		state = { ...state, ...change };
		for (const listener of [...listeners]) listener();
	}

	/** An edit answers the failure on screen, so both the failure and its note go. */
	function edit(change: Partial<ExistingBranchFormState>): void {
		edits += 1;
		update({ ...change, kept: null });
		submission.clearFailure();
	}

	async function readBranches(): Promise<void> {
		const read = ++latestRead;
		const branches = await store.listBranches(repository);
		if (read === latestRead) update({ branches });
	}

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		setSelector: selector => edit({ selector }),
		setSetup: setup => edit({ setup }),
		readBranches,
		async run() {
			// An edit puts `kept` away, so it is set here only while the fields still name that worktree.
			const before = state.kept;
			const editsBefore = edits;
			update({ kept: null });
			const result = await store.openWorktree(openRequest(repository, state));
			// A run that names no worktree tells nothing new about the kept one. While the fields still name it, it stays kept.
			const keepBefore = () => {
				if (before !== null && edits === editsBefore) update({ kept: before });
			};
			if (result.outcome === "cancelled") {
				keepBefore();
				void readBranches();
				return {
					outcome: { ok: false, failure: { command: null, diagnostic: "timber open was cancelled before anything was changed.", output: null } },
					created: null,
				};
			}
			// Running setup again in a worktree an earlier run of this dialog created finishes that creation, though Timber now finds it there.
			const finishing = before !== null && before.created && result.worktree !== null && sameReported(before.worktree, result.worktree);
			const created = result.created || finishing;
			if (result.outcome === "succeeded") {
				const toast = created && !result.created ? `Setup finished in ${reportedLabel(result.worktree)}` : describeOpened(result.worktree, result.created);
				return { outcome: { ok: true, toast }, created: created ? result.worktree : null };
			}
			// The command may have made a branch, and the dialog stays open.
			void readBranches();
			if (result.worktree) {
				// The worktree is there. The fields now name exactly it, so the next run cannot make another one.
				update({ kept: { worktree: result.worktree, created }, selector: result.worktree.path, setup: true });
			} else {
				keepBefore();
			}
			return { outcome: { ok: false, failure: result.failure }, created: null };
		},
	};
}
