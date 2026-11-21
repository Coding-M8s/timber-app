import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, writeSync } from "node:fs";
import { open, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Attention } from "../shared/attention";
import { type SavedCarry, type SavedSessions, buildSavedSessions, createSavedCarry, isRestoreTag, parseSavedSessions, serializeSavedSessions } from "../shared/saved-sessions";
import type { OpenTerminalResult } from "../shared/terminal";
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
 * - A Codex session's conversation id is read at quit from Codex's own files
 *   (see ./agent-conversations.ts), only for a Codex session that ran in its
 *   folder with no other Codex session of the app since it started, running
 *   or ended. Otherwise nothing tells their conversations apart, so it keeps
 *   the id it was opened with, if any.
 * - A Claude Code session's id is saved only when Claude Code wrote that
 *   conversation, so one that never got a message starts fresh, without a
 *   note that it was not found.
 */

/** Where the file is: beside the settings file. */
export function sessionsFilePath(settingsFile: string): string {
	return join(dirname(settingsFile), "sessions.json");
}

/** The time the conversation checks at quit may take in all, in milliseconds. */
const CODEX_SEARCH_MILLISECONDS = 300;
/** A file larger than this is not one the app wrote: 200 worktrees of 50 sessions are well under it. */
export const SESSIONS_FILE_LIMIT = 4 * 1024 * 1024;
/** A Codex session file can be written a moment before the app learns the session started. */
const CODEX_START_SLACK_MILLISECONDS = 2000;

export interface SessionLayoutDependencies {
	file: string;
	running: () => RunningSession[];
	/** When the last Codex session of each worktree ended or closed in this run, by worktree id. */
	endedCodex?: () => ReadonlyMap<string, number>;
	/** For a Codex session with nothing newer known (see ./agent-conversations.ts). */
	findCodex: (options: { cwd: string; since: number; taken: ReadonlySet<string>; budget: number }) => string | null;
	/** Whether Claude Code wrote the conversation with this id. */
	claudeExists?: (id: string) => boolean;
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
	const { file, running, findCodex, endedCodex = () => new Map<string, number>(), claudeExists = () => true, warn = console.warn, now = Date.now } = dependencies;
	let loaded: SavedSessions | null = null;
	let carry: SavedCarry = createSavedCarry(null);
	/** A file of a later version is there: it is left for that version. */
	let newer = false;
	let saved = false;
	let discarded = false;
	/** The session whose chip showed last, by worktree id. */
	const shown: Record<string, string> = {};
	let selected: string | null = null;

	/** Every session with the conversation it is in, Codex ones read again from Codex's files where that is exact. */
	function withConversations(live: RunningSession[]): RunningSession[] {
		const taken = new Set(live.flatMap(session => session.conversation === null ? [] : [session.conversation]));
		const deadline = now() + CODEX_SEARCH_MILLISECONDS;
		const codex = new Map<string, RunningSession[]>();
		for (const session of live) if (session.resumable === "codex") codex.set(session.worktree, [...codex.get(session.worktree) ?? [], session]);
		const ended = endedCodex();
		const found = new Map<string, string | null>();
		for (const sessions of codex.values()) {
			if (sessions.length !== 1) continue;
			const [session] = sessions as [RunningSession];
			const since = session.startedAt - CODEX_START_SLACK_MILLISECONDS;
			// Another Codex of the app ran here meanwhile and ended: its conversation could be taken for this one's.
			const rival = ended.get(session.worktree);
			if (rival !== undefined && rival >= since) continue;
			const budget = deadline - now();
			if (budget <= 0) break;
			const own = new Set(taken);
			if (session.conversation !== null) own.delete(session.conversation);
			let id: string | null = null;
			try {
				id = findCodex({ cwd: session.path, since, taken: own, budget });
			} catch {
				// Then it keeps what it has.
			}
			if (id === null || own.has(id)) continue;
			found.set(session.id, id);
			taken.add(id);
		}
		// A Claude Code id the app chose is only a conversation once Claude Code wrote it.
		for (const session of live) {
			if (session.resumable !== "claude" || session.conversation === null) continue;
			if (deadline - now() <= 0) break;
			let exists = true;
			try {
				exists = claudeExists(session.conversation);
			} catch {
				// Then it keeps what it has.
			}
			if (!exists) found.set(session.id, null);
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
