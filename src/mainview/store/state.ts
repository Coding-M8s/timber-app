import type { IndexAction } from "../../shared/index-writes";
import type { AgentLocation } from "../../shared/agent-lookup";
import type { StatusHookView } from "../../shared/status-hooks";
import type { ChopArrangements, ChopRename } from "../../shared/chop-order";
import type { SuggestedIssue } from "../../shared/issue-search";
import type { AppUpdateState } from "../../shared/app-update";
import type { InstallStep } from "../app-update-format";
import type { PullRequestCreationFailure, PullRequestFields, ReportedPullRequestView, ReviewerFailuresView } from "../pull-request-create-format";
import type { ChopList, ListedChop } from "../../shared/chops";
import type { PortClash, PortsResult } from "../../shared/ports";
import type { BaseComparison, Comparison, FileChange, FileChangeTarget, FileDiffResult } from "../../shared/file-changes";
import type { WorktreeFileResult } from "../../shared/worktree-files";
import type { ReviewNote } from "../../shared/review";
import { type Layout, type SidePanelView, defaultLayout } from "../../shared/layout";
import { type FileTreeState, emptyFileTree } from "../file-tree";
import type { RepositoryFetch } from "../../shared/git-fetch";
import type { IssueLookup } from "../../shared/issues";
import type { IssueBoard } from "./issue-board";
import type { IssueTracker } from "../../shared/model";
import type { Backup, BackupList } from "../../shared/backups";
import type { ArenaList } from "../../shared/arenas";
import type { PullRequestList } from "../../shared/pull-requests";
import type { Repository, TimberFailure, TimberStatus, Worktree } from "../../shared/model";
import { type Preferences, defaultPreferences } from "../../shared/preferences";
import type { TerminalSession } from "../../shared/terminal";
import type { RenderingStatus } from "../../shared/rendering";
import type { SeenStatuses } from "../seen-status";
import { type RepositoryGroups, emptyGroups } from "../../shared/repository-groups";
import { type IconTarget, type SidebarIcons, emptyIcons } from "../../shared/sidebar-icons";
import type { SyncActionKind, SyncActionResult } from "../../shared/sync-actions";
import { confirmsPull } from "../../shared/pull-confirm-setting";
import type { SyncOptions } from "../sync-action-format";

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
	/** Starting a session in a worktree, named by its identity (`Worktree.id`): the shell, the agent named, or the workflow whose agent it is. */
	| { kind: "open-terminal"; worktree: string; agent: string | null }
	/** Ending a terminal session, named by its id. */
	| { kind: "close-terminal"; session: string }
	/** Reading the changed files of a worktree, named by its identity (`Worktree.id`). */
	| { kind: "read-changes"; worktree: string }
	/** Reading the diff of one changed file of a worktree, named by its identity. */
	| { kind: "read-diff"; worktree: string }
	/** Fetching a repository because the person asked, named by the path of its primary checkout. */
	| { kind: "fetch-repository"; repository: string }
	/** A pull that runs without its dialog, because the Pull setting skips it, in a worktree named by its registered path. */
	| { kind: "pull-worktree"; repository: string; worktree: string };

/**
 * The changes of one worktree: its changed files as last read, and the diff
 * of the file its diff tab shows. Read only while the Changes view or the
 * diff tab shows, and started afresh for another worktree.
 */
/**
 * The chops of the selected worktree's repository as last read: the same in
 * every worktree of it. Read when another repository is selected, when the
 * saved chops change, when the main checkout's chops file changed
 * (`onChopsChanged`), after every reload of the repository, and on "Read
 * again" in Settings, Chops. The "+" menu, the palette, and "Insert chop"
 * list from it.
 */
export interface ChopsView {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** Null until the first read answered. */
	list: ChopList | null;
}

/**
 * How the File tab shows its file. A Markdown file starts "rendered", and
 * switches between "rendered", "source", and "edit". Any other file is
 * always "edit": it shows in the editor, read-only when it cannot be edited,
 * and its draft starts with the first change.
 */
export type FileMode = "rendered" | "source" | "edit";

/** Why the last save of a file did not write it. */
export type FileSaveProblem =
	/** The file holds other text now, as an agent wrote it. Saving again overwrites it. */
	| { kind: "changed"; message: string }
	| { kind: "failed"; message: string };

/** What a question about unsaved edits holds back until it is answered. */
export type UnsavedFileStep = { kind: "close" } | { kind: "read-again" } | { kind: "open"; path: string };

/** The file open in a worktree's File tab. */
export interface FileView {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's registered path, as Timber lists it. */
	worktreePath: string;
	/** Relative to the worktree, with `/` between folders. */
	path: string;
	/** The tab that showed when the file was opened, shown again when it is closed. */
	from: Exclude<WorkspaceTab, "file">;
	/** Null while the first read is under way. */
	result: WorktreeFileResult | null;
	mode: FileMode;
	/**
	 * The text being edited, with plain new lines, from the first Edit until
	 * it is discarded. Kept while other tabs show, and shown in every mode.
	 * It holds unsaved edits when it differs from the file as read (see
	 * `hasUnsavedEdits`).
	 */
	draft: string | null;
	/** True while a save is under way. */
	saving: boolean;
	saveProblem: FileSaveProblem | null;
}

export interface ChangesView {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's identity (`Worktree.id`). */
	worktree: string;
	/** Null until the first read answered. A failed read keeps the last good list. */
	files: readonly FileChange[] | null;
	/** More files changed than are listed. */
	more: boolean;
	/** The comparison `files` come from, as the engine answered. Null until the first read answered. */
	compared: Comparison | null;
	/** Whether the worktree can be compared with its base, from the latest read that worked. */
	base: BaseComparison | null;
	/** Why the latest read failed. Null once one worked. */
	problem: string | null;
	/** Whether the worktree has a commit, from the latest read that worked: before the first one, unstaging is `git rm --cached`. */
	hasCommit: boolean;
	/** A stage or unstage is running: the list's write buttons wait for it. */
	writing: boolean;
	/** Why the latest stage or unstage did not happen, with the command when Git ran and failed. Null once one worked, or for another worktree. */
	writeProblem: { action: IndexAction; command: string | null; message: string } | null;
	/** The file whose diff is read: the file of the worktree's diff tab while it is listed, otherwise null. */
	selected: FileChangeTarget | null;
	/** The diff of `selected`. Null while the first read of it runs. A newer read replaces it when it answers. */
	diff: FileDiffResult | null;
	/**
	 * The lines of `selected` on disk, read with its diff, when they are the
	 * new side of that diff: the unchanged lines between its hunks come from
	 * them (see ../diff-unchanged.ts). Null when they cannot be, or were not.
	 */
	unchanged: readonly string[] | null;
}

/** How a viewed file is kept: its comparison and the file. */
export const viewedKey = (comparison: Comparison, file: FileChangeTarget) => `${comparison}\0${file.area}\0${file.path}\0${file.previousPath ?? ""}`;

/** Whether a listed file is marked Viewed in its worktree, and has not changed since. */
export function fileViewed(state: Pick<AppState, "viewed">, worktree: string, comparison: Comparison | null, file: FileChange): boolean {
	return comparison !== null && state.viewed[worktree]?.[viewedKey(comparison, file)] === file.version;
}

/** A worktree's diff tab: the changed file whose diff it shows, and the tab to go back to when it closes. */
export interface DiffTab {
	file: FileChangeTarget;
	/** The tab that showed when the diff was opened, shown again when it is closed. */
	from: Exclude<WorkspaceTab, "diff">;
}

/** Why a session did not start. It stays until dismissed, or until a session starts in that worktree. */
export interface TerminalProblem {
	/** The worktree's identity (`Worktree.id`). */
	worktree: string;
	/** The agent that did not start, by name, or the workflow whose agent it is, or null for the shell. */
	agent: string | null;
	message: string;
	/** The command that failed, as one line, when it is known. */
	command: string | null;
}

/**
 * The agent a new worktree's sessions start: one saved in Settings, by name,
 * or the agent of a named workflow, which the main process reads again from
 * Timber when it starts. With `agent`, that saved agent starts unless
 * Timber reports then that the workflow sets an agent or turns it off.
 */
export type SessionAgent = { kind: "saved"; name: string } | { kind: "workflow"; workflow: string; agent?: string };

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
	| { kind: "failed"; action: "add" | "remove" | "reorder" | "group"; message: string }
	/**
	 * A group was not moved, or not made, where it was asked to go: not inside
	 * itself or its own subgroups, not past the deepest level, and not beside a
	 * group with its name (`name`, as saved).
	 */
	| { kind: "group-refused"; reason: "inside-itself" | "too-deep" } | { kind: "group-refused"; reason: "name-taken"; name: string };

/** Why a group name was not saved: it was empty once trimmed, or another group has it, ignoring case. */
export type GroupNameProblem = { kind: "empty" } | { kind: "taken"; name: string };

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
	 * Queued by Clean up merged, which removes one worktree at a time. Its
	 * actions are off as while it runs, and nothing has run for it yet.
	 */
	| { kind: "waiting" }
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

/** What the New worktree dialog makes: a new branch, a worktree for an existing branch, or an arena (beta, as in Timber). */
export type NewWorktreeMode = "new" | "existing" | "arena";

/** The dialog open over the window. One at a time. */
export type DialogRequest =
	/** `mode` picks what the dialog starts on: a new branch unless it says otherwise. */
	| { kind: "new-worktree"; repository: string; mode?: NewWorktreeMode }
	/** Remove a worktree. `repository` is the path of the primary checkout, `worktree` is `Worktree.id`. */
	| { kind: "done-worktree"; repository: string; worktree: string }
	/** Rebase a worktree with Timber, in a new session. Named as for Done. */
	| { kind: "rebase-worktree"; repository: string; worktree: string }
	/**
	 * Run a sync action such as Pull in a worktree, after showing its Git
	 * commands. Named as for Done. `ended` is set when a pull ran without the
	 * dialog and Git refused or it failed: the dialog opens on that outcome.
	 */
	| { kind: "sync-action"; action: SyncActionKind; repository: string; worktree: string; ended?: Exclude<SyncActionResult, { outcome: "done" }> }
	/** Save the base Timber keeps for a worktree, from the Changes view. Named as for Done. */
	| { kind: "set-base"; repository: string; worktree: string }
	/** Remove every linked worktree of one repository whose pull request merged. `repository` is the path of the primary checkout. */
	| { kind: "clean-up-merged"; repository: string }
	/**
	 * Restore or delete one backup. `backup` is the backup as the person chose
	 * it, kept as it was: a later read of the list never changes what the
	 * dialog asks about. `repository` is the path of the primary checkout.
	 */
	| { kind: "restore-backup"; repository: string; backup: Backup }
	| { kind: "delete-backup"; repository: string; backup: Backup }
	/**
	 * The app's settings, open at one section, or at the first when none is
	 * named. The Repository section can be opened at one repository, named by
	 * the path of its primary checkout, and at one group of its settings, such
	 * as Issue tracking from the Issues board.
	 */
	| { kind: "settings"; section?: SettingsSection; repository?: string; group?: "tracking" }
	/** The command palette: every worktree and action, searched by typing. */
	| { kind: "palette" }
	/** Set, change, or remove the icon of a repository or a group, from its menu. */
	| { kind: "sidebar-icon"; target: IconTarget }
	/** The setup wizard of a repository new to Timber, named by the path of its primary checkout. */
	| { kind: "set-up-timber"; repository: string }
	/**
	 * A worktree's open file has unsaved edits, and something would drop
	 * them: closing it, reading it again, or opening another file in its
	 * place. Asks to save, discard, or keep editing. `worktree` is `Worktree.id`.
	 */
	| { kind: "unsaved-file"; worktree: string; then: UnsavedFileStep }
	/** Preview a worktree's review notes as one message, and paste it into one of its agents or copy it. `worktree` is `Worktree.id`. */
	| { kind: "send-review"; worktree: string }
	/** Compare an arena's attempts and keep one. `arena` is the arena's name as Timber lists it. */
	| { kind: "arena-compare"; repository: string; arena: string }
	/**
	 * Show a repository chop's exact text, from `path`, before it first runs or
	 * after it changed, and run it only on confirm. `worktree` is `Worktree.id`.
	 * `chop` is as the main process read it, kept as it was.
	 */
	| {
		kind: "approve-chop"; repository: string; worktree: string; chop: ListedChop; path: string;
		/** For a prompt sent to a running agent: its session id. */
		session?: string;
		/** The text the person edited for this run, which runs once the chop's own text is approved. */
		text?: string;
	}
	/**
	 * Ask where a prompt chop goes: one of the worktree's running agents, or a
	 * new agent. `worktree` is `Worktree.id`; `chop` is the chop's name.
	 */
	| { kind: "send-prompt"; repository: string; worktree: string; chop: string; /** The text the person edited for this run, sent in place of the chop's. */ text?: string }
	/** Search the chops of the selected worktree's repository and run one, from the keyboard. */
	| { kind: "run-chop" }
	/**
	 * Check out one of an issue's open pull requests from the issues board.
	 * `repository` is the path of the primary checkout; `issue` is the card as
	 * the board listed it, with the pull requests the tracker links to it.
	 */
	| { kind: "check-out-pull-request"; repository: string; issue: SuggestedIssue }
	/**
	 * Start work on an issue from the issues board: `timber new` for it,
	 * linked and assigned. `repository` is the path of the primary checkout;
	 * `issue` is the card as the board listed it.
	 */
	| { kind: "start-work"; repository: string; issue: SuggestedIssue };

/** The sections of the Settings dialog, in the order they are listed. */
export const SETTINGS_SECTIONS = ["layout", "theme", "terminal", "rendering", "editor", "agents", "chops", "notifications", "fetch", "pull", "about", "executable", "machine", "repository"] as const;
export type SettingsSection = typeof SETTINGS_SECTIONS[number];

/**
 * Every view of a worktree, in the order of their tabs. "diff" is a tab only
 * while a changed file's diff is open there, and "file" only while a file is
 * (see `visibleTabs`). The worktree's changes list is in the side panel.
 */
export const WORKSPACE_TABS = ["workspace", "pull-request", "diff", "file"] as const;
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
	kind: "not-listed" | "not-found" | "failed";
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
	 * The groups the sidebar gathers repositories into, and the group of each
	 * grouped repository. Saved by the engine; a change shows at once and is
	 * put back if its save fails.
	 */
	repositoryGroups: RepositoryGroups;
	/** Why the last group name typed was not saved. Null once one saved, or when editing again. */
	groupNameProblem: GroupNameProblem | null;
	/** The icons of repositories and groups, as the engine last saved them. */
	sidebarIcons: SidebarIcons;
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
	/**
	 * Whether each saved agent's executable was found, as the engine last
	 * said (`Engine.locateAgents`), by name and command. Null until it has
	 * answered. An agent whose command changed since is not known
	 * (`lookupOf` in src/shared/agent-lookup.ts).
	 */
	agentLocations: readonly AgentLocation[] | null;
	/**
	 * How each saved agent reports its status, and its status hook as the
	 * engine last read it (`Engine.statusHooks`), by the row's name. Null
	 * until it has answered.
	 */
	statusHooks: readonly StatusHookView[] | null;
	/**
	 * The chop order the latest move or star in the chops panel asked for,
	 * shown until its save answers, so quick moves add up. Null when none
	 * waits: the saved `preferences.chopOrder` shows (`shownChopOrder`).
	 */
	chopOrderAim: ChopArrangements | null;
	/**
	 * Chops just saved under new names, and the chop list shown when they
	 * were saved. While that list still shows, under the old names, the
	 * panel finds their places by the old names, so a renamed chop does not
	 * jump until the list is read again (`chopsPanelModel`).
	 */
	chopRenaming: { renames: readonly ChopRename[]; list: unknown } | null;
	/**
	 * The chop last chosen to run in each repository, by the primary
	 * checkout, from the panel, the palette, the "+" menu, or the chop search,
	 * so the search lists it on top. Kept until the app closes.
	 */
	lastChops: Readonly<Record<string, string>>;
	/**
	 * The preferences as first read, which this run started with. A
	 * preference read only at start keeps using this value until a restart
	 * (see `restartNeededFor` in src/shared/preferences.ts). The defaults when
	 * the read failed, as the main process falls back to them too. Null until
	 * the first read answered.
	 */
	preferencesAtStart: Preferences | null;
	/** The app's own version, for About. Null until the engine has answered. */
	appVersion: string | null;
	/** Where updating the app from its GitHub releases stands (see src/shared/app-update.ts). */
	appUpdate: AppUpdateState;
	/** The downloaded update the person said Later to, so the banner stays away for it in this run. Null when none. */
	appUpdateLater: string | null;
	/** Where Restart to update stands, shared by the banner and About, so a failure stays on screen. */
	appUpdateStep: InstallStep;
	/** What the app decided about WebKitGTK's renderer when it started. Null until the engine has answered. */
	rendering: RenderingStatus | null;
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
	/**
	 * The sessions shown as Needs you, by id, the one that has waited longest
	 * first, in every repository, whether or not the list has its worktree now
	 * (see ../waiting.ts). Kept from `terminals` by the store; read it through
	 * `waitingSessions`.
	 */
	waitingOrder: readonly string[];
	/**
	 * The sessions shown as Done that the person has not seen since, by id,
	 * the one that finished first first (see `withFinishedOrder` in
	 * ../waiting.ts). Read it through `finishedSessions`.
	 */
	finishedOrder: readonly string[];
	/**
	 * The sessions whose Done, Error, or crash the person has seen, with the
	 * state each was seen in (see ../seen-status.ts). Kept from `terminals`
	 * and what is on screen in a focused window by the store.
	 */
	seenStatuses: SeenStatuses;
	terminalProblem: TerminalProblem | null;
	/**
	 * How many terminals ran when the app was asked to quit, while the
	 * question is on screen. Null when nothing is asked.
	 */
	quitRequest: number | null;
	/** Which view of the selected worktree shows. */
	tab: WorkspaceTab;
	/** The changes of the selected worktree as last read, for the Changes view and the diff tab. Null before either first showed. */
	changes: ChangesView | null;
	/**
	 * The diff tab of each worktree, by its identity. A worktree with none
	 * has no diff tab. Kept in the window only, never saved, and forgotten
	 * when the worktree leaves the list.
	 */
	diffs: Readonly<Record<string, DiffTab>>;
	/**
	 * The changed files marked Viewed in each worktree, by its identity: each
	 * by `viewedKey`, with the version the file had when it was marked. A file
	 * whose version changed since is no longer viewed. Kept in the window only.
	 */
	viewed: Readonly<Record<string, Readonly<Record<string, string>>>>;
	/** What is typed in the Changes view's "Filter files" box, by worktree. Kept in the window only. */
	changeFilters: Readonly<Record<string, string>>;
	/**
	 * The file open in the File tab of each worktree, by its identity. A
	 * worktree with none has no File tab. Kept in the window only, never
	 * saved, and forgotten when the worktree leaves the list.
	 */
	files: Readonly<Record<string, FileView>>;
	/**
	 * The review notes of each worktree, by its identity, in the order they
	 * were written. Kept in the window only, until sent or discarded, and
	 * never saved: they quote the files. A worktree that leaves the list
	 * takes its notes with it.
	 */
	reviews: Readonly<Record<string, readonly ReviewNote[]>>;
	/** The note the diff tab brings into view once its diff shows, after the person chose its reference in the Review section. Its lines are marked until it is cleared, a moment after. */
	noteInView: { worktree: string; id: string } | null;
	/** The note whose reference was chosen last in the Review section. Its reference stays marked until another is chosen or it goes. */
	chosenNote: { worktree: string; id: string } | null;
	/** The chops of the selected worktree's repository as last read. Null before the first read. */
	chops: ChopsView | null;
	/** The file explorer's folders, as last read, and which are open, for each worktree it showed. */
	fileTree: FileTreeState;
	/**
	 * The ports of each worktree read so far, by its registered path, as last
	 * read. A worktree missing here was never read. Read when it is selected,
	 * when its repository reloads, and when the ports list opens; the engine
	 * answers from its last read within a few seconds, and reads nothing while
	 * the window is hidden.
	 */
	ports: Record<string, PortsResult>;
	/** Every host port more than one folder claims, from the latest read of any worktree. Marks the rows of every worktree in one. */
	portClashes: PortClash[];
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
	/**
	 * Timber's recovery backups, by the path of the repository's primary
	 * checkout, as `timber backup list --json` last answered. A repository
	 * missing here was not read yet. Read when a repository is first listed,
	 * on Refresh, after a restore or delete, and after the repository changed,
	 * at most once in `BACKUP_READ_SPACING_MS` for that.
	 */
	backups: Readonly<Record<string, BackupList>>;
	/**
	 * Each repository's arenas, by the path of its primary checkout, as
	 * `timber __app-arena list` last answered. A repository missing here was
	 * not read yet. Read as backups are: when a repository is first listed,
	 * on Refresh, right after a create or pick, and after the repository
	 * changed, at most once in `ARENA_READ_SPACING_MS` for that.
	 */
	arenas: Readonly<Record<string, ArenaList>>;
	/**
	 * The live state of each linked issue, by worktree id, as `timber
	 * __app-issue` last answered, with the saved link it was read for. A
	 * worktree with a linked issue that is missing here was not read yet.
	 * Read when the worktree is first listed with the link or the link
	 * changes, and again after each fetch of its repository ends.
	 */
	issues: Readonly<Record<string, IssueEntry>>;
	/**
	 * The repository, by the path of its primary checkout, whose issues board
	 * shows in place of the selected worktree, or null. Choosing a worktree
	 * puts it away. The selected worktree and its sessions stay as they were.
	 */
	board: string | null;
	/** Each repository's issues board as last read, by the path of its primary checkout (./issue-board.ts). Kept for the run. */
	issueBoards: Readonly<Record<string, IssueBoard>>;
	/**
	 * The form in the Pull request tab of each worktree that has no pull
	 * request yet, by worktree id, with its run and how the last one ended.
	 * Kept here and not in the tab, so switching tabs or worktrees while
	 * Timber runs neither loses what was typed nor allows a second run.
	 */
	pullRequestForms: Readonly<Record<string, PullRequestForm>>;
}

/** One worktree's form for `timber pr`, and its latest run. */
export interface PullRequestForm extends PullRequestFields {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's registered path, the selector given to Timber. */
	worktree: string;
	/** The commit the title was read for. A new commit reads its subject again. */
	head: string | null;
	/** The issue key the title was made with (`titleKeyOf` the saved link). A link attached, changed, or removed later makes the title again. */
	titleKey: string | null;
	/** The last subject read, so a new key makes the title again without reading. It may be an earlier head's when a later read gave no answer. Null until one is read. */
	subject: string | null;
	/** The person typed a title, so the last commit's subject, read later, does not replace it. */
	titleEdited: boolean;
	/** `timber pr` runs: the fields are disabled and nothing else can be submitted. */
	running: boolean;
	/** Why the latest run opened nothing. Null while one runs, and once one worked. */
	failure: PullRequestCreationFailure | null;
	/** The pull request the latest run created or found, until the tab can show it from the pull requests read. */
	reported: ReportedPullRequestView | null;
	/**
	 * The reviewers the latest run could not request on the pull request it
	 * created or found. Unlike `reported`, a read of the pull requests keeps
	 * it: it lasts until it is put away or the next run.
	 */
	reviewerFailures: ReviewerFailuresView | null;
}

/** What Timber answered for one worktree's linked issue, and which link it answered for. */
export interface IssueEntry {
	tracker: IssueTracker;
	key: string;
	lookup: IssueLookup;
}

export const initialState: AppState = {
	timber: null,
	repositories: [],
	loaded: false,
	selection: null,
	operations: [],
	error: null,
	notice: null,
	repositoryGroups: emptyGroups(),
	groupNameProblem: null,
	sidebarIcons: emptyIcons(),
	toasts: [],
	removals: [],
	layout: defaultLayout(),
	layoutProblem: null,
	preferences: defaultPreferences(),
	preferencesProblem: null,
	agentLocations: null,
	statusHooks: null,
	chopOrderAim: null,
	chopRenaming: null,
	lastChops: {},
	preferencesAtStart: null,
	appVersion: null,
	appUpdate: { kind: "idle" },
	appUpdateLater: null,
	appUpdateStep: { kind: "offer" },
	rendering: null,
	editorProblem: null,
	terminals: [],
	shownSessions: {},
	unseenSessions: [],
	waitingOrder: [],
	finishedOrder: [],
	seenStatuses: {},
	terminalProblem: null,
	quitRequest: null,
	tab: "workspace",
	changes: null,
	diffs: {},
	viewed: {},
	changeFilters: {},
	files: {},
	reviews: {},
	noteInView: null,
	chosenNote: null,
	chops: null,
	fileTree: emptyFileTree(),
	ports: {},
	portClashes: [],
	dialog: null,
	fetches: {},
	pullRequests: {},
	issues: {},
	board: null,
	issueBoards: {},
	backups: {},
	arenas: {},
	pullRequestForms: {},
};

/** Nothing that depends on Timber is offered until a usable one is found. */
export function timberReady(state: AppState): boolean {
	return state.timber?.known === true && state.timber.status.state === "ready";
}

/**
 * Whether chops are in use and offered in the window: the "Use chops"
 * setting is on and Timber is ready. The title bar's Chops button, the chops
 * panel, and every chop shortcut ask this, so turning chops off in Settings
 * removes them all at once and keeps the saved chops.
 */
export function chopsEnabled(state: AppState): boolean {
	return state.preferences.useChops && timberReady(state);
}

/**
 * The chops the window offers anywhere: the palette, the "+" menu and the
 * empty pane, "Insert chop", and running one. Null while "Use chops" is off,
 * so turning chops off removes every way to see or run one. The list is
 * still read and kept, so it is back at once when chops are turned on.
 */
export function offeredChops(state: AppState): AppState["chops"] {
	return state.preferences.useChops ? state.chops : null;
}

/** The chop order the panel shows: the one a waiting save asked for, or the saved one. */
export function shownChopOrder(state: Pick<AppState, "chopOrderAim" | "preferences">): ChopArrangements {
	return state.chopOrderAim ?? state.preferences.chopOrder;
}

/** The views the side panel offers, in the order of its switch: the chops only while they are in use. */
export function offeredSidePanelViews(state: AppState): readonly SidePanelView[] {
	return chopsEnabled(state) ? ["chops", "files", "changes"] : ["files", "changes"];
}

/**
 * What the side panel beside the workspace shows: the chops, the files, or
 * the changes, as the person last chose. With chops off, a panel left on
 * the chops names the files.
 */
export function sidePanelView(state: AppState): SidePanelView {
	const view = state.layout.sidePanel;
	return view === "chops" && !chopsEnabled(state) ? "files" : view;
}

/**
 * Whether the side panel is drawn beside the workspace: Timber is ready, the
 * person showed it, and what it shows is offered. A panel left on the chops
 * stays hidden while chops are off, rather than showing the files unasked.
 */
export function sidePanelShown(state: AppState): boolean {
	return timberReady(state) && state.layout.chopsOpen && (chopsEnabled(state) || state.layout.sidePanel !== "chops");
}

/** Whether the chops panel is drawn beside the workspace: chops are in use and the person showed it. */
export function chopsPanelShown(state: AppState): boolean {
	return sidePanelShown(state) && sidePanelView(state) === "chops";
}

/** Whether the file explorer is drawn beside the workspace. */
export function filesPanelShown(state: AppState): boolean {
	return sidePanelShown(state) && sidePanelView(state) === "files";
}

/** Whether the Changes view is drawn beside the workspace. */
export function changesPanelShown(state: AppState): boolean {
	return sidePanelShown(state) && sidePanelView(state) === "changes";
}

/** The diff tab of the selected worktree, when it has one. */
export function shownDiffTab(state: AppState): DiffTab | null {
	return state.selection === null ? null : state.diffs[state.selection.worktree] ?? null;
}

/**
 * Whether the selected worktree's changes should be read now: the Changes
 * view shows, or its diff tab does.
 */
export function changesWanted(state: AppState): boolean {
	return changesPanelShown(state) || (state.tab === "diff" && state.board === null && shownDiffTab(state) !== null);
}

/**
 * Whether a button or a shortcut may show, switch, or hide the side panel
 * with this view now: Timber is ready, the view is offered (chops in use,
 * for the chops), and no dialog or quit question has the keyboard, as for
 * the command palette.
 */
export function canToggleSidePanel(state: AppState, view: SidePanelView): boolean {
	return timberReady(state) && (view !== "chops" || chopsEnabled(state)) && state.dialog === null && state.quitRequest === null;
}

/** Whether the Chops button or its shortcut may show or hide the chops panel now (`canToggleSidePanel`). */
export function canToggleChopsPanel(state: AppState): boolean {
	return canToggleSidePanel(state, "chops");
}

export function isRunning(state: AppState, kind: Operation["kind"]): boolean {
	return state.operations.some(operation => operation.kind === kind);
}

/**
 * Whether a worktree's Changes view is being read again: its changed files, or
 * its repository (the tab's Refresh, a reported change), or every repository
 * (the sidebar's Refresh).
 */
export function changesBusy(state: AppState, repository: string, worktree: string): boolean {
	return state.operations.some(operation =>
		operation.kind === "reload-all"
		|| (operation.kind === "read-changes" && operation.worktree === worktree)
		|| (operation.kind === "reload-repository" && operation.repository === repository));
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
 * The sessions that need the person and can be shown now, the one that has
 * waited longest first: those whose worktree the list has. The title bar's
 * count, the palette, and the shortcut all read these, so the count is what
 * the shortcut can reach.
 */
export function waitingSessions(state: Pick<AppState, "waitingOrder" | "terminals" | "repositories">): readonly string[] {
	return reachable(state, state.waitingOrder);
}

/** The finished sessions not seen yet that can be shown now, the one that finished first first, as for `waitingSessions`. */
export function finishedSessions(state: Pick<AppState, "finishedOrder" | "terminals" | "repositories">): readonly string[] {
	return reachable(state, state.finishedOrder);
}

/** Where the shortcut goes, in order: every session that needs the person, then every finished one. */
export function sessionsToVisit(state: Pick<AppState, "waitingOrder" | "finishedOrder" | "terminals" | "repositories">): readonly string[] {
	return [...waitingSessions(state), ...finishedSessions(state)];
}

function reachable(state: Pick<AppState, "terminals" | "repositories">, order: readonly string[]): readonly string[] {
	return order.filter(id => {
		const session = state.terminals.find(candidate => candidate.id === id);
		return session !== undefined && selectionFor(state.repositories, session.worktree) !== null;
	});
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

/**
 * Whether Timber is removing the worktree at this registered path right now,
 * or Clean up merged has it queued. Its actions are off meanwhile.
 */
/** How Pull behaves for a worktree: whether it asks first in its repository, and whether a pull without a dialog runs there now. */
export function syncOptionsOf(state: Pick<AppState, "preferences" | "operations">, repository: string, worktree: string): SyncOptions {
	return {
		pullAsks: confirmsPull(state.preferences.pull, repository),
		pulling: state.operations.some(operation => operation.kind === "pull-worktree" && operation.repository === repository && operation.worktree === worktree),
	};
}

export function isBeingRemoved(state: Pick<AppState, "removals">, repository: string, path: string): boolean {
	const kind = removalAt(state, repository, path)?.status.kind;
	return kind === "running" || kind === "waiting";
}

/**
 * The removals that still mean something after the list changed. A failed
 * one goes when its repository left the list. A failed one whose worktree
 * left the list becomes gone, and a gone one goes when a worktree is listed
 * at that path again, because that is another worktree. A running or
 * waiting one always stays: whatever runs it takes it away.
 */
export function reconcileRemovals(repositories: readonly Repository[], removals: readonly Removal[]): readonly Removal[] {
	let changed = false;
	const kept: Removal[] = [];
	for (const removal of removals) {
		const { status } = removal;
		if (status.kind === "running" || status.kind === "waiting") {
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
