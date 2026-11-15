import type { Repository, TimberStatus } from "./model";

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
	listRepositories(): Promise<Repository[]>;
	/**
	 * Read one repository again, named by the path of its primary checkout.
	 * Null when Git could not read it there.
	 */
	loadRepository(path: string): Promise<Repository | null>;
	/**
	 * Hear when the machine reports that a repository changed. The listener gets
	 * the path of its primary checkout. Returns a function that stops listening.
	 */
	onRepositoryChanged(listener: (path: string) => void): () => void;
}
