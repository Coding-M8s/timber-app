import type { AgentSetting } from "./agent";

/**
 * Whether each saved agent's executable is there to start, as the main
 * process looks for it when an agent session starts: a name on the PATH the
 * app was started with, or a full path that is an executable file. Pure:
 * the main process looks (see `locateAgent` in src/bun/find-executable.ts),
 * and the interface says what it found and picks no missing agent on its own.
 */

export type AgentLookup =
	/** `path` is the executable file that starts. */
	| { state: "found"; path: string }
	/** A name not on the PATH, or a full path with no executable file there. */
	| { state: "not-found" }
	/**
	 * Found, or not looked for, but the app does not start it: a relative path,
	 * or on Windows a `.cmd` or `.bat` file. `message` says why.
	 */
	| { state: "unusable"; message: string };

/** One saved agent, by its name and command as saved when it was looked for, and what the look found. */
export interface AgentLocation {
	name: string;
	command: string;
	lookup: AgentLookup;
}

/** What was found for an agent, or null when it was not looked for with its command as it is now. */
export function lookupOf(locations: readonly AgentLocation[] | null, agent: AgentSetting): AgentLookup | null {
	return locations?.find(location => location.name === agent.name && location.command === agent.command)?.lookup ?? null;
}

/** Whether an agent was looked for and its executable is there to start. */
export function agentFound(locations: readonly AgentLocation[] | null, agent: AgentSetting): boolean {
	return lookupOf(locations, agent)?.state === "found";
}

/** Whether every one of the agents was looked for with its command as it is now. */
export function agentsLocated(locations: readonly AgentLocation[] | null, agents: readonly AgentSetting[]): boolean {
	return agents.every(agent => lookupOf(locations, agent) !== null);
}

/** What Settings says beside an agent: where it was found, or that it was not. `executable` is the first word of its command. */
export function describeAgentLookup(executable: string, lookup: AgentLookup): string {
	if (lookup.state === "found") return `Found at ${lookup.path}`;
	if (lookup.state === "unusable") return lookup.message;
	return isFullPath(executable) ? `No executable file at ${executable}` : "Not found on PATH";
}

/** Whether an executable is a full path, on any platform, rather than a name to look for on the PATH. */
export function isFullPath(executable: string): boolean {
	return /^(?:[\\/]|[A-Za-z]:[\\/])/.test(executable);
}

/** The mark beside an agent's name in the New worktree dialog's Agent field, or null for none. */
export function agentMark(lookup: AgentLookup | null): string | null {
	if (lookup === null || lookup.state === "found") return null;
	return lookup.state === "not-found" ? "not found" : "cannot start";
}
