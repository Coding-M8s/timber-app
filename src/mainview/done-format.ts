import type { SyncState } from "../shared/model";
import { DONE_PREVIEW_MINUTES, type DonePreview } from "../shared/timber-done";

/**
 * The wording of the Done dialog. Pure. It only puts into words what Timber's
 * preview says, plus the upstream state the app already shows in the list.
 * Nothing here decides whether a worktree may be removed: Timber does.
 *
 * One name for the action: "Done" is the entry that opens the dialog, in the
 * command palette and both menus, and "Remove" is its verb everywhere after
 * that: the title, the button, progress, toasts, and tooltips. "Delete" is
 * only said of what stops existing with the folder: its files and its branch.
 */

/** Said in every preview: Timber's cleanup works on local state only. */
export const DONE_REMOTE_NOTE = "Nothing on a remote is touched. Remote branches and remote-tracking refs stay as they are.";

export const DONE_EXPIRED_NOTE = `This preview expired. Timber accepts a preview for ${DONE_PREVIEW_MINUTES} minutes, so ask for a new one.`;

/** Why the Done control is not offered for a primary checkout. Timber refuses it as well. */
export const DONE_PRIMARY_NOTE = "The primary checkout is never removed.";

/** What the Done control does, as its tooltip, wherever it is offered. */
export const DONE_CONTROL_TITLE = "Remove this worktree, after a preview of what would be lost";

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
		return "No ignored files exist. If any appear before the removal, Timber stops and removes nothing.";
	}
	const scope = "Removing covers every ignored file in the folder, including ones that scripts run before the removal create or change.";
	if (count === 0) return `No ignored files were found. ${scope}`;
	return `${count} ignored ${count === 1 ? "path is" : "paths are"} deleted with the folder. ${scope}`;
}

/** The label of the option that makes Timber refuse while ignored files exist (`--keep-ignored`), rather than delete them. */
export const KEEP_IGNORED_LABEL = "Stop if there are ignored files (don't delete them)";

/** The plain sentence the dialog leads with, before the exact folder. */
export const DONE_LEAD = "Removes this worktree's folder from this computer.";

/** The label over the exact Timber commands, which the dialog shows before they run. */
export const DONE_COMMAND_LABEL = "Timber command";

/** The label over the preview command, which runs when the dialog opens, when an option changes, and on Preview again. */
export const DONE_PREVIEW_COMMAND_LABEL = "Timber command for the preview";

/** The dialog's title and the label of the button that keeps the worktree. */
export interface DoneHeading {
	title: string;
	cancelLabel: string;
}

/**
 * The title says what is at risk, from the preview on screen and the
 * upstream state the list has. Modified or untracked files make it "Delete
 * anyway?", with Keep. Without them, commits that may be only on the branch
 * being deleted name the branch and why, with Cancel: the same commits the
 * body's sentence is about (`describeUnpublishedCommits`). Otherwise, and
 * while there is no preview to go by, it is "Remove <label>?". This chooses
 * the words and nothing else: nothing is removed before Remove is pressed,
 * and Timber checks the worktree against the preview again.
 */
export function describeDoneHeading(label: string, preview: DonePreview | null, sync: SyncState | null, gone = false): DoneHeading {
	if (gone) return { title: `${label} is no longer in the list`, cancelLabel: "Close" };
	if (preview === null) return { title: `Remove ${label}?`, cancelLabel: "Cancel" };
	if (filesLost(preview) > 0) return { title: "Delete anyway?", cancelLabel: "Keep" };
	const { branch } = preview.worktree;
	if (branch !== null && sync !== null && describeUnpublishedCommits(preview, sync) !== null) {
		switch (sync.kind) {
			case "unpublished":
				return { title: `${branch} was never published`, cancelLabel: "Cancel" };
			case "gone":
				return { title: `The upstream of ${branch} was deleted`, cancelLabel: "Cancel" };
			case "tracking":
				return { title: `${branch} has ${sync.ahead} ${sync.ahead === 1 ? "commit" : "commits"} not on ${sync.upstream}`, cancelLabel: "Cancel" };
		}
	}
	return { title: `Remove ${label}?`, cancelLabel: "Cancel" };
}

/** The toast after a removal that worked. `label` is the worktree's name in the list. */
export function describeDone(label: string, preview: DonePreview): string {
	const { branch } = preview.worktree;
	return branch !== null && preview.options.keepBranch ? `Removed the worktree of ${branch} and kept the branch` : `Removed ${label}`;
}

/** Why a worktree's actions are off while Timber removes it. */
export const BEING_REMOVED_REASON = "Timber is removing this worktree.";

/**
 * The toast after a removal that ran in the background and failed. It only
 * points at the failure: the details stay in the sidebar, unless the
 * repository left the list meanwhile.
 */
export function describeRemovalFailed(label: string, kept: boolean): string {
	return kept ? `Timber did not finish removing ${label}. The sidebar shows what it said.` : `Timber did not finish removing ${label}.`;
}
