import type { AddRepositoryResult, RemoveRepositoryResult, Repository, TimberStatus } from "./model";

/**
 * Everything the interface may ask of the machine it runs on.
 *
 * The interface only ever talks to this contract. The desktop app answers it
 * from the Bun main process; the browser build answers it from sample data.
 * Grow it one capability at a time, and keep every method safe to call again.
 */
export interface Engine {
	/** Whether a usable Timber is installed, as of the last look. */
	timberStatus(): Promise<TimberStatus>;
	/** Look for Timber again, for example after the person installed it. */
	recheckTimber(): Promise<TimberStatus>;
	/**
	 * The saved repositories, each with exactly the worktrees Timber lists, in
	 * Timber's order. One whose folder is missing is still listed, marked
	 * unavailable. One whose worktrees Timber could not list has `failure` set
	 * and no worktrees, never part of a list.
	 */
	listRepositories(): Promise<Repository[]>;
	/**
	 * Open the native folder picker and add the repository that the picked
	 * folder belongs to, which may be one of its linked worktrees. The list is
	 * saved, so it is still there after a restart.
	 */
	addRepository(): Promise<AddRepositoryResult>;
	/**
	 * Forget a repository, named by the path of its primary checkout. This only
	 * changes the app's saved list, never anything in the repository or its
	 * folder.
	 */
	removeRepository(path: string): Promise<RemoveRepositoryResult>;
	/**
	 * Read one repository again, named by the path of its primary checkout.
	 * Null when Git could not read it there. As in `listRepositories`, a
	 * repository whose worktrees Timber could not list has `failure` set.
	 */
	loadRepository(path: string): Promise<Repository | null>;
	/**
	 * Hear when the machine reports that a repository changed. The listener gets
	 * the path of its primary checkout. Returns a function that stops listening.
	 */
	onRepositoryChanged(listener: (path: string) => void): () => void;
}
