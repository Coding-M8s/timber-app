import { type ArrangedGroup, type RepositoryGroup, type RepositoryGroups, arrange, childrenOf, itemsWithin, moveGroupAmong } from "../shared/repository-groups";
import type { DropSlot, GroupDropPlace, GroupDropSlot } from "./repository-drag";
import type { RepositoryMenuChoice } from "./repository-menu-format";
import type { AppStore } from "./store/store";

/**
 * How the sidebar lays out repository groups, and what their controls do.
 * Pure, or acting only through the store, so it can be tested without a window.
 */

/** The tooltip of the flag on a folded group, which says one of its repositories has something to show. */
export const GROUP_NEEDS_LOOK_TITLE = "A repository in this group needs a look.";

/** A group as the sidebar shows it: its own repositories, its subgroups shown, and whether they show. */
export interface ShownGroup<Row> {
	group: RepositoryGroup;
	items: Row[];
	children: ShownGroup<Row>[];
	open: boolean;
	/** The repositories inside it at any depth, subgroups a filter hides included: what its count, summary, and flag are about. */
	paths: string[];
}

/** Every group shown, each before its subgroups, folded ones' subgroups included. */
export function shownGroupsOf<Group extends { children: readonly Group[] }>(grouped: readonly Group[]): Group[] {
	return grouped.flatMap(group => [group, ...shownGroupsOf(group.children)]);
}

/**
 * The repository sections in the order shown: the loose ones, then each
 * group, holding its own repositories and then its subgroups. While a filter
 * is typed, a group opens exactly when anything inside it, at any depth, has
 * a match, and a group without one is left out. Otherwise a group is open
 * unless it is folded; each subgroup is folded on its own.
 */
export function arrangeSidebar<Row extends { repository: { path: string }; matches: readonly unknown[] }>(
	rows: readonly Row[],
	groups: RepositoryGroups,
	collapsedGroups: readonly string[],
	query: string,
): { loose: Row[]; grouped: ShownGroup<Row>[] } {
	const { loose, grouped } = arrange(rows.map(row => ({ path: row.repository.path, row })), groups);
	const show = (arranged: ArrangedGroup<{ path: string; row: Row }>): ShownGroup<Row> | null => {
		const members = arranged.items.map(item => item.row);
		const children = arranged.children.map(show).filter(child => child !== null);
		const matching = members.some(row => row.matches.length > 0) || children.length > 0;
		if (query !== "" && !matching) return null;
		return { group: arranged.group, items: members, children, open: query !== "" || !collapsedGroups.includes(arranged.group.id), paths: itemsWithin(arranged).map(item => item.path) };
	};
	return { loose: loose.map(item => item.row), grouped: grouped.map(show).filter(group => group !== null) };
}

/**
 * Whether a repository among `paths` has something the person must not miss
 * while its group is folded: a removal that runs or failed, a listing Timber
 * failed, or a folder that is missing. Agents are summed up on their own.
 */
export function groupNeedsLook(
	state: { repositories: readonly { path: string; available: boolean; failure: string | null }[]; removals: readonly { repository: string }[] },
	paths: readonly string[],
): boolean {
	if (state.removals.some(removal => paths.includes(removal.repository))) return true;
	return state.repositories.some(repository => paths.includes(repository.path) && (!repository.available || repository.failure !== null));
}

/** What a key does in a group's name field. */
export function groupNameKeyAction(key: string): "submit" | "cancel" | null {
	if (key === "Enter") return "submit";
	if (key === "Escape") return "cancel";
	return null;
}

/**
 * What leaving a group's name field does. Before an answer was given: nothing
 * to save cancels, anything else saves. After Enter or Escape answered, the
 * field is on its way out, so leaving it does nothing more, except when the
 * name was refused and its reason (`problem`) still shows: then leaving puts
 * the field away, so it is never left behind.
 */
export function groupNameBlurAction(value: string, initial: string, answered = false, problem: string | null = null): "submit" | "cancel" | "nothing" {
	if (answered) return problem === null ? "nothing" : "cancel";
	return value.trim() === "" || value === initial ? "cancel" : "submit";
}

/** Whether a repository header can be dragged: only when there is somewhere for it to go. */
export function canDragRepositories(repositories: number, groups: number): boolean {
	return repositories >= 2 || groups >= 1;
}

/**
 * The places a dragged repository can go, top to bottom as shown, from the
 * boxes of what is drawn: each repository section by its path, and each group
 * header row as `group:<id>`. The dragged one, and anything not drawn, is left out.
 */
export function dropSlotsOf(
	arranged: { loose: readonly { repository: { path: string } }[]; grouped: readonly SlotGroup[] },
	dragged: string,
	box: (name: string) => { top: number; height: number } | undefined,
): DropSlot[] {
	const slots: DropSlot[] = [];
	const repositories = (rows: readonly { repository: { path: string } }[], group: string | null) => {
		for (const { repository } of rows) {
			const found = repository.path === dragged ? undefined : box(repository.path);
			if (found) slots.push({ kind: "repository", path: repository.path, group, middle: found.top + found.height / 2 });
		}
	};
	const groups = (shown: readonly SlotGroup[]) => {
		for (const { group, open, items, children } of shown) {
			const head = box(`group:${group.id}`);
			if (head) slots.push({ kind: "group", id: group.id, top: head.top, bottom: head.top + head.height, open });
			if (!open) continue;
			repositories(items, group.id);
			groups(children);
		}
	};
	repositories(arranged.loose, null);
	groups(arranged.grouped);
	return slots;
}

/** A group as the places to drop are found in it. */
interface SlotGroup {
	group: RepositoryGroup;
	open: boolean;
	items: readonly { repository: { path: string } }[];
	children: readonly SlotGroup[];
}

/**
 * The places a dragged group can go, top to bottom as shown, from the boxes
 * of the group header rows drawn, named `group:<id>`. The dragged group and
 * its subgroups are in it too, so a drop on them is refused rather than
 * landing past them. `expanded` is whether anything shows under a header.
 */
export function groupDropSlotsOf(
	grouped: readonly SlotGroup[],
	box: (name: string) => { top: number; height: number } | undefined,
): GroupDropSlot[] {
	const slots: GroupDropSlot[] = [];
	const visit = (shown: readonly SlotGroup[]) => {
		for (const { group, open, items, children } of shown) {
			const head = box(`group:${group.id}`);
			if (head) slots.push({ id: group.id, top: head.top, bottom: head.top + head.height, expanded: open && (items.length > 0 || children.length > 0) });
			if (open) visit(children);
		}
	};
	visit(grouped);
	return slots;
}

/**
 * What a group dropped at `place` asks for: the group to go inside (null for
 * the top level), and the one it goes before (null for the end). Null for a
 * drop on its own header, or beside one of its own direct subgroups, just
 * under that header, which is no move rather than a refusal.
 */
export function groupDropTarget(groups: readonly RepositoryGroup[], dragged: string, place: GroupDropPlace): { parent: string | null; before: string | null } | null {
	if (place.kind === "end") return { parent: null, before: null };
	if (place.id === dragged) return null;
	const target = groups.find(group => group.id === place.id);
	if (!target) return null;
	const parent = target.parent ?? null;
	if (place.kind === "into") return { parent: target.id, before: null };
	if (parent === dragged) return null;
	if (place.kind === "before") return { parent, before: target.id };
	const siblings = childrenOf(groups, parent).filter(group => group.id !== dragged);
	return { parent, before: siblings[siblings.indexOf(target) + 1]?.id ?? null };
}

/** Where the mark of a dragged group's drop is drawn. */
export type GroupDropMark =
	| { kind: "line"; id: string; side: "before" | "after" }
	/** Around the group it goes inside. */
	| { kind: "into"; id: string }
	/** Around the group the pointer is over, where it cannot go. */
	| { kind: "refused"; id: string };

/**
 * The mark for a group dragged to `place`: a line before or after the group
 * it lands beside, around the group it goes inside, or a refusal around the
 * group it is over when it cannot go there. Null while it would land where it
 * already is, or with nowhere to draw.
 */
export function groupDropMark(groups: readonly RepositoryGroup[], dragged: string, place: GroupDropPlace): GroupDropMark | null {
	const target = groupDropTarget(groups, dragged, place);
	if (!target) return null;
	const moved = moveGroupAmong(groups, dragged, target.parent, target.before);
	if (moved.outcome === "unchanged") return null;
	const last = childrenOf(groups, null).filter(group => group.id !== dragged).at(-1);
	const over = place.kind === "end" ? last?.id : place.id;
	if (over === undefined) return null;
	if (moved.outcome !== "changed") return { kind: "refused", id: over };
	if (place.kind === "into") return { kind: "into", id: over };
	return { kind: "line", id: over, side: place.kind === "before" ? "before" : "after" };
}

/**
 * Do what an entry of a repository's menu says. New group... only asks for
 * the name field, with the repository to put in the group it makes, and
 * Icon... opens the icon dialog.
 */
export function chooseFromRepositoryMenu(store: AppStore, repository: string, choice: RepositoryMenuChoice, startNewGroup: (repository: string) => void): void {
	switch (choice.kind) {
		case "clean-up-merged":
			store.openDialog({ kind: "clean-up-merged", repository });
			return;
		case "place":
			void store.placeRepository(repository, choice.group);
			return;
		case "take-out":
			void store.placeRepository(repository, null);
			return;
		case "new-group":
			startNewGroup(repository);
			return;
		case "icon":
			store.openDialog({ kind: "sidebar-icon", target: { kind: "repository", path: repository } });
			return;
		case "remove":
			void store.removeRepository(repository);
			return;
	}
}

/** A group as the mark of a repository's drop looks through it. */
interface MarkGroup {
	group: RepositoryGroup;
	items: readonly { repository: { path: string } }[];
	children: readonly MarkGroup[];
}

/** Where the mark of a dragged repository's drop is drawn. */
export type RepositoryDropMark =
	| { kind: "repository"; path: string; side: "before" | "after" }
	/** Around the group it lands at the end of, so a folded or empty one shows it too. */
	| { kind: "into"; group: string }
	/** Above the first group: the end of the loose list while no other loose repository shows. */
	| { kind: "above-group"; group: string };

/**
 * The mark for a repository dragged to `place`: before the section it lands
 * before, around the group it lands at the end of, or after the last loose
 * section. Null while it would land where it already is.
 */
export function repositoryDropMark(
	arranged: { loose: readonly { repository: { path: string } }[]; grouped: readonly MarkGroup[] },
	dragged: string,
	place: { group: string | null; before: string | null },
): RepositoryDropMark | null {
	const every = shownGroupsOf(arranged.grouped);
	const home = every.find(shown => shown.items.some(row => row.repository.path === dragged));
	const current = home ? home.group.id : null;
	const destination = place.group === null ? arranged.loose : every.find(shown => shown.group.id === place.group)?.items ?? [];
	const siblings = destination.map(row => row.repository.path);
	const at = siblings.indexOf(dragged);
	if (current === place.group && at !== -1 && (place.before === null ? at === siblings.length - 1 : siblings[at + 1] === place.before)) return null;
	if (place.before !== null) return { kind: "repository", path: place.before, side: "before" };
	if (place.group !== null) return { kind: "into", group: place.group };
	const loose = arranged.loose.filter(row => row.repository.path !== dragged);
	if (loose.length > 0) return { kind: "repository", path: loose[loose.length - 1]!.repository.path, side: "after" };
	const first = arranged.grouped[0];
	return first ? { kind: "above-group", group: first.group.id } : null;
}
