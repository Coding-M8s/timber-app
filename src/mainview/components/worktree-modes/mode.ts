import type { ReactNode } from "react";
import type { SubmissionOutcome } from "../../store/submission";

/**
 * One way the worktree dialog can make a worktree, for example from a new
 * branch. The frame in ../NewWorktreeDialog.tsx draws whichever mode is
 * selected and runs it through the dialog's one submission.
 */
export interface WorktreeDialogMode {
	/** On the switch, for example "New branch". */
	label: string;
	fields: ReactNode;
	/** The exact command this mode is about to run, for the footer. */
	command: string;
	canSubmit: boolean;
	submitLabel: string;
	runningLabel: string;
	failureTitle: string;
	run(): Promise<SubmissionOutcome>;
}
