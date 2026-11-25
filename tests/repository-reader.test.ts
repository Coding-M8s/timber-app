import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepositoryReader, syncOf } from "../src/bun/repository-reader";
import type { Repository, SyncState } from "../src/shared/model";
import { REAL_TIMBER_TIMEOUT_MS, fingerprint, git, makeRepository, ready, realTimber, recorded, standInTimber } from "./support/timber";

setDefaultTimeout(REAL_TIMBER_TIMEOUT_MS);

let root: string;
let primary: string;
let trees: string;
let plain: string;

const tree = (name: string) => join(trees, name);

beforeAll(() => {
	// Git reports real paths, so resolve the temporary folder once (it is a link on macOS).
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-reader-")));
	primary = join(root, "my sample");
	trees = join(root, "my sample-worktrees");
	plain = join(root, "plain");
	mkdirSync(plain);

	makeRepository(root, "my sample");

	git(primary, "worktree", "add", "-b", "feat/x", tree("feat-x"));
	writeFileSync(join(tree("feat-x"), "tracked.txt"), "two\n");
	writeFileSync(join(tree("feat-x"), "new file.txt"), "new\n");
	git(primary, "worktree", "add", "-b", "zażółć/gęślą", tree("zażółć gęślą jaźń"));
	writeFileSync(join(tree("zażółć gęślą jaźń"), "日本語 メモ.txt"), "note\n");
	git(primary, "worktree", "add", "--detach", tree("detached"));
	git(primary, "worktree", "add", "-b", "kept", tree("kept"));
	git(primary, "worktree", "lock", "--reason", "on a removable drive", tree("kept"));
	git(primary, "worktree", "add", "-b", "gone", tree("gone"));
	rmSync(tree("gone"), { recursive: true });
	git(primary, "worktree", "add", "-b", "swapped", tree("swapped"));
	rmSync(tree("swapped"), { recursive: true });
	mkdirSync(tree("swapped"));

	// One published branch that is one commit ahead of its upstream.
	const remote = join(root, "remote.git");
	git(root, "init", "--bare", remote);
	git(primary, "remote", "add", "origin", remote);
	git(primary, "push", "--set-upstream", "origin", "main");
	git(primary, "commit", "--allow-empty", "-m", "Second commit");
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe.skipIf(realTimber === null)("with the installed Timber, on a real repository", () => {
	const reader = () => createRepositoryReader(async () => ready(realTimber!));
	const read = async (): Promise<Repository> => (await reader().reload(primary))!;
	const byBranch = (repository: Repository, branch: string | null) => repository.worktrees.find(worktree => worktree.branch === branch)!;

	test("lists the same worktrees, in the same order, as timber ls", async () => {
		const repository = await read();
		expect(repository).toMatchObject({ path: primary, name: "my sample", available: true, failure: null });

		// Every row of the table Timber prints for people ends with the worktree's path.
		const table = Bun.spawnSync([realTimber!, "ls"], { cwd: primary, stderr: "ignore" }).stdout.toString().trimEnd().split("\n").slice(1);
		expect(table.length).toBe(7);
		expect(repository.worktrees.length).toBe(table.length);
		for (const [index, worktree] of repository.worktrees.entries()) {
			expect(table[index]!.endsWith(`  ${worktree.path}`)).toBe(true);
		}
		expect(repository.worktrees.map(worktree => worktree.path)).toEqual([
			primary, tree("detached"), tree("feat-x"), tree("gone"), tree("kept"), tree("swapped"), tree("zażółć gęślą jaźń"),
		]);
	});

	test("reads changes from Timber and upstream state from Git", async () => {
		const repository = await read();
		expect(byBranch(repository, "main")).toMatchObject({
			primary: true,
			changes: { kind: "known", modified: [], untracked: [] },
			sync: { kind: "tracking", upstream: "origin/main", ahead: 1, behind: 0 },
		});
		expect(byBranch(repository, "feat/x")).toMatchObject({
			primary: false,
			changes: { kind: "known", modified: ["tracked.txt"], untracked: ["new file.txt"] },
			sync: { kind: "unpublished" },
		});
	});

	test("still lists a detached HEAD, a missing folder, and an unknown status, marked as such", async () => {
		const repository = await read();
		expect(byBranch(repository, null)).toMatchObject({ path: tree("detached"), detached: true, sync: null, changes: { kind: "known" } });
		expect(byBranch(repository, "gone")).toMatchObject({
			pathExists: false, prunable: true, canonicalPath: null, changes: { kind: "unknown", reason: "Worktree path is missing" },
		});
		expect(byBranch(repository, "swapped")).toMatchObject({ pathExists: true, canonicalPath: null, changes: { kind: "unknown" } });
		expect(byBranch(repository, "kept")).toMatchObject({ locked: true, pathExists: true });
	});

	test("handles spaces and non-ASCII characters in paths, branches, and file names", async () => {
		const worktree = byBranch(await read(), "zażółć/gęślą");
		expect(worktree).toMatchObject({
			path: tree("zażółć gęślą jaźń"),
			canonicalPath: tree("zażółć gęślą jaźń"),
			changes: { kind: "known", modified: [], untracked: ["日本語 メモ.txt"] },
			sync: { kind: "unpublished" },
		});
	});

	test("identifies each worktree by the common Git directory and its canonical path", async () => {
		const repository = await read();
		const commonDir = realpathSync(join(primary, ".git"));
		expect(byBranch(repository, "feat/x").id).toBe([commonDir, "verified", tree("feat-x")].join("\0"));
		expect(byBranch(repository, "gone").id).toBe([commonDir, "registered", tree("gone")].join("\0"));
		expect(new Set(repository.worktrees.map(worktree => worktree.id)).size).toBe(7);
		// The identity is the same whichever folder the repository was read from.
		const fromLinked = await reader().find(tree("zażółć gęślą jaźń"));
		expect(fromLinked.outcome === "read" && fromLinked.repository.worktrees.map(worktree => worktree.id)).toEqual(repository.worktrees.map(worktree => worktree.id));
	});

	test("finds the repository from a linked worktree or a folder inside one", async () => {
		mkdirSync(join(tree("feat-x"), "nested", "deep"), { recursive: true });
		for (const folder of [tree("feat-x"), join(tree("feat-x"), "nested", "deep")]) {
			const found = await reader().find(folder);
			expect(found.outcome === "read" && found.repository.path).toBe(primary);
		}
		rmSync(join(tree("feat-x"), "nested"), { recursive: true });
	});

	test("reload answers null for anything that is not a primary checkout", async () => {
		expect(await reader().reload(tree("feat-x"))).toBeNull();
		expect(await reader().reload(plain)).toBeNull();
		expect(await reader().reload(join(root, "does-not-exist"))).toBeNull();
		expect(await reader().find(plain)).toEqual({ outcome: "not-a-repository" });
	});

	test("marks a repository with nothing to fetch only while no branch of it tracks a remote", async () => {
		expect((await read()).nothingToFetch).toBeUndefined();
		const local = makeRepository(root, "local only");
		const folders = () => fingerprint(local);
		const before = folders();
		expect((await reader().reload(local))?.nothingToFetch).toBe(true);
		expect(folders()).toBe(before);
		git(local, "remote", "add", "origin", join(root, "remote.git"));
		git(local, "fetch", "origin");
		expect((await reader().reload(local))?.nothingToFetch).toBe(true);
		git(local, "branch", "--set-upstream-to=origin/main", "main");
		expect((await reader().reload(local))?.nothingToFetch).toBeUndefined();
	});

	test("leaves every file, ref, and index untouched", async () => {
		const folders = [primary, tree("feat-x"), tree("zażółć gęślą jaźń"), tree("kept")];
		const before = folders.map(fingerprint);
		await reader().reload(primary);
		await reader().find(tree("feat-x"));
		expect(folders.map(fingerprint)).toEqual(before);
	});
});

describe("when Timber does not give a list", () => {
	const standIn = (name: string, output: string, exitCode: number) =>
		createRepositoryReader(async () => ready(standInTimber(root, `stand-in-${name}`, output, exitCode).path));

	test("a failed record becomes a repository with the diagnostic and no worktrees", async () => {
		const expected = { path: primary, name: "my sample", available: true, failure: "Not a Git repository: /work/plain", setup: "unknown" as const, fallbackBase: null, worktrees: [] };
		expect(await standIn("failed", recorded.failed, 1).reload(primary)).toEqual(expected);
		expect(await standIn("failed", recorded.failed, 1).find(primary)).toEqual({ outcome: "failed", message: "Not a Git repository: /work/plain" });
	});

	test("an unsupported version, malformed output, or a mismatched exit code never shows a list", async () => {
		const cases: [string, string, number][] = [
			["later", recorded.succeeded.replace('"schemaVersion":1', '"schemaVersion":3'), 0],
			["cut", recorded.succeeded.slice(0, 700), 0],
			["mismatch", recorded.succeeded, 1],
		];
		for (const [name, output, exitCode] of cases) {
			const repository = await standIn(name, output, exitCode).reload(primary);
			expect(repository?.worktrees).toEqual([]);
			expect(repository?.failure).toContain("timber ls --json");
		}
	});

	test("a list for another repository is not taken for this one", async () => {
		// The recorded list is of /work/sample, so this folder is not its primary checkout.
		expect(await standIn("other", recorded.succeeded, 0).reload(primary)).toBeNull();
	});

	test("says so when Timber is not ready, without running anything", async () => {
		const missing = createRepositoryReader(async () => ({ state: "not-found", source: "path", path: null }));
		expect(await missing.reload(primary)).toMatchObject({ failure: "Timber was not found on PATH", worktrees: [] });
		const old = createRepositoryReader(async () => ({ state: "too-old", source: "path", path: "/bin/timber", found: "0.1.0", required: "0.1.1" }));
		expect(await old.find(primary)).toEqual({ outcome: "failed", message: "Timber 0.1.0 at /bin/timber, found on PATH, is older than the required 0.1.1" });
	});

	test("a folder outside any repository is not a repository, whatever Timber would say", async () => {
		expect(await standIn("unasked", recorded.succeeded, 0).find(plain)).toEqual({ outcome: "not-a-repository" });
		expect(await standIn("unasked", recorded.succeeded, 0).reload(join(root, "does-not-exist"))).toBeNull();
	});
});

describe("syncOf", () => {
	const level: SyncState = { kind: "tracking", upstream: "origin/main", ahead: 0, behind: 0 };
	const branches = new Map<string, SyncState>([["main", level]]);
	const head = "c42c7d84343eb4d8ac9bff5dfeb489b57da8196f";

	test("takes what Git said about the branch, by exact name", () => {
		expect(syncOf({ branch: "main", head }, branches)).toEqual(level);
	});

	test("a detached HEAD has no upstream state", () => {
		expect(syncOf({ branch: null, head }, branches)).toBeNull();
	});

	test("a branch Git did not answer about is unknown, never level or unpublished", () => {
		expect(syncOf({ branch: "main", head }, null)).toBeNull();
		expect(syncOf({ branch: "Main", head }, branches)).toBeNull();
		expect(syncOf({ branch: "feat/unlisted", head }, branches)).toBeNull();
	});

	test("a branch with no commit yet cannot have been published", () => {
		expect(syncOf({ branch: "fresh", head: null }, branches)).toEqual({ kind: "unpublished" });
		expect(syncOf({ branch: "fresh", head: null }, null)).toBeNull();
	});
});

// The Linux job installs Timber. The Windows job does not, so there the tests that need it are skipped, and
// they are run on a Windows machine with Timber installed instead (docs/architecture.md, "Tests on Windows").
test.skipIf(!process.env.CI || process.platform === "win32")("CI has a Timber, so the tests on real repositories run there", () => {
	expect(realTimber).not.toBeNull();
});
