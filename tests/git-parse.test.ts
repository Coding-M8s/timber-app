import { describe, expect, test } from "bun:test";
import { parseStatus, parseWorktreeList } from "../src/shared/git-parse";

const records = (...lines: string[]) => lines.join("\0") + "\0";

describe("parseWorktreeList", () => {
	test("reads the primary worktree first, then linked, detached, locked, and prunable ones", () => {
		const output = records(
			"worktree /work/timber", "HEAD 1111111111111111111111111111111111111111", "branch refs/heads/main", "",
			"worktree /work/timber-worktrees/feat-x", "HEAD 2222222222222222222222222222222222222222", "branch refs/heads/feat/x", "",
			"worktree /work/timber-worktrees/detached", "HEAD 3333333333333333333333333333333333333333", "detached", "",
			"worktree /work/timber-worktrees/kept", "HEAD 4444444444444444444444444444444444444444", "branch refs/heads/kept", "locked on purpose", "",
			"worktree /work/timber-worktrees/gone", "HEAD 5555555555555555555555555555555555555555", "branch refs/heads/gone", "prunable gitdir file points to non-existent location", "",
		);

		expect(parseWorktreeList(output)).toEqual([
			{ path: "/work/timber", head: "1111111111111111111111111111111111111111", branch: "main", bare: false, locked: false, prunable: false },
			{ path: "/work/timber-worktrees/feat-x", head: "2222222222222222222222222222222222222222", branch: "feat/x", bare: false, locked: false, prunable: false },
			{ path: "/work/timber-worktrees/detached", head: "3333333333333333333333333333333333333333", branch: null, bare: false, locked: false, prunable: false },
			{ path: "/work/timber-worktrees/kept", head: "4444444444444444444444444444444444444444", branch: "kept", bare: false, locked: true, prunable: false },
			{ path: "/work/timber-worktrees/gone", head: "5555555555555555555555555555555555555555", branch: "gone", bare: false, locked: false, prunable: true },
		]);
	});

	test("keeps paths that contain spaces and marks a bare repository", () => {
		const output = records("worktree /work/my repo.git", "bare", "", "worktree /work/my repo/tree one", "HEAD 1111111111111111111111111111111111111111", "branch refs/heads/main", "");
		const entries = parseWorktreeList(output);
		expect(entries.map(entry => entry.path)).toEqual(["/work/my repo.git", "/work/my repo/tree one"]);
		expect(entries[0]?.bare).toBe(true);
	});

	test("returns nothing for empty output", () => {
		expect(parseWorktreeList("")).toEqual([]);
	});
});

describe("parseStatus", () => {
	test("counts ahead, behind, modified, and untracked against a live upstream", () => {
		const output = records(
			"# branch.oid 1111111111111111111111111111111111111111",
			"# branch.head feat/x",
			"# branch.upstream origin/feat/x",
			"# branch.ab +2 -1",
			"1 .M N... 100644 100644 100644 aaaa bbbb src/cli.ts",
			"1 M. N... 100644 100644 100644 aaaa bbbb docs/guide.md",
			"? src/new file.ts",
		);
		expect(parseStatus(output)).toEqual({
			modified: 2,
			untracked: 1,
			sync: { kind: "tracking", upstream: "origin/feat/x", ahead: 2, behind: 1 },
		});
	});

	test("reports a branch without an upstream as unpublished", () => {
		const output = records("# branch.oid 1111111111111111111111111111111111111111", "# branch.head spike");
		expect(parseStatus(output)).toEqual({ modified: 0, untracked: 0, sync: { kind: "unpublished" } });
	});

	test("reports a configured upstream whose ref is missing as gone", () => {
		const output = records("# branch.oid 1111111111111111111111111111111111111111", "# branch.head done", "# branch.upstream origin/done");
		expect(parseStatus(output).sync).toEqual({ kind: "gone", upstream: "origin/done" });
	});

	test("counts a rename once and does not read its old path as another entry", () => {
		const output = records(
			"# branch.oid 1111111111111111111111111111111111111111",
			"# branch.head main",
			"2 R. N... 100644 100644 100644 aaaa bbbb R100 src/new-name.ts",
			"? looks-untracked-but-is-the-old-name.ts",
			"u UU N... 100644 100644 100644 100644 aaaa bbbb cccc src/conflict.ts",
		);
		const status = parseStatus(output);
		expect(status.modified).toBe(2);
		expect(status.untracked).toBe(0);
	});
});
