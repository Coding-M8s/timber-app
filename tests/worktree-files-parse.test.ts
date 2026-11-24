import { describe, expect, test } from "bun:test";
import { MAX_FILE_BYTES, MAX_FILE_LINES, countLines, fileContentOf, isCompletePath, normalCompletePath, textLines, worktreeRelativePath } from "../src/shared/worktree-files";

const bytes = (text: string) => new TextEncoder().encode(text);

describe("fileContentOf", () => {
	test("reads UTF-8 text with its line count", () => {
		expect(fileContentOf(bytes("gęś\nzażółć\n"), 20)).toEqual({ kind: "text", text: "gęś\nzażółć\n", lines: 2 });
		expect(fileContentOf(bytes(""), 0)).toEqual({ kind: "text", text: "", lines: 0 });
	});

	test("finds a NUL byte or bytes that are not UTF-8 binary", () => {
		expect(fileContentOf(new Uint8Array([0x61, 0x00, 0x62]), 3)).toEqual({ kind: "binary" });
		expect(fileContentOf(new Uint8Array([0xff, 0xfe, 0x41]), 3)).toEqual({ kind: "binary" });
	});

	test("refuses more bytes than the limit, by the size the file had or by what was read", () => {
		expect(fileContentOf(bytes("x"), MAX_FILE_BYTES + 10)).toEqual({ kind: "too-large", bytes: MAX_FILE_BYTES + 10, lines: null });
		expect(fileContentOf(new Uint8Array(MAX_FILE_BYTES + 1).fill(0x61), 5)).toEqual({ kind: "too-large", bytes: MAX_FILE_BYTES + 1, lines: null });
	});

	test("refuses more lines than the limit", () => {
		const text = "\n".repeat(MAX_FILE_LINES + 1);
		expect(fileContentOf(bytes(text), text.length)).toEqual({ kind: "too-large", bytes: text.length, lines: MAX_FILE_LINES + 1 });
	});
});

describe("countLines and textLines", () => {
	test("count a last line without a new line, and no line for an empty text", () => {
		expect(countLines("")).toBe(0);
		expect(countLines("a")).toBe(1);
		expect(countLines("a\n")).toBe(1);
		expect(countLines("a\nb")).toBe(2);
		expect(countLines("\n\n")).toBe(2);
		expect(textLines("a\r\nb\n")).toEqual(["a", "b"]);
		expect(textLines("a\n\n")).toEqual(["a", ""]);
		expect(textLines("")).toEqual([]);
	});
});

describe("worktreeRelativePath", () => {
	const worktree = "/home/me/app-worktrees/feat x";

	test("takes a relative path from the worktree folder", () => {
		expect(worktreeRelativePath(worktree, "docs/plan.md")).toBe("docs/plan.md");
		expect(worktreeRelativePath(worktree, "./docs/plan.md")).toBe("docs/plan.md");
		expect(worktreeRelativePath(worktree, "docs/../README.md")).toBe("README.md");
	});

	test("takes an absolute path inside the worktree", () => {
		expect(worktreeRelativePath(worktree, "/home/me/app-worktrees/feat x/src/a.ts")).toBe("src/a.ts");
		expect(worktreeRelativePath(`${worktree}/`, "/home/me/app-worktrees/feat x/src/a.ts")).toBe("src/a.ts");
	});

	test("refuses paths outside the worktree", () => {
		expect(worktreeRelativePath(worktree, "../other/secret.txt")).toBeNull();
		expect(worktreeRelativePath(worktree, "docs/../../x")).toBeNull();
		expect(worktreeRelativePath(worktree, "/etc/passwd")).toBeNull();
		expect(worktreeRelativePath(worktree, "/home/me/app-worktrees/feat xy/a.ts")).toBeNull();
		expect(worktreeRelativePath(worktree, worktree)).toBeNull();
		expect(worktreeRelativePath(worktree, "")).toBeNull();
		expect(worktreeRelativePath(worktree, ".")).toBeNull();
	});

	test("reads a Windows path, ignoring the case of its folders", () => {
		expect(worktreeRelativePath("C:\\Code\\app", "c:\\code\\app\\src\\a.ts")).toBe("src/a.ts");
		expect(worktreeRelativePath("C:\\Code\\app", "src\\a.ts")).toBe("src/a.ts");
		expect(worktreeRelativePath("C:\\Code\\app", "D:\\a.ts")).toBeNull();
	});
});

describe("complete paths", () => {
	test("are from the top of the disk or a Windows drive, never from some folder", () => {
		for (const path of ["/tmp/a.md", "\\\\server\\share\\a.md", "C:\\notes\\a.md", "c:/notes/a.md"]) expect(isCompletePath(path)).toBe(true);
		for (const path of ["a.md", "./a.md", "../a.md", "", "~/a.md"]) expect(isCompletePath(path)).toBe(false);
	});

	test("work out . and .., doubled slashes, and keep their start", () => {
		expect(normalCompletePath("/tmp//notes/./deeper/../plan.md")).toBe("/tmp/notes/plan.md");
		expect(normalCompletePath("/../../etc/hosts")).toBe("/etc/hosts");
		expect(normalCompletePath("C:\\notes\\..\\plan.md")).toBe("C:\\plan.md");
		expect(normalCompletePath("relative/plan.md")).toBeNull();
		expect(normalCompletePath("/tmp/a\0b.md")).toBeNull();
	});
});
