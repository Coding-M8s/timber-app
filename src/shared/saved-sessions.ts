import { cleanSessionName } from "./terminal";

/**
 * The sessions that ran when the app last quit, for opening them again on the
 * next launch. Pure: the main process writes the file once, at quit (see
 * src/bun/session-layout.ts), and the window opens each saved session again
 * through the ordinary `openTerminal` (see src/mainview/store/restore.ts).
 *
 * Only what cannot be worked out again at launch is kept: per worktree, the
 * kinds of its running sessions in chip order, a name the person gave a chip,
 * an agent's name in Settings and the id of its own conversation, and which
 * chip showed. No session ids, folders, commands, shells, states, or output.
 */

export const SAVED_SESSIONS_VERSION = 1;
/** The most worktrees a file is read with. More is a hand-edited file, not a desk. */
export const SAVED_WORKTREE_LIMIT = 200;
/** The most sessions of one worktree a file is read with. */
export const SAVED_SESSIONS_PER_WORKTREE = 50;

export type SavedSession =
	/** A shell. `name` only when the person renamed the chip. */
	| { kind: "terminal"; name?: string }
	/** An agent by its name in Settings. `conversation` is a UUID, only when one is known. */
	| { kind: "agent"; agent: string; conversation?: string; name?: string };

export interface SavedWorktree {
	/** The index into `sessions` of the chip that showed. */
	shown: number;
	sessions: SavedSession[];
}

export interface SavedSessions {
	/** The selected worktree's id (`Worktree.id`), when one was selected. */
	selected?: string;
	/** By worktree id (`Worktree.id`). A worktree with no running session is not here. */
	worktrees: Record<string, SavedWorktree>;
}

export type SavedSessionsRead =
	| { ok: true; saved: SavedSessions }
	/** `damaged`: not a file of this kind. `newer`: written by a later version of the app. */
	| { ok: false; reason: "damaged" | "newer" };

const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether a value can be an agent's conversation id: a UUID and nothing else, so it can never read as an option. */
export function isConversationId(value: unknown): value is string {
	return typeof value === "string" && CONVERSATION_ID.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One saved session as read, or null when it cannot be trusted. */
function readSession(value: unknown): SavedSession | null {
	if (!isRecord(value)) return null;
	const name = cleanSessionName(value.name);
	const named = name === null ? {} : { name };
	if (value.kind === "terminal") return { kind: "terminal", ...named };
	if (value.kind !== "agent") return null;
	const agent = value.agent;
	if (typeof agent !== "string" || cleanSessionName(agent) !== agent) return null;
	return { kind: "agent", agent, ...(isConversationId(value.conversation) ? { conversation: value.conversation } : {}), ...named };
}

/** One saved worktree as read, or null when nothing of it can be trusted. */
function readWorktree(value: unknown): SavedWorktree | null {
	if (!isRecord(value) || !Array.isArray(value.sessions)) return null;
	const sessions: SavedSession[] = [];
	// Where the shown chip is among the sessions that are kept.
	const shownAt = Number.isInteger(value.shown) && (value.shown as number) >= 0 && (value.shown as number) < value.sessions.length ? value.shown as number : 0;
	let shown = 0;
	for (const [index, entry] of value.sessions.entries()) {
		if (sessions.length >= SAVED_SESSIONS_PER_WORKTREE) break;
		const session = readSession(entry);
		if (session === null) continue;
		if (index <= shownAt) shown = sessions.length;
		sessions.push(session);
	}
	return sessions.length === 0 ? null : { shown, sessions };
}

/**
 * The saved sessions in a file's text. A file that is not one of this kind is
 * damaged; one of a later version is refused. Inside a good file nothing is
 * fatal: what cannot be trusted is dropped piece by piece, and counts are
 * capped, so nothing unchecked reaches a command line.
 */
export function parseSavedSessions(text: string): SavedSessionsRead {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return { ok: false, reason: "damaged" };
	}
	if (!isRecord(data) || !Number.isInteger(data.version) || (data.version as number) < 1 || !isRecord(data.worktrees)) return { ok: false, reason: "damaged" };
	if ((data.version as number) > SAVED_SESSIONS_VERSION) return { ok: false, reason: "newer" };
	const worktrees: Record<string, SavedWorktree> = {};
	let count = 0;
	for (const [id, value] of Object.entries(data.worktrees)) {
		if (count >= SAVED_WORKTREE_LIMIT) break;
		const worktree = readWorktree(value);
		if (worktree === null) continue;
		worktrees[id] = worktree;
		count += 1;
	}
	return { ok: true, saved: { ...(typeof data.selected === "string" ? { selected: data.selected } : {}), worktrees } };
}

/**
 * The text of the file: indented with tabs, with a final line break, as the
 * settings file, and each session on a line of its own, so the file stays
 * small and still reads by hand.
 */
export function serializeSavedSessions(saved: SavedSessions): string {
	const worktrees = Object.entries(saved.worktrees).map(([id, worktree]) => {
		const sessions = worktree.sessions.map(session => `\t\t\t\t${JSON.stringify(session)}`).join(",\n");
		return `\t\t${JSON.stringify(id)}: {\n\t\t\t"shown": ${JSON.stringify(worktree.shown)},\n\t\t\t"sessions": [${sessions === "" ? "" : `\n${sessions}\n\t\t\t`}]\n\t\t}`;
	});
	const lines = [`\t"version": ${SAVED_SESSIONS_VERSION}`];
	if (saved.selected !== undefined) lines.push(`\t"selected": ${JSON.stringify(saved.selected)}`);
	lines.push(`\t"worktrees": {${worktrees.length === 0 ? "" : `\n${worktrees.join(",\n")}\n\t`}}`);
	return `{\n${lines.join(",\n")}\n}\n`;
}

/** One running session, as the main process knows it at quit. In chip order. */
export interface LiveSession {
	id: string;
	/** The worktree's id (`Worktree.id`). */
	worktree: string;
	kind: "terminal" | "agent";
	/** The agent's name in Settings, for an agent. */
	agent: string | null;
	/** The agent's own conversation id, when one is known. */
	conversation: string | null;
	/** Only when the person renamed the chip. */
	name: string | null;
}

/**
 * The smallest file that brings `live` back: grouped by worktree, in order.
 * `shown` maps a worktree id to the id of the session whose chip showed;
 * an unknown one shows the first. Optional fields are left out, never null.
 */
export function buildSavedSessions(live: readonly LiveSession[], shown: Readonly<Record<string, string>>, selected: string | null): SavedSessions {
	const worktrees: Record<string, SavedWorktree> = {};
	const ids: Record<string, string[]> = {};
	for (const session of live) {
		// An agent is always named; one that is not could not be opened again.
		if (session.kind === "agent" && session.agent === null) continue;
		const worktree = worktrees[session.worktree] ??= { shown: 0, sessions: [] };
		(ids[session.worktree] ??= []).push(session.id);
		const named = session.name === null ? {} : { name: session.name };
		worktree.sessions.push(session.kind === "terminal"
			? { kind: "terminal", ...named }
			: { kind: "agent", agent: session.agent!, ...(session.conversation === null ? {} : { conversation: session.conversation }), ...named });
	}
	for (const [id, worktree] of Object.entries(worktrees)) {
		const index = shown[id] === undefined ? -1 : ids[id]!.indexOf(shown[id]!);
		worktree.shown = index < 0 ? 0 : index;
	}
	return { ...(selected === null ? {} : { selected }), worktrees };
}
