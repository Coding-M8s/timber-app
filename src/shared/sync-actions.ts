import { readFetchFailure, type FetchFailure, withoutCredentials } from "./git-fetch";
import { describeCommandLine } from "./command-line";
import type { SyncState, TimberFailure } from "./model";
import { publishResultArguments } from "./timber-publish";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "./timber-result";

/**
 * Sync actions: commands that bring a worktree's branch and its upstream
 * together, started from the worktree's row. Pull fast-forwards a branch that
 * is behind; Push publishes a branch that is ahead. Each is one entry in
 * `SYNC_ACTIONS`. Pure: the interface words the commands from the same
 * functions the main process runs them from (see src/bun/sync-actions.ts), so
 * the commands shown are the commands that run.
 *
 * Pull runs Git directly: Timber has no command for it, and it never creates,
 * rebases, or removes a worktree. Push runs `timber publish`, which owns every
 * rule about what may be pushed. Neither ever asks for credentials, creates a
 * merge commit, or rewrites a branch, and Push never force-pushes.
 */

export const SYNC_ACTION_KINDS = ["pull", "push"] as const;
export type SyncActionKind = typeof SYNC_ACTION_KINDS[number];

export const isSyncActionKind = (value: unknown): value is SyncActionKind => typeof value === "string" && (SYNC_ACTION_KINDS as readonly string[]).includes(value);

/** What a sync action's commands name: the branch's remote and the upstream's full ref, as the list read them. */
export interface SyncTarget {
	/** Such as `origin`. */
	remote: string;
	/** Such as `refs/remotes/origin/feat/login`. */
	upstreamRef: string;
}

/** Run one sync action in one worktree. */
export interface SyncActionRequest {
	action: SyncActionKind;
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. Git runs there. */
	worktree: string;
	/**
	 * The remote and upstream the shown commands named. The main process reads
	 * them from Git again and runs nothing when they no longer match.
	 */
	target: SyncTarget;
}

/**
 * One command of an action: the program it runs, everything after the
 * program's name, and whether it reaches a remote. A Timber step shows
 * `RESULT_FILE_PLACEHOLDER` where the real run puts a fresh result file.
 */
export interface SyncStep {
	program: "git" | "timber";
	args: string[];
	network: boolean;
}

/**
 * Whether a remote name can be one argument of `git fetch` as it is: Git
 * would read one that starts with a dash as an option. The command stays
 * exactly `git fetch <remote>`, as shown, so such a remote is refused instead.
 */
export function isUsableRemote(remote: string): boolean {
	return remote !== "" && !remote.startsWith("-") && !/[\0\n]/.test(remote);
}

/** Whether a full ref names a remote-tracking branch of `remote`. */
export function isUpstreamRefOf(remote: string, upstreamRef: string): boolean {
	const prefix = `refs/remotes/${remote}/`;
	return upstreamRef.startsWith(prefix) && upstreamRef.length > prefix.length && !/[\0\n]/.test(upstreamRef);
}

/** The target of a sync state, or null when it does not name a remote-tracking upstream the commands can use. */
export function syncTargetOf(sync: SyncState | null): SyncTarget | null {
	if (sync?.kind !== "tracking" || sync.remote === undefined || sync.upstreamRef === undefined) return null;
	if (!isUsableRemote(sync.remote) || !isUpstreamRefOf(sync.remote, sync.upstreamRef)) return null;
	return { remote: sync.remote, upstreamRef: sync.upstreamRef };
}

/**
 * Pull: fetch the remote, then fast-forward the branch to its upstream. Online
 * this is what `git pull --ff-only` does. The merge runs even when the fetch
 * failed, on the commits of the last fetch that worked, which are the ones the
 * behind count was made from. `--no-autostash` keeps Git from putting local
 * changes away and back: when they are in the way, Git refuses and leaves them.
 */
function pullSteps(target: SyncTarget): SyncStep[] {
	return [
		{ program: "git", args: ["fetch", target.remote], network: true },
		{ program: "git", args: ["merge", "--ff-only", "--no-autostash", target.upstreamRef], network: false },
	];
}

/** Pull is offered only to a branch that is behind and not ahead, whose upstream was not rewritten. */
function pullApplies(sync: SyncState | null): boolean {
	return sync?.kind === "tracking" && sync.behind > 0 && sync.ahead === 0 && sync.forcePushed === undefined && syncTargetOf(sync) !== null;
}

/**
 * Push: `timber publish` for the worktree's registered path. Timber pushes the
 * branch under its own name to its upstream, never forces, never prompts, and
 * refuses a remote branch that has moved on.
 */
function pushSteps(_target: SyncTarget, worktree: string): SyncStep[] {
	return [{ program: "timber", args: publishResultArguments(worktree, RESULT_FILE_PLACEHOLDER), network: true }];
}

/**
 * Push is offered only to a branch that is ahead and not behind, whose
 * upstream was not rewritten: one that is behind or diverged would be refused,
 * and one whose upstream was force-pushed needs a look first.
 */
function pushApplies(sync: SyncState | null): boolean {
	return sync?.kind === "tracking" && sync.ahead > 0 && sync.behind === 0 && sync.forcePushed === undefined && syncTargetOf(sync) !== null;
}

/** What each sync action runs, for a target and the worktree's registered path, and when it is offered. Each has a runner in the main process. */
export interface SyncActionSpec {
	steps(target: SyncTarget, worktree: string): SyncStep[];
	applies(sync: SyncState | null): boolean;
}

export const SYNC_ACTIONS: Readonly<Record<SyncActionKind, SyncActionSpec>> = {
	pull: { steps: pullSteps, applies: pullApplies },
	push: { steps: pushSteps, applies: pushApplies },
};

/** The steps of an action for a target, in the worktree at this registered path. */
export function syncActionSteps(action: SyncActionKind, target: SyncTarget, worktree: string): SyncStep[] {
	return SYNC_ACTIONS[action].steps(target, worktree);
}

/** Whether an action is offered for a branch in this sync state. */
export function syncActionApplies(action: SyncActionKind, sync: SyncState | null): boolean {
	return SYNC_ACTIONS[action].applies(sync);
}

/** The actions offered for a branch in this sync state, in the order of `SYNC_ACTION_KINDS`. */
export function applicableSyncActions(sync: SyncState | null): SyncActionKind[] {
	return SYNC_ACTION_KINDS.filter(action => syncActionApplies(action, sync));
}

/** One step as a command line, for showing before it runs. */
export function describeSyncStep(step: SyncStep): string {
	return step.program === "timber" ? describeTimberCommand(step.args) : describeCommandLine(["git", ...step.args]);
}

/**
 * Why an action was refused before it changed anything:
 * - `diverged`: Git refused a fast-forward because the branch has commits its
 *   upstream does not. Rebase is the way on.
 * - `local-changes`: Git refused a fast-forward because changed or untracked
 *   files would be overwritten.
 * - `timber-refused`: Timber refused a push, such as one to a remote branch
 *   that moved on. Its diagnostic says why.
 */
export type SyncRefusal = "diverged" | "local-changes" | "timber-refused";

/** How one sync action ended. */
export type SyncActionResult =
	/**
	 * The last command worked. `moved` is false when the branch already had
	 * every commit of its upstream. `fetchFailure` is set when the fetch did
	 * not work and the branch moved to the commits of the last fetch instead.
	 */
	| { outcome: "done"; action: SyncActionKind; moved: boolean; fetchFailure: FetchFailure | null }
	/** Git or Timber refused for a reason it checks before changing anything, so nothing changed. `failure` holds what it said. */
	| { outcome: "refused"; action: SyncActionKind; reason: SyncRefusal; fetchFailure: FetchFailure | null; failure: TimberFailure }
	/**
	 * It failed. `ran` is false only when the app refused before it ran
	 * anything. One that ran, for a reason Git does not check first, can have
	 * changed files: `failure` says to check the worktree.
	 */
	| { outcome: "failed"; action: SyncActionKind; ran: boolean; failure: TimberFailure };

/** What one Git run ended with, as the main process saw it. `exitCode` is null when Git could not start or was stopped. */
export interface SyncStepRun {
	exitCode: number | null;
	stdout: string;
	stderr: string;
}

/** Read why Git refused a fast-forward from what it printed, or null when it is not one Git checks before changing anything. */
export function readSyncRefusal(stderr: string): SyncRefusal | null {
	if (/not possible to fast-forward/i.test(stderr) || /diverging branches can't be fast-forwarded/i.test(stderr)) return "diverged";
	if (/would be overwritten by (?:merge|checkout)/i.test(stderr) || /untracked working tree files would be/i.test(stderr)) return "local-changes";
	return null;
}

/** A refusal from before anything ran. Nothing was changed. */
export function syncNotRun(action: SyncActionKind, diagnostic: string): SyncActionResult {
	return { outcome: "failed", action, ran: false, failure: { command: null, diagnostic: `${diagnostic} Nothing was run.`, output: null } };
}

function outputOf(run: SyncStepRun): { text: string; truncated: boolean } | null {
	const text = withoutCredentials([run.stdout, run.stderr].filter(part => part.trim() !== "").join("\n")).trim();
	return text === "" ? null : { text, truncated: false };
}

/**
 * Read a pull from its two runs. `fetch` is the run of the first step and
 * `merge` of the second; `moved` says whether the branch's commit changed. `at`
 * dates a failed fetch.
 */
export function readPullRuns(target: SyncTarget, runs: { fetch: SyncStepRun; merge: SyncStepRun; moved: boolean }, at: number): SyncActionResult {
	const [fetchStep, mergeStep] = pullSteps(target) as [SyncStep, SyncStep];
	const fetchFailure = runs.fetch.exitCode === 0 ? null : readFetchFailure(runs.fetch.stderr, at);
	const { merge } = runs;
	const command = describeSyncStep(mergeStep);
	if (merge.exitCode === 0) return { outcome: "done", action: "pull", moved: runs.moved, fetchFailure };
	const output = outputOf(merge);
	if (merge.exitCode === null) {
		return { outcome: "failed", action: "pull", ran: true, failure: { command, diagnostic: "Git did not finish the fast-forward. Check the worktree before trying again.", output } };
	}
	const reason = readSyncRefusal(merge.stderr);
	const said = output?.text.split("\n").map(line => line.trim()).find(line => /^(?:fatal|error):/i.test(line));
	if (reason !== null) return { outcome: "refused", action: "pull", reason, fetchFailure, failure: { command, diagnostic: said ?? `${command} was refused.`, output } };
	// Git may have stopped partway through updating files: nothing here can promise that nothing changed.
	const stopped = said ?? `${describeSyncStep(fetchStep)} then ${command} stopped with exit code ${merge.exitCode}.`;
	const sentence = /[.!?]$/.test(stopped) ? stopped : `${stopped}.`;
	return { outcome: "failed", action: "pull", ran: true, failure: { command, diagnostic: `${sentence} Check the worktree before trying again.`, output } };
}
