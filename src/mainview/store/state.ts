import { type Layout, defaultLayout } from "../../shared/layout";
import type { Repository, TimberStatus, Worktree } from "../../shared/model";

/** Null until the first look for Timber has answered. */
export type TimberState =
	| null
	| { known: true; status: TimberStatus }
	| { known: false; message: string };

/** The selected worktree, with the repository it was in. */
export interface Selection {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's identity (`Worktree.id`), not its path. */
	worktree: string;
}

/** Something the app is doing right now. */
export type Operation =
	| { kind: "find-timber" }
	| { kind: "reload-all" }
	| { kind: "reload-repository"; repository: string }
	| { kind: "add-repository" }
	| { kind: "remove-repository"; repository: string };

/** Why the latest reload failed. `repository` is null when it was a reload of everything. */
export interface ReloadError {
	repository: string | null;
	message: string;
}

/**
 * Why the latest attempt to add or remove a repository left the list as it
 * was. Paths, not names: the interface words it (see format.ts).
 */
export type ListNotice =
	| { kind: "already-listed"; repository: string }
	| { kind: "not-a-repository"; folder: string }
	/** The list comes from the development override. */
	| { kind: "overridden" }
	| { kind: "failed"; action: "add" | "remove"; message: string };

/** A short note that an operation worked. It disappears on its own. */
export interface Toast {
	id: number;
	text: string;
}

/** The dialog open over the window. One at a time. */
export type DialogRequest = { kind: "new-worktree"; repository: string };

/** The views of the selected worktree, in the order of their tabs. */
export const WORKSPACE_TABS = ["workspace", "changes"] as const;
export type WorkspaceTab = typeof WORKSPACE_TABS[number];

/** Why the layout could not be read on start, or could not be saved. What is on screen stays as it is. */
export interface LayoutProblem {
	action: "read" | "save";
	message: string;
}

/** How long a toast stays before it disappears on its own. */
export const TOAST_MILLISECONDS = 5000;

/** The one picture of the app that every part of the interface reads. Never changed in place. */
export interface AppState {
	timber: TimberState;
	/**
	 * The last good data. A failed reload leaves it as it was, and a repository
	 * whose worktrees Timber could not list keeps the ones it had.
	 */
	repositories: readonly Repository[];
	/** Whether the list of repositories has been read at least once. */
	loaded: boolean;
	selection: Selection | null;
	operations: readonly Operation[];
	error: ReloadError | null;
	/** Null once an add or remove worked, or after the person dismissed it. */
	notice: ListNotice | null;
	/** Outcomes that worked, oldest first. Failures are never toasts: they stay where the person can act on them. */
	toasts: readonly Toast[];
	/**
	 * The sidebar width and the collapsed repository groups. The engine
	 * remembers them between runs; this is what is on screen now.
	 */
	layout: Layout;
	/** Null once a save worked, or after the person dismissed it. */
	layoutProblem: LayoutProblem | null;
	/** Which view of the selected worktree shows. */
	tab: WorkspaceTab;
	/** Null when no dialog is open. */
	dialog: DialogRequest | null;
}

export const initialState: AppState = {
	timber: null,
	repositories: [],
	loaded: false,
	selection: null,
	operations: [],
	error: null,
	notice: null,
	toasts: [],
	layout: defaultLayout(),
	layoutProblem: null,
	tab: "workspace",
	dialog: null,
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
		if (worktree) return { repository: repository.path, worktree: worktree.id };
	}
	return null;
}

/** The selection for picking the worktree with this identity, or null when no repository has it. */
export function selectionFor(repositories: readonly Repository[], worktreeId: string): Selection | null {
	const repository = repositories.find(candidate => candidate.worktrees.some(worktree => worktree.id === worktreeId));
	return repository ? { repository: repository.path, worktree: worktreeId } : null;
}

/**
 * What to show for a repository after reading it again. A read in which
 * Timber could not list the worktrees brings its diagnostic and no worktrees,
 * so the last good list stays on screen beside the diagnostic.
 */
export function keepLastGood(previous: Repository | undefined, next: Repository): Repository {
	if (next.failure === null || !previous || previous.worktrees.length === 0) return next;
	return { ...next, worktrees: previous.worktrees };
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
	if (repository && fallback) return { repository: repository.path, worktree: fallback.id };
	return firstWorktree(repositories);
}

/** The selection for arriving at a repository: its primary checkout. Null when it has no worktree. */
export function selectionForRepository(repositories: readonly Repository[], repositoryPath: string): Selection | null {
	const repository = repositories.find(candidate => candidate.path === repositoryPath);
	const worktree = repository?.worktrees.find(candidate => candidate.primary) ?? repository?.worktrees[0];
	return repository && worktree ? { repository: repository.path, worktree: worktree.id } : null;
}

/** The selected worktree and its repository as data, or null when nothing is selected. */
export function selectedWorktree(state: AppState): { repository: Repository; worktree: Worktree } | null {
	if (!state.selection) return null;
	const { repository: repositoryPath, worktree: worktreeId } = state.selection;
	const repository = state.repositories.find(candidate => candidate.path === repositoryPath);
	const worktree = repository?.worktrees.find(candidate => candidate.id === worktreeId);
	return repository && worktree ? { repository, worktree } : null;
}
