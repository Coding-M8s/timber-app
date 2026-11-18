/**
 * Dragging a repository header to move its group. Pure, so it can be tested
 * without a window.
 */

/** How far, in pixels, the pointer moves before a press on a header becomes a drag instead of a click. */
export const DRAG_THRESHOLD = 4;

/** The keys that move a focused repository header one place, as `aria-keyshortcuts` names them. */
export const MOVE_REPOSITORY_SHORTCUTS = "Alt+ArrowUp Alt+ArrowDown";

/** The sentence a repository header's tooltip ends with. */
export const MOVE_REPOSITORY_HINT = "Drag to reorder, or press Alt+Up or Alt+Down.";

/**
 * Where a dragged group lands: its index among the other groups, counted
 * without it. `middles` are the vertical middles of those other groups, top
 * to bottom, and `y` is where the pointer is.
 */
export function dropIndex(middles: readonly number[], y: number): number {
	let index = 0;
	while (index < middles.length && y > middles[index]!) index++;
	return index;
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
