import type { RepositoryGroups } from "../shared/repository-groups";
import { DELETE_GROUP_HINT, REMOVE_REPOSITORY_HINT } from "./format";
import type { WorktreeMenuItem } from "./worktree-menu-format";

/**
 * Words and rules for the menu a repository header opens, from its More
 * button, a right-click, or the keyboard, and for the menu of a group header.
 * Pure, so they can be tested without a window. The keys that open and move
 * through them are the worktree menu's (see `opensWorktreeMenu` and
 * `worktreeMenuKeyAction` in worktree-menu-format.ts).
 */

export type RepositoryMenuChoice =
	| { kind: "clean-up-merged" }
	| { kind: "place"; group: string }
	| { kind: "new-group" }
	| { kind: "take-out" }
	| { kind: "remove" };

export interface RepositoryMenuItem {
	id: string;
	label: string;
	title?: string;
	/** A disabled entry does nothing, and says why in `note`, shown under it. */
	disabled?: boolean;
	note?: string | null;
	choice: RepositoryMenuChoice;
}

/**
 * The entries of a repository's menu: Clean up merged first, when the
 * sidebar gives it (see `repositoryMenuItems` in worktree-menu-format.ts),
 * then one per group it can go to, in group order, then New group..., Take
 * out of its group when it is in one, and Remove from the list last.
 */
export function repositoryMenuItems(groups: RepositoryGroups, repository: string, cleanUp?: WorktreeMenuItem): RepositoryMenuItem[] {
	const own = groups.groups.find(group => Object.hasOwn(groups.membership, repository) && group.id === groups.membership[repository]) ?? null;
	const places: RepositoryMenuItem[] = groups.groups
		.filter(group => group !== own)
		.map(group => ({ id: `place-${group.id}`, label: `${own ? "Move" : "Add"} to ${group.name}`, choice: { kind: "place", group: group.id } }));
	return [
		...(cleanUp ? [{ id: cleanUp.id, label: cleanUp.label, title: cleanUp.title, disabled: cleanUp.disabled, note: cleanUp.note, choice: { kind: "clean-up-merged" } } satisfies RepositoryMenuItem] : []),
		...places,
		{ id: "new-group", label: "New group...", choice: { kind: "new-group" } },
		...(own ? [{ id: "take-out", label: `Take out of ${own.name}`, choice: { kind: "take-out" } } satisfies RepositoryMenuItem] : []),
		{ id: "remove", label: "Remove from the list", title: REMOVE_REPOSITORY_HINT, choice: { kind: "remove" } },
	];
}

export type GroupMenuChoice = { kind: "rename" } | { kind: "delete" };

/** The entries of a group header's menu. Deleting never asks, because it only ungroups. */
export function groupMenuItems(): { id: string; label: string; title?: string; choice: GroupMenuChoice }[] {
	return [
		{ id: "rename", label: "Rename", choice: { kind: "rename" } },
		{ id: "delete", label: "Delete group", title: DELETE_GROUP_HINT, choice: { kind: "delete" } },
	];
}

/** The name of a repository's menu, for assistive technology. */
export const describeRepositoryMenu = (name: string) => `Actions for ${name}`;

/** The name of a group's menu, for assistive technology. */
export const describeGroupMenu = (name: string) => `Actions for group ${name}`;
