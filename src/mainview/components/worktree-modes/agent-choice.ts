import { type AgentSetting, describeAgentCommand, findAgent } from "../../../shared/agent";
import type { ReportedWorktree } from "../../../shared/model";
import type { AppStore } from "../../store/store";
import type { SubmissionOutcome } from "../../store/submission";

/**
 * The agent the New worktree dialog starts after it made a worktree. Pure,
 * apart from `runWithAgent`, so all of it is tested without a window.
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

/** What one run of a mode came to, and the worktree it finished making, if it made one. */
export interface ModeRun {
	outcome: SubmissionOutcome;
	/** Set only when the run worked and the worktree is one this dialog created. The agent starts here. */
	created: ReportedWorktree | null;
}

/** The note and the command shown under the Timber command, or null when no agent will start. */
export function agentFollowUp(agent: AgentSetting | null, start: AgentStart): { note: string; command: string } | null {
	if (agent === null || start === "never") return null;
	const note = start === "always"
		? `Then starts ${agent.name} in the new worktree:`
		: `Then, if this creates a worktree, starts ${agent.name} in it:`;
	return { note, command: describeAgentCommand(agent) ?? agent.command };
}

/**
 * Run a mode, then start the agent in the worktree it created. The agent is
 * started without waiting for it, so the dialog closes at once, and an agent
 * that cannot start is shown in the worktree's pane, never as a failure of
 * the dialog: the worktree is there either way. When the list does not have
 * the worktree, so there is no pane, the toast says the agent did not start.
 */
export async function runWithAgent(
	store: Pick<AppStore, "startAgentIn">,
	repository: string,
	run: () => Promise<ModeRun>,
	agent: AgentSetting | null,
): Promise<SubmissionOutcome> {
	const { outcome, created } = await run();
	if (!outcome.ok || !created || !agent) return outcome;
	if (store.startAgentIn(repository, created, agent.name)) return outcome;
	return { ok: true, toast: `${outcome.toast}. ${agent.name} did not start: the worktree is not in the list yet. Refresh, then start it from the worktree.` };
}
