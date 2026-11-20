import { type RepositoryGroup, type RepositoryGroups, arrange } from "../shared/repository-groups";
import type { DropSlot } from "./repository-drag";
import type { RepositoryMenuChoice } from "./repository-menu-format";
import type { AppStore } from "./store/store";

/**
 * How the sidebar lays out repository groups, and what their controls do.
 * Pure, or acting only through the store, so it can be tested without a window.
 */

/** The tooltip of the flag on a folded group, which says one of its repositories has something to show. */
export const GROUP_NEEDS_LOOK_TITLE = "A repository in this group needs a look.";

/** A group as the sidebar shows it: its repositories, and whether they show. */
export interface ShownGroup<Row> {
	group: RepositoryGroup;
	items: Row[];
	open: boolean;
}

/**
 * The repository sections in the order shown: the loose ones, then each group.
 * While a filter is typed, a group opens exactly when one of its repositories
 * has a match, and a group without one is left out. Otherwise a group is open
 * unless it is folded.
 */
export function arrangeSidebar<Row extends { repository: { path: string }; matches: readonly unknown[] }>(
	rows: readonly Row[],
	groups: RepositoryGroups,
	collapsedGroups: readonly string[],
	query: string,
): { loose: Row[]; grouped: ShownGroup<Row>[] } {
	const { loose, grouped } = arrange(rows.map(row => ({ path: row.repository.path, row })), groups);
	const shown: ShownGroup<Row>[] = [];
	for (const { group, items } of grouped) {
		const members = items.map(item => item.row);
		const matching = members.some(row => row.matches.length > 0);
		if (query !== "" && !matching) continue;
		shown.push({ group, items: members, open: query !== "" || !collapsedGroups.includes(group.id) });
	}
	return { loose: loose.map(item => item.row), grouped: shown };
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
	arranged: { loose: readonly { repository: { path: string } }[]; grouped: readonly { group: RepositoryGroup; open: boolean; items: readonly { repository: { path: string } }[] }[] },
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
	repositories(arranged.loose, null);
	for (const { group, open, items } of arranged.grouped) {
		const head = box(`group:${group.id}`);
		if (head) slots.push({ kind: "group", id: group.id, top: head.top, bottom: head.top + head.height, open });
		if (open) repositories(items, group.id);
	}
	return slots;
}

/**
 * Do what an entry of a repository's menu says. New group... only asks for
 * the name field, with the repository to put in the group it makes.
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
		case "remove":
			void store.removeRepository(repository);
			return;
	}
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
	arranged: { loose: readonly { repository: { path: string } }[]; grouped: readonly { group: RepositoryGroup; items: readonly { repository: { path: string } }[] }[] },
	dragged: string,
	place: { group: string | null; before: string | null },
): RepositoryDropMark | null {
	const home = arranged.grouped.find(shown => shown.items.some(row => row.repository.path === dragged));
	const current = home ? home.group.id : null;
	const destination = place.group === null ? arranged.loose : arranged.grouped.find(shown => shown.group.id === place.group)?.items ?? [];
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
