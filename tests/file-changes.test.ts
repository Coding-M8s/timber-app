import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileChanges } from "../src/bun/file-changes";
import { createWorktreeFiles } from "../src/bun/worktree-files";
import { fileLines, fillUnchanged, linesMatchDiff, shownSections } from "../src/mainview/diff-unchanged";
import { type ChangeArea, type FileChange, type FileDiffResult, MAX_DIFF_BYTES, MAX_DIFF_LINES, parseDiff } from "../src/shared/file-changes";
import type { Repository } from "../src/shared/model";
import { windows } from "./support/runtime";
import { fingerprint, git } from "./support/timber";

let root: string;
let primary: string;
let linked: string;
let conflicted: string;

/** The repository as the app's list would answer, with these worktree paths. */
const listed = (paths: string[]): Repository => ({
	path: primary, name: "sample", available: true, failure: null,
	setup: "repository",
	worktrees: paths.map(path => ({
		id: path, path, canonicalPath: path, branch: "feat/x", head: null, primary: path === primary, detached: false, locked: false, prunable: false,
		pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null, baseCounts: null,
	})),
});

const changes = () => createFileChanges({ findRepository: async path => path === primary ? listed([primary, linked, conflicted]) : null });

/** Git as the person would run it, without the app's options, apart from not refreshing the index. */
function plainGit(cwd: string, ...args: string[]): { stdout: string; exitCode: number } {
	const result = Bun.spawnSync(["git", "-C", cwd, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" } });
	return { stdout: result.stdout.toString(), exitCode: result.exitCode };
}

const lines = (count: number, word: string) => Array.from({ length: count }, (_, index) => `${word} ${index + 1}`).join("\n") + "\n";

// The stand-in Git of the timeout test is a shell script, and the tree has a link and a `*` in a file name.
describe.skipIf(windows)("reading changes from real repositories", () => {
	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-changes-")));
		primary = join(root, "sample");
		linked = join(root, "sample-worktrees", "feat x");
		conflicted = join(root, "sample-worktrees", "conflict");
		git(root, "init", "--initial-branch=main", primary);
		const commit = (folder: string, files: Record<string, string>) => {
			for (const [name, text] of Object.entries(files)) {
				mkdirSync(join(folder, name, ".."), { recursive: true });
				writeFileSync(join(folder, name), text);
			}
			git(folder, "add", "--all");
			git(folder, "commit", "-m", "Files");
		};
		commit(primary, {
			"keep.txt": "one\ntwo\nthree\n",
			"staged.txt": "base\n",
			"gone.txt": "x\n",
			"removed.txt": "y\n",
			"old name.txt": lines(20, "line"),
			"clean.txt": "never changed\n",
			"b.bin": "\u0000\u0001binary",
			"star*.txt": "star\n",
			"star-other.txt": "other\n",
			"link-target": "target\n",
			"conflict.txt": "base\n",
		});
		symlinkSync("link-target", join(primary, "lnk"));
		git(primary, "add", "lnk");
		git(primary, "commit", "-m", "Link");
		git(primary, "worktree", "add", "-b", "feat/x", linked);
		git(primary, "worktree", "add", "-b", "conflict", conflicted);

		// Every kind of change, in the linked worktree, whose path has a space.
		writeFileSync(join(linked, "keep.txt"), "one\nTWO\nthree\n");
		writeFileSync(join(linked, "staged.txt"), "base\nstaged\n");
		git(linked, "add", "staged.txt");
		writeFileSync(join(linked, "staged.txt"), "base\nstaged\nthen edited\n");
		unlinkSync(join(linked, "gone.txt"));
		git(linked, "rm", "--quiet", "removed.txt");
		git(linked, "mv", "old name.txt", "new name.txt");
		writeFileSync(join(linked, "b.bin"), "\u0000\u0002changed");
		writeFileSync(join(linked, "star*.txt"), "star changed\n");
		writeFileSync(join(linked, "star-other.txt"), "other changed\n");
		unlinkSync(join(linked, "lnk"));
		writeFileSync(join(linked, "lnk"), "plain now\n");
		mkdirSync(join(linked, "new folder", "deeper"), { recursive: true });
		writeFileSync(join(linked, "new folder", "deeper", "new file.txt"), "n1\nn2");
		writeFileSync(join(linked, "zażółć.txt"), "gęś\n");
		writeFileSync(join(linked, "empty.txt"), "");
		writeFileSync(join(linked, "new.bin"), "\u0000\u0001\u0002");
		writeFileSync(join(linked, "long.txt"), lines(MAX_DIFF_LINES + 10, "row"));
		writeFileSync(join(linked, "huge.txt"), "x".repeat(MAX_DIFF_BYTES * 2));

		// A merge conflict in its own worktree.
		writeFileSync(join(conflicted, "conflict.txt"), "theirs\n");
		git(conflicted, "commit", "-am", "Theirs");
		writeFileSync(join(primary, "conflict.txt"), "ours\n");
		git(primary, "commit", "-am", "Ours");
		const merge = Bun.spawnSync(["git", "-C", conflicted, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "merge", "main"], { stdout: "pipe", stderr: "pipe" });
		expect(merge.exitCode).not.toBe(0);

		// Make the index's file times stale, which is when a plain `git diff` or `git status` rewrites the index.
		const later = new Date(Date.now() + 5000);
		for (const name of ["clean.txt", "keep.txt", "conflict.txt"]) {
			for (const folder of [linked, conflicted]) utimesSync(join(folder, name), later, later);
		}
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	/** What `git status --porcelain=v1 -uall` says, as area and path, read without the app's parser. */
	function statusEntries(folder: string): string[] {
		const records = plainGit(folder, "status", "--porcelain=v1", "-z", "--untracked-files=all").stdout.split("\0");
		const entries: string[] = [];
		for (let index = 0; index < records.length; index++) {
			const record = records[index]!;
			if (record === "") continue;
			const [x, y, path] = [record.charAt(0), record.charAt(1), record.slice(3)];
			// A rename or copy carries its original path as the next record.
			if (x === "R" || x === "C" || y === "R" || y === "C") index++;
			if (x === "?") {
				entries.push(`unstaged ${path}`);
			} else if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
				entries.push(`conflicted ${path}`);
			} else {
				if (x !== " ") entries.push(`staged ${path}`);
				if (y !== " ") entries.push(`unstaged ${path}`);
			}
		}
		return entries.sort();
	}

	const asEntries = (files: FileChange[]) => files.map(file => `${file.area} ${file.path}`).sort();

	async function diff(folder: string, area: ChangeArea, path: string, previousPath: string | null = null): Promise<FileDiffResult> {
		return changes().diff({ repository: primary, compare: "uncommitted", worktree: folder, file: { area, path, previousPath } });
	}

	test("lists exactly what git status lists, each kind in its area, and changes nothing", async () => {
		const before = [fingerprint(linked), fingerprint(conflicted), fingerprint(primary)];
		const indexFile = plainGit(linked, "rev-parse", "--path-format=absolute", "--git-path", "index").stdout.trim();
		const index = readFileSync(indexFile);

		const read = await changes().read({ repository: primary, compare: "uncommitted", worktree: linked });
		expect(read.outcome).toBe("read");
		if (read.outcome !== "read") return;
		expect(read.more).toBe(false);
		expect(asEntries(read.files)).toEqual(statusEntries(linked));
		const kinds = Object.fromEntries(read.files.map(file => [`${file.area} ${file.path}`, file.kind]));
		expect(kinds).toEqual({
			"unstaged keep.txt": "modified",
			"staged staged.txt": "modified",
			"unstaged staged.txt": "modified",
			"unstaged gone.txt": "deleted",
			"staged removed.txt": "deleted",
			"staged new name.txt": "renamed",
			"unstaged b.bin": "modified",
			"unstaged star*.txt": "modified",
			"unstaged star-other.txt": "modified",
			"unstaged lnk": "type-changed",
			"unstaged new folder/deeper/new file.txt": "untracked",
			"unstaged zażółć.txt": "untracked",
			"unstaged empty.txt": "untracked",
			"unstaged new.bin": "untracked",
			"unstaged long.txt": "untracked",
			"unstaged huge.txt": "untracked",
		});
		expect(read.files.find(file => file.kind === "renamed")?.previousPath).toBe("old name.txt");

		const conflict = await changes().read({ repository: primary, compare: "uncommitted", worktree: conflicted });
		expect(conflict.outcome === "read" && asEntries(conflict.files)).toEqual(statusEntries(conflicted));
		expect(conflict.outcome === "read" && conflict.files).toEqual([{ area: "conflicted", kind: "conflicted", path: "conflict.txt", previousPath: null, added: null, removed: null, version: expect.any(String) }]);

		// Every diff too, and then nothing at all may have changed.
		for (const file of read.files) await diff(linked, file.area, file.path, file.previousPath);
		await diff(conflicted, "conflicted", "conflict.txt");
		expect([fingerprint(linked), fingerprint(conflicted), fingerprint(primary)]).toEqual(before);
		expect(readFileSync(indexFile).equals(index)).toBe(true);
	});

	test("each file's line counts are its diff's added and removed lines, none for binary files, and reading them changes nothing", async () => {
		const before = [fingerprint(linked), fingerprint(conflicted), fingerprint(primary)];
		const read = await changes().read({ repository: primary, compare: "uncommitted", worktree: linked });
		if (read.outcome !== "read") throw new Error(read.outcome);
		const counts = Object.fromEntries(read.files.map(file => [`${file.area} ${file.path}`, [file.added, file.removed]]));
		expect(counts).toEqual({
			"unstaged keep.txt": [1, 1],
			"staged staged.txt": [1, 0],
			"unstaged staged.txt": [1, 0],
			"unstaged gone.txt": [0, 1],
			"staged removed.txt": [0, 1],
			"staged new name.txt": [0, 0],
			"unstaged b.bin": [null, null],
			"unstaged star*.txt": [1, 1],
			"unstaged star-other.txt": [1, 1],
			"unstaged lnk": [1, 1],
			"unstaged new folder/deeper/new file.txt": [2, 0],
			"unstaged zażółć.txt": [1, 0],
			"unstaged empty.txt": [0, 0],
			"unstaged new.bin": [null, null],
			"unstaged long.txt": [MAX_DIFF_LINES + 10, 0],
			"unstaged huge.txt": [1, 0],
		});
		// The counts agree with every diff the tab draws.
		for (const file of read.files) {
			const answer = await diff(linked, file.area, file.path, file.previousPath);
			if (answer.outcome !== "read" || answer.diff.kind !== "text") continue;
			const all = answer.diff.sections.flatMap(section => section.hunks.flatMap(hunk => hunk.lines));
			expect([file.path, file.added, file.removed]).toEqual([file.path, all.filter(line => line.kind === "added").length, all.filter(line => line.kind === "removed").length]);
		}
		const conflict = await changes().read({ repository: primary, compare: "uncommitted", worktree: conflicted });
		expect(conflict.outcome === "read" && conflict.files.map(file => [file.added, file.removed])).toEqual([[null, null]]);
		expect([fingerprint(linked), fingerprint(conflicted), fingerprint(primary)]).toEqual(before);
	});

	test("a file's version stays while nothing changes, and changes with an edit that keeps its counts", async () => {
		const versionOf = async (area: ChangeArea, path: string) => {
			const read = await changes().read({ repository: primary, compare: "uncommitted", worktree: linked });
			return read.outcome === "read" ? read.files.find(file => file.area === area && file.path === path) : undefined;
		};
		const first = await versionOf("unstaged", "keep.txt");
		const staged = await versionOf("staged", "staged.txt");
		expect(first?.version).not.toBe("");
		expect((await versionOf("unstaged", "keep.txt"))?.version).toBe(first!.version);
		const text = readFileSync(join(linked, "keep.txt"), "utf8");
		try {
			writeFileSync(join(linked, "keep.txt"), "one\nTOO\nthree\n");
			const edited = await versionOf("unstaged", "keep.txt");
			expect([edited?.added, edited?.removed]).toEqual([first!.added, first!.removed]);
			expect(edited?.version).not.toBe(first!.version);
			// Editing the file on disk leaves the staged diff, and its version, as they were.
			writeFileSync(join(linked, "staged.txt"), "base\nstaged\nedited once more\n");
			expect((await versionOf("staged", "staged.txt"))?.version).toBe(staged!.version);
		} finally {
			writeFileSync(join(linked, "keep.txt"), text);
			writeFileSync(join(linked, "staged.txt"), "base\nstaged\nthen edited\n");
		}
	});

	test("the unchanged lines between hunks fill in from the file on disk, with Windows line endings and no line break at the end", async () => {
		const folder = join(root, "spread");
		git(root, "init", "--initial-branch=main", folder);
		const old = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
		writeFileSync(join(folder, "crlf.txt"), old.join("\r\n"));
		git(folder, "add", "--all");
		git(folder, "commit", "-m", "Lines");
		const now = old.map((line, index) => (index === 4 || index === 22 ? `${line} changed` : line));
		writeFileSync(join(folder, "crlf.txt"), now.join("\r\n"));
		const repository: Repository = { ...listed([folder]), path: folder };
		const reader = createFileChanges({ findRepository: async path => (path === folder ? repository : null) });
		const files = createWorktreeFiles({ findRepository: async path => (path === folder ? repository : null) });
		const answer = await reader.diff({ repository: folder, compare: "uncommitted", worktree: folder, file: { area: "unstaged", path: "crlf.txt", previousPath: null } });
		const read = await files.read({ repository: folder, worktree: folder, path: "crlf.txt" });
		if (answer.outcome !== "read" || read.outcome !== "read" || read.content.kind !== "text") throw new Error("not read");
		const lines = fileLines(read.content.text);
		expect(linesMatchDiff(answer.diff, lines)).toBe(true);
		const filled = fillUnchanged(answer.diff, lines);
		const all = filled.kind === "text" ? filled.sections[0]!.hunks.flatMap(hunk => hunk.lines) : [];
		// Lines 1 and 9 to 19 were not in Git's hunks; each keeps its carriage return, and the last line has none.
		expect(all.find(line => line.newLine === 1)).toEqual({ kind: "context", text: "line 1\r", oldLine: 1, newLine: 1 });
		expect(all.find(line => line.newLine === 15)).toEqual({ kind: "context", text: "line 15\r", oldLine: 15, newLine: 15 });
		const gaps = shownSections(answer.diff, lines, () => false)[0]!.hunks.flatMap(hunk => (hunk.unchanged ? [hunk.unchanged.count] : []));
		expect(gaps).toEqual([1, 11]);
		// A file changed after the diff was read fills in nothing.
		expect(linesMatchDiff(answer.diff, lines.map((line, index) => (index === 5 ? "edited since" : line)))).toBe(false);
	});

	test("a staged diff matches git diff --cached, and an unstaged one matches git diff", async () => {
		for (const [area, path] of [["staged", "staged.txt"], ["unstaged", "staged.txt"], ["unstaged", "keep.txt"], ["unstaged", "gone.txt"], ["staged", "removed.txt"]] as const) {
			const expected = parseDiff(plainGit(linked, "diff", ...(area === "staged" ? ["--cached"] : []), "--", path).stdout);
			const answer = await diff(linked, area, path);
			expect(answer).toEqual({ outcome: "read", file: expect.objectContaining({ area, path }), diff: expected });
		}
		const staged = await diff(linked, "staged", "staged.txt");
		const unstaged = await diff(linked, "unstaged", "staged.txt");
		const added = (result: FileDiffResult) => result.outcome === "read" && result.diff.kind === "text" ? result.diff.sections.flatMap(section => section.hunks.flatMap(hunk => hunk.lines.filter(line => line.kind === "added").map(line => line.text))) : null;
		expect(added(staged)).toEqual(["staged"]);
		expect(added(unstaged)).toEqual(["then edited"]);
	});

	test("shows a staged rename as one file, from its old name", async () => {
		const answer = await diff(linked, "staged", "new name.txt", "old name.txt");
		expect(answer.outcome === "read" && answer.file).toEqual({ area: "staged", kind: "renamed", path: "new name.txt", previousPath: "old name.txt", added: 0, removed: 0, version: expect.any(String) });
		expect(answer.outcome === "read" && answer.diff).toEqual({ kind: "text", sections: [{ header: ["similarity index 100%", "rename from old name.txt", "rename to new name.txt"], hunks: [] }] });
	});

	test("shows a deletion as all removals, and a type change as two parts", async () => {
		const gone = await diff(linked, "unstaged", "gone.txt");
		expect(gone.outcome === "read" && gone.diff.kind === "text" && gone.diff.sections[0]!.hunks[0]!.lines).toEqual([{ kind: "removed", text: "x", oldLine: 1, newLine: null }]);
		const link = await diff(linked, "unstaged", "lnk");
		expect(link.outcome === "read" && link.diff.kind === "text" && link.diff.sections.map(section => section.header)).toEqual([["deleted file mode 120000"], ["new file mode 100644"]]);
	});

	test("shows an untracked file as all additions, also in a new folder and with an unusual name", async () => {
		const nested = await diff(linked, "unstaged", "new folder/deeper/new file.txt");
		expect(nested.outcome === "read" && nested.diff.kind === "text" && nested.diff.sections[0]!.hunks[0]!.lines).toEqual([
			{ kind: "added", text: "n1", oldLine: null, newLine: 1 },
			{ kind: "added", text: "n2", oldLine: null, newLine: 2 },
			{ kind: "note", text: "No newline at end of file", oldLine: null, newLine: null },
		]);
		const named = await diff(linked, "unstaged", "zażółć.txt");
		expect(named.outcome === "read" && named.diff.kind === "text" && named.diff.sections[0]!.hunks[0]!.lines.map(line => line.text)).toEqual(["gęś"]);
		const empty = await diff(linked, "unstaged", "empty.txt");
		expect(empty.outcome === "read" && empty.diff).toEqual({ kind: "text", sections: [{ header: ["new file mode 100644"], hunks: [] }] });
	});

	test("says binary for binary files, tracked or not", async () => {
		expect(await diff(linked, "unstaged", "b.bin")).toEqual({ outcome: "read", file: expect.objectContaining({ path: "b.bin" }), diff: { kind: "binary" } });
		expect(await diff(linked, "unstaged", "new.bin")).toEqual({ outcome: "read", file: expect.objectContaining({ path: "new.bin" }), diff: { kind: "binary" } });
	});

	test("says too large for many lines, and stops Git at the byte limit", async () => {
		expect(await diff(linked, "unstaged", "long.txt")).toEqual({ outcome: "read", file: expect.objectContaining({ path: "long.txt" }), diff: { kind: "too-large", lines: MAX_DIFF_LINES + 10 + 6 } });
		const started = Date.now();
		expect(await diff(linked, "unstaged", "huge.txt")).toEqual({ outcome: "read", file: expect.objectContaining({ path: "huge.txt" }), diff: { kind: "too-large", lines: null } });
		expect(Date.now() - started).toBeLessThan(5000);
	});

	test("takes a path literally: a star in a name is that one file", async () => {
		const answer = await diff(linked, "unstaged", "star*.txt");
		expect(answer.outcome === "read" && answer.diff.kind === "text" && answer.diff.sections.length).toBe(1);
		expect(answer.outcome === "read" && answer.diff.kind === "text" && answer.diff.sections[0]!.hunks[0]!.lines.map(line => line.text)).toEqual(["star", "star changed"]);
	});

	test("shows a conflicted file as Git's combined diff", async () => {
		const answer = await diff(conflicted, "conflicted", "conflict.txt");
		expect(answer.outcome).toBe("read");
		const texts = answer.outcome === "read" && answer.diff.kind === "text" ? answer.diff.sections[0]!.hunks[0]!.lines.map(line => `${line.kind} ${line.text}`) : [];
		expect(texts).toContain("added theirs");
		expect(texts.some(text => text.startsWith("added <<<<<<<"))).toBe(true);
	});

	test("says unchanged for a file that is not changed in that area", async () => {
		expect(await diff(linked, "unstaged", "clean.txt")).toEqual({ outcome: "read", file: null, diff: { kind: "unchanged" } });
		expect(await diff(linked, "staged", "keep.txt")).toEqual({ outcome: "read", file: null, diff: { kind: "unchanged" } });
	});

	test("refuses paths that leave the worktree, before running anything", async () => {
		for (const path of ["../sample/keep.txt", "/etc/hostname", "a/../../x"]) {
			const answer = await diff(linked, "unstaged", path);
			expect(answer.outcome).toBe("failed");
		}
		const renamed = await diff(linked, "staged", "new name.txt", "../outside");
		expect(renamed.outcome).toBe("failed");
	});

	test("reads nothing in a worktree or repository that is not listed", async () => {
		const elsewhere = await changes().read({ repository: primary, compare: "uncommitted", worktree: join(root, "elsewhere") });
		expect(elsewhere.outcome).toBe("not-listed");
		const unknown = await changes().read({ repository: join(root, "other"), compare: "uncommitted", worktree: linked });
		expect(unknown).toEqual({ outcome: "not-listed", message: `${join(root, "other")} is not a repository in this app's list. No changes were read.` });
		const relative = await changes().diff({ repository: primary, compare: "uncommitted", worktree: "sample", file: { area: "unstaged", path: "keep.txt", previousPath: null } });
		expect(relative.outcome).toBe("not-listed");
	});

	test("stops a Git that takes too long, and reports one that fails", async () => {
		const bin = join(root, "slow-git");
		mkdirSync(bin, { recursive: true });
		const slow = join(bin, "git");
		writeFileSync(slow, "#!/bin/sh\nsleep 5\n");
		chmodSync(slow, 0o755);
		const failing = join(bin, "failing-git");
		writeFileSync(failing, "#!/bin/sh\necho 'fatal: something broke' >&2\nexit 128\n");
		chmodSync(failing, 0o755);
		const findRepository = async () => listed([linked]);

		const started = Date.now();
		const stopped = await createFileChanges({ findRepository, git: slow, timeoutMilliseconds: 200 }).read({ repository: primary, compare: "uncommitted", worktree: linked });
		expect(stopped).toEqual({ outcome: "failed", message: `Git could not read the status of ${linked}: Git took longer than 0.2 seconds and was stopped.` });
		expect(Date.now() - started).toBeLessThan(3000);

		const failed = await createFileChanges({ findRepository, git: failing }).read({ repository: primary, compare: "uncommitted", worktree: linked });
		expect(failed).toEqual({ outcome: "failed", message: `Git could not read the status of ${linked}: fatal: something broke` });

		const missing = await createFileChanges({ findRepository, git: join(bin, "no-such-git") }).read({ repository: primary, compare: "uncommitted", worktree: linked });
		expect(missing.outcome).toBe("failed");
	});

	test("reads a repository with no commit yet", async () => {
		const fresh = join(root, "fresh");
		git(root, "init", "--initial-branch=main", fresh);
		writeFileSync(join(fresh, "first.txt"), "hello\n");
		git(fresh, "add", "first.txt");
		const reader = createFileChanges({
			findRepository: async () => ({ ...listed([fresh]), path: fresh }),
		});
		const read = await reader.read({ repository: fresh, compare: "uncommitted", worktree: fresh });
		expect(read).toEqual({ outcome: "read", files: [{ area: "staged", kind: "added", path: "first.txt", previousPath: null, added: 1, removed: 0, version: expect.any(String) }], more: false, compared: "uncommitted", base: { usable: false, reason: "Timber did not report a base for this worktree." } });
		const answer = await reader.diff({ repository: fresh, compare: "uncommitted", worktree: fresh, file: { area: "staged", path: "first.txt", previousPath: null } });
		expect(answer.outcome === "read" && answer.diff.kind === "text" && answer.diff.sections[0]!.hunks[0]!.lines.map(line => line.text)).toEqual(["hello"]);
	});
});
