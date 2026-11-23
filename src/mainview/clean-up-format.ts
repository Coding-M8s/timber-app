import type { Repository, Worktree } from "../shared/model";
import { type PullRequestList, pullRequestOf } from "../shared/pull-requests";
import { type DonePreview, describeDoneApply } from "../shared/timber-done";
import { describeUnpublishedCommits, filesLost } from "./done-format";
import { worktreeLabel } from "./format";

/**
 * Words and rules for Clean up merged, which removes every linked worktree
 * of one repository whose pull request merged. Pure. As in the Done dialog,
 * nothing here decides what is safe to delete: Timber previews each
 * worktree, and this only sorts its answers into Ready and Skipped, so a
 * worktree with files or commits that would be lost is left for its own Done
 * dialog.
 */

export const CLEAN_UP_LABEL = "Clean up merged";

/** What the action does, as its tooltip wherever it is offered. */
export const CLEAN_UP_TITLE = "Remove the worktrees of this repository whose pull request merged, after a preview of each";

/**
 * How many worktrees one run previews at most. The main process holds 64
 * previews (`HELD_PREVIEWS` in src/bun/done.ts), and Done dialogs opened
 * while a run waits take some of them, so a run never uses more than half.
 */
export const CLEAN_UP_LIMIT = 32;

export const NO_MERGED_REASON = "No linked worktree in this repository has a merged pull request.";
export const PULL_REQUESTS_UNREAD_REASON = "The pull requests of this repository have not been read, so none is known to be merged.";
export const REPOSITORY_UNAVAILABLE_REASON = "The repository's folder is missing, so nothing in it can be removed.";
export const OVER_LIMIT_REASON = `Only ${CLEAN_UP_LIMIT} worktrees are previewed at a time. Run ${CLEAN_UP_LABEL} again once these are done.`;
export const SESSIONS_REASON = "A session runs in this worktree, and removing the worktree would end it.";
export const BEING_REMOVED_ALREADY = "Timber is removing this worktree already.";
export const LIST_OLDER_REASON = "Its branch is at another commit than the list says, so the list may not show commits that would be lost. Refresh the list and preview again.";

/** How many previews are asked for at once. Each is a process with a time limit, so a long list waits its turn. */
export const CLEAN_UP_PREVIEWS_AT_ONCE = 4;

/**
 * The linked worktrees of the repository whose pull request merged, in the
 * order of the list. The pull request has to be for the branch the worktree
 * has now, since the pull requests can be older than a branch switch. The
 * primary checkout is never one.
 */
export function mergedCandidates(repository: Repository, pullRequests: PullRequestList | undefined): Worktree[] {
	if (!repository.available) return [];
	return repository.worktrees.filter(worktree => {
		if (worktree.primary || worktree.branch === null) return false;
		const entry = pullRequestOf(pullRequests, worktree.path);
		return entry?.outcome === "found" && entry.branch === worktree.branch && entry.pullRequest.state === "merged";
	});
}

/** Why Clean up merged cannot be chosen for the repository, or null when it can. */
export function cleanUpUnavailableReason(repository: Repository, pullRequests: PullRequestList | undefined): string | null {
	if (!repository.available) return REPOSITORY_UNAVAILABLE_REASON;
	if (pullRequests === undefined || !pullRequests.ok) return PULL_REQUESTS_UNREAD_REASON;
	return mergedCandidates(repository, pullRequests).length === 0 ? NO_MERGED_REASON : null;
}

const counted = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Why the preview of a candidate makes it one to skip, or null when it is
 * Ready. Modified or untracked files skip it, and so do commits that were
 * never published or are still to be pushed. Ignored files never do: they
 * are deleted with the folder, as Done does by default.
 *
 * A deleted upstream does not skip it. That is the usual state after a pull
 * request merged and GitHub deleted its branch, and Timber's own `timber
 * done` removes such a worktree as well. Its row says what that means for
 * commits made after the merge (`describeReadyWarning`).
 *
 * What the list says about commits is checked only when the preview is for
 * the commit the list has, since Timber's removal never asks about them.
 */
export function skipReason(preview: DonePreview, worktree: Pick<Worktree, "sync" | "head">): string | null {
	const { changes } = preview.worktree;
	// What the list says about commits is only as new as the list. Timber deletes the branch without asking about them.
	if (preview.worktree.head !== worktree.head) return LIST_OLDER_REASON;
	if (changes.kind !== "known") return "Timber could not read its files, so it may hold changes.";
	if (filesLost(preview) > 0) {
		const parts = [changes.modified.length > 0 ? `${counted(changes.modified.length, "modified file")}` : "", changes.untracked.length > 0 ? `${counted(changes.untracked.length, "untracked file")}` : ""].filter(Boolean);
		return `It has ${parts.join(" and ")}, which would be deleted.`;
	}
	const { sync } = worktree;
	if (sync === null) return "Git could not say how its branch stands against its upstream.";
	if (sync.kind === "unpublished") return "Its branch was never published, so its commits would be deleted.";
	if (sync.kind === "tracking" && sync.ahead > 0) return `${counted(sync.ahead, "commit")} ${sync.ahead === 1 ? "is" : "are"} not on ${sync.upstream} as of the last fetch, and would be deleted.`;
	return null;
}

/** What a Ready row adds about commits: only for a deleted upstream, the one state that removes without asking. */
export function describeReadyWarning(preview: DonePreview, worktree: Pick<Worktree, "sync">): string | null {
	return worktree.sync?.kind === "gone" ? describeUnpublishedCommits(preview, worktree.sync) : null;
}

/** The commands Remove runs, one `apply` per Ready worktree, in the order they run. */
export function describeCleanUpCommands(paths: readonly string[]): string {
	return paths.length === 0 ? "Nothing is ready, so Remove runs nothing." : paths.map(describeDoneApply).join("\n");
}

/** The toast once a run ended. `failed` counts the worktrees that were not removed, each of which the sidebar shows. */
export function describeCleanUpEnded(repository: string, removed: number, failed: number): string {
	const total = removed + failed;
	if (failed === 0) return `Removed ${counted(removed, "merged worktree")} from ${repository}.`;
	const head = removed === 0 ? `No merged worktree was removed from ${repository}.` : `Removed ${removed} of ${counted(total, "merged worktree")} from ${repository}.`;
	return `${head} ${failed === 1 ? "1 did" : `${failed} did`} not finish: the sidebar shows what Timber said.`;
}

/**
 * The words of the header button that opens Clean up merged, for the
 * repository's `count` merged worktrees that no removal has taken yet.
 */
export function describeCleanUpButton(repository: string, count: number): string {
	return `${CLEAN_UP_LABEL}: ${counted(count, "worktree")} in ${repository} ${count === 1 ? "has a" : "have"} merged pull request${count === 1 ? "" : "s"}. Previews each before anything is removed.`;
}

/** The dialog's title. */
export function describeCleanUpTitle(repository: string): string {
	return `Clean up merged worktrees in ${repository}`;
}

/** What a Ready row says will go. Every candidate is on a branch. */
export function describeReadyEffect(worktree: Worktree): string {
	return `The folder and the local branch ${worktree.branch ?? worktreeLabel(worktree)} are removed.`;
}

/** Why a queued worktree was not removed: a session started in it after its preview. */
export const SESSION_STARTED_DIAGNOSTIC = "A session started in this worktree after its preview, so it was not removed. Nothing was run. Open Done for it to look again.";
