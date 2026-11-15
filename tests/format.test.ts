import { describe, expect, test } from "bun:test";
import { describeChanges, describeSync, worktreeLabel } from "../src/mainview/format";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import type { Worktree } from "../src/shared/model";

const base: Worktree = {
	path: "/work/app",
	branch: "main",
	head: "1234567890abcdef1234567890abcdef12345678",
	primary: true,
	locked: false,
	prunable: false,
	status: { modified: 0, untracked: 0, sync: { kind: "unpublished" } },
};

describe("describeSync", () => {
	test("covers every state a branch can be in", () => {
		expect(describeSync({ kind: "unpublished" })).toBe("Not published yet");
		expect(describeSync({ kind: "gone", upstream: "origin/x" })).toBe("Upstream origin/x was deleted");
		expect(describeSync({ kind: "tracking", upstream: "origin/x", ahead: 0, behind: 0 })).toBe("In sync with origin/x");
		expect(describeSync({ kind: "tracking", upstream: "origin/x", ahead: 2, behind: 0 })).toBe("2 to push to origin/x");
		expect(describeSync({ kind: "tracking", upstream: "origin/x", ahead: 0, behind: 3 })).toBe("3 to pull from origin/x");
		expect(describeSync({ kind: "tracking", upstream: "origin/x", ahead: 2, behind: 3 })).toBe("2 ahead, 3 behind origin/x");
	});
});

describe("worktree text", () => {
	test("labels a branch by name and a detached HEAD by short commit", () => {
		expect(worktreeLabel(base)).toBe("main");
		expect(worktreeLabel({ ...base, branch: null })).toBe("detached at 1234567");
		expect(worktreeLabel({ ...base, branch: null, head: null })).toBe("detached");
	});

	test("describes changes, and stays silent when Git could not read the folder", () => {
		expect(describeChanges(base)).toBe("Clean");
		expect(describeChanges({ ...base, status: { modified: 3, untracked: 1, sync: { kind: "unpublished" } } })).toBe("3 modified, 1 untracked");
		expect(describeChanges({ ...base, status: null })).toBeNull();
	});
});

describe("mock engine", () => {
	test("returns a copy, so the interface cannot change the sample data", async () => {
		const first = await createMockEngine().listRepositories();
		first[0]!.worktrees.length = 0;
		expect((await createMockEngine().listRepositories())[0]!.worktrees.length).toBe(sampleRepositories[0]!.worktrees.length);
	});
});
