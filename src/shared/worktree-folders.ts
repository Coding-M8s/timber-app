/**
 * Listing the folders of a worktree, for the file explorer in the side
 * panel. One folder per request, so a big ignored folder such as
 * `node_modules` is read only when it is opened. Pure: the main process
 * reads the folder (see src/bun/worktree-folders.ts), and the mock engine
 * and the tests use these too.
 */

import { relativePathProblem } from "./file-changes";

/** Ask for the entries of one folder of a worktree in a repository from the app's list. */
export interface WorktreeFolderRequest {
	/** The path of the repository's primary checkout, as in the app's list. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. */
	worktree: string;
	/** Relative to the worktree, with `/` between folders, or "" for the worktree's own folder. */
	folder: string;
	/** Whether entries Git ignores are listed too. */
	ignored: boolean;
}

/** One entry of a listed folder. */
export interface FolderEntry {
	name: string;
	/** Relative to the worktree, with `/` between folders. */
	path: string;
	/** A link is never a folder here, so the tree cannot follow one out of the worktree or around in a circle. */
	kind: "folder" | "file" | "link";
	/** Whether Git ignores it. */
	ignored: boolean;
}

/** A folder with more entries than this lists the first ones, folders first, and says how many more there are. */
export const MAX_FOLDER_ENTRIES = 1000;

export type WorktreeFolderResult =
	/** `more` is how many entries are not listed, past `MAX_FOLDER_ENTRIES`. */
	| { outcome: "listed"; folder: string; entries: FolderEntry[]; more: number }
	/** Nothing is at that path, or it is not a folder. */
	| { outcome: "missing"; folder: string; message: string }
	/** The path, or a link on the way, leads outside the worktree. */
	| { outcome: "outside"; folder: string; message: string }
	/** The repository is not in the app's list, Timber does not list the worktree, or its folder is gone. */
	| { outcome: "not-listed"; message: string }
	| { outcome: "failed"; message: string };

/** The folders of one worktree the explorer shows, to hear when their entries change. */
export interface WorktreeFolderWatch {
	repository: string;
	worktree: string;
	/** Relative to the worktree, "" for its own folder. */
	folders: string[];
}

/** At most this many folders are watched at once. Past it, the first ones, the shallowest, are. */
export const MAX_WATCHED_FOLDERS = 100;

/** An entry of a watched folder was made, changed, or removed. */
export interface WorktreeFolderChange {
	repository: string;
	worktree: string;
	folder: string;
}

/** The path of an entry of a folder, relative to the worktree. */
export function entryPath(folder: string, name: string): string {
	return folder === "" ? name : `${folder}/${name}`;
}

/** Why a folder may not be listed, or null when it may: "" or a relative path that stays inside the worktree. */
export function folderPathProblem(folder: string): string | null {
	return folder === "" ? null : relativePathProblem(folder);
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Folders first, then by name as a person reads it: case and numbers as in a file manager, ties by code point. */
export function compareEntries(one: FolderEntry, other: FolderEntry): number {
	const folder = Number(other.kind === "folder") - Number(one.kind === "folder");
	if (folder !== 0) return folder;
	return collator.compare(one.name, other.name) || (one.name < other.name ? -1 : one.name > other.name ? 1 : 0);
}

/**
 * The entries to answer with: sorted, without ignored ones unless asked,
 * and at most `MAX_FOLDER_ENTRIES`, with how many more there were.
 */
export function listedEntries(entries: readonly FolderEntry[], ignored: boolean): { entries: FolderEntry[]; more: number } {
	const kept = entries.filter(entry => ignored || !entry.ignored).sort(compareEntries);
	return { entries: kept.slice(0, MAX_FOLDER_ENTRIES), more: Math.max(0, kept.length - MAX_FOLDER_ENTRIES) };
}

/** The folders to watch, shallowest first and without repeats, at most `MAX_WATCHED_FOLDERS`. */
export function foldersToWatch(folders: readonly string[]): string[] {
	const depth = (folder: string) => folder === "" ? 0 : folder.split("/").length;
	const unique = [...new Set(folders)].filter(folder => folderPathProblem(folder) === null);
	return unique.sort((one, other) => depth(one) - depth(other) || (one < other ? -1 : one > other ? 1 : 0)).slice(0, MAX_WATCHED_FOLDERS);
}
