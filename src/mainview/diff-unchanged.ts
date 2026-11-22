/**
 * The unchanged lines between the hunks of a diff, filled in from the file
 * on disk: unchanged lines are the same on both sides, so the file as it is
 * now holds them, wherever the new side of the diff is that file. Pure, so
 * it can be tested without a window.
 */

import type { DiffHunk, DiffLine, DiffSection, FileChange, FileDiff } from "../shared/file-changes";

/** The unchanged lines before one hunk: new line numbers `from` to `to`, and how far the old numbers are from them. */
export interface UnchangedGap {
	from: number;
	to: number;
	/** The old line number of a line here, less its new one. */
	offset: number;
}

/** A hunk as the diff draws it: Git's hunk, or the unchanged lines before one, shown or not. */
export interface ShownHunk extends DiffHunk {
	/** For the unchanged lines before a hunk: how many there are and whether they show. Null for Git's hunk. */
	unchanged: { count: number; shown: boolean; from: number } | null;
}

export interface ShownSection extends DiffSection {
	/**
	 * Twice as many as Git's hunks, in a fixed order: the unchanged lines before
	 * each hunk, then the hunk. A gap slot has no lines until it shows, and
	 * none at all where nothing can be filled in, so expanding never moves
	 * the index of a hunk or of its lines.
	 */
	hunks: ShownHunk[];
}

const PLAIN_HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

/** Where a hunk starts and how many lines it covers, on each side. Git writes a start of 0, or one before, for a side with no lines. */
function hunkRange(header: string): { oldFirst: number; newFirst: number; newNext: number } | null {
	const match = PLAIN_HUNK.exec(header);
	if (!match) return null;
	const [oldStart, oldCount, newStart, newCount] = [Number(match[1]), Number(match[2] ?? 1), Number(match[3]), Number(match[4] ?? 1)];
	const oldFirst = oldCount === 0 ? oldStart + 1 : oldStart;
	const newFirst = newCount === 0 ? newStart + 1 : newStart;
	return { oldFirst, newFirst, newNext: newFirst + newCount };
}

/**
 * The unchanged lines before each hunk of a plain diff, from the first line
 * of the file, by Git's hunk lines. Null for a hunk whose line Git did not
 * number, as in a combined diff. A gap may be empty.
 */
export function unchangedGaps(section: DiffSection): (UnchangedGap | null)[] {
	let next = 1;
	return section.hunks.map(hunk => {
		const range = hunkRange(hunk.header);
		if (range === null) return null;
		const gap = { from: next, to: range.newFirst - 1, offset: range.oldFirst - range.newFirst };
		next = range.newNext;
		return gap;
	});
}

/**
 * Whether the file on disk is the new side of this change's diff, so its
 * unchanged lines can be read from it: everything compared with the files
 * on disk, and a staged change while the same file has no unstaged edits.
 * A deleted file has nothing to expand, and a conflict's combined diff
 * numbers no lines.
 */
export function unchangedReadable(file: FileChange, listed: readonly FileChange[]): boolean {
	if (file.kind === "deleted" || file.kind === "conflicted" || file.kind === "untracked" || file.kind === "type-changed") return false;
	if (file.area === "unstaged" || file.area === "base") return true;
	if (file.area !== "staged") return false;
	return !listed.some(other => other.area === "unstaged" && other.path === file.path);
}

/** The lines of a file's text, as the diff numbers them. A line break at the very end starts no line. */
export function fileLines(text: string): string[] {
	const lines = text.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

/**
 * Whether `lines` are the new side of `diff`: every line of it on the new
 * side is there, at its number. Otherwise the file changed since the diff
 * was read, or is not its new side, and nothing is filled in.
 */
export function linesMatchDiff(diff: FileDiff, lines: readonly string[]): boolean {
	if (diff.kind !== "text" || diff.sections.length !== 1) return false;
	return diff.sections[0]!.hunks.every(hunk => hunk.lines.every(line => line.newLine === null || line.kind === "note" || lines[line.newLine - 1] === line.text));
}

/** The unchanged lines of a gap, as context lines of the diff. */
function gapLines(gap: UnchangedGap, lines: readonly string[]): DiffLine[] {
	const filled: DiffLine[] = [];
	for (let number = gap.from; number <= gap.to && number <= lines.length; number++) filled.push({ kind: "context", text: lines[number - 1]!, oldLine: number + gap.offset, newLine: number });
	return filled;
}

/**
 * The diff with every gap filled in from `lines`, for telling whether a
 * note's lines are still there: a note can be on an unchanged line. `lines`
 * null, or a diff they do not match, answers the diff as it is.
 */
export function fillUnchanged(diff: FileDiff, lines: readonly string[] | null): FileDiff {
	if (lines === null || diff.kind !== "text" || !linesMatchDiff(diff, lines)) return diff;
	const [section] = diff.sections;
	const gaps = unchangedGaps(section!);
	const hunks = section!.hunks.map((hunk, index) => {
		const gap = gaps[index];
		return gap ? { ...hunk, lines: [...gapLines(gap, lines), ...hunk.lines] } : hunk;
	});
	return { kind: "text", sections: [{ ...section!, hunks }] };
}

/**
 * The sections as the diff draws them: before each hunk, a slot for its
 * unchanged lines (see `ShownSection`). A gap shows its lines when `shown`
 * says so. Without `lines`, or when they do not match
 * the diff, every gap slot is empty.
 */
export function shownSections(diff: FileDiff, lines: readonly string[] | null, shown: (gap: UnchangedGap) => boolean): ShownSection[] {
	if (diff.kind !== "text") return [];
	const usable = lines !== null && linesMatchDiff(diff, lines);
	return diff.sections.map(section => {
		const gaps = usable ? unchangedGaps(section) : [];
		return {
			...section,
			hunks: section.hunks.flatMap((hunk, index): ShownHunk[] => {
				const gap = gaps[index] ?? null;
				const count = gap === null ? 0 : Math.max(0, Math.min(gap.to, lines!.length) - gap.from + 1);
				const open = gap !== null && count > 0 && shown(gap);
				const slot: ShownHunk = { header: "", lines: open ? gapLines(gap, lines!) : [], unchanged: gap === null || count === 0 ? null : { count, shown: open, from: gap.from } };
				return [slot, { ...hunk, unchanged: null }];
			}),
		};
	});
}

/** The words of a gap's row. */
export const describeUnchangedLines = (count: number) => `Show ${count} unchanged ${count === 1 ? "line" : "lines"}`;

/** Whether one of the new line numbers `from` to `to` holds a noted line, so its gap shows by itself. */
export const gapHoldsLine = (gap: UnchangedGap, newLines: readonly number[]) => newLines.some(number => number >= gap.from && number <= gap.to);
