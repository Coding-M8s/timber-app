/**
 * Dragging the `+` of a diff line over more lines of its hunk to start a note
 * on a range. Pure, so it can be tested without a window.
 */

import type { DiffLine } from "../shared/file-changes";
import { NOTE_LINE_LIMIT, notableLine, notedLines, noteSpan } from "../shared/review";

/** Why a dragged range stopped short of the pointer: the hunk ended there, or the range is as long as a note can be. */
export type DragStop = "edge" | "limit";

/** Where a range dragged from `anchor` ends, and why it stopped short of the pointer, when it did. */
export interface DraggedRange {
	end: number;
	stop: DragStop | null;
}

/**
 * The row of a hunk the pointer is over, from the rows' tops and bottoms on
 * screen, top to bottom, and the pointer's `y`: -1 above the first row,
 * `rows.length` below the last, and in a gap between rows, such as under a
 * note, the row above it.
 */
export function rowAtY(rows: readonly { top: number; bottom: number }[], y: number): number {
	if (rows.length === 0 || y < rows[0]!.top) return -1;
	if (y >= rows[rows.length - 1]!.bottom) return rows.length;
	let index = 0;
	while (index + 1 < rows.length && y >= rows[index + 1]!.top) index++;
	return index;
}

/**
 * Where a range dragged from `anchor` towards `target` ends. It walks from
 * the anchor one line at a time and stops before a line that takes no note
 * or outside the hunk ("edge"), and at `NOTE_LINE_LIMIT` lines ("limit").
 * `target` may be -1 or `hunk.length`, past the hunk's top or bottom.
 */
export function dragNoteEnd(hunk: readonly DiffLine[], anchor: number, target: number): DraggedRange {
	const step = target < anchor ? -1 : 1;
	let end = anchor;
	while (end !== target) {
		const next = end + step;
		if (next < 0 || next >= hunk.length || !notableLine(hunk[next]!)) return { end, stop: "edge" };
		if (Math.abs(next - anchor) + 1 > NOTE_LINE_LIMIT) return { end, stop: "limit" };
		end = next;
	}
	return { end, stop: null };
}

const STOP_WORDS: Record<DragStop, string> = {
	edge: "end of the hunk",
	limit: `${NOTE_LINE_LIMIT} lines at most`,
};

/**
 * The label beside the pointer while dragging: "Line 69", "Lines 69-71", or
 * "Removed lines 3-4" for lines only the old file has, and why the range
 * stopped, when it did, such as "Lines 69-98 (30 lines at most)".
 */
export function describeDraggedRange(hunk: readonly DiffLine[], anchor: number, range: DraggedRange): string {
	const lines = notedLines(hunk, anchor, range.end) ?? [];
	const { lines: numbers, removed } = noteSpan({ lines });
	const words = lines.length === 1 ? "Line" : "Lines";
	const named = removed ? `Removed ${words.toLowerCase()} ${numbers}` : `${words} ${numbers}`;
	return range.stop === null ? named : `${named} (${STOP_WORDS[range.stop]})`;
}
