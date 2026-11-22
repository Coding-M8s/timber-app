/**
 * Named groups of repositories in the sidebar, such as Work and Personal.
 * A group can sit inside another, at most MAX_GROUP_DEPTH levels deep, and
 * shows its own repositories first, then its subgroups. Each repository is
 * named by the path of its primary checkout. Order inside a group is the
 * order of the saved list itself; order among the groups that share a parent
 * is the order of the groups list. Everything here is pure.
 */

import { applyOrder } from "./repository-order";

export interface RepositoryGroup {
	id: string;
	name: string;
	/** The id of the group it sits inside. Absent for a group at the top level. */
	parent?: string;
}

/** What the interface is told: the groups in order, and the group of each grouped repository by primary checkout path. */
export interface RepositoryGroups {
	groups: RepositoryGroup[];
	membership: Record<string, string>;
}

/** The longest a group name can be, in characters. */
export const MAX_GROUP_NAME = 40;

/** How many levels groups nest: a group at the top level is at level 1, so a group at this level has no subgroups. */
export const MAX_GROUP_DEPTH = 3;

/** What joins the names of a group and the groups around it, as in "Work › Client A". */
export const GROUP_PATH_SEPARATOR = " \u203a ";

export function emptyGroups(): RepositoryGroups {
	return { groups: [], membership: {} };
}

/** Trimmed, inner whitespace runs made one space, cut to MAX_GROUP_NAME. Null when nothing is left. */
export function cleanGroupName(name: string): string | null {
	const clean = name.replace(/\s+/g, " ").trim().slice(0, MAX_GROUP_NAME).trimEnd();
	return clean === "" ? null : clean;
}

/** The parent of a group, or null at the top level. */
const parentOf = (group: RepositoryGroup): string | null => group.parent ?? null;

/** The group with `parent` in place of the one it had: none for null. */
function withParent(group: RepositoryGroup, parent: string | null): RepositoryGroup {
	return parent === null ? { id: group.id, name: group.name } : { id: group.id, name: group.name, parent };
}

/** Whether a group other than `except`, among those with this `parent` (null for the top level), already has this name, ignoring case. */
export function groupNameTaken(groups: readonly RepositoryGroup[], name: string, parent: string | null, except?: string): boolean {
	const wanted = name.toLocaleLowerCase();
	return groups.some(group => group.id !== except && parentOf(group) === parent && group.name.toLocaleLowerCase() === wanted);
}

/** The groups directly inside `parent`, or at the top level for null, in order. */
export function childrenOf<Group extends RepositoryGroup>(groups: readonly Group[], parent: string | null): Group[] {
	return groups.filter(group => parentOf(group) === parent);
}

/** The groups a group sits inside, the nearest first. Empty at the top level, or for an unknown id. Stops at a loop. */
export function ancestorsOf(groups: readonly RepositoryGroup[], id: string): RepositoryGroup[] {
	const ancestors: RepositoryGroup[] = [];
	const seen = new Set([id]);
	let parent = groups.find(group => group.id === id)?.parent;
	while (parent !== undefined && !seen.has(parent)) {
		seen.add(parent);
		const found = groups.find(group => group.id === parent);
		if (!found) break;
		ancestors.push(found);
		parent = found.parent;
	}
	return ancestors;
}

/** The level a group is at: 1 at the top level. */
export function depthOf(groups: readonly RepositoryGroup[], id: string): number {
	return ancestorsOf(groups, id).length + 1;
}

/** The ids of every group inside a group, at any depth. */
export function descendantsOf(groups: readonly RepositoryGroup[], id: string): string[] {
	const found: string[] = [];
	const visit = (parent: string) => {
		for (const child of childrenOf(groups, parent)) {
			if (child.id === id || found.includes(child.id)) continue;
			found.push(child.id);
			visit(child.id);
		}
	};
	visit(id);
	return found;
}

/** How many levels a group and the groups inside it take: 1 with no subgroups. */
function heightOf(groups: readonly RepositoryGroup[], id: string): number {
	return 1 + Math.max(0, ...descendantsOf(groups, id).map(child => depthOf(groups, child) - depthOf(groups, id)));
}

/** Every group as the sidebar shows them: each one before its subgroups, siblings in order. */
export function preorder<Group extends RepositoryGroup>(groups: readonly Group[]): Group[] {
	const order: Group[] = [];
	const visit = (parent: string | null) => {
		for (const child of childrenOf(groups, parent)) {
			if (order.includes(child)) continue;
			order.push(child);
			visit(child.id);
		}
	};
	visit(null);
	return order;
}

/** A group's name with the names of the groups it sits inside, outermost first, as in "Work › Client A". */
export function groupLabel(groups: readonly RepositoryGroup[], id: string): string {
	const group = groups.find(known => known.id === id);
	if (!group) return "";
	return [...ancestorsOf(groups, id).reverse(), group].map(known => known.name).join(GROUP_PATH_SEPARATOR);
}

/** The group a repository is in, then each group around it, the nearest first. Empty for a loose repository. */
export function groupChainOf(groups: RepositoryGroups, path: string): string[] {
	const id = groupOf(groups, path);
	return id === null ? [] : [id, ...ancestorsOf(groups.groups, id).map(group => group.id)];
}

/**
 * Groups from outside. Never fails: skips entries that are not { id: non-empty string, name: cleanable string }, and
 * repeated ids. A `parent` is kept only when it names another group read, and is dropped, putting the group at the top
 * level, in this order: when it is not a non-empty string, names the group itself, or names no group read; when the
 * group is on a loop of parents (each group on it loses its parent, and groups hanging under the loop keep theirs);
 * and, going down from the top level, when the group would sit deeper than MAX_GROUP_DEPTH.
 */
export function readGroups(value: unknown): RepositoryGroup[] {
	const read: RepositoryGroup[] = [];
	if (!Array.isArray(value)) return read;
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
		const { id, name, parent } = entry as Record<string, unknown>;
		if (typeof id !== "string" || id === "" || typeof name !== "string") continue;
		const clean = cleanGroupName(name);
		if (clean === null || read.some(group => group.id === id)) continue;
		read.push(typeof parent === "string" && parent !== "" && parent !== id ? { id, name: clean, parent } : { id, name: clean });
	}
	let groups = read.map(group => (group.parent !== undefined && !read.some(known => known.id === group.parent) ? withParent(group, null) : group));
	// On a loop: following the parents from the group comes back to it.
	const onLoop = (id: string) => {
		const seen = new Set<string>();
		let parent = groups.find(group => group.id === id)?.parent;
		while (parent !== undefined && !seen.has(parent)) {
			if (parent === id) return true;
			seen.add(parent);
			parent = groups.find(group => group.id === parent)?.parent;
		}
		return false;
	};
	const looping = new Set(groups.filter(group => onLoop(group.id)).map(group => group.id));
	groups = groups.map(group => (looping.has(group.id) ? withParent(group, null) : group));
	// Now every parent leads to the top level. Too deep a group goes to the top level, with its subgroups.
	for (const group of preorder(groups)) {
		if (depthOf(groups, group.id) > MAX_GROUP_DEPTH) groups = groups.map(known => (known.id === group.id ? withParent(known, null) : known));
	}
	return groups;
}

/** The group a path is shown in, or null when it is loose. A membership that names no group counts as loose. */
function groupOf(groups: RepositoryGroups, path: string): string | null {
	const id = Object.hasOwn(groups.membership, path) ? groups.membership[path] : undefined;
	return id !== undefined && groups.groups.some(group => group.id === id) ? id : null;
}

/** A group as arranged: its own members in their order, then its subgroups, each arranged the same way. */
export interface ArrangedGroup<Item> {
	group: RepositoryGroup;
	items: Item[];
	children: ArrangedGroup<Item>[];
}

/** Loose items first in their order, then each top-level group in group order, each holding its members in their order and then its subgroups. */
export function arrange<Item extends { path: string }>(items: readonly Item[], groups: RepositoryGroups): { loose: Item[]; grouped: ArrangedGroup<Item>[] } {
	const loose = items.filter(item => groupOf(groups, item.path) === null);
	const build = (parent: string | null, seen: ReadonlySet<string>): ArrangedGroup<Item>[] => childrenOf(groups.groups, parent)
		.filter(group => !seen.has(group.id))
		.map(group => ({
			group,
			items: items.filter(item => groupOf(groups, item.path) === group.id),
			children: build(group.id, new Set([...seen, group.id])),
		}));
	return { loose, grouped: build(null, new Set()) };
}

/** Every item in an arranged group, at any depth, in the order shown. */
export function itemsWithin<Item>(arranged: ArrangedGroup<Item>): Item[] {
	return [...arranged.items, ...arranged.children.flatMap(itemsWithin)];
}

/** The paths in the order the sidebar shows them: arrange(), flattened. */
export function shownOrder(paths: readonly string[], groups: RepositoryGroups): string[] {
	const { loose, grouped } = arrange(paths.map(path => ({ path })), groups);
	return [...loose, ...grouped.flatMap(itemsWithin)].map(item => item.path);
}

/**
 * Where `path` lands when it is put in `group` (null for loose) before `before` (a path in that same
 * destination, or null for the end of it). Answers the whole new shown order. Null when `path` is not listed.
 */
export function placeInOrder(paths: readonly string[], groups: RepositoryGroups, path: string, group: string | null, before: string | null): string[] | null {
	if (!paths.includes(path)) return null;
	const destination = group !== null && groups.groups.some(known => known.id === group) ? group : null;
	const moved: RepositoryGroups = { groups: groups.groups, membership: { ...groups.membership } };
	if (destination === null) delete moved.membership[path];
	else moved.membership[path] = destination;
	const rest = shownOrder(paths.filter(candidate => candidate !== path), moved);
	const siblings = rest.filter(candidate => groupOf(moved, candidate) === destination);
	const at = before !== null && siblings.includes(before)
		? rest.indexOf(before)
		: siblings.length > 0
			? rest.indexOf(siblings[siblings.length - 1]!) + 1
			: endOfEmpty(rest, moved, destination);
	return [...rest.slice(0, at), path, ...rest.slice(at)];
}

/**
 * Where a destination with no other member starts in the shown order: after loose ones and the members of every
 * group shown before it, which are its ancestors and the groups ahead of it, since a group's members come before its
 * subgroups.
 */
function endOfEmpty(rest: readonly string[], groups: RepositoryGroups, destination: string | null): number {
	if (destination === null) return 0;
	const shown = preorder(groups.groups);
	const earlier = shown.slice(0, shown.findIndex(group => group.id === destination)).map(group => group.id);
	return rest.filter(candidate => {
		const id = groupOf(groups, candidate);
		return id === null || earlier.includes(id);
	}).length;
}

/** The whole new shown order after moving `path` one step among its siblings (same group, or loose). Null at an edge or when not listed. */
export function stepAmongSiblings(paths: readonly string[], groups: RepositoryGroups, path: string, step: -1 | 1): string[] | null {
	if (!paths.includes(path)) return null;
	const shown = shownOrder(paths, groups);
	const group = groupOf(groups, path);
	const siblings = shown.filter(candidate => groupOf(groups, candidate) === group);
	const at = siblings.indexOf(path);
	const other = siblings[at + step];
	if (other === undefined) return null;
	const from = shown.indexOf(path);
	const to = shown.indexOf(other);
	const next = [...shown];
	next[from] = other;
	next[to] = path;
	return next;
}

/** A saved list as grouping sees it: the groups in order, and the repositories in order, each with its group. */
export interface GroupedList<Entry extends { path: string; group?: string }> {
	groups: RepositoryGroup[];
	repositories: Entry[];
}

/** What a change to the groups comes to. `unchanged` means nothing needs saving. */
export type GroupChange<Entry extends { path: string; group?: string }> =
	| { outcome: "changed"; next: GroupedList<Entry> }
	| { outcome: "unchanged" }
	| { outcome: "name-empty" }
	| { outcome: "name-taken"; name: string }
	/** A group cannot go inside itself or one of its own subgroups. */
	| { outcome: "inside-itself" }
	/** It would put a group deeper than MAX_GROUP_DEPTH. */
	| { outcome: "too-deep" };

/** What the interface is told about a saved list. Membership names only listed paths and existing groups. */
export function groupsOfList(list: GroupedList<{ path: string; group?: string }>): RepositoryGroups {
	const membership: Record<string, string> = {};
	for (const entry of list.repositories) {
		if (entry.group !== undefined && list.groups.some(group => group.id === entry.group)) membership[entry.path] = entry.group;
	}
	return { groups: list.groups.map(group => ({ ...group })), membership };
}

/** Each entry with the group `membership` gives it, or none, in the order `order` names. */
function regroup<Entry extends { path: string; group?: string }>(entries: readonly Entry[], membership: Record<string, string>, order: readonly string[]): Entry[] {
	const byPath = new Map(entries.map(entry => [entry.path, entry]));
	return order.map(path => {
		const { group: _, ...rest } = byPath.get(path)!;
		const group = Object.hasOwn(membership, path) ? membership[path] : undefined;
		return (group === undefined ? rest : { ...rest, group }) as Entry;
	});
}

const sameEntries = (one: readonly { path: string; group?: string }[], other: readonly { path: string; group?: string }[]) =>
	one.length === other.length && one.every((entry, index) => entry.path === other[index]!.path && entry.group === other[index]!.group);

/** A name for a group among those with this `parent`, or the problem with it. */
function nameFor(groups: readonly RepositoryGroup[], name: string, parent: string | null, except?: string): { outcome: "named"; name: string } | { outcome: "name-empty" } | { outcome: "name-taken"; name: string } {
	const clean = cleanGroupName(name);
	if (clean === null) return { outcome: "name-empty" };
	if (!groupNameTaken(groups, clean, parent, except)) return { outcome: "named", name: clean };
	const wanted = clean.toLocaleLowerCase();
	return { outcome: "name-taken", name: groups.find(group => group.id !== except && parentOf(group) === parent && group.name.toLocaleLowerCase() === wanted)!.name };
}

/**
 * A new group with id `id`, at the end of the groups inside `parent` (null or left out for the top level). With
 * `repository` (when listed), that repository goes in it, at the end of the shown order. A `parent` that names no
 * group changes nothing; one at the deepest level is refused.
 */
export function createGroupIn<Entry extends { path: string; group?: string }>(list: GroupedList<Entry>, id: string, name: string, repository?: string, parent: string | null = null): GroupChange<Entry> {
	if (parent !== null && !list.groups.some(group => group.id === parent)) return { outcome: "unchanged" };
	if (parent !== null && depthOf(list.groups, parent) >= MAX_GROUP_DEPTH) return { outcome: "too-deep" };
	const named = nameFor(list.groups, name, parent);
	if (named.outcome !== "named") return named;
	const groups = [...list.groups, withParent({ id, name: named.name }, parent)];
	const grouped = { groups, repositories: list.repositories };
	const paths = list.repositories.map(entry => entry.path);
	const current = groupsOfList(grouped);
	const order = repository === undefined ? null : placeInOrder(paths, current, repository, id, null);
	if (order === null || repository === undefined) return { outcome: "changed", next: grouped };
	return { outcome: "changed", next: { groups, repositories: regroup(list.repositories, { ...current.membership, [repository]: id }, order) } };
}

/** The group with a new name. An unknown id, or the name it has already, changes nothing. */
export function renameGroupIn<Entry extends { path: string; group?: string }>(list: GroupedList<Entry>, id: string, name: string): GroupChange<Entry> {
	const known = list.groups.find(group => group.id === id);
	if (!known) return { outcome: "unchanged" };
	// Its own name is never refused, even beside a sibling that has it after a delete lifted one up.
	if (cleanGroupName(name) === known.name) return { outcome: "unchanged" };
	const named = nameFor(list.groups, name, parentOf(known), id);
	if (named.outcome !== "named") return named;
	return { outcome: "changed", next: { groups: list.groups.map(group => group.id === id ? { ...group, name: named.name } : group), repositories: list.repositories } };
}

/**
 * The list without the group. Its repositories and its subgroups move up into its parent, or to the top level when
 * it had none; its subgroups take its place among their new siblings. The repositories stay where they are in the
 * saved list, so they show among the parent's own in that order. Never refuses: a subgroup may end up beside a group
 * with the same name. An unknown id changes nothing.
 */
export function deleteGroupIn<Entry extends { path: string; group?: string }>(list: GroupedList<Entry>, id: string): GroupChange<Entry> {
	const at = list.groups.findIndex(group => group.id === id);
	if (at === -1) return { outcome: "unchanged" };
	const parent = parentOf(list.groups[at]!);
	const lifted = list.groups.filter(group => group.parent === id).map(group => withParent(group, parent));
	const rest = list.groups.filter(group => group.id !== id && group.parent !== id);
	const place = list.groups.slice(0, at).filter(group => group.parent !== id).length;
	const groups = [...rest.slice(0, place), ...lifted, ...rest.slice(place)];
	const membership: Record<string, string> = {};
	for (const entry of list.repositories) {
		if (entry.group === undefined || !list.groups.some(group => group.id === entry.group)) continue;
		if (entry.group !== id) membership[entry.path] = entry.group;
		else if (parent !== null) membership[entry.path] = parent;
	}
	return { outcome: "changed", next: { groups, repositories: regroup(list.repositories, membership, list.repositories.map(entry => entry.path)) } };
}

/** What moving a group comes to, for the groups alone. */
export type GroupMove =
	| { outcome: "changed"; groups: RepositoryGroup[] }
	| { outcome: "unchanged" }
	| { outcome: "inside-itself" }
	| { outcome: "too-deep" }
	| { outcome: "name-taken"; name: string };

/**
 * The groups with `id` moved inside `parent` (null for the top level), before `before`, a group with that same
 * parent, or at the end of them when `before` is null or not one of them. Refused when `parent` is the group itself or
 * one of its subgroups, when the group and its subgroups would go deeper than MAX_GROUP_DEPTH, or when a group already
 * inside `parent` has its name, ignoring case. An unknown id or parent, or a move that changes nothing, is `unchanged`.
 */
export function moveGroupAmong(groups: readonly RepositoryGroup[], id: string, parent: string | null, before: string | null): GroupMove {
	const known = groups.find(group => group.id === id);
	// Before itself is where it is.
	if (!known || before === id) return { outcome: "unchanged" };
	if (parent !== null) {
		if (!groups.some(group => group.id === parent)) return { outcome: "unchanged" };
		if (parent === id || descendantsOf(groups, id).includes(parent)) return { outcome: "inside-itself" };
	}
	if ((parent === null ? 0 : depthOf(groups, parent)) + heightOf(groups, id) > MAX_GROUP_DEPTH) return { outcome: "too-deep" };
	if (parent !== parentOf(known)) {
		const named = nameFor(groups, known.name, parent, id);
		if (named.outcome === "name-taken") return named;
	}
	const rest = groups.filter(group => group.id !== id);
	const siblings = childrenOf(rest, parent);
	const at = before !== null && siblings.some(group => group.id === before)
		? rest.findIndex(group => group.id === before)
		: siblings.length > 0
			? rest.indexOf(siblings[siblings.length - 1]!) + 1
			: rest.length;
	const next = [...rest.slice(0, at), withParent(known, parent), ...rest.slice(at)];
	// Only the order among siblings means anything, so a move that keeps it changes nothing.
	const ids = (among: readonly RepositoryGroup[]) => childrenOf(among, parent).map(group => group.id).join("\n");
	const same = parent === parentOf(known) && ids(next) === ids(groups);
	return same ? { outcome: "unchanged" } : { outcome: "changed", groups: next };
}

/** Where a group goes to move one step among the groups that share its parent: that parent, and the group it then goes before. Null at an edge. */
export function stepGroupAmongSiblings(groups: readonly RepositoryGroup[], id: string, step: -1 | 1): { parent: string | null; before: string | null } | null {
	const known = groups.find(group => group.id === id);
	if (!known) return null;
	const siblings = childrenOf(groups, parentOf(known));
	const at = siblings.indexOf(known);
	if (step === -1) return at > 0 ? { parent: parentOf(known), before: siblings[at - 1]!.id } : null;
	if (at === siblings.length - 1) return null;
	return { parent: parentOf(known), before: siblings[at + 2]?.id ?? null };
}

/** The list with a group moved, by the rules of `moveGroupAmong`. */
export function moveGroupIn<Entry extends { path: string; group?: string }>(list: GroupedList<Entry>, id: string, parent: string | null, before: string | null): GroupChange<Entry> {
	const moved = moveGroupAmong(list.groups, id, parent, before);
	if (moved.outcome !== "changed") return moved;
	return { outcome: "changed", next: { groups: moved.groups, repositories: list.repositories } };
}

/**
 * The repository at `path` put in `group`, or with null taken out of any, and with `order` the whole list in that
 * order, by the rules of `applyOrder`. An unknown path or group changes nothing.
 */
export function placeIn<Entry extends { path: string; group?: string }>(list: GroupedList<Entry>, path: string, group: string | null, order?: readonly string[]): GroupChange<Entry> {
	if (!list.repositories.some(entry => entry.path === path)) return { outcome: "unchanged" };
	if (group !== null && !list.groups.some(known => known.id === group)) return { outcome: "unchanged" };
	const { membership } = groupsOfList(list);
	if (group === null) delete membership[path];
	else membership[path] = group;
	const ordered = applyOrder(list.repositories, order ?? []).map(entry => entry.path);
	const repositories = regroup(list.repositories, membership, ordered);
	if (sameEntries(repositories, list.repositories)) return { outcome: "unchanged" };
	return { outcome: "changed", next: { groups: list.groups, repositories } };
}
