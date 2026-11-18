import type { NewWorktreeRequest, OpenWorktreeRequest, ReportedWorktree, WorktreeCommandResult } from "../../../shared/model";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "../../../shared/timber-result";
import { newWorktreeArguments, openWorktreeArguments } from "../../../shared/worktree-commands";
import { folderName } from "../../format";
import type { AppStore } from "../../store/store";
import type { SubmissionOutcome } from "../../store/submission";
import type { ModeRun } from "./agent-choice";
import { workflowPart } from "./workflow-choice";

/**
 * The "New branch" mode without its markup: the fields, the command they
 * make, and what each outcome of `timber new` leads to. Plain functions and
 * one small holder of state, so all of it is tested without a window.
 * ./new-branch.tsx only draws this.
 */

/** What the person typed, as typed. */
export interface NewBranchFields {
	name: string;
	/** "Start from". Empty for Timber's configured base. */
	base: string;
	/** The Workflow field as picked, or null for None. What it passes depends on the list (see ./workflow-choice.tsx). */
	workflow: string | null;
}

/** Where the mode is. */
export type NewBranchStep =
	/** Asking what to create. */
	| { kind: "form" }
	/**
	 * `timber new` created the worktree, but what came after, such as a setup
	 * script, did not finish. The mode now offers to run setup again in that
	 * worktree, not to create anything. `attempts` counts those runs.
	 * `workflow` is the one `timber new` ran with, or null: Timber does not
	 * remember it, so running setup again passes it again.
	 */
	| { kind: "setup"; worktree: ReportedWorktree; attempts: number; workflow: string | null };

export interface NewBranchState {
	fields: NewBranchFields;
	step: NewBranchStep;
}

/**
 * The request the fields make: the name and the base without the spaces
 * around them. An empty base means none. `workflow` is the one the command
 * passes, or null for none.
 */
export function newWorktreeRequest(repository: string, fields: Pick<NewBranchFields, "name" | "base">, workflow: string | null = null): NewWorktreeRequest {
	const base = fields.base.trim();
	return { repository, name: fields.name.trim(), base: base === "" ? null : base, ...workflowPart(workflow) };
}

/** Running setup again in a worktree Timber reported, named by its exact path, with the workflow it was created with. */
export function setupRequest(repository: string, worktree: ReportedWorktree, workflow: string | null = null): OpenWorktreeRequest {
	return { repository, selector: worktree.path, setup: true, ...workflowPart(workflow) };
}

/** False while there is no name. Timber judges everything else about it. */
export function canCreate(fields: NewBranchFields): boolean {
	return fields.name.trim() !== "";
}

/**
 * The command the mode runs next, as shown in the dialog's footer. It is
 * worded from the same request and the same argument builder the engine runs.
 * `workflow` is the one `timber new` would pass from the form.
 */
export function shownCommand(repository: string, state: NewBranchState, workflow: string | null = null): string {
	const { step } = state;
	return describeTimberCommand(step.kind === "form"
		? newWorktreeArguments(newWorktreeRequest(repository, state.fields, workflow), RESULT_FILE_PLACEHOLDER)
		: openWorktreeArguments(setupRequest(repository, step.worktree, step.workflow), RESULT_FILE_PLACEHOLDER));
}

/** What to call a reported worktree: its branch, or its folder on a detached HEAD. */
export function reportedLabel(worktree: ReportedWorktree): string {
	return worktree.branch ?? folderName(worktree.path);
}

const cancelled = (command: string): SubmissionOutcome => ({
	ok: false,
	failure: { command: null, diagnostic: `${command} was cancelled before anything was changed.`, output: null },
});

/** What the mode does with how `timber new` ended. `setup` is set when the worktree exists and only setup is left. */
export function afterNew(result: WorktreeCommandResult): { outcome: SubmissionOutcome; setup: ReportedWorktree | null } {
	switch (result.outcome) {
		case "succeeded":
			return { outcome: { ok: true, toast: `Created worktree ${reportedLabel(result.worktree)}` }, setup: null };
		case "cancelled":
			return { outcome: cancelled("timber new"), setup: null };
		case "failed":
			return { outcome: { ok: false, failure: result.failure }, setup: result.created ? result.worktree : null };
	}
}

/** What the mode does with how "Open with setup" ended. */
export function afterSetup(result: WorktreeCommandResult): SubmissionOutcome {
	switch (result.outcome) {
		case "succeeded":
			return { ok: true, toast: `Setup finished in ${reportedLabel(result.worktree)}` };
		case "cancelled":
			return cancelled("timber open");
		case "failed":
			return { ok: false, failure: result.failure };
	}
}

/** The words on the dialog for where the mode is. */
export function describeStep(step: NewBranchStep): { submitLabel: string; runningLabel: string; failureTitle: string } {
	if (step.kind === "form") {
		return { submitLabel: "Create worktree", runningLabel: "Creating the worktree", failureTitle: "Could not create the worktree" };
	}
	return {
		submitLabel: "Open with setup",
		runningLabel: "Running setup",
		failureTitle: step.attempts === 0 ? `Created ${reportedLabel(step.worktree)}, setup failed` : "Setup did not finish",
	};
}

export interface NewBranchModel {
	getState(): NewBranchState;
	/** Hear about every change of state. Returns a function that stops listening. */
	subscribe(listener: () => void): () => void;
	/** Change fields. Ignored once the worktree exists. */
	edit(change: Partial<NewBranchFields>): void;
	/** Leave "Open with setup" and show the form again. The worktree stays as it is. */
	backToForm(): void;
	/**
	 * Run the command the footer shows: `timber new` from the form, with
	 * `workflow` when it is not null, or `timber open --setup` once the
	 * worktree exists, with the workflow `timber new` had. Once per call, and
	 * never again by itself. A run that worked reports the worktree as
	 * created: either `timber new` made it, or this mode made it and setup has
	 * now finished.
	 */
	run(workflow?: string | null): Promise<ModeRun>;
}

type Actions = Pick<AppStore, "newWorktree" | "openWorktree">;

/** `repository` is the path of the primary checkout the worktree is created in. */
export function createNewBranchModel(store: Actions, repository: string): NewBranchModel {
	const listeners = new Set<() => void>();
	let state: NewBranchState = { fields: { name: "", base: "", workflow: null }, step: { kind: "form" } };

	function update(change: Partial<NewBranchState>): void {
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
		backToForm() {
			if (state.step.kind !== "form") update({ step: { kind: "form" } });
		},
		async run(workflow = null) {
			const { step } = state;
			if (step.kind === "setup") {
				const result = await store.openWorktree(setupRequest(repository, step.worktree, step.workflow));
				const outcome = afterSetup(result);
				if (!outcome.ok) update({ step: { ...step, attempts: step.attempts + 1 } });
				// Timber reports `created: false` here, because the worktree was already there. This mode made it.
				return { outcome, created: result.outcome === "succeeded" ? result.worktree : null };
			}
			const result = await store.newWorktree(newWorktreeRequest(repository, state.fields, workflow));
			const { outcome, setup } = afterNew(result);
			if (setup) update({ step: { kind: "setup", worktree: setup, attempts: 0, workflow } });
			// `timber new` that worked made the worktree. Its `created` is not needed: false does not prove nothing was made.
			return { outcome, created: result.outcome === "succeeded" ? result.worktree : null };
		},
	};
}
