/**
 * Commands that change a repository take turns: one runs at a time in each
 * repository, in the order they were asked for, so two never work on its
 * worktrees or branches at once. One instance is shared by everything that
 * runs such a command (see ./index.ts).
 */
export interface RepositoryTurns {
	/** Run `task` once every earlier task of the same repository has ended, however it ended. */
	inTurn<Result>(repository: string, task: () => Promise<Result>): Promise<Result>;
}

export function createRepositoryTurns(): RepositoryTurns {
	const queues = new Map<string, Promise<unknown>>();
	return {
		inTurn(repository, task) {
			const run = (queues.get(repository) ?? Promise.resolve()).then(task);
			const settled = run.catch(() => {}).then(() => {
				if (queues.get(repository) === settled) queues.delete(repository);
			});
			queues.set(repository, settled);
			return run;
		},
	};
}
