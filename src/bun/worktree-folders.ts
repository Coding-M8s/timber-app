import type { Dirent } from "node:fs";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { messageOf } from "../shared/error-message";
import {
	type FolderEntry, type WorktreeFolderChange, type WorktreeFolderRequest, type WorktreeFolderResult, type WorktreeFolderWatch, entryPath, folderPathProblem, foldersToWatch, listedEntries,
} from "../shared/worktree-folders";
import { type FindRepository, findListedWorktree } from "./listed-worktree";
import { readGit } from "./read-git";
import { type DirectoryWatch, MOST_MILLISECONDS, QUIET_MILLISECONDS, type Schedule, type WatchDirectory, scheduleWithTimer, watchWithNode } from "./repository-watcher";

const NOT_LISTED = "The folder was not listed.";
/** Git is stopped after this long, and the folder is not listed. */
const IGNORE_MILLISECONDS = 10_000;

export interface WorktreeFoldersDependencies {
	/** The repository in the app's list, read again (see ./listed-worktree.ts). */
	findRepository: FindRepository;
	/** The Git executable. Tests may pass another. */
	git?: string;
	watchDirectory?: WatchDirectory;
	schedule?: Schedule;
	/** Called once nothing more changed in a watched folder for `quietMilliseconds`, or `mostMilliseconds` after its first change while changes keep coming. */
	onChange?: (change: WorktreeFolderChange) => void;
	quietMilliseconds?: number;
	mostMilliseconds?: number;
	warn?: (message: string) => void;
}

/** The file explorer's side in the main process. */
export interface WorktreeFolders {
	list(request: WorktreeFolderRequest): Promise<WorktreeFolderResult>;
	/** Watch these folders, and stop watching any other. Null stops every watch. */
	watch(folders: WorktreeFolderWatch | null): Promise<void>;
	close(): void;
}

const codeOf = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

/** Whether `inner` is `outer` or inside it, both already real paths. */
function inside(outer: string, inner: string): boolean {
	const between = relative(outer, inner);
	return between === "" || (!between.startsWith(`..${sep}`) && between !== ".." && !isAbsolute(between));
}

const fullPath = (worktree: string, folder: string) => folder === "" ? worktree : `${worktree}${worktree.endsWith(sep) ? "" : sep}${folder.split("/").join(sep)}`;

/**
 * Where a folder of a worktree really is, or why it may not be read: only a
 * worktree that Timber lists, in a repository in the app's list, with its
 * folder there; a path that stays inside it as written; and a real path,
 * links followed, that is the worktree's own or inside it.
 */
async function locateFolder(findRepository: FindRepository, request: Pick<WorktreeFolderRequest, "repository" | "worktree" | "folder">): Promise<{ ok: true; real: string } | { ok: false; refusal: Exclude<WorktreeFolderResult, { outcome: "listed" }> }> {
	const { folder } = request;
	const problem = folderPathProblem(folder);
	if (problem !== null) return { ok: false, refusal: { outcome: "outside", folder, message: `${problem} ${NOT_LISTED}` } };
	const listed = await findListedWorktree(findRepository, request.repository, request.worktree, NOT_LISTED);
	if (!listed.ok) return { ok: false, refusal: { outcome: "not-listed", message: listed.message } };
	let root: string;
	let real: string;
	try {
		root = await realpath(request.worktree);
		real = await realpath(fullPath(request.worktree, folder));
	} catch (error) {
		const code = codeOf(error);
		if (code === "ENOENT" || code === "ENOTDIR") return { ok: false, refusal: { outcome: "missing", folder, message: `${folder} is not in this worktree. It may have been moved or deleted.` } };
		return { ok: false, refusal: { outcome: "failed", message: `Could not find ${folder || request.worktree}: ${messageOf(error)}` } };
	}
	if (!inside(root, real)) return { ok: false, refusal: { outcome: "outside", folder, message: `${folder} leads outside this worktree, to ${real}. ${NOT_LISTED}` } };
	try {
		if (!(await stat(real)).isDirectory()) return { ok: false, refusal: { outcome: "missing", folder, message: `${folder} is a file, not a folder.` } };
	} catch (error) {
		return { ok: false, refusal: { outcome: "failed", message: `Could not find ${folder}: ${messageOf(error)}` } };
	}
	return { ok: true, real };
}

/**
 * The folder Git answers for `folder`: the nearest one at or above it, up to
 * the worktree, with its own `.git`, such as a submodule, whose paths the
 * worktree's Git refuses to look at. "" for the worktree itself.
 */
async function nearestRepository(worktree: string, folder: string): Promise<string> {
	const parts = folder === "" ? [] : folder.split("/");
	for (let length = parts.length; length > 0; length--) {
		const candidate = parts.slice(0, length).join("/");
		if (await lstat(fullPath(fullPath(worktree, candidate), ".git")).then(() => true, () => false)) return candidate;
	}
	return "";
}

const kindOf = (entry: Dirent): FolderEntry["kind"] => entry.isSymbolicLink() ? "link" : entry.isDirectory() ? "folder" : "file";

/**
 * Which of `paths`, relative to the worktree, Git ignores: `git check-ignore`
 * with the paths on standard input, so no name is taken as an option or a
 * pathspec. A tracked file is never ignored, and an entry inside an ignored
 * folder is. Read-only: Git runs without optional locks and with
 * `core.fsmonitor` off, so no index is written and no monitor starts.
 */
async function ignoredOf(git: string, worktree: string, paths: readonly string[]): Promise<{ ok: true; ignored: Set<string> } | { ok: false; message: string }> {
	if (paths.length === 0) return { ok: true, ignored: new Set() };
	const run = await readGit(["-c", "core.fsmonitor=false", "check-ignore", "--stdin", "-z"], {
		git, cwd: worktree, input: paths.map(path => `${path}\0`).join(""), timeoutMs: IGNORE_MILLISECONDS, stderrBytes: 2000,
	});
	if (!run.started) return { ok: false, message: `Could not run Git: ${messageOf(run.error)}` };
	if (run.timedOut) return { ok: false, message: "Git took too long to say which files it ignores." };
	// 0: some are ignored. 1: none is.
	if (run.exitCode !== 0 && run.exitCode !== 1) return { ok: false, message: `Git could not say which files it ignores: ${run.stderr.trim() || `it ended with ${run.exitCode}`}` };
	return { ok: true, ignored: new Set(run.stdout.split("\0").filter(path => path !== "")) };
}

/**
 * The folders of a worktree, listed one at a time, and watched while the
 * explorer shows them.
 *
 * - A listing goes through `locateFolder`, so only a folder inside a listed
 *   worktree, links included, is read.
 * - `.git` is never listed. A link is listed as a link and never followed,
 *   so the tree cannot lead out of the worktree.
 * - Reading a folder writes nothing. Git runs only to ask which entries it
 *   ignores (`ignoredOf`).
 * - A watch is on each folder alone, never on what is below it, and says a
 *   folder changed once its events settle.
 */
export function createWorktreeFolders(dependencies: WorktreeFoldersDependencies): WorktreeFolders {
	const {
		findRepository, git = "git", watchDirectory = watchWithNode, schedule = scheduleWithTimer, onChange = () => {},
		quietMilliseconds = QUIET_MILLISECONDS, mostMilliseconds = MOST_MILLISECONDS, warn = message => console.warn(message),
	} = dependencies;
	/** By worktree and folder. */
	const watches = new Map<string, { watch: DirectoryWatch; cancel: (() => void) | null; most: (() => void) | null }>();
	let asked = 0;
	const keyOf = (worktree: string, folder: string) => `${worktree}\0${folder}`;

	const stop = (key: string) => {
		const held = watches.get(key);
		if (!held) return;
		held.cancel?.();
		held.most?.();
		held.watch.close();
		watches.delete(key);
	};

	return {
		async list(request) {
			const { folder } = request;
			const located = await locateFolder(findRepository, request);
			if (!located.ok) return located.refusal;
			let found: Dirent[];
			try {
				found = await readdir(located.real, { withFileTypes: true });
			} catch (error) {
				const code = codeOf(error);
				if (code === "ENOENT") return { outcome: "missing", folder, message: `${folder} is not in this worktree. It may have been moved or deleted.` };
				if (code === "EACCES" || code === "EPERM") return { outcome: "failed", message: `This app may not read ${folder || request.worktree}.` };
				return { outcome: "failed", message: `Could not list ${folder || request.worktree}: ${messageOf(error)}` };
			}
			const entries = found.filter(entry => entry.name !== ".git").map(entry => ({ name: entry.name, path: entryPath(folder, entry.name), kind: kindOf(entry), ignored: false }));
			// Inside a submodule or another repository, that one is asked, with paths relative to it.
			const owner = await nearestRepository(request.worktree, folder);
			const inOwner = (path: string) => owner === "" ? path : path.slice(owner.length + 1);
			const asked = await ignoredOf(git, fullPath(request.worktree, owner), entries.map(entry => inOwner(entry.path)));
			const ignored = asked.ok ? { ok: true as const, ignored: new Set(entries.filter(entry => asked.ignored.has(inOwner(entry.path))).map(entry => entry.path)) } : asked;
			if (!ignored.ok) return { outcome: "failed", message: `${ignored.message} ${NOT_LISTED}` };
			for (const entry of entries) entry.ignored = ignored.ignored.has(entry.path);
			return { outcome: "listed", folder, ...listedEntries(entries, request.ignored) };
		},

		async watch(wanted) {
			const ask = ++asked;
			const keep = new Map<string, { worktree: string; repository: string; folder: string; real: string }>();
			if (wanted !== null) {
				for (const folder of foldersToWatch(wanted.folders)) {
					const located = await locateFolder(findRepository, { ...wanted, folder });
					if (located.ok) keep.set(keyOf(wanted.worktree, folder), { worktree: wanted.worktree, repository: wanted.repository, folder, real: located.real });
				}
			}
			// A newer set was asked for while this one was checked: that one wins.
			if (ask !== asked) return;
			for (const key of [...watches.keys()]) if (!keep.has(key)) stop(key);
			for (const [key, target] of keep) {
				if (watches.has(key)) continue;
				const report = () => {
					const now = watches.get(key);
					if (!now) return;
					now.cancel?.();
					now.most?.();
					now.cancel = null;
					now.most = null;
					onChange({ repository: target.repository, worktree: target.worktree, folder: target.folder });
				};
				const tell = () => {
					const held = watches.get(key);
					if (!held) return;
					held.cancel?.();
					held.cancel = schedule(report, quietMilliseconds);
					held.most ??= schedule(report, mostMilliseconds);
				};
				try {
					const watch = watchDirectory(target.real, false, name => {
						if (name !== ".git") tell();
					}, error => {
						warn(`Stopped watching ${target.real}: ${messageOf(error)}`);
						stop(key);
					});
					watches.set(key, { watch, cancel: null, most: null });
				} catch (error) {
					warn(`Could not watch ${target.real}: ${messageOf(error)}`);
				}
			}
		},

		close() {
			asked++;
			for (const key of [...watches.keys()]) stop(key);
		},
	};
}
