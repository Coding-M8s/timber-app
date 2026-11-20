/**
 * What the window tells the main process about itself, so that background
 * refreshes happen only where someone can see them, and desktop
 * notifications only for what nobody is looking at (see ./status-notices.ts).
 *
 * The main process watches every repository in the list all the time, but it
 * reports changes only while the window shows, and it checks the selected
 * worktree for edits that leave Git's own files alone.
 */
export interface Attention {
	/** False while the window is minimized or otherwise hidden. Nothing is refreshed then. */
	visible: boolean;
	/** Whether the window has the keyboard focus. Getting it back refreshes the selected worktree's repository. */
	focused: boolean;
	/** The selected worktree, checked now and then for edits, or null when nothing is selected. */
	selected: AttendedWorktree | null;
	/**
	 * The session whose chip shows in the selected worktree, or null. Chips
	 * are switched only in the selected worktree, so the main process learns
	 * the shown chip of every worktree from these reports, for the save at
	 * quit (see src/bun/session-layout.ts).
	 */
	session: string | null;
}

export interface AttendedWorktree {
	/** The path of the repository's primary checkout, as in the app's list. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. */
	worktree: string;
	/** The worktree's identity (`Worktree.id`). */
	id: string;
}

/**
 * What the main process assumes until the window has said anything: shown,
 * with nothing selected. A window that never reports keeps getting every
 * change, which is still cheap.
 */
export const assumedAttention: Attention = { visible: true, focused: true, selected: null, session: null };

export function sameAttention(left: Attention, right: Attention): boolean {
	return left.visible === right.visible
		&& left.focused === right.focused
		&& left.selected?.repository === right.selected?.repository
		&& left.selected?.worktree === right.selected?.worktree
		&& left.selected?.id === right.selected?.id
		&& left.session === right.session;
}
