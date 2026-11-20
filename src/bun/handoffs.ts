import { type FSWatcher, rmSync, watch } from "node:fs";
import { chmod, lstat, mkdtemp, readFile, readdir, unlink } from "node:fs/promises";
import { join } from "node:path";
import { HANDOFF_SIZE_LIMIT, type WorktreeHandoff, isHandoffName, parseHandoff } from "../shared/handoff";

/**
 * The folder where `timber new` and `timber open`, typed in one of the app's
 * terminals, leave the worktrees they created (see ../shared/handoff.ts).
 * One private folder per run of the app, made with `mkdtemp` and mode 0700,
 * named to the terminals only, and removed when the app quits.
 *
 * - Each finished record (`*.json`, a regular file under the size limit) is
 *   read once and deleted, whatever it holds. Dot-files are still being
 *   written; links are deleted unread, and folders are left alone.
 * - A record is only a request: what comes of it is decided by the window,
 *   which opens a session only in a worktree the app lists, and runs nothing
 *   named in it.
 * - At most `BURST_LIMIT` records are passed on in any `BURST_WINDOW_MS`, so
 *   a flood of them cannot open a flood of sessions. The rest are deleted,
 *   and the problem is told.
 */
export interface HandoffFolder {
	readonly path: string;
	/** Look at the folder now, as a change to it does. Answers once done. */
	scan(): Promise<void>;
	/** Stop watching and remove the folder, at once, so it works while the app quits. Safe to call again. */
	close(): void;
}

export const BURST_LIMIT = 4;
export const BURST_WINDOW_MS = 5000;

export interface HandoffDependencies {
	/** Where to make the folder: a private place of this user's, such as the runtime or temporary folder. */
	parent: string;
	onHandoff: (handoff: WorktreeHandoff) => void;
	/** Reading the folder failed. The message names no record's contents. */
	onProblem?: (message: string) => void;
	/** Tests pass a clock. */
	now?: () => number;
}

export async function openHandoffFolder({ parent, onHandoff, onProblem = () => {}, now = Date.now }: HandoffDependencies): Promise<HandoffFolder> {
	const path = await mkdtemp(join(parent, "timber-app-handoff-"));
	// mkdtemp makes it 0700 already; this says so where a umask or platform might not.
	await chmod(path, 0o700);
	let watcher: FSWatcher | null = null;
	let closed = false;
	let running: Promise<void> | null = null;
	let again = false;
	/** When each recent record was passed on, for the burst limit. */
	let passed: number[] = [];

	async function take(name: string): Promise<WorktreeHandoff | null> {
		const file = join(path, name);
		const info = await lstat(file).catch(() => null);
		if (info === null) return null;
		try {
			if (!info.isFile() || info.size > HANDOFF_SIZE_LIMIT) return null;
			return parseHandoff(await readFile(file, "utf8"));
		} finally {
			await unlink(file).catch(() => undefined);
		}
	}

	async function look(): Promise<void> {
		let names: string[];
		try {
			names = (await readdir(path)).filter(isHandoffName).sort();
		} catch (error) {
			if (!closed) onProblem(`Could not read the handoff folder: ${error instanceof Error ? error.message : String(error)}`);
			return;
		}
		for (const name of names) {
			if (closed) return;
			const handoff = await take(name).catch(() => null);
			if (handoff === null) continue;
			const at = now();
			passed = passed.filter(time => at - time < BURST_WINDOW_MS);
			if (passed.length >= BURST_LIMIT) {
				onProblem("Dropped a handed-off worktree: too many came at once.");
				continue;
			}
			passed.push(at);
			onHandoff(handoff);
		}
	}

	/** One look at a time; a change during one asks for one more after it. */
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
		watcher.on("error", error => onProblem(`Stopped watching the handoff folder: ${error.message}`));
	} catch (error) {
		onProblem(`Could not watch the handoff folder: ${error instanceof Error ? error.message : String(error)}`);
	}

	return {
		path,
		scan,
		close() {
			if (closed) return;
			closed = true;
			watcher?.close();
			try {
				rmSync(path, { recursive: true, force: true });
			} catch {
				// A folder left behind is private and empty of anything that runs; the next run makes its own.
			}
		},
	};
}
