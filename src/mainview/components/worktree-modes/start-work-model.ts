import type { SuggestedIssue } from "../../../shared/issue-search";
import type { ReportedWorktree } from "../../../shared/model";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "../../../shared/timber-result";
import { newWorktreeArguments } from "../../../shared/worktree-commands";
import { REPLACE_THEM_LABEL, START_ANYWAY_LABEL, START_WORK_LABEL, type StartWorkFields, type StartWorkQuestion, assigneeRefusal, describeAssignment, initialQuestion, startWorkRequest, startWorkSubmitLabel } from "../../start-work-format";
import type { AppStore } from "../../store/store";
import { type ModeRun, setupCommand } from "./agent-choice";
import { afterNew, reportedLabel } from "./new-branch-model";

/**
 * The one mode of the Start work dialog without its markup: `timber new`
 * for an issue from the board, with the issue's whole selector as the name.
 * Plain functions and one small holder of state, so all of it is tested
 * without a window. ../StartWorkDialog.tsx only draws this.
 *
 * What the person must agree to (replacing an assignee, a closed issue) is
 * part of the form from the start, so the footer shows the exact command,
 * `--reassign` and `-c` included, before anything runs. When Timber refuses
 * because someone else has the issue after all, nothing was created, the
 * failure stays on screen, and the question is asked with the names Timber
 * gave.
 */

/** Where the mode is. */
export type StartWorkStep =
	| { kind: "form" }
	/**
	 * `timber new` created the worktree but stopped before setup, as in the
	 * New branch mode. `assigned` is false when Timber stopped before it
	 * wrote the assignee, which nothing in the app does later.
	 */
	| { kind: "setup"; worktree: ReportedWorktree; workflow: string | null; assigned: boolean };

export interface StartWorkState {
	fields: StartWorkFields;
	question: StartWorkQuestion;
	step: StartWorkStep;
}

/** The command the mode runs next, as the footer shows it, from the same request and argument builder the engine runs. */
export function startWorkCommand(repository: string, selector: string, state: StartWorkState, workflow: string | null): string {
	const { step } = state;
	return step.kind === "form"
		? describeTimberCommand(newWorktreeArguments(startWorkRequest(repository, selector, state.fields, state.question, workflow), RESULT_FILE_PLACEHOLDER))
		: setupCommand(step.worktree.path, step.workflow);
}

/** The words on the dialog for where the mode is. */
export function describeStartWorkStep(state: StartWorkState): { submitLabel: string; submitLabels: readonly string[]; runningLabel: string; failureTitle: string } {
	const { step } = state;
	// A refused assignee can bring a question, and its label, while the dialog is open. The labels that name no one are
	// reserved ahead; one that names the assignee is only known then, and may widen the button once.
	const submitLabels = [startWorkSubmitLabel(state.question), START_WORK_LABEL, START_ANYWAY_LABEL, REPLACE_THEM_LABEL, "Run setup"];
	if (step.kind === "form") return { submitLabel: submitLabels[0]!, submitLabels, runningLabel: "Creating the worktree", failureTitle: "Could not start work" };
	return { submitLabel: "Run setup", submitLabels, runningLabel: "Starting setup", failureTitle: `Created ${reportedLabel(step.worktree)}, but Timber stopped before setup` };
}

export interface StartWorkModel {
	getState(): StartWorkState;
	subscribe(listener: () => void): () => void;
	/** Change fields. Ignored once the worktree exists. */
	edit(change: Partial<StartWorkFields>): void;
	/** Run `timber new` from the form once, or ask for the setup session once the worktree exists. */
	run(workflow?: string | null): Promise<ModeRun>;
}

/** `repository` is the path of the primary checkout; `selector` is the issue's whole selector (see `startWorkChoice`). */
export function createStartWorkModel(store: Pick<AppStore, "newWorktree">, repository: string, issue: SuggestedIssue, selector: string): StartWorkModel {
	const listeners = new Set<() => void>();
	let state: StartWorkState = { fields: { branch: "", base: "", workflow: null }, question: initialQuestion(issue), step: { kind: "form" } };

	function update(change: Partial<StartWorkState>): void {
		state = { ...state, ...change };
		for (const listener of [...listeners]) listener();
	}

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		edit(change) {
			if (state.step.kind === "form") update({ fields: { ...state.fields, ...change } });
		},
		async run(workflow = null) {
			const { step } = state;
			if (step.kind === "setup") {
				const label = reportedLabel(step.worktree);
				return { outcome: { ok: true, toast: `Opened ${label}` }, created: step.worktree, setup: step.worktree, workflow: step.workflow, startedToast: `Setup started in ${label}` };
			}
			const request = startWorkRequest(repository, selector, state.fields, state.question, workflow);
			const result = await store.newWorktree(request);
			const replace = assigneeRefusal(result, request.assign, issue);
			// Someone else has the issue after all: nothing was created, so ask, with the names Timber gave. The failure stays on screen.
			if (replace !== null) update({ question: { ...state.question, replace, partial: false } });
			const { run, kept } = afterNew(result);
			if (kept) {
				// Only a write Timber says it made, or found unneeded, counts: not attempted, failed, or unsaid is not assigned.
				const written = result.outcome === "failed" ? result.assignment?.result : undefined;
				const assigned = written === "assigned" || written === "reassigned" || written === "already-mine";
				update({ step: { kind: "setup", worktree: kept, workflow, assigned } });
			}
			if (result.outcome === "succeeded" && run.outcome.ok) {
				const about = describeAssignment(result.assignment, issue.tracker, issue.key);
				return { ...run, outcome: { ok: true, toast: `${run.outcome.toast}. ${about.text}`, ...(about.problem ? { problem: true } : {}) }, workflow };
			}
			return { ...run, workflow };
		},
	};
}
