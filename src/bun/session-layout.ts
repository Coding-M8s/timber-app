import { randomUUID } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, writeSync } from "node:fs";
import { readFile, rename } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Attention } from "../shared/attention";
import { type SavedSessions, buildSavedSessions, parseSavedSessions, serializeSavedSessions } from "../shared/saved-sessions";
import type { RunningSession } from "./terminals";

/**
 * Which sessions run in which worktree, kept from one run of the app to the
 * next (see docs/architecture.md, "After a restart").
 *
 * - The file is read once at launch, and the window takes what it holds
 *   once, to open those sessions again through the ordinary `openTerminal`.
 * - It is written once, at quit, synchronously, from the sessions that run
 *   right then: never while the app runs, so a crash brings back what the
 *   last clean quit saved. A worktree with nothing running is left out, so
 *   a closed session stays closed.
 * - Which chip shows comes from the window's `attend` reports: chips are
 *   switched only in the selected worktree, which the report names.
 * - A Codex session's conversation id is read at quit from Codex's own files
 *   (see ./agent-conversations.ts), only for the one Codex session of a
 *   worktree. With two or more in one worktree nothing tells them apart, so
 *   each keeps the id it was opened with, if any.
 */

/** Where the file is: beside the settings file. */
export function sessionsFilePath(settingsFile: string): string {
	return join(dirname(settingsFile), "sessions.json");
}

/** The time the Codex search at quit may take in all, in milliseconds. */
const CODEX_SEARCH_MILLISECONDS = 300;
/** A Codex session file can be written a moment before the app learns the session started. */
const CODEX_START_SLACK_MILLISECONDS = 2000;

export interface SessionLayoutDependencies {
	file: string;
	running: () => RunningSession[];
	/** For a Codex session with nothing newer known (see ./agent-conversations.ts). */
	findCodex: (options: { cwd: string; since: number; taken: ReadonlySet<string>; budget: number }) => string | null;
	warn?: (message: string) => void;
	now?: () => number;
}

export interface SessionLayout {
	/** Read the file. Never throws. A damaged file is moved to sessions.json.damaged. A newer one is left alone, and nothing is saved in this run. */
	load(): Promise<void>;
	/** What was loaded, the first time it is asked for. Null after that, and when there was nothing. */
	take(): SavedSessions | null;
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
	const { file, running, findCodex, warn = console.warn, now = Date.now } = dependencies;
	let loaded: SavedSessions | null = null;
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
		const found = new Map<string, string>();
		for (const sessions of codex.values()) {
			if (sessions.length !== 1) continue;
			const [session] = sessions as [RunningSession];
			const budget = deadline - now();
			if (budget <= 0) break;
			const own = new Set(taken);
			if (session.conversation !== null) own.delete(session.conversation);
			let id: string | null = null;
			try {
				id = findCodex({ cwd: session.path, since: session.startedAt - CODEX_START_SLACK_MILLISECONDS, taken: own, budget });
			} catch {
				// Then it keeps what it has.
			}
			if (id === null || own.has(id)) continue;
			found.set(session.id, id);
			taken.add(id);
		}
		return live.map(session => found.has(session.id) ? { ...session, conversation: found.get(session.id)! } : session);
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
			let text: string;
			try {
				text = await readFile(file, "utf8");
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") warn(`Could not read ${file}, so no sessions open again: ${messageOf(error)}`);
				return;
			}
			const read = parseSavedSessions(text);
			if (read.ok) {
				loaded = Object.keys(read.saved.worktrees).length > 0 ? read.saved : null;
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
				write(serializeSavedSessions(buildSavedSessions(live, shown, selected)));
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
