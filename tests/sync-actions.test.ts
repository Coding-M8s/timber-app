import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createGitRunner } from "../src/bun/fetch-git";
import { createFetcher } from "../src/bun/fetcher";
import { readBranchSync } from "../src/bun/git-engine";
import { createRepositoryTurns } from "../src/bun/repository-turns";
import { createSyncActions } from "../src/bun/sync-actions";
import type { Repository, TimberStatus, Worktree } from "../src/shared/model";
import { type SyncActionRequest, syncTargetOf } from "../src/shared/sync-actions";
import { windows } from "./support/runtime";
import { REAL_TIMBER_TIMEOUT_MS, git, isolatedEnvironment, ready, realTimber } from "./support/timber";

/** Git with no configuration from the machine, as the `git` helper of the tests uses. */
const testEnvironment = { ...process.env, GIT_CONFIG_GLOBAL: "", GIT_CONFIG_NOSYSTEM: "1", GIT_SSH_COMMAND: undefined, GIT_SSH: undefined };

// Real repositories with a local bare remote. Skipped on Windows, where no platform is verified yet.
describe.skipIf(windows)("Pull and Push against real repositories", () => {
	let root: string;
	/** Timber's own settings and state stay in the test's folder, and Git reads no configuration from the machine. */
	let timberEnvironment: Record<string, string | undefined>;
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

	function setUp(timber: TimberStatus = realTimber ? ready(realTimber) : { state: "not-found", source: "path", path: null }) {
		const runGit = createGitRunner("git", testEnvironment);
		const fetcher = createFetcher({ runGit, onChanged: path => changed.push(path), onStatus: () => {}, environment: testEnvironment });
		fetcher.sync([{ path: mine, commonDir: join(mine, ".git") }]);
		const actions = createSyncActions({
			findRepository,
			turns: createRepositoryTurns(),
			runGit,
			fetch: (repository, args, cwd) => fetcher.fetchWith(repository, args, cwd),
			whileNotFetching: (repository, task) => fetcher.whileNotFetching(repository, task),
			timber: async () => timber,
			environment: timberEnvironment,
		});
		return { fetcher, actions };
	}

	/** Push the feature worktree, as the interface asks for it: with the target the row showed. */
	async function pushFeature(actions: ReturnType<typeof setUp>["actions"]) {
		const listed = (await findRepository(mine))!.worktrees[1]!;
		const request: SyncActionRequest = { action: "push", repository: mine, worktree: feature, target: syncTargetOf(listed.sync)! };
		return actions.run(request);
	}

	/** Every ref of a repository, to show a refused or failed push changed none. */
	const refs = (cwd: string) => git(cwd, "for-each-ref", "--format=%(refname) %(objectname)");

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
		timberEnvironment = { ...isolatedEnvironment(root), GIT_SSH_COMMAND: undefined, GIT_SSH: undefined };
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

	test.skipIf(!realTimber)("push: timber publish pushes an ahead branch, and the row's counts follow", async () => {
		const { actions } = setUp();
		commit(feature, "mine.md", "mine\n");
		commit(feature, "more.md", "more\n");
		expect((await findRepository(mine))!.worktrees[1]!.sync).toMatchObject({ ahead: 2, behind: 0 });
		const files = git(feature, "status", "--porcelain");

		const result = await pushFeature(actions);

		expect(result).toEqual({ outcome: "done", action: "push", moved: true, fetchFailure: null });
		expect(git(remote, "rev-parse", "refs/heads/feature").trim()).toBe(head(feature));
		// The remote-tracking ref moved with the push, so the list reads the branch as level with no fetch.
		expect((await findRepository(mine))!.worktrees[1]!.sync).toMatchObject({ ahead: 0, behind: 0 });
		expect(git(feature, "status", "--porcelain")).toBe(files);
		// Only the feature branch moved on the remote.
		expect(git(remote, "rev-parse", "refs/heads/main").trim()).toBe(head(theirs, "main"));
	}, REAL_TIMBER_TIMEOUT_MS);

	test.skipIf(!realTimber)("push: a remote branch that moved on is refused with Timber's words, and no ref changes anywhere", async () => {
		const { actions } = setUp();
		// Pushed by someone else after the last fetch, so the row still reads the branch as ahead only.
		pushFromTheirs("theirs.md", "theirs\n");
		commit(feature, "mine.md", "mine\n");
		expect((await findRepository(mine))!.worktrees[1]!.sync).toMatchObject({ ahead: 1, behind: 0 });
		const [mineRefs, remoteRefs] = [refs(mine), refs(remote)];

		const result = await pushFeature(actions);

		expect(result).toMatchObject({ outcome: "refused", action: "push", reason: "timber-refused", fetchFailure: null });
		if (result.outcome !== "refused") throw new Error("unreachable");
		expect(result.failure.command).toBe(`timber publish --result-file <temporary file> -- ${feature}`);
		expect(result.failure.diagnostic).toContain("has moved on");
		expect(result.failure.diagnostic).toContain("Nothing was pushed");
		expect(refs(mine)).toBe(mineRefs);
		expect(refs(remote)).toBe(remoteRefs);
	}, REAL_TIMBER_TIMEOUT_MS);

	test.skipIf(!realTimber)("push: a remote that cannot be reached fails with Timber's words, and no ref changes", async () => {
		const { actions } = setUp();
		commit(feature, "mine.md", "mine\n");
		git(mine, "remote", "set-url", "origin", join(root, "missing.git"));
		const [mineRefs, remoteRefs] = [refs(mine), refs(remote)];

		const result = await pushFeature(actions);

		expect(result).toMatchObject({ outcome: "failed", action: "push", ran: true });
		if (result.outcome !== "failed") throw new Error("unreachable");
		expect(result.failure.diagnostic).toContain("Git push to origin/feature failed");
		expect(result.failure.output?.text).toContain("missing.git");
		expect(refs(mine)).toBe(mineRefs);
		expect(refs(remote)).toBe(remoteRefs);
	}, REAL_TIMBER_TIMEOUT_MS);

	test("push: runs nothing when Timber is not ready, or the upstream changed since the command was shown", async () => {
		commit(feature, "mine.md", "mine\n");
		const remoteRefs = refs(remote);
		const notReady = await pushFeature(setUp({ state: "not-found", source: "path", path: null }).actions);
		expect(notReady).toMatchObject({ outcome: "failed", action: "push", ran: false });
		const moved = await setUp().actions.run({ action: "push", repository: mine, worktree: feature, target: { remote: "origin", upstreamRef: "refs/remotes/origin/main" } });
		expect(moved).toMatchObject({ outcome: "failed", action: "push", ran: false });
		expect(refs(remote)).toBe(remoteRefs);
	});
});
