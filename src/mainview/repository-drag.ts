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
