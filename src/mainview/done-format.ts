import type { SyncState } from "../shared/model";
import { DONE_PREVIEW_MINUTES, type DonePreview } from "../shared/timber-done";

/**
 * The wording of the Done dialog. Pure. It only puts into words what Timber's
 * preview says, plus the upstream state the app already shows in the list.
 * Nothing here decides whether a worktree may be removed: Timber does.
 */

/** Said in every preview: Timber's cleanup works on local state only. */
export const DONE_REMOTE_NOTE = "Nothing on a remote is touched. Remote branches and remote-tracking refs stay as they are.";

export const DONE_EXPIRED_NOTE = `This preview expired. Timber accepts a preview for ${DONE_PREVIEW_MINUTES} minutes, so ask for a new one.`;

/** Why the Done control is not offered for a primary checkout. Timber refuses it as well. */
export const DONE_PRIMARY_NOTE = "The primary checkout is never removed.";

/** How many modified and untracked files the folder holds, all of which are deleted with it. */
export function filesLost(preview: DonePreview): number {
	const { changes } = preview.worktree;
	return changes.kind === "known" ? changes.modified.length + changes.untracked.length : 0;
}

/** What happens to the local branch. */
export function describeBranchEffect(preview: DonePreview): string {
	const { branch, head } = preview.worktree;
	if (branch === null) return `No local branch is deleted: the worktree is on a detached HEAD${head ? ` at ${head.slice(0, 7)}` : ""}.`;
	return preview.options.keepBranch ? `The local branch ${branch} is kept.` : `The local branch ${branch} is deleted.`;
}

/**
 * A sentence about commits that may exist only on the branch being deleted,
 * or null when the list gives no reason to mention them. `sync` is how the
 * branch stood against its upstream when the list was read: the preview itself
 * says nothing about commits.
 */
export function describeUnpublishedCommits(preview: DonePreview, sync: SyncState | null): string | null {
	const { branch } = preview.worktree;
	if (branch === null || preview.options.keepBranch || sync === null) return null;
	const lost = "Commits that are only on this branch are deleted with it.";
	switch (sync.kind) {
		case "unpublished":
			return `${branch} was never published. ${lost}`;
		case "gone":
			return `Its upstream ${sync.upstream} was deleted. ${lost}`;
		case "tracking":
			if (sync.ahead === 0) return null;
			return `${sync.ahead} ${sync.ahead === 1 ? "commit is" : "commits are"} not on ${sync.upstream} as of the last fetch. ${lost}`;
	}
}

/** What happens to ignored files, including the scope Timber's contract asks the app to spell out. */
export function describeIgnoredEffect(preview: DonePreview): string {
	const count = preview.ignored.length;
	if (!preview.options.discardIgnored) {
		return "No ignored files exist, so there is nothing to keep. If any appear before the removal, Timber refuses it.";
	}
	const scope = "Removing covers every ignored file in the folder, including ones that scripts run before deletion create or change.";
	if (count === 0) return `No ignored files were found. ${scope}`;
	return `${count} ignored ${count === 1 ? "path is" : "paths are"} deleted with the folder. ${scope}`;
}

/**
 * Whether the dialog asks "Delete anyway?": there are modified or untracked
 * files, or commits that may be on this branch only. This chooses the wording
 * and nothing else. Either way nothing is removed before Remove is pressed,
 * and Timber checks the worktree against the preview again.
 */
export function losesWork(preview: DonePreview, sync: SyncState | null): boolean {
	return filesLost(preview) > 0 || describeUnpublishedCommits(preview, sync) !== null;
}

/** The toast after a removal that worked. `label` is the worktree's name in the list. */
export function describeDone(label: string, preview: DonePreview): string {
	const { branch } = preview.worktree;
	return branch !== null && preview.options.keepBranch ? `Removed the worktree of ${branch} and kept the branch` : `Removed ${label}`;
}

/** The time of day a preview expires, for the line under it. */
export function describeExpiry(expiresAt: number): string {
	const time = new Date(expiresAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
	return `Timber accepts this preview until ${time}.`;
}
