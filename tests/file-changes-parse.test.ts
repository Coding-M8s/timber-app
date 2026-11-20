import { describe, expect, test } from "bun:test";
import {
	type FileChange, MAX_DIFF_LINES, baseName, baseNamesArguments, commitArguments, diffArguments, filePathIn, parseDiff, parseNameStatus, parseStatus, readDiffOutput, relativePathProblem, savedBaseRef, sinceBase, statusArguments,
} from "../src/shared/file-changes";

/** Records as `git status --porcelain=v2 -z` prints them, each ended by a NUL. */
const status = (...records: string[]) => records.map(record => `${record}\0`).join("");
const HASH = "587be6b4c3f93f93c489c0111bba5596147a26cb";
const ZERO = "0000000000000000000000000000000000000000";
const ordinary = (xy: string, path: string) => `1 ${xy} N... 100644 100644 100644 ${HASH} ${HASH} ${path}`;

describe("parseStatus", () => {
	test("reads each kind of change into its area", () => {
		const output = status(
			ordinary(".M", "keep.txt"),
			ordinary("M.", "staged.txt"),
			`1 A. N... 000000 100644 100644 ${ZERO} ${HASH} added.txt`,
			ordinary(".D", "gone.txt"),
			ordinary("D.", "removed.txt"),
			`1 .T N... 120000 120000 100644 ${HASH} ${HASH} lnk`,
			`2 R. N... 100644 100644 100644 ${HASH} ${HASH} R100 new name.txt`, "old name.txt",
			`2 C. N... 100644 100644 100644 ${HASH} ${HASH} C75 copy.txt`, "source.txt",
			`u UU N... 100644 100644 100644 100644 ${HASH} ${HASH} ${HASH} both.txt`,
			"? d/new file.txt",
			"! ignored.log",
		);
		expect(parseStatus(output)).toEqual<FileChange[]>([
			{ area: "unstaged", kind: "modified", path: "keep.txt", previousPath: null },
			{ area: "staged", kind: "modified", path: "staged.txt", previousPath: null },
			{ area: "staged", kind: "added", path: "added.txt", previousPath: null },
			{ area: "unstaged", kind: "deleted", path: "gone.txt", previousPath: null },
			{ area: "staged", kind: "deleted", path: "removed.txt", previousPath: null },
			{ area: "unstaged", kind: "type-changed", path: "lnk", previousPath: null },
			{ area: "staged", kind: "renamed", path: "new name.txt", previousPath: "old name.txt" },
			{ area: "staged", kind: "copied", path: "copy.txt", previousPath: "source.txt" },
			{ area: "conflicted", kind: "conflicted", path: "both.txt", previousPath: null },
			{ area: "unstaged", kind: "untracked", path: "d/new file.txt", previousPath: null },
		]);
	});

	test("lists a file staged and edited again once in each area", () => {
		expect(parseStatus(status(`1 AM N... 000000 100644 100644 ${ZERO} ${HASH} staged.txt`))).toEqual([
			{ area: "staged", kind: "added", path: "staged.txt", previousPath: null },
			{ area: "unstaged", kind: "modified", path: "staged.txt", previousPath: null },
		]);
	});

	test("keeps the original path only with the staged rename, not with an edit after it", () => {
		expect(parseStatus(status(`2 RM N... 100644 100644 100644 ${HASH} ${HASH} R90 b.txt`, "a.txt"))).toEqual([
			{ area: "staged", kind: "renamed", path: "b.txt", previousPath: "a.txt" },
			{ area: "unstaged", kind: "modified", path: "b.txt", previousPath: null },
		]);
	});

	test("reads a rename in the work tree of a file added with intent to add", () => {
		expect(parseStatus(status(`2 .R N... 100644 100644 100644 ${HASH} ${HASH} R100 moved.txt`, "intent.txt"))).toEqual([
			{ area: "unstaged", kind: "renamed", path: "moved.txt", previousPath: "intent.txt" },
		]);
	});

	test("takes paths with spaces, line breaks, and non-ASCII characters whole", () => {
		const path = "folder with space/zażółć\nline.txt";
		expect(parseStatus(status(ordinary(".M", path), `? ${path}`)).map(file => file.path)).toEqual([path, path]);
	});

	test("reads a submodule entry like any other file", () => {
		expect(parseStatus(status(`1 .M SC.. 160000 160000 160000 ${HASH} ${HASH} vendor/lib`))).toEqual([
			{ area: "unstaged", kind: "modified", path: "vendor/lib", previousPath: null },
		]);
	});

	test("answers nothing for a clean worktree", () => {
		expect(parseStatus("")).toEqual([]);
	});

	test("drops a record that was cut off, and a rename that lost its original path", () => {
		const whole = status(ordinary(".M", "a.txt"), `2 R. N... 100644 100644 100644 ${HASH} ${HASH} R100 b.txt`, "old.txt");
		expect(parseStatus(whole.slice(0, whole.length - 4))).toEqual([{ area: "unstaged", kind: "modified", path: "a.txt", previousPath: null }]);
		expect(parseStatus(status(ordinary(".M", "a.txt")) + "1 .M N... 1006")).toEqual([{ area: "unstaged", kind: "modified", path: "a.txt", previousPath: null }]);
	});

	test("skips records that do not fit", () => {
		expect(parseStatus(status("1 .M too few fields", "# branch.oid abc", "?", "x unknown", ordinary("M", "short-xy.txt")))).toEqual([]);
	});
});

describe("statusArguments and diffArguments", () => {
	test("ask for every untracked file and take paths literally", () => {
		expect(statusArguments()).toEqual(["--literal-pathspecs", "status", "--porcelain=v2", "-z", "--untracked-files=all"]);
		expect(statusArguments(["a.txt", "-b"])).toEqual(["--literal-pathspecs", "status", "--porcelain=v2", "-z", "--untracked-files=all", "--", "a.txt", "-b"]);
	});

	const plain = ["--no-color", "--no-ext-diff", "--no-textconv"];
	const file = (area: FileChange["area"], kind: FileChange["kind"], previousPath: string | null = null): FileChange => ({ area, kind, path: "-p.txt", previousPath });

	test("compare the index with the last commit for staged changes, and the files with the index otherwise", () => {
		expect(diffArguments(file("staged", "modified"))).toEqual({ args: ["--literal-pathspecs", "diff", ...plain, "--cached", "--", "-p.txt"], differencesExit: false });
		expect(diffArguments(file("unstaged", "modified"))).toEqual({ args: ["--literal-pathspecs", "diff", ...plain, "--", "-p.txt"], differencesExit: false });
		expect(diffArguments(file("conflicted", "conflicted"))).toEqual({ args: ["--literal-pathspecs", "diff", ...plain, "--", "-p.txt"], differencesExit: false });
	});

	test("name both paths of a rename or a copy, with detection on", () => {
		expect(diffArguments(file("staged", "renamed", "old.txt")).args).toEqual(["--literal-pathspecs", "diff", ...plain, "--cached", "-M", "--", "old.txt", "-p.txt"]);
		expect(diffArguments(file("staged", "copied", "src.txt")).args).toEqual(["--literal-pathspecs", "diff", ...plain, "--cached", "-C", "--find-copies-harder", "--", "src.txt", "-p.txt"]);
	});

	test("compare an untracked file with nothing", () => {
		expect(diffArguments(file("unstaged", "untracked"))).toEqual({ args: ["diff", ...plain, "--no-index", "--", "/dev/null", "-p.txt"], differencesExit: true });
	});
});

describe("parseDiff", () => {
	test("reads a modification with line numbers, a note, and the hunk's own line", () => {
		const diff = parseDiff([
			"diff --git c/a.txt i/a.txt",
			"index 4cb29ea..1a2b3c4 100644",
			"--- c/a.txt",
			"+++ i/a.txt",
			"@@ -2,3 +2,3 @@ function run() {",
			" two",
			"-three",
			"+THREE",
			"",
			"\\ No newline at end of file",
		].join("\n") + "\n");
		expect(diff).toEqual({
			kind: "text",
			sections: [{
				header: [],
				hunks: [{
					header: "@@ -2,3 +2,3 @@ function run() {",
					lines: [
						{ kind: "context", text: "two", oldLine: 2, newLine: 2 },
						{ kind: "removed", text: "three", oldLine: 3, newLine: null },
						{ kind: "added", text: "THREE", oldLine: null, newLine: 3 },
						{ kind: "context", text: "", oldLine: 4, newLine: 4 },
						{ kind: "note", text: "No newline at end of file", oldLine: null, newLine: null },
					],
				}],
			}],
		});
	});

	test("keeps the extended header lines worth showing, for a rename without edits", () => {
		const diff = parseDiff("diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n");
		expect(diff).toEqual({ kind: "text", sections: [{ header: ["similarity index 100%", "rename from old.txt", "rename to new.txt"], hunks: [] }] });
	});

	test("reads a new file as all additions, and an empty new file as its header only", () => {
		const added = parseDiff("diff --git 1/n.txt 2/n.txt\nnew file mode 100644\nindex 0000000..5fe505c\n--- /dev/null\n+++ 2/n.txt\t\n@@ -0,0 +1,2 @@\n+n1\n+n2\n");
		expect(added).toEqual({
			kind: "text",
			sections: [{
				header: ["new file mode 100644"],
				hunks: [{ header: "@@ -0,0 +1,2 @@", lines: [{ kind: "added", text: "n1", oldLine: null, newLine: 1 }, { kind: "added", text: "n2", oldLine: null, newLine: 2 }] }],
			}],
		});
		expect(parseDiff("diff --git a/e b/e\nnew file mode 100644\nindex 0000000..e69de29\n")).toEqual({ kind: "text", sections: [{ header: ["new file mode 100644"], hunks: [] }] });
	});

	test("reads a deletion as all removals", () => {
		const diff = parseDiff("diff --git a/g b/g\ndeleted file mode 100644\nindex 587be6b..0000000\n--- a/g\n+++ /dev/null\n@@ -1 +0,0 @@\n-x\n");
		expect(diff.kind === "text" && diff.sections[0]!.hunks[0]!.lines).toEqual([{ kind: "removed", text: "x", oldLine: 1, newLine: null }]);
	});

	test("reads a type change as two sections", () => {
		const diff = parseDiff([
			"diff --git i/lnk w/lnk", "deleted file mode 120000", "index 7ad106d..0000000", "--- i/lnk", "+++ /dev/null", "@@ -1 +0,0 @@", "-link-target", "\\ No newline at end of file",
			"diff --git i/lnk w/lnk", "new file mode 100644", "index 0000000..b9bca01", "--- /dev/null", "+++ w/lnk", "@@ -0,0 +1 @@", "+plain", "",
		].join("\n"));
		expect(diff.kind === "text" && diff.sections.map(section => section.header)).toEqual([["deleted file mode 120000"], ["new file mode 100644"]]);
	});

	test("reads a combined diff of a conflicted file, without line numbers", () => {
		const diff = parseDiff([
			"diff --cc keep.txt", "index 223b783,f70f10e..0000000", "--- i/keep.txt", "+++ w/keep.txt",
			"@@@ -1,1 -1,1 +1,5 @@@", "++<<<<<<< HEAD", " +B", "++=======", "+ A", "++>>>>>>> other", " -gone", "  same", "",
		].join("\n"));
		expect(diff.kind === "text" && diff.sections[0]!.hunks[0]!.lines.map(line => [line.kind, line.text, line.oldLine, line.newLine])).toEqual([
			["added", "<<<<<<< HEAD", null, null],
			["added", "B", null, null],
			["added", "=======", null, null],
			["added", "A", null, null],
			["added", ">>>>>>> other", null, null],
			["removed", "gone", null, null],
			["context", "same", null, null],
		]);
	});

	test("knows a binary file by Git's words or a binary patch", () => {
		expect(parseDiff("diff --git a/b.bin b/b.bin\nindex 1..2 100644\nBinary files a/b.bin and b/b.bin differ\n")).toEqual({ kind: "binary" });
		expect(parseDiff("diff --git a/b.bin b/b.bin\nindex 1..2 100644\nGIT binary patch\nliteral 3\n")).toEqual({ kind: "binary" });
	});

	test("keeps a line that only looks like a header inside a hunk", () => {
		const diff = parseDiff("diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n--- a/y\n++++ b/y\n");
		expect(diff.kind === "text" && diff.sections[0]!.hunks[0]!.lines.map(line => [line.kind, line.text])).toEqual([["removed", "-- a/y"], ["added", "+++ b/y"]]);
	});

	test("keeps a carriage return as part of the line", () => {
		const diff = parseDiff("diff --git a/w b/w\n--- a/w\n+++ b/w\n@@ -1 +1 @@\n-a\r\n+b\r\n");
		expect(diff.kind === "text" && diff.sections[0]!.hunks[0]!.lines.map(line => line.text)).toEqual(["a\r", "b\r"]);
	});
});

describe("readDiffOutput", () => {
	test("says unchanged for no output, and too large for cut or long output", () => {
		expect(readDiffOutput("", false)).toEqual({ kind: "unchanged" });
		expect(readDiffOutput("diff --git a/x b/x\n@@ -1 +1 @@\n-a\n", true)).toEqual({ kind: "too-large", lines: null });
		const long = ["diff --git a/x b/x", `@@ -0,0 +1,${MAX_DIFF_LINES} @@`, ...Array.from({ length: MAX_DIFF_LINES }, () => "+x")].join("\n");
		expect(readDiffOutput(long, false)).toEqual({ kind: "too-large", lines: MAX_DIFF_LINES + 2 });
		const fits = ["diff --git a/x b/x", "@@ -0,0 +1,10 @@", ...Array.from({ length: 10 }, () => "+x")].join("\n");
		expect(readDiffOutput(fits, false).kind).toBe("text");
	});
});

describe("paths in a worktree", () => {
	test("accepts only relative paths that stay inside", () => {
		for (const ok of ["a.txt", "src/a b/zażółć.ts", "..hidden", "a..b/c"]) expect(relativePathProblem(ok)).toBeNull();
		for (const bad of ["", "/etc/passwd", "../x", "a/../../x", "a//b", "./a", "a/", "C:/x", "a\\b", "a\0b"]) expect(relativePathProblem(bad)).not.toBeNull();
	});

	test("joins a relative path to the worktree with the worktree's own separator", () => {
		expect(filePathIn("/work/my repo", "src/a.ts")).toBe("/work/my repo/src/a.ts");
		expect(filePathIn("/work/my repo/", "a.ts")).toBe("/work/my repo/a.ts");
		expect(filePathIn("C:\\work\\repo", "src/a.ts")).toBe("C:\\work\\repo\\src\\a.ts");
	});
});

describe("comparing with the base", () => {
	const COMMIT = "126c0120bf719fafc110bf4b3dd65333caac142c";
	/** Records as `git diff --name-status -z` prints them, each ended by a NUL. */
	const names = (...records: string[]) => records.map(record => `${record}\0`).join("");

	test("parseNameStatus reads each kind, renames and copies with both paths", () => {
		const output = names("M", "keep.txt", "A", "new.txt", "D", "gone.txt", "T", "lnk", "R087", "old name.txt", "new name.txt", "C075", "source.txt", "copy.txt");
		expect(parseNameStatus(output)).toEqual<FileChange[]>([
			{ area: "base", kind: "modified", path: "keep.txt", previousPath: null },
			{ area: "base", kind: "added", path: "new.txt", previousPath: null },
			{ area: "base", kind: "deleted", path: "gone.txt", previousPath: null },
			{ area: "base", kind: "type-changed", path: "lnk", previousPath: null },
			{ area: "base", kind: "renamed", path: "new name.txt", previousPath: "old name.txt" },
			{ area: "base", kind: "copied", path: "copy.txt", previousPath: "source.txt" },
		]);
	});

	test("parseNameStatus drops an unmerged entry, an unknown letter, and a record cut short", () => {
		expect(parseNameStatus(names("U", "both.txt", "X", "odd.txt", "M", "kept.txt"))).toEqual([{ area: "base", kind: "modified", path: "kept.txt", previousPath: null }]);
		// Cut inside a rename: the new path never came.
		expect(parseNameStatus(`${names("M", "a.txt", "R100", "old.txt")}new`)).toEqual([{ area: "base", kind: "modified", path: "a.txt", previousPath: null }]);
		expect(parseNameStatus("M\0a.t")).toEqual([]);
		expect(parseNameStatus("")).toEqual([]);
	});

	test("sinceBase keeps conflicts from the status, the base diff for the rest, and untracked files on their own", () => {
		const status: FileChange[] = [
			{ area: "conflicted", kind: "conflicted", path: "both.txt", previousPath: null },
			{ area: "staged", kind: "modified", path: "a.txt", previousPath: null },
			{ area: "unstaged", kind: "untracked", path: "a.txt", previousPath: null },
			{ area: "unstaged", kind: "untracked", path: "new.txt", previousPath: null },
		];
		const since: FileChange[] = [
			{ area: "base", kind: "modified", path: "both.txt", previousPath: null },
			{ area: "base", kind: "deleted", path: "a.txt", previousPath: null },
			{ area: "base", kind: "modified", path: "committed.txt", previousPath: null },
		];
		expect(sinceBase(status, since)).toEqual<FileChange[]>([
			{ area: "conflicted", kind: "conflicted", path: "both.txt", previousPath: null },
			{ area: "base", kind: "deleted", path: "a.txt", previousPath: null },
			{ area: "base", kind: "modified", path: "committed.txt", previousPath: null },
			{ area: "untracked", kind: "untracked", path: "a.txt", previousPath: null },
			{ area: "untracked", kind: "untracked", path: "new.txt", previousPath: null },
		]);
	});

	test("the base diff names the commit, literal paths, and plain output", () => {
		expect(baseNamesArguments(COMMIT)).toEqual(["--literal-pathspecs", "diff", "--no-color", "--no-ext-diff", "--name-status", "-z", "-M", COMMIT, "--"]);
		expect(baseNamesArguments(COMMIT, ["a b.txt"])).toEqual(["--literal-pathspecs", "diff", "--no-color", "--no-ext-diff", "--name-status", "-z", "-M", COMMIT, "--", "a b.txt"]);
		const renamed: FileChange = { area: "base", kind: "renamed", path: "new.txt", previousPath: "old.txt" };
		expect(diffArguments(renamed, COMMIT)).toEqual({ args: ["--literal-pathspecs", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "-M", COMMIT, "--", "old.txt", "new.txt"], differencesExit: false });
		const untracked: FileChange = { area: "untracked", kind: "untracked", path: "n.txt", previousPath: null };
		expect(diffArguments(untracked, COMMIT).args).toEqual(["diff", "--no-color", "--no-ext-diff", "--no-textconv", "--no-index", "--", "/dev/null", "n.txt"]);
	});

	test("a base diff needs a commit", () => {
		expect(() => diffArguments({ area: "base", kind: "modified", path: "a.txt", previousPath: null })).toThrow();
		expect(() => diffArguments({ area: "base", kind: "modified", path: "a.txt", previousPath: null }, "--output=x")).toThrow();
	});

	test("savedBaseRef takes only an assigned ref under refs/, and says why otherwise", () => {
		expect(savedBaseRef({ kind: "assigned", ref: "refs/remotes/origin/main" })).toEqual({ ok: true, ref: "refs/remotes/origin/main" });
		expect(savedBaseRef({ kind: "assigned", ref: "refs/heads/main" })).toEqual({ ok: true, ref: "refs/heads/main" });
		for (const base of [null, { kind: "unassigned" } as const, { kind: "invalid", reason: "stale" } as const, { kind: "assigned", ref: "--output=x" } as const, { kind: "assigned", ref: "main" } as const]) {
			const answer = savedBaseRef(base);
			expect(answer.ok).toBe(false);
			expect(!answer.ok && answer.reason.length > 0).toBe(true);
		}
		expect(savedBaseRef({ kind: "unassigned" })).toEqual({ ok: false, reason: "Timber has no base saved for this worktree." });
	});

	test("names a remote base by remote and branch, and a local one by its branch", () => {
		expect(baseName("refs/remotes/origin/main")).toBe("origin/main");
		expect(baseName("refs/heads/main")).toBe("main");
		expect(baseName("refs/heads/release/2.4")).toBe("release/2.4");
		expect(baseName("refs/tags/v1")).toBe("refs/tags/v1");
	});

	test("a commit is resolved after the end of options", () => {
		expect(commitArguments("refs/remotes/origin/main")).toEqual(["rev-parse", "--verify", "--quiet", "--end-of-options", "refs/remotes/origin/main^{commit}"]);
	});
});
