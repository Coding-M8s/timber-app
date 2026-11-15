/**
 * Where the main process reports that a repository changed.
 *
 * Whatever notices a change (file watching, a fetch, a finished Timber
 * command) calls `announce` with the path of the repository's primary
 * checkout. The window subscribes and passes the news to the interface, which
 * reloads only that repository. Deciding when something changed is not this
 * module's job.
 */
export interface ChangeFeed {
	announce(path: string): void;
	/** Returns a function that stops listening. */
	subscribe(listener: (path: string) => void): () => void;
}

export function createChangeFeed(): ChangeFeed {
	const listeners = new Set<(path: string) => void>();
	return {
		announce(path) {
			for (const listener of [...listeners]) listener(path);
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
	};
}

/** The one feed of the running app. */
export const repositoryChanges = createChangeFeed();
