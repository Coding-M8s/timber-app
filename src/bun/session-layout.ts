import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, writeSync } from "node:fs";
import { open, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { type AgentId, type ConversationStore, agentById } from "../shared/agent-registry";
import type { Attention } from "../shared/attention";
import { type SavedCarry, type SavedSessions, buildSavedSessions, createSavedCarry, isRestoreTag, parseSavedSessions, serializeSavedSessions } from "../shared/saved-sessions";
import type { OpenTerminalResult } from "../shared/terminal";
import type { ConversationSearch } from "./agent-conversations";
import type { RunningSession } from "./terminals";

/**
 * Which sessions run in which worktree, kept from one run of the app to the
 * next (see docs/architecture.md, "After a restart").
 *
 * - The file is read once at launch, and the window takes what it holds
 *   once, to open those sessions again through the ordinary `openTerminal`.
 * - It is written once, at quit, synchronously, from the sessions that run
 *   right then: never while the app runs, so a crash brings back what the
 *   last clean quit saved. A session that was closed is left out, so it
 *   stays closed.
 * - A saved session that was not opened again in this run is kept: one the
 *   window had not reached by quit or by a reload, one in a repository that
 *   was unavailable, or one that failed to start, up to `SAVED_MISS_LIMIT`
 *   launches in a row. It is dropped when its agent left Settings, or when
 *   the window found its worktree gone (see ../shared/saved-sessions.ts).
 * - Which chip shows comes from the window's `attend` reports: chips are
 *   switched only in the selected worktree, which the report names. A
 *   worktree the window never reported keeps the chip that showed before.
 * - The conversation id of an agent that cannot be given the id of a new
 *   one (Codex, Cursor CLI: its recipe has no `fresh`) is read at quit from
 *   the agent's own files (see ./agent-conversations.ts), in the folder it
 *   started with, only for a session that ran in its worktree with no other
 *   session of the same agent since it started, running with the same
 *   folder, or ended. Otherwise nothing tells their conversations apart, so
 *   it keeps the id it was opened with, if any.
 * - The id of an agent that was given one (Claude Code, Grok Build) is saved
 *   only when the agent wrote that conversation, so one that never got a
 *   message, or never got that far, starts fresh, without a note that it was
 *   not found. Both are looked for in the folder the session's agent kept
 *   its conversations in when it started (`RunningSession.conversationFolder`).
 */

/** The key of `endedAgents`: the agent of the registry and the worktree's id. */
export function endedKey(program: AgentId, worktree: string): string {
	return JSON.stringify([program, worktree]);
}

/** Where the file is: beside the settings file. */
export function sessionsFilePath(settingsFile: string): string {
	return join(dirname(settingsFile), "sessions.json");
}

/** The time the conversation checks at quit may take in all, in milliseconds. */
const CONVERSATION_SEARCH_MILLISECONDS = 300;
/** A file larger than this is not one the app wrote: 200 worktrees of 50 sessions are well under it. */
export const SESSIONS_FILE_LIMIT = 4 * 1024 * 1024;
/** An agent can write its conversation a moment before the app learns the session started. */
const START_SLACK_MILLISECONDS = 2000;

export interface SessionLayoutDependencies {
	file: string;
	running: () => RunningSession[];
	/** When the last session of each agent of the registry, however it was started, ended or closed in each worktree in this run (`endedKey`). */
	endedAgents?: () => ReadonlyMap<string, number>;
	/** The search at quit for an agent whose id is not known when it starts, in its folder (see ./agent-conversations.ts). Null when none was found. */
	find: (store: ConversationStore, options: ConversationSearch & { budget: number }) => string | null;
	/** Whether the agent wrote the conversation with this id in this folder. */
	exists?: (store: ConversationStore, id: string, folder: string) => boolean;
	warn?: (message: string) => void;
	now?: () => number;
}

export interface SessionLayout {
	/** Read the file. Never throws. A damaged file is moved to sessions.json.damaged. A newer one is left alone, and nothing is saved in this run. */
	load(): Promise<void>;
	/** What was loaded, the first time it is asked for. Null after that, and when there was nothing. */
	take(): SavedSessions | null;
	/** What came of opening a saved session again (`OpenTerminalRequest.restore`); a thrown error is "failed". */
	restored(tag: unknown, outcome: OpenTerminalResult["outcome"]): void;
	/** The window found these saved worktrees gone. */
	forget(worktrees: unknown): void;
	/** The window said which worktree is selected and which chip shows there. */
	attend(attention: Attention): void;
	/** Write the file now, synchronously, from the sessions that run. Does nothing the second time, until `resume`. Never throws. */
	save(): void;
	/** Quitting did not happen after all: the next quit saves again. */
	resume(): void;
	/** Delete the file and its leftovers and save nothing from now on. For uninstalling with settings. */
	discard(): void;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createSessionLayout(dependencies: SessionLayoutDependencies): SessionLayout {
	const { file, running, find, endedAgents = () => new Map<string, number>(), exists = () => true, warn = console.warn, now = Date.now } = dependencies;
	let loaded: SavedSessions | null = null;
	let carry: SavedCarry = createSavedCarry(null);
	/** A file of a later version is there: it is left for that version. */
	let newer = false;
	let saved = false;
	let discarded = false;
	/** The session whose chip showed last, by worktree id. */
	const shown: Record<string, string> = {};
	let selected: string | null = null;

	/** Every session with the conversation it is in, read again from the agent's own files where that is exact. */
	function withConversations(live: RunningSession[]): RunningSession[] {
		const taken = new Set(live.flatMap(session => session.conversation === null ? [] : [session.conversation]));
		const deadline = now() + CONVERSATION_SEARCH_MILLISECONDS;
		const found = new Map<string, string | null>();
		// First the ids the app gave (Claude Code, Grok Build), which are quick to check: such an id is only a conversation once the agent wrote it.
		for (const session of live) {
			const recipe = session.resumable === null ? null : agentById(session.resumable).resume;
			if (recipe === null || recipe.fresh === null || session.conversation === null || session.conversationFolder === null) continue;
			if (deadline - now() <= 0) break;
			let written = true;
			try {
				written = exists(recipe.conversations.store, session.conversation, session.conversationFolder);
			} catch {
				// Then it keeps what it has.
			}
			if (!written) found.set(session.id, null);
		}
		// Every session of an agent found at quit, by agent, worktree, and folder, however it was started, so one started as typed is never taken for another. Sessions with different folders keep their conversations apart.
		const groups = new Map<string, RunningSession[]>();
		for (const session of live) {
			if (session.program === null) continue;
			const recipe = agentById(session.program).resume;
			if (recipe === null || recipe.fresh !== null) continue;
			const key = JSON.stringify([session.program, session.worktree, session.conversationFolder]);
			groups.set(key, [...groups.get(key) ?? [], session]);
		}
		const ended = endedAgents();
		for (const sessions of groups.values()) {
			if (sessions.length !== 1) continue;
			const [session] = sessions as [RunningSession];
			if (session.resumable === null || session.resumable !== session.program || session.conversationFolder === null) continue;
			const since = session.startedAt - START_SLACK_MILLISECONDS;
			// Another session of the same agent ran here meanwhile and ended: its conversation could be taken for this one's.
			const rival = ended.get(endedKey(session.program, session.worktree));
			if (rival !== undefined && rival >= since) continue;
			const budget = deadline - now();
			if (budget <= 0) break;
			const own = new Set(taken);
			if (session.conversation !== null) own.delete(session.conversation);
			let id: string | null = null;
			try {
				id = find(agentById(session.program).resume!.conversations.store, { folder: session.conversationFolder, cwd: session.path, since, taken: own, budget });
			} catch {
				// Then it keeps what it has.
			}
			if (id === null || own.has(id)) continue;
			found.set(session.id, id);
			taken.add(id);
		}
		return live.map(session => found.has(session.id) ? { ...session, conversation: found.get(session.id)! } : session);
	}

	/** The file's text, or null when it is too large to be one the app wrote. */
	async function readLimited(path: string): Promise<string | null> {
		const handle = await open(path, "r");
		try {
			const size = (await handle.stat()).size;
			if (size > SESSIONS_FILE_LIMIT) return null;
			const buffer = Buffer.alloc(size + 1);
			let length = 0;
			while (length < buffer.length) {
				const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
				if (bytesRead === 0) break;
				length += bytesRead;
			}
			// It grew while it was read: not a file the app is writing now.
			return length > size ? null : buffer.subarray(0, length).toString("utf8");
		} finally {
			await handle.close();
		}
	}

	function write(text: string): void {
		mkdirSync(dirname(file), { recursive: true });
		const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
		try {
			const descriptor = openSync(temporary, "wx");
			try {
				writeSync(descriptor, text);
				fsyncSync(descriptor);
			} finally {
				closeSync(descriptor);
			}
			renameSync(temporary, file);
		} catch (error) {
			rmSync(temporary, { force: true });
			throw error;
		}
	}

	return {
		async load() {
			let text: string | null;
			try {
				text = await readLimited(file);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") warn(`Could not read ${file}, so no sessions open again: ${messageOf(error)}`);
				return;
			}
			const read = text === null ? { ok: false as const, reason: "damaged" as const } : parseSavedSessions(text);
			if (read.ok) {
				loaded = Object.keys(read.saved.worktrees).length > 0 ? read.saved : null;
				carry = createSavedCarry(loaded);
				return;
			}
			if (read.reason === "newer") {
				newer = true;
				warn(`${file} was written by a newer version of the app, so no sessions open again and it is left as it is.`);
				return;
			}
			const kept = `${file}.damaged`;
			try {
				await rename(file, kept);
				warn(`${file} is damaged, so no sessions open again. It was moved to ${kept}.`);
			} catch (error) {
				warn(`${file} is damaged, so no sessions open again, and it could not be moved to ${kept}: ${messageOf(error)}`);
			}
		},
		take() {
			const taken = loaded;
			loaded = null;
			return taken;
		},
		restored(tag, outcome) {
			if (!isRestoreTag(tag)) return;
			// Its agent left Settings: it cannot come back. Any other failure may pass by the next launch.
			if (outcome === "opened" || outcome === "not-configured") carry.settle(tag);
			else carry.miss(tag);
		},
		forget(worktrees) {
			if (Array.isArray(worktrees)) carry.forget(worktrees.filter((worktree): worktree is string => typeof worktree === "string"));
		},
		attend(attention) {
			if (attention.selected === null) return;
			selected = attention.selected.id;
			if (attention.session !== null) shown[attention.selected.id] = attention.session;
		},
		save() {
			if (saved || newer || discarded) return;
			saved = true;
			try {
				const live = withConversations(running());
				write(serializeSavedSessions(buildSavedSessions(live, shown, selected, carry)));
			} catch (error) {
				warn(`Could not save which sessions are open to ${file}: ${messageOf(error)}`);
			}
		},
		resume() {
			saved = false;
		},
		discard() {
			discarded = true;
			const folder = dirname(file);
			const name = basename(file);
			let entries: string[];
			try {
				entries = readdirSync(folder);
			} catch {
				return;
			}
			for (const entry of entries) {
				const ours = entry === name || entry === `${name}.damaged` || (entry.startsWith(`${name}.`) && entry.endsWith(".tmp"));
				if (!ours) continue;
				try {
					rmSync(join(folder, entry), { force: true });
				} catch (error) {
					warn(`Could not delete ${join(folder, entry)}: ${messageOf(error)}`);
				}
			}
		},
	};
}
