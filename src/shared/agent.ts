import { AGENTS } from "./agent-registry";
import { describeCommandLine, splitCommandLine } from "./command-line";
import { cleanSessionName, sessionKindName } from "./terminal";

/**
 * Coding agents that the "+" menu of a worktree's sessions starts, and how
 * their commands are read. Pure: the main process starts an agent in a
 * pseudo terminal (see src/bun/terminals.ts), and the interface shows the
 * command before it runs.
 *
 * The app only hosts an agent's session. It never reads, parses, or answers
 * what an agent prints.
 */

/** One configured agent: what its menu item and chips are called, and the command that starts it. */
export interface AgentSetting {
	/** Cleaned as a session name (`cleanSessionName`), and unique among the agents, ignoring case. */
	name: string;
	/**
	 * What to run, as typed in Settings, for example `claude` or
	 * `codex --model o4`. Split by `splitCommandLine`, never by a shell. It
	 * starts in the worktree's folder, and nothing is added to it.
	 */
	command: string;
}

/** Agents offered as a starting point in Settings, Agents: each agent of the registry, by its name and command. */
export const AGENT_PRESETS: readonly AgentSetting[] = AGENTS.map(agent => ({ name: agent.name, command: agent.command }));

/** The list before anything was saved: the presets of the registry's default agents, Claude Code and Codex. */
export const DEFAULT_AGENTS: readonly AgentSetting[] = AGENTS.filter(agent => agent.default).map(agent => ({ name: agent.name, command: agent.command }));

/** The most agents the list can hold. */
export const AGENT_LIMIT = 20;
/** The longest command an agent can have, in characters. */
export const AGENT_COMMAND_LIMIT = 1000;

export type AgentCommand =
	| { ok: true; executable: string; arguments: string[] }
	| { ok: false; message: string };

/** The executable and arguments that start an agent. */
export function agentCommand(setting: Pick<AgentSetting, "command">): AgentCommand {
	if (setting.command.length > AGENT_COMMAND_LIMIT) return { ok: false, message: `The command is longer than ${AGENT_COMMAND_LIMIT} characters.` };
	const reading = splitCommandLine(setting.command);
	if (!reading.ok) return { ok: false, message: `The command cannot be read: ${reading.message}` };
	const [executable, ...args] = reading.words;
	if (executable === undefined) return { ok: false, message: "The command is empty." };
	if (executable === "") return { ok: false, message: "The command starts with an empty word. Type the agent's executable first." };
	return { ok: true, executable, arguments: args };
}

/** The command that starts an agent, as one line for showing, or null when it cannot be read. */
export function describeAgentCommand(setting: Pick<AgentSetting, "command">): string | null {
	const command = agentCommand(setting);
	return command.ok ? describeCommandLine([command.executable, ...command.arguments]) : null;
}

const folded = (name: string) => name.toLocaleLowerCase();

/** Whether two agent names are the same name, ignoring case. */
export function sameAgentName(one: string, other: string): boolean {
	return folded(one) === folded(other);
}

/**
 * What is wrong with an agent's name and command, or null when it can be
 * saved. `others` are the names of the other agents in the list. "Terminal"
 * is taken by the plain shell in the same menu.
 */
export function agentProblem(setting: AgentSetting, others: readonly string[]): string | null {
	const name = cleanSessionName(setting.name);
	if (name === null) return "Give the agent a name.";
	if (sameAgentName(name, sessionKindName("terminal"))) return `"${name}" is the plain shell's name in the menu. Choose another.`;
	if (others.some(other => sameAgentName(other, name))) return `Another agent is already called "${name}".`;
	const command = agentCommand(setting);
	return command.ok ? null : command.message;
}

/** The agent of a list with exactly this name, or null. */
export function findAgent(agents: readonly AgentSetting[], name: string): AgentSetting | null {
	return agents.find(agent => agent.name === name) ?? null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The agents preference from outside, such as the settings file or a save
 * from the interface, or undefined when the value is not one. The list is
 * taken whole or not at all: one entry that cannot be read, a name that is
 * not clean, a repeated name, or more than `AGENT_LIMIT` entries make it
 * unreadable, so a save never keeps half of what was asked.
 */
export function readAgentSettings(value: unknown): AgentSetting[] | undefined {
	if (!Array.isArray(value) || value.length > AGENT_LIMIT) return undefined;
	const agents: AgentSetting[] = [];
	for (const entry of value) {
		if (!isRecord(entry)) return undefined;
		const { name, command } = entry;
		if (typeof name !== "string" || typeof command !== "string") return undefined;
		const setting = { name, command };
		if (cleanSessionName(name) !== name) return undefined;
		if (agentProblem(setting, agents.map(agent => agent.name)) !== null) return undefined;
		agents.push(setting);
	}
	return agents;
}

/** The agents preference as it is written to the settings file. */
export function writeAgentSettings(agents: readonly AgentSetting[]): { name: string; command: string }[] {
	return agents.map(agent => ({ name: agent.name, command: agent.command }));
}

export function sameAgentSettings(one: readonly AgentSetting[], other: readonly AgentSetting[]): boolean {
	return one.length === other.length && one.every((agent, index) => agent.name === other[index]!.name && agent.command === other[index]!.command);
}
