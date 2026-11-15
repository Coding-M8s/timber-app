import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import { commonDirectory, listRepositories, loadRepository, overrideRepositoryPaths, reloadRepository } from "../src/bun/git-engine";

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
		expect(repository?.available).toBe(true);
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

describe("reloadRepository", () => {
	/** Everything a read-only query must leave alone: refs, the index, and the working files. */
	function fingerprint(): string {
		const run = (cwd: string, ...args: string[]) => Bun.spawnSync(["git", "-C", cwd, ...args]).stdout.toString();
		return [
			run(primary, "for-each-ref"),
			run(primary, "worktree", "list", "--porcelain"),
			run(primary, "status", "--porcelain"),
			run(linked, "status", "--porcelain"),
			run(linked, "ls-files", "--stage"),
		].join("\n");
	}

	test("reads a repository again by its primary checkout and sees what changed", async () => {
		const before = await reloadRepository(primary);
		expect(before?.worktrees[1]?.status?.untracked).toBe(1);

		const extra = join(linked, "another.txt");
		writeFileSync(extra, "more\n");
		try {
			const after = await reloadRepository(primary);
			expect(after?.path).toBe(primary);
			expect(after?.worktrees[1]?.status?.untracked).toBe(2);
		} finally {
			rmSync(extra);
		}
	});

	test("answers null for anything that is not a primary checkout", async () => {
		expect(await reloadRepository(linked)).toBeNull();
		expect(await reloadRepository(root)).toBeNull();
		expect(await reloadRepository(join(root, "does-not-exist"))).toBeNull();
	});

	test("leaves refs, the index, and files untouched", async () => {
		const before = fingerprint();
		await reloadRepository(primary);
		await reloadRepository(linked);
		expect(fingerprint()).toBe(before);
	});
});

describe("listRepositories", () => {
	test("skips folders that are not repositories and lists a repository once", async () => {
		const repositories = await listRepositories([primary, root, linked]);
		expect(repositories.map(repository => repository.name)).toEqual(["sample"]);
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
