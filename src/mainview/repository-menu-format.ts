import { MAX_GROUP_DEPTH, type RepositoryGroup, type RepositoryGroups, depthOf, descendantsOf, groupLabel, moveGroupAmong, preorder, stepGroupAmongSiblings } from "../shared/repository-groups";
import { DELETE_GROUP_HINT, GROUP_TOO_DEEP, REMOVE_REPOSITORY_HINT, describeGroupNameThere } from "./format";
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
 * then one per group it can go to, in the order shown, each named with the
 * groups around it ("Work › Client A"), then New group..., Take out of its
 * group when it is in one, and Remove from the list last.
 */
export function repositoryMenuItems(groups: RepositoryGroups, repository: string, cleanUp?: WorktreeMenuItem): RepositoryMenuItem[] {
	const own = groups.groups.find(group => Object.hasOwn(groups.membership, repository) && group.id === groups.membership[repository]) ?? null;
	const places: RepositoryMenuItem[] = preorder(groups.groups)
		.filter(group => group !== own)
		.map(group => ({ id: `place-${group.id}`, label: `${own ? "Move" : "Add"} to ${groupLabel(groups.groups, group.id)}`, choice: { kind: "place", group: group.id } }));
	return [
		...(cleanUp ? [{ id: cleanUp.id, label: cleanUp.label, title: cleanUp.title, disabled: cleanUp.disabled, note: cleanUp.note, choice: { kind: "clean-up-merged" } } satisfies RepositoryMenuItem] : []),
		...places,
		{ id: "new-group", label: "New group...", choice: { kind: "new-group" } },
		...(own ? [{ id: "take-out", label: `Take out of ${own.name}`, choice: { kind: "take-out" } } satisfies RepositoryMenuItem] : []),
		{ id: "remove", label: "Remove from the list", title: REMOVE_REPOSITORY_HINT, choice: { kind: "remove" } },
	];
}

export type GroupMenuChoice = { kind: "rename" } | { kind: "new-subgroup" } | { kind: "step"; step: -1 | 1 } | { kind: "move"; parent: string | null } | { kind: "delete" };

export interface GroupMenuItem {
	id: string;
	label: string;
	title?: string;
	/** A disabled entry does nothing, and says why in `note`, shown under it. */
	disabled?: boolean;
	note?: string | null;
	choice: GroupMenuChoice;
}

/**
 * The entries of a group header's menu: Rename, New subgroup..., Move up and
 * Move down among the groups with the same parent, each only where there is a
 * place to go, then Move into each other group it can go inside, in the order shown and named with
 * the groups around it, then Move to the top level when it sits inside one,
 * and Delete group last. The group itself, its own subgroups, and the group
 * it is in already are left out. A place it cannot go, past the deepest level
 * or beside a group with its name, shows disabled with the reason. Deleting
 * never asks, because it only ungroups.
 */
export function groupMenuItems(groups: readonly RepositoryGroup[], id: string): GroupMenuItem[] {
	const group = groups.find(known => known.id === id);
	const inside = new Set([id, ...descendantsOf(groups, id)]);
	const why = (parent: string | null): { disabled?: true; note?: string } => {
		const moved = moveGroupAmong(groups, id, parent, null);
		if (moved.outcome === "too-deep") return { disabled: true, note: GROUP_TOO_DEEP };
		if (moved.outcome === "name-taken") return { disabled: true, note: describeGroupNameThere(moved.name) };
		return {};
	};
	const into: GroupMenuItem[] = preorder(groups)
		.filter(target => !inside.has(target.id) && target.id !== group?.parent)
		.map(target => ({ id: `move-${target.id}`, label: `Move into ${groupLabel(groups, target.id)}`, ...why(target.id), choice: { kind: "move", parent: target.id } }));
	const deepest = depthOf(groups, id) >= MAX_GROUP_DEPTH;
	return [
		{ id: "rename", label: "Rename", choice: { kind: "rename" } },
		{ id: "new-subgroup", label: "New subgroup...", ...(deepest ? { disabled: true, note: GROUP_TOO_DEEP } : {}), choice: { kind: "new-subgroup" } },
		...(stepGroupAmongSiblings(groups, id, -1) ? [{ id: "move-up", label: "Move up", choice: { kind: "step", step: -1 } } satisfies GroupMenuItem] : []),
		...(stepGroupAmongSiblings(groups, id, 1) ? [{ id: "move-down", label: "Move down", choice: { kind: "step", step: 1 } } satisfies GroupMenuItem] : []),
		...into,
		...(group?.parent !== undefined ? [{ id: "move-top", label: "Move to the top level", ...why(null), choice: { kind: "move", parent: null } } satisfies GroupMenuItem] : []),
		{ id: "delete", label: "Delete group", title: DELETE_GROUP_HINT, choice: { kind: "delete" } },
	];
}

/** The name of a repository's menu, for assistive technology. */
export const describeRepositoryMenu = (name: string) => `Actions for ${name}`;

/** The name of a group's menu, for assistive technology. */
export const describeGroupMenu = (name: string) => `Actions for group ${name}`;
