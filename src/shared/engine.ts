import type { AppInfo } from "./app-info";
import type { BackupDeleteRequest, BackupDeleteResult, BackupList, BackupRestoreRequest, BackupRestoreResult } from "./backups";
import type { Attention } from "./attention";
import type { FetchResult, ForcePushSeen, RepositoryFetch } from "./git-fetch";
import type { FileChangesRequest, FileChangesResult, FileDiffRequest, FileDiffResult } from "./file-changes";
import type { Layout } from "./layout";
import type { AddRepositoryResult, BranchSuggestion, NewWorktreeRequest, OpenInEditorRequest, OpenInEditorResult, OpenWorktreeRequest, RemoveRepositoryResult, ReorderRepositoriesResult, Repository, SaveLayoutResult, SavePreferencesResult, TimberStatus, WorktreeCommandResult } from "./model";
import type { Preferences } from "./preferences";
import type { RestartPlan, RestartResult } from "./restart";
import type { IssueLookup, IssueRequest } from "./issues";
import type { PullRequestList } from "./pull-requests";
import type { Theme } from "./theme";
import type { ChooseSoundResult, SoundChoice, SoundOutcome } from "./sound-setting";
import type { ExportThemeResult, ImportThemeResult } from "./theme-file";
import type { OpenTerminalRequest, OpenTerminalResult, TerminalChange, TerminalOutput, TerminalSession, TerminalSnapshot } from "./terminal";
import type { TimberConnectionCheckRequest, TimberConnectionCheckResult, TimberSettingsReadResult, TimberSettingsRequest, TimberSettingsSaveRequest, TimberSettingsSaveResult } from "./timber-config";
import type { RebaseRequest, RebaseResult } from "./timber-rebase";
import type { CreatePullRequestRequest, CreatePullRequestResult, HeadSubjectRequest } from "./timber-pr";
import type { DoneApplyRequest, DoneApplyResult, DonePreviewRequest, DonePreviewResult } from "./timber-done";
import type { UninstallPlan, UninstallRequest, UninstallResult } from "./uninstall";
import type { WorkflowList } from "./workflows";

/**
 * Everything the interface may ask of the machine it runs on.
 *
 * The interface only ever talks to this contract. The desktop app answers it
 * from the Bun main process; the browser build answers it from sample data.
 * Grow it one capability at a time, and keep every method safe to call again.
 */
export interface Engine {
	/** What the app says about itself: its version, for About, and how WebKitGTK draws in this run, for Settings. */
	appInfo(): Promise<AppInfo>;
	/** Whether a usable Timber is installed, as of the last look. */
	timberStatus(): Promise<TimberStatus>;
	/** Look for Timber again, for example after the person installed it. */
	recheckTimber(): Promise<TimberStatus>;
	/** Hear that the Timber status changed on its own, for example when a newer release came out. Returns a function that stops listening. */
	onTimberChanged(listener: () => void): () => void;
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
	 * Save the order of the repositories in the list, each named by the path of
	 * its primary checkout, so `listRepositories` answers in that order from
	 * now on, after a restart too. A listed repository the order leaves out
	 * keeps its place after the ones it names, and a path that is not listed
	 * is skipped. This only changes the app's saved list, never anything in a
	 * repository or its folder.
	 */
	reorderRepositories(order: string[]): Promise<ReorderRepositoriesResult>;
	/**
	 * Read one repository again, named by the path of its primary checkout.
	 * Null when Git could not read it there. As in `listRepositories`, a
	 * repository whose worktrees Timber could not list has `failure` set.
	 */
	loadRepository(path: string): Promise<Repository | null>;
	/**
	 * The branches of a repository to offer for picking, read from Git without
	 * changing anything: local branches, then remote-tracking branches as of
	 * the last fetch. `repository` is the path of its primary checkout. Null
	 * when they could not be read.
	 */
	listBranches(repository: string): Promise<BranchSuggestion[] | null>;
	/**
	 * The subject line of the last commit on a worktree's branch, read from
	 * Git without changing anything, for the title a new pull request starts
	 * with. Only for a worktree Timber lists in a repository from the list.
	 * Null when there is no commit, or it could not be read.
	 */
	readHeadSubject(request: HeadSubjectRequest): Promise<string | null>;
	/**
	 * Create a worktree by running `timber new` in a repository from the list.
	 * The command is `newWorktreeArguments` in ./worktree-commands.ts, so the
	 * interface can show it before asking. It runs once and is never retried
	 * here. Not safe to call again blindly: read the list after every outcome.
	 */
	newWorktree(request: NewWorktreeRequest): Promise<WorktreeCommandResult>;
	/**
	 * Open a branch or an existing worktree by running `timber open` in a
	 * repository from the list, with setup run again when asked. The command is
	 * `openWorktreeArguments` in ./worktree-commands.ts. It runs once and is
	 * never retried here. Read the list after every outcome.
	 */
	openWorktree(request: OpenWorktreeRequest): Promise<WorktreeCommandResult>;
	/**
	 * Rebase a worktree by running `timber rebase --result-file` in a
	 * repository from the list, and answer how it ended as Timber's record says:
	 * rebased, already up to date, stopped on conflicts, refused, or failed.
	 * The command is `rebaseResultArguments` in ./timber-rebase.ts, so the
	 * interface can show it before asking. It runs once and is never retried
	 * here. A rebase that stopped on conflicts is left exactly as Git left it:
	 * the engine runs no Git command to abort or continue it. An answer of
	 * `unsupported` means Timber is too old to report through a result file and
	 * nothing ran. Read the list after every outcome.
	 */
	rebaseWorktree(request: RebaseRequest): Promise<RebaseResult>;
	/**
	 * Publish a worktree's branch and open a pull request for it by running
	 * `timber pr --result-file` in a repository from the list, and answer how
	 * it ended as Timber's record says: created, already open, refused, or
	 * failed. The command is `prResultArguments` in ./timber-pr.ts, so the
	 * interface can show it before asking. Timber pushes and calls GitHub; the
	 * engine never does. It runs once and is never retried here, since a
	 * failure can come after the push. Read the list and the pull requests
	 * after every outcome that ran.
	 */
	createPullRequest(request: CreatePullRequestRequest): Promise<CreatePullRequestResult>;
	/**
	 * Ask Timber what removing a worktree would do, with `timber __ide-done
	 * preview`. Read-only and safe to call again: nothing is removed and no
	 * script runs. The answer names the preview, and the engine keeps what
	 * Timber printed for `applyDone`.
	 */
	previewDone(request: DonePreviewRequest): Promise<DonePreviewResult>;
	/**
	 * Remove a worktree with `timber __ide-done apply`, approving one preview by
	 * its name. This is the only capability that deletes work. A preview is
	 * used up by one call, whatever came of it, so calling again with the same
	 * name removes nothing. Timber refuses when the worktree no longer matches
	 * the preview. A failure can leave the folder removed and the branch in
	 * place, so read the list again after every outcome, and never try again
	 * without a new preview that the person has seen.
	 */
	applyDone(request: DoneApplyRequest): Promise<DoneApplyResult>;
	/**
	 * Hear when the machine reports that a repository changed. The listener gets
	 * the path of its primary checkout. Returns a function that stops listening.
	 */
	onRepositoryChanged(listener: (path: string) => void): () => void;
	/**
	 * Say whether the window shows, whether it has the focus, and which
	 * worktree is selected, whenever one of them changes. The machine watches
	 * the repositories' Git metadata and checks the selected worktree for
	 * edits, and reports what changed through `onRepositoryChanged`: only
	 * while the window shows, catching up once when it shows again, and for
	 * the selected worktree's repository when the focus comes back. Nothing
	 * comes back. Safe to call with the same value again. Background fetches
	 * also wait while the window is hidden (see `fetchNow`), and a session's
	 * desktop notification is held back while its worktree is the selected
	 * one in a focused window that shows (see `onShowSession`).
	 */
	attend(attention: Attention): void;
	/**
	 * The interface has drawn itself for the first time, in the saved theme.
	 * The window is hidden until then, so nothing is seen before the theme's
	 * colors. Nothing comes back, and later calls do nothing.
	 */
	windowReady(): void;
	/**
	 * Where fetching stands for each repository in the list: whether a fetch
	 * runs, when one last worked, and why the latest one failed. The machine
	 * fetches every repository in the background on the interval from the
	 * preferences, unless that is off, and reports each change through
	 * `onFetchChanged`.
	 */
	fetchStatuses(): Promise<RepositoryFetch[]>;
	/**
	 * Fetch a repository of the list now, named by its primary checkout, or
	 * wait for the fetch that runs. Works whether or not background fetching
	 * is on. A fetch only updates remote-tracking refs: it never pulls,
	 * merges, rebases, or changes a local branch, a tag, or a working tree,
	 * and it never asks for credentials. What changed is reported through
	 * `onRepositoryChanged`. Safe to call again.
	 */
	fetchNow(repository: string): Promise<FetchResult>;
	/** Hear where fetching stands for a repository whenever it changes. Returns a function that stops listening. */
	onFetchChanged(listener: (status: RepositoryFetch) => void): () => void;
	/**
	 * Say that the person saw a branch marked force-pushed (`SyncState`'s
	 * `forcePushed`), so the mark goes. Only the mark with that `at` goes, so
	 * a newer rewrite stays marked. Nothing comes back; the repository is
	 * reported changed when a mark went.
	 */
	forcePushSeen(seen: ForcePushSeen): void;
	/**
	 * How the window was arranged when the layout was last saved: the sidebar
	 * width, the collapsed repository groups, and the repositories whose setup
	 * prompt was dismissed. The defaults when nothing was saved yet.
	 */
	loadLayout(): Promise<Layout>;
	/**
	 * Remember the layout for the next run. The whole layout is given each time,
	 * so the latest call wins. Removing a repository also forgets its collapsed
	 * group and its dismissed setup prompt.
	 */
	saveLayout(layout: Layout): Promise<SaveLayoutResult>;
	/**
	 * The app's own settings from the Settings dialog, such as the side of the
	 * sidebar. The defaults when nothing was saved yet.
	 */
	loadPreferences(): Promise<Preferences>;
	/**
	 * Save the preferences that `change` names and keep every other one as it
	 * was saved, so each section of the Settings dialog saves only its own.
	 * Saved answers with every preference as it now is. Safe to call again.
	 */
	savePreferences(change: Partial<Preferences>): Promise<SavePreferencesResult>;
	/**
	 * Write a theme to a new file, in a folder the person picks
	 * (`themeFileText` and `themeFileName` in ./theme-file.ts). A theme that
	 * cannot be read whole is not written, and a file that is there already is
	 * never written over. Saves nothing in the preferences.
	 */
	exportTheme(theme: Theme): Promise<ExportThemeResult>;
	/**
	 * Read a theme from a file the person picks (`readThemeFile` in
	 * ./theme-file.ts). A file that is not a whole theme is refused with the
	 * reason. Saves nothing: adding the theme is a save of the preferences.
	 * Read-only and safe to call again.
	 */
	importTheme(): Promise<ImportThemeResult>;
	/**
	 * Ask the person for a sound file of their own, for Settings,
	 * Notifications. Saves nothing: the path comes back to be saved with the
	 * section. A file whose path or type the app cannot use is refused.
	 */
	chooseSoundFile(): Promise<ChooseSoundResult>;
	/** Play a sound now, as a preview in Settings. Answers how it went, so Settings can say when it could not play. */
	playSound(choice: SoundChoice): Promise<SoundOutcome>;
	/**
	 * Timber's own settings for one scope, read by `timber __app-config read`:
	 * the machine defaults, or with `repository`, the path of a primary
	 * checkout in the list, that repository's `.timber.toml`. Timber reads the
	 * file; the app never does. Says which logins are saved, never what they
	 * are. Read-only and safe to call again.
	 */
	readTimberSettings(request: TimberSettingsRequest): Promise<TimberSettingsReadResult>;
	/**
	 * Save one scope's settings with `timber __app-config apply`, which
	 * validates them, refuses when the file changed since the read named by
	 * `revision`, keeps settings the app does not edit, and writes the file
	 * and any login itself. The command is `settingsApplyArguments` in
	 * ./timber-config.ts, so the interface can show it first. Logins travel in
	 * a private input file only. Runs once and is never retried here: read
	 * again after every outcome.
	 */
	saveTimberSettings(request: TimberSettingsSaveRequest): Promise<TimberSettingsSaveResult>;
	/**
	 * Check that Timber can sign in to GitHub, Jira, or Linear with `timber
	 * __app-config check`, using the drafted settings and any login typed but
	 * not saved. Saves nothing, whatever the answer. The command is
	 * `connectionCheckArguments` in ./timber-config.ts.
	 */
	checkTimberConnection(request: TimberConnectionCheckRequest): Promise<TimberConnectionCheckResult>;
	/**
	 * The named workflows Timber offers for a repository in the list, named
	 * by the path of its primary checkout: each with its description and its
	 * agent, as a command, none, or not set. They are read with `timber
	 * __app-config read --scope repository` (./workflows.ts), so the machine
	 * defaults and `.timber.toml` are merged by name as Timber merges them,
	 * and the app never parses Timber's TOML for them. A record that cannot
	 * be read is a failure, never an empty list. An agent's arguments can
	 * hold tokens: never log them. Read-only and safe to call again.
	 */
	listWorkflows(repository: string): Promise<WorkflowList>;
	/**
	 * The pull request of each worktree of a repository in the list, named by
	 * the path of its primary checkout, read by `timber __app-pr` with
	 * Timber's own GitHub login (./pull-requests.ts). The app holds no token
	 * and never signs in. Each entry is found, none, or failed with a reason
	 * (offline, sign-in needed, not on GitHub, failed). A record that cannot
	 * be read is a failure with a message, never an empty answer. Titles are
	 * text from GitHub: show them as text only. Read-only: no file or ref
	 * changes, and nothing acts on a pull request. Safe to call again.
	 */
	readPullRequests(repository: string): Promise<PullRequestList>;
	/**
	 * The live title and status of the issue linked to one worktree of a
	 * repository in the list, read by `timber __app-issue` with Timber's own
	 * tracker login (./issues.ts). The app holds no token and never signs in.
	 * The answer is found, none, or failed with a reason (offline, sign-in
	 * needed, not found, forbidden, failed). A record that cannot be read, or
	 * that is about another worktree, is a failure with a message. Titles and
	 * status names are text from the tracker: show them as text only.
	 * Read-only: no file, ref, or issue changes. Safe to call again.
	 */
	readIssue(request: IssueRequest): Promise<IssueLookup>;
	/**
	 * Timber's recovery backups of a repository in the list, named by the path
	 * of its primary checkout, read by `timber backup list --json`
	 * (./backups.ts): the usable ones with whether each is protected, the
	 * unfinished deletions, and what is not usable, each with Timber's reason.
	 * `unsupported` when the Timber found has no such list. A record that
	 * cannot be read is a failure with a message, never an empty list.
	 * Branches and paths are the person's own text: show them as text only.
	 * Read-only: no file or ref changes. Safe to call again.
	 */
	readBackups(repository: string): Promise<BackupList>;
	/**
	 * Restore a backup into a new worktree by running `timber backup restore
	 * --result-file` in a repository from the list, on branch `recovery/<id>`
	 * in the folder named, which must be a whole path. The command is
	 * `backupRestoreArguments` in ./backups.ts, so the interface can show it
	 * first. Timber never changes the backup or the worktree it came from. It
	 * runs once and is never retried here. Read the list after every outcome.
	 */
	restoreBackup(request: BackupRestoreRequest): Promise<BackupRestoreResult>;
	/**
	 * Delete one backup with `timber __app-backup delete`, approving the
	 * backup as the person saw it by its record's digest from `readBackups`.
	 * Timber refuses, and deletes nothing, when the backup changed since, or
	 * is protected. The command is `backupDeleteArguments` in ./backups.ts.
	 * Runs once and is never retried here. Read the backups again after every
	 * outcome.
	 */
	deleteBackup(request: BackupDeleteRequest): Promise<BackupDeleteResult>;
	/**
	 * Open a worktree of a repository in the list in the editor from the
	 * preferences, started detached so it outlives the app. The command comes
	 * only from the saved setting, with the worktree's path as one argument
	 * (`editorCommand` in ./editor.ts). Nothing else ever starts an editor:
	 * New and Open pass `--no-editor` to Timber.
	 */
	openInEditor(request: OpenInEditorRequest): Promise<OpenInEditorResult>;
	/**
	 * The changed files of a worktree of a repository in the list, as `git
	 * status` lists them: staged and unstaged apart, every untracked file on
	 * its own. Read-only and safe to call again.
	 */
	readFileChanges(request: FileChangesRequest): Promise<FileChangesResult>;
	/**
	 * The diff of one file from `readFileChanges`: `git diff --cached` for a
	 * staged change, `git diff` for an unstaged one, and the whole file as
	 * added for an untracked one. A binary file or a very large diff comes
	 * without its text. Read-only and safe to call again.
	 */
	readFileDiff(request: FileDiffRequest): Promise<FileDiffResult>;
	/**
	 * Every terminal session the machine holds, running or exited. Sessions
	 * outlive the window's view of them: one keeps running while another
	 * worktree is selected, and after the interface reloads.
	 */
	listTerminals(): Promise<TerminalSession[]>;
	/**
	 * Start the person's shell in a worktree of a repository in the list, as
	 * a new session beside any it has. Each call starts one. `cols` and
	 * `rows` are the pane's size. With `agent`, the agent of that name from
	 * the saved preferences starts instead, its command taken from there only
	 * (`agentCommand` in ./agent.ts). An agent that is not saved, or whose
	 * executable is not found, starts nothing and keeps no session. Nothing
	 * else starts an agent: New and Open never do. With `timberRebase`,
	 * `timber rebase` starts instead, with the Timber that was found, and
	 * nothing starts while Timber is not ready. With `timberWorktreeSetup`,
	 * the worktree's setup scripts run with `timber open --setup` instead
	 * (`worktreeSetupArguments` in ./worktree-commands.ts), the same way.
	 */
	openTerminal(request: OpenTerminalRequest): Promise<OpenTerminalResult>;
	/**
	 * Give a session another name, cleaned up as `cleanSessionName` does. The
	 * change is also heard through `onTerminalChanged`. Answers the session as
	 * it now is, or null when it is gone or the name has nothing in it.
	 */
	renameTerminal(id: string, name: string): Promise<TerminalSession | null>;
	/**
	 * The end of what a session printed, to draw it again, with the number of
	 * the last part it holds (see `onTerminalOutput`). Null for a session that
	 * is gone.
	 */
	readTerminal(id: string): Promise<TerminalSnapshot | null>;
	/**
	 * Say that the window drew a session's parts up to and including `seq`, or
	 * will not draw them. The machine sends a session only so far ahead of
	 * this. Nothing comes back.
	 */
	drawnTerminal(id: string, seq: number): void;
	/** Pass what was typed or pasted on to a running session. Nothing comes back. */
	writeTerminal(id: string, data: string): void;
	/** Tell a running session the size of its pane. Nothing comes back. */
	resizeTerminal(id: string, cols: number, rows: number): void;
	/**
	 * End a session and forget it: a running process is hung up on, and killed
	 * if it does not end. Answers once it has ended. Safe to call again.
	 */
	closeTerminal(id: string): Promise<void>;
	/** Hear each part of what any session prints, numbered per session. Returns a function that stops listening. */
	onTerminalOutput(listener: (output: TerminalOutput) => void): () => void;
	/** Hear when a session starts, ends, or is gone. Returns a function that stops listening. */
	onTerminalChanged(listener: (change: TerminalChange) => void): () => void;
	/**
	 * Hear when the person clicked the desktop notification of a session,
	 * such as one for an agent that needs them: the window came forward, and
	 * the listener gets the session's id, to select its worktree and show it.
	 * The machine sends a notification when a session's status moves to
	 * Needs you, Done, Error, or crashed while its worktree is not on screen
	 * in a focused window (see `attend` and ./status-notices.ts), as
	 * `statusNotifications` and `notifyStates` choose. Returns a function
	 * that stops listening.
	 */
	onShowSession(listener: (id: string) => void): () => void;
	/**
	 * Hear when the app was asked to quit, or its window to close, while
	 * terminals run. Nothing quits until `confirmQuit`. The listener gets how
	 * many run. With no listener, nobody can be asked, and the app quits.
	 * Returns a function that stops listening.
	 */
	onQuitRequested(listener: (live: number) => void): () => void;
	/** The person agreed to quit: end every session and quit the app. */
	confirmQuit(): Promise<void>;
	/** Put text on the system clipboard, for copying from a terminal. */
	writeClipboard(text: string): Promise<void>;
	/** The text on the system clipboard, for pasting into a terminal. Null when there is none. */
	readClipboard(): Promise<string | null>;
	/**
	 * Open a web link from a terminal in the person's browser. Only `http` and
	 * `https` links are opened. Answers whether it was handed on.
	 */
	openLink(url: string): Promise<boolean>;
	/**
	 * Whether this copy of the app can uninstall itself, and what that would
	 * do: the uninstaller's command, to show before it runs, and what it
	 * removes. Only an installed copy can. Read-only and safe to call again.
	 */
	uninstallPlan(): Promise<UninstallPlan>;
	/**
	 * Remove the app from this computer by running the uninstaller that the
	 * installer left beside it, with the command from `uninstallPlan`, and
	 * then quit, ending every terminal without asking again. With
	 * `forgetSettings` the app also deletes its own settings, once the
	 * uninstaller has finished. Repositories, worktrees, and Timber are never
	 * touched. Not safe to call again: after it worked there is no app.
	 */
	uninstall(request: UninstallRequest): Promise<UninstallResult>;
	/**
	 * Whether this copy of the app can restart itself, so that a saved
	 * preference read only at start is used (see `restartNeededFor` in
	 * ./preferences.ts). Read-only and safe to call again.
	 */
	restartPlan(): Promise<RestartPlan>;
	/**
	 * Quit, ending every terminal without asking again, and start the app
	 * again with the same arguments and environment once it is gone. The
	 * window asks first while terminals run. When it works, the answer may
	 * never arrive, because the app is gone.
	 */
	restart(): Promise<RestartResult>;
}
