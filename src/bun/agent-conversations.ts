import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { type AgentResume, type ConversationStore, agentById } from "../shared/agent-registry";
import { isConversationId } from "../shared/saved-sessions";

/**
 * Where the agents of the registry keep their own conversations (Claude
 * Code, Codex, Cursor CLI, Grok Build, Qwen Code, Pi), read only to know
 * whether one is still there and, for an agent that cannot be given the id
 * of a new one (Codex, Cursor CLI), which one a session is in.
 * Nothing here writes to an agent's folders. Of a conversation nothing is
 * read but the first line of a Codex session file, which names its id and
 * folder, and a Cursor chat's small `meta.json`, which names its folder,
 * start, and whether it has a message; a chat's title in it is never kept
 * or logged (see docs/architecture.md, "Going back to a conversation").
 *
 * Everything is synchronous: an existence check runs once per agent that is
 * opened again, and a search runs once per worktree at quit, within a time
 * budget.
 */

type Environment = Record<string, string | undefined>;

/**
 * Where an agent keeps its conversations, from its `resume` in the agent
 * registry: its folder variable when that is a full path, else its
 * `xdgFolder` in `XDG_CONFIG_HOME` when it has one and that is a full path,
 * else its folder in the home folder.
 */
export function conversationFolder(conversations: AgentResume["conversations"], environment: Environment, home: string): string {
	const configured = environment[conversations.folderVariable]?.trim();
	if (configured && isAbsolute(configured)) return configured;
	const xdg = environment.XDG_CONFIG_HOME?.trim();
	if (conversations.xdgFolder !== undefined && xdg && isAbsolute(xdg)) return join(xdg, conversations.xdgFolder);
	return join(home, conversations.folder);
}

/** Claude Code's configuration folder: `CLAUDE_CONFIG_DIR` when it is a full path, else `~/.claude`. */
export function claudeConfigFolder(environment: Environment, home: string): string {
	return conversationFolder(agentById("claude").resume!.conversations, environment, home);
}

/** Codex's home folder: `CODEX_HOME` when it is a full path, else `~/.codex`. */
export function codexHomeFolder(environment: Environment, home: string): string {
	return conversationFolder(agentById("codex").resume!.conversations, environment, home);
}

/** The names in a folder, or none when it cannot be read. */
function namesIn(folder: string): string[] {
	try {
		return readdirSync(folder);
	} catch {
		return [];
	}
}

/** Whether `<home>/sessions/<any folder>/<id>/summary.json` is there, as Grok Build writes it once it starts. False when the folder cannot be read. */
export function grokConversationExists(id: string, homeFolder: string): boolean {
	if (!isConversationId(id)) return false;
	const sessions = join(homeFolder, "sessions");
	// Beside the folders of each working folder, `sessions` holds files such as session_search.sqlite, which have no such path.
	return namesIn(sessions).some(folder => existsSync(join(sessions, folder, id, "summary.json")));
}

/** Whether `<config>/chats/<any folder>/<id>/meta.json` is there, as Cursor CLI writes it for a chat. False when the folder cannot be read. */
export function cursorConversationExists(id: string, configFolder: string): boolean {
	if (!isConversationId(id)) return false;
	const chats = join(configFolder, "chats");
	return namesIn(chats).some(folder => existsSync(join(chats, folder, id, "meta.json")));
}

/** Whether `<config>/projects/<any folder>/<id>.jsonl` is there. False when the folder cannot be read. */
export function claudeConversationExists(id: string, configFolder: string): boolean {
	if (!isConversationId(id)) return false;
	const projects = join(configFolder, "projects");
	return namesIn(projects).some(project => existsSync(join(projects, project, `${id}.jsonl`)));
}

/** Whether `<home>/projects/<any folder>/chats/<id>.jsonl` is there, as Qwen Code writes it with a first message; its `<id>.runtime.json` alone is not a conversation. False when the folder cannot be read. */
export function qwenConversationExists(id: string, homeFolder: string): boolean {
	if (!isConversationId(id)) return false;
	const projects = join(homeFolder, "projects");
	return namesIn(projects).some(project => existsSync(join(projects, project, "chats", `${id}.jsonl`)));
}

/** Whether `<agent folder>/sessions/<any folder>/<time>_<id>.jsonl` is there, as Pi writes it with a first message; the name is compared in lower case. False when the folder cannot be read. */
export function piConversationExists(id: string, agentFolder: string): boolean {
	if (!isConversationId(id)) return false;
	const sessions = join(agentFolder, "sessions");
	const ending = `_${id.toLowerCase()}.jsonl`;
	return namesIn(sessions).some(folder => namesIn(join(sessions, folder)).some(name => name.toLowerCase().endsWith(ending)));
}

const DIGITS = (length: number) => new RegExp(`^\\d{${length}}$`);
const YEAR = DIGITS(4);
const TWO = DIGITS(2);

/** The day folders of Codex's sessions, `<home>/sessions/YYYY/MM/DD`, as `YYYY-MM-DD` and path, oldest first. */
function dayFolders(homeFolder: string): { day: string; path: string }[] {
	const sessions = join(homeFolder, "sessions");
	const days: { day: string; path: string }[] = [];
	for (const year of namesIn(sessions).filter(name => YEAR.test(name)).sort()) {
		for (const month of namesIn(join(sessions, year)).filter(name => TWO.test(name)).sort()) {
			for (const day of namesIn(join(sessions, year, month)).filter(name => TWO.test(name)).sort()) {
				days.push({ day: `${year}-${month}-${day}`, path: join(sessions, year, month, day) });
			}
		}
	}
	return days;
}

/** Whether `<home>/sessions/<y>/<m>/<d>/rollout-*-<id>.jsonl` is there. False when the folder cannot be read. */
export function codexConversationExists(id: string, homeFolder: string): boolean {
	if (!isConversationId(id)) return false;
	const ending = `-${id.toLowerCase()}.jsonl`;
	// Newest first: a conversation that is resumed is most likely a recent one.
	return dayFolders(homeFolder).reverse().some(({ path }) => namesIn(path).some(name => name.startsWith("rollout-") && name.toLowerCase().endsWith(ending)));
}

const PIECE = 64 * 1024;
const FIRST_LINE_LIMIT = 1024 * 1024;

/** The first line of a file, or null when it cannot be read or is longer than `FIRST_LINE_LIMIT`. */
function firstLine(path: string): string | null {
	let descriptor: number;
	try {
		descriptor = openSync(path, "r");
	} catch {
		return null;
	}
	try {
		const pieces: Buffer[] = [];
		let length = 0;
		while (length < FIRST_LINE_LIMIT) {
			const piece = Buffer.allocUnsafe(PIECE);
			const read = readSync(descriptor, piece, 0, PIECE, length);
			if (read === 0) break;
			const end = piece.subarray(0, read).indexOf(10);
			if (end >= 0) {
				pieces.push(piece.subarray(0, end));
				return Buffer.concat(pieces).toString("utf8");
			}
			pieces.push(piece.subarray(0, read));
			length += read;
		}
		// A file of one line, with no line break at its end, is read whole.
		return length < FIRST_LINE_LIMIT && length > 0 ? Buffer.concat(pieces).toString("utf8") : null;
	} catch {
		return null;
	} finally {
		closeSync(descriptor);
	}
}

/** What a search at quit is given: the agent's folder, the session's working folder, its start (ms), ids not to take, and its time. */
export interface ConversationSearch {
	folder: string;
	cwd: string;
	since: number;
	taken: ReadonlySet<string>;
	budget?: number;
	now?: () => number;
}

/** The local date of a time, as `YYYY-MM-DD`, as Codex names its day folders. */
function localDay(time: number): string {
	const date = new Date(time);
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

/** What a Codex session file's first line says about it, when it is an interactive conversation of its own. */
function interactiveConversation(line: string): { id: string; cwd: string; startedAt: number } | null {
	let data: unknown;
	try {
		data = JSON.parse(line);
	} catch {
		return null;
	}
	if (typeof data !== "object" || data === null) return null;
	const { type, payload } = data as { type?: unknown; payload?: unknown };
	if (type !== "session_meta" || typeof payload !== "object" || payload === null) return null;
	const { id, cwd, timestamp, source, parent_thread_id: parent } = payload as Record<string, unknown>;
	// "cli" is the interactive terminal. A subagent's source is an object and it has a parent; `exec` and editor runs are not a terminal's.
	if (source !== "cli" || (parent !== undefined && parent !== null)) return null;
	if (!isConversationId(id) || typeof cwd !== "string" || typeof timestamp !== "string") return null;
	const startedAt = Date.parse(timestamp);
	return Number.isFinite(startedAt) ? { id, cwd, startedAt } : null;
}

/**
 * The newest interactive Codex conversation started in `cwd` at or after
 * `since` (ms): a session file whose first line is of type session_meta,
 * with that cwd, the source of the interactive terminal (`cli`), no parent
 * thread, and an id that is a UUID and not in `taken`. Only files in day
 * folders from the day before `since` on are opened. Stops, with what it
 * has, once `budget` ms passed. Null when none.
 */
export function findCodexConversation(options: ConversationSearch): string | null {
	const { folder: homeFolder, cwd, since, taken, budget = 150, now = Date.now } = options;
	const started = now();
	const late = () => now() - started >= budget;
	if (late()) return null;
	const first = localDay(since - DAY_MILLISECONDS);
	const files: string[] = [];
	for (const { day, path } of dayFolders(homeFolder)) {
		if (day < first) continue;
		for (const name of namesIn(path)) if (name.startsWith("rollout-") && name.endsWith(".jsonl")) files.push(join(path, name));
	}
	// Newest first by name, which starts with the time, so the budget is spent on the likeliest files.
	files.sort((one, other) => (one < other ? 1 : one > other ? -1 : 0));
	let best: { id: string; startedAt: number; file: string } | null = null;
	for (const file of files) {
		if (late()) break;
		const line = firstLine(file);
		if (line === null) continue;
		const found = interactiveConversation(line);
		if (found === null || found.cwd !== cwd || found.startedAt < since || taken.has(found.id)) continue;
		if (best === null || found.startedAt > best.startedAt || (found.startedAt === best.startedAt && file > best.file)) best = { id: found.id, startedAt: found.startedAt, file };
	}
	return best?.id ?? null;
}

const META_LIMIT = 64 * 1024;

/** What a Cursor chat's `meta.json` says about it, when it is a chat with a message. */
function cursorChat(path: string): { cwd: string; createdAt: number } | null {
	let descriptor: number;
	try {
		descriptor = openSync(path, "r");
	} catch {
		return null;
	}
	let text: string;
	try {
		const buffer = Buffer.allocUnsafe(META_LIMIT + 1);
		let length = 0;
		while (length < buffer.length) {
			const read = readSync(descriptor, buffer, length, buffer.length - length, length);
			if (read === 0) break;
			length += read;
		}
		// Larger than any meta.json Cursor writes: not one to trust.
		if (length > META_LIMIT) return null;
		text = buffer.subarray(0, length).toString("utf8");
	} catch {
		return null;
	} finally {
		closeSync(descriptor);
	}
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		return null;
	}
	if (typeof data !== "object" || data === null) return null;
	// Only the fields used are read; the title is left alone.
	const { cwd, createdAtMs, hasConversation, isSubagent } = data as Record<string, unknown>;
	// A subagent's chat is not the terminal's: Cursor's own list of chats leaves it out too.
	if (isSubagent === true || hasConversation !== true || typeof cwd !== "string" || typeof createdAtMs !== "number" || !Number.isFinite(createdAtMs)) return null;
	return { cwd, createdAt: createdAtMs };
}

/** A folder with every link followed, or itself when that cannot be read. */
function realFolder(folder: string): string {
	try {
		return realpathSync(folder);
	} catch {
		return folder;
	}
}

/**
 * The newest Cursor CLI chat started in `cwd` at or after `since` (ms): a
 * folder `<config>/chats/<md5 of the working folder>/<uuid>/` whose
 * `meta.json` has that `cwd`, `hasConversation` true (a chat that got a
 * message, which Cursor sets while it still runs), no `isSubagent` true,
 * a `createdAtMs` at or
 * after `since`, and whose id is not in `taken`. Cursor names the folder
 * after the working folder as the agent sees it, with links followed, so
 * both that and `cwd` as given are tried. The chat folders are in no order,
 * so a search that runs out of `budget` ms finds nothing rather than an
 * older chat. Null when none.
 */
export function findCursorConversation(options: ConversationSearch): string | null {
	const { folder, cwd, since, taken, budget = 150, now = Date.now } = options;
	const started = now();
	const late = () => now() - started >= budget;
	const real = realFolder(cwd);
	const places = [...new Set([real, resolve(cwd)])];
	let best: { id: string; createdAt: number } | null = null;
	for (const place of places) {
		const chats = join(folder, "chats", createHash("md5").update(place).digest("hex"));
		for (const id of namesIn(chats)) {
			if (late()) return null;
			if (!isConversationId(id) || taken.has(id)) continue;
			const chat = cursorChat(join(chats, id, "meta.json"));
			if (chat === null || !places.includes(chat.cwd) || chat.createdAt < since) continue;
			if (best === null || chat.createdAt > best.createdAt || (chat.createdAt === best.createdAt && id > best.id)) best = { id, createdAt: chat.createdAt };
		}
	}
	return best?.id ?? null;
}

/** Whether a conversation is still there, for each layout of conversation folders an agent of the registry uses. */
export const conversationExists: Record<ConversationStore, (id: string, folder: string) => boolean> = {
	"claude-projects": claudeConversationExists,
	"codex-sessions": codexConversationExists,
	"grok-sessions": grokConversationExists,
	"cursor-chats": cursorConversationExists,
	"qwen-projects": qwenConversationExists,
	"pi-sessions": piConversationExists,
};

/** The search at quit, for each layout of an agent whose id is not known when it starts. */
export const conversationFinders: Partial<Record<ConversationStore, (options: ConversationSearch) => string | null>> = {
	"codex-sessions": findCodexConversation,
	"cursor-chats": findCursorConversation,
};
