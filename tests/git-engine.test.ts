import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { configuredRepositoryPaths, listRepositories, loadRepository } from "../src/bun/git-engine";

/** Run Git in a real temporary repository, with a fixed identity and no user configuration. */
function git(cwd: string, ...args: string[]): void {
	const result = Bun.spawnSync(["git", "-C", cwd, "-c", "user.name=Timber Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], {
		stdout: "ignore",
		stderr: "pipe",
		env: { ...process.env, GIT_CONFIG_GLOBAL: "", GIT_CONFIG_NOSYSTEM: "1" },
	});
	if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
}

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
	writeFileSync(join(linked, "tracked.txt"), "two\n");
	writeFileSync(join(linked, "new.txt"), "new\n");
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("loadRepository", () => {
	test("lists the primary and linked worktrees with their file status", async () => {
		const repository = await loadRepository(primary);
		expect(repository?.name).toBe("sample");
		expect(repository?.worktrees.map(worktree => [worktree.branch, worktree.primary])).toEqual([["main", true], ["feat/x", false]]);

		const [main, feature] = repository!.worktrees;
		expect(main?.status).toEqual({ modified: 0, untracked: 0, sync: { kind: "unpublished" } });
		expect(feature?.status).toEqual({ modified: 1, untracked: 1, sync: { kind: "unpublished" } });
		expect(basename(feature!.path)).toBe("feat-x");
	});

	test("finds the same repository when asked from a linked worktree", async () => {
		const repository = await loadRepository(linked);
		expect(repository?.name).toBe("sample");
		expect(repository?.worktrees.length).toBe(2);
	});

	test("answers null for a folder that is not a repository", async () => {
		expect(await loadRepository(root)).toBeNull();
		expect(await loadRepository(join(root, "does-not-exist"))).toBeNull();
	});

	test("leaves the repository untouched", async () => {
		await loadRepository(primary);
		const status = Bun.spawnSync(["git", "-C", linked, "status", "--porcelain"]).stdout.toString();
		expect(status).toBe(" M tracked.txt\n?? new.txt\n");
	});
});

describe("listRepositories", () => {
	test("skips folders that are not repositories and lists a repository once", async () => {
		const repositories = await listRepositories([primary, root, linked]);
		expect(repositories.map(repository => repository.name)).toEqual(["sample"]);
	});
});

describe("configuredRepositoryPaths", () => {
	test("reads TIMBER_APP_REPOS and falls back to the current folder", () => {
		expect(configuredRepositoryPaths({ TIMBER_APP_REPOS: ["/a", " /b ", ""].join(delimiter) })).toEqual(["/a", "/b"]);
		expect(configuredRepositoryPaths({})).toEqual([process.cwd()]);
	});
});
