import type { EditorState, Text } from "@codemirror/state";
import type { FilePlace } from "./store/state";

/**
 * The File tab editor's rules and words. Pure, so they can be tested
 * without a window.
 */

/** At most this many matches are counted; the count then says "or more". */
export const MAX_MATCHES = 10_000;

/** The count beside the search field, such as "3 of 12" or "No matches". `current` is -1 when no match is selected. */
export function describeMatches(query: string, count: number, current: number): string {
	if (query === "") return "";
	if (count === 0) return "No matches";
	const total = count >= MAX_MATCHES ? `${MAX_MATCHES.toLocaleString("en-US")} or more` : count.toLocaleString("en-US");
	if (current >= 0) return `${(current + 1).toLocaleString("en-US")} of ${total}`;
	return count === 1 ? "1 match" : `${total} matches`;
}

/** Where the caret is, as the status line says it, from 1: "Ln 12, Col 4". */
export function describeCaret(line: number, column: number): string {
	return `Ln ${line.toLocaleString("en-US")}, Col ${column.toLocaleString("en-US")}`;
}

/** The line count, as the status line says it. */
export function describeLineCount(lines: number): string {
	return lines === 1 ? "1 line" : `${lines.toLocaleString("en-US")} lines`;
}

/**
 * Where in the text a link's place puts the caret, as an offset: a line
 * below 1 is the first, and one past the end the start of the last; a
 * column counts characters from 1, as the status line does, and one past
 * the line's end is its end. No column is the line's start.
 */
export function placeOffset(doc: Text, place: FilePlace): number {
	if (place.line > doc.lines) return doc.line(doc.lines).from;
	const line = doc.line(Math.max(1, Math.floor(place.line)));
	const column = place.column === null ? 1 : Math.max(1, Math.floor(place.column));
	return line.from + Math.min(column - 1, line.length);
}

/**
 * What Tab and a new line indent with: a tab when the file indents its
 * first indented line with one, else that line's spaces (at most eight),
 * and a tab when nothing is indented yet.
 */
export function indentUnitOf(text: string): string {
	const found = /^([ \t]+)\S/m.exec(text);
	if (!found) return "\t";
	const lead = found[1]!;
	if (lead.startsWith("\t")) return "\t";
	return " ".repeat(Math.min(lead.length, 8));
}

/**
 * What the editor keeps of one open file between showings, beside the draft
 * in the store: the whole editor state (text, undo history, selection,
 * search) and the scroll. Kept out of the app's state, so typing changes
 * nothing that the rest of the window renders from.
 */
export interface FileEditMemory {
	/** Different for every memory, so a new one makes a new editor. */
	id: number;
	path: string;
	/** Set when the store drops it with the draft, so the editor going then gives the store nothing. */
	forgotten: boolean;
	/** Null until the editor first goes away. Used again only while it holds the store's draft. */
	state: EditorState | null;
	scrollTop: number;
	scrollLeft: number;
}

let memories = 0;

export function createFileEditMemory(path: string): FileEditMemory {
	return { id: ++memories, path, forgotten: false, state: null, scrollTop: 0, scrollLeft: 0 };
}
