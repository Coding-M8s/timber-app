import { describe, expect, test } from "bun:test";
import { describeDraggedRange, dragNoteEnd, rowAtY } from "../src/mainview/review-drag";
import type { DiffLine } from "../src/shared/file-changes";
import { NOTE_LINE_LIMIT } from "../src/shared/review";

const added = (text: string, newLine: number): DiffLine => ({ kind: "added", text, oldLine: null, newLine });
const removed = (text: string, oldLine: number): DiffLine => ({ kind: "removed", text, oldLine, newLine: null });
const context = (text: string, oldLine: number, newLine: number): DiffLine => ({ kind: "context", text, oldLine, newLine });
const gitNote: DiffLine = { kind: "note", text: "\\ No newline at end of file", oldLine: null, newLine: null };

/** Lines 68 to 72 of a file, the middle ones changed. */
const hunk: DiffLine[] = [
	context("export function a() {", 58, 68),
	removed("return issue.title;", 59),
	added("const state = 1;", 69),
	added("return state;", 70),
	context("}", 60, 71),
];

describe("the row under the pointer", () => {
	const rows = [{ top: 100, bottom: 118 }, { top: 118, bottom: 136 }, { top: 180, bottom: 198 }];

	test("is the row the pointer is over", () => {
		expect(rowAtY(rows, 100)).toBe(0);
		expect(rowAtY(rows, 125)).toBe(1);
		expect(rowAtY(rows, 197)).toBe(2);
	});

	test("in a gap between rows, such as under a note, is the row above", () => {
		expect(rowAtY(rows, 150)).toBe(1);
	});

	test("is -1 above the first row and the count below the last", () => {
		expect(rowAtY(rows, 99)).toBe(-1);
		expect(rowAtY(rows, 198)).toBe(3);
		expect(rowAtY([], 120)).toBe(-1);
	});
});

describe("dragging a range", () => {
	test("reaches the line under the pointer, either way", () => {
		expect(dragNoteEnd(hunk, 2, 4)).toEqual({ end: 4, stop: null });
		expect(dragNoteEnd(hunk, 2, 0)).toEqual({ end: 0, stop: null });
		expect(dragNoteEnd(hunk, 2, 2)).toEqual({ end: 2, stop: null });
	});

	test("stops at the hunk's edge when the pointer goes past it", () => {
		expect(dragNoteEnd(hunk, 2, hunk.length)).toEqual({ end: 4, stop: "edge" });
		expect(dragNoteEnd(hunk, 2, -1)).toEqual({ end: 0, stop: "edge" });
	});

	test("stops before a line that takes no note, such as Git's note", () => {
		const lines = [added("a", 1), added("b", 2), gitNote];
		expect(dragNoteEnd(lines, 0, 2)).toEqual({ end: 1, stop: "edge" });
	});

	test(`stops at ${NOTE_LINE_LIMIT} lines, either way`, () => {
		const long = Array.from({ length: 80 }, (_, index) => added(`${index}`, index + 1));
		expect(dragNoteEnd(long, 10, 70)).toEqual({ end: 10 + NOTE_LINE_LIMIT - 1, stop: "limit" });
		expect(dragNoteEnd(long, 50, 0)).toEqual({ end: 50 - NOTE_LINE_LIMIT + 1, stop: "limit" });
		expect(dragNoteEnd(long, 10, 10 + NOTE_LINE_LIMIT - 1)).toEqual({ end: 10 + NOTE_LINE_LIMIT - 1, stop: null });
	});
});

describe("dragging a range on one side of the Split layout", () => {
	// On the left: lines 0, 1, and 4 of the hunk. On the right: 0, 2, 3, and 4.
	test("walks only that side's lines, by their rows on screen, and ends on a line of the hunk", () => {
		expect(dragNoteEnd(hunk, 0, 3, "new")).toEqual({ end: 4, stop: null });
		expect(dragNoteEnd(hunk, 0, 2, "old")).toEqual({ end: 4, stop: null });
		expect(dragNoteEnd(hunk, 3, 0, "new")).toEqual({ end: 0, stop: null });
		expect(dragNoteEnd(hunk, 1, 3, "old")).toEqual({ end: 4, stop: "edge" });
	});

	test("labels only the side's lines", () => {
		expect(describeDraggedRange(hunk, 0, { end: 4, stop: null }, "new")).toBe("Lines 68-71");
		expect(describeDraggedRange(hunk, 1, { end: 1, stop: null }, "old")).toBe("Removed line 59");
		expect(describeDraggedRange(hunk, 0, { end: 4, stop: null }, "old")).toBe("Lines 68-71");
	});

	test(`counts ${NOTE_LINE_LIMIT} lines on the side, not the other side's between them`, () => {
		const long = [
			...Array.from({ length: 40 }, (_, index) => removed(`${index}`, index + 1)),
			...Array.from({ length: 40 }, (_, index) => added(`${index}`, index + 1)),
		];
		expect(dragNoteEnd(long, 40, 39, "new")).toEqual({ end: 40 + NOTE_LINE_LIMIT - 1, stop: "limit" });
	});
});

describe("the label beside the pointer", () => {
	test("names the line or the lines, with the numbers of the file as it is now", () => {
		expect(describeDraggedRange(hunk, 2, { end: 2, stop: null })).toBe("Line 69");
		expect(describeDraggedRange(hunk, 2, { end: 4, stop: null })).toBe("Lines 69-71");
	});

	test("names removed lines by their old numbers", () => {
		const lines = [removed("a", 3), removed("b", 4)];
		expect(describeDraggedRange(lines, 0, { end: 0, stop: null })).toBe("Removed line 3");
		expect(describeDraggedRange(lines, 0, { end: 1, stop: null })).toBe("Removed lines 3-4");
	});

	test("says why the range stopped", () => {
		expect(describeDraggedRange(hunk, 2, { end: 4, stop: "edge" })).toBe("Lines 69-71 (end of the hunk)");
		const long = Array.from({ length: 40 }, (_, index) => added(`${index}`, index + 69));
		expect(describeDraggedRange(long, 0, { end: 29, stop: "limit" })).toBe("Lines 69-98 (30 lines at most)");
	});
});
