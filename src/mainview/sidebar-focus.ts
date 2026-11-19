/**
 * Where the keyboard goes when the control that had it is gone or disabled,
 * as after the Done dialog closes: the Done button is off while the removal
 * runs, and the worktree is gone once it worked.
 */

/** The part of an element this needs, so it can be tested without a window. */
export interface FocusTarget {
	focus(): void;
}

export interface FocusRoot {
	querySelectorAll(selectors: string): Iterable<{ dataset: { repository?: string }; querySelector(selectors: string): FocusTarget | null }>;
}

/**
 * Put the keyboard on the first worktree row in the sidebar group of a
 * repository, named by the path of its primary checkout, or on the group's
 * header while it shows no rows, for example while it is collapsed. Answers
 * whether something took it.
 */
export function focusFirstWorktree(repository: string, root: FocusRoot = document as unknown as FocusRoot): boolean {
	for (const group of root.querySelectorAll("[data-repository]")) {
		if (group.dataset.repository !== repository) continue;
		const target = group.querySelector(".row") ?? group.querySelector(".group-header");
		target?.focus();
		return target !== null;
	}
	return false;
}

/** Whether nothing has the keyboard: the control that had it went away or was disabled. */
export function focusLost(active: Element | null, body: Element | null): boolean {
	return active === null || active === body;
}
