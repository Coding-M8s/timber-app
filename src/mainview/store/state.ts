import type { FileChange, FileChangeTarget, FileDiffResult } from "../../shared/file-changes";
import { type Layout, defaultLayout } from "../../shared/layout";
import type { RepositoryFetch } from "../../shared/git-fetch";
import type { PullRequestList } from "../../shared/pull-requests";
import type { Repository, TimberFailure, TimberStatus, Worktree } from "../../shared/model";
import { type Preferences, defaultPreferences } from "../../shared/preferences";
import type { TerminalSession } from "../../shared/terminal";

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
	| { kind: "remove-repository"; repository: string }
	/** Starting the editor for a worktree, named by its registered path. */
	| { kind: "open-in-editor"; worktree: string }
	/** Starting a session in a worktree, named by its identity (`Worktree.id`): the shell, or the agent named. */
	| { kind: "open-terminal"; worktree: string; agent: string | null }
	/** Ending a terminal session, named by its id. */
	| { kind: "close-terminal"; session: string }
	/** Reading the changed files of a worktree, named by its identity (`Worktree.id`). */
	| { kind: "read-changes"; worktree: string }
	/** Reading the diff of one changed file of a worktree, named by its identity. */
	| { kind: "read-diff"; worktree: string }
	/** Fetching a repository because the person asked, named by the path of its primary checkout. */
	| { kind: "fetch-repository"; repository: string };

/**
 * The Changes tab of one worktree: its changed files as last read, and the
 * diff of the selected one. Read only while the tab shows, and started afresh
 * for another worktree.
 */
export interface ChangesView {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's identity (`Worktree.id`). */
	worktree: string;
	/** Null until the first read answered. A failed read keeps the last good list. */
	files: readonly FileChange[] | null;
	/** More files changed than are listed. */
	more: boolean;
	/** Why the latest read failed. Null once one worked. */
	problem: string | null;
	selected: FileChangeTarget | null;
	/** The diff of `selected`. Null while the first read of it runs. A newer read replaces it when it answers. */
	diff: FileDiffResult | null;
}

/** Why a session did not start. It stays until dismissed, or until a session starts in that worktree. */
export interface TerminalProblem {
	/** The worktree's identity (`Worktree.id`). */
	worktree: string;
	/** The agent that did not start, by name, or null for the shell. */
	agent: string | null;
	message: string;
	/** The command that failed, as one line, when it is known. */
	command: string | null;
}

/** Why the latest reload failed. `repository` is null when it was a reload of everything. */
export interface ReloadError {
	repository: string | null;
	message: string;
}

/**
 * Why the latest attempt to add, remove, or reorder repositories left the
 * list as it was. Paths, not names: the interface words it (see format.ts).
 */
export type ListNotice =
	| { kind: "already-listed"; repository: string }
	| { kind: "not-a-repository"; folder: string }
	/** The list comes from the development override. */
	| { kind: "overridden" }
	| { kind: "failed"; action: "add" | "remove" | "reorder"; message: string };

/**
 * A short note that an operation ended. It disappears on its own. Most say
 * that something worked. A `problem` toast only points at a failure that
 * stays where the person can act on it, such as a removal that ran in the
 * background: the toast never holds the details itself.
 */
export interface Toast {
	id: number;
	text: string;
	problem?: true;
}

/** Where a removal that Done started stands. */
export type RemovalStatus =
	| { kind: "running" }
	/**
	 * Timber did not finish. `gone` is true when the worktree had left the
	 * list once the repository was read again, as after a partial failure in
	 * which the folder was removed and the branch was not.
	 */
	| { kind: "failed"; failure: TimberFailure; gone: boolean };

/**
 * A removal of one worktree with `timber __ide-done apply`, which runs in the
 * background once Remove is pressed. It is named by the repository and the
 * worktree's registered path, which stay the same while the folder is being
 * deleted (its identity does not).
 */
export interface Removal {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree as the list had it when Remove was pressed, so it can be named once it is gone. */
	worktree: Worktree;
	/** What the toast says when the removal worked. */
	toast: string;
	status: RemovalStatus;
}

/** The dialog open over the window. One at a time. */
export type DialogRequest =
	| { kind: "new-worktree"; repository: string }
	/** Remove a worktree. `repository` is the path of the primary checkout, `worktree` is `Worktree.id`. */
	| { kind: "done-worktree"; repository: string; worktree: string }
	/** Rebase a worktree with Timber, in a new session. Named as for Done. */
	| { kind: "rebase-worktree"; repository: string; worktree: string }
	/** The app's settings, open at one section, or at the first when none is named. */
	| { kind: "settings"; section?: SettingsSection }
	/** The setup wizard of a repository new to Timber, named by the path of its primary checkout. */
	| { kind: "set-up-timber"; repository: string };

/** The sections of the Settings dialog, in the order they are listed. */
export const SETTINGS_SECTIONS = ["layout", "theme", "terminal", "editor", "agents", "notifications", "fetch", "about", "machine", "repository"] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];

/** The views of the selected worktree, in the order of their tabs. */
export const WORKSPACE_TABS = ["workspace", "changes", "pull-request"] as const;
export type WorkspaceTab = typeof WORKSPACE_TABS[number];

/** Why the layout could not be read on start, or could not be saved. What is on screen stays as it is. */
export interface LayoutProblem {
	action: "read" | "save";
	message: string;
}

/**
 * Why "Open in editor" did not open a worktree. It stays until it is
 * dismissed, or until opening a worktree in the editor next works.
 */
export interface EditorProblem {
	kind: "terminal-editor" | "not-listed" | "not-found" | "failed";
	/** The worktree's registered path. */
	worktree: string;
	/** The file that was to be opened, relative to the worktree, or null for the worktree's folder. */
	file: string | null;
	/** The exact command, as shown, or null when none was built. */
	command: string | null;
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
	/**
	 * Outcomes, oldest first. A failure is never only a toast: it stays where
	 * the person can act on it, and a toast can at most point there.
	 */
	toasts: readonly Toast[];
	/**
	 * Removals that run, and removals that failed and are not dismissed yet,
	 * at most one per worktree. Kept in the window only: reloading it forgets
	 * them, while Timber goes on in the main process.
	 */
	removals: readonly Removal[];
	/**
	 * The sidebar width, the collapsed repository groups, and the dismissed
	 * setup prompts. The engine remembers them between runs; this is what is
	 * on screen now.
	 */
	layout: Layout;
	/** Null once a save worked, or after the person dismissed it. */
	layoutProblem: LayoutProblem | null;
	/**
	 * The app's own settings as last saved, such as the side of the sidebar.
	 * They change only when the engine says a save worked.
	 */
	preferences: Preferences;
	/** Why the saved preferences could not be read on start. Null once a save worked. */
	preferencesProblem: string | null;
	/** The app's own version, for About. Null until the engine has answered. */
	appVersion: string | null;
	/** Why the last "Open in editor" opened nothing. Null once one worked, or after the person dismissed it. */
	editorProblem: EditorProblem | null;
	/**
	 * The terminal sessions the engine holds, running or exited, as it last
	 * reported them, in the order they started. A worktree can have several.
	 */
	terminals: readonly TerminalSession[];
	/**
	 * The session whose chip is chosen in each worktree, by the worktree's
	 * identity. A worktree that is missing here, or whose chosen session is
	 * gone, shows its first session (see `shownSession`).
	 */
	shownSessions: Readonly<Record<string, string>>;
	/** Sessions that printed something since they were last on screen, by id. */
	unseenSessions: readonly string[];
	terminalProblem: TerminalProblem | null;
	/**
	 * How many terminals ran when the app was asked to quit, while the
	 * question is on screen. Null when nothing is asked.
	 */
	quitRequest: number | null;
	/** Which view of the selected worktree shows. */
	tab: WorkspaceTab;
	/** The Changes tab as last read. Null before it was first shown. */
	changes: ChangesView | null;
	/** Null when no dialog is open. */
	dialog: DialogRequest | null;
	/**
	 * Where fetching stands for each repository, by the path of its primary
	 * checkout, as the engine last reported it. A repository missing here
	 * has not been fetched since the app started.
	 */
	fetches: Readonly<Record<string, RepositoryFetch>>;
	/**
	 * Each worktree's pull request, by the path of its repository's primary
	 * checkout, as `timber __app-pr` last answered. A repository missing here
	 * was not read yet. Read when a repository is first listed and after each
	 * fetch of it ends, so on the fetch interval and after Fetch now.
	 */
	pullRequests: Readonly<Record<string, PullRequestList>>;
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
	removals: [],
	layout: defaultLayout(),
	layoutProblem: null,
	preferences: defaultPreferences(),
	preferencesProblem: null,
	appVersion: null,
	editorProblem: null,
	terminals: [],
	shownSessions: {},
	unseenSessions: [],
	terminalProblem: null,
	quitRequest: null,
	tab: "workspace",
	changes: null,
	dialog: null,
	fetches: {},
	pullRequests: {},
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

/** The sessions of a worktree, named by its identity, running or exited, in the order they started. */
export function sessionsOf(state: Pick<AppState, "terminals">, worktreeId: string): TerminalSession[] {
	return state.terminals.filter(session => session.worktree === worktreeId);
}

/** How many sessions of a worktree still run. */
export function runningSessionCount(state: Pick<AppState, "terminals">, worktreeId: string): number {
	return sessionsOf(state, worktreeId).filter(session => session.state.kind === "running").length;
}

/**
 * The session whose chip is chosen in a worktree: the one chosen last, or
 * the first when that one is gone or none was chosen. Null when the worktree
 * has no session.
 */
export function shownSession(state: Pick<AppState, "terminals" | "shownSessions">, worktreeId: string): TerminalSession | null {
	const sessions = sessionsOf(state, worktreeId);
	const chosen = state.shownSessions[worktreeId];
	return sessions.find(session => session.id === chosen) ?? sessions[0] ?? null;
}

/** The session on screen right now: the chosen one of the selected worktree, while the Workspace tab shows. */
export function sessionOnScreen(state: AppState): TerminalSession | null {
	if (state.tab !== "workspace" || !state.selection) return null;
	return shownSession(state, state.selection.worktree);
}

/**
 * Take a session away, with what points at it. When it was the chosen one of
 * its worktree, the chip after it is chosen, or else the one before it.
 */
export function withoutSession(state: Pick<AppState, "terminals" | "shownSessions" | "unseenSessions">, id: string): Pick<AppState, "terminals" | "shownSessions" | "unseenSessions"> {
	const session = state.terminals.find(candidate => candidate.id === id);
	const terminals = withTerminal(state.terminals, id, null);
	const unseenSessions = state.unseenSessions.filter(candidate => candidate !== id);
	if (!session || state.shownSessions[session.worktree] !== id) {
		return { terminals, shownSessions: state.shownSessions, unseenSessions };
	}
	const siblings = sessionsOf(state, session.worktree);
	const at = siblings.findIndex(candidate => candidate.id === id);
	const next = siblings[at + 1] ?? siblings[at - 1];
	const shownSessions = { ...state.shownSessions };
	if (next) shownSessions[session.worktree] = next.id;
	else delete shownSessions[session.worktree];
	return { terminals, shownSessions, unseenSessions };
}

/**
 * Put a session the engine reported in its place, or take it away when
 * `session` is null. A session that changed keeps its place, so chips never
 * move; a new one goes last.
 */
export function withTerminal(terminals: readonly TerminalSession[], id: string, session: TerminalSession | null): readonly TerminalSession[] {
	if (!session) return terminals.filter(candidate => candidate.id !== id);
	const index = terminals.findIndex(candidate => candidate.id === id);
	if (index === -1) return [...terminals, session];
	return terminals.map((candidate, at) => at === index ? session : candidate);
}

/** The removal of the worktree at this registered path in this repository, running or failed, or null. */
export function removalAt(state: Pick<AppState, "removals">, repository: string, path: string): Removal | null {
	return state.removals.find(removal => removal.repository === repository && removal.worktree.path === path) ?? null;
}

/** Whether Timber is removing the worktree at this registered path right now. Its actions are off meanwhile. */
export function isBeingRemoved(state: Pick<AppState, "removals">, repository: string, path: string): boolean {
	return removalAt(state, repository, path)?.status.kind === "running";
}

/**
 * The removals that still mean something after the list changed. A failed
 * one goes when its repository left the list. A failed one whose worktree
 * left the list becomes gone, and a gone one goes when a worktree is listed
 * at that path again, because that is another worktree. A running one
 * always stays.
 */
export function reconcileRemovals(repositories: readonly Repository[], removals: readonly Removal[]): readonly Removal[] {
	let changed = false;
	const kept: Removal[] = [];
	for (const removal of removals) {
		const { status } = removal;
		if (status.kind === "running") {
			kept.push(removal);
			continue;
		}
		const repository = repositories.find(candidate => candidate.path === removal.repository);
		const listed = repository?.worktrees.some(worktree => worktree.path === removal.worktree.path) ?? false;
		// A repository whose worktrees could not be read keeps its last list, so this is only about lists that were read.
		if (!repository || (status.gone && listed)) {
			changed = true;
			continue;
		}
		if (!status.gone && !listed) {
			changed = true;
			kept.push({ ...removal, status: { ...status, gone: true } });
			continue;
		}
		kept.push(removal);
	}
	return changed ? kept : removals;
}
