/**
 * The words and state of the Changes view's commit box. Pure, so they can be
 * tested without a window. The rules themselves are shared with the main
 * process (../shared/commit-staged.ts).
 */

import { COMMIT_COMMAND_LINE, type CommitState } from "../shared/commit-staged";
import type { FileChange } from "../shared/file-changes";
import type { ChangesView } from "./store/state";

export const COMMIT_MESSAGE_LABEL = "Commit message";
export const COMMIT_MESSAGE_PLACEHOLDER = "Commit message";
export const COMMIT_BUTTON = "Commit";
/** Base's button, which switches to Uncommitted with the message box focused. */
export const COMMIT_FROM_BASE_BUTTON = "Commit…";
export const COMMIT_FROM_BASE_TITLE = "Commit what is staged: switches to Uncommitted, where the message box is";
export const COMMIT_FAILED = "Could not commit";

/** The button's tooltip: the command it runs, and the key that runs it too. */
export function describeCommitButton(mac: boolean): string {
	return `Runs ${COMMIT_COMMAND_LINE} (${mac ? "Cmd" : "Ctrl"}+Enter in the message box)`;
}

/** Said while a commit runs, with the command, as hooks may take a while. */
export const COMMITTING = `Committing: ${COMMIT_COMMAND_LINE}. Hooks may take a while.`;

/** Said once a commit was made. */
export const describeCommitted = (short: string) => `Committed ${short}`;

/** Ctrl+Enter, or Cmd+Enter on macOS, commits from the box. Either modifier counts, as for the app's other shortcuts. */
export function isCommitKey(event: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): boolean {
	return event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey;
}

/**
 * What decides whether Commit may run, from the list on screen. When more
 * files changed than are listed and none listed is staged, one may be among
 * the rest: Commit is offered, and the main process says if nothing is.
 */
export function commitStateOf(view: Pick<ChangesView, "operation" | "detached" | "more"> & { files: readonly FileChange[] }, message: string): CommitState {
	const staged = view.files.filter(file => file.area === "staged").length;
	return { staged: staged === 0 && view.more ? 1 : staged, operation: view.operation, detached: view.detached, message };
}
