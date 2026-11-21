/**
 * Reading one file of a worktree, for the read-only file viewer. Pure: the
 * main process opens the file (see src/bun/worktree-files.ts) and decides
 * what its bytes are with these functions, and the mock engine and the tests
 * use them too.
 */

import { relativePathProblem } from "./file-changes";

/** Ask for one file of a worktree in a repository from the app's list. */
export interface WorktreeFileRequest {
	/** The path of the repository's primary checkout, as in the app's list. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. */
	worktree: string;
	/** Relative to the worktree, with `/` between folders. Never absolute, never stepping out with `..`. */
	path: string;
}

/** A file larger than this is not shown. It is read up to one byte past it, so a growing file cannot slip by. */
export const MAX_FILE_BYTES = 1024 * 1024;
/** A file with more lines than this is not shown, so drawing it cannot freeze the window. */
export const MAX_FILE_LINES = 20_000;

/** What a file's bytes are, as the viewer shows them. */
export type FileContent =
	| { kind: "text"; text: string; lines: number }
	/** A NUL byte, or bytes that are not UTF-8. */
	| { kind: "binary" }
	/** More than `MAX_FILE_BYTES` or `MAX_FILE_LINES`. `bytes` is the size the file had when it was looked at. */
	| { kind: "too-large"; bytes: number; lines: number | null };

export type WorktreeFileResult =
	/** `path` is the file's path relative to the worktree, as asked. */
	| { outcome: "read"; path: string; content: FileContent }
	/** Nothing is at that path. */
	| { outcome: "missing"; path: string; message: string }
	/** Something is there, but not a plain file: a folder, a device, or a pipe. */
	| { outcome: "not-a-file"; path: string; message: string }
	/** The path, or the link it is, leads outside the worktree. */
	| { outcome: "outside"; path: string; message: string }
	/** The repository is not in the app's list, Timber does not list the worktree, or its folder is gone. */
	| { outcome: "not-listed"; message: string }
	| { outcome: "failed"; message: string };

/** How many lines a text has, counted as an editor counts them: a last line without a new line still counts, an empty text has none. */
export function countLines(text: string): number {
	if (text === "") return 0;
	let count = 1;
	for (let index = text.indexOf("\n"); index !== -1; index = text.indexOf("\n", index + 1)) count++;
	return text.endsWith("\n") ? count - 1 : count;
}

/** The lines of a text to draw, without the empty one after a final new line. */
export function textLines(text: string): string[] {
	if (text === "") return [];
	const lines = text.split(/\r?\n/);
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

/**
 * What a file is, from its first bytes. `size` is the size the file had,
 * which can be more than `bytes` holds when only the start was read.
 */
export function fileContentOf(bytes: Uint8Array, size: number): FileContent {
	if (bytes.includes(0)) return { kind: "binary" };
	if (size > MAX_FILE_BYTES || bytes.length > MAX_FILE_BYTES) return { kind: "too-large", bytes: Math.max(size, bytes.length), lines: null };
	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
	} catch {
		return { kind: "binary" };
	}
	const lines = countLines(text);
	if (lines > MAX_FILE_LINES) return { kind: "too-large", bytes: bytes.length, lines };
	return { kind: "text", text, lines };
}

/** Folders split by either slash, so a Windows path is read as one too. */
const parts = (path: string) => path.split(/[\\/]/).filter(part => part !== "");

/**
 * A path from a terminal or elsewhere as a path relative to the worktree,
 * with `/` between folders, or null when it is not one: empty, stepping out
 * of the worktree, or absolute and not inside it. A relative path is taken
 * from the worktree's folder; `./` and `name/../` are worked out first.
 * Only words: the main process checks again, links included.
 */
export function worktreeRelativePath(worktree: string, path: string): string | null {
	if (path === "" || path.includes("\0")) return null;
	const absolute = path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path);
	let rest: string[];
	if (absolute) {
		const base = parts(worktree);
		const given = parts(path);
		const windowsPath = /^[A-Za-z]:/.test(worktree);
		const same = (a: string, b: string) => windowsPath ? a.toLowerCase() === b.toLowerCase() : a === b;
		if (given.length <= base.length || !base.every((part, index) => same(part, given[index]!))) return null;
		rest = given.slice(base.length);
	} else {
		rest = parts(path);
	}
	const resolved: string[] = [];
	for (const part of rest) {
		if (part === ".") continue;
		if (part === "..") {
			if (resolved.length === 0) return null;
			resolved.pop();
		} else {
			resolved.push(part);
		}
	}
	if (resolved.length === 0) return null;
	const relative = resolved.join("/");
	return relativePathProblem(relative) === null ? relative : null;
}
