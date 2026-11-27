import { issueSelector } from "../../../shared/issue-trackers";
import type { IssueTracker, NewWorktreeRequest, ReportedWorktree, WorktreeCommandResult } from "../../../shared/model";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "../../../shared/timber-result";
import { newWorktreeArguments } from "../../../shared/worktree-commands";
import { folderName } from "../../format";
import type { AppStore } from "../../store/store";
import { type ModeRun, setupCommand } from "./agent-choice";
import type { TrackerOptions } from "./tracker-choice";
import { workflowPart } from "./workflow-choice";

/**
 * The "New branch" mode without its markup: the fields, the command they
 * make, and what each outcome of `timber new` leads to. Plain functions and
 * one small holder of state, so all of it is tested without a window.
 * ./new-branch.tsx only draws this.
 *
 * `timber new` runs with `--no-setup`, so it answers once the worktree
 * exists. When Timber says it left setup scripts, the frame runs them in a
 * session in the new worktree, and nothing here waits for them.
 */

/** What the person typed, as typed. */
export interface NewBranchFields {
	name: string;
	/** "Start from". Empty for Timber's configured base. */
	base: string;
	/** The Workflow field as picked, or null for None. What it passes depends on the list (see ./workflow-choice.tsx). */
	workflow: string | null;
	/** The Tracker field as picked, or null for Default. What it passes depends on the trackers set up (see ./tracker-choice.tsx). */
	tracker: IssueTracker | null;
}

/** Where the mode is. */
export type NewBranchStep =
	/** Asking what to create. */
	| { kind: "form" }
	/**
	 * `timber new` created the worktree, but stopped before it was done, for
	 * example when it could not save the base. The mode now offers to run
	 * setup in that worktree, not to create anything. `workflow` is the one
	 * `timber new` ran with, or null: Timber does not remember it, so the
	 * setup session passes it again.
	 */
	| { kind: "setup"; worktree: ReportedWorktree; workflow: string | null };

export interface NewBranchState {
	fields: NewBranchFields;
	step: NewBranchStep;
	/** The trackers the repository has set up, for the Tracker field: undefined until read. */
	trackers: TrackerOptions;
}

/**
 * The request the fields make: the name and the base without the spaces
 * around them. An empty base means none. `workflow` is the one the command
 * passes, or null for none. `tracker` is the one the name is read with, or
 * null for Timber's default: a name with the shape of its issue gets its
 * prefix, such as `jira:ENG-42`, and any other name passes unchanged.
 */
export function newWorktreeRequest(repository: string, fields: Pick<NewBranchFields, "name" | "base">, workflow: string | null = null, tracker: IssueTracker | null = null): NewWorktreeRequest {
	const base = fields.base.trim();
	return { repository, name: issueSelector(tracker, fields.name.trim()), base: base === "" ? null : base, ...workflowPart(workflow) };
}

/** False while there is no name. Timber judges everything else about it. */
export function canCreate(fields: NewBranchFields): boolean {
	return fields.name.trim() !== "";
}

/**
 * The command the mode runs next, as shown in the dialog's footer. It is
 * worded from the same request and the same argument builder the engine runs:
 * `timber new` from the form, or the setup session's command once the
 * worktree exists. `workflow` and `tracker` are the ones `timber new` would
 * use from the form.
 */
export function shownCommand(repository: string, state: Pick<NewBranchState, "fields" | "step">, workflow: string | null = null, tracker: IssueTracker | null = null): string {
	const { step } = state;
	return step.kind === "form"
		? describeTimberCommand(newWorktreeArguments(newWorktreeRequest(repository, state.fields, workflow, tracker), RESULT_FILE_PLACEHOLDER))
		: setupCommand(step.worktree.path, step.workflow);
}

/** What to call a reported worktree: its branch, or its folder on a detached HEAD. */
export function reportedLabel(worktree: ReportedWorktree): string {
	return worktree.branch ?? folderName(worktree.path);
}

/**
 * What the mode does with how `timber new` ended. `run` is what starts in
 * the worktree when it worked; `kept` is set when the worktree exists but
 * Timber stopped before it was done.
 */
export function afterNew(result: WorktreeCommandResult): { run: ModeRun; kept: ReportedWorktree | null } {
	switch (result.outcome) {
		case "succeeded":
			return {
				// `timber new` that worked made the worktree. Its `created` is not needed: false does not prove nothing was made.
				run: { outcome: { ok: true, toast: `Created worktree ${reportedLabel(result.worktree)}` }, created: result.worktree, setup: result.setupSkipped ? result.worktree : null },
				kept: null,
			};
		case "cancelled":
			return {
				run: { outcome: { ok: false, failure: { command: null, diagnostic: "timber new was cancelled before anything was changed.", output: null } }, created: null, setup: null },
				kept: null,
			};
		case "failed":
			return { run: { outcome: { ok: false, failure: result.failure }, created: null, setup: null }, kept: result.created ? result.worktree : null };
	}
}

/** The words on the dialog for where the mode is. */
export function describeStep(step: NewBranchStep): { submitLabel: string; submitLabels: readonly string[]; runningLabel: string; failureTitle: string } {
	const submitLabels = ["Create worktree", "Run setup"];
	if (step.kind === "form") {
		return { submitLabel: "Create worktree", submitLabels, runningLabel: "Creating the worktree", failureTitle: "Could not create the worktree" };
	}
	return {
		submitLabel: "Run setup",
		submitLabels,
		runningLabel: "Starting setup",
		failureTitle: `Created ${reportedLabel(step.worktree)}, but Timber stopped before setup`,
	};
}

export interface NewBranchModel {
	getState(): NewBranchState;
	/** Hear about every change of state. Returns a function that stops listening. */
	subscribe(listener: () => void): () => void;
	/** Change fields. Ignored once the worktree exists. */
	edit(change: Partial<NewBranchFields>): void;
	/** Leave "Run setup" and show the form again. The worktree stays as it is. */
	backToForm(): void;
	/**
	 * Read the trackers the repository has set up, for the Tracker field.
	 * Only the latest read counts. Never throws.
	 */
	readTrackers(): Promise<void>;
	/**
	 * Run `timber new` from the form, with `workflow` when it is not null and
	 * the name read with `tracker` (see `newWorktreeRequest`), once per call and never again by itself. Once the worktree exists, ask for its setup session instead,
	 * which runs nothing here. Either way a run that worked reports the
	 * worktree as created, because this mode made it.
	 */
	/** `tag` is given to the worktree if Timber creates one (see `AppStore.newWorktree`). */
	run(workflow?: string | null, tracker?: IssueTracker | null, tag?: string): Promise<ModeRun>;
}

type Actions = Pick<AppStore, "newWorktree" | "readIssueTrackers">;

/** `repository` is the path of the primary checkout the worktree is created in. */
export function createNewBranchModel(store: Actions, repository: string): NewBranchModel {
	const listeners = new Set<() => void>();
	let state: NewBranchState = { fields: { name: "", base: "", workflow: null, tracker: null }, step: { kind: "form" }, trackers: undefined };
	let latestRead = 0;

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
		async readTrackers() {
			const read = ++latestRead;
			const trackers = await store.readIssueTrackers(repository);
			if (read === latestRead) update({ trackers });
		},
		async run(workflow = null, tracker = null, tag) {
			const { step } = state;
			if (step.kind === "setup") {
				const label = reportedLabel(step.worktree);
				return { outcome: { ok: true, toast: `Opened ${label}` }, created: step.worktree, setup: step.worktree, workflow: step.workflow, startedToast: `Setup started in ${label}` };
			}
			const result = await store.newWorktree(newWorktreeRequest(repository, state.fields, workflow, tracker), tag);
			const { run, kept } = afterNew(result);
			if (kept) update({ step: { kind: "setup", worktree: kept, workflow } });
			return { ...run, workflow };
		},
	};
}
