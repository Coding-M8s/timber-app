import { useState } from "react";
import type { Repository } from "../../shared/model";
import { useStore, useSubmission } from "../store/react";
import type { SubmissionState } from "../store/submission";
import { OperationDialog } from "./OperationDialog";
import { ModeSwitch } from "./worktree-modes/ModeSwitch";
import { useExistingBranchMode } from "./worktree-modes/existing-branch";
import type { WorktreeDialogMode } from "./worktree-modes/mode";
import { useNewBranchMode } from "./worktree-modes/new-branch";

interface WorktreeDialogFrameProps {
	repository: Repository;
	modes: readonly WorktreeDialogMode[];
	/** The position of the mode on screen in `modes`. */
	selected: number;
	submission: SubmissionState;
	onSelect: (index: number) => void;
	/** Run the mode on screen. */
	onSubmit: (mode: WorktreeDialogMode) => void;
	onClose: () => void;
}

/**
 * The worktree dialog as a drawing of its modes: one `OperationDialog` for
 * whichever mode is selected. The switch shows only when there is a choice.
 */
export function WorktreeDialogFrame({ repository, modes, selected, submission, onSelect, onSubmit, onClose }: WorktreeDialogFrameProps) {
	const mode = modes[selected] ?? modes[0];
	if (!mode) return null;
	return (
		<OperationDialog
			title={`New worktree in ${repository.name}`}
			headerAside={modes.length > 1 && (
				<ModeSwitch labels={modes.map(candidate => candidate.label)} selected={modes.indexOf(mode)} disabled={submission.running} onSelect={onSelect} />
			)}
			command={mode.command}
			submission={submission}
			submitLabel={mode.submitLabel}
			runningLabel={mode.runningLabel}
			failureTitle={mode.failureTitle}
			canSubmit={mode.canSubmit}
			onSubmit={() => onSubmit(mode)}
			onClose={onClose}
		>
			{mode.fields}
		</OperationDialog>
	);
}

/**
 * The dialog behind the "+" of a repository. It owns the one submission and
 * which mode is selected; each mode brings its fields, its command, and what
 * running it means. Add a mode by adding its hook to `modes`.
 */
export function NewWorktreeDialog({ repository }: { repository: Repository }) {
	const store = useStore();
	const { submission, state } = useSubmission(() => store.closeDialog());
	const modes = [useNewBranchMode(repository, submission), useExistingBranchMode(repository, submission)];
	const [selected, setSelected] = useState(0);
	return (
		<WorktreeDialogFrame
			repository={repository}
			modes={modes}
			selected={selected}
			submission={state}
			onSelect={index => {
				if (state.running) return;
				setSelected(index);
				submission.clearFailure();
			}}
			onSubmit={mode => void submission.submit(() => mode.run())}
			onClose={() => store.closeDialog()}
		/>
	);
}
