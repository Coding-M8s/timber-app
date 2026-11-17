import type { FileChange, FileChangeTarget, FileDiffResult } from "../../shared/file-changes";
import { type Layout, defaultLayout } from "../../shared/layout";
import type { RepositoryFetch } from "../../shared/git-fetch";
import type { Repository, TimberStatus, Worktree } from "../../shared/model";
import { type Preferences, defaultPreferences } from "../../shared/preferences";
import type { TerminalSession } from "../../shared/terminal";
import type { TimberConfigScope } from "../../shared/timber-config";

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
	/** The agent that did not start, by name, "Timber setup" for setup, or null for the shell. */
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
export type DialogRequest =
	| { kind: "new-worktree"; repository: string }
	/** Remove a worktree. `repository` is the path of the primary checkout, `worktree` is `Worktree.id`. */
	| { kind: "done-worktree"; repository: string; worktree: string }
	/** Rebase a worktree with Timber, in a new session. Named as for Done. */
	| { kind: "rebase-worktree"; repository: string; worktree: string }
	/** The app's settings, open at one section, or at the first when none is named. */
	| { kind: "settings"; section?: SettingsSection };

/** The sections of the Settings dialog, in the order they are listed. */
export const SETTINGS_SECTIONS = ["layout", "editor", "agents", "fetch", "about", "machine", "repository"] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];

/** The views of the selected worktree, in the order of their tabs. */
export const WORKSPACE_TABS = ["workspace", "changes"] as const;
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
	/** Outcomes that worked, oldest first. Failures are never toasts: they stay where the person can act on them. */
	toasts: readonly Toast[];
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

/** A worktree that Timber lists and whose folder is there, so a session can start in it. */
function usable(repository: Repository, worktree: Worktree | undefined): worktree is Worktree {
	return worktree !== undefined && repository.available && repository.failure === null && worktree.pathExists;
}

/**
 * Where `timber setup` for one of Timber's files would run, or why it cannot.
 * A repository's setup runs in its primary checkout, so Timber finds that
 * repository. Machine setup needs no repository, but a session lives in a
 * worktree, so it runs in the selected one, or else in the first
 * repository's primary checkout. `repositoryPath` is the primary checkout
 * of the repository whose settings show.
 */
export function timberSetupTarget(
	state: Pick<AppState, "repositories" | "selection">,
	scope: TimberConfigScope,
	repositoryPath: string | null,
): { ok: true; repository: string; worktree: Worktree } | { ok: false; reason: string } {
	const primaryOf = (repository: Repository) => repository.worktrees.find(worktree => worktree.primary) ?? repository.worktrees[0];
	if (scope === "repository") {
		const repository = state.repositories.find(candidate => candidate.path === repositoryPath);
		if (!repository) return { ok: false, reason: "Choose a repository first." };
		const worktree = primaryOf(repository);
		if (!usable(repository, worktree)) return { ok: false, reason: `Setup runs in the primary checkout of ${repository.name}, which Timber does not list right now or whose folder is missing.` };
		return { ok: true, repository: repository.path, worktree };
	}
	if (state.selection) {
		const repository = state.repositories.find(candidate => candidate.path === state.selection!.repository);
		const worktree = repository?.worktrees.find(candidate => candidate.id === state.selection!.worktree);
		if (repository && usable(repository, worktree)) return { ok: true, repository: repository.path, worktree };
	}
	for (const repository of state.repositories) {
		const worktree = primaryOf(repository);
		if (usable(repository, worktree)) return { ok: true, repository: repository.path, worktree };
	}
	return { ok: false, reason: "Setup runs in a terminal session, and a session needs a worktree. Add a repository first." };
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
