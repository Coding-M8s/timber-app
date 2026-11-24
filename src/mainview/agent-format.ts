import { AGENT_LIMIT, AGENT_PRESETS, type AgentSetting, agentCommand, agentProblem, conversationsOf, describeAgentCommand, rowAgent, sameAgentName, sameAgentSettings } from "../shared/agent";
import { AGENTS, type AgentId, executableName } from "../shared/agent-registry";
import { resumableAgent } from "../shared/agent-resume";
import { type AgentLocation, describeAgentLookup, lookupOf } from "../shared/agent-lookup";
import { generateOf } from "../shared/generate-text";
import { describeCommandLine } from "../shared/command-line";
import { cleanSessionName } from "../shared/terminal";
import type { TerminalProblem } from "./store/state";

/**
 * Words and rules for agent sessions: the "+" menu of a worktree's sessions
 * and the Agents section of Settings. Pure, so they can be tested without a
 * window.
 */

/** One entry of the "+" menu: the shell, or an agent by its name. */
export interface SessionMenuItem {
	/** Null for the shell, otherwise the agent's name, which the request names. */
	agent: string | null;
	label: string;
	/** What it starts: "Your shell", or the agent's exact command. */
	detail: string;
}

/** The entries of the "+" menu: the shell first, then every agent in the order of Settings. */
export function sessionMenuItems(agents: readonly AgentSetting[]): SessionMenuItem[] {
	return [
		{ agent: null, label: "Terminal", detail: "Your shell" },
		...agents.map(agent => ({ agent: agent.name, label: agent.name, detail: describeAgentCommand(agent) ?? agent.command })),
	];
}

/**
 * The entry a key moves to in a menu of `count` entries from `index`: the
 * arrows step and wrap around, Home and End jump to the first and the last.
 * Null for any other key.
 */
export function menuIndexAfterKey(count: number, index: number, key: string): number | null {
	if (count === 0) return null;
	switch (key) {
		case "ArrowDown":
			return (index + 1) % count;
		case "ArrowUp":
			return (index + count - 1) % count;
		case "Home":
			return 0;
		case "End":
			return count - 1;
		default:
			return null;
	}
}

/**
 * What choosing entry `index` of the "+" menu does. The entries are the
 * shell and the agents (`items`), then the repository's command chops by
 * name (`chops`), then "Set up agents", which opens Settings at Agents.
 */
export type SessionMenuChoice = { kind: "start"; agent: string | null } | { kind: "chop"; name: string } | { kind: "set-up" };

export function sessionMenuChoice(items: readonly SessionMenuItem[], index: number, chops: readonly { name: string }[] = []): SessionMenuChoice | null {
	if (!Number.isInteger(index) || index < 0 || index > items.length + chops.length) return null;
	if (index < items.length) return { kind: "start", agent: items[index]!.agent };
	if (index < items.length + chops.length) return { kind: "chop", name: chops[index - items.length]!.name };
	return { kind: "set-up" };
}

/** What a workflow's agent is called while it starts, or when it did not, before Timber has said what it runs. */
export function workflowAgentLabel(workflow: string): string {
	return `the ${workflow} workflow's agent`;
}

/** The title of the note in the pane when a session did not start. */
export function describeSessionProblemTitle(problem: Pick<TerminalProblem, "agent">): string {
	if (problem.agent === null) return "The terminal did not start";
	// A workflow's agent is named in a phrase that starts the sentence; a saved agent's name is kept as typed.
	return `${problem.agent.replace(/^the /, "The ")} did not start`;
}

/** What "+" says it does while a session starts, or when it can start one. */
export function describeStarting(agent: string | null): string {
	return agent === null ? "Starting a terminal" : `Starting ${agent}`;
}

/** One agent as typed in the Agents section and not saved yet. `key` tells rows apart while they are edited. */
export interface AgentDraft {
	key: string;
	name: string;
	command: string;
	/** The agent picked for the row, or "" for "Detect from command". */
	agent: AgentId | "";
	/** Its config folder as typed, or "" for the agent's default. */
	configFolder: string;
}

/** What a row's fields can change. */
export type AgentDraftChange = Partial<Pick<AgentDraft, "name" | "command" | "agent" | "configFolder">>;

let lastKey = 0;
const nextKey = () => `agent-${++lastKey}`;

/** The rows that show what is saved. */
export function agentDraftsOf(saved: readonly AgentSetting[]): AgentDraft[] {
	return saved.map(agent => ({ key: nextKey(), name: agent.name, command: agent.command, agent: agent.agent ?? "", configFolder: agent.configFolder ?? "" }));
}

/** The rows with one more at the end: a preset, or an empty one to fill in. */
export function addAgentDraft(drafts: readonly AgentDraft[], preset?: AgentSetting): AgentDraft[] {
	return [...drafts, { key: nextKey(), name: preset?.name ?? "", command: preset?.command ?? "", agent: "", configFolder: "" }];
}

export function editAgentDraft(drafts: readonly AgentDraft[], key: string, change: AgentDraftChange): AgentDraft[] {
	return drafts.map(draft => draft.key === key ? { ...draft, ...change } : draft);
}

export function removeAgentDraft(drafts: readonly AgentDraft[], key: string): AgentDraft[] {
	return drafts.filter(draft => draft.key !== key);
}

/** The presets that no row has yet, by name, to offer as one click each. */
export function presetsToAdd(drafts: readonly AgentDraft[]): AgentSetting[] {
	return AGENT_PRESETS.filter(preset => !drafts.some(draft => sameAgentName(cleanSessionName(draft.name) ?? "", preset.name)));
}

export interface AgentRowModel {
	key: string;
	/** Why this row cannot be saved, or null. */
	problem: string | null;
	/** The exact command it runs, or null when it cannot be read. */
	example: string | null;
	/** The words of the Agent picker's first choice, such as "Detect from command (Claude Code)". */
	detectLabel: string;
	/**
	 * The Config folder field, shown only when the row's agent, picked or
	 * detected, keeps its conversations in a folder: the variable the agent
	 * starts with, and the agent's own folder for the placeholder.
	 */
	folder: { variable: string; placeholder: string } | null;
	/** What the row says under its fields about going back to a conversation, or null. */
	hint: string | null;
}

/** The choices of a row's Agent picker after "Detect from command": each agent of the registry, by its name. */
export const AGENT_CHOICES: readonly { id: AgentId; name: string }[] = AGENTS.map(agent => ({ id: agent.id, name: agent.name }));

/** Whether an executable is a name other programs install too, such as `agent`, which only the main process can tell apart by the file it leads to. */
function sharedName(executable: string): boolean {
	const name = executableName(executable);
	return AGENTS.some(agent => agent.sharedExecutables.includes(name));
}

/** What a row's Agent picker, Config folder, and hint show, from the row as typed. */
function rowExtras(draft: AgentDraft, setting: AgentSetting): Pick<AgentRowModel, "detectLabel" | "folder" | "hint"> & { kept: boolean } {
	const command = agentCommand(setting);
	const executable = command.ok ? command.executable : "";
	const detected = command.ok ? rowAgent({}, executable) : null;
	const shared = command.ok && detected === null && sharedName(executable);
	const detectLabel = `Detect from command (${detected?.name ?? (shared ? "known once it starts" : "not recognized")})`;
	const agent = draft.agent === "" ? detected : rowAgent({ agent: draft.agent }, executable);
	const conversations = conversationsOf(agent);
	const folder = conversations === null ? null : { variable: conversations.folderVariable, placeholder: `Default: ~/${conversations.folder}` };
	const typed = draft.configFolder.trim();
	let hint: string | null = null;
	// A command that starts as typed, such as `claude --continue`, still gets the folder, but the app does not take it back to a conversation.
	const resumes = command.ok && resumableAgent(executable, command.arguments, null, agent?.id ?? null) !== null;
	if (folder !== null && typed !== "") hint = resumes ? `Starts with ${folder.variable} set to this folder, and goes back to its conversation from there after a restart.` : `Starts with ${folder.variable} set to this folder.`;
	else if (draft.agent === "" && command.ok && detected === null && !shared) hint = "Not recognized from its command, so it starts fresh after a restart. Pick its agent to go back to its conversation.";
	return { detectLabel, folder, hint, kept: folder !== null && typed !== "" };
}

export interface AgentsDraftModel {
	rows: AgentRowModel[];
	/** What Save would save, with names cleaned up. */
	agents: AgentSetting[];
	/** Why the list as a whole cannot be saved, or null. */
	error: string | null;
	canSave: boolean;
}

/**
 * What the Agents section's rows amount to. A name is cleaned up as a
 * session name, and must differ from the names before it, ignoring case.
 */
export function agentsDraftModel(drafts: readonly AgentDraft[], saved: readonly AgentSetting[]): AgentsDraftModel {
	const agents: AgentSetting[] = [];
	const rows: AgentRowModel[] = drafts.map(draft => {
		const setting: AgentSetting = { name: cleanSessionName(draft.name) ?? "", command: draft.command.trim() };
		if (draft.agent !== "") setting.agent = draft.agent;
		const { kept, ...extras } = rowExtras(draft, setting);
		// A folder is kept only while its field shows: one typed for an agent that keeps no conversations in a folder is dropped.
		if (kept) setting.configFolder = draft.configFolder.trim();
		const problem = agentProblem(setting, agents.map(agent => agent.name));
		agents.push(setting);
		return { key: draft.key, problem, example: describeAgentCommand(setting), ...extras, hint: problem === null ? extras.hint : null };
	});
	const error = drafts.length > AGENT_LIMIT ? `The list can hold ${AGENT_LIMIT} agents at most. Remove ${drafts.length - AGENT_LIMIT}.` : null;
	const valid = error === null && rows.every(row => row.problem === null);
	return { rows, agents, error, canSave: valid && !sameAgentSettings(agents, saved) };
}

/** The agents the Agents section offers to write text: every row the registry says how to run once. Keys, so a rename or removal is followed. */
export interface GenerateOption {
	key: string;
	name: string;
	/** What it keeps or can still reach, or null. */
	caveat: string | null;
	command: string;
}

export function generateOptions(drafts: readonly AgentDraft[], agents: readonly AgentSetting[]): GenerateOption[] {
	return drafts.flatMap((draft, index) => {
		const setting = agents[index]!;
		const found = generateOf(setting);
		const command = agentCommand(setting);
		return found === null || !command.ok || setting.name === "" ? [] : [{ key: draft.key, name: setting.name, caveat: found.generate.caveat, command: describeCommandLine([command.executable, ...found.generate.arguments]) }];
	});
}

/** What a row of the Agents section says about its agent's executable, and whether that is a problem. */
export interface AgentLookupLine {
	text: string;
	missing: boolean;
}

/**
 * Whether a row's agent was found, as it was saved and last looked for. A
 * row that differs from what is saved was not looked for: it says to save
 * first. Null while the saved agent is not known yet.
 */
export function agentLookupLine(setting: AgentSetting, saved: readonly AgentSetting[], locations: readonly AgentLocation[] | null): AgentLookupLine | null {
	const isSaved = saved.some(agent => agent.name === setting.name && agent.command === setting.command);
	if (!isSaved) return { text: "Save to check whether it is installed.", missing: false };
	const lookup = lookupOf(locations, setting);
	if (lookup === null) return null;
	const command = agentCommand(setting);
	return { text: describeAgentLookup(command.ok ? command.executable : setting.command, lookup), missing: lookup.state !== "found" };
}
