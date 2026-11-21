import { describe, expect, test } from "bun:test";
import { findFilePaths, rowText } from "../src/mainview/terminal-paths";

const paths = (text: string) => findFilePaths(text).map(found => found.path);

describe("findFilePaths", () => {
	test("finds relative and absolute paths with their place in the line", () => {
		const text = "Wrote docs/plan.md and ./notes/report.txt to /home/me/app/out.log";
		expect(findFilePaths(text)).toEqual([
			{ start: 6, end: 18, path: "docs/plan.md", line: null },
			{ start: 23, end: 41, path: "./notes/report.txt", line: null },
			{ start: 45, end: 65, path: "/home/me/app/out.log", line: null },
		]);
	});

	test("finds a name alone, and keeps a line number apart", () => {
		expect(findFilePaths("see README.md")).toEqual([{ start: 4, end: 13, path: "README.md", line: null }]);
		expect(findFilePaths("src/app.ts:12:4 error")).toEqual([{ start: 0, end: 15, path: "src/app.ts", line: 12 }]);
		expect(findFilePaths("at (src/app.ts:7)")).toEqual([{ start: 4, end: 16, path: "src/app.ts", line: 7 }]);
	});

	test("leaves out a full stop or a bracket after the path", () => {
		expect(paths("Updated src/a.ts.")).toEqual(["src/a.ts"]);
		expect(paths("(see `docs/plan.md`),")).toEqual(["docs/plan.md"]);
		expect(paths("../shared/x.ts")).toEqual(["../shared/x.ts"]);
	});

	test("finds nothing in web addresses, words, versions, or email addresses", () => {
		expect(paths("open https://example.com/docs/plan.md now")).toEqual([]);
		expect(paths("version 1.2.3 and words only")).toEqual([]);
		expect(paths("mail me@example.com")).toEqual([]);
		expect(paths("key#name.ts")).toEqual([]);
	});

	test("finds folders and names that start with a dot", () => {
		expect(paths("wrote .superpowers/plan.md")).toEqual([".superpowers/plan.md"]);
		expect(paths("./.github/workflows/ci.yml")).toEqual(["./.github/workflows/ci.yml"]);
		expect(paths("src/.config/a.ts and /home/me/.cfg/x.toml")).toEqual(["src/.config/a.ts", "/home/me/.cfg/x.toml"]);
		expect(paths("edit .timber.toml")).toEqual([".timber.toml"]);
	});

	test("finds scoped package paths and several on one line", () => {
		expect(paths("node_modules/@xterm/xterm/lib/xterm.js and a.ts")).toEqual(["node_modules/@xterm/xterm/lib/xterm.js", "a.ts"]);
	});
});

describe("rowText", () => {
	test("maps each character to the column it starts in, after a wide character", () => {
		// "⏺ a.md": the record sign takes two cells, the second empty.
		const cells = [{ chars: "⏺", width: 2 }, { chars: "", width: 0 }, { chars: " ", width: 1 }, { chars: "a", width: 1 }, { chars: ".", width: 1 }, { chars: "m", width: 1 }, { chars: "d", width: 1 }];
		const row = rowText(cells);
		expect(row.text).toBe("⏺ a.md");
		const [found] = findFilePaths(row.text);
		expect(found?.path).toBe("a.md");
		expect(row.columns[found!.start]).toBe(4);
		expect(row.columns[found!.end - 1]).toBe(7);
	});

	test("reads an empty cell as a space", () => {
		expect(rowText([{ chars: "", width: 1 }, { chars: "x", width: 1 }]).text).toBe(" x");
	});
});
