import type { DiffHunk, DiffLine } from "./file-changes";
import type { DiffLayout } from "./layout";

/**
 * The Split layout of a diff: old lines on the left, new on the right, each
 * edited line beside what it became. Pure, so it is tested without a window.
 */

/** A column of the Split layout: the old file on the left, the new on the right. */
export type DiffSide = "old" | "new";

/**
 * A stretch of a hunk: a line both files share, or a run of removed lines
 * and the added lines right after it. A run's lists hold the indexes of its
 * lines in the hunk, with Git's notes that follow them, such as "No newline
 * at end of file", which only come after a run's last line.
 */
export type HunkPart =
	| { kind: "same"; line: number }
	| { kind: "change"; removed: number[]; added: number[] };

/**
 * The hunk as stretches: each line both files share alone, and each run of
 * removed lines with the run of added lines right after it. Added lines with
 * no removed lines before them are a run with none removed. The one rule
 * for which old line goes with which new one, used by the Split layout and
 * by the changed words (`changedWords` in ./diff-words.ts).
 */
export function hunkParts(lines: readonly DiffLine[]): HunkPart[] {
	const parts: HunkPart[] = [];
	let at = 0;
	const run = (kind: "removed" | "added") => {
		const found: number[] = [];
		while (at < lines.length && (lines[at]!.kind === kind || (found.length > 0 && lines[at]!.kind === "note"))) found.push(at++);
		return found;
	};
	while (at < lines.length) {
		const kind = lines[at]!.kind;
		if (kind !== "removed" && kind !== "added") {
			parts.push({ kind: "same", line: at++ });
			continue;
		}
		const removed = run("removed");
		const added = run("added");
		parts.push({ kind: "change", removed, added });
	}
	return parts;
}

/** One row of the Split layout: the hunk's line on each side, by its index in the hunk, or null for an empty cell. */
export interface SplitRow {
	old: number | null;
	new: number | null;
}

/**
 * The rows of a hunk side by side: a line both files share on both sides,
 * and in each run, the first removed line beside the first added one, the
 * second beside the second, and so on, with an empty cell where one side
 * has no more lines.
 */
export function splitRows(lines: readonly DiffLine[]): SplitRow[] {
	const rows: SplitRow[] = [];
	for (const part of hunkParts(lines)) {
		if (part.kind === "same") {
			rows.push({ old: part.line, new: part.line });
			continue;
		}
		for (let row = 0; row < Math.max(part.removed.length, part.added.length); row++) {
			rows.push({ old: part.removed[row] ?? null, new: part.added[row] ?? null });
		}
	}
	return rows;
}

/** The indexes of the hunk's lines on one side of the Split layout, top to bottom. */
export function sideLines(lines: readonly DiffLine[], side: DiffSide): number[] {
	return splitRows(lines).flatMap(row => row[side] === null ? [] : [row[side]]);
}

/**
 * The indexes of the lines a note or a drag walks over: with a side, that
 * side's lines, and without one, every line of the hunk, as Unified shows
 * them.
 */
export function trackLines(lines: readonly DiffLine[], side: DiffSide | null): number[] {
	return side === null ? lines.map((_, index) => index) : sideLines(lines, side);
}

/**
 * The narrowest diff tab, in pixels, that shows Split: two columns of line
 * number, marker, and about 35 characters of code, a longer line wrapping
 * in its cell. With the sidebar and the side panel at their usual widths,
 * a window about 1200 pixels wide.
 */
export const MIN_SPLIT_WIDTH = 600;

export const SPLIT_TOO_NARROW = "Too narrow for Split, so this shows Unified.";
export const SPLIT_COMBINED = "A conflict's combined diff shows only as Unified.";

/**
 * How the diff tab lays its lines out: as chosen, except Unified when the
 * tab is narrower than `MIN_SPLIT_WIDTH` or the diff is a conflict's
 * combined diff, with why. A width not measured yet, as before the tab is
 * on screen, shows the choice. `forced`, from "Show Split anyway", shows
 * Split in a narrow tab too; `cramped` then says the columns need more room
 * than the tab has, so the diff scrolls sideways instead of squeezing them.
 */
export function shownLayout(chosen: DiffLayout, width: number | null, hunks: readonly Pick<DiffHunk, "header">[], forced = false): { layout: DiffLayout; reason: string | null; cramped: boolean } {
	if (chosen === "unified") return { layout: chosen, reason: null, cramped: false };
	if (hunks.some(hunk => hunk.header.startsWith("@@@"))) return { layout: "unified", reason: SPLIT_COMBINED, cramped: false };
	const narrow = width !== null && width < MIN_SPLIT_WIDTH;
	if (narrow && !forced) return { layout: "unified", reason: SPLIT_TOO_NARROW, cramped: false };
	return { layout: chosen, reason: null, cramped: narrow };
}
