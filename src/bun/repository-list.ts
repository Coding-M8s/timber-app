import { basename } from "node:path";
import type { AddRepositoryResult, RemoveRepositoryResult, ReorderRepositoriesResult, Repository, RepositoryGroupsResult } from "../shared/model";
import { applyOrder, sameOrder } from "../shared/repository-order";
import { forgetGroup, forgetRepository } from "../shared/layout";
import { forgetPullRepository } from "../shared/pull-confirm-setting";
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
import type { SavedRepository, Settings } from "../shared/settings";
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
	 * answer with a listing that was just read (see ./recent-listings.ts).
	 */
	reader: RepositoryReader & { recent?(path: string): Promise<Repository | null> };
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
	/** Every saved repository. One that Git cannot read any more is still listed, as unavailable. */
	list(): Promise<Repository[]>;
	/** Ask for a folder with the picker, then add the repository it belongs to. */
	add(): Promise<AddRepositoryResult>;
	/** Add the repository that `folder` belongs to: its primary checkout or any of its worktrees. */
	addFolder(folder: string): Promise<AddRepositoryResult>;
	/** Forget a repository, named by the path of its primary checkout. Safe to call again. */
	remove(path: string): Promise<RemoveRepositoryResult>;
	/** Save the list in the order `order` names, by primary checkout. See `Engine.reorderRepositories`. */
	reorder(order: readonly string[]): Promise<ReorderRepositoriesResult>;
	/** Read one repository again, named by the path of its primary checkout. See `RepositoryReader.reload`. */
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
	 * The repositories to watch for changes: the primary checkout of each, with
	 * its common Git directory. From the saved list without asking Timber, or,
	 * with the override, from the repositories it lists. Read-only.
	 */
	watchTargets(): Promise<WatchTarget[]>;
	/** The saved groups. See `Engine.listRepositoryGroups`. */
	listGroups(): Promise<RepositoryGroups>;
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

function unavailable(path: string): Repository {
	return { path, name: basename(path) || path, available: false, failure: null, setup: "unknown", worktrees: [] };
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
			const { repositories } = await settings();
			return Promise.all(repositories.map(async entry => await reader.reload(entry.path) ?? unavailable(entry.path)));
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

		reload: path => reader.reload(path),

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
			return await reader.reload(path) ?? unavailable(path);
		},

		async findRecent(path) {
			const override = overrideRepositoryPaths(environment);
			if (override) return (await listOverride(override)).find(repository => repository.path === path) ?? null;
			const { repositories } = await settings();
			if (!repositories.some(entry => entry.path === path)) return null;
			return await (reader.recent ?? reader.reload)(path) ?? unavailable(path);
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

		async listGroups() {
			if (overridden()) return emptyGroups();
			return groupsOf(await settings());
		},

		createGroup: (name, repository, parent) => changeGroups(list => createGroupIn(list, crypto.randomUUID(), name, repository, parent ?? null)),

		renameGroup: (id, name) => changeGroups(list => renameGroupIn(list, id, name)),

		// Whether the group was folded is remembered by its id, so that goes in the same save.
		deleteGroup: id => changeGroups(list => deleteGroupIn(list, id), next => next.layout ? { ...next, layout: forgetGroup(next.layout, id) } : next),

		moveGroup: (id, parent, before) => changeGroups(list => moveGroupIn(list, id, parent, before)),

		place: (path, group, order) => changeGroups(list => placeIn(list, path, group, order)),

		remove(path) {
			if (overridden()) return Promise.resolve({ outcome: "overridden" });
			return inTurn(async () => {
				const current = await settings();
				const repositories = current.repositories.filter(entry => entry.path !== path);
				if (repositories.length === current.repositories.length) return { outcome: "removed" };
				// A collapsed group, a dismissed setup prompt, the board's list, and its "Skip pull confirmation" are remembered by this path, so they go with the entry.
				const next: Settings = { ...current, repositories };
				if (current.layout) next.layout = forgetRepository(current.layout, path);
				if (current.preferences) next.preferences = { ...current.preferences, pull: forgetPullRepository(current.preferences.pull, path) };
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
