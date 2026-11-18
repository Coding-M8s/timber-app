/**
 * The worktree whose shown terminal should take the keyboard, because the
 * person asked for it: they clicked the worktree's row or a session chip, or
 * the app started a session for them there, such as the agent of a new
 * worktree. A terminal otherwise takes the keyboard only when nothing else
 * has it, and a click on a row, or a dialog that closes, leaves it on a
 * button in the sidebar.
 *
 * The wish is for one showing only: the terminal that takes it clears it,
 * and a worktree that ends up with no session to show drops it, so that it
 * cannot take the keyboard from somewhere else later.
 */

let wish: string | null = null;
const listeners = new Set<() => void>();

/** Ask for the keyboard in the worktree's terminal, now when it shows, or once it does. */
export function wantTerminalFocus(worktree: string): void {
	wish = worktree;
	for (const listener of [...listeners]) listener();
}

/** Whether the worktree's terminal should take the keyboard. Answering yes uses the wish up. */
export function takeTerminalFocus(worktree: string): boolean {
	if (wish !== worktree) return false;
	wish = null;
	return true;
}

/** Forget the wish for this worktree, as when it has no session to show after all. */
export function dropTerminalFocus(worktree: string): void {
	if (wish === worktree) wish = null;
}

/** Hear each new wish. Answers a function that stops listening. */
export function onTerminalFocusWish(listener: () => void): () => void {
	listeners.add(listener);
	return () => void listeners.delete(listener);
}
