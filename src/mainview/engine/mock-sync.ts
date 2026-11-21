import type { SyncState, Worktree } from "../../shared/model";
import { type SyncActionKind, type SyncActionRequest, type SyncActionResult, describeSyncStep, syncActionSteps, syncNotRun, syncTargetOf } from "../../shared/sync-actions";

/**
 * How the mock engine acts out a sync action, for the browser build and for
 * tests. Chosen with `timberMock.endSyncActions(...)`.
 */
export const syncEndings = {
	"pulled": "The fetch works and the branch fast-forwards",
	"fetch-failed": "The fetch cannot reach the remote, and the branch fast-forwards to the last fetched commits",
	"diverged": "Git refuses: the branch has commits its upstream does not",
	"local-changes": "Git refuses: local changes would be overwritten",
	"failed": "Git does not finish",
} as const;

export type SyncEnding = keyof typeof syncEndings;

export const isSyncEnding = (value: unknown): value is SyncEnding => typeof value === "string" && Object.hasOwn(syncEndings, value);

/** The mock's sample data names upstreams on `origin` only, so their remote and full ref follow from the short name. */
export function withSampleTarget(sync: SyncState | null): SyncState | null {
	if (sync?.kind !== "tracking" || sync.remote !== undefined || !sync.upstream.startsWith("origin/")) return sync;
	return { ...sync, remote: "origin", upstreamRef: `refs/remotes/${sync.upstream}` };
}

/**
 * What a pull comes to for this worktree: the result, and the branch's sync
 * state afterwards, or null when it did not change. A branch that is ahead is
 * refused as diverged whatever the ending, as Git would.
 */
export function actOutPull(worktree: Worktree, request: SyncActionRequest, ending: SyncEnding, at: number): { result: SyncActionResult; sync: SyncState | null } {
	const target = syncTargetOf(worktree.sync);
	if (worktree.branch === null || target === null || worktree.sync?.kind !== "tracking") {
		return { result: syncNotRun("pull", `The branch of ${worktree.path} has no upstream on a remote.`), sync: null };
	}
	if (target.remote !== request.target.remote || target.upstreamRef !== request.target.upstreamRef) {
		return { result: syncNotRun("pull", `The upstream is now ${target.upstreamRef}, not the ${request.target.upstreamRef} that was shown. Look at the commands again.`), sync: null };
	}
	const [, mergeStep] = syncActionSteps("pull", target);
	const command = describeSyncStep(mergeStep!);
	const sync = worktree.sync;
	const caughtUp: SyncState = { ...sync, behind: 0 };
	const diverged = ending === "diverged" || sync.ahead > 0;
	if (diverged) {
		const text = "hint: Diverging branches can't be fast-forwarded, you need to either:\nhint:\nhint: \tgit merge --no-ff\nhint:\nhint: or:\nhint:\nhint: \tgit rebase\nfatal: Not possible to fast-forward, aborting.";
		return { result: { outcome: "refused", action: "pull", reason: "diverged", fetchFailure: null, failure: { command, diagnostic: "fatal: Not possible to fast-forward, aborting.", output: { text, truncated: false } } }, sync: null };
	}
	switch (ending) {
		case "pulled":
			return { result: { outcome: "done", action: "pull", moved: sync.behind > 0, fetchFailure: null }, sync: caughtUp };
		case "fetch-failed":
			return {
				result: { outcome: "done", action: "pull", moved: sync.behind > 0, fetchFailure: { kind: "offline", message: "fatal: unable to access 'https://example.com/timber.git/': Could not resolve host: example.com", at } },
				sync: caughtUp,
			};
		case "local-changes": {
			const text = "Updating 1111111..2222222\nerror: Your local changes to the following files would be overwritten by merge:\n\tsrc/app.ts\nPlease commit your changes or stash them before you merge.\nAborting";
			return { result: { outcome: "refused", action: "pull", reason: "local-changes", fetchFailure: null, failure: { command, diagnostic: "error: Your local changes to the following files would be overwritten by merge:", output: { text, truncated: false } } }, sync: null };
		}
		case "failed":
			return { result: { outcome: "failed", action: "pull", ran: true, failure: { command, diagnostic: "Git did not finish the fast-forward. Check the worktree before trying again.", output: null } }, sync: null };
	}
}

/** What the mock acts out for each sync action. Push is meant to be one more entry here. */
export const actOutSyncAction: Readonly<Record<SyncActionKind, typeof actOutPull>> = { pull: actOutPull };
