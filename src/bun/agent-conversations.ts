import { closeSync, existsSync, openSync, readSync, readdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { type AgentResume, agentById } from "../shared/agent-registry";
import { isConversationId } from "../shared/saved-sessions";

/**
 * Where Claude Code and Codex keep their own conversations, read only to
 * know whether one is still there and, for Codex, which one a session is in.
 * Nothing here writes to an agent's folders, and nothing of a conversation
 * is read but the first line of a Codex session file, which names its id
 * and folder (see docs/architecture.md, "Going back to a conversation").
 *
 * Everything is synchronous: an existence check runs once per agent that is
 * opened again, and the Codex search runs once per worktree at quit, within
 * a time budget.
 */

type Environment = Record<string, string | undefined>;

/**
 * Where an agent keeps its conversations, from its `resume` in the agent
 * registry: its folder variable when that is a full path, else its folder
 * in the home folder.
 */
export function conversationFolder(conversations: AgentResume["conversations"], environment: Environment, home: string): string {
	const configured = environment[conversations.folderVariable]?.trim();
	return configured && isAbsolute(configured) ? configured : join(home, conversations.folder);
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

/** Whether `<config>/projects/<any folder>/<id>.jsonl` is there. False when the folder cannot be read. */
export function claudeConversationExists(id: string, configFolder: string): boolean {
	if (!isConversationId(id)) return false;
	const projects = join(configFolder, "projects");
	return namesIn(projects).some(project => existsSync(join(projects, project, `${id}.jsonl`)));
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
export function findCodexConversation(options: { homeFolder: string; cwd: string; since: number; taken: ReadonlySet<string>; budget?: number; now?: () => number }): string | null {
	const { homeFolder, cwd, since, taken, budget = 150, now = Date.now } = options;
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
