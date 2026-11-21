import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeSavedBase } from "../src/mainview/base-format";
import { createRepositoryReader } from "../src/bun/repository-reader";
import type { Repository, TimberStatus } from "../src/shared/model";
import { initialOnto } from "../src/shared/rebase-command";
import { REAL_TIMBER_TIMEOUT_MS, fingerprint, git, isolatedEnvironment, makeRepository, realTimber } from "./support/timber";

setDefaultTimeout(REAL_TIMBER_TIMEOUT_MS);

/**
 * The saved base of each worktree, read through the installed Timber from a
 * real repository whose worktrees Timber itself made.
 */
describe.skipIf(realTimber === null)("saved bases, with the installed Timber on a real repository", () => {
	let work: string;
	let primary: string;
	let trees: string;
	let environment: Record<string, string | undefined>;
	let loose: string;

	const tree = (name: string) => join(trees, name);
	const timber = (...timberArguments: string[]) => {
		const result = Bun.spawnSync([realTimber!, ...timberArguments], { cwd: primary, env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
		if (result.exitCode !== 0) throw new Error(`timber ${timberArguments.join(" ")} failed: ${result.stdout.toString()}${result.stderr.toString()}`);
	};
	const ready: TimberStatus = { state: "ready", source: "path", path: realTimber!, version: "0.1.2" };
	const read = async (): Promise<Repository> => (await createRepositoryReader(async () => ready, environment).reload(primary))!;
	const byBranch = (repository: Repository, branch: string) => repository.worktrees.find(worktree => worktree.branch === branch)!;

	beforeAll(() => {
		work = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-saved-base-")));
		// A home of its own, so Timber's first-use marker and any user configuration stay out of this.
		environment = isolatedEnvironment(work);

		primary = join(work, "my sample");
		trees = join(work, "my sample-worktrees");
		makeRepository(work, "my sample");
		const remote = join(work, "remote.git");
		git(work, "init", "--bare", remote);
		git(primary, "remote", "add", "origin", remote);
		git(primary, "push", "--set-upstream", "origin", "main");

		timber("new", "feat/based", "--base", "origin/main", "--no-editor", "--no-agent");
		timber("new", "feat/local", "--base", "refs/heads/main", "--no-editor", "--no-agent");
		timber("new", "feat/broken", "--base", "origin/main", "--no-editor", "--no-agent");
		// A commit made on a detached HEAD, which no branch contains once main is checked out again.
		git(primary, "checkout", "--quiet", "--detach");
		git(primary, "commit", "--quiet", "--allow-empty", "-m", "On no branch");
		loose = git(primary, "rev-parse", "HEAD").trim();
		git(primary, "checkout", "--quiet", "main");
		expect(git(primary, "for-each-ref", "--contains", loose).trim()).toBe("");
		timber("new", "feat/commit", "--base", loose, "--no-editor", "--no-agent");
		// Timber keeps the saved base in the worktree's private Git metadata. Text that is not JSON is malformed.
		writeFileSync(join(primary, ".git", "worktrees", "feat-broken", "timber", "base.json"), "not json\n");
		git(primary, "worktree", "add", "-b", "plain", tree("plain"));
		// Four runs of Timber, each of which can take the time one test is given.
	}, 4 * REAL_TIMBER_TIMEOUT_MS);

	afterAll(() => {
		rmSync(work, { recursive: true, force: true });
	});

	test("a worktree created with a base shows that base, and the Rebase dialog would start from it", async () => {
		const repository = await read();
		expect(repository.failure).toBeNull();
		const based = byBranch(repository, "feat/based");
		expect(based.base).toEqual({ kind: "assigned", ref: "refs/remotes/origin/main" });
		expect(describeSavedBase(based.base)?.text).toBe("Base origin/main");
		expect(initialOnto(based.base)).toBe("origin/main");

		const local = byBranch(repository, "feat/local");
		expect(local.base).toEqual({ kind: "assigned", ref: "refs/heads/main" });
		expect(initialOnto(local.base)).toBe("refs/heads/main");
	});

	test("a worktree based on a commit no branch contains shows that commit, and the Rebase dialog would start from its full hash", async () => {
		// Only the worktree's own new branch, which starts there.
		expect(git(primary, "for-each-ref", "--format=%(refname)", "--contains", loose).trim()).toBe("refs/heads/feat/commit");
		const based = byBranch(await read(), "feat/commit");
		expect(based.base).toEqual({ kind: "commit", commit: loose });
		expect(describeSavedBase(based.base)?.text).toBe(`Base ${loose.slice(0, 7)}`);
		expect(initialOnto(based.base)).toBe(loose);
	});

	test("the primary checkout and a worktree added with plain Git have no saved base", async () => {
		const repository = await read();
		expect(byBranch(repository, "main").base).toEqual({ kind: "unassigned" });
		expect(byBranch(repository, "plain").base).toEqual({ kind: "unassigned" });
		expect(describeSavedBase(byBranch(repository, "plain").base)?.text).toBe("No saved base");
	});

	test("broken metadata is reported as invalid, the worktree stays listed, and nothing is filled in", async () => {
		const repository = await read();
		expect(repository.worktrees.length).toBe(6);
		const broken = byBranch(repository, "feat/broken");
		expect(broken.base).toEqual({ kind: "invalid", reason: "malformed" });
		expect(describeSavedBase(broken.base)).toMatchObject({ text: "Base unknown", warning: true });
		expect(initialOnto(broken.base)).toBe("");
	});

	test("reading the bases leaves every file, ref, and index untouched", async () => {
		const folders = [primary, tree("feat-based"), tree("feat-local"), tree("feat-broken"), tree("feat-commit"), tree("plain")];
		const before = folders.map(fingerprint);
		await read();
		await read();
		expect(folders.map(fingerprint)).toEqual(before);
	});
});
