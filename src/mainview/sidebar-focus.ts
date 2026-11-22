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
 * repository that is not drawn at all, because a repository group it is in is
 * folded, gives the keyboard to the nearest group header drawn: `groups` are
 * the ids of its group and each group around it, the nearest first (see
 * `groupChainOf`). Answers whether something took it.
 */
export function focusFirstWorktree(repository: string, root: FocusRoot = document as unknown as FocusRoot, groups: readonly string[] = []): boolean {
	for (const section of root.querySelectorAll("[data-repository]")) {
		if (section.dataset.repository !== repository) continue;
		// The Issues row comes first in each repository, and is not a worktree.
		const target = section.querySelector(".row:not(.issues-row)") ?? section.querySelector(".group-header");
		target?.focus();
		return target !== null;
	}
	return focusGroupHeader(groups, root);
}

/**
 * Put the keyboard on the header of the first group among `groups`, by id,
 * that is drawn: a group inside a folded one is not. Answers whether one took it.
 */
export function focusGroupHeader(groups: readonly string[], root: FocusRoot = document as unknown as FocusRoot): boolean {
	const sections = [...root.querySelectorAll("[data-group]")];
	for (const group of groups) {
		const section = sections.find(candidate => candidate.dataset.group === group);
		// Its own header, not a subgroup's, which a group being renamed would otherwise give.
		const target = section?.querySelector(":scope > .repository-group-head > .repository-group-header") ?? null;
		if (!target) continue;
		target.focus();
		return true;
	}
	return false;
}

/** Whether nothing has the keyboard: the control that had it went away or was disabled. */
export function focusLost(active: Element | null, body: Element | null): boolean {
	return active === null || active === body;
}

export interface RowRoot {
	querySelectorAll(selectors: string): Iterable<{ dataset: { worktreePath?: string }; querySelector(selectors: string): FocusTarget | null }>;
}

/**
 * Put the keyboard on the row of the worktree at `path`, its registered
 * path, as after Pull: the control that opened the dialog is gone once the
 * branch caught up. Answers whether the row took it.
 */
export function focusWorktreeRow(path: string, root: RowRoot = document as unknown as RowRoot): boolean {
	for (const item of root.querySelectorAll("[data-worktree-path]")) {
		if (item.dataset.worktreePath !== path) continue;
		const row = item.querySelector(".row");
		row?.focus();
		return row !== null;
	}
	return false;
}
