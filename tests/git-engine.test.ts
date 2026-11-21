import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { commonDirectory, overrideRepositoryPaths, readBranchSync, readBranches } from "../src/bun/git-engine";
import { git, makeRepository } from "./support/timber";

let root: string;
let primary: string;
let linked: string;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "timber-app-"));
	primary = join(root, "sample");
	linked = join(root, "sample-worktrees", "feat-x");
	makeRepository(root, "sample");
	git(primary, "worktree", "add", "-b", "feat/x", linked);

	// A remote with one branch in each state the sidebar shows.
	const remote = join(root, "remote.git");
	git(root, "init", "--bare", remote);
	git(primary, "remote", "add", "origin", remote);
	git(primary, "push", "--set-upstream", "origin", "main");
	for (const branch of ["ahead", "behind", "both", "deleted", "zażółć"]) {
		git(primary, "branch", branch, "main");
		git(primary, "push", "--set-upstream", "origin", branch);
	}
	git(primary, "commit", "--allow-empty", "-m", "Second commit");
	git(primary, "branch", "--force", "ahead", "main");
	git(primary, "branch", "--force", "both", "main");
	git(primary, "commit", "--allow-empty", "-m", "Third commit");
	git(primary, "push", "origin", "main:behind");
	// A commit on the side, so that "both" and its upstream each have one the other lacks.
	git(linked, "commit", "--allow-empty", "-m", "Side commit");
	git(primary, "push", "--force", "origin", "feat/x:both");
	git(primary, "push", "origin", "--delete", "deleted");
	git(primary, "push", "origin", "main");
	// A second remote and the pointer origin/HEAD, for the list of branches to pick from.
	const fork = join(root, "fork.git");
	git(root, "init", "--bare", fork);
	git(primary, "remote", "add", "fork", fork);
	git(primary, "push", "fork", "main:main", "main:only-on-fork");
	git(primary, "remote", "set-head", "origin", "main");
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("readBranchSync", () => {
	test("reads every branch against its upstream from a real repository", async () => {
		const branches = await readBranchSync(join(primary, ".git"));
		expect(Object.fromEntries(branches!)).toEqual({
			"main": { kind: "tracking", upstream: "origin/main", ahead: 0, behind: 0, remote: "origin", upstreamRef: "refs/remotes/origin/main" },
			"ahead": { kind: "tracking", upstream: "origin/ahead", ahead: 1, behind: 0, remote: "origin", upstreamRef: "refs/remotes/origin/ahead" },
			"behind": { kind: "tracking", upstream: "origin/behind", ahead: 0, behind: 2, remote: "origin", upstreamRef: "refs/remotes/origin/behind" },
			"both": { kind: "tracking", upstream: "origin/both", ahead: 1, behind: 1, remote: "origin", upstreamRef: "refs/remotes/origin/both" },
			"deleted": { kind: "gone", upstream: "origin/deleted" },
			"zażółć": { kind: "tracking", upstream: "origin/zażółć", ahead: 0, behind: 0, remote: "origin", upstreamRef: "refs/remotes/origin/zażółć" },
			"feat/x": { kind: "unpublished" },
		});
	});

	test("counts the same commits as git rev-list for every tracking branch", async () => {
		const branches = await readBranchSync(join(primary, ".git"));
		const tracking = [...branches!].filter(([, sync]) => sync.kind === "tracking");
		expect(tracking.map(([branch]) => branch).sort()).toEqual(["ahead", "behind", "both", "main", "zażółć"]);
		for (const [branch, sync] of tracking) {
			// Left of the three dots is the branch, right is its upstream: commits only here, then commits only there.
			const [ahead, behind] = git(primary, "rev-list", "--left-right", "--count", `${branch}...${branch}@{upstream}`).trim().split("\t").map(Number);
			expect(sync).toMatchObject({ ahead: ahead!, behind: behind! });
		}
	});

	test("answers null where there is no repository", async () => {
		expect(await readBranchSync(join(root, "does-not-exist", ".git"))).toBeNull();
	});

	test("leaves refs, the index, and files untouched", async () => {
		const run = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", "-C", cwd, ...args]).stdout.toString();
		const fingerprint = () => [
			run(primary, "for-each-ref"),
			run(primary, "worktree", "list", "--porcelain"),
			run(primary, "status", "--porcelain"),
			run(linked, "status", "--porcelain"),
			run(linked, "ls-files", "--stage"),
		].join("\n");
		const before = fingerprint();
		await readBranchSync(join(primary, ".git"));
		await commonDirectory(linked);
		expect(await readBranches(primary)).not.toBeNull();
		expect(await readBranches(linked)).not.toBeNull();
		expect(fingerprint()).toBe(before);
	});
});

describe("readBranches", () => {
	test("lists local branches, then remote-tracking branches of every remote, from a real repository", async () => {
		expect(await readBranches(primary)).toEqual([
			...["ahead", "behind", "both", "deleted", "feat/x", "main", "zażółć"].map(selector => ({ selector, kind: "local" as const })),
			...["fork/main", "fork/only-on-fork", "origin/ahead", "origin/behind", "origin/both", "origin/main", "origin/zażółć"].map(selector => ({ selector, kind: "remote" as const })),
		]);
	});

	test("origin/HEAD is there in Git and is left out of the list", async () => {
		expect(git(primary, "symbolic-ref", "refs/remotes/origin/HEAD").trim()).toBe("refs/remotes/origin/main");
		expect((await readBranches(primary))!.some(branch => branch.selector === "origin/HEAD")).toBe(false);
	});

	test("answers the same from a linked worktree", async () => {
		expect(await readBranches(linked)).toEqual(await readBranches(primary));
	});

	test("answers null where there is no repository", async () => {
		expect(await readBranches(root)).toBeNull();
		expect(await readBranches(join(root, "does-not-exist"))).toBeNull();
	});
});

describe("commonDirectory", () => {
	test("is the same for the primary checkout, a linked worktree, and a folder inside either", async () => {
		const expected = realpathSync(join(primary, ".git"));
		expect(await commonDirectory(primary)).toBe(expected);
		expect(await commonDirectory(linked)).toBe(expected);
		expect(await commonDirectory(join(primary, ".git"))).toBe(expected);
	});

	test("answers null for a folder that is not a repository", async () => {
		expect(await commonDirectory(root)).toBeNull();
		expect(await commonDirectory(join(root, "does-not-exist"))).toBeNull();
	});
});

describe("overrideRepositoryPaths", () => {
	test("reads TIMBER_APP_REPOS, and is null when it names nothing", () => {
		expect(overrideRepositoryPaths({ TIMBER_APP_REPOS: ["/a", " /b ", ""].join(delimiter) })).toEqual(["/a", "/b"]);
		expect(overrideRepositoryPaths({})).toBeNull();
		expect(overrideRepositoryPaths({ TIMBER_APP_REPOS: ` ${delimiter} ` })).toBeNull();
	});
});
