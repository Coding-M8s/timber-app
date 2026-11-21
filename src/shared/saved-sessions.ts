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

/** How many launches in a row a saved session may fail to open before it is dropped. */
export const SAVED_MISS_LIMIT = 3;

export type SavedSession =
	/** A shell. `name` only when the person renamed the chip. */
	| { kind: "terminal"; name?: string; missed?: number }
	/**
	 * An agent by its name in Settings. `conversation` is a UUID, only when one is known.
	 * `missed`: how many launches in a row it failed to open, from 1 up to `SAVED_MISS_LIMIT` - 1.
	 */
	| { kind: "agent"; agent: string; conversation?: string; name?: string; missed?: number };

export interface SavedWorktree {
	/** The index into `sessions` of the chip that showed. */
	shown: number;
	sessions: SavedSession[];
}

export interface SavedSessions {
	/** The selected worktree's id (`Worktree.id`), when one was selected. */
	selected?: string;
	/**
	 * By worktree id (`Worktree.id`), with no prototype, so any id is only a
	 * key. A worktree with no running session and nothing carried is not here.
	 */
	worktrees: Record<string, SavedWorktree>;
}

/** Which saved session a session opens again: the worktree's id and the session's index there, in what was read at launch. */
export interface RestoreTag {
	worktree: string;
	index: number;
}

/** Whether a value is a restore tag as a request may carry it. */
export function isRestoreTag(value: unknown): value is RestoreTag {
	if (!isRecord(value)) return false;
	const { worktree, index } = value;
	return typeof worktree === "string" && worktree !== "" && Number.isInteger(index) && (index as number) >= 0 && (index as number) < SAVED_SESSIONS_PER_WORKTREE;
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
	const missed = value.missed;
	const extra = {
		...(name === null ? {} : { name }),
		...(Number.isInteger(missed) && (missed as number) >= 1 && (missed as number) < SAVED_MISS_LIMIT ? { missed: missed as number } : {}),
	};
	if (value.kind === "terminal") return { kind: "terminal", ...extra };
	if (value.kind !== "agent") return null;
	const agent = value.agent;
	if (typeof agent !== "string" || cleanSessionName(agent) !== agent) return null;
	return { kind: "agent", agent, ...(isConversationId(value.conversation) ? { conversation: value.conversation } : {}), ...extra };
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
	const worktrees: Record<string, SavedWorktree> = Object.create(null);
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
	/** The saved session it opened again, when it did. */
	restored?: RestoreTag | null;
}

/**
 * Where the shown chip goes among sessions that came from saved ones: the
 * one at the saved index, else the nearest one before it, else the first
 * that has one. `indexes` holds each session's saved index, or null for a
 * session that came from none. The position in `indexes`, or -1.
 */
export function pickShown(indexes: readonly (number | null)[], shown: number): number {
	let exact = -1;
	let before = -1;
	let first = -1;
	for (const [position, index] of indexes.entries()) {
		if (index === null) continue;
		if (index === shown && exact < 0) exact = position;
		if (index < shown && (before < 0 || index > indexes[before]!)) before = position;
		if (first < 0 || index < indexes[first]!) first = position;
	}
	return exact >= 0 ? exact : before >= 0 ? before : first;
}

/**
 * What became of the sessions read at launch, in this run. Kept in memory
 * only, for the save at quit, so a saved session that did not open again in
 * this run is not lost: quitting while they still open, a repository that is
 * unavailable, a window reloaded meanwhile, or an agent that could not start
 * today.
 */
export interface SavedCarry {
	/** What was read at launch, or null. */
	readonly previous: SavedSessions | null;
	/** The saved session opened again, or must not come back (its agent left Settings): it is not carried. */
	settle(tag: RestoreTag): void;
	/** The saved session could not open now. It is carried with one more miss, and dropped at `SAVED_MISS_LIMIT`. */
	miss(tag: RestoreTag): void;
	/** The window found these saved worktrees gone, so nothing of them is carried. */
	forget(worktrees: readonly string[]): void;
	/** The saved sessions to carry, by worktree id, each with its index, in order. */
	pending(): Map<string, { index: number; session: SavedSession }[]>;
}

export function createSavedCarry(previous: SavedSessions | null): SavedCarry {
	const settled = new Set<string>();
	const misses = new Map<string, number>();
	const forgotten = new Set<string>();
	const key = (tag: RestoreTag) => `${tag.index}\0${tag.worktree}`;
	const known = (tag: RestoreTag) => previous !== null && Object.hasOwn(previous.worktrees, tag.worktree) && tag.index < previous.worktrees[tag.worktree]!.sessions.length;
	return {
		previous,
		settle(tag) {
			if (known(tag)) settled.add(key(tag));
		},
		miss(tag) {
			if (!known(tag) || settled.has(key(tag))) return;
			// One miss per run is enough: the next launch tries again.
			if (misses.has(key(tag))) return;
			const before = previous!.worktrees[tag.worktree]!.sessions[tag.index]!.missed ?? 0;
			if (before + 1 >= SAVED_MISS_LIMIT) settled.add(key(tag));
			else misses.set(key(tag), before + 1);
		},
		forget(worktrees) {
			for (const worktree of worktrees) forgotten.add(worktree);
		},
		pending() {
			const carried = new Map<string, { index: number; session: SavedSession }[]>();
			if (previous === null) return carried;
			for (const [worktree, saved] of Object.entries(previous.worktrees)) {
				if (forgotten.has(worktree)) continue;
				const entries: { index: number; session: SavedSession }[] = [];
				for (const [index, session] of saved.sessions.entries()) {
					const tag = { worktree, index };
					if (settled.has(key(tag))) continue;
					const missed = misses.get(key(tag));
					entries.push({ index, session: missed === undefined ? session : { ...session, missed } });
				}
				if (entries.length > 0) carried.set(worktree, entries);
			}
			return carried;
		},
	};
}

/**
 * The smallest file that brings `live` back: grouped by worktree, in order.
 * `shown` maps a worktree id to the id of the session whose chip showed;
 * one that is gone shows the first. With `carry`, the saved sessions that
 * did not open again in this run are kept in their saved order among those
 * that did, and a worktree the window never reported keeps its saved chip
 * shown. Optional fields are left out, never null.
 */
export function buildSavedSessions(live: readonly LiveSession[], shown: Readonly<Record<string, string>>, selected: string | null, carry?: SavedCarry): SavedSessions {
	interface Item { id: string | null; index: number | null; session: SavedSession }
	const items = new Map<string, Item[]>();
	for (const session of live) {
		// An agent is always named; one that is not could not be opened again.
		if (session.kind === "agent" && session.agent === null) continue;
		const named = session.name === null ? {} : { name: session.name };
		const saved: SavedSession = session.kind === "terminal"
			? { kind: "terminal", ...named }
			: { kind: "agent", agent: session.agent!, ...(session.conversation === null ? {} : { conversation: session.conversation }), ...named };
		const tag = session.restored;
		const index = tag && tag.worktree === session.worktree ? tag.index : null;
		const list = items.get(session.worktree) ?? [];
		list.push({ id: session.id, index, session: saved });
		items.set(session.worktree, list);
	}
	const pending = carry?.pending() ?? new Map<string, { index: number; session: SavedSession }[]>();
	for (const [worktree, entries] of pending) {
		const list = items.get(worktree) ?? [];
		for (const entry of entries) {
			// A session opened from it runs, though the window was not told in time: that one counts.
			if (list.some(item => item.index === entry.index)) continue;
			// Before the first session that came later in the saved order, or that was opened in this run.
			const at = list.findIndex(item => item.index === null || item.index > entry.index);
			list.splice(at < 0 ? list.length : at, 0, { id: null, index: entry.index, session: entry.session });
		}
		if (list.length > 0) items.set(worktree, list);
	}
	const worktrees: Record<string, SavedWorktree> = Object.create(null);
	const previous = carry?.previous ?? null;
	// Within what a file is read with: the worktrees with running sessions come first, then those only carried.
	for (const [worktree, whole] of [...items].slice(0, SAVED_WORKTREE_LIMIT)) {
		const list = whole.slice(0, SAVED_SESSIONS_PER_WORKTREE);
		let at = -1;
		if (Object.hasOwn(shown, worktree)) at = list.findIndex(item => item.id === shown[worktree]);
		else if (previous !== null && Object.hasOwn(previous.worktrees, worktree)) at = pickShown(list.map(item => item.index), previous.worktrees[worktree]!.shown);
		worktrees[worktree] = { shown: at < 0 ? 0 : at, sessions: list.map(item => item.session) };
	}
	const chosen = selected ?? previous?.selected ?? null;
	return { ...(chosen === null ? {} : { selected: chosen }), worktrees };
}
