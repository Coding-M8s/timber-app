import { describe, expect, test } from "bun:test";
import { changedWords, wordRanges } from "../src/mainview/diff-words";
import type { DiffLine, DiffLineKind } from "../src/shared/file-changes";

const line = (kind: DiffLineKind, text: string): DiffLine => ({ kind, text, oldLine: kind === "added" ? null : 1, newLine: kind === "removed" ? null : 1 });

/** The marked text of each line, or null, so a test reads as the words it expects. */
function marked(lines: DiffLine[]): (string | null)[] {
	return changedWords(lines).map((range, index) => range === null ? null : lines[index]!.text.slice(range.from, range.to));
}

describe("the words that changed in a line", () => {
	test("mark the changed part of a small edit, out to whole words", () => {
		const [removed, added] = wordRanges("\treturn check(user);", "\treturn check(user, token);");
		expect(removed).toBeNull();
		expect(added).toEqual({ from: 18, to: 25 });
		expect(marked([line("removed", "const total = count + 1;"), line("added", "const total = counter + 1;")])).toEqual(["count", "counter"]);
		expect(marked([line("removed", "color: red;"), line("added", "color: blue;")])).toEqual(["red", "blue"]);
	});

	test("mark nothing in a line that was rewritten", () => {
		expect(wordRanges("return a + 1;", "throw new Error(\"no\");")).toEqual([null, null]);
		expect(wordRanges("    const x = foo(bar);", "    let y = baz(qux);")).toEqual([null, null]);
		expect(marked([line("removed", "# Old title"), line("added", "Something else entirely")])).toEqual([null, null]);
	});

	test("mark nothing in a line that did not change", () => {
		expect(wordRanges("same", "same")).toEqual([null, null]);
	});

	test("pair each run of removed lines with the run of added lines after it, line by line", () => {
		const lines = [
			line("context", "function f() {"),
			line("removed", "  let a = 1;"),
			line("removed", "  let b = 2;"),
			line("removed", "  let c = 3;"),
			line("added", "  let a = 10;"),
			line("context", "}"),
			line("added", "  let d = 4;"),
		];
		// Only the first removed line has a partner; the added line after the context has none.
		expect(marked(lines)).toEqual([null, "1", null, null, "10", null, null]);
	});

	test("an added line with no removed line before it, and a removed run at the end, mark nothing", () => {
		expect(marked([line("added", "  let a = 1;"), line("context", "x"), line("removed", "  let a = 1;")])).toEqual([null, null, null]);
	});

	test("Git's note between the runs does not part them", () => {
		const lines = [line("removed", "last = 1"), line("note", "No newline at end of file"), line("added", "last = 2"), line("note", "No newline at end of file")];
		expect(marked(lines)).toEqual(["1", null, "2", null]);
	});
});
