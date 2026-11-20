/**
 * Named groups of repositories in the sidebar, such as Work and Personal.
 * Each repository is named by the path of its primary checkout. Order inside
 * a group is the order of the saved list itself. Everything here is pure.
 */

import { applyOrder } from "./repository-order";

export interface RepositoryGroup {
	id: string;
	name: string;
}

/** What the interface is told: the groups in order, and the group of each grouped repository by primary checkout path. */
export interface RepositoryGroups {
	groups: RepositoryGroup[];
	membership: Record<string, string>;
}

/** The longest a group name can be, in characters. */
export const MAX_GROUP_NAME = 40;

export function emptyGroups(): RepositoryGroups {
	return { groups: [], membership: {} };
}

/** Trimmed, inner whitespace runs made one space, cut to MAX_GROUP_NAME. Null when nothing is left. */
export function cleanGroupName(name: string): string | null {
	const clean = name.replace(/\s+/g, " ").trim().slice(0, MAX_GROUP_NAME).trimEnd();
	return clean === "" ? null : clean;
}

/** Whether a group other than `except` already has this name, ignoring case. */
export function groupNameTaken(groups: readonly RepositoryGroup[], name: string, except?: string): boolean {
	const wanted = name.toLocaleLowerCase();
	return groups.some(group => group.id !== except && group.name.toLocaleLowerCase() === wanted);
}

/** Groups from outside. Never fails: skips entries that are not { id: non-empty string, name: cleanable string }, and repeated ids. */
export function readGroups(value: unknown): RepositoryGroup[] {
	const groups: RepositoryGroup[] = [];
	if (!Array.isArray(value)) return groups;
	for (const entry of value) {
		if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;
		const { id, name } = entry as Record<string, unknown>;
		if (typeof id !== "string" || id === "" || typeof name !== "string") continue;
		const clean = cleanGroupName(name);
		if (clean === null || groups.some(group => group.id === id)) continue;
		groups.push({ id, name: clean });
	}
	return groups;
}

/** The group a path is shown in, or null when it is loose. A membership that names no group counts as loose. */
function groupOf(groups: RepositoryGroups, path: string): string | null {
	const id = Object.hasOwn(groups.membership, path) ? groups.membership[path] : undefined;
	return id !== undefined && groups.groups.some(group => group.id === id) ? id : null;
}

/** Loose items first in their order, then each group in group order with its members in their order. */
export function arrange<Item extends { path: string }>(items: readonly Item[], groups: RepositoryGroups): { loose: Item[]; grouped: { group: RepositoryGroup; items: Item[] }[] } {
	const loose = items.filter(item => groupOf(groups, item.path) === null);
	const grouped = groups.groups.map(group => ({ group, items: items.filter(item => groupOf(groups, item.path) === group.id) }));
	return { loose, grouped };
}

/** The paths in the order the sidebar shows them: arrange(), flattened. */
export function shownOrder(paths: readonly string[], groups: RepositoryGroups): string[] {
	const { loose, grouped } = arrange(paths.map(path => ({ path })), groups);
	return [...loose, ...grouped.flatMap(group => group.items)].map(item => item.path);
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

/** Where a destination with no other member starts in the shown order: after loose ones and every earlier group. */
function endOfEmpty(rest: readonly string[], groups: RepositoryGroups, destination: string | null): number {
	if (destination === null) return 0;
	const earlier = groups.groups.slice(0, groups.groups.findIndex(group => group.id === destination)).map(group => group.id);
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
	| { outcome: "name-taken"; name: string };

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

/** A name for a group, or the problem with it. */
function nameFor(groups: readonly RepositoryGroup[], name: string, except?: string): { outcome: "named"; name: string } | { outcome: "name-empty" } | { outcome: "name-taken"; name: string } {
	const clean = cleanGroupName(name);
	if (clean === null) return { outcome: "name-empty" };
	if (!groupNameTaken(groups, clean, except)) return { outcome: "named", name: clean };
	const wanted = clean.toLocaleLowerCase();
	return { outcome: "name-taken", name: groups.find(group => group.name.toLocaleLowerCase() === wanted)!.name };
}

/** A new group with id `id` at the end. With `repository` (when listed), that repository goes in it, at the end of the shown order. */
export function createGroupIn<Entry extends { path: string; group?: string }>(list: GroupedList<Entry>, id: string, name: string, repository?: string): GroupChange<Entry> {
	const named = nameFor(list.groups, name);
	if (named.outcome !== "named") return named;
	const groups = [...list.groups, { id, name: named.name }];
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
	const named = nameFor(list.groups, name, id);
	if (named.outcome !== "named") return named;
	if (named.name === known.name) return { outcome: "unchanged" };
	return { outcome: "changed", next: { groups: list.groups.map(group => group.id === id ? { id, name: named.name } : group), repositories: list.repositories } };
}

/** The list without the group. Its repositories stay, loose, in their places. An unknown id changes nothing. */
export function deleteGroupIn<Entry extends { path: string; group?: string }>(list: GroupedList<Entry>, id: string): GroupChange<Entry> {
	if (!list.groups.some(group => group.id === id)) return { outcome: "unchanged" };
	const groups = list.groups.filter(group => group.id !== id);
	const { membership } = groupsOfList({ groups, repositories: list.repositories });
	return { outcome: "changed", next: { groups, repositories: regroup(list.repositories, membership, list.repositories.map(entry => entry.path)) } };
}

/** The groups in the order `order` names by id. A group it leaves out keeps its place after the named ones; an unknown id is skipped. */
export function reorderGroupsIn<Entry extends { path: string; group?: string }>(list: GroupedList<Entry>, order: readonly string[]): GroupChange<Entry> {
	const rank = new Map<string, number>();
	for (const id of order) if (!rank.has(id)) rank.set(id, rank.size);
	const named = list.groups.filter(group => rank.has(group.id)).sort((one, other) => rank.get(one.id)! - rank.get(other.id)!);
	const groups = [...named, ...list.groups.filter(group => !rank.has(group.id))];
	if (groups.every((group, index) => group.id === list.groups[index]!.id)) return { outcome: "unchanged" };
	return { outcome: "changed", next: { groups, repositories: list.repositories } };
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
