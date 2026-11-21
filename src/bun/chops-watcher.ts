import { join } from "node:path";
import { messageOf } from "../shared/error-message";
import { type DirectoryWatch, QUIET_MILLISECONDS, type Schedule, type WatchDirectory, scheduleWithTimer, watchWithNode } from "./repository-watcher";

export interface ChopsWatcherOptions {
	/** Called with a repository's primary checkout, once per burst of changes to its chops file. */
	onChange: (repository: string) => void;
	watchDirectory?: WatchDirectory;
	schedule?: Schedule;
	warn?: (message: string) => void;
	quietMilliseconds?: number;
}

/**
 * Watches the chops file of every repository in the list, in its main
 * checkout only, so a change to `.timber/chops.json` shows without a restart
 * and without polling. Two watches per repository, neither recursive: the
 * main checkout's own folder, for `.timber` appearing or going, and only
 * events named `.timber` count there; and the `.timber` folder while it is
 * there, for `chops.json` itself. Nothing in them is read here: the window
 * is told, and lists the chops again. Linked worktrees are never watched.
 */
export interface ChopsWatcher {
	/** Watch exactly these primary checkouts from now on. Watches that broke or could not start are tried again. */
	sync(repositories: readonly string[]): void;
	stop(): void;
}

const isMissing = (error: unknown) => {
	const code = (error as { code?: unknown } | null)?.code;
	return code === "ENOENT" || code === "ENOTDIR";
};

interface Entry {
	path: string;
	checkout: DirectoryWatch | null;
	folder: DirectoryWatch | null;
	warned: boolean;
	cancel: (() => void) | null;
}

export function createChopsWatcher(options: ChopsWatcherOptions): ChopsWatcher {
	const { onChange, watchDirectory = watchWithNode, schedule = scheduleWithTimer, warn = console.warn, quietMilliseconds = QUIET_MILLISECONDS } = options;
	const entries = new Map<string, Entry>();
	const current = (entry: Entry) => entries.get(entry.path) === entry;

	function bump(entry: Entry): void {
		if (!current(entry)) return;
		entry.cancel?.();
		entry.cancel = schedule(() => {
			entry.cancel = null;
			if (current(entry)) onChange(entry.path);
		}, quietMilliseconds);
	}

	function trouble(entry: Entry, folder: string, error: unknown): void {
		if (entry.warned) return;
		entry.warned = true;
		warn(`Could not watch ${folder}, so a change to its chops shows only when the repository changes: ${messageOf(error)}`);
	}

	/** Watch `.timber` while it is there. Started again whenever the checkout says `.timber` changed. */
	function armFolder(entry: Entry): void {
		entry.folder?.close();
		entry.folder = null;
		const folder = join(entry.path, ".timber");
		let watch: DirectoryWatch | null = null;
		try {
			watch = watchDirectory(folder, false, () => bump(entry), error => {
				if (!current(entry) || entry.folder !== watch) return;
				watch?.close();
				entry.folder = null;
				bump(entry);
				if (!isMissing(error)) trouble(entry, folder, error);
			});
			entry.folder = watch;
		} catch (error) {
			// Most repositories have no `.timber` folder, and a file in its place means no chops file.
			if (!isMissing(error)) trouble(entry, folder, error);
		}
	}

	function armCheckout(entry: Entry): void {
		entry.checkout?.close();
		entry.checkout = null;
		let watch: DirectoryWatch | null = null;
		try {
			watch = watchDirectory(entry.path, false, name => {
				if (!current(entry)) return;
				// Only `.timber` itself counts here: a build writing beside it is not heard.
				if (name !== null && name !== ".timber") return;
				armFolder(entry);
				bump(entry);
			}, error => {
				if (!current(entry) || entry.checkout !== watch) return;
				watch?.close();
				entry.checkout = null;
				if (!isMissing(error)) trouble(entry, entry.path, error);
			});
			entry.checkout = watch;
		} catch (error) {
			// A missing main checkout means the repository is unavailable, which the list already says.
			if (!isMissing(error)) trouble(entry, entry.path, error);
		}
	}

	function close(entry: Entry): void {
		entries.delete(entry.path);
		entry.checkout?.close();
		entry.folder?.close();
		entry.cancel?.();
		entry.checkout = entry.folder = entry.cancel = null;
	}

	return {
		sync(repositories) {
			const wanted = new Set(repositories);
			for (const entry of [...entries.values()]) if (!wanted.has(entry.path)) close(entry);
			for (const path of wanted) {
				let entry = entries.get(path);
				if (entry === undefined) {
					entry = { path, checkout: null, folder: null, warned: false, cancel: null };
					entries.set(path, entry);
				}
				if (entry.checkout === null) armCheckout(entry);
				if (entry.folder === null) armFolder(entry);
			}
		},
		stop() {
			for (const entry of [...entries.values()]) close(entry);
		},
	};
}
