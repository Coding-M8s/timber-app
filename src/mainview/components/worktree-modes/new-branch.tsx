import { useState, useSyncExternalStore } from "react";
import type { Repository } from "../../../shared/model";
import { useStore } from "../../store/react";
import type { Submission } from "../../store/submission";
import type { WorktreeDialogMode } from "./mode";
import { type NewBranchModel, type NewBranchState, canCreate, createNewBranchModel, describeStep, reportedLabel, shownCommand } from "./new-branch-model";

/**
 * The "New branch" mode drawn from its model (see ./new-branch-model.ts).
 * A plain function, so every state can be rendered in a test.
 *
 * Two things in the agreed mock are left out on purpose. The launcher
 * checkboxes belong to later tickets, and this dialog always runs Timber
 * with --no-editor --no-agent. A line predicting the branch and folder would
 * mean guessing what Timber resolves, which only Timber knows.
 */
export function newBranchMode(
	model: NewBranchModel,
	state: NewBranchState,
	repository: Repository,
	submission: Pick<Submission, "clearFailure">,
): WorktreeDialogMode {
	const { fields, step } = state;
	const edit = (change: Partial<NewBranchState["fields"]>) => {
		model.edit(change);
		submission.clearFailure();
	};
	return {
		label: "New branch",
		command: shownCommand(repository.path, state),
		canSubmit: step.kind === "setup" || canCreate(fields),
		...describeStep(step),
		run: () => model.run(),
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
						<span className="field-hint">A branch name, a sentence, or a ticket. Timber decides the branch and the folder.</span>
					</label>
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
				</>
			)
			: (
				<div className="dialog-outcome">
					<p className="dialog-outcome-text">
						{reportedLabel(step.worktree)} was created and is in the list, but its setup did not finish.
					</p>
					<p className="dialog-outcome-text path">{step.worktree.path}</p>
					<p className="dialog-outcome-text">
						Open with setup runs every setup script again in that worktree, from the first one. Nothing is created again.
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
export function useNewBranchMode(repository: Repository, submission: Submission): WorktreeDialogMode {
	const store = useStore();
	const [model] = useState(() => createNewBranchModel(store, repository.path));
	const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
	return newBranchMode(model, state, repository, submission);
}
