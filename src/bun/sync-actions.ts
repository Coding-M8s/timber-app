import { messageOf } from "../shared/error-message";
import type { Worktree } from "../shared/model";
import {
	type SyncActionKind, type SyncActionRequest, type SyncActionResult, type SyncStepRun, type SyncTarget, isSyncActionKind, readPullRuns, syncActionSteps, syncNotRun,
	syncTargetOf,
} from "../shared/sync-actions";
import { FETCH_MILLISECONDS, type GitRun, type RunGit } from "./fetch-git";
import { type FindRepository, findListedWorktree } from "./listed-worktree";
import type { RepositoryTurns } from "./repository-turns";

export interface SyncActionsOptions {
	/** The repository in the app's list read again, for the worktrees Timber lists and how their branches stand right now. */
	findRepository: FindRepository;
	/** The turns shared with every command that changes a repository, so a pull never runs beside a rebase. */
	turns: RepositoryTurns;
	/** Runs Git with nothing that can prompt (see ./fetch-git.ts). */
	runGit: RunGit;
	/**
	 * Runs a step that reaches a remote as one fetch of the repository, in the
	 * fetcher's turn (`Fetcher.fetchWith`). Null when the repository is not in
	 * the fetcher's list, and nothing ran.
	 */
	fetch: (repository: string, args: readonly string[], cwd: string) => Promise<GitRun | null>;
	now?: () => number;
}

/**
 * Sync actions, such as Pull, for a worktree Timber lists (see
 * ../shared/sync-actions.ts). Git runs as an executable plus arguments, in
 * the worktree's folder, with nothing that can prompt, in the same turn as
 * every other command that changes the repository. What Git printed is
 * private: it goes back in the result and is never logged here.
 */
export interface SyncActions {
	run(request: SyncActionRequest): Promise<SyncActionResult>;
}

/** What one action's runner is given: the worktree as listed now and the target the shown commands named, checked to match. */
interface ActionRun {
	repository: string;
	worktree: Worktree;
	target: SyncTarget;
}

const asStepRun = (answer: GitRun): SyncStepRun => ({ exitCode: answer.timedOut ? null : answer.exitCode, stdout: answer.stdout, stderr: answer.stderr });

export function createSyncActions(options: SyncActionsOptions): SyncActions {
	const { findRepository, turns, runGit, fetch, now = Date.now } = options;

	async function head(folder: string): Promise<string | null> {
		const answer = await runGit(["rev-parse", "--verify", "--quiet", "HEAD"], { network: false, cwd: folder });
		return answer.exitCode === 0 ? answer.stdout.trim() : null;
	}

	/** Fetch, then fast-forward, even when the fetch failed (see `pullSteps`). */
	async function pull({ repository, worktree, target }: ActionRun): Promise<SyncActionResult> {
		const [fetchStep, mergeStep] = syncActionSteps("pull", target);
		if (!fetchStep || !mergeStep) return syncNotRun("pull", "Pull has no commands.");
		const fetched = await fetch(repository, fetchStep.args, worktree.path);
		if (fetched === null) return syncNotRun("pull", `${repository} is not a repository in this app's list.`);
		const before = await head(worktree.path);
		// A fast-forward updates files and runs hooks: it gets as long as a fetch, not a quick read's limit.
		const merged = await runGit(mergeStep.args, { network: false, cwd: worktree.path, limitMilliseconds: FETCH_MILLISECONDS });
		const after = await head(worktree.path);
		return readPullRuns(target, { fetch: asStepRun(fetched), merge: asStepRun(merged), moved: before !== after }, now());
	}

	/** Each action's runner. Push is meant to be one more entry here. */
	const runners: Record<SyncActionKind, (run: ActionRun) => Promise<SyncActionResult>> = { pull };

	async function run(request: SyncActionRequest): Promise<SyncActionResult> {
		const { action, repository, worktree, target } = (request ?? {}) as Partial<SyncActionRequest>;
		// Only text becomes an argument: the request comes over the bridge.
		if (!isSyncActionKind(action)) return syncNotRun("pull", "The request names no sync action this app knows.");
		if (typeof repository !== "string" || typeof worktree !== "string" || typeof target?.remote !== "string" || typeof target.upstreamRef !== "string") {
			return syncNotRun(action, "The request for a sync action is not complete.");
		}
		return turns.inTurn(repository, async (): Promise<SyncActionResult> => {
			try {
				const found = await findListedWorktree(findRepository, repository, worktree, "Nothing was run.");
				if (!found.ok) return { outcome: "failed", action, ran: false, failure: { command: null, diagnostic: found.message, output: null } };
				const listed = found.worktree;
				if (listed.branch === null) return syncNotRun(action, `${worktree} is not on a branch.`);
				const current = syncTargetOf(listed.sync);
				if (current === null) return syncNotRun(action, `The branch ${listed.branch} has no upstream on a remote.`);
				// The commands shown are the commands that run. When the upstream changed since, the person has not seen these.
				if (current.remote !== target.remote || current.upstreamRef !== target.upstreamRef) {
					return syncNotRun(action, `The upstream of ${listed.branch} is now ${current.upstreamRef}, not the ${target.upstreamRef} that was shown. Look at the commands again.`);
				}
				return await runners[action]({ repository, worktree: listed, target: current });
			} catch (error) {
				return { outcome: "failed", action, ran: true, failure: { command: null, diagnostic: `The sync action stopped: ${messageOf(error)}. Check the worktree before trying again.`, output: null } };
			}
		});
	}

	return { run };
}
