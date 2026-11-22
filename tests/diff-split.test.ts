import { describe, expect, test } from "bun:test";
import { MIN_SPLIT_WIDTH, SPLIT_COMBINED, SPLIT_TOO_NARROW, shownLayout, sideLines, splitRows, trackLines } from "../src/shared/diff-split";
import { changedWords } from "../src/mainview/diff-words";
import { type DiffLine, parseDiff } from "../src/shared/file-changes";

/** The lines of the one hunk of a patch, from its lines after the `@@` header. */
function hunk(...body: string[]): DiffLine[] {
	const diff = parseDiff(["diff --git a/a.ts b/a.ts", "--- a/a.ts", "+++ b/a.ts", "@@ -1,20 +1,20 @@", ...body]);
	if (diff.kind !== "text") throw new Error("Not a text diff");
	return diff.sections[0]!.hunks[0]!.lines;
}

/** The rows as the texts on each side, "" for an empty cell. */
const texts = (lines: DiffLine[]) => splitRows(lines).map(row => [row.old === null ? "" : lines[row.old]!.text, row.new === null ? "" : lines[row.new]!.text]);

describe("splitRows", () => {
	test("puts a line both files share on both sides", () => {
		const lines = hunk(" one", " two");
		expect(splitRows(lines)).toEqual([{ old: 0, new: 0 }, { old: 1, new: 1 }]);
	});

	test("puts lines only removed on the left, with empty cells on the right", () => {
		expect(texts(hunk(" keep", "-gone", "-also gone", " end"))).toEqual([
			["keep", "keep"],
			["gone", ""],
			["also gone", ""],
			["end", "end"],
		]);
	});

	test("puts lines only added on the right, with empty cells on the left", () => {
		expect(texts(hunk(" keep", "+new", "+also new", " end"))).toEqual([
			["keep", "keep"],
			["", "new"],
			["", "also new"],
			["end", "end"],
		]);
	});

	test("pairs each removed line with the added line in the same place after it, and leaves the rest of the longer run beside empty cells", () => {
		expect(texts(hunk("-a1", "-a2", "-a3", "+b1", " mid", "-c1", "+d1", "+d2", "+d3"))).toEqual([
			["a1", "b1"],
			["a2", ""],
			["a3", ""],
			["mid", "mid"],
			["c1", "d1"],
			["", "d2"],
			["", "d3"],
		]);
	});

	test("keeps Git's note on the side of the line it follows, and does not break a pair", () => {
		const lines = hunk("-old last", "\\ No newline at end of file", "+new last", "\\ No newline at end of file");
		expect(texts(lines)).toEqual([
			["old last", "new last"],
			["No newline at end of file", "No newline at end of file"],
		]);
		expect(splitRows(lines)).toEqual([{ old: 0, new: 2 }, { old: 1, new: 3 }]);
	});

	test("pairs lines as the changed words do, so a marked word is beside the line it changed in", () => {
		const lines = hunk("-const retries = 3;", "-const name = 'a';", "\\ No newline at end of file", "+const retries = 5;", "+const name = 'b';", "+const extra = 1;");
		const words = changedWords(lines);
		for (const row of splitRows(lines)) {
			if (row.old === null || row.new === null) continue;
			// A pair with marked words is a row of the layout.
			expect(words[row.old] === null).toBe(words[row.new] === null);
		}
		expect(words[0]).not.toBeNull();
		expect(words[1]).not.toBeNull();
	});
});

describe("sideLines and trackLines", () => {
	const lines = hunk(" a", "-b", "-c", "+d", "+e", " f");

	test("list each side's lines in order, skipping the other side's", () => {
		expect(sideLines(lines, "old")).toEqual([0, 1, 2, 5]);
		expect(sideLines(lines, "new")).toEqual([0, 3, 4, 5]);
	});

	test("without a side, walk every line as Unified shows them", () => {
		expect(trackLines(lines, null)).toEqual([0, 1, 2, 3, 4, 5]);
		expect(trackLines(lines, "new")).toEqual([0, 3, 4, 5]);
	});
});

describe("shownLayout", () => {
	const plain = [{ header: "@@ -1,3 +1,3 @@" }];

	test("shows the choice when the tab is wide enough, or not measured yet", () => {
		expect(shownLayout("split", MIN_SPLIT_WIDTH, plain)).toEqual({ layout: "split", reason: null, cramped: false });
		expect(shownLayout("split", null, plain)).toEqual({ layout: "split", reason: null, cramped: false });
		expect(shownLayout("unified", 200, plain)).toEqual({ layout: "unified", reason: null, cramped: false });
	});

	test("shows Unified, and says why, when the tab is too narrow for two columns", () => {
		expect(shownLayout("split", MIN_SPLIT_WIDTH - 1, plain)).toEqual({ layout: "unified", reason: SPLIT_TOO_NARROW, cramped: false });
	});

	test("with Show Split anyway, shows Split in a narrow tab, cramped so it scrolls sideways, but never a combined diff", () => {
		expect(shownLayout("split", 300, plain, true)).toEqual({ layout: "split", reason: null, cramped: true });
		expect(shownLayout("split", MIN_SPLIT_WIDTH, plain, true)).toEqual({ layout: "split", reason: null, cramped: false });
		expect(shownLayout("split", 300, [{ header: "@@@ -1,3 -1,3 +1,4 @@@" }], true)).toEqual({ layout: "unified", reason: SPLIT_COMBINED, cramped: false });
	});

	test("shows a conflict's combined diff as Unified, and says why", () => {
		expect(shownLayout("split", 2000, [{ header: "@@@ -1,3 -1,3 +1,4 @@@" }])).toEqual({ layout: "unified", reason: SPLIT_COMBINED, cramped: false });
	});
});
