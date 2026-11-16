import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { commonDirectory, overrideRepositoryPaths, readBranchSync } from "../src/bun/git-engine";
import { git } from "./support/timber";

let root: string;
let primary: string;
let linked: string;

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "timber-app-"));
	primary = join(root, "sample");
	linked = join(root, "sample-worktrees", "feat-x");
	git(root, "init", "--initial-branch=main", primary);
	writeFileSync(join(primary, "tracked.txt"), "one\n");
	git(primary, "add", "tracked.txt");
	git(primary, "commit", "-m", "Initial commit");
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
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("readBranchSync", () => {
	test("reads every branch against its upstream from a real repository", async () => {
		const branches = await readBranchSync(join(primary, ".git"));
		expect(Object.fromEntries(branches!)).toEqual({
			"main": { kind: "tracking", upstream: "origin/main", ahead: 0, behind: 0 },
			"ahead": { kind: "tracking", upstream: "origin/ahead", ahead: 1, behind: 0 },
			"behind": { kind: "tracking", upstream: "origin/behind", ahead: 0, behind: 2 },
			"both": { kind: "tracking", upstream: "origin/both", ahead: 1, behind: 1 },
			"deleted": { kind: "gone", upstream: "origin/deleted" },
			"zażółć": { kind: "tracking", upstream: "origin/zażółć", ahead: 0, behind: 0 },
			"feat/x": { kind: "unpublished" },
		});
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
		expect(fingerprint()).toBe(before);
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
