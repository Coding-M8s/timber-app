import type { Worktree } from "../shared/model";
import { BEING_REMOVED_REASON, DONE_CONTROL_TITLE, DONE_PRIMARY_NOTE } from "./done-format";
import { worktreeLabel } from "./format";
import { REBASE_CONTROL_TITLE, REBASE_FOLDER_MISSING } from "./rebase-format";
import type { DialogRequest } from "./store/state";
import { PULLING_REASON, type SyncMenuEntry } from "./sync-action-format";

/**
 * Words and rules for the action bar on the workspace header's title line:
 * Open in editor, then More, whose menu holds Rebase and Done. Pure, so they
 * can be tested without a window. Each entry opens a dialog that shows the
 * command before anything runs, except a Pull the Pull setting runs at once.
 * A primary checkout whose base is its own upstream has Pull in place of
 * Rebase (`pullInsteadOfRebase` in ./sync-action-format.ts).
 */

export type WorkspaceMenuItemId = "rebase" | "pull" | "done";

/** One entry of the More menu. A disabled entry says why in `note`, shown under it. */
export interface WorkspaceMenuItem {
	id: WorkspaceMenuItemId;
	label: string;
	disabled: boolean;
	note: string | null;
	/** What the entry does, for assistive technology, when it has no note. Menu entries have no tooltip. */
	description: string | null;
}

/**
 * Rebase, off while the folder is missing or Timber removes the worktree,
 * or `pull` in its place when given: "Pull…" when it asks first, off while
 * Timber removes the worktree or a pull without the dialog runs there. Then
 * Done, never offered for a primary checkout nor while Timber removes it.
 */
export function workspaceMenuItems(worktree: Worktree, removing = false, pull: SyncMenuEntry | null = null): WorkspaceMenuItem[] {
	const doneReason = worktree.primary ? DONE_PRIMARY_NOTE : removing ? BEING_REMOVED_REASON : null;
	const done: WorkspaceMenuItem = { id: "done", label: "Done…", disabled: doneReason !== null, note: doneReason, description: doneReason === null ? DONE_CONTROL_TITLE : null };
	if (pull !== null) {
		const pullReason = removing ? BEING_REMOVED_REASON : pull.busy ? PULLING_REASON : null;
		return [
			{ id: "pull", label: pull.opensDialog ? `${pull.label}…` : pull.label, disabled: pullReason !== null, note: pullReason, description: pullReason === null ? pull.title : null },
			done,
		];
	}
	const rebaseReason = removing ? BEING_REMOVED_REASON : worktree.pathExists ? null : REBASE_FOLDER_MISSING;
	return [
		{ id: "rebase", label: "Rebase…", disabled: rebaseReason !== null, note: rebaseReason, description: rebaseReason === null ? REBASE_CONTROL_TITLE : null },
		done,
	];
}

/**
 * The dialog choosing an entry opens, with the same `pull` the menu was drawn
 * with. Pull opens the row's Pull, which the store runs at once when the Pull
 * setting skips the dialog. Null for a disabled entry, which does nothing.
 */
export function workspaceMenuChoice(repository: string, worktree: Worktree, id: WorkspaceMenuItemId, removing = false, pull: SyncMenuEntry | null = null): DialogRequest | null {
	const item = workspaceMenuItems(worktree, removing, pull).find(candidate => candidate.id === id);
	if (!item || item.disabled) return null;
	switch (item.id) {
		case "rebase":
			return { kind: "rebase-worktree", repository, worktree: worktree.id };
		case "pull":
			return { kind: "sync-action", action: "pull", repository, worktree: worktree.id };
		case "done":
			return { kind: "done-worktree", repository, worktree: worktree.id };
	}
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
