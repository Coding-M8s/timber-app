import { type FSWatcher, rmSync, watch, writeFileSync } from "node:fs";
import { chmod, lstat, mkdtemp, open, readdir, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { STATUS_FILE_LIMIT, STATUS_LINE_LIMIT, type StatusLine, parseStatusLine } from "../shared/status-hooks";

/** How often the folder is looked at besides when it changes, since a watch can miss a change on some file systems. */
export const STATUS_POLL_MILLISECONDS = 2000;

/** A session's file name: its id, which is only ever letters, digits, and `-`. */
const SESSION_NAME = /^[A-Za-z0-9-]{1,64}$/;

/**
 * The folder where status hooks leave what their agent did (see
 * ../shared/status-hooks.ts). One private folder per run of the app, made
 * with `mkdtemp` and mode 0700, removed when the app quits, as the handoff
 * folder is (./handoffs.ts).
 *
 * - Each session gets a file of its own, named by its id, made empty when the
 *   session starts and deleted when it ends. Its path goes to the session as
 *   `TIMBER_APP_STATUS`.
 * - A file is read from where it was last read, a whole line at a time. A
 *   line over the limit is dropped whole; a file past `STATUS_FILE_LIMIT` is
 *   read no further. A file that got shorter is read no further.
 * - A file the app does not know (written after its session ended) and
 *   anything that is not a regular file are deleted unread.
 * - A line is only a report: what comes of it is decided by the session
 *   (see ./terminals.ts).
 */
export interface StatusFolder {
	readonly path: string;
	/** Make a session's file, empty, and answer its path, or null when it could not be made. Waits for nothing, so a session can start in the same step. */
	add(session: string): string | null;
	/** Delete a session's file and forget it. */
	remove(session: string): void;
	/** Look at the folder now, as a change to it does. Answers once done. */
	scan(): Promise<void>;
	/** Stop watching and remove the folder, at once, so it works while the app quits. Safe to call again. */
	close(): void;
}

export interface StatusFolderDependencies {
	/** Where to make the folder: a private place of this user's. */
	parent: string;
	onLine: (session: string, line: StatusLine) => void;
	onProblem?: (message: string) => void;
	/** Tests pass 0 to look only when asked. */
	pollMilliseconds?: number;
}

export async function openStatusFolder({ parent, onLine, onProblem = () => {}, pollMilliseconds = STATUS_POLL_MILLISECONDS }: StatusFolderDependencies): Promise<StatusFolder> {
	const path = await mkdtemp(join(parent, "timber-app-status-"));
	await chmod(path, 0o700);
	/** Each known session's file: how far it was read, and what is left of a line not ended yet. */
	const files = new Map<string, { offset: number; partial: string; done: boolean }>();
	let watcher: FSWatcher | null = null;
	let timer: ReturnType<typeof setInterval> | null = null;
	let closed = false;
	let running: Promise<void> | null = null;
	let again = false;

	async function read(session: string): Promise<void> {
		const known = files.get(session);
		if (!known || known.done) return;
		const file = join(path, session);
		const info = await lstat(file).catch(() => null);
		if (info === null || !info.isFile()) {
			if (info !== null) await unlink(file).catch(() => undefined);
			return;
		}
		if (info.size < known.offset || known.offset >= STATUS_FILE_LIMIT) {
			known.done = true;
			return;
		}
		if (info.size === known.offset) return;
		const length = Math.min(info.size, STATUS_FILE_LIMIT) - known.offset;
		const handle = await open(file, "r");
		let text: string;
		try {
			const buffer = new Uint8Array(length);
			const { bytesRead } = await handle.read(buffer, 0, length, known.offset);
			known.offset += bytesRead;
			text = new TextDecoder().decode(buffer.subarray(0, bytesRead));
		} finally {
			await handle.close();
		}
		const lines = (known.partial + text).split("\n");
		known.partial = lines.pop() ?? "";
		if (known.partial.length > STATUS_LINE_LIMIT) known.partial = "\u0000";
		for (const line of lines) {
			if (closed || files.get(session) !== known) return;
			const parsed = line.includes("\u0000") ? null : parseStatusLine(line);
			if (parsed !== null) onLine(session, parsed);
		}
	}

	async function look(): Promise<void> {
		let names: string[];
		try {
			names = await readdir(path);
		} catch (error) {
			if (!closed) onProblem(`Could not read the status folder: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		for (const name of names) {
			if (closed) return;
			if (!files.has(name)) {
				// A folder made there goes too: nothing but the sessions' files belongs here.
				await rm(join(path, name), { recursive: true, force: true }).catch(() => undefined);
				continue;
			}
			await read(name).catch(() => undefined);
		}
	}

	function scan(): Promise<void> {
		if (closed) return Promise.resolve();
		if (running) {
			again = true;
			return running;
		}
		running = (async () => {
			do {
				again = false;
				await look();
			} while (again && !closed);
		})().finally(() => {
			running = null;
		});
		return running;
	}

	try {
		watcher = watch(path, () => void scan());
		watcher.on("error", error => onProblem(`Stopped watching the status folder: ${error.message}`));
	} catch (error) {
		onProblem(`Could not watch the status folder: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (pollMilliseconds > 0) timer = setInterval(() => void scan(), pollMilliseconds);

	return {
		path,
		add(session) {
			if (closed || !SESSION_NAME.test(session)) return null;
			const file = join(path, session);
			try {
				writeFileSync(file, "", { mode: 0o600, flag: "w" });
			} catch (error) {
				onProblem(`Could not make a status file: ${error instanceof Error ? error.message : String(error)}`);
				return null;
			}
			files.set(session, { offset: 0, partial: "", done: false });
			return file;
		},
		remove(session) {
			if (!files.delete(session)) return;
			void unlink(join(path, session)).catch(() => undefined);
		},
		scan,
		close() {
			if (closed) return;
			closed = true;
			watcher?.close();
			if (timer !== null) clearInterval(timer);
			files.clear();
			try {
				rmSync(path, { recursive: true, force: true });
			} catch {
				// A folder left behind is private, and the next run makes its own.
			}
		},
	};
}
