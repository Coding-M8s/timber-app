import type { Repository, TimberStatus, Worktree } from "../../shared/model";

/** Null until the first look for Timber has answered. */
export type TimberState =
	| null
	| { known: true; status: TimberStatus }
	| { known: false; message: string };

/** The selected worktree, with the repository it was in. Both are paths. */
export interface Selection {
	repository: string;
	worktree: string;
}

/** Something the app is doing right now. */
export type Operation =
	| { kind: "find-timber" }
	| { kind: "reload-all" }
	| { kind: "reload-repository"; repository: string };

/** Why the latest reload failed. `repository` is null when it was a reload of everything. */
export interface ReloadError {
	repository: string | null;
	message: string;
}

/** The one picture of the app that every part of the interface reads. Never changed in place. */
export interface AppState {
	timber: TimberState;
	/** The last good data. A failed reload leaves it as it was. */
	repositories: readonly Repository[];
	/** Whether the list of repositories has been read at least once. */
	loaded: boolean;
	selection: Selection | null;
	operations: readonly Operation[];
	error: ReloadError | null;
}

export const initialState: AppState = {
	timber: null,
	repositories: [],
	loaded: false,
	selection: null,
	operations: [],
	error: null,
};

/** Nothing that depends on Timber is offered until a usable one is found. */
export function timberReady(state: AppState): boolean {
	return state.timber?.known === true && state.timber.status.state === "ready";
}

export function isRunning(state: AppState, kind: Operation["kind"]): boolean {
	return state.operations.some(operation => operation.kind === kind);
}

function firstWorktree(repositories: readonly Repository[]): Selection | null {
	for (const repository of repositories) {
		const worktree = repository.worktrees[0];
		if (worktree) return { repository: repository.path, worktree: worktree.path };
	}
	return null;
}

/** The selection for picking `worktreePath`, or null when no repository has that worktree. */
export function selectionFor(repositories: readonly Repository[], worktreePath: string): Selection | null {
	const repository = repositories.find(candidate => candidate.worktrees.some(worktree => worktree.path === worktreePath));
	return repository ? { repository: repository.path, worktree: worktreePath } : null;
}

/**
 * The selection to hold after the data changed.
 *
 * The selected worktree stays selected for as long as it exists. When it is
 * gone, for example after `timber done`, the selection moves to the primary
 * checkout of the repository it was in. When that repository is gone too, or
 * nothing was selected yet, it moves to the first worktree in the list.
 */
export function reconcileSelection(repositories: readonly Repository[], previous: Selection | null): Selection | null {
	if (!previous) return firstWorktree(repositories);
	const kept = selectionFor(repositories, previous.worktree);
	if (kept) return kept;
	const repository = repositories.find(candidate => candidate.path === previous.repository);
	const fallback = repository?.worktrees.find(worktree => worktree.primary) ?? repository?.worktrees[0];
	if (repository && fallback) return { repository: repository.path, worktree: fallback.path };
	return firstWorktree(repositories);
}

/** The selected worktree and its repository as data, or null when nothing is selected. */
export function selectedWorktree(state: AppState): { repository: Repository; worktree: Worktree } | null {
	if (!state.selection) return null;
	const { repository: repositoryPath, worktree: worktreePath } = state.selection;
	const repository = state.repositories.find(candidate => candidate.path === repositoryPath);
	const worktree = repository?.worktrees.find(candidate => candidate.path === worktreePath);
	return repository && worktree ? { repository, worktree } : null;
}
