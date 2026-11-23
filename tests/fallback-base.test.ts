import { describe, expect, test } from "bun:test";
import { sampleRepositories } from "../src/mainview/engine/mock";
import {
	NOTHING_CONFIGURED, fallbackBaseOf, mayFallBackToUpstream, parseRemoteHeads, parseRemoteNames, pullsInsteadOfRebase,
} from "../src/shared/fallback-base";
import type { Worktree } from "../src/shared/model";

const ORIGIN_MAIN = "refs/remotes/origin/main";
const timber = sampleRepositories[0]!;
const samplePrimary = timber.worktrees.find(worktree => worktree.primary)!;

/** The primary checkout on main, tracking origin/main, with nothing saved: the case the issue is about. */
const primary: Worktree = {
	...samplePrimary,
	branch: "main",
	base: { kind: "unassigned" },
	sync: { kind: "tracking", upstream: "origin/main", ahead: 0, behind: 0, remote: "origin", upstreamRef: ORIGIN_MAIN },
};
const linked: Worktree = { ...primary, id: "linked", path: "/work/timber-worktrees/main-copy", primary: false };
const withFallback = { fallbackBase: ORIGIN_MAIN };

describe("reading the remotes' cached default branches", () => {
	test("each remote's HEAD names its default branch; other refs and odd HEADs are left out", () => {
		const output = [
			"refs/remotes/origin/HEAD\0refs/remotes/origin/main",
			"refs/remotes/origin/main\0",
			"refs/remotes/upstream/HEAD\0refs/remotes/upstream/trunk",
			// A HEAD pointing into another remote, or at itself, is not this remote's default.
			"refs/remotes/fork/HEAD\0refs/remotes/origin/main",
			"refs/remotes/self/HEAD\0refs/remotes/self/HEAD",
			"refs/remotes/nested/remote/HEAD\0refs/remotes/nested/remote/dev",
			"garbage",
			"",
		].join("\n");
		expect([...parseRemoteHeads(output)]).toEqual([
			["origin", ORIGIN_MAIN],
			["upstream", "refs/remotes/upstream/trunk"],
			["nested/remote", "refs/remotes/nested/remote/dev"],
		]);
	});

	test("git remote prints one name a line", () => {
		expect(parseRemoteNames("origin\nupstream\n\n")).toEqual(["origin", "upstream"]);
		expect(parseRemoteNames("")).toEqual([]);
	});
});

describe("the fallback base", () => {
	const heads = new Map([["origin", ORIGIN_MAIN], ["upstream", "refs/remotes/upstream/trunk"]]);

	test("with nothing configured and one remote, it is that remote's cached default", () => {
		expect(fallbackBaseOf(["origin"], heads, NOTHING_CONFIGURED)).toBe(ORIGIN_MAIN);
	});

	test("a remote with no cached default, or no remote, gives none", () => {
		expect(fallbackBaseOf(["origin"], new Map(), NOTHING_CONFIGURED)).toBeNull();
		expect(fallbackBaseOf([], heads, NOTHING_CONFIGURED)).toBeNull();
	});

	test("with two remotes, Timber needs a configured remote, and uses it", () => {
		expect(fallbackBaseOf(["origin", "upstream"], heads, NOTHING_CONFIGURED)).toBeNull();
		expect(fallbackBaseOf(["origin", "upstream"], heads, { baseBranch: null, remote: "upstream" })).toBe("refs/remotes/upstream/trunk");
		expect(fallbackBaseOf(["origin", "upstream"], heads, { baseBranch: null, remote: "origin" })).toBe(ORIGIN_MAIN);
	});

	test("a configured remote that does not exist gives none, as Timber refuses it", () => {
		expect(fallbackBaseOf(["origin"], heads, { baseBranch: null, remote: "missing" })).toBeNull();
	});

	test("a configured base_branch names the branch on the chosen remote, as Timber reads it", () => {
		const one = ["origin"];
		expect(fallbackBaseOf(one, heads, { baseBranch: "main", remote: null })).toBe(ORIGIN_MAIN);
		expect(fallbackBaseOf(one, heads, { baseBranch: "develop", remote: null })).toBe("refs/remotes/origin/develop");
		// It needs no cached default.
		expect(fallbackBaseOf(one, new Map(), { baseBranch: "main", remote: null })).toBe(ORIGIN_MAIN);
		// A name that starts with a remote is on that remote, the longest name first.
		const two = ["origin", "upstream", "upstream/mirror"];
		expect(fallbackBaseOf(two, heads, { baseBranch: "upstream/trunk", remote: null })).toBe("refs/remotes/upstream/trunk");
		expect(fallbackBaseOf(two, heads, { baseBranch: "upstream/mirror/main", remote: "origin" })).toBe("refs/remotes/upstream/mirror/main");
		expect(fallbackBaseOf(two, heads, { baseBranch: "refs/remotes/origin/main", remote: "upstream" })).toBe(ORIGIN_MAIN);
		expect(fallbackBaseOf(two, heads, { baseBranch: "release/2.4", remote: "upstream" })).toBe("refs/remotes/upstream/release/2.4");
		// Two remotes and a plain name: Timber needs a configured remote.
		expect(fallbackBaseOf(two, heads, { baseBranch: "main", remote: null })).toBeNull();
	});

	test("a base_branch that is no plain branch name, or names no remote it can be on, gives none", () => {
		for (const baseBranch of ["refs/remotes/gone/main", "refs/heads/main", "HEAD", "origin/HEAD", "origin/", "main branch"]) {
			expect(fallbackBaseOf(["origin"], heads, { baseBranch, remote: null })).toBeNull();
		}
	});

	test("unknown settings give none", () => {
		expect(fallbackBaseOf(["origin"], heads, null)).toBeNull();
	});
});

describe("Pull in place of Rebase", () => {
	test("the primary checkout on the default branch, with no saved base, gets Pull", () => {
		expect(mayFallBackToUpstream(primary)).toBe(true);
		expect(pullsInsteadOfRebase(withFallback, primary)).toBe(true);
	});

	test("also when it is ahead, has diverged, or its upstream was rewritten: Pull never rewrites, and Git refuses what cannot fast-forward", () => {
		const tracking = primary.sync as Extract<Worktree["sync"], { kind: "tracking" }>;
		for (const sync of [{ ...tracking, ahead: 2 }, { ...tracking, ahead: 1, behind: 3 }, { ...tracking, behind: 1, forcePushed: { at: 1 } }]) {
			expect(pullsInsteadOfRebase(withFallback, { ...primary, sync })).toBe(true);
		}
	});

	test("a saved base equal to its upstream gets Pull, on any branch name", () => {
		const develop: Worktree = {
			...primary,
			branch: "develop",
			base: { kind: "assigned", ref: "refs/remotes/origin/release" },
			sync: { kind: "tracking", upstream: "origin/release", ahead: 0, behind: 0, remote: "origin", upstreamRef: "refs/remotes/origin/release" },
		};
		expect(pullsInsteadOfRebase({ fallbackBase: null }, develop)).toBe(true);
		expect(pullsInsteadOfRebase({ fallbackBase: null }, { ...primary, base: { kind: "assigned", ref: ORIGIN_MAIN } })).toBe(true);
	});

	test("the primary checkout on a feature branch with another base keeps Rebase", () => {
		const feature: Worktree = {
			...primary,
			branch: "feat/login",
			base: { kind: "assigned", ref: ORIGIN_MAIN },
			sync: { kind: "tracking", upstream: "origin/feat/login", ahead: 1, behind: 0, remote: "origin", upstreamRef: "refs/remotes/origin/feat/login" },
		};
		expect(pullsInsteadOfRebase(withFallback, feature)).toBe(false);
		// Nothing saved on a feature branch: worth reading the fallback, which is main, not its upstream.
		expect(mayFallBackToUpstream({ ...feature, base: { kind: "unassigned" } })).toBe(true);
		expect(pullsInsteadOfRebase(withFallback, { ...feature, base: { kind: "unassigned" } })).toBe(false);
	});

	test("linked worktrees keep Rebase, even with their upstream as base", () => {
		expect(pullsInsteadOfRebase(withFallback, linked)).toBe(false);
		expect(pullsInsteadOfRebase(withFallback, { ...linked, base: { kind: "assigned", ref: ORIGIN_MAIN } })).toBe(false);
		expect(mayFallBackToUpstream(linked)).toBe(false);
	});

	test("with no fallback base known, or another one, the primary checkout keeps Rebase", () => {
		expect(pullsInsteadOfRebase({ fallbackBase: null }, primary)).toBe(false);
		expect(pullsInsteadOfRebase({ fallbackBase: "refs/remotes/origin/develop" }, primary)).toBe(false);
	});

	test("a base Timber does not report, a commit, or one it cannot read keeps Rebase", () => {
		expect(pullsInsteadOfRebase(withFallback, { ...primary, base: null })).toBe(false);
		expect(pullsInsteadOfRebase(withFallback, { ...primary, base: { kind: "commit", commit: "a".repeat(40) } })).toBe(false);
		expect(pullsInsteadOfRebase(withFallback, { ...primary, base: { kind: "invalid", reason: "stale" } })).toBe(false);
	});

	test("with no upstream on a remote, or a detached HEAD, it keeps Rebase", () => {
		expect(pullsInsteadOfRebase(withFallback, { ...primary, sync: { kind: "unpublished" } })).toBe(false);
		expect(pullsInsteadOfRebase(withFallback, { ...primary, sync: { kind: "gone", upstream: "origin/main" } })).toBe(false);
		expect(pullsInsteadOfRebase(withFallback, { ...primary, sync: { kind: "tracking", upstream: "main", ahead: 0, behind: 0 } })).toBe(false);
		expect(pullsInsteadOfRebase(withFallback, { ...primary, branch: null, detached: true, sync: null })).toBe(false);
	});

	test("a branch tracking a remote branch of another name keeps Rebase with nothing saved", () => {
		const renamed: Worktree = { ...primary, branch: "local-main" };
		expect(mayFallBackToUpstream(renamed)).toBe(false);
		expect(pullsInsteadOfRebase(withFallback, renamed)).toBe(false);
	});
});
