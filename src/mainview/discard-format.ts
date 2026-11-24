/**
 * The words of Discard in the Changes view and of the dialog that asks
 * before it runs. Pure, so they are tested without a window.
 */

import type { ChangeArea, FileChangeTarget } from "../shared/file-changes";

/** Discard deletes an untracked file and puts any other back, so it says so. */
const deletes = (area: ChangeArea) => area === "untracked";

/** On a file's button, in every group that has it. The dialog says when it deletes. */
export const DISCARD_LABEL = "Discard";

/** The key on a file of the list that asks to discard it, as its Discard does, and its name for `aria-keyshortcuts`. */
export const DISCARD_KEY = "Delete";
export const DISCARD_KEY_NAME = "Delete";

/** On a group's button. */
export const DISCARD_ALL_LABEL = "Discard all";

/** On the dialog's button that runs it: Delete for untracked files, Discard for others. */
export const discardSubmitLabel = (area: ChangeArea) => (deletes(area) ? "Delete" : "Discard");

/** The dialog's title, naming the file when there is one. */
export function describeDiscardTitle(files: readonly FileChangeTarget[]): string {
	const area = files[0]?.area ?? "unstaged";
	const one = files.length === 1 ? files[0]!.path : null;
	if (deletes(area)) return one === null ? `Delete ${files.length} untracked files?` : `Delete ${one}?`;
	const which = area === "staged" ? "staged " : "";
	return one === null ? `Discard ${which}changes to ${files.length} files?` : `Discard ${which}changes to ${one}?`;
}

/** What the discard does to each file, ending with the fact that it cannot be undone. */
export function describeDiscardEffect(area: ChangeArea, count: number): string {
	const each = count === 1 ? "The file" : "Each file";
	switch (area) {
		case "unstaged":
			return `${each} goes back to what is staged for it, or to the last commit when nothing is. Staged changes stay. This cannot be undone.`;
		case "staged":
			return `${each} goes back to the last commit, both staged and on disk. A file the last commit does not have is deleted. This cannot be undone.`;
		default:
			return `${count === 1 ? "The file is" : "The files are"} deleted from disk. ${count === 1 ? "Its folder stays" : "Their folders stay"}, as do other untracked and ignored files. This cannot be undone.`;
	}
}

/** Said when staged files also have unstaged changes, which go too. */
export function describeAlsoUnstaged(paths: readonly string[]): string | null {
	if (paths.length === 0) return null;
	if (paths.length === 1) return `${paths[0]} also has unstaged changes. They are lost too.`;
	return `These also have unstaged changes, which are lost too: ${paths.join(", ")}.`;
}

/** Said when the file open in the editor has unsaved edits the discard would drop. */
export const describeUnsavedDiscard = (path: string) => `${path} is open in the editor with unsaved edits. They are lost too, and the editor shows the file as it is on disk afterwards.`;

/** Said when the list no longer has the files as the dialog showed them. */
export const DISCARD_LIST_CHANGED = "The list of changes is not what it was when this dialog opened. Nothing was run. Close, then choose again.";

/** The toast once it worked. */
export function describeDiscarded(files: readonly FileChangeTarget[]): string {
	const area = files[0]?.area ?? "unstaged";
	const what = files.length === 1 ? files[0]!.path : `${files.length} files`;
	return deletes(area) ? `Deleted ${what}` : `Discarded changes to ${what}`;
}

/** Above Git's message when it failed. */
export const discardFailureTitle = (area: ChangeArea) => (deletes(area) ? "Could not delete" : "Could not discard");

/** Beside the progress bar while it runs. */
export const discardRunningLabel = (area: ChangeArea) => (deletes(area) ? "Deleting files" : "Discarding changes");
