import { describe, expect, test } from "bun:test";
import { describeInvalidBase, describeRebaseBase, describeRowTitle, describeSavedBase } from "../src/mainview/base-format";
import { actOutNew } from "../src/mainview/engine/mock-commands";
import { browserSampleRepositories, sampleRepositories, sampleStatesRepository } from "../src/mainview/engine/mock";
import { MOCK_BRANCH_POINT, derivedFileChanges, mockBase } from "../src/mainview/engine/mock-file-changes";
import type { SavedBase } from "../src/shared/model";
import { initialOnto, rebaseBases, savedBaseSelector } from "../src/shared/rebase-command";

const remote: SavedBase = { kind: "assigned", ref: "refs/remotes/origin/main" };
const local: SavedBase = { kind: "assigned", ref: "refs/heads/main" };
const none: SavedBase = { kind: "unassigned" };
const stale: SavedBase = { kind: "invalid", reason: "stale" };
const commit: SavedBase = { kind: "commit", commit: "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432" };

describe("savedBaseSelector", () => {
	test("a remote-tracking ref is worded as remote and branch, which Timber takes for --base", () => {
		expect(savedBaseSelector("refs/remotes/origin/main")).toBe("origin/main");
		expect(savedBaseSelector("refs/remotes/fork/feat/x y")).toBe("fork/feat/x y");
	});

	test("a local branch keeps its full ref, because Timber reads a plain name as a branch on a remote", () => {
		expect(savedBaseSelector("refs/heads/main")).toBe("refs/heads/main");
	});

	test("any other ref is left as it is", () => {
		expect(savedBaseSelector("refs/tags/v1")).toBe("refs/tags/v1");
		expect(savedBaseSelector("refs/remotes/")).toBe("refs/remotes/");
	});

	test("it is the form the Onto picker offers for the same branch", () => {
		const offered = rebaseBases([{ selector: "main", kind: "local" }, { selector: "origin/main", kind: "remote" }]).map(branch => branch.selector);
		expect(offered).toEqual([savedBaseSelector(local.ref), savedBaseSelector(remote.ref)]);
	});
});

describe("describeSavedBase", () => {
	test("a saved base is named", () => {
		expect(describeSavedBase(remote)).toEqual({ text: "Base origin/main", sentence: "Timber rebases this worktree onto origin/main, the base saved for it.", warning: false });
		expect(describeSavedBase(local)?.text).toBe("Base refs/heads/main");
	});

	test("a commit base is named by the first seven characters of its hash", () => {
		expect(describeSavedBase(commit)).toEqual({ text: "Base 9f8e7d6", sentence: "Timber rebases this worktree onto commit 9f8e7d6, the base saved for it.", warning: false });
	});

	test("no saved base is said in those words", () => {
		expect(describeSavedBase(none)).toEqual({ text: "No saved base", sentence: "Timber has no base saved for this worktree.", warning: false });
	});

	test("invalid metadata is a warning with its reason, and never reads as no base or as a base", () => {
		for (const reason of ["malformed", "stale", "unreadable"] as const) {
			const described = describeSavedBase({ kind: "invalid", reason })!;
			expect(described.warning).toBe(true);
			expect(described.text).toBe("Base unknown");
			expect(described.sentence).toBe(describeInvalidBase(reason));
			expect(described.sentence).toContain("does not guess");
			expect(described.sentence).not.toContain("origin");
		}
		expect(new Set((["malformed", "stale", "unreadable"] as const).map(describeInvalidBase)).size).toBe(3);
	});

	test("a Timber that does not report bases gets nothing shown", () => {
		expect(describeSavedBase(null)).toBeNull();
	});
});

describe("describeRowTitle", () => {
	test("the row's tooltip is its path, then the base when Timber reported one", () => {
		expect(describeRowTitle({ path: "/work/app-worktrees/feat-x", base: remote })).toBe("/work/app-worktrees/feat-x (Base origin/main)");
		expect(describeRowTitle({ path: "/work/app", base: none })).toBe("/work/app (No saved base)");
		expect(describeRowTitle({ path: "/work/app-worktrees/odd", base: stale })).toBe("/work/app-worktrees/odd (Base unknown)");
		expect(describeRowTitle({ path: "/work/app", base: null })).toBe("/work/app");
		expect(describeRowTitle({ path: "/work/app-worktrees/hotfix", base: commit })).toBe("/work/app-worktrees/hotfix (Base 9f8e7d6)");
	});
});

describe("the Rebase dialog's start", () => {
	test("Onto starts as the saved base, in the form Timber takes", () => {
		expect(initialOnto(remote)).toBe("origin/main");
		expect(initialOnto(local)).toBe("refs/heads/main");
	});

	test("Onto starts as a commit base's full hash, because Timber refuses an abbreviated one", () => {
		expect(initialOnto(commit)).toBe("9f8e7d6c5b4a39281706f5e4d3c2b1a098765432");
		expect(describeRebaseBase(commit)).toEqual({ text: "Timber saved commit 9f8e7d6 as the base of this worktree, so Onto starts from its full hash.", warning: false });
	});

	test("Onto starts empty without a saved base, with invalid metadata, and on a Timber that reports none", () => {
		expect(initialOnto(none)).toBe("");
		expect(initialOnto(stale)).toBe("");
		expect(initialOnto(null)).toBe("");
	});

	test("the dialog says which of them it is, and nothing on a Timber that reports none", () => {
		expect(describeRebaseBase(remote)).toEqual({ text: "Timber saved origin/main as the base of this worktree, so Onto starts from it.", warning: false });
		expect(describeRebaseBase(none)?.text).toContain("No saved base");
		expect(describeRebaseBase(none)?.warning).toBe(false);
		expect(describeRebaseBase(stale)).toMatchObject({ warning: true });
		expect(describeRebaseBase(stale)?.text).toContain(describeInvalidBase("stale"));
		expect(describeRebaseBase(null)).toBeNull();
	});
});

describe("the pretend Timber", () => {
	test("saves a full commit hash given as the base as a commit base, in lowercase, and a branch as a ref", () => {
		const repository = sampleRepositories[0]!;
		const created = (base: string | null) => actOutNew(repository, { repository: repository.path, name: "feat/from-commit", base }, "succeeds").created?.base;
		expect(created("9F8E7D6C5B4A39281706F5E4D3C2B1A098765432")).toEqual({ kind: "commit", commit: "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432" });
		expect(created("origin/develop")).toEqual({ kind: "assigned", ref: "refs/remotes/origin/develop" });
	});

	test("compares a worktree based on a commit with that commit, as the main process would", () => {
		const hotfix = sampleStatesRepository.worktrees.find(worktree => worktree.base?.kind === "commit")!;
		expect(mockBase(hotfix)).toEqual({ usable: true, ref: "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432", name: "9f8e7d6", commit: MOCK_BRANCH_POINT });
		expect(derivedFileChanges(hotfix).map(({ change }) => `${change.area} ${change.path}`)).toContain("base README.md");
	});
});

describe("sample data", () => {
	test("the browser build has every kind of saved base, and a worktree without the field", () => {
		const bases = browserSampleRepositories.flatMap(repository => repository.worktrees).map(worktree => worktree.base);
		expect(new Set(bases.map(base => base?.kind ?? "not reported"))).toEqual(new Set(["assigned", "commit", "unassigned", "invalid", "not reported"]));
		expect(bases).toContainEqual(local);
	});
});
