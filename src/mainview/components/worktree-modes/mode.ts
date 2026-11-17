import type { ReactNode } from "react";
import type { AgentStart, ModeRun } from "./agent-choice";

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
	/** Whether the picked agent starts after the next run works (see ./agent-choice.ts). */
	agentStart: AgentStart;
	/** Run the command the footer shows. The frame starts the picked agent in the worktree it reports as created. */
	run(): Promise<ModeRun>;
}
