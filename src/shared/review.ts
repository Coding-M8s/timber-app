/**
 * Review notes: what the person writes on lines of a diff in the diff tab,
 * collected per worktree and sent to an agent as one message. Pure, so the
 * message can be tested without a window, and so what the preview shows is
 * exactly what is pasted.
 *
 * A note sits on one line, or a run of lines of one hunk, of one file in one
 * comparison. It keeps those lines as they were when it was written. When
 * the diff of that file is read again and the lines are no longer there as
 * they were, the note is outdated: it is kept, marked, and sent with the old
 * lines.
 */

import type { Comparison, DiffLine, FileChangeTarget, FileDiff } from "./file-changes";
import { sameFileChange } from "./file-changes";
import { cleanLine, isSafeText } from "./safe-text";

/** One line of the diff a note is on, as it was when the note was written. */
export interface NotedLine {
	kind: "context" | "added" | "removed";
	/** As Git printed it, without the marker column. */
	text: string;
	oldLine: number | null;
	newLine: number | null;
}

export interface ReviewNote {
	/** Made by the window. Unique among a worktree's notes. */
	id: string;
	/** The comparison the diff was in when the note was written. */
	comparison: Comparison;
	/** The file, as the list named it. */
	file: FileChangeTarget;
	/** The lines it is on, in order, from one hunk. Never empty. */
	lines: NotedLine[];
	/** What the person wrote. `noteProblem` accepts it. */
	text: string;
	/** The lines changed, or left the diff, since the note was written. */
	outdated: boolean;
}

/** The longest note, in characters. */
export const NOTE_TEXT_LIMIT = 10_000;
/** The most lines one note can be on. */
export const NOTE_LINE_LIMIT = 30;
/** A quoted line longer than this is cut, so one minified line cannot make the review too long to send. */
export const QUOTE_LENGTH_LIMIT = 300;

/** Whether a line of a diff can have a note: a line of the file with a number, not one of Git's notes or a line of a combined diff. */
export function notableLine(line: DiffLine): line is DiffLine & { kind: NotedLine["kind"] } {
	return line.kind !== "note" && (line.oldLine !== null || line.newLine !== null);
}

/** The note as it is kept: Windows line endings made `\n`, spaces at the end trimmed. */
export function normalizeNoteText(text: string): string {
	return text.replace(/\r\n?/g, "\n").trimEnd();
}

/** What is wrong with the text of a note, or null when it can be kept. Give it normalized. */
export function noteProblem(text: string): string | null {
	if (text.trim() === "") return "Write the note first.";
	if (text.length > NOTE_TEXT_LIMIT) return `The note is longer than ${NOTE_TEXT_LIMIT} characters.`;
	if (!isSafeText(text)) return "The note has a control or invisible character. Only line breaks and tabs are allowed.";
	return null;
}

/** The lines of a hunk from `first` to `last`, either way round, as a note keeps them, or null when one of them cannot have a note or there are too many. */
export function notedLines(hunk: readonly DiffLine[], first: number, last: number): NotedLine[] | null {
	const from = Math.min(first, last);
	const to = Math.max(first, last);
	if (from < 0 || to >= hunk.length || to - from + 1 > NOTE_LINE_LIMIT) return null;
	const lines: NotedLine[] = [];
	for (const line of hunk.slice(from, to + 1)) {
		if (!notableLine(line)) return null;
		lines.push({ kind: line.kind, text: line.text, oldLine: line.oldLine, newLine: line.newLine });
	}
	return lines;
}

function span(numbers: readonly number[]): string {
	const low = Math.min(...numbers);
	const high = Math.max(...numbers);
	return low === high ? `${low}` : `${low}-${high}`;
}

/**
 * The line numbers a note is on, as `3` or `3-5`, with the numbers of the
 * file as it is now. Lines that are only removed have only old numbers:
 * `removed` says so.
 */
export function noteSpan(note: Pick<ReviewNote, "lines">): { lines: string; removed: boolean } {
	const now = note.lines.flatMap(line => line.newLine === null ? [] : [line.newLine]);
	if (now.length > 0) return { lines: span(now), removed: false };
	return { lines: span(note.lines.flatMap(line => line.oldLine === null ? [] : [line.oldLine])), removed: true };
}

/**
 * Where a note is, as `path:line` or `path:first-last`, with the numbers of
 * the file as it is now. Lines that are only removed have only old numbers,
 * and say so. The path is cleaned, since a file's name can hold anything.
 */
export function noteLocation(note: Pick<ReviewNote, "file" | "lines">): string {
	const path = cleanLine(note.file.path);
	const { lines, removed } = noteSpan(note);
	if (!removed) return `${path}:${lines}`;
	const words = note.lines.length === 1 ? "removed line" : "removed lines";
	return `${path}:${lines} (${words}, numbered as before the change)`;
}

const MARKERS: Record<NotedLine["kind"], string> = { context: " ", added: "+", removed: "-" };

/** One noted line as it is shown: Git's marker, and the line, cleaned and cut. */
export function quotedParts(line: NotedLine): { marker: string; text: string } {
	// A file with Windows line endings has a carriage return at the end of each line.
	const text = cleanLine(line.text.endsWith("\r") ? line.text.slice(0, -1) : line.text);
	// Half of a surrogate pair left by the cut becomes U+FFFD: a lone one would make the review unsendable.
	const shown = text.length > QUOTE_LENGTH_LIMIT ? `${text.slice(0, QUOTE_LENGTH_LIMIT).toWellFormed()} [cut]` : text;
	return { marker: MARKERS[line.kind], text: shown };
}

/** One noted line as it is quoted: `> ` and Git's marker, then the line, cleaned and cut. */
export function quoteLine(line: NotedLine): string {
	const { marker, text } = quotedParts(line);
	return `> ${marker}${text}`;
}

export const OUTDATED_MARK = "(outdated: these lines changed or left the diff since the note)";

/**
 * The whole review as it is shown before it is sent and then pasted, notes
 * in their order: each with where it is, the lines it is on, and what was
 * written. Every line of it passes `pasteProblem`, whatever the files hold.
 */
export function buildReviewMessage(notes: readonly ReviewNote[]): string {
	const blocks = notes.map(note => [
		note.outdated ? `${noteLocation(note)} ${OUTDATED_MARK}` : noteLocation(note),
		...note.lines.map(quoteLine),
		note.text,
	].join("\n"));
	const title = notes.length === 1 ? "Review notes (1 note)" : `Review notes (${notes.length} notes)`;
	return [title, ...blocks].join("\n\n");
}

/** Whether a line of a diff is a noted line as it was: the same kind, text, and numbers. */
export const sameNotedLine = (noted: NotedLine, line: DiffLine) =>
	noted.kind === line.kind && noted.text === line.text && noted.oldLine === line.oldLine && noted.newLine === line.newLine;

/** Every line of a diff, in order. A binary or too large diff has none. */
function diffLines(diff: FileDiff): DiffLine[] {
	return diff.kind === "text" ? diff.sections.flatMap(section => section.hunks.flatMap(hunk => hunk.lines)) : [];
}

/**
 * Whether any of a note's lines is in `diff` as it was. An outdated note's
 * old lines may still be there in part; numbers that moved do not count, so
 * a line elsewhere with the same text is never taken for it.
 */
export function noteLinesShown(note: Pick<ReviewNote, "lines">, diff: FileDiff): boolean {
	const lines = diffLines(diff);
	return note.lines.some(noted => lines.some(line => sameNotedLine(noted, line)));
}

/**
 * The notes after the diff of `file` in `comparison` was read again: a note
 * on that file whose lines are not all there as they were is outdated, and
 * stays so. A file that is no longer changed there outdates its notes. A
 * binary or too large diff says nothing either way. Answers `notes` itself
 * when nothing changed.
 */
export function markOutdated(notes: readonly ReviewNote[], comparison: Comparison, file: FileChangeTarget, diff: FileDiff): readonly ReviewNote[] {
	if (diff.kind === "binary" || diff.kind === "too-large") return notes;
	const lines = diffLines(diff);
	let changed = false;
	const next = notes.map(note => {
		if (note.outdated || note.comparison !== comparison || !sameFileChange(note.file, file)) return note;
		const there = note.lines.every(noted => lines.some(line => sameNotedLine(noted, line)));
		if (there) return note;
		changed = true;
		return { ...note, outdated: true };
	});
	return changed ? next : notes;
}

/** The distinct files, with their comparison, that a review's notes are on, in the notes' order. */
export function notedFiles(notes: readonly ReviewNote[]): { comparison: Comparison; file: FileChangeTarget }[] {
	const files: { comparison: Comparison; file: FileChangeTarget }[] = [];
	for (const note of notes) {
		if (!files.some(seen => seen.comparison === note.comparison && sameFileChange(seen.file, note.file))) files.push({ comparison: note.comparison, file: note.file });
	}
	return files;
}

/** A note being written in the diff: where it starts and ends in one hunk, the lines as they were when chosen, and its text so far. */
export interface NoteDraft {
	/** Names the file, as the list does. */
	key: string;
	comparison: Comparison;
	section: number;
	hunk: number;
	anchor: number;
	end: number;
	lines: NotedLine[];
	text: string;
}

/** Where a line number was chosen in a diff. */
export interface ChosenLine {
	key: string;
	comparison: Comparison;
	section: number;
	hunk: number;
	line: number;
}

/**
 * The draft after a line number was chosen: a new note on that line, or with
 * `extend`, the draft stretched to it when it is in the same hunk and the
 * run stays within `NOTE_LINE_LIMIT`. The lines are taken as they show now,
 * and the text typed so far is kept. A line that cannot take a note leaves
 * the draft as it was.
 */
export function chooseNoteLine(current: NoteDraft | null, at: ChosenLine, hunk: readonly DiffLine[], extend: boolean): NoteDraft | null {
	const same = current !== null && current.key === at.key && current.comparison === at.comparison && current.section === at.section && current.hunk === at.hunk;
	if (extend && same) {
		const lines = notedLines(hunk, current.anchor, at.line);
		return lines === null ? current : { ...current, end: at.line, lines };
	}
	const lines = notedLines(hunk, at.line, at.line);
	if (lines === null) return current;
	return { key: at.key, comparison: at.comparison, section: at.section, hunk: at.hunk, anchor: at.line, end: at.line, lines, text: current?.text ?? "" };
}
