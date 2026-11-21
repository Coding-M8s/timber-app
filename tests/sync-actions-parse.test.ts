import { describe, expect, test } from "bun:test";
import { parseBranchSync } from "../src/shared/git-parse";
import type { SyncState } from "../src/shared/model";
import {
	SYNC_ACTION_KINDS, applicableSyncActions, describeSyncStep, isSyncActionKind, readPullRuns, readSyncRefusal, syncActionApplies, syncActionSteps, syncNotRun, syncTargetOf,
} from "../src/shared/sync-actions";

const target = { remote: "origin", upstreamRef: "refs/remotes/origin/feat/login" };
const tracking = (ahead: number, behind: number, extra: Partial<Extract<SyncState, { kind: "tracking" }>> = {}): SyncState => ({
	kind: "tracking", upstream: "origin/feat/login", ahead, behind, ...target, ...extra,
});

describe("parseBranchSync, for sync actions", () => {
	test("keeps the remote and the upstream's full ref of a remote-tracking upstream", () => {
		const output = `${["refs/heads/feat/login", "origin/feat/login", "behind 2", "refs/remotes/origin/feat/login", "origin"].join("\0")}\n`;
		expect(parseBranchSync(output).get("feat/login")).toEqual(tracking(0, 2));
	});

	test("leaves them out for an upstream that is another local branch", () => {
		const output = `${["refs/heads/topic", "main", "behind 1", "refs/heads/main", "."].join("\0")}\n`;
		expect(parseBranchSync(output).get("topic")).toEqual({ kind: "tracking", upstream: "main", ahead: 0, behind: 1 });
	});
});

describe("the sync action table", () => {
	test("knows pull, and nothing else yet", () => {
		expect(SYNC_ACTION_KINDS).toEqual(["pull"]);
		expect(isSyncActionKind("pull")).toBe(true);
		expect(isSyncActionKind("push")).toBe(false);
		expect(isSyncActionKind(undefined)).toBe(false);
	});

	test("pull is a fetch of the remote, then a fast-forward to the upstream's full ref, never a merge commit or an autostash", () => {
		const steps = syncActionSteps("pull", target);
		expect(steps).toEqual([
			{ args: ["fetch", "origin"], network: true },
			{ args: ["merge", "--ff-only", "--no-autostash", "refs/remotes/origin/feat/login"], network: false },
		]);
		expect(steps.map(describeSyncStep)).toEqual(["git fetch origin", "git merge --ff-only --no-autostash refs/remotes/origin/feat/login"]);
	});

	test("shows a remote or a ref with a space quoted, while the arguments keep it as it is", () => {
		const [fetchStep] = syncActionSteps("pull", { remote: "my remote", upstreamRef: "refs/remotes/my remote/main" });
		expect(fetchStep!.args).toEqual(["fetch", "my remote"]);
		expect(describeSyncStep(fetchStep!)).toBe("git fetch 'my remote'");
	});

	test("pull is offered only when behind and not ahead, with an upstream on a remote that was not rewritten", () => {
		expect(syncActionApplies("pull", tracking(0, 3))).toBe(true);
		expect(applicableSyncActions(tracking(0, 3))).toEqual(["pull"]);
		const notOffered: (SyncState | null)[] = [
			tracking(0, 0),
			tracking(2, 0),
			// Diverged: Rebase is the way on.
			tracking(1, 3),
			tracking(0, 3, { forcePushed: { at: 1 } }),
			{ kind: "gone", upstream: "origin/feat/login" },
			{ kind: "unpublished" },
			// An upstream that is a local branch, or one Git did not name a remote for.
			{ kind: "tracking", upstream: "main", ahead: 0, behind: 1 },
			null,
		];
		for (const sync of notOffered) expect(applicableSyncActions(sync)).toEqual([]);
	});

	test("a target is only one the commands can use as they are", () => {
		expect(syncTargetOf(tracking(0, 1))).toEqual(target);
		expect(syncTargetOf(tracking(0, 1, { remote: "--upload-pack=evil", upstreamRef: "refs/remotes/--upload-pack=evil/x" }))).toBeNull();
		expect(syncTargetOf(tracking(0, 1, { upstreamRef: "refs/remotes/upstream/feat/login" }))).toBeNull();
		expect(syncTargetOf(tracking(0, 1, { upstreamRef: "refs/heads/feat/login" }))).toBeNull();
		expect(syncTargetOf({ kind: "unpublished" })).toBeNull();
	});
});

describe("reading a pull", () => {
	const ok = { exitCode: 0, stdout: "", stderr: "" };
	const AT = 1_700_000_000_000;

	test("done, with or without a move", () => {
		expect(readPullRuns(target, { fetch: ok, merge: ok, moved: true }, AT)).toEqual({ outcome: "done", action: "pull", moved: true, fetchFailure: null });
		expect(readPullRuns(target, { fetch: ok, merge: { ...ok, stdout: "Already up to date.\n" }, moved: false }, AT)).toMatchObject({ outcome: "done", moved: false });
	});

	test("done on the last fetched commits when the fetch failed, with Git's words for why and no password", () => {
		const fetch = { exitCode: 128, stdout: "", stderr: "fatal: unable to access 'https://sam:secret@example.com/x.git/': Could not resolve host: example.com\n" };
		const result = readPullRuns(target, { fetch, merge: ok, moved: true }, AT);
		expect(result).toMatchObject({ outcome: "done", moved: true, fetchFailure: { kind: "offline", at: AT } });
		if (result.outcome !== "done") throw new Error("unreachable");
		expect(result.fetchFailure!.message).toContain("Could not resolve host");
		expect(result.fetchFailure!.message).not.toContain("secret");
	});

	test("refused when diverged, with Git's message and the command that refused", () => {
		const merge = { exitCode: 128, stdout: "", stderr: "hint: Diverging branches can't be fast-forwarded, you need to either:\nfatal: Not possible to fast-forward, aborting.\n" };
		const result = readPullRuns(target, { fetch: ok, merge, moved: false }, AT);
		expect(result).toMatchObject({ outcome: "refused", reason: "diverged", fetchFailure: null });
		if (result.outcome !== "refused") throw new Error("unreachable");
		expect(result.failure).toMatchObject({ command: "git merge --ff-only --no-autostash refs/remotes/origin/feat/login", diagnostic: "fatal: Not possible to fast-forward, aborting." });
		expect(result.failure.output?.text).toContain("Diverging branches");
	});

	test("refused when local changes would be overwritten", () => {
		const merge = { exitCode: 1, stdout: "Updating 1111111..2222222\n", stderr: "error: Your local changes to the following files would be overwritten by merge:\n\treadme.md\nPlease commit your changes or stash them before you merge.\nAborting\n" };
		const result = readPullRuns(target, { fetch: ok, merge, moved: false }, AT);
		expect(result).toMatchObject({ outcome: "refused", reason: "local-changes" });
		if (result.outcome !== "refused") throw new Error("unreachable");
		expect(result.failure.diagnostic).toBe("error: Your local changes to the following files would be overwritten by merge:");
	});

	test("failed when Git did not finish", () => {
		expect(readPullRuns(target, { fetch: ok, merge: { exitCode: null, stdout: "", stderr: "" }, moved: false }, AT)).toMatchObject({ outcome: "failed", ran: true });
	});

	test("refusal reasons from Git's words", () => {
		expect(readSyncRefusal("fatal: Not possible to fast-forward, aborting.")).toBe("diverged");
		expect(readSyncRefusal("error: The following untracked working tree files would be overwritten by merge:")).toBe("local-changes");
		expect(readSyncRefusal("fatal: Unable to create '/x/.git/index.lock': File exists.")).toBeNull();
	});

	test("any other stop is a failure that may have changed files, never a promise that nothing changed", () => {
		const merge = { exitCode: 128, stdout: "Updating 1111111..2222222\n", stderr: "error: unable to unlink old 'src/app.ts': Permission denied\n" };
		const result = readPullRuns(target, { fetch: ok, merge, moved: false }, AT);
		expect(result).toMatchObject({ outcome: "failed", action: "pull", ran: true });
		if (result.outcome !== "failed") throw new Error("unreachable");
		expect(result.failure.diagnostic).toBe("error: unable to unlink old 'src/app.ts': Permission denied. Check the worktree before trying again.");
		expect(result.failure.command).toBe("git merge --ff-only --no-autostash refs/remotes/origin/feat/login");
	});

	test("a refusal from before anything ran says so", () => {
		expect(syncNotRun("pull", "No upstream.")).toEqual({ outcome: "failed", action: "pull", ran: false, failure: { command: null, diagnostic: "No upstream. Nothing was run.", output: null } });
	});
});
