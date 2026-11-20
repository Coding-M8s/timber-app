import { useEffect, useState, useSyncExternalStore } from "react";
import type { Repository } from "../../../shared/model";
import { useStore } from "../../store/react";
import type { Submission } from "../../store/submission";
import type { WorktreeDialogMode } from "./mode";
import { type NewBranchModel, type NewBranchState, canCreate, createNewBranchModel, describeStep, reportedLabel, shownCommand } from "./new-branch-model";
import { TrackerField, chosenTracker } from "./tracker-choice";
import { WorkflowField, type WorkflowOptions, chosenWorkflow } from "./workflow-choice";

/**
 * The "New branch" mode drawn from its model (see ./new-branch-model.ts).
 * A plain function, so every state can be rendered in a test.
 *
 * Timber always runs with --no-setup --no-editor --no-agent. The frame
 * (../NewWorktreeDialog.tsx) owns the Agent field, and starts setup and the
 * picked agent itself once this mode reports the worktree it created. Two things in the agreed mock
 * are left out on purpose: the editor checkbox, and a line predicting the
 * branch and folder, which would mean guessing what only Timber knows.
 */
export function newBranchMode(
	model: NewBranchModel,
	state: NewBranchState,
	repository: Repository,
	submission: Pick<Submission, "clearFailure" | "getState">,
	workflows: WorkflowOptions = undefined,
): WorktreeDialogMode {
	const { fields, step } = state;
	const edit = (change: Partial<NewBranchState["fields"]>) => {
		model.edit(change);
		submission.clearFailure();
	};
	// The command and the run take the same workflow, so the footer shows what runs.
	const workflow = chosenWorkflow(workflows, fields.workflow);
	// So does the tracker: the footer shows the name with the prefix the run passes.
	const tracker = chosenTracker(state.trackers, fields.tracker);
	return {
		label: "New branch",
		command: shownCommand(repository.path, state, workflow, tracker),
		canSubmit: step.kind === "setup" || canCreate(fields),
		...describeStep(step),
		// `timber new` creates the worktree when it works, and "Run setup" finishes one this mode created.
		agentStart: "always",
		// From the form, only Timber's answer says whether there are setup scripts. Once the worktree exists, setup is the command itself.
		setupStart: step.kind === "form" ? "if-skipped" : "never",
		worktree: step.kind === "form" ? null : step.worktree.path,
		workflow: step.kind === "form" ? workflow : step.workflow,
		run: () => model.run(workflow, tracker),
		fields: step.kind === "form"
			? (
				<>
					<label className="field">
						<span className="field-label">Name</span>
						<input
							className="field-input"
							name="name"
							value={fields.name}
							placeholder="Fix login bug"
							autoComplete="off"
							spellCheck={false}
							autoFocus
							onChange={event => edit({ name: event.target.value })}
						/>
						<span className="field-hint">A branch name, a sentence, or an issue: github:123, jira:ENG-1, or linear:ENG-1. Timber decides the branch and the folder.</span>
					</label>
					<TrackerField options={state.trackers} chosen={tracker} disabled={submission.getState().running} onPick={pick => edit({ tracker: pick })} />
					<label className="field">
						<span className="field-label">Start from</span>
						<input
							className="field-input"
							name="base"
							value={fields.base}
							placeholder="Timber's configured base"
							autoComplete="off"
							spellCheck={false}
							onChange={event => edit({ base: event.target.value })}
						/>
						<span className="field-hint">Optional. A branch to start from instead.</span>
					</label>
					<WorkflowField options={workflows} chosen={workflow} disabled={submission.getState().running} onPick={pick => edit({ workflow: pick })} />
				</>
			)
			: (
				<div className="dialog-outcome">
					<p className="dialog-outcome-text">
						{reportedLabel(step.worktree)} was created and is in the list, but Timber stopped before its setup.
					</p>
					<p className="dialog-outcome-text path">{step.worktree.path}</p>
					<p className="dialog-outcome-text">
						Run setup runs every setup script in that worktree
						{step.workflow === null ? "" : `, with the ${step.workflow} workflow`}, in a terminal of its own, and closes this dialog. Nothing is created again.
					</p>
					<button
						type="button"
						className="text-button"
						onClick={() => {
							model.backToForm();
							submission.clearFailure();
						}}
					>
						Back to the form
					</button>
				</div>
			),
	};
}

/** The mode for creating a worktree on a new branch with `timber new`, in `repository`. */
export function useNewBranchMode(repository: Repository, submission: Submission, workflows: WorkflowOptions): WorktreeDialogMode {
	const store = useStore();
	const [model] = useState(() => createNewBranchModel(store, repository.path));
	const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
	// Read once when the dialog opens: each read runs Timber and Git, and file watching reads the repository again often.
	useEffect(() => {
		void model.readTrackers();
	}, [model]);
	return newBranchMode(model, state, repository, submission, workflows);
}
