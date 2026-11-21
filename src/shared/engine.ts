import type { AppInfo } from "./app-info";
import type { AppUpdateInstallRequest, AppUpdateInstallResult, AppUpdateState } from "./app-update";
import type { ArenaInspection, ArenaList, ArenaPresetList, NewArenaRequest, NewArenaResult, PickArenaRequest, PickArenaResult } from "./arenas";
import type { ChopList, ChopsRequest, RunChopRequest, RunChopResult } from "./chops";
import type { BackupDeleteRequest, BackupDeleteResult, BackupList, BackupRestoreRequest, BackupRestoreResult } from "./backups";
import type { Attention } from "./attention";
import type { FetchResult, ForcePushSeen, RepositoryFetch } from "./git-fetch";
import type { FileChangesRequest, FileChangesResult, FileDiffRequest, FileDiffResult } from "./file-changes";
import type { WorktreeFileRequest, WorktreeFileResult, WorktreeFileWriteRequest, WorktreeFileWriteResult } from "./worktree-files";
import type { WorktreeFolderChange, WorktreeFolderRequest, WorktreeFolderResult, WorktreeFolderWatch } from "./worktree-folders";
import type { WorktreeHandoff } from "./handoff";
import type { Layout } from "./layout";
import type { AddRepositoryResult, BranchSuggestion, NewWorktreeRequest, OpenInEditorRequest, OpenInEditorResult, OpenWorktreeRequest, RemoveRepositoryResult, ReorderRepositoriesResult, Repository, RepositoryGroupsResult, SaveLayoutResult, SavePreferencesResult, TimberStatus, WorktreeCommandResult } from "./model";
import type { Preferences } from "./preferences";
import type { RepositoryGroups } from "./repository-groups";
import type { RestartPlan, RestartResult } from "./restart";
import type { IssueSearchRequest, IssueSearchResult } from "./issue-search";
import type { IssueListRequest, IssueListResult } from "./issue-lists";
import type { IssueLookup, IssueRequest } from "./issues";
import type { PortsRequest, PortsResult } from "./ports";
import type { PullRequestList } from "./pull-requests";
import type { Theme } from "./theme";
import type { ChooseSoundResult, SoundChoice, SoundOutcome } from "./sound-setting";
import type { ExportThemeResult, ImportThemeResult } from "./theme-file";
import type { SavedSessions } from "./saved-sessions";
import type { OpenTerminalRequest, OpenTerminalResult, PasteResult, TerminalChange, TerminalOutput, TerminalSession, TerminalSnapshot } from "./terminal";
import type { TimberConnectionCheckRequest, TimberConnectionCheckResult, TimberSettingsReadResult, TimberSettingsRequest, TimberSettingsSaveRequest, TimberSettingsSaveResult } from "./timber-config";
import type { RebaseRequest, RebaseResult } from "./timber-rebase";
import type { SyncActionRequest, SyncActionResult } from "./sync-actions";
import type { SetBaseRequest, SetBaseResult } from "./timber-base";
import type { CreatePullRequestRequest, CreatePullRequestResult, HeadSubjectRequest } from "./timber-pr";
import type { DoneApplyRequest, DoneApplyResult, DonePreviewRequest, DonePreviewResult } from "./timber-done";
import type { UninstallPlan, UninstallRequest, UninstallResult } from "./uninstall";
import type { WorkflowList } from "./workflows";
import type { IssueTrackers } from "./issue-trackers";

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
	/** Whether the Timber the app runs (bundled, chosen in Settings, or on PATH) is usable, and where it came from, as of the last look. */
	timberStatus(): Promise<TimberStatus>;
	/** Look for Timber again, for example after the person installed it. */
	recheckTimber(): Promise<TimberStatus>;
	/** Hear that the Timber status changed on its own, for example when a newer release came out or another Timber was chosen. Returns a function that stops listening. */
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
	 * The groups the sidebar gathers repositories into, in order, and the
	 * group of each grouped repository, by the path of its primary checkout.
	 * None while the development override is set. Read from the app's saved
	 * list without asking Git or Timber.
	 */
	listRepositoryGroups(): Promise<RepositoryGroups>;
	/**
	 * Make a group at the end. With `repository`, that repository goes in it,
	 * at the end of the shown order. The name is trimmed, and must not be empty
	 * or the name of another group, ignoring case. This only changes the app's
	 * saved list, never anything in a repository or its folder.
	 */
	createRepositoryGroup(name: string, repository?: string): Promise<RepositoryGroupsResult>;
	/**
	 * Give a group a new name, by the rules of `createRepositoryGroup`. An id
	 * that names no group changes nothing. This only changes the app's saved
	 * list, never anything in a repository or its folder.
	 */
	renameRepositoryGroup(id: string, name: string): Promise<RepositoryGroupsResult>;
	/**
	 * Delete a group. Its repositories stay in the list, loose. Also forgets
	 * that it was folded. An id that names no group changes nothing. This only
	 * changes the app's saved list, never anything in a repository or its folder.
	 */
	deleteRepositoryGroup(id: string): Promise<RepositoryGroupsResult>;
	/**
	 * Order the groups by id, with the same leave-out and skip rules as
	 * `reorderRepositories`. This only changes the app's saved list, never
	 * anything in a repository or its folder.
	 */
	reorderRepositoryGroups(order: string[]): Promise<RepositoryGroupsResult>;
	/**
	 * Put a repository in a group, or with null take it out, and with `order`
	 * also save the whole list in that order (same rules as
	 * `reorderRepositories`), in one save. A repository or group that is not
	 * listed changes nothing. This only changes the app's saved list, never
	 * anything in a repository or its folder.
	 */
	placeRepository(path: string, group: string | null, order?: string[]): Promise<RepositoryGroupsResult>;
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
	 * the engine runs no Git command to abort or continue it. Read the list
	 * after every outcome.
	 */
	rebaseWorktree(request: RebaseRequest): Promise<RebaseResult>;
	/**
	 * Run a sync action, Pull or Push, in a worktree Timber lists, in the same
	 * turn as the other commands of its repository, and answer how it ended.
	 * The commands are `syncActionSteps` in ./sync-actions.ts, so the interface
	 * can show them before asking. Each runs as an executable plus arguments,
	 * and nothing ever prompts. Pull runs Git in the worktree's folder; its
	 * fetch runs as one fetch of the repository, never beside another, and a
	 * force-push it brings in is marked. Push runs `timber publish` with a
	 * result file, never beside a fetch; Timber decides what may be pushed and
	 * never force-pushes. Nothing runs when the branch's remote or upstream is
	 * no longer the one in `request.target`. It runs once and is never retried
	 * here. Read the list after every outcome.
	 */
	runSyncAction(request: SyncActionRequest): Promise<SyncActionResult>;
	/**
	 * Save a worktree's base by running `timber base --set <ref>
	 * --result-file` in a repository from the list, and answer how it ended as
	 * Timber's record says: set, refused, or failed. The command is
	 * `setBaseResultArguments` in ./timber-base.ts, so the interface can show
	 * it before asking. Timber checks the base and changes only its saved
	 * metadata, never the branch, the index, or files. It runs once and is
	 * never retried here. Read the list after every outcome.
	 */
	setWorktreeBase(request: SetBaseRequest): Promise<SetBaseResult>;
	/**
	 * Publish a worktree's branch and open a pull request for it by running
	 * `timber pr --result-file` in a repository from the list, and answer how
	 * it ended as Timber's record says: created, already open, refused, or
	 * failed, with what became of each reviewer asked for on a created or
	 * already open one. The command is `prResultArguments` in ./timber-pr.ts, so the
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
	 * one in a focused window that shows (see `onShowSession`). The selected
	 * worktree's id and the session whose chip shows there are also kept, so
	 * the save at quit knows which worktree was selected and which chip
	 * showed in each (see `takeSavedSessions`).
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
	 * The issue trackers a repository in the list has set up, named by the
	 * path of its primary checkout, for the New worktree dialog's Tracker
	 * field: GitHub when the remote Timber uses is one github.com repository,
	 * Jira when a site and a login apply, Linear when a login applies, and the
	 * tracker Timber reads a bare issue with (./issue-trackers.ts). Timber's
	 * settings come from `timber __app-config read --scope repository`, the
	 * remote from a read-only `git remote get-url`. Says whether a login
	 * applies, never what it is. Read-only and safe to call again.
	 */
	readIssueTrackers(repository: string): Promise<IssueTrackers>;
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
	 * Issues of one tracker that match typed text, for suggestions in the New
	 * worktree dialog, found by `timber __app-issues search` with Timber's own
	 * tracker login (./issue-search.ts). Timber matches key prefixes and title
	 * words. Each issue says which worktree is already linked to it. The answer
	 * is found (possibly empty), failed with a reason (offline, sign-in needed,
	 * not configured, not found, forbidden, failed), or a failure with a
	 * message, marked unsupported when the Timber found has no
	 * `__app-issues`. Titles are text from the tracker: show them as text
	 * only. Read-only: no file, ref, or issue changes. Safe to call again.
	 */
	searchIssues(request: IssueSearchRequest): Promise<IssueSearchResult>;
	/**
	 * One list of a tracker's issues for the issues board: the current
	 * sprint, the issues assigned to the signed-in person, or the open issues,
	 * read by `timber __app-issues <list>` with Timber's own tracker login
	 * (./issue-lists.ts). Each issue says which worktree is already linked to
	 * it. The answer is found (possibly empty, and for a sprint with the
	 * sprint's name), none (no current sprint), failed with a reason as for a
	 * search (`not-configured` when the list is not set up), or a failure with
	 * a message, marked unsupported when the Timber found has no
	 * `__app-issues`. Titles are text from the tracker: show them as text
	 * only. Read-only: no file, ref, or issue changes. Safe to call again.
	 */
	listIssues(request: IssueListRequest): Promise<IssueListResult>;
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
	 * The arenas of a repository in the list, named by the path of its
	 * primary checkout, read by `timber __app-arena list` (./arenas.ts): each
	 * arena with its base commit and its attempts, each attempt with its
	 * label, tool, worktree, state, and whether Git still has it as Timber
	 * created it. An arena Timber could not read is a failed entry beside the
	 * others. `unsupported` when the Timber found has no arenas for apps. A
	 * record that cannot be read is a failure with a message, never an empty
	 * list. The task is never in it. Read-only: no file, ref, or record
	 * changes. Safe to call again.
	 */
	listArenas(repository: string): Promise<ArenaList>;
	/**
	 * The saved arena presets of a repository in the list, by name and tool,
	 * read with `timber __app-config read --scope repository`, merged by
	 * Timber. Their commands stay with Timber and never reach the interface.
	 * Read-only and safe to call again.
	 */
	listArenaPresets(repository: string): Promise<ArenaPresetList>;
	/**
	 * Compare an arena's attempts with `timber arena pick <arena> --inspect
	 * --json`: for each, commits since the arena's base, committed and
	 * uncommitted changes apart, and how many untracked files. Read-only:
	 * Timber changes nothing. Safe to call again.
	 */
	inspectArena(request: { repository: string; arena: string }): Promise<ArenaInspection>;
	/**
	 * Create an arena by running `timber arena new ... --no-editor --no-agent
	 * --result-file` in a repository from the list. The command is
	 * `arenaNewArguments` in ./arenas.ts, so the interface can show it first.
	 * The task goes to Timber in a private temporary file, never as an
	 * argument, and is never logged. No agent starts here: start each
	 * attempt's with `openTerminal` and `arenaAttempt`. It runs once and is
	 * never retried here; a reserved arena keeps its name, so never create it
	 * again. Read the list and the arenas after every outcome.
	 */
	newArena(request: NewArenaRequest): Promise<NewArenaResult>;
	/**
	 * Keep one attempt of an arena by running `timber arena pick <arena>
	 * --winner <label> --result-file` in a repository from the list, which
	 * removes the others, saving any work under a `refs/timber/arena/...` ref.
	 * The command is `arenaPickArguments` in ./arenas.ts. First the app's
	 * sessions in the other attempts, as read from Timber right before, end:
	 * Timber cannot see them, and pick removes their worktrees. The winner's
	 * keep running. When one does not end, nothing is picked. The answer says what pick did to
	 * each attempt, with Timber's reason for any it kept. Runs once and is
	 * never retried here. Read the list and the arenas after every outcome.
	 */
	pickArena(request: PickArenaRequest): Promise<PickArenaResult>;
	/**
	 * Open a worktree of a repository in the list in the editor from the
	 * preferences, started detached so it outlives the app. The command comes
	 * only from the saved setting, with the worktree's path as one argument
	 * (`editorCommand` in ./editor.ts). Nothing else ever starts an editor:
	 * New and Open pass `--no-editor` to Timber.
	 */
	openInEditor(request: OpenInEditorRequest): Promise<OpenInEditorResult>;
	/**
	 * The changed files of a worktree of a repository in the list. Compared
	 * with the base: every change since `git merge-base <base> HEAD`,
	 * committed or not, with conflicts and untracked files apart, where the
	 * base is the one Timber saved for the worktree. Uncommitted, or when the
	 * base cannot be used: as `git status` lists them, staged and unstaged
	 * apart. Every untracked file is listed on its own. The answer says which
	 * comparison the files come from, and whether the base can be used or
	 * why not. Read-only and safe to call again.
	 */
	readFileChanges(request: FileChangesRequest): Promise<FileChangesResult>;
	/**
	 * The diff of one file from `readFileChanges`, in the same comparison:
	 * `git diff <branch point>` for a change since the base, `git diff
	 * --cached` for a staged change, `git diff` for an unstaged one, and the
	 * whole file as added for an untracked one. A binary file or a very large
	 * diff comes without its text. Read-only and safe to call again.
	 */
	readFileDiff(request: FileDiffRequest): Promise<FileDiffResult>;
	/**
	 * One file of a worktree of a repository in the list, for the File tab. The path is relative to the worktree, and neither it nor a
	 * link it is may lead outside the worktree. Only a plain file is read, up
	 * to `MAX_FILE_BYTES`; a larger or binary file comes without its text.
	 * Writes nothing and runs no Git. Safe to call again.
	 */
	readWorktreeFile(request: WorktreeFileRequest): Promise<WorktreeFileResult>;
	/**
	 * Save new text into one file of a worktree, from the File tab's edit
	 * mode, under the same rules as `readWorktreeFile`: only a plain file
	 * that is there already, inside the worktree, links included. Writes only
	 * that file, in place, keeping a byte order mark it starts with, and
	 * never creates one. When `expected` is given and the file holds other
	 * text now, nothing is written and the answer is "changed". Runs no Git.
	 */
	writeWorktreeFile(request: WorktreeFileWriteRequest): Promise<WorktreeFileWriteResult>;
	/**
	 * The entries of one folder of a worktree of a repository in the list,
	 * for the file explorer: folders first, `.git` left out, each marked when
	 * Git ignores it, and ignored ones only when asked. Neither the folder
	 * nor a link on the way may lead outside the worktree, and a link is
	 * listed as a link, never followed. At most `MAX_FOLDER_ENTRIES`, with how
	 * many more there are. Writes nothing; Git runs only as `git
	 * check-ignore`, without optional locks. Safe to call again.
	 */
	listWorktreeFolder(request: WorktreeFolderRequest): Promise<WorktreeFolderResult>;
	/**
	 * The folders of a worktree the file explorer shows, whenever they
	 * change; null when it shows none. The machine watches each of them,
	 * never what is below, at most `MAX_WATCHED_FOLDERS`, and reports a
	 * change in one through `onWorktreeFolderChanged` once its events settle.
	 * Nothing comes back. Safe to call with the same folders again.
	 */
	watchWorktreeFolders(folders: WorktreeFolderWatch | null): void;
	/** Hear when an entry of a watched folder was made, changed, or removed. Returns a function that stops listening. */
	onWorktreeFolderChanged(listener: (change: WorktreeFolderChange) => void): () => void;
	/**
	 * How many files the window holds unsaved edits of. While there are any,
	 * quitting or closing the window asks first, as while sessions run (see
	 * `onQuitRequested`). Safe to call with the same number again.
	 */
	reportUnsavedFiles(count: number): void;
	/**
	 * The ports a worktree of a repository in the list has open: what the
	 * running containers of its Compose project publish (`docker ps` and
	 * `docker inspect`), what its sessions' processes listen on (the Linux
	 * process table), and every host port more than one folder claims.
	 * Read-only. Nothing is read while the window is hidden (`attend`), and a
	 * worktree at most once in `PORTS_GAP_MILLISECONDS`: a request sooner
	 * gets the last answer (see ./ports.ts).
	 */
	readPorts(request: PortsRequest): Promise<PortsResult>;
	/**
	 * The chops a repository in the list offers, the same in every one of its
	 * worktrees: the person's saved chops merged with `.timber/chops.json` in
	 * the repository's main checkout (its primary checkout), as `mergeChops`
	 * in ./chops.ts merges them, with the file's chops that a personal one
	 * overrides, and how the file stood. A branch's change to the file shows
	 * once it reaches the main checkout. The file is read anew on every call,
	 * never cached. Nothing is written, and a missing `.timber` folder is not
	 * created. Read-only and safe to call again.
	 */
	listChops(request: ChopsRequest): Promise<ChopList>;
	/**
	 * Hear when the chops file of a repository's main checkout may have
	 * changed: `.timber` or `.timber/chops.json` there was written, made, or
	 * removed. Heard from a watch on those two folders only, never by
	 * polling. The listener gets the primary checkout, to list its chops
	 * again. Returns a function that stops listening.
	 */
	onChopsChanged(listener: (repository: string) => void): () => void;
	/**
	 * Run a chop in a worktree of a repository in the list. A command chop:
	 * the person's shell starts there as a new session named after the chop
	 * (never after the branch), and the chop's text is typed into it and
	 * run. The shell stays when the command ends, so its output can be read
	 * and the command run again. A prompt chop: with `session`, the text
	 * goes at once to that running agent session of the worktree, as one
	 * paste and then Enter, and the answer is `sent`; without it, the chop's
	 * agent, or the first saved agent, starts as a new session with nothing
	 * added to its command line, and gets the text once it is ready
	 * (`TerminalSession.prompt` says how that stands, see
	 * ./agent-prompt.ts). A chop that names an agent not saved, or with no
	 * agent saved, starts nothing (`not-configured`). The text comes from
	 * the chop list as the machine reads it for this call, once, never from
	 * the request. A chop
	 * from the repository's file runs only when its text was approved for
	 * this repository (`isChopApproved` in ./chops.ts); otherwise nothing
	 * starts and the answer is `needs-approval` with the exact text. A
	 * request whose `approve` is that exact text approves it, keeps the
	 * approval app-side, and runs it. Personal chops run straight away. Not
	 * safe to call again blindly: each call starts a session or sends the
	 * prompt again.
	 */
	runChop(request: RunChopRequest): Promise<RunChopResult>;
	/**
	 * Every terminal session the machine holds, running or exited. Sessions
	 * outlive the window's view of them: one keeps running while another
	 * worktree is selected, and after the interface reloads.
	 */
	listTerminals(): Promise<TerminalSession[]>;
	/**
	 * The sessions that were open when the app last quit, by worktree, for
	 * opening them again. Answered once per run: null after that, and when
	 * there are none. Each is opened with `openTerminal`, which is where
	 * every check is made.
	 */
	takeSavedSessions(): Promise<SavedSessions | null>;
	/**
	 * The saved worktrees of `takeSavedSessions` that the window found gone
	 * from the list, so the save at quit drops them. A saved session that was
	 * not opened again in this run for any other reason is kept for the next
	 * launch. Nothing is written until quit.
	 */
	forgetSavedSessions(worktrees: string[]): Promise<void>;
	/**
	 * Start the person's shell in a worktree of a repository in the list, as
	 * a new session beside any it has. Each call starts one. `cols` and
	 * `rows` are the pane's size. With `agent`, the agent of that name from
	 * the saved preferences starts instead, its command taken from there only
	 * (`agentCommand` in ./agent.ts). An agent that is not saved, or whose
	 * executable is not found, starts nothing and keeps no session. With
	 * `workflowAgent`, the agent of that named workflow starts instead, its
	 * command read again from Timber through the same read as
	 * `listWorkflows`, never taken from the request. A workflow that turns
	 * the agent off now starts nothing. Otherwise, unless Timber reports a
	 * command, the saved agent the request names with it starts; with none
	 * named, a workflow that is gone, cannot be read, or sets no agent starts
	 * nothing. Nothing
	 * else starts an agent: Timber's New and Open never do. With
	 * `timberWorktreeSetup`, the worktree's setup scripts run with
	 * `timber open --setup` instead (`worktreeSetupArguments` in
	 * ./worktree-commands.ts), with the Timber that was found, and nothing
	 * starts while Timber is not ready. With
	 * `arenaAttempt`, the attempt's agent starts with exactly the program,
	 * folder, and environment `timber __app-arena launch` gives for it, in
	 * the attempt's own worktree, and nothing starts for a manual attempt.
	 * With `resume`, an agent goes back to that conversation of its own when
	 * it can and it is still there, and otherwise starts fresh and says so in
	 * its terminal; only a UUID is read. With `name`, the session gets that
	 * name, cleaned, in place of the default. With `restore`, the session is
	 * the saved one at that worktree id and index, so the save at quit does
	 * not keep that saved one as well. All three are for opening a saved
	 * session again (see `takeSavedSessions`). With `review`, the saved agent
	 * starts as usual, with nothing of the review on its command line, and the review
	 * is pasted into its input once it is ready, as a prompt chop's prompt
	 * would be sent (./agent-prompt.ts), but with no Enter; the session's
	 * `prompt`, with `what: "review"`, says how that stands. Not safe to call
	 * again blindly: each call starts an agent and pastes the review again.
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
	/**
	 * Paste text into a running session, an agent's or a shell's, as a
	 * person's paste would arrive, without Enter, so the text waits in the
	 * program's input to be edited or sent. When the program asked for
	 * bracketed paste (mode 2004) the text goes as one bracketed paste
	 * (`bracketedPaste` in ./terminal.ts), so its line breaks stay part of
	 * it. When it did not, a text of one line is typed as it is, and a text
	 * with a line break is refused, since the break would act as Enter.
	 * Refused, and nothing written, when the text has a control or invisible
	 * character (`pasteProblem`), and `not-ready` while the session is an
	 * agent still waiting for the prompt chop or review it was started with
	 * (`TerminalSession.prompt` pending), since it may be on a first-run
	 * screen. Files are never touched: only the
	 * session's input is written. Not safe to call again blindly: each call
	 * pastes once more.
	 */
	pasteTerminal(id: string, text: string): Promise<PasteResult>;
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
	 * Hear when `timber new` or `timber open`, typed in one of the app's
	 * terminals, created a worktree and handed it to the app instead of
	 * starting its agent in that terminal (see ./handoff.ts). The listener
	 * opens the worktree's session. The handoff is a request only: the
	 * window opens a session only in a worktree it lists, and nothing named
	 * in it is run. Terminals outside the app never hand off. Returns a
	 * function that stops listening.
	 */
	onWorktreeHandedOff(listener: (handoff: WorktreeHandoff) => void): () => void;
	/**
	 * Hear when the app was asked to quit, or its window to close, while
	 * terminals run. Nothing quits until `confirmQuit`. The listener gets how
	 * many run. With no listener, nobody can be asked, and the app quits.
	 * Returns a function that stops listening.
	 */
	onQuitRequested(listener: (live: number) => void): () => void;
	/**
	 * The person agreed to quit: the open sessions are saved, so they open
	 * again on the next launch, then ended, and the app quits.
	 */
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
	/** Where updating the app from its GitHub releases stands (see ./app-update.ts). Read-only and safe to call again. */
	appUpdate(): Promise<AppUpdateState>;
	/**
	 * Look for a newer release now, and download it when there is one. It
	 * answers at once with where updating stands; what follows arrives through
	 * `onAppUpdateChanged`. A look already running is not started twice. A
	 * failed look, for example offline, is a state, never an error.
	 */
	checkForAppUpdate(): Promise<AppUpdateState>;
	/** Hear where updating the app stands each time it changes. Returns a function that stops listening. */
	onAppUpdateChanged(listener: (state: AppUpdateState) => void): () => void;
	/**
	 * Restart into the downloaded update. While sessions run it does nothing
	 * and says so, unless `endSessions` says the person agreed; then which
	 * sessions run is saved, so they open again, and they end. When it works,
	 * the answer may never arrive, because the app is gone.
	 */
	installAppUpdate(request: AppUpdateInstallRequest): Promise<AppUpdateInstallResult>;
}
