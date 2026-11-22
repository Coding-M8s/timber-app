import type { Worktree } from "../shared/model";
import { BEING_REMOVED_REASON, DONE_CONTROL_TITLE, DONE_PRIMARY_NOTE } from "./done-format";
import { worktreeLabel } from "./format";
import { REBASE_CONTROL_TITLE, REBASE_FOLDER_MISSING } from "./rebase-format";
import type { DialogRequest } from "./store/state";

/**
 * Words and rules for the action bar on the workspace header's title line:
 * Open in editor, then More, whose menu holds Rebase and Done. Pure, so they
 * can be tested without a window. Each entry opens a dialog that shows the
 * Timber command before anything runs.
 */

export type WorkspaceMenuItemId = "rebase" | "done";

/** One entry of the More menu. A disabled entry says why in `note`, shown under it. */
export interface WorkspaceMenuItem {
	id: WorkspaceMenuItemId;
	label: string;
	disabled: boolean;
	note: string | null;
	title: string;
}

/**
 * Rebase, off while the folder is missing or Timber removes the worktree,
 * then Done, never offered for a primary checkout nor while Timber removes it.
 */
export function workspaceMenuItems(worktree: Worktree, removing = false): WorkspaceMenuItem[] {
	const rebaseReason = removing ? BEING_REMOVED_REASON : worktree.pathExists ? null : REBASE_FOLDER_MISSING;
	const doneReason = worktree.primary ? DONE_PRIMARY_NOTE : removing ? BEING_REMOVED_REASON : null;
	return [
		{ id: "rebase", label: "Rebase…", disabled: rebaseReason !== null, note: rebaseReason, title: rebaseReason ?? REBASE_CONTROL_TITLE },
		{ id: "done", label: "Done…", disabled: doneReason !== null, note: doneReason, title: doneReason ?? DONE_CONTROL_TITLE },
	];
}

/** The dialog choosing an entry opens. Null for a disabled entry, which does nothing. */
export function workspaceMenuChoice(repository: string, worktree: Worktree, id: WorkspaceMenuItemId, removing = false): DialogRequest | null {
	const item = workspaceMenuItems(worktree, removing).find(candidate => candidate.id === id);
	if (!item || item.disabled) return null;
	return { kind: item.id === "rebase" ? "rebase-worktree" : "done-worktree", repository, worktree: worktree.id };
}

/** The More button's name, as the repository header's More is named. */
export function describeWorkspaceMore(worktree: Worktree): string {
	return `More for ${worktreeLabel(worktree)}`;
}

/** The name of the More menu, for assistive technology. */
export function describeWorkspaceMenu(worktree: Worktree): string {
	return `Actions for ${worktreeLabel(worktree)}`;
}

/**
 * Which entry a key on the More button opens the menu on: Down the first, Up
 * the last. Enter and Space press the button, which opens it on the first.
 */
export function workspaceMoreKeyOpens(key: string): "first" | "last" | null {
	if (key === "ArrowDown") return "first";
	if (key === "ArrowUp") return "last";
	return null;
}

/** The quiet label after the worktree's name: only a primary checkout has one. */
export function workspaceKindLabel(worktree: Worktree): string | null {
	return worktree.primary ? "Primary checkout" : null;
}
