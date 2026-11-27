import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileChanges } from "../src/bun/file-changes";
import { treeMarks } from "../src/mainview/file-marks";
import type { Repository } from "../src/shared/model";
import { windows } from "./support/runtime";
import { fingerprint, git } from "./support/timber";

let root: string;
let primary: string;

const listed = (): Repository => ({
	path: primary, name: "sample", available: true, failure: null,
	setup: "repository",
	fallbackBase: null,
	worktrees: [{
		id: primary, path: primary, canonicalPath: primary, branch: "main", head: null, primary: true, detached: false, locked: false, prunable: false,
		pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null, baseCounts: null,
	}],
});

describe.skipIf(windows)("marks from a real repository's status", () => {
	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-marks-")));
		primary = join(root, "sample");
		git(root, "init", "--initial-branch=main", primary);
		const write = (name: string, text: string) => {
			mkdirSync(join(primary, name, ".."), { recursive: true });
			writeFileSync(join(primary, name), text);
		};
		write("src/app/main.ts", "one\n");
		write("src/app/staged.ts", "base\n");
		write("src/old-name.ts", "moved\n".repeat(20));
		write("docs/gone.md", "gone\n");
		write("docs/kept.md", "kept\n");
		write("conflict.txt", "base\n");
		write("clean.txt", "never changed\n");
		git(primary, "add", "--all");
		git(primary, "commit", "-m", "Files");
		// A merge conflict in conflict.txt, which is also edited after.
		git(primary, "checkout", "-b", "other");
		write("conflict.txt", "theirs\n");
		git(primary, "commit", "-am", "Theirs");
		git(primary, "checkout", "main");
		write("conflict.txt", "ours\n");
		git(primary, "commit", "-am", "Ours");
		const merge = Bun.spawnSync(["git", "-C", primary, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "merge", "other"], { stdout: "pipe", stderr: "pipe" });
		expect(merge.exitCode).not.toBe(0);

		write("src/app/main.ts", "one\ntwo\n");
		write("src/app/staged.ts", "base\nstaged\n");
		git(primary, "add", "src/app/staged.ts");
		write("src/app/staged.ts", "base\nstaged\nthen edited\n");
		write("src/app/added.ts", "new\n");
		git(primary, "add", "src/app/added.ts");
		git(primary, "mv", "src/old-name.ts", "src/new-name.ts");
		unlinkSync(join(primary, "docs/gone.md"));
		write("fresh/deep/file.ts", "untracked\n");

		// Stale index times, which is when a plain `git status` would rewrite the index.
		const later = new Date(Date.now() + 5000);
		for (const name of ["clean.txt", "docs/kept.md"]) utimesSync(join(primary, name), later, later);
	});

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	test("each kind gets its letter, every folder above a change counts it, and deletions are left out", async () => {
		const answer = await createFileChanges({ findRepository: async path => path === primary ? listed() : null }).read({ repository: primary, worktree: primary, compare: "uncommitted" });
		expect(answer.outcome).toBe("read");
		if (answer.outcome !== "read") return;
		const marks = treeMarks(answer.files, answer.more);
		expect(marks.files).toEqual({
			"conflict.txt": "conflicted",
			"src/app/main.ts": "modified",
			"src/app/staged.ts": "modified",
			"src/app/added.ts": "added",
			"src/new-name.ts": "renamed",
			"fresh/deep/file.ts": "untracked",
		});
		expect(marks.folders).toEqual({ src: 4, "src/app": 3, fresh: 1, "fresh/deep": 1 });
		expect(marks.more).toBe(false);
		// Every marked file is on disk, so it has a row; the deleted one has neither.
		for (const path of Object.keys(marks.files)) expect(existsSync(join(primary, path))).toBe(true);
		expect(existsSync(join(primary, "docs/gone.md"))).toBe(false);
		expect(marks.folders.docs).toBeUndefined();
	});

	test("reading the status for marks leaves files, refs, the index, and the status intact", async () => {
		const before = fingerprint(primary);
		const reader = createFileChanges({ findRepository: async path => path === primary ? listed() : null });
		for (let round = 0; round < 3; round++) await reader.read({ repository: primary, worktree: primary, compare: "uncommitted" });
		expect(fingerprint(primary)).toBe(before);
	});
});
