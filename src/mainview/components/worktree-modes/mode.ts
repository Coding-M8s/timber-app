import type { ReactNode } from "react";
import type { AgentStart, FollowUp, ModeRun, SetupStart } from "./agent-choice";

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
	/** Whether setup runs in a session after the next run works (see ./agent-choice.ts). */
	setupStart: SetupStart;
	/** The path of the worktree the next run opens, when it is known before it runs, for the footer. */
	worktree: string | null;
	/** The workflow the next run passes, or null for none. The setup session passes it again, so the footer shows it there too. */
	workflow: string | null;
	/** Run the command the footer shows. The frame starts setup and the picked agent in the worktree it reports. */
	run(): Promise<ModeRun>;
	/**
	 * Set for a mode that starts its own agents, as Arena does for each
	 * attempt: the footer shows these lines in place of setup and the picked
	 * agent, and the dialog has no Agent field.
	 */
	ownFollowUps?: readonly FollowUp[];
	/** Shown right below a failure, for what the person should know next. */
	failureNote?: ReactNode;
	/** Why this mode cannot be chosen now, or null or left out when it can. The switch shows it and keeps the mode off. */
	unavailable?: string | null;
}
