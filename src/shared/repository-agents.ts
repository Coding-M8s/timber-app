/**
 * The default agent each repository names, by the path of its primary
 * checkout: the name of one of the agents in Settings, Agents. Kept in the
 * app's settings, beside the repository (`SavedRepository.agent` in
 * ./settings.ts), never in the repository itself and never in Timber's
 * `[agent]` table. What it decides is in ./agent-lookup.ts. Pure.
 */
import { type AgentSetting, findAgent } from "./agent";
import { cleanSessionName } from "./terminal";

/** The pick of each repository that has one, by the path of its primary checkout. */
export type RepositoryAgents = Readonly<Record<string, string>>;

/** Picks to save, by primary checkout: an agent's name, or null to go back to the first agent found. Others stay as they are. */
export type RepositoryAgentChange = Readonly<Record<string, string | null>>;

/** A saved repository as picks see it. */
interface PickedEntry {
	path: string;
	agent?: string;
}

/** Whether a value is a name an agent can have, as typed in Settings. */
export function isAgentName(value: unknown): value is string {
	return typeof value === "string" && value !== "" && cleanSessionName(value) === value;
}

/** The picks of the saved repositories. */
export function repositoryAgentsOf(entries: readonly PickedEntry[]): RepositoryAgents {
	return Object.fromEntries(entries.flatMap(({ path, agent }) => agent === undefined ? [] : [[path, agent]]));
}

/** One repository's pick, or null for none. */
export function pickOf(picks: RepositoryAgents, path: string): string | null {
	return Object.hasOwn(picks, path) ? picks[path]! : null;
}

/** The picks without a repository that left the app. */
export function forgetRepositoryAgent(picks: RepositoryAgents, path: string): RepositoryAgents {
	return Object.fromEntries(Object.entries(picks).filter(([picked]) => picked !== path));
}

/** A change from outside, or undefined when any of it cannot be read. */
export function readRepositoryAgentChange(value: unknown): RepositoryAgentChange | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const entries = Object.entries(value);
	return entries.every(([path, name]) => path !== "" && (name === null || isAgentName(name))) ? Object.fromEntries(entries) : undefined;
}

/**
 * The repositories once `change` is saved with the agents `after`, in place
 * of `before`. A path that is not listed is skipped. A name that is not
 * among `after` is refused. A pick whose agent was saved and is not any more
 * is cleared; one that named no saved agent already, as after an edit by
 * hand, stays, so no other agent takes its place unasked. A rename is a
 * change of the pick in the same save.
 */
export function withRepositoryAgents<Entry extends PickedEntry>(
	entries: readonly Entry[],
	change: RepositoryAgentChange,
	before: readonly AgentSetting[],
	after: readonly AgentSetting[],
): { ok: true; entries: Entry[]; changed: boolean } | { ok: false; message: string } {
	let changed = false;
	const next: Entry[] = [];
	for (const entry of entries) {
		const named = Object.hasOwn(change, entry.path) ? change[entry.path]! : undefined;
		if (typeof named === "string" && findAgent(after, named) === null && named !== entry.agent) {
			return { ok: false, message: `Nothing was saved, because no agent called "${named}" is saved in Settings, Agents.` };
		}
		const kept = entry.agent !== undefined && findAgent(before, entry.agent) !== null && findAgent(after, entry.agent) === null ? null : entry.agent ?? null;
		// Naming the pick it has already changes nothing, so it is cleared with its agent all the same.
		const agent = named === undefined || named === entry.agent ? kept : named;
		if (agent === (entry.agent ?? null)) {
			next.push(entry);
			continue;
		}
		changed = true;
		const { agent: _, ...rest } = entry;
		next.push((agent === null ? rest : { ...rest, agent }) as Entry);
	}
	return { ok: true, entries: next, changed };
}
