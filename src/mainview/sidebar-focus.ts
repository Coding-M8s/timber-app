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
	querySelectorAll(selectors: string): Iterable<{ dataset: { repository?: string; group?: string }; querySelector(selectors: string): FocusTarget | null }>;
}

/**
 * Put the keyboard on the first worktree row in the sidebar group of a
 * repository, named by the path of its primary checkout, or on the group's
 * header while it shows no rows, for example while it is collapsed. A
 * repository that is not drawn at all, because the repository group it is in
 * (`group`, by id) is folded, gives the keyboard to that group's header.
 * Answers whether something took it.
 */
export function focusFirstWorktree(repository: string, root: FocusRoot = document as unknown as FocusRoot, group?: string): boolean {
	for (const section of root.querySelectorAll("[data-repository]")) {
		if (section.dataset.repository !== repository) continue;
		// The Issues row comes first in each repository, and is not a worktree.
		const target = section.querySelector(".row:not(.issues-row)") ?? section.querySelector(".group-header");
		target?.focus();
		return target !== null;
	}
	if (group === undefined) return false;
	for (const section of root.querySelectorAll("[data-group]")) {
		if (section.dataset.group !== group) continue;
		const target = section.querySelector(".repository-group-header");
		target?.focus();
		return target !== null;
	}
	return false;
}

/** Whether nothing has the keyboard: the control that had it went away or was disabled. */
export function focusLost(active: Element | null, body: Element | null): boolean {
	return active === null || active === body;
}
