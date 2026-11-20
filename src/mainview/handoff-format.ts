import type { AgentSetting } from "../shared/agent";
import type { WorktreeHandoff } from "../shared/handoff";
import { displayText } from "../shared/timber-record";

/**
 * What the window does with a worktree `timber new` handed over from one of
 * its terminals, and what it says when it cannot. Pure, so it is tested
 * without a window.
 */

/** The session to open: the first saved agent when Timber wanted its agent and one is saved, else a shell. */
export function handoffAgent(handoff: WorktreeHandoff, agents: readonly AgentSetting[]): AgentSetting | null {
	// As the New worktree dialog does when nobody picked one: the first saved agent (`chosenAgent`).
	return handoff.agent ? agents[0] ?? null : null;
}

/** A path from the record, quoted for a shell as Timber prints its retry commands. */
function quoted(path: string): string {
	return `'${path.replaceAll("'", "'\\''")}'`;
}

/** The worktree is not in the list, so there is no pane to open it in. */
export function describeHandoffNotListed(handoff: WorktreeHandoff): string {
	const where = displayText(handoff.worktree);
	const then = handoff.agent
		? ` Add its repository, then start the agent with: timber open --agent --no-editor -- ${displayText(quoted(handoff.worktree))}`
		: " Add its repository to open it here.";
	return `timber new made ${where}, but it is not in the list, so no session opened.${then}`;
}

/** Timber wanted its agent, and Settings has none to start, so a terminal opened instead. */
export const HANDOFF_NO_AGENT = "timber new asked for an agent, but none is saved in Settings, Agents, so a terminal opened instead.";
