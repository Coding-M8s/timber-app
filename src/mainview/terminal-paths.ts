/**
 * File paths in a terminal line, for opening them in the file viewer. Pure,
 * so it is tested without a terminal (see ./terminal-view.ts for the clicks).
 */

/** A file path found in a line: `start` and `end` are string indexes, `end` past the last character. */
export interface FoundPath {
	start: number;
	end: number;
	/** The path as written, without a `:line` or `:line:column` after it. */
	path: string;
	/** The line number written after the path, if any. */
	line: number | null;
	/** The column written after the line number, if any. */
	column: number | null;
}

/** A web address, which the URL links handle; a path inside one is not a file. */
const URL = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

/**
 * A path: folders and a name with an extension that starts with a letter,
 * such as `src/app.ts`, `./docs/plan.md`, `/home/me/x/notes.txt`, or
 * `README.md`, folders and names starting with a dot such as
 * `.superpowers/plan.md` too, then maybe `:12` or `:12:4`. A name alone needs its extension,
 * so plain words and version numbers such as `1.2.3` are not paths.
 */
const PATH = /(?:\.{1,2}\/|\/)?(?:\.?[\w@+-][\w.@+-]*\/)*\.?[\w@+-][\w.@+-]*\.[A-Za-z][\w-]*(?::(\d+)(?::(\d+))?)?/g;

/** Characters that may come before a path: not part of a word or another path. */
const BEFORE = /[\s"'`(<[{=,;]/;

export function findFilePaths(text: string): FoundPath[] {
	const urls: [number, number][] = [];
	for (const match of text.matchAll(URL)) urls.push([match.index, match.index + match[0].length]);
	const found: FoundPath[] = [];
	for (const match of text.matchAll(PATH)) {
		const start = match.index;
		const end = start + match[0].length;
		if (start > 0 && !BEFORE.test(text.charAt(start - 1))) continue;
		if (urls.some(([from, to]) => start < to && end > from)) continue;
		// An email address or a package name such as `user@host.com` is not a file.
		if (match[0].includes("@") && !match[0].includes("/")) continue;
		const colon = match[0].search(/:\d/);
		const path = colon === -1 ? match[0] : match[0].slice(0, colon);
		found.push({ start, end, path, line: match[1] === undefined ? null : Number(match[1]), column: match[2] === undefined ? null : Number(match[2]) });
	}
	return found;
}

/** Where a found path asks the file to open, for `openFile`: its line and column, or nothing without a line. */
export function placeOf(found: Pick<FoundPath, "line" | "column">): { line: number; column: number | null } | undefined {
	return found.line === null ? undefined : { line: found.line, column: found.column };
}

/** One cell of a terminal row: its characters, empty for the second half of a wide one, and its width. */
export interface Cell {
	chars: string;
	width: number;
}

/**
 * A terminal row as text, with the column (from 1) each character of the text
 * starts in, so a match in the text can be drawn under the right cells even
 * after wide characters such as emoji.
 */
export function rowText(cells: readonly Cell[]): { text: string; columns: number[] } {
	let text = "";
	const columns: number[] = [];
	cells.forEach((cell, index) => {
		if (cell.width === 0) return;
		const chars = cell.chars === "" ? " " : cell.chars;
		for (let offset = 0; offset < chars.length; offset++) columns.push(index + 1);
		text += chars;
	});
	columns.push(cells.length + 1);
	return { text, columns };
}
