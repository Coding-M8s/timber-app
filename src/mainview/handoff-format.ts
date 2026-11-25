import type { AgentSetting } from "../shared/agent";
import { type AgentLocation, type MissingPick, type NoDefaultAgent, type RepositoryPick, defaultAgent, describeMissingPick, whyNoDefaultAgent } from "../shared/agent-lookup";
import type { WorktreeHandoff } from "../shared/handoff";
import { displayText } from "../shared/timber-record";

/**
 * What the window does with a worktree `timber new` handed over from one of
 * its terminals, and what it says when it cannot. Pure, so it is tested
 * without a window.
 */

/**
 * The session to open: the default agent (`defaultAgent`: the one
 * the repository names, `pick`, or the first saved agent found) when Timber wanted its agent, else a terminal. A terminal
 * that opens in place of the agent Timber wanted comes with the toast that
 * says why; one Timber asked for comes with none.
 */
export function handoffSession(handoff: WorktreeHandoff, agents: readonly AgentSetting[], locations: readonly AgentLocation[] | null, pick: RepositoryPick): { kind: "agent"; agent: AgentSetting } | { kind: "terminal"; toast: string | null } {
	if (!handoff.agent) return { kind: "terminal", toast: null };
	const agent = defaultAgent(agents, locations, pick);
	return agent === null ? { kind: "terminal", toast: handoffNoAgent(whyNoDefaultAgent(agents, locations, pick)) } : { kind: "agent", agent };
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

/** Timber wanted its agent, and there is no default agent to start, so a terminal opened instead: why, by the reason. */
export const HANDOFF_NO_AGENT: Readonly<Record<Exclude<NoDefaultAgent, MissingPick>, string>> = {
	"none-saved": "timber new asked for an agent, but none is saved in Settings, Agents, so a terminal opened instead.",
	"none-found": "timber new asked for an agent, but none of the agents in Settings, Agents was found, so a terminal opened instead. Settings, Agents says why for each.",
	"not-known": "timber new asked for an agent, but the app could not find out which agents are installed, so a terminal opened instead.",
};

/** The toast for a terminal opened in place of the agent: why, and, for a repository's default agent that cannot start, which one it is. */
export function handoffNoAgent(why: NoDefaultAgent): string {
	if (typeof why !== "object") return HANDOFF_NO_AGENT[why];
	return `timber new asked for an agent, but ${describeMissingPick(why)}, so a terminal opened instead.${why.state === "not-saved" ? "" : " Settings, Agents says why."}`;
}
