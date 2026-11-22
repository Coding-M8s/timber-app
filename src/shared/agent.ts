import { AGENTS, type AgentDefinition, type AgentId, type AgentResume, agentByExecutable } from "./agent-registry";
import { isFullPath } from "./agent-lookup";
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
	/**
	 * Which agent of the registry the command runs, picked in Settings, or
	 * left out to know it by the executable's name ("Detect from command").
	 * A picked agent gives the session its mark, its status source, and its
	 * way back to a conversation whatever the executable is called, so a
	 * wrapper such as `claude-work` resumes as Claude Code.
	 */
	agent?: AgentId;
	/**
	 * Where the row's agent keeps its conversations, as typed: a full path,
	 * or one that starts with `~/`. Left out for the agent's default. Used
	 * only when the row's agent keeps its conversations in a folder
	 * (`resume.conversations` in the registry): the session starts with that
	 * agent's folder variable, such as `CLAUDE_CONFIG_DIR`, set to it, and its
	 * conversation is looked for there. Expanded only in the main process.
	 */
	configFolder?: string;
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
	if (!command.ok) return command.message;
	return configFolderProblem(setting.configFolder);
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
 * not clean, a repeated name, a config folder that is not a full path or
 * `~/`, or more than `AGENT_LIMIT` entries make it unreadable, so a save
 * never keeps half of what was asked. The one exception is an `agent` this
 * version does not know, which is read as detected from the command. A
 * config folder is kept whatever the row's agent is: the main process
 * ignores it for an agent that keeps no conversations in a folder.
 */
export function readAgentSettings(value: unknown): AgentSetting[] | undefined {
	if (!Array.isArray(value) || value.length > AGENT_LIMIT) return undefined;
	const agents: AgentSetting[] = [];
	for (const entry of value) {
		if (!isRecord(entry)) return undefined;
		const { name, command, agent, configFolder } = entry;
		if (typeof name !== "string" || typeof command !== "string") return undefined;
		if ((agent !== undefined && typeof agent !== "string") || (configFolder !== undefined && typeof configFolder !== "string")) return undefined;
		const setting: AgentSetting = { name, command };
		// An agent this version does not know, such as one a newer version added, is detected from the command instead: the one exception to reading the list whole.
		const known = AGENTS.find(candidate => candidate.id === agent);
		if (known !== undefined) setting.agent = known.id;
		const folder = configFolder?.trim();
		if (folder !== undefined && folder !== "") setting.configFolder = folder;
		if (cleanSessionName(name) !== name) return undefined;
		if (agentProblem(setting, agents.map(agent => agent.name)) !== null) return undefined;
		agents.push(setting);
	}
	return agents;
}

/** The agents preference as it is written to the settings file. */
export function writeAgentSettings(agents: readonly AgentSetting[]): { name: string; command: string; agent?: AgentId; configFolder?: string }[] {
	return agents.map(agent => ({
		name: agent.name,
		command: agent.command,
		...(agent.agent !== undefined ? { agent: agent.agent } : {}),
		...(agent.configFolder ? { configFolder: agent.configFolder } : {}),
	}));
}

export function sameAgentSettings(one: readonly AgentSetting[], other: readonly AgentSetting[]): boolean {
	return one.length === other.length && one.every((agent, index) => {
		const twin = other[index]!;
		return agent.name === twin.name && agent.command === twin.command && agent.agent === twin.agent && (agent.configFolder ?? "") === (twin.configFolder ?? "");
	});
}

/** Why a config folder cannot be used, or null when it can: empty, a full path on any platform, or one that starts with `~/`. */
export function configFolderProblem(folder: string | undefined): string | null {
	if (folder === undefined || folder === "") return null;
	return isFullPath(folder) || folder.startsWith("~/") ? null : "The config folder must be a full path or start with ~/.";
}

/** A config folder as a full path: `~/` is the home folder. Null for none or one that cannot be used. */
export function expandConfigFolder(folder: string | undefined, home: string): string | null {
	if (folder === undefined || folder === "" || configFolderProblem(folder) !== null) return null;
	if (!folder.startsWith("~/")) return folder;
	const rest = folder.slice(2);
	return home.endsWith("/") || home.endsWith("\\") ? `${home}${rest}` : `${home}/${rest}`;
}

/**
 * The agent of the registry a row runs: the one picked in Settings, else
 * the one its executable is by name (`agentByExecutable`, which `realPath`
 * helps tell a name other programs install too). Null when neither.
 */
export function rowAgent(setting: Pick<AgentSetting, "agent">, executable: string, realPath?: string | null): (AgentDefinition & { id: AgentId }) | null {
	if (setting.agent !== undefined) return AGENTS.find(agent => agent.id === setting.agent) ?? null;
	return agentByExecutable(executable, realPath);
}

/** Where a row's agent keeps its conversations, from the registry, or null when it keeps none the app reads. */
export function conversationsOf(agent: AgentDefinition | null): AgentResume["conversations"] | null {
	return agent?.resume?.conversations ?? null;
}
