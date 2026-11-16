import { describe, expect, test } from "bun:test";
import { isRelevantChange } from "../src/shared/git-watch";

describe("isRelevantChange", () => {
	test("counts the entries of the common Git directory that change the list or a branch", () => {
		for (const name of ["HEAD", "index", "packed-refs", "config", "FETCH_HEAD", "ORIG_HEAD", "worktrees", "refs", "reftable"]) {
			expect(isRelevantChange("common", name)).toBe(true);
		}
	});

	test("leaves out locks, logs, objects, and the scratch files of an operation in progress", () => {
		for (const name of ["index.lock", "HEAD.lock", "packed-refs.lock", "COMMIT_EDITMSG", "MERGE_MSG", "AUTO_MERGE", "REBASE_HEAD", "CHERRY_PICK_HEAD", "logs", "objects", "description", "logs/HEAD"]) {
			expect(isRelevantChange("common", name)).toBe(false);
		}
	});

	test("counts every ref, nested or not, but not its lock", () => {
		expect(isRelevantChange("refs", "heads/main")).toBe(true);
		expect(isRelevantChange("refs", "heads/feat/deep/name")).toBe(true);
		expect(isRelevantChange("refs", "remotes/origin/main")).toBe(true);
		expect(isRelevantChange("refs", "heads")).toBe(true);
		expect(isRelevantChange("refs", "heads/main.lock")).toBe(false);
		expect(isRelevantChange("reftable", "tables.list")).toBe(true);
		expect(isRelevantChange("reftable", "tables.list.lock")).toBe(false);
	});

	test("counts a linked worktree's folder and its HEAD, index, lock, and gitdir, and nothing else in it", () => {
		expect(isRelevantChange("worktrees", "feat-x")).toBe(true);
		for (const name of ["HEAD", "index", "locked", "gitdir"]) expect(isRelevantChange("worktrees", `feat-x/${name}`)).toBe(true);
		for (const name of ["index.lock", "ORIG_HEAD", "logs/HEAD", "COMMIT_EDITMSG", "rebase-merge/done", "commondir"]) {
			expect(isRelevantChange("worktrees", `feat-x/${name}`)).toBe(false);
		}
	});

	test("reads a backslash as a separator", () => {
		expect(isRelevantChange("worktrees", "feat-x\\HEAD")).toBe(true);
		expect(isRelevantChange("worktrees", "feat-x\\logs\\HEAD")).toBe(false);
	});

	test("counts an event without a name, since the platform did not say what changed", () => {
		expect(isRelevantChange("common", null)).toBe(true);
		expect(isRelevantChange("worktrees", undefined)).toBe(true);
		expect(isRelevantChange("refs", "")).toBe(true);
	});
});
