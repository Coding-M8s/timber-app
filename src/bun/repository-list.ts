import { basename } from "node:path";
import type { AddRepositoryResult, RemoveRepositoryResult, Repository } from "../shared/model";
import type { Settings } from "../shared/settings";
import { commonDirectory, listRepositories, loadRepository, overrideRepositoryPaths, reloadRepository } from "./git-engine";
import { readSettings, writeSettings } from "./settings";

export interface RepositoryListOptions {
	/** The settings file that holds the list. */
	settingsFile: string;
	/** Open the native folder picker. Null when the person cancelled. */
	pickFolder: () => Promise<string | null>;
	environment?: Record<string, string | undefined>;
	warn?: (message: string) => void;
}

/**
 * The repositories the app shows, saved in the settings file.
 *
 * Adding and removing only ever change that file. The Git calls here are
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
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function unavailable(path: string): Repository {
	return { path, name: basename(path) || path, available: false, worktrees: [] };
}

export function createRepositoryList(options: RepositoryListOptions): RepositoryList {
	const { settingsFile, pickFolder, environment = process.env, warn = console.warn } = options;

	// Read once, then kept in step with the file: memory changes only after a save worked.
	let saved: Promise<Settings> | null = null;
	const settings = () => saved ??= readSettings(settingsFile, warn);

	// Changes run one after another, so two of them cannot save over each other.
	let last: Promise<unknown> = Promise.resolve();
	function inTurn<Result>(task: () => Promise<Result>): Promise<Result> {
		const run = last.then(task);
		last = run.catch(() => {});
		return run;
	}

	const overridden = () => overrideRepositoryPaths(environment) !== null;

	async function save(next: Settings): Promise<void> {
		await writeSettings(settingsFile, next);
		saved = Promise.resolve(next);
	}

	function addFolder(folder: string): Promise<AddRepositoryResult> {
		if (overridden()) return Promise.resolve({ outcome: "overridden" });
		return inTurn(async () => {
			const commonDir = await commonDirectory(folder);
			// Asking from a linked worktree answers with the repository it belongs to.
			const repository = commonDir === null ? null : await loadRepository(folder);
			if (commonDir === null || repository === null) return { outcome: "not-a-repository", folder };

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

	return {
		async list() {
			const override = overrideRepositoryPaths(environment);
			if (override) return listRepositories(override);
			const { repositories } = await settings();
			return Promise.all(repositories.map(async entry => await reloadRepository(entry.path) ?? unavailable(entry.path)));
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

		remove(path) {
			if (overridden()) return Promise.resolve({ outcome: "overridden" });
			return inTurn(async () => {
				const current = await settings();
				const repositories = current.repositories.filter(entry => entry.path !== path);
				if (repositories.length === current.repositories.length) return { outcome: "removed" };
				try {
					await save({ ...current, repositories });
				} catch (error) {
					return { outcome: "failed", message: `Could not save settings to ${settingsFile}: ${messageOf(error)}` };
				}
				return { outcome: "removed" };
			});
		},
	};
}
