import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitRunner } from "../src/bun/fetch-git";
import { createFetcher } from "../src/bun/fetcher";
import { readBranchSync } from "../src/bun/git-engine";
import { createRepositoryTurns } from "../src/bun/repository-turns";
import { createSyncActions } from "../src/bun/sync-actions";
import type { Repository, Worktree } from "../src/shared/model";
import { type SyncActionRequest, syncTargetOf } from "../src/shared/sync-actions";
import { windows } from "./support/runtime";
import { git } from "./support/timber";

/** Git with no configuration from the machine, as the `git` helper of the tests uses. */
const testEnvironment = { ...process.env, GIT_CONFIG_GLOBAL: "", GIT_CONFIG_NOSYSTEM: "1", GIT_SSH_COMMAND: undefined, GIT_SSH: undefined };

// Real repositories with a local bare remote. Skipped on Windows, where no platform is verified yet.
describe.skipIf(windows)("Pull against real repositories", () => {
	let root: string;
	let remote: string;
	let mine: string;
	let feature: string;
	let theirs: string;
	let changed: string[];

	const commit = (cwd: string, file: string, text: string, message = `Change ${file}`) => {
		writeFileSync(join(cwd, file), text);
		git(cwd, "add", file);
		git(cwd, "commit", "-q", "-m", message);
	};
	const head = (cwd: string, ref = "HEAD") => git(cwd, "rev-parse", ref).trim();
	const pushFromTheirs = (file: string, text: string) => {
		commit(theirs, file, text);
		git(theirs, "push", "-q", "origin", "feature");
	};

	/** Stands in for the app's list: the two worktrees of `mine`, with how their branches stand as the sidebar reads it. */
	async function findRepository(path: string): Promise<Repository | null> {
		if (path !== mine) return null;
		const branches = await readBranchSync(join(mine, ".git"));
		const worktree = (folder: string, branch: string, primary: boolean): Worktree => ({
			id: folder, path: folder, canonicalPath: folder, branch, head: head(folder), primary, detached: false, locked: false, prunable: false, pathExists: true,
			changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: branches?.get(branch) ?? null,
		});
		return { path: mine, name: "mine", available: true, failure: null, setup: "unknown", worktrees: [worktree(mine, "main", true), worktree(feature, "feature", false)] };
	}

	function setUp() {
		const runGit = createGitRunner("git", testEnvironment);
		const fetcher = createFetcher({ runGit, onChanged: path => changed.push(path), onStatus: () => {}, environment: testEnvironment });
		fetcher.sync([{ path: mine, commonDir: join(mine, ".git") }]);
		const actions = createSyncActions({ findRepository, turns: createRepositoryTurns(), runGit, fetch: (repository, args, cwd) => fetcher.fetchWith(repository, args, cwd) });
		return { fetcher, actions };
	}

	/** Pull the feature worktree, as the interface asks for it: with the target the row showed. */
	async function pullFeature(actions: ReturnType<typeof setUp>["actions"]) {
		const listed = (await findRepository(mine))!.worktrees[1]!;
		const target = syncTargetOf(listed.sync);
		expect(target).toEqual({ remote: "origin", upstreamRef: "refs/remotes/origin/feature" });
		const request: SyncActionRequest = { action: "pull", repository: mine, worktree: feature, target: target! };
		return actions.run(request);
	}

	beforeEach(() => {
		changed = [];
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-pull-")));
		remote = join(root, "remote.git");
		mine = join(root, "mine");
		feature = join(root, "mine-feature");
		theirs = join(root, "theirs");
		git(root, "init", "-q", "--bare", "-b", "main", remote);
		git(root, "clone", "-q", remote, theirs);
		git(theirs, "checkout", "-q", "-b", "main");
		commit(theirs, "readme.md", "one\n");
		git(theirs, "push", "-q", "origin", "main", "main:feature");
		git(theirs, "checkout", "-q", "-b", "feature", "--track", "origin/feature");
		git(root, "clone", "-q", remote, mine);
		git(mine, "branch", "-q", "--track", "feature", "origin/feature");
		git(mine, "worktree", "add", "-q", feature, "feature");
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("fast-forwards to commits pushed after the last background fetch", async () => {
		const { fetcher, actions } = setUp();
		pushFromTheirs("one.md", "first\n");
		await fetcher.fetchNow(mine);
		expect((await findRepository(mine))!.worktrees[1]!.sync).toMatchObject({ behind: 1, ahead: 0 });
		// Pushed after the background fetch: the pull's own fetch brings it in.
		pushFromTheirs("two.md", "second\n");
		changed.length = 0;

		const result = await pullFeature(actions);

		expect(result).toEqual({ outcome: "done", action: "pull", moved: true, fetchFailure: null });
		expect(head(feature)).toBe(head(theirs));
		expect(readFileSync(join(feature, "two.md"), "utf8")).toBe("second\n");
		// A fast-forward: no merge commit, the branch is the upstream's commit exactly.
		expect(git(feature, "rev-list", "--merges", "--count", "HEAD").trim()).toBe("0");
		expect((await findRepository(mine))!.worktrees[1]!.sync).toMatchObject({ behind: 0, ahead: 0 });
		// The fetch went through the fetcher, which reports the repository changed.
		expect(changed).toEqual([mine]);
		// Nothing else moved: main stays where it was.
		expect(head(mine)).not.toBe(head(theirs));
	});

	test("falls back to the last fetched commits when the remote cannot be reached, and says the fetch failed", async () => {
		const { fetcher, actions } = setUp();
		pushFromTheirs("one.md", "first\n");
		await fetcher.fetchNow(mine);
		const fetched = head(mine, "origin/feature");
		pushFromTheirs("two.md", "second\n");
		git(mine, "remote", "set-url", "origin", join(root, "missing.git"));

		const result = await pullFeature(actions);

		expect(result).toMatchObject({ outcome: "done", action: "pull", moved: true, fetchFailure: { kind: "failed" } });
		if (result.outcome !== "done") throw new Error("unreachable");
		expect(result.fetchFailure!.message).toContain("missing.git");
		expect(head(feature)).toBe(fetched);
		expect(head(feature)).not.toBe(head(theirs));
	});

	test("refuses a diverged branch with Git's message, and makes no merge commit", async () => {
		const { fetcher, actions } = setUp();
		pushFromTheirs("one.md", "theirs\n");
		commit(feature, "mine.md", "mine\n");
		await fetcher.fetchNow(mine);
		const before = head(feature);

		const result = await pullFeature(actions);

		expect(result).toMatchObject({ outcome: "refused", action: "pull", reason: "diverged", fetchFailure: null });
		if (result.outcome !== "refused") throw new Error("unreachable");
		expect(result.failure.command).toBe("git merge --ff-only --no-autostash refs/remotes/origin/feature");
		expect(result.failure.diagnostic).toMatch(/fast-forward/i);
		expect(head(feature)).toBe(before);
		expect(git(feature, "rev-list", "--merges", "--count", "HEAD").trim()).toBe("0");
		expect(git(feature, "status", "--porcelain")).toBe("");
	});

	test("refuses when local changes would be overwritten, leaving the files as they were, even with autostash configured", async () => {
		const { fetcher, actions } = setUp();
		pushFromTheirs("readme.md", "theirs\n");
		await fetcher.fetchNow(mine);
		git(mine, "config", "merge.autostash", "true");
		writeFileSync(join(feature, "readme.md"), "my unsaved edit\n");
		writeFileSync(join(feature, "notes.txt"), "untracked\n");
		const before = head(feature);
		const status = git(feature, "status", "--porcelain");

		const result = await pullFeature(actions);

		expect(result).toMatchObject({ outcome: "refused", action: "pull", reason: "local-changes" });
		if (result.outcome !== "refused") throw new Error("unreachable");
		expect(result.failure.output?.text).toContain("would be overwritten");
		expect(readFileSync(join(feature, "readme.md"), "utf8")).toBe("my unsaved edit\n");
		expect(readFileSync(join(feature, "notes.txt"), "utf8")).toBe("untracked\n");
		expect(head(feature)).toBe(before);
		expect(git(feature, "status", "--porcelain")).toBe(status);
		expect(git(feature, "stash", "list")).toBe("");
	});

	test("runs nothing when the upstream changed since the commands were shown", async () => {
		const { actions } = setUp();
		pushFromTheirs("one.md", "first\n");
		const remoteBefore = head(mine, "origin/feature");
		const result = await actions.run({ action: "pull", repository: mine, worktree: feature, target: { remote: "origin", upstreamRef: "refs/remotes/origin/main" } });
		expect(result).toMatchObject({ outcome: "failed", ran: false });
		if (result.outcome !== "failed") throw new Error("unreachable");
		expect(result.failure.diagnostic).toContain("Nothing was run.");
		// Not even the fetch ran.
		expect(head(mine, "origin/feature")).toBe(remoteBefore);
	});

	test("runs nothing for a worktree the list does not have, or a request that is not complete", async () => {
		const { actions } = setUp();
		const target = { remote: "origin", upstreamRef: "refs/remotes/origin/feature" };
		expect(await actions.run({ action: "pull", repository: mine, worktree: join(root, "elsewhere"), target })).toMatchObject({ outcome: "failed", ran: false });
		expect(await actions.run({ action: "pull", repository: join(root, "other"), worktree: feature, target })).toMatchObject({ outcome: "failed", ran: false });
		expect(await actions.run({ action: "pull", repository: mine, worktree: feature } as unknown as SyncActionRequest)).toMatchObject({ outcome: "failed", ran: false });
		expect(await actions.run({ action: "shove", repository: mine, worktree: feature, target } as unknown as SyncActionRequest)).toMatchObject({ outcome: "failed", ran: false });
	});
});
