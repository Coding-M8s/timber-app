import { AGENT_LIMIT, AGENT_PRESETS, type AgentSetting, agentProblem, describeAgentCommand, sameAgentName, sameAgentSettings } from "../shared/agent";
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

/** What choosing entry `index` of the "+" menu does: start the shell or an agent, or open Settings at Agents, the entry after them. */
export type SessionMenuChoice = { kind: "start"; agent: string | null } | { kind: "set-up" };

export function sessionMenuChoice(items: readonly SessionMenuItem[], index: number): SessionMenuChoice | null {
	if (!Number.isInteger(index) || index < 0 || index > items.length) return null;
	return index < items.length ? { kind: "start", agent: items[index]!.agent } : { kind: "set-up" };
}

/** The title of the note in the pane when a session did not start. */
export function describeSessionProblemTitle(problem: Pick<TerminalProblem, "agent">): string {
	return problem.agent === null ? "The terminal did not start" : `${problem.agent} did not start`;
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
}

let lastKey = 0;
const nextKey = () => `agent-${++lastKey}`;

/** The rows that show what is saved. */
export function agentDraftsOf(saved: readonly AgentSetting[]): AgentDraft[] {
	return saved.map(agent => ({ key: nextKey(), name: agent.name, command: agent.command }));
}

/** The rows with one more at the end: a preset, or an empty one to fill in. */
export function addAgentDraft(drafts: readonly AgentDraft[], preset?: AgentSetting): AgentDraft[] {
	return [...drafts, { key: nextKey(), name: preset?.name ?? "", command: preset?.command ?? "" }];
}

export function editAgentDraft(drafts: readonly AgentDraft[], key: string, change: { name?: string; command?: string }): AgentDraft[] {
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
		const setting = { name: cleanSessionName(draft.name) ?? "", command: draft.command.trim() };
		const problem = agentProblem(setting, agents.map(agent => agent.name));
		agents.push(setting);
		return { key: draft.key, problem, example: describeAgentCommand(setting) };
	});
	const error = drafts.length > AGENT_LIMIT ? `The list can hold ${AGENT_LIMIT} agents at most. Remove ${drafts.length - AGENT_LIMIT}.` : null;
	const valid = error === null && rows.every(row => row.problem === null);
	return { rows, agents, error, canSave: valid && !sameAgentSettings(agents, saved) };
}
