import { describe, expect, test } from "bun:test";
import { MARKS_INCOMPLETE_NOTE, describeChangedCount, describeRowMark, rowMark, sameTreeMarks, treeMarks } from "../src/mainview/file-marks";
import type { ChangeArea, ChangeKind, FileChange } from "../src/shared/file-changes";
import { MAX_LISTED_FILES } from "../src/shared/file-changes";

const change = (area: ChangeArea, kind: ChangeKind, path: string, previousPath: string | null = null): FileChange =>
	({ area, kind, path, previousPath, added: null, removed: null, version: "" });

describe("treeMarks", () => {
	test("each changed file gets its kind, and every folder above it counts it, nested ones too", () => {
		const marks = treeMarks([
			change("unstaged", "modified", "src/app/main.ts"),
			change("staged", "added", "src/app/new.ts"),
			change("untracked", "untracked", "notes.md"),
		], false);
		expect(marks.files).toEqual({ "src/app/main.ts": "modified", "src/app/new.ts": "added", "notes.md": "untracked" });
		expect(marks.folders).toEqual({ src: 2, "src/app": 2 });
		expect(marks.more).toBe(false);
	});

	test("a file staged and edited again gets one mark, the staged kind, and counts once", () => {
		const marks = treeMarks([change("staged", "added", "a/b.ts"), change("unstaged", "modified", "a/b.ts")], false);
		expect(marks.files).toEqual({ "a/b.ts": "added" });
		expect(marks.folders).toEqual({ a: 1 });
	});

	test("a conflict takes priority over any other status", () => {
		const marks = treeMarks([change("unstaged", "modified", "x.ts"), change("conflicted", "conflicted", "x.ts"), change("staged", "modified", "x.ts")], false);
		expect(marks.files).toEqual({ "x.ts": "conflicted" });
	});

	test("a rename marks its new path only", () => {
		const marks = treeMarks([change("staged", "renamed", "new/name.ts", "old/name.ts")], false);
		expect(marks.files).toEqual({ "new/name.ts": "renamed" });
		expect(marks.folders).toEqual({ new: 1 });
	});

	test("a deleted file gets no mark and no folder counts it, as it has no row", () => {
		const marks = treeMarks([
			change("unstaged", "deleted", "gone/a.ts"),
			change("staged", "deleted", "gone/b.ts"),
			// Staged as modified and then deleted on disk: not on disk, so no row.
			change("staged", "modified", "gone/c.ts"),
			change("unstaged", "deleted", "gone/c.ts"),
		], false);
		expect(marks.files).toEqual({});
		expect(marks.folders).toEqual({});
	});

	test("a file deleted in the index and made again on disk is marked by what is on disk", () => {
		const marks = treeMarks([change("staged", "deleted", "back.ts"), change("untracked", "untracked", "back.ts")], false);
		expect(marks.files).toEqual({ "back.ts": "untracked" });
	});

	test("a new file in a new untracked folder marks the folder and the file", () => {
		const marks = treeMarks([change("untracked", "untracked", "fresh/deep/file.ts")], false);
		expect(marks.folders).toEqual({ fresh: 1, "fresh/deep": 1 });
		expect(marks.files).toEqual({ "fresh/deep/file.ts": "untracked" });
	});

	test("a folder Git reports as one entry, such as a nested repository, is marked under its own path", () => {
		const marks = treeMarks([change("untracked", "untracked", "vendor/nested/"), change("unstaged", "modified", "module")], false);
		expect(marks.files).toEqual({ "vendor/nested": "untracked", module: "modified" });
		expect(marks.folders).toEqual({ vendor: 1 });
	});

	test("type changes and copies keep their own kinds", () => {
		const marks = treeMarks([change("unstaged", "type-changed", "link"), change("staged", "copied", "copy.ts", "orig.ts")], false);
		expect(marks.files).toEqual({ link: "type-changed", "copy.ts": "copied" });
	});

	test("more is kept so the panel can say the marks may be incomplete", () => {
		expect(treeMarks([], true).more).toBe(true);
		expect(MARKS_INCOMPLETE_NOTE).toContain(MAX_LISTED_FILES.toLocaleString("en-US"));
		expect(MARKS_INCOMPLETE_NOTE).not.toContain(String.fromCharCode(0x2014));
	});
});

describe("rowMark and its words", () => {
	const marks = treeMarks([change("unstaged", "modified", "src/a.ts"), change("untracked", "untracked", "src/b.ts"), change("untracked", "untracked", "vendor/nested/")], false);

	test("a file shows its letter, a folder its count, and an unchanged row nothing", () => {
		expect(rowMark(marks, "src/a.ts", false)).toEqual({ kind: "file", change: "modified" });
		expect(rowMark(marks, "src", true)).toEqual({ kind: "folder", count: 2 });
		expect(rowMark(marks, "README.md", false)).toBeNull();
		expect(rowMark(marks, "docs", true)).toBeNull();
		expect(rowMark(undefined, "src/a.ts", false)).toBeNull();
	});

	test("a folder that is itself a change shows its letter", () => {
		expect(rowMark(marks, "vendor/nested", true)).toEqual({ kind: "file", change: "untracked" });
		expect(rowMark(marks, "vendor", true)).toEqual({ kind: "folder", count: 1 });
	});

	test("the words say the status or the count, singular for one", () => {
		expect(describeChangedCount(1)).toBe("1 changed file");
		expect(describeChangedCount(3)).toBe("3 changed files");
		expect(describeChangedCount(1200)).toBe("1,200 changed files");
		expect(describeRowMark({ kind: "file", change: "modified" })).toBe("Modified");
		expect(describeRowMark({ kind: "file", change: "untracked" })).toBe("Untracked");
		expect(describeRowMark({ kind: "folder", count: 2 })).toBe("2 changed files");
	});
});

describe("sameTreeMarks", () => {
	test("the same marks read again are the same, so the tree is left alone", () => {
		const files = [change("unstaged", "modified", "a/b.ts")];
		expect(sameTreeMarks(treeMarks(files, false), treeMarks(files, false))).toBe(true);
		expect(sameTreeMarks(treeMarks(files, false), treeMarks(files, true))).toBe(false);
		expect(sameTreeMarks(treeMarks(files, false), treeMarks([change("unstaged", "modified", "a/c.ts")], false))).toBe(false);
		expect(sameTreeMarks(undefined, treeMarks([], false))).toBe(false);
	});
});
