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
