import type { Worktree } from "../shared/model";
import { menuIndexAfterKey } from "./agent-format";
import { BEING_REMOVED_REASON, DONE_CONTROL_TITLE, DONE_PRIMARY_NOTE } from "./done-format";
import { worktreeLabel } from "./format";
import type { DialogRequest } from "./store/state";

/**
 * Words and rules for the menu a worktree row opens on a right-click or from
 * the keyboard. Pure, so they can be tested without a window. It holds only
 * Done for now; more entries go in `worktreeMenuItems`.
 */

/** The keys that open a focused row's menu, as `aria-keyshortcuts` says them. */
export const WORKTREE_MENU_SHORTCUTS = "Shift+F10 ContextMenu";

export type WorktreeMenuItemId = "done";

/** One entry of a row's menu. A disabled entry says why in `note`, shown under it. */
export interface WorktreeMenuItem {
	id: WorktreeMenuItemId;
	label: string;
	disabled: boolean;
	note: string | null;
	title: string;
}

/**
 * The entries of a worktree's menu. As in the workspace header, Done is never
 * offered for a primary checkout, nor while Timber removes the worktree.
 */
export function worktreeMenuItems(worktree: Pick<Worktree, "primary">, removing = false): WorktreeMenuItem[] {
	const reason = worktree.primary ? DONE_PRIMARY_NOTE : removing ? BEING_REMOVED_REASON : null;
	return [{ id: "done", label: "Done", disabled: reason !== null, note: reason, title: reason ?? DONE_CONTROL_TITLE }];
}

/** The name of a worktree's menu, for assistive technology. */
export function describeWorktreeMenu(worktree: Worktree): string {
	return `Actions for ${worktreeLabel(worktree)}`;
}

/**
 * The dialog choosing an entry opens, for the row's own worktree and never
 * the selected one. Null for a disabled entry, which does nothing.
 */
export function worktreeMenuChoice(repository: string, worktree: Worktree, id: WorktreeMenuItemId, removing = false): DialogRequest | null {
	const item = worktreeMenuItems(worktree, removing).find(candidate => candidate.id === id);
	if (!item || item.disabled) return null;
	return { kind: "done-worktree", repository, worktree: worktree.id };
}

/** Whether a key opens a focused row's menu: the context menu key, or Shift+F10. */
export function opensWorktreeMenu(event: { key: string; shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
	if (event.altKey || event.ctrlKey || event.metaKey) return false;
	return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}

/**
 * What a key does in an open menu of `count` entries with entry `index`
 * focused: move to another entry, close and give the keyboard back to the
 * row (Escape, and Tab, so Tab and Shift+Tab move on from the row), or
 * nothing the menu handles. Escape and the moves stop the browser's own use
 * of the key; Tab keeps it.
 */
export type WorktreeMenuKeyAction = { kind: "move"; index: number } | { kind: "close"; preventDefault: boolean } | null;

export function worktreeMenuKeyAction(count: number, index: number, key: string): WorktreeMenuKeyAction {
	const next = menuIndexAfterKey(count, index, key);
	if (next !== null) return { kind: "move", index: next };
	if (key === "Escape") return { kind: "close", preventDefault: true };
	if (key === "Tab") return { kind: "close", preventDefault: false };
	return null;
}

interface Size {
	width: number;
	height: number;
}

/** The space kept between a menu and the window's edges, in pixels. */
const EDGE = 4;

/**
 * Where a menu asked for at `point` goes so it stays inside the window: moved
 * left or up just enough, and never past the top left corner.
 */
export function placeMenu(point: { left: number; top: number }, menu: Size, window: Size): { left: number; top: number } {
	const left = Math.max(EDGE, Math.min(point.left, window.width - menu.width - EDGE));
	const top = Math.max(EDGE, Math.min(point.top, window.height - menu.height - EDGE));
	return { left, top };
}
