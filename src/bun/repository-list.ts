import { basename } from "node:path";
import type { AddRepositoryResult, RemoveRepositoryResult, ReorderRepositoriesResult, ReorderWorktreesResult, Repository, RepositoryGroupsResult } from "../shared/model";
import { applyOrder, sameOrder } from "../shared/repository-order";
import { forgetGroup, forgetRepository } from "../shared/layout";
import { forgetPullRepository } from "../shared/pull-confirm-setting";
import { type RepositoryAgents, pickOf, repositoryAgentsOf } from "../shared/repository-agents";
import { withIcon } from "../shared/sidebar-icons";
import {
	type GroupChange,
	type GroupedList,
	type RepositoryGroups,
	createGroupIn,
	deleteGroupIn,
	emptyGroups,
	groupsOfList,
	moveGroupIn,
	placeIn,
	renameGroupIn,
} from "../shared/repository-groups";
import { type SavedRepository, type Settings, readWorktreeOrder } from "../shared/settings";
import { commonDirectory, overrideRepositoryPaths } from "./git-engine";
import { type RepositoryReader, failedRepository } from "./repository-reader";
import type { WatchTarget } from "./repository-watcher";
import { type SettingsHolder, createSettingsHolder } from "./settings";
import { messageOf } from "../shared/error-message";

export interface RepositoryListOptions {
	/** The settings file that holds the list. */
	settingsFile: string;
	/**
	 * The holder of that file, when something else saves to it as well, as the
	 * layout does. Without one the list holds the file on its own.
	 */
	settings?: SettingsHolder;
	/** Open the native folder picker. Null when the person cancelled. */
	pickFolder: () => Promise<string | null>;
	/**
	 * Reads a repository and its worktrees. With `recent`, `findRecent` may
	 * answer with a listing that was just read, and with `known`, `findKnown`
	 * with the last one read (see ./recent-listings.ts).
	 */
	reader: RepositoryReader & { recent?(path: string): Promise<Repository | null>; known?(path: string): Promise<Repository | null> | null };
	environment?: Record<string, string | undefined>;
	warn?: (message: string) => void;
}

/**
 * The repositories the app shows, saved in the settings file.
 *
 * Adding and removing only ever change that file. Reading a repository is
 * read-only, and nothing in a repository or its folder is touched.
 */
export interface RepositoryList {
	/**
	 * Every saved repository. One that Git cannot read any more is still listed, as unavailable.
	 * A saved worktree order loses the paths a listing that worked no longer names (see `withoutRemoved`).
	 */
	list(): Promise<Repository[]>;
	/** Ask for a folder with the picker, then add the repository it belongs to. */
	add(): Promise<AddRepositoryResult>;
	/** Add the repository that `folder` belongs to: its primary checkout or any of its worktrees. */
	addFolder(folder: string): Promise<AddRepositoryResult>;
	/** Forget a repository, named by the path of its primary checkout. Safe to call again. */
	remove(path: string): Promise<RemoveRepositoryResult>;
	/** Save the list in the order `order` names, by primary checkout. See `Engine.reorderRepositories`. */
	reorder(order: readonly string[]): Promise<ReorderRepositoriesResult>;
	/** Save the order of one repository's worktrees, by path. See `Engine.reorderWorktrees`. */
	reorderWorktrees(repository: string, order: readonly string[]): Promise<ReorderWorktreesResult>;
	/** Read one repository again, named by the path of its primary checkout. See `RepositoryReader.reload`. Its saved worktree order is tidied as `list` tidies it. */
	reload(path: string): Promise<Repository | null>;
	/** Whether `path` is the primary checkout of a repository in the list. Commands that change a repository run only in these. */
	includes(path: string): Promise<boolean>;
	/**
	 * The repository in the list whose primary checkout is `path`, read again.
	 * Null when the list has no such repository, whatever is in that folder.
	 * Commands that change a repository use this, so they only ever act on one
	 * the app shows.
	 */
	find(path: string): Promise<Repository | null>;
	/**
	 * As `find`, but may answer with the listing the sidebar just read, when no
	 * change of the repository was heard since. Only for views that read and
	 * change nothing, such as the Changes view and chops.
	 */
	findRecent(path: string): Promise<Repository | null>;
	/**
	 * The last listing of the repository in the list whose primary checkout is
	 * `path`, when no change of it was heard since and its watch is working
	 * (see `RecentListings.known`). Null when there is none, or no such
	 * repository: nothing is read, and the caller asks `find`. Only for
	 * opening a session or the external editor (see `findListedWorktree`).
	 */
	findKnown(path: string): Promise<Repository | null>;
	/**
	 * The repositories to watch for changes: the primary checkout of each, with
	 * its common Git directory. From the saved list without asking Timber, or,
	 * with the override, from the repositories it lists. Read-only.
	 */
	watchTargets(): Promise<WatchTarget[]>;
	/** The saved groups. See `Engine.listRepositoryGroups`. */
	listGroups(): Promise<RepositoryGroups>;
	/** The default agent each repository names. See `Engine.listRepositoryAgents`. */
	listAgents(): Promise<RepositoryAgents>;
	/** The default agent one repository names, or null for none. */
	agentOf(path: string): Promise<string | null>;
	/** See `Engine.createRepositoryGroup`. */
	createGroup(name: string, repository?: string, parent?: string): Promise<RepositoryGroupsResult>;
	/** See `Engine.renameRepositoryGroup`. */
	renameGroup(id: string, name: string): Promise<RepositoryGroupsResult>;
	/** See `Engine.deleteRepositoryGroup`. */
	deleteGroup(id: string): Promise<RepositoryGroupsResult>;
	/** See `Engine.moveRepositoryGroup`. */
	moveGroup(id: string, parent: string | null, before: string | null): Promise<RepositoryGroupsResult>;
	/** See `Engine.placeRepository`. */
	place(path: string, group: string | null, order?: readonly string[]): Promise<RepositoryGroupsResult>;
}

/** The saved list as grouping sees it. */
const groupedList = (settings: Settings): GroupedList<SavedRepository> => ({ groups: settings.groups ?? [], repositories: settings.repositories });

/** What the interface is told about the saved groups. */
const groupsOf = (settings: Settings): RepositoryGroups => groupsOfList(groupedList(settings));

/** `repository` with its worktrees in the order saved for it, if any. */
function inSavedOrder(repository: Repository, saved: readonly SavedRepository[]): Repository {
	const order = saved.find(entry => entry.path === repository.path)?.worktreeOrder;
	if (!order || order.length === 0) return repository;
	const worktrees = applyOrder(repository.worktrees, order);
	return sameOrder(worktrees, repository.worktrees) ? repository : { ...repository, worktrees };
}

/**
 * `entry` without the paths of its worktree order that `listing` no longer
 * names, so a worktree made later at the same path is shown at the end. Null
 * when nothing would change: there is no order, or the listing did not work
 * (a repository that is missing or that Timber could not list keeps it).
 */
export function withoutRemoved(entry: SavedRepository, listing: Repository): SavedRepository | null {
	if (!entry.worktreeOrder || !listing.available || listing.failure !== null) return null;
	const listed = new Set(listing.worktrees.map(worktree => worktree.path));
	const kept = entry.worktreeOrder.filter(path => listed.has(path));
	if (kept.length === entry.worktreeOrder.length) return null;
	const { worktreeOrder: _, ...rest } = entry;
	return kept.length > 0 ? { ...rest, worktreeOrder: kept } : rest;
}

function unavailable(path: string): Repository {
	return { path, name: basename(path) || path, available: false, failure: null, setup: "unknown", fallbackBase: null, worktrees: [] };
}

export function createRepositoryList(options: RepositoryListOptions): RepositoryList {
	const { settingsFile, pickFolder, reader, environment = process.env, warn = console.warn } = options;

	// Read once, then kept in step with the file: memory changes only after a save worked.
	// Changes run one after another, so two of them cannot save over each other.
	const holder = options.settings ?? createSettingsHolder(settingsFile, warn);
	const settings = () => holder.current();
	const save = (next: Settings) => holder.save(next);
	const inTurn = <Result>(task: () => Promise<Result>) => holder.inTurn(task);

	const overridden = () => overrideRepositoryPaths(environment) !== null;

	// A count of worktree orders saved, and the count each repository's was last saved at in this run.
	// An order saved after a listing started may name a worktree newer than that listing, so tidying keeps it.
	let orderSaves = 0;
	const orderSavedAt = new Map<string, number>();

	/** Drop the paths of saved worktree orders that `listings`, read since `mark`, no longer name. Only tidying: a save that fails waits for the next listing. */
	async function forgetRemoved(listings: readonly Repository[], mark: number): Promise<void> {
		const tidied = (current: Settings) => {
			let changed = false;
			const next = current.repositories.map(entry => {
				const listing = listings.find(repository => repository.path === entry.path);
				if (!listing || (orderSavedAt.get(entry.path) ?? 0) > mark) return entry;
				const kept = withoutRemoved(entry, listing);
				if (!kept) return entry;
				changed = true;
				return kept;
			});
			return changed ? next : null;
		};
		// Most listings drop nothing: those never wait for the other changes to the file.
		if (tidied(await settings()) === null) return;
		await inTurn(async () => {
			const current = await settings();
			const next = tidied(current);
			if (next === null) return;
			try {
				await save({ ...current, repositories: next });
			} catch {
				// The next listing tries again.
			}
		});
	}

	function addFolder(folder: string): Promise<AddRepositoryResult> {
		if (overridden()) return Promise.resolve({ outcome: "overridden" });
		return inTurn(async () => {
			const commonDir = await commonDirectory(folder);
			// Asking from a linked worktree answers with the repository it belongs to.
			const read = commonDir === null ? null : await reader.find(folder);
			if (commonDir === null || read === null || read.outcome === "not-a-repository") return { outcome: "not-a-repository", folder };
			// Without Timber's answer the primary checkout is not known, so there is nothing to save.
			if (read.outcome === "failed") return { outcome: "failed", message: read.message };
			const { repository } = read;

			const current = await settings();
			const known = current.repositories.find(entry => entry.commonDir === commonDir || entry.path === repository.path);
			if (known) return { outcome: "already-listed", repository: known.path };

			try {
				await save({ ...current, repositories: [...current.repositories, { path: repository.path, commonDir }] });
			} catch (error) {
				return { outcome: "failed", message: `Could not save settings to ${settingsFile}: ${messageOf(error)}` };
			}
			return { outcome: "added", repository };
		});
	}

	/**
	 * Run a change to the groups in turn with every other change to the file, and save once when it changes
	 * anything. `change` builds what is saved, from the list as grouping sees it and the settings it came from.
	 */
	function changeGroups(change: (list: GroupedList<SavedRepository>) => GroupChange<SavedRepository>, also?: (next: Settings) => Settings): Promise<RepositoryGroupsResult> {
		if (overridden()) return Promise.resolve({ outcome: "overridden" });
		return inTurn(async () => {
			const current = await settings();
			const changed = change(groupedList(current));
			if (changed.outcome === "unchanged") return { outcome: "saved", groups: groupsOf(current) };
			if (changed.outcome !== "changed") return changed;
			const grouped: Settings = { ...current, repositories: changed.next.repositories, groups: changed.next.groups };
			const next = also ? also(grouped) : grouped;
			try {
				await save(next);
			} catch (error) {
				return { outcome: "failed", message: `Could not save settings to ${settingsFile}: ${messageOf(error)}` };
			}
			return { outcome: "saved", groups: groupsOf(next) };
		});
	}

	/** The repositories that own the given folders, each once. A folder outside any repository is skipped. */
	async function listOverride(folders: readonly string[]): Promise<Repository[]> {
		const reads = await Promise.all(folders.map(async folder => ({ folder, read: await reader.find(folder) })));
		const seen = new Set<string>();
		const listed: Repository[] = [];
		for (const { folder, read } of reads) {
			if (read.outcome === "not-a-repository") continue;
			const repository = read.outcome === "read" ? read.repository : failedRepository(folder, read.message);
			if (seen.has(repository.path)) continue;
			seen.add(repository.path);
			listed.push(repository);
		}
		return listed;
	}

	return {
		async list() {
			const override = overrideRepositoryPaths(environment);
			if (override) return listOverride(override);
			const mark = orderSaves;
			const { repositories } = await settings();
			// The order is read after the repository is, so a save that finished while Git was read still shows.
			const listed = await Promise.all(repositories.map(async entry => inSavedOrder(await reader.reload(entry.path) ?? unavailable(entry.path), (await settings()).repositories)));
			await forgetRemoved(listed, mark);
			return listed;
		},

		async add() {
			if (overridden()) return { outcome: "overridden" };
			let folder: string | null;
			try {
				folder = await pickFolder();
			} catch (error) {
				return { outcome: "failed", message: `Could not open the folder picker: ${messageOf(error)}` };
			}
			return folder === null ? { outcome: "cancelled" } : addFolder(folder);
		},

		addFolder,

		async reload(path) {
			const mark = orderSaves;
			const repository = await reader.reload(path);
			if (!repository) return null;
			if (!overridden()) await forgetRemoved([repository], mark);
			return inSavedOrder(repository, (await settings()).repositories);
		},

		async includes(path) {
			const override = overrideRepositoryPaths(environment);
			if (override) return (await listOverride(override)).some(repository => repository.path === path);
			return (await settings()).repositories.some(entry => entry.path === path);
		},

		async find(path) {
			const override = overrideRepositoryPaths(environment);
			if (override) return (await listOverride(override)).find(repository => repository.path === path) ?? null;
			const { repositories } = await settings();
			if (!repositories.some(entry => entry.path === path)) return null;
			return inSavedOrder(await reader.reload(path) ?? unavailable(path), (await settings()).repositories);
		},

		async findRecent(path) {
			const override = overrideRepositoryPaths(environment);
			if (override) return (await listOverride(override)).find(repository => repository.path === path) ?? null;
			const { repositories } = await settings();
			if (!repositories.some(entry => entry.path === path)) return null;
			return inSavedOrder(await (reader.recent ?? reader.reload)(path) ?? unavailable(path), (await settings()).repositories);
		},

		async findKnown(path) {
			// The override's repositories are read on every ask, as `find` reads them.
			if (overrideRepositoryPaths(environment)) return null;
			const { repositories } = await settings();
			if (!repositories.some(entry => entry.path === path)) return null;
			const kept = reader.known?.(path) ?? null;
			const repository = kept === null ? null : await kept;
			return repository === null ? null : inSavedOrder(repository, (await settings()).repositories);
		},

		async watchTargets() {
			const override = overrideRepositoryPaths(environment);
			if (!override) return (await settings()).repositories.map(({ path, commonDir }) => ({ path, commonDir }));
			const listed = await listOverride(override);
			const targets = await Promise.all(listed.map(async ({ path }) => {
				const commonDir = await commonDirectory(path);
				return commonDir === null ? null : { path, commonDir };
			}));
			return targets.filter(target => target !== null);
		},

		reorder(order) {
			if (overridden()) return Promise.resolve({ outcome: "overridden" });
			return inTurn(async () => {
				const current = await settings();
				const repositories = applyOrder(current.repositories, order);
				// Already in that order: nothing to write.
				if (sameOrder(repositories, current.repositories)) return { outcome: "saved" };
				try {
					await save({ ...current, repositories });
				} catch (error) {
					return { outcome: "failed", message: `Could not save settings to ${settingsFile}: ${messageOf(error)}` };
				}
				return { outcome: "saved" };
			});
		},

		reorderWorktrees(repository, order) {
			if (overridden()) return Promise.resolve({ outcome: "overridden" });
			return inTurn(async () => {
				const current = await settings();
				const entry = current.repositories.find(candidate => candidate.path === repository);
				// A repository that is not listed has nothing to save an order for.
				if (!entry) return { outcome: "saved" };
				const worktreeOrder = readWorktreeOrder(order);
				const saved = entry.worktreeOrder ?? [];
				if (worktreeOrder.length === saved.length && worktreeOrder.every((path, at) => path === saved[at])) return { outcome: "saved" };
				const { worktreeOrder: _, ...rest } = entry;
				const next: SavedRepository = worktreeOrder.length > 0 ? { ...rest, worktreeOrder } : rest;
				try {
					await save({ ...current, repositories: current.repositories.map(candidate => candidate === entry ? next : candidate) });
				} catch (error) {
					return { outcome: "failed", message: `Could not save settings to ${settingsFile}: ${messageOf(error)}` };
				}
				orderSavedAt.set(repository, ++orderSaves);
				return { outcome: "saved" };
			});
		},

		async listGroups() {
			if (overridden()) return emptyGroups();
			return groupsOf(await settings());
		},

		async listAgents() {
			if (overridden()) return {};
			return repositoryAgentsOf((await settings()).repositories);
		},

		async agentOf(path) {
			if (overridden()) return null;
			return pickOf(repositoryAgentsOf((await settings()).repositories), path);
		},

		createGroup: (name, repository, parent) => changeGroups(list => createGroupIn(list, crypto.randomUUID(), name, repository, parent ?? null)),

		renameGroup: (id, name) => changeGroups(list => renameGroupIn(list, id, name)),

		// Whether the group was folded, and its icon, are remembered by its id, so they go in the same save.
		deleteGroup: id => changeGroups(list => deleteGroupIn(list, id), next => ({
			...next,
			...(next.layout ? { layout: forgetGroup(next.layout, id) } : {}),
			...(next.icons ? { icons: withIcon(next.icons, { kind: "group", id }, null) } : {}),
		})),

		moveGroup: (id, parent, before) => changeGroups(list => moveGroupIn(list, id, parent, before)),

		place: (path, group, order) => changeGroups(list => placeIn(list, path, group, order)),

		remove(path) {
			if (overridden()) return Promise.resolve({ outcome: "overridden" });
			return inTurn(async () => {
				const current = await settings();
				const repositories = current.repositories.filter(entry => entry.path !== path);
				if (repositories.length === current.repositories.length) return { outcome: "removed" };
				// A collapsed group, a dismissed setup prompt, the board's list, its "Skip pull confirmation", and its icon are remembered by this path, so they go with the entry, as its default agent does.
				const next: Settings = { ...current, repositories };
				if (current.layout) next.layout = forgetRepository(current.layout, path);
				if (current.preferences) next.preferences = { ...current.preferences, pull: forgetPullRepository(current.preferences.pull, path) };
				if (current.icons) next.icons = withIcon(current.icons, { kind: "repository", path }, null);
				try {
					await save(next);
				} catch (error) {
					return { outcome: "failed", message: `Could not save settings to ${settingsFile}: ${messageOf(error)}` };
				}
				return { outcome: "removed" };
			});
		},
	};
}
