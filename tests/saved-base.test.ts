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
		// Timber keeps the saved base in the worktree's private Git metadata. Text that is not JSON is malformed.
		writeFileSync(join(primary, ".git", "worktrees", "feat-broken", "timber", "base.json"), "not json\n");
		git(primary, "worktree", "add", "-b", "plain", tree("plain"));
	});

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

	test("the primary checkout and a worktree added with plain Git have no saved base", async () => {
		const repository = await read();
		expect(byBranch(repository, "main").base).toEqual({ kind: "unassigned" });
		expect(byBranch(repository, "plain").base).toEqual({ kind: "unassigned" });
		expect(describeSavedBase(byBranch(repository, "plain").base)?.text).toBe("No saved base");
	});

	test("broken metadata is reported as invalid, the worktree stays listed, and nothing is filled in", async () => {
		const repository = await read();
		expect(repository.worktrees.length).toBe(5);
		const broken = byBranch(repository, "feat/broken");
		expect(broken.base).toEqual({ kind: "invalid", reason: "malformed" });
		expect(describeSavedBase(broken.base)).toMatchObject({ text: "Base unknown", warning: true });
		expect(initialOnto(broken.base)).toBe("");
	});

	test("reading the bases leaves every file, ref, and index untouched", async () => {
		const folders = [primary, tree("feat-based"), tree("feat-local"), tree("feat-broken"), tree("plain")];
		const before = folders.map(fingerprint);
		await read();
		await read();
		expect(folders.map(fingerprint)).toEqual(before);
	});
});
