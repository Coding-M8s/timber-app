import { messageOf } from "../shared/error-message";
import type { TimberStatus, Worktree } from "../shared/model";
import {
	type ActionTarget, type SyncActionKind, type SyncActionRequest, type SyncActionResult, type SyncStepRun, NO_UPSTREAM, isNoUpstream, isPublishable, isSyncActionKind,
	readPullRuns, syncActionSteps, syncNotRun, syncTargetOf,
} from "../shared/sync-actions";
import { publishResultArguments, readPublishResult } from "../shared/timber-publish";
import { FETCH_MILLISECONDS, type GitRun, type RunGit } from "./fetch-git";
import { type FindRepository, findListedWorktree } from "./listed-worktree";
import type { RepositoryTurns } from "./repository-turns";
import { describeTimberStatus } from "./timber";
import { runTimberWithResultFile } from "./timber-run";

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
	/**
	 * Runs a task that writes remote-tracking refs, such as Push, in the
	 * fetcher's turn (`Fetcher.whileNotFetching`), so it never runs beside a
	 * fetch. Null when the repository is not in the fetcher's list, and the
	 * task did not run.
	 */
	whileNotFetching: <Result>(repository: string, task: () => Promise<Result>) => Promise<Result | null>;
	/** Where Timber is, as of the last look (see ./timber.ts). Push runs `timber publish`. */
	timber: () => Promise<TimberStatus>;
	environment?: Record<string, string | undefined>;
	/** Where the private folder for Timber's result file is made. The system's temporary folder by default. */
	temporaryRoot?: string;
	now?: () => number;
}

/**
 * Sync actions, Pull and Push, for a worktree Timber lists (see
 * ../shared/sync-actions.ts). Git and Timber run as an executable plus
 * arguments with nothing that can prompt, in the same turn as every other
 * command that changes the repository. Pull's Git runs in the worktree's
 * folder; Push's `timber publish` runs in the primary checkout, as every
 * Timber command does. What either printed is private: it goes back in the
 * result and is never logged here.
 */
export interface SyncActions {
	run(request: SyncActionRequest): Promise<SyncActionResult>;
}

/** What one action's runner is given: the worktree as listed now and the target the shown commands named, checked to match. */
interface ActionRun {
	repository: string;
	worktree: Worktree;
	target: ActionTarget;
}

/** Whether a target from the bridge is one of the two shapes a request can name, so only text becomes an argument. */
function isActionTarget(target: unknown): target is ActionTarget {
	if (typeof target !== "object" || target === null) return false;
	const fields = target as Record<string, unknown>;
	if (fields.kind === "no-upstream") return Object.keys(fields).length === 1;
	return fields.kind === undefined && typeof fields.remote === "string" && typeof fields.upstreamRef === "string";
}

/**
 * Why the branch as listed now does not match the target the shown commands
 * named, or null when it does. A Push with no upstream yet needs a branch that
 * is still unpublished: one that gained an upstream since would be pushed
 * there, which the person did not see.
 */
function targetMismatch(listed: Worktree & { branch: string }, target: ActionTarget): string | null {
	const current = syncTargetOf(listed.sync);
	if (isNoUpstream(target)) {
		const { sync } = listed;
		if (sync === null) return `Git could not say how the branch ${listed.branch} stands against a remote now.`;
		if (sync.kind === "unpublished") {
			if (isPublishable(sync)) return null;
			return sync.unpushed === undefined
				? `Git could not count the commits of ${listed.branch} that no remote has.`
				: `The branch ${listed.branch} has no commits that a remote does not have.`;
		}
		const now = current === null ? `now has the upstream ${sync.upstream}` : `now has the upstream ${current.upstreamRef}`;
		return `The branch ${listed.branch} ${now}, and had none when the command was shown. Look at the command again.`;
	}
	if (current === null) return `The branch ${listed.branch} has no upstream on a remote.`;
	if (current.remote !== target.remote || current.upstreamRef !== target.upstreamRef) {
		return `The upstream of ${listed.branch} is now ${current.upstreamRef}, not the ${target.upstreamRef} that was shown. Look at the commands again.`;
	}
	return null;
}

const asStepRun = (answer: GitRun): SyncStepRun => ({ exitCode: answer.timedOut ? null : answer.exitCode, stdout: answer.stdout, stderr: answer.stderr });

export function createSyncActions(options: SyncActionsOptions): SyncActions {
	const { findRepository, turns, runGit, fetch, whileNotFetching, timber, environment, temporaryRoot, now = Date.now } = options;

	async function head(folder: string): Promise<string | null> {
		const answer = await runGit(["rev-parse", "--verify", "--quiet", "HEAD"], { network: false, cwd: folder });
		return answer.exitCode === 0 ? answer.stdout.trim() : null;
	}

	/** Fetch, then fast-forward, even when the fetch failed (see `pullSteps`). */
	async function pull({ repository, worktree, target }: ActionRun): Promise<SyncActionResult> {
		if (isNoUpstream(target)) return syncNotRun("pull", "Pull needs an upstream to pull from.");
		const [fetchStep, mergeStep] = syncActionSteps("pull", target, worktree.path);
		if (!fetchStep || !mergeStep) return syncNotRun("pull", "Pull has no commands.");
		const fetched = await fetch(repository, fetchStep.args, worktree.path);
		if (fetched === null) return syncNotRun("pull", `${repository} is not a repository in this app's list.`);
		const before = await head(worktree.path);
		// A fast-forward updates files and runs hooks: it gets as long as a fetch, not a quick read's limit.
		const merged = await runGit(mergeStep.args, { network: false, cwd: worktree.path, limitMilliseconds: FETCH_MILLISECONDS });
		const after = await head(worktree.path);
		return readPullRuns(target, { fetch: asStepRun(fetched), merge: asStepRun(merged), moved: before !== after }, now());
	}

	/**
	 * `timber publish` for the worktree, while no fetch of the repository runs,
	 * since the push moves the upstream's remote-tracking ref too. Timber
	 * decides what may be pushed: nothing here checks the branch or the remote.
	 */
	async function push({ repository, worktree }: ActionRun): Promise<SyncActionResult> {
		const status = await timber();
		if (status.state !== "ready") return syncNotRun("push", `${describeTimberStatus(status)}.`);
		const run = await whileNotFetching(repository, () => runTimberWithResultFile({
			executable: status.path,
			command: "publish",
			arguments: resultFile => publishResultArguments(worktree.path, resultFile),
			folder: repository,
			...(environment ? { environment } : {}),
			...(temporaryRoot === undefined ? {} : { temporaryRoot }),
		}));
		if (run === null) return syncNotRun("push", `${repository} is not a repository in this app's list.`);
		return readPublishResult(run, worktree.path);
	}

	/** Each action's runner. */
	const runners: Record<SyncActionKind, (run: ActionRun) => Promise<SyncActionResult>> = { pull, push };

	async function run(request: SyncActionRequest): Promise<SyncActionResult> {
		const { action, repository, worktree, target } = (request ?? {}) as Partial<SyncActionRequest>;
		// Only text becomes an argument: the request comes over the bridge.
		if (!isSyncActionKind(action)) return syncNotRun("pull", "The request names no sync action this app knows.");
		if (typeof repository !== "string" || typeof worktree !== "string" || !isActionTarget(target)) {
			return syncNotRun(action, "The request for a sync action is not complete.");
		}
		if (action === "pull" && isNoUpstream(target)) return syncNotRun(action, "Pull needs an upstream to pull from.");
		return turns.inTurn(repository, async (): Promise<SyncActionResult> => {
			try {
				const found = await findListedWorktree(findRepository, repository, worktree, "Nothing was run.");
				if (!found.ok) return { outcome: "failed", action, ran: false, failure: { command: null, diagnostic: found.message, output: null } };
				const listed = found.worktree;
				if (listed.branch === null) return syncNotRun(action, `${worktree} is not on a branch.`);
				// The commands shown are the commands that run. When the upstream changed since, the person has not seen these.
				const mismatch = targetMismatch({ ...listed, branch: listed.branch }, target);
				if (mismatch !== null) return syncNotRun(action, mismatch);
				// The target as Git reads it now, which matched, not the request's object as it came over the bridge.
				return await runners[action]({ repository, worktree: listed, target: isNoUpstream(target) ? NO_UPSTREAM : syncTargetOf(listed.sync)! });
			} catch (error) {
				return { outcome: "failed", action, ran: true, failure: { command: null, diagnostic: `The sync action stopped: ${messageOf(error)}. Check the worktree before trying again.`, output: null } };
			}
		});
	}

	return { run };
}
