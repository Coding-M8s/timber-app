import { useEffect, useState, useSyncExternalStore } from "react";
import type { Repository } from "../../../shared/model";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "../../../shared/timber-result";
import { openWorktreeArguments } from "../../../shared/worktree-commands";
import { useStore } from "../../store/react";
import type { Submission } from "../../store/submission";
import { BranchField } from "../BranchField";
import { type ExistingBranchForm, type ExistingBranchFormState, canOpen, createExistingBranchForm, openRequest } from "./existing-branch-form";
import type { WorktreeDialogMode } from "./mode";
import { reportedLabel } from "./new-branch-model";
import { WorkflowField, type WorkflowOptions, chosenWorkflow } from "./workflow-choice";

/**
 * The "Existing branch" mode as the dialog shows it, for one state of its
 * form. `repository` is the path of the primary checkout, and `running` is
 * true while the dialog's command runs.
 */
export function existingBranchMode(
	form: ExistingBranchForm,
	state: ExistingBranchFormState,
	repository: string,
	running: boolean,
	workflows: WorkflowOptions = undefined,
): WorktreeDialogMode {
	const { selector, setup, branches, kept } = state;
	// The command and the run take the same workflow, so the footer shows what runs.
	// A kept worktree runs setup again with the workflow of the run that failed, as New branch does.
	const workflow = kept ? kept.workflow : chosenWorkflow(workflows, state.workflow);

	const fields = (
		<>
			<BranchField label="Branch, ticket, or worktree path" value={selector} branches={branches} disabled={running} onChange={form.setSelector} />
			<WorkflowField options={workflows} chosen={workflow} disabled={running} onPick={form.setWorkflow} />
			<label className="check">
				<input type="checkbox" checked={setup} onChange={event => form.setSetup(event.target.checked)} />
				<span className="check-text">
					<span>Rerun setup</span>
					<span className="check-hint">Runs the setup scripts in a terminal also when the worktree already exists. A new worktree always gets them.</span>
				</span>
			</label>
			{kept && (
				<p className="dialog-note" role="status">
					{reportedLabel(kept.worktree)} has its worktree, and it is selected in the list. Nothing needs to be created again.
					The fields now name that worktree with Rerun setup ticked: once the cause is fixed, submit to open it and run setup in a terminal, or close this dialog.
				</p>
			)}
		</>
	);

	return {
		label: "Existing branch",
		fields,
		// Worded from the same request that `run` sends, so the command shown is the command that runs.
		command: describeTimberCommand(openWorktreeArguments(openRequest(repository, state, workflow), RESULT_FILE_PLACEHOLDER)),
		canSubmit: canOpen(state),
		submitLabel: "Open worktree",
		runningLabel: "Opening the worktree",
		failureTitle: kept
			? kept.created ? "The worktree was created, but Timber stopped before setup" : "The worktree was opened, but Timber did not finish"
			: "Could not open the worktree",
		// Only Timber knows whether the text names a worktree that is already there. One kept from a failed run is known.
		agentStart: kept ? (kept.created ? "always" : "never") : "if-created",
		// Ticked, setup runs whatever Timber says. Otherwise only Timber's answer says whether it left setup scripts.
		setupStart: setup ? "always" : "if-skipped",
		worktree: kept?.worktree.path ?? null,
		workflow,
		run: () => form.run(workflow),
	};
}

/**
 * "Existing branch": `timber open`. The person types a branch, a ticket key,
 * or a worktree path, or picks a branch from the list. The text goes to
 * Timber without the spaces around it and otherwise as given, and Timber
 * alone decides what it means.
 */
export function useExistingBranchMode(repository: Repository, submission: Submission, workflows: WorkflowOptions): WorktreeDialogMode {
	const store = useStore();
	const [form] = useState(() => createExistingBranchForm(store, repository.path, submission));
	const state = useSyncExternalStore(form.subscribe, form.getState, form.getState);
	// Read when the dialog opens, and again whenever the repository was read again: the other mode may have made a branch.
	useEffect(() => {
		void form.readBranches();
	}, [form, repository]);
	return existingBranchMode(form, state, repository.path, submission.getState().running, workflows);
}
