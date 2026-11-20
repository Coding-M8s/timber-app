import { watch } from "node:fs";
import { basename, join } from "node:path";
import { type WatchedArea, isRelevantChange } from "../shared/git-watch";
import { messageOf } from "../shared/error-message";

/** A repository to watch: its primary checkout, which names it, and its common Git directory. */
export interface WatchTarget {
	path: string;
	commonDir: string;
}

/** A watch on one folder. */
export interface DirectoryWatch {
	close(): void;
}

/**
 * Start watching one folder. `onEvent` gets the changed entry's name relative
 * to the folder, or null when the platform did not say. `onError` is called
 * when the watch breaks. Throws when the folder cannot be watched.
 */
export type WatchDirectory = (
	folder: string,
	recursive: boolean,
	onEvent: (name: string | null) => void,
	onError: (error: unknown) => void,
) => DirectoryWatch;

/** Run `task` after `milliseconds`. Returns a function that calls it off. */
export type Schedule = (task: () => void, milliseconds: number) => () => void;

export const scheduleWithTimer: Schedule = (task, milliseconds) => {
	const timer = setTimeout(task, milliseconds);
	return () => clearTimeout(timer);
};

/** The watch of the running app, from Node's `fs.watch`, which Bun backs with inotify on Linux. */
export const watchWithNode: WatchDirectory = (folder, recursive, onEvent, onError) => {
	const watcher = watch(folder, { recursive, persistent: true }, (_event, name) => {
		onEvent(typeof name === "string" ? name : null);
	});
	watcher.on("error", onError);
	return { close: () => watcher.close() };
};

/** A change is reported once nothing more happened for this long. */
export const QUIET_MILLISECONDS = 300;
/** A change is reported at most this long after the first event, even while events keep coming. */
export const MOST_MILLISECONDS = 2000;

export interface RepositoryWatcherOptions {
	/** Called with the repository's primary checkout, at most once per quiet period or longest wait. */
	onChange: (path: string) => void;
	watchDirectory?: WatchDirectory;
	schedule?: Schedule;
	warn?: (message: string) => void;
	quietMilliseconds?: number;
	mostMilliseconds?: number;
}

/**
 * Watches the Git metadata of the repositories in the list: HEAD, refs, the
 * index, and the folders of linked worktrees, all in the common Git
 * directory. Working trees are never watched, so a dependency install or a
 * build does not reach here. A burst of events becomes one report.
 */
export interface RepositoryWatcher {
	/** Watch exactly these repositories from now on. Watches that broke or could not start are tried again. */
	sync(targets: readonly WatchTarget[]): void;
	/** Stop every watch and every pending report. */
	stop(): void;
}

/** The folder of each area, and whether it is watched recursively. */
const AREAS: readonly { area: WatchedArea; recursive: boolean }[] = [
	{ area: "common", recursive: false },
	{ area: "refs", recursive: true },
	{ area: "worktrees", recursive: true },
	{ area: "reftable", recursive: false },
];

function folderOf(commonDir: string, area: WatchedArea): string {
	return area === "common" ? commonDir : join(commonDir, area);
}

function isMissing(error: unknown): boolean {
	const code = (error as { code?: unknown } | null)?.code;
	return code === "ENOENT" || code === "ENOTDIR";
}

interface Entry {
	target: WatchTarget;
	watches: Map<WatchedArea, DirectoryWatch>;
	/** A watch broke or could not start for another reason than a missing folder, so the next sync tries again. */
	broken: boolean;
	warned: boolean;
	pending: { cancelQuiet: () => void; cancelMost: () => void } | null;
}

export function createRepositoryWatcher(options: RepositoryWatcherOptions): RepositoryWatcher {
	const {
		onChange,
		watchDirectory = watchWithNode,
		schedule = scheduleWithTimer,
		warn = console.warn,
		quietMilliseconds = QUIET_MILLISECONDS,
		mostMilliseconds = MOST_MILLISECONDS,
	} = options;
	const entries = new Map<string, Entry>();

	function report(entry: Entry): void {
		const pending = entry.pending;
		if (!pending) return;
		entry.pending = null;
		pending.cancelQuiet();
		pending.cancelMost();
		if (entries.get(entry.target.path) === entry) onChange(entry.target.path);
	}

	function bump(entry: Entry): void {
		if (entries.get(entry.target.path) !== entry) return;
		if (entry.pending) {
			entry.pending.cancelQuiet();
			entry.pending.cancelQuiet = schedule(() => report(entry), quietMilliseconds);
			return;
		}
		entry.pending = {
			cancelQuiet: schedule(() => report(entry), quietMilliseconds),
			cancelMost: schedule(() => report(entry), mostMilliseconds),
		};
	}

	function fail(entry: Entry, area: WatchedArea, error: unknown): void {
		entry.broken = true;
		if (entry.warned) return;
		entry.warned = true;
		// Only the folder and the reason: nothing from inside the repository.
		warn(`Could not watch ${folderOf(entry.target.commonDir, area)}, so changes there show only on refresh: ${messageOf(error)}`);
	}

	function arm(entry: Entry, area: WatchedArea): void {
		entry.watches.get(area)?.close();
		entry.watches.delete(area);
		const { recursive } = AREAS.find(candidate => candidate.area === area)!;
		const folder = folderOf(entry.target.commonDir, area);
		let current: DirectoryWatch | null = null;
		try {
			current = watchDirectory(
				folder,
				recursive,
				name => {
					if (entries.get(entry.target.path) !== entry) return;
					// A folder that appears or goes as a whole: the first or last linked worktree, or a move to reftable.
					// Its own watch stops working when it goes, so it is started again either way.
					// The watch of a removed folder says so once, without a name or with the folder's own name, and then
					// hears nothing more. Starting it again finds the folder when it is back, and otherwise leaves it to
					// the next sync. That covers the common directory too, when the repository is cloned again in place.
					const gone = name === null || (area === "common" && name === basename(folder));
					if (area === "common" && (name === "worktrees" || name === "reftable")) arm(entry, name);
					else if (gone) arm(entry, area);
					if (gone || isRelevantChange(area, name)) bump(entry);
				},
				error => {
					if (entries.get(entry.target.path) !== entry || entry.watches.get(area) !== current) return;
					current?.close();
					entry.watches.delete(area);
					fail(entry, area, error);
					// Something happened there; the list may be out of date.
					bump(entry);
				},
			);
			entry.watches.set(area, current);
		} catch (error) {
			// A repository without linked worktrees has no `worktrees` folder, and most have no `reftable`.
			// A missing common directory means the repository is unavailable, which the list already says.
			if (isMissing(error)) return;
			fail(entry, area, error);
		}
	}

	function open(target: WatchTarget): void {
		const entry: Entry = { target, watches: new Map(), broken: false, warned: false, pending: null };
		entries.set(target.path, entry);
		for (const { area } of AREAS) arm(entry, area);
	}

	function close(entry: Entry): void {
		entries.delete(entry.target.path);
		for (const current of entry.watches.values()) current.close();
		entry.watches.clear();
		entry.pending?.cancelQuiet();
		entry.pending?.cancelMost();
		entry.pending = null;
	}

	return {
		sync(targets) {
			const wanted = new Map(targets.map(target => [target.path, target]));
			for (const entry of [...entries.values()]) {
				const target = wanted.get(entry.target.path);
				if (!target || target.commonDir !== entry.target.commonDir) close(entry);
			}
			for (const target of wanted.values()) {
				const entry = entries.get(target.path);
				if (!entry) {
					open(target);
					continue;
				}
				// Try again what broke or could not start, and what did not exist before but may now.
				entry.broken = false;
				for (const { area } of AREAS) {
					if (!entry.watches.has(area)) arm(entry, area);
				}
			}
		},
		stop() {
			for (const entry of [...entries.values()]) close(entry);
		},
	};
}
