import type { SyncState, Worktree } from "../../shared/model";
import { type SyncActionKind, type SyncActionRequest, type SyncActionResult, type SyncTarget, describeSyncStep, syncActionSteps, syncNotRun, syncTargetOf } from "../../shared/sync-actions";

/**
 * How the mock engine acts out a sync action, for the browser build and for
 * tests. Chosen with `timberMock.endSyncActions(...)`. An ending of Pull's
 * decides how pulls end from then on, one of Push's how pushes end, and
 * "failed" decides both.
 */
export const pullEndings = {
	"pulled": "The fetch works and the branch fast-forwards",
	"fetch-failed": "The fetch cannot reach the remote, and the branch fast-forwards to the last fetched commits",
	"diverged": "Git refuses: the branch has commits its upstream does not",
	"local-changes": "Git refuses: local changes would be overwritten",
	"failed": "Git does not finish",
} as const;

export const pushEndings = {
	"pushed": "Timber pushes the branch",
	"push-up-to-date": "Timber finds the remote branch already has every commit",
	"remote-moved": "Timber refuses: the remote branch has moved on",
	"offline": "Timber cannot reach the remote",
	"sign-in": "Timber stops: the remote needs a sign-in",
	"failed": "Timber leaves no result, so what it did is unknown",
} as const;

export const syncEndings = { ...pullEndings, ...pushEndings } as const;

export type SyncEnding = keyof typeof syncEndings;

export const isSyncEnding = (value: unknown): value is SyncEnding => typeof value === "string" && Object.hasOwn(syncEndings, value);

/** The actions an ending decides. */
export function actionsOfEnding(ending: SyncEnding): SyncActionKind[] {
	return [...(Object.hasOwn(pullEndings, ending) ? ["pull" as const] : []), ...(Object.hasOwn(pushEndings, ending) ? ["push" as const] : [])];
}

/** The mock's sample data names upstreams on `origin` only, so their remote and full ref follow from the short name. */
export function withSampleTarget(sync: SyncState | null): SyncState | null {
	if (sync?.kind !== "tracking" || sync.remote !== undefined || !sync.upstream.startsWith("origin/")) return sync;
	return { ...sync, remote: "origin", upstreamRef: `refs/remotes/${sync.upstream}` };
}

type Acted = { result: SyncActionResult; sync: SyncState | null };

/** The worktree's target and tracking state when they match what the request showed, or the result that ran nothing. */
function checkedTarget(worktree: Worktree, request: SyncActionRequest): { target: SyncTarget; sync: Extract<SyncState, { kind: "tracking" }> } | Acted {
	const target = syncTargetOf(worktree.sync);
	if (worktree.branch === null || target === null || worktree.sync?.kind !== "tracking") {
		return { result: syncNotRun(request.action, `The branch of ${worktree.path} has no upstream on a remote.`), sync: null };
	}
	if (target.remote !== request.target.remote || target.upstreamRef !== request.target.upstreamRef) {
		return { result: syncNotRun(request.action, `The upstream is now ${target.upstreamRef}, not the ${request.target.upstreamRef} that was shown. Look at the commands again.`), sync: null };
	}
	return { target, sync: worktree.sync };
}

/**
 * What a pull comes to for this worktree: the result, and the branch's sync
 * state afterwards, or null when it did not change. A branch that is ahead is
 * refused as diverged whatever the ending, as Git would.
 */
export function actOutPull(worktree: Worktree, request: SyncActionRequest, ending: SyncEnding, at: number): Acted {
	const checked = checkedTarget(worktree, request);
	if ("result" in checked) return checked;
	const { target, sync } = checked;
	const [, mergeStep] = syncActionSteps("pull", target, worktree.path);
	const command = describeSyncStep(mergeStep!);
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
		default:
			// An ending of Push's never decides a pull.
			return actOutPull(worktree, request, "pulled", at);
	}
}

/**
 * What a push comes to for this worktree, as `timber publish` would end. A
 * branch that is behind is refused as moved on whatever the ending, as
 * Timber would.
 */
export function actOutPush(worktree: Worktree, request: SyncActionRequest, ending: SyncEnding, _at: number): Acted {
	const checked = checkedTarget(worktree, request);
	if ("result" in checked) return checked;
	const { target, sync } = checked;
	const [step] = syncActionSteps("push", target, worktree.path);
	const command = describeSyncStep(step!);
	const branch = worktree.branch ?? "";
	const printed = (lines: string) => ({ text: `Worktree: ${worktree.path}\nBranch: ${branch}\nRemote: ${target.remote}\nUpstream: ${sync.upstream}\n${lines}`, truncated: false });
	if (ending === "remote-moved" || sync.behind > 0) {
		const diagnostic = `The remote branch ${sync.upstream} has moved on: it has commits this branch does not contain, or this branch was rewritten after it was published. Nothing was pushed and no local ref changed. Timber never force-pushes; integrate the remote commits with Git, then publish again.`;
		return { result: { outcome: "refused", action: "push", reason: "timber-refused", fetchFailure: null, failure: { command, diagnostic, output: printed(" ! [rejected] (fetch first)") } }, sync: null };
	}
	switch (ending) {
		case "push-up-to-date":
			return { result: { outcome: "done", action: "push", moved: false, fetchFailure: null }, sync: { ...sync, ahead: 0 } };
		case "offline": {
			const diagnostic = `Git push to ${sync.upstream} failed (network, remote, hook or another Git error). Nothing was forced; read Git's output above, then publish again.`;
			return { result: { outcome: "failed", action: "push", ran: true, failure: { command, diagnostic, output: printed("fatal: unable to access 'https://example.com/timber.git/': Could not resolve host: example.com") } }, sync: null };
		}
		case "sign-in": {
			const diagnostic = `The remote ${target.remote} needs a sign-in, and Timber never prompts for credentials. Sign in outside Timber (for example with a Git credential helper, an SSH agent or gh auth login), then publish again. Nothing was pushed.`;
			return { result: { outcome: "failed", action: "push", ran: true, failure: { command, diagnostic, output: printed("fatal: could not read Username for 'https://example.com': terminal prompts disabled") } }, sync: null };
		}
		case "failed":
			return { result: { outcome: "failed", action: "push", ran: true, failure: { command, diagnostic: "timber publish exited with code 1 and left no result, so what it did is unknown. The details below show what it printed.", output: null } }, sync: null };
		default:
			return { result: { outcome: "done", action: "push", moved: true, fetchFailure: null }, sync: { ...sync, ahead: 0 } };
	}
}

/** What the mock acts out for each sync action. */
export const actOutSyncAction: Readonly<Record<SyncActionKind, typeof actOutPull>> = { pull: actOutPull, push: actOutPush };
