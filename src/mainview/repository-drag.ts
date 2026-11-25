/**
 * Dragging a repository header to move its section, or a group header to move
 * the group. Pure, so it can be tested without a window.
 */

/** How far, in pixels, the pointer moves before a press on a header becomes a drag instead of a click. */
export const DRAG_THRESHOLD = 4;

/** The keys that move a focused repository header one place, as `aria-keyshortcuts` names them. */
export const MOVE_REPOSITORY_SHORTCUTS = "Alt+ArrowUp Alt+ArrowDown";

/** The sentence a repository header's tooltip ends with. */
export const MOVE_REPOSITORY_HINT = "Drag to reorder, or press Alt+Up or Alt+Down.";

/** A group header row drawn, top to bottom as shown, while a group is dragged. `expanded` is whether anything shows under it. */
export interface GroupDropSlot {
	id: string;
	top: number;
	bottom: number;
	expanded: boolean;
}

/** Where a dragged group would land, by the header it is over: before it, inside it, after it, or at the end of the top level. */
export type GroupDropPlace = { kind: "before" | "into" | "after"; id: string } | { kind: "end" };

/**
 * Where a dragged group would land for a pointer at `y`. Over the top quarter
 * of a header, or above it and below the header before, it lands before that
 * group, beside it. Over the middle of a header it goes inside that group,
 * at the end of its subgroups. Over the bottom quarter it lands after the
 * group, beside it, when nothing shows under that header; otherwise that is
 * inside it too. Below every header it lands at the end of the top level.
 */
export function groupDropPlace(slots: readonly GroupDropSlot[], y: number): GroupDropPlace {
	for (const slot of slots) {
		const quarter = (slot.bottom - slot.top) / 4;
		if (y < slot.top + quarter) return { kind: "before", id: slot.id };
		if (y <= slot.bottom - quarter) return { kind: "into", id: slot.id };
		if (y <= slot.bottom) return { kind: slot.expanded ? "into" : "after", id: slot.id };
	}
	return { kind: "end" };
}

/**
 * How many places a key press moves a focused repository header: -1 for
 * Alt+Up, 1 for Alt+Down, and 0 for any other key.
 */
export function moveStep(key: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): -1 | 0 | 1 {
	if (!key.altKey || key.ctrlKey || key.metaKey || key.shiftKey) return 0;
	if (key.key === "ArrowUp") return -1;
	if (key.key === "ArrowDown") return 1;
	return 0;
}

/** One thing the pointer can be over while a repository is dragged, top to bottom as shown. */
export type DropSlot =
	/** A repository's section, with its vertical middle. */
	| { kind: "repository"; path: string; group: string | null; middle: number }
	/** A group's header row, from its top to its bottom. */
	| { kind: "group"; id: string; top: number; bottom: number; open: boolean };

/**
 * Where a dragged repository would land for a pointer at `y`: its destination
 * and the sibling it goes before (null for the end). `slots` never include
 * the dragged repository. Above the middle of a repository lands before it;
 * over a group's header lands at the end of that group, as does anywhere
 * below it until the next slot; above the first group and below the loose
 * repositories lands at the end of the loose ones.
 */
export function dropPlace(slots: readonly DropSlot[], y: number): { group: string | null; before: string | null } {
	// The destination the pointer is in while it is between slots: loose until the first group header.
	let group: string | null = null;
	for (const slot of slots) {
		if (slot.kind === "repository") {
			if (y < slot.middle) return { group: slot.group, before: slot.path };
			continue;
		}
		if (y < slot.top) return { group, before: null };
		if (y <= slot.bottom) return { group: slot.id, before: null };
		group = slot.id;
	}
	return { group, before: null };
}

/** The keys that move a focused worktree row one place, as `aria-keyshortcuts` names them. */
export const MOVE_WORKTREE_SHORTCUTS = MOVE_REPOSITORY_SHORTCUTS;

/** The sentence a worktree row's tooltip ends with while it can be moved. */
export const MOVE_WORKTREE_HINT = MOVE_REPOSITORY_HINT;

/**
 * Whether the worktree rows of a repository can be moved: nothing is typed
 * in the filter, and at least two rows share the list they move in.
 */
export function canMoveWorktrees(rowCount: number, query: string): boolean {
	return query === "" && rowCount >= 2;
}

/** A worktree row drawn, with the vertical middle of the row and its second line together. */
export interface WorktreeSlot {
	path: string;
	middle: number;
}

/**
 * Where a dragged worktree would land for a pointer at `y`: the path of the
 * row it goes before, or null for the end. `slots` are the rows of its own
 * repository's list, top to bottom, without the dragged row, so a place can
 * never fall outside that list: above the first row is before the first,
 * below the last is the end.
 */
export function worktreeDropPlace(slots: readonly WorktreeSlot[], y: number): string | null {
	for (const slot of slots) {
		if (y < slot.middle) return slot.path;
	}
	return null;
}

/** Whether dropping `path` before `before` leaves `paths` as they are. */
export function worktreeStaysPut(paths: readonly string[], path: string, before: string | null): boolean {
	const at = paths.indexOf(path);
	if (at < 0) return true;
	return before === null ? at === paths.length - 1 : before === path || paths[at + 1] === before;
}
