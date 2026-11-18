import { type AgentSetting, describeAgentCommand, findAgent } from "../../../shared/agent";
import type { ReportedWorktree } from "../../../shared/model";
import { NEW_WORKTREE_PLACEHOLDER, describeTimberCommand } from "../../../shared/timber-result";
import { worktreeSetupArguments } from "../../../shared/worktree-commands";
import type { AppStore } from "../../store/store";
import type { SubmissionOutcome } from "../../store/submission";

/**
 * What the New worktree dialog starts after it opened a worktree: setup and
 * the picked agent. Pure, apart from `runAndStart`, so all of it is tested
 * without a window.
 *
 * Timber always runs with `--no-agent`. The app starts the picked agent
 * itself, as an agent session through `openTerminal`, so the main process
 * takes the command from the saved Settings and never from the dialog.
 */

/**
 * What the person picked in the Agent field: a name, null for None, or
 * undefined while they have not touched it, which means the first agent.
 */
export type AgentPick = string | null | undefined;

/** The agent that will start, or null for none. A picked name that is no longer saved falls back to the first agent. */
export function chosenAgent(agents: readonly AgentSetting[], pick: AgentPick): AgentSetting | null {
	if (pick === null) return null;
	if (pick !== undefined) {
		const picked = findAgent(agents, pick);
		if (picked) return picked;
	}
	return agents[0] ?? null;
}

/**
 * Whether a mode starts the agent after its next run works:
 * `always` when that run finishes a worktree this dialog created,
 * `if-created` when only Timber's answer can say whether it creates one,
 * and `never` when it cannot create one.
 */
export type AgentStart = "always" | "if-created" | "never";

/** What one run of a mode came to, and what starts in the worktree it opened. */
export interface ModeRun {
	outcome: SubmissionOutcome;
	/** Set only when the run worked and the worktree is one this dialog created. The agent starts here. */
	created: ReportedWorktree | null;
	/** Set only when the run worked and the worktree's setup scripts are to run, in a session of their own. */
	setup: ReportedWorktree | null;
	/** The workflow the run passed, which the setup session passes again: Timber does not remember it. Null or left out for none. */
	workflow?: string | null;
}

/** A line of the footer under the Timber command: what it says, and the command that starts. */
export interface FollowUp {
	note: string;
	command: string;
}

/**
 * Whether a mode runs setup in a session after its next run works, as
 * `AgentStart` says for the agent. `if-skipped` when only Timber's answer
 * can say whether there are setup scripts it left for the app to run.
 */
export type SetupStart = "always" | "if-skipped" | "never";

/** The setup session's command, worded for the footer: with the worktree's path when it is known, and the workflow, if any. */
export function setupCommand(worktree: string | null, workflow: string | null = null): string {
	return describeTimberCommand(worktreeSetupArguments(worktree ?? NEW_WORKTREE_PLACEHOLDER, workflow ?? undefined));
}

/** The notes and commands shown under the Timber command, in the order they start: setup, then the agent. */
export function followUps(agent: AgentSetting | null, start: AgentStart, setup: SetupStart, worktree: string | null = null, workflow: string | null = null): FollowUp[] {
	const lines: FollowUp[] = [];
	if (setup !== "never") {
		lines.push({
			note: setup === "always"
				? "Then runs setup in a terminal in the worktree, without waiting for it:"
				: "Then, if Timber left setup scripts to run, runs them in a terminal in the worktree, without waiting for them:",
			command: setupCommand(worktree, workflow),
		});
	}
	if (agent !== null && start !== "never") {
		const where = start === "always" ? "in the new worktree" : "in it, if this creates a worktree";
		lines.push({
			note: setup === "never" ? `Then starts ${agent.name} ${where}:` : `And starts ${agent.name} beside setup, ${where}:`,
			command: describeAgentCommand(agent) ?? agent.command,
		});
	}
	return lines;
}

/**
 * Run a mode, then start setup and the agent in the worktree it opened. They
 * start without waiting, so the dialog closes at once, and the agent does not
 * wait for setup either. A session that cannot start is shown in the
 * worktree's pane, never as a failure of the dialog: the worktree is there
 * either way. When the list does not have the worktree, so there is no pane,
 * the toast says what did not start.
 */
export async function runAndStart(
	store: Pick<AppStore, "startSessionsIn">,
	repository: string,
	run: () => Promise<ModeRun>,
	agent: AgentSetting | null,
): Promise<SubmissionOutcome> {
	const { outcome, created, setup, workflow = null } = await run();
	if (!outcome.ok) return outcome;
	const startsAgent = created !== null && agent !== null;
	const worktree = setup ?? (startsAgent ? created : null);
	if (worktree === null) return outcome;
	// Setup and the agent start in the same worktree: the one the run reported.
	if (store.startSessionsIn(repository, worktree, { setup: setup !== null, ...(workflow === null ? {} : { workflow }), agent: startsAgent ? agent.name : null })) return outcome;
	const missed = [setup !== null ? "Setup" : null, startsAgent ? agent.name : null].filter(name => name !== null).join(" and ");
	return { ok: true, toast: `${outcome.toast}. ${missed} did not start: the worktree is not in the list yet. Refresh, then start it from the worktree.` };
}
