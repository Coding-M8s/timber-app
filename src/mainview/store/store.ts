import { sameAgentSettings } from "../../shared/agent";
import { type StatusHookRequest, type StatusHookResult, hookedAgent } from "../../shared/status-hooks";
import { type MissingPick, defaultAgent, whyNoDefaultAgent } from "../../shared/agent-lookup";
import type { IssueSearchRequest, IssueSearchResult } from "../../shared/issue-search";
import type { IssueList, IssueListResult } from "../../shared/issue-lists";
import type { IssueTracker } from "../../shared/model";
import { type IssueBoard, boardKey, boardView, emptyBoard, listsToRead, withRead, withReading } from "./issue-board";
import { type Attention, sameAttention } from "../../shared/attention";
import type { UninstallPlan, UninstallRequest, UninstallResult } from "../../shared/uninstall";
import type { RestartPlan, RestartResult } from "../../shared/restart";
import type { AppUpdateInstallRequest, AppUpdateInstallResult } from "../../shared/app-update";
import { readableEditorSetting } from "../../shared/editor";
import type { Engine } from "../../shared/engine";
import { type FolderListing, type WorktreeTree, readingListing, shownFolders, withFolder } from "../file-tree";
import type { WorktreeFolderResult, WorktreeFolderWatch } from "../../shared/worktree-folders";
import type { WorktreeHandoff } from "../../shared/handoff";
import type { FetchResult, ForcePushSeen, RepositoryFetch } from "../../shared/git-fetch";
import { type ChopList, type RunChopResult, commandChops, findListedChop, listedChops } from "../../shared/chops";
import { promptTarget, reviewWaiting } from "../agent-sessions";
import { describePromptCopied, describePromptCopiedNoAgentFound, describePromptSent } from "../chop-format";
import { type Comparison, type FileChange, type FileChangeTarget, type FileChangesResult, type FileDiff, type FileDiffResult, sameFileChange } from "../../shared/file-changes";
import type { PortsResult } from "../../shared/ports";
import { type DiffLayout, type Layout, type SidePanelView, chooseComparison, chooseIssueList, chosenComparison, clampChopsWidth, clampSidebarWidth, dismissSetup, forgetGroup, forgetRepository, sameLayout, toggleCollapsed, toggleGroupCollapsed } from "../../shared/layout";
import type { BranchSuggestion, NewWorktreeRequest, OpenInEditorRequest, OpenInEditorResult, OpenWorktreeRequest, RepositoryGroupsResult, ReportedWorktree, SavePreferencesResult, TimberFailure, TimberStatus, Worktree, WorktreeCommandResult } from "../../shared/model";
import { type Preferences, defaultPreferences } from "../../shared/preferences";
import type { ChopArrangements, ChopRename } from "../../shared/chop-order";
import type { IssueLookup } from "../../shared/issues";
import type { BackupDeleteRequest, BackupDeleteResult, BackupList, BackupRestoreRequest, BackupRestoreResult } from "../../shared/backups";
import type { ArenaInspection, ArenaList, ArenaPresetList, NewArenaRequest, NewArenaResult, PickArenaRequest, PickArenaResult } from "../../shared/arenas";
import type { PullRequestList } from "../../shared/pull-requests";
import { applyOrder, moveInOrder } from "../../shared/repository-order";
import { type IconChoice, type IconTarget, type RemoteIconSource, type SidebarIconResult, withIcon } from "../../shared/sidebar-icons";
import { type RepositoryGroups, emptyGroups, moveGroupAmong, placeInOrder, shownOrder, stepAmongSiblings, stepGroupAmongSiblings } from "../../shared/repository-groups";
import { type ZoomStep, stepZoom, zoomLabel } from "../../shared/zoom";
import type { Theme } from "../../shared/theme";
import type { ChooseSoundResult, SoundChoice, SoundOutcome } from "../../shared/sound-setting";
import type { ExportThemeResult, ImportThemeResult } from "../../shared/theme-file";
import { type OpenTerminalRequest, type OpenTerminalResult, type PasteResult, type TerminalChange, type TerminalSession, WORKTREE_SETUP_SESSION_NAME } from "../../shared/terminal";
import { type ReviewNote, buildReviewMessage, markOutdated, normalizeNoteText, notedFiles, noteLinesShown, noteProblem } from "../../shared/review";
import {
	REVIEW_COPIED, describeReviewAgentStarted, describeReviewNotPasted, describeReviewSent, noNewReviewAgent, reviewAlreadyWaiting,
} from "../review-format";
import type { TimberConnectionCheckRequest, TimberConnectionCheckResult, TimberSettingsReadResult, TimberSettingsRequest, TimberSettingsSaveRequest, TimberSettingsSaveResult } from "../../shared/timber-config";
import type { DoneApplyRequest, DoneApplyResult, DonePreview, DonePreviewRequest, DonePreviewResult } from "../../shared/timber-done";
import type { RebaseRequest, RebaseResult } from "../../shared/timber-rebase";
import { type SyncActionRequest, type SyncActionResult, syncTargetOf } from "../../shared/sync-actions";
import { type RepositoryAgentChange, forgetRepositoryAgent } from "../../shared/repository-agents";
import { confirmsPull, forgetPullRepository } from "../../shared/pull-confirm-setting";
import { SYNC_ACTION_WORDS, presentSyncResult } from "../sync-action-format";
import type { SetBaseRequest, SetBaseResult } from "../../shared/timber-base";
import { type CreatePullRequestResult, initialPullRequestBase, pullRequestBaseFromText, pullRequestReviewersFromText } from "../../shared/timber-pr";
import { type PullRequestFields, defaultPullRequestTitle, type PullRequestCreationView, presentPullRequestCreation, pullRequestTitleWithKey, titleKeyOf } from "../pull-request-create-format";
import type { WorkflowList } from "../../shared/workflows";
import type { IssueTrackers } from "../../shared/issue-trackers";
import { type Draw, createTerminalFeed } from "../terminal-feed";
import { describeOrphanTerminal, describeRestoreFailures, liveTerminalCount } from "../terminal-format";
import { installStepOf } from "../app-update-format";
import { BEING_REMOVED_REASON, describeDone, describeRemovalFailed } from "../done-format";
import { SESSION_STARTED_DIAGNOSTIC, describeCleanUpEnded } from "../clean-up-format";
import { describeOpenedInEditor } from "../editor-format";
import { describeHandoffNotListed, handoffSession } from "../handoff-format";
import { describeAdded, describeRemoved, folderName, worktreeLabel } from "../format";
import { workflowAgentLabel } from "../agent-format";
import { describeFetched } from "../fetch-format";
import { wantTerminalFocus } from "../terminal-focus";
import { withSeenStatuses } from "../seen-status";
import { nextWaitingSession, withFinishedOrder, withWaitingOrder } from "../waiting";
import { mergeOverlapping } from "./merge";
import { keepEntries } from "./records";
import { RESTORE_CONCURRENCY, RESTORE_QUIET_MILLISECONDS, type RestoreJob, goneSavedWorktrees, restoreJobs, restoreRequest, runLimited } from "./restore";
import { type SavedSessions, pickShown } from "../../shared/saved-sessions";
import { type WorktreeFileResult, normalCompletePath, textToSave } from "../../shared/worktree-files";
import { fileLines, fillUnchanged, linesMatchDiff, unchangedReadable } from "../diff-unchanged";
import { filterFiles, listedOrder, movedEntry, steppedFile } from "../changes-format";
import { COMMIT_ARGUMENTS, COMMIT_COMMAND_LINE, type CommitResult, commitBlocker } from "../../shared/commit-staged";
import { commitStateOf } from "../commit-format";
import { commitBlockerOf, generatorOf, pullRequestBlockerOf } from "../generate-format";
import { type GenerateKind, type GenerateTextResult, type GeneratedText, describeGenerateCommand, generateCommand } from "../../shared/generate-text";
import { type IndexAction, type IndexWriteResult, canWriteIndex, describeGitCommand, indexCommand } from "../../shared/index-writes";
import { type DiscardResult, discardCommand, discardPaths, fileDiscardable } from "../../shared/discard-files";
import { type FileEditMemory, createFileEditMemory } from "../text-editor-format";
import { afterSave, canEditFile, editableFileText, fileText, hasUnsavedEdits, initialFileMode, listedOnly, outsideResult, pathInWorktree, settleTabs, unsavedFileCount } from "../file-view-format";
import {
	type AppState, type ChangesView, type DialogRequest, type FileMode, type FileView, type Operation, type PullRequestForm, type Removal, type SessionAgent, type UnsavedFileStep, type WorkspaceTab, TOAST_MILLISECONDS, initialState, isBeingRemoved, keepLastGood, syncOptionsOf,
	reconcileRemovals, removalAt, reconcileSelection, runningSessionCount, canToggleSidePanel, chopsEnabled, filesPanelShown, offeredChops, sidePanelShown, sidePanelView, selectedWorktree, selectionFor, selectionForRepository, sessionOnScreen, sessionsOf, sessionsToVisit, shownSession, timberReady, withTerminal, withoutSession, fileViewed, viewedKey, type CommitRun, type GenerationRun, writesWait, repositoryPick } from "./state";

/** How `AppStore.runChop` runs a chop, beyond which one and where. */
export interface RunChopOptions {
	/** The chop's own text, as confirmed in the approval dialog. */
	approve?: string;
	/** For a prompt: a running agent session, or a new agent with `{ session: null }`. */
	target?: { session: string | null };
	/** Text the person edited for this run, typed or sent in place of the chop's once. */
	text?: string;
}

/**
 * The single holder of what the interface shows: Timber's status, the
 * repositories and their worktrees, the selection, and operations in progress.
 * Components read it and call its actions. Nothing else keeps a copy.
 */
export interface AppStore {
	getState(): AppState;
	/** Hear about every change of state. Returns a function that stops listening. */
	subscribe(listener: () => void): () => void;
	/**
	 * Look for Timber, load the repositories once it is ready, and reload a
	 * repository whenever the engine reports a change in it. Returns a function
	 * that stops listening to the engine.
	 */
	start(): () => void;
	/**
	 * Say whether the window shows and has the focus. From `start` on, the
	 * store tells the engine whenever this or the selected worktree changes,
	 * so the machine refreshes in the background only what can be seen.
	 */
	windowChanged(window: WindowState): void;
	/** Look for Timber again, for example after the person installed it. */
	retryTimber(): Promise<void>;
	/** Reload everything. */
	refresh(): Promise<void>;
	/** Reload one repository, named by the path of its primary checkout. */
	reloadRepository(path: string): Promise<void>;
	/**
	 * Fetch a repository now, named by the path of its primary checkout, or
	 * wait for the fetch that runs. Fetched: a toast. Failed: the quiet marker
	 * on the repository, through `fetches`, never a dialog. Never throws.
	 * Answers with what the engine said, or null when one was already asked.
	 */
	fetchNow(path: string): Promise<FetchResult | null>;
	/**
	 * Open the folder picker and add the picked repository to the saved list.
	 * The added repository, or the one that was already listed, becomes selected.
	 */
	addRepository(): Promise<void>;
	/** Forget a repository in the app. Nothing on disk changes. */
	removeRepository(path: string): Promise<void>;
	/**
	 * Move a repository to `index` in the list, counted without it, and save
	 * the new order. The list shows it at once; a save that fails puts the
	 * saved order back and says why in `notice`. Nothing on disk changes but
	 * the app's settings.
	 */
	moveRepository(path: string, index: number): Promise<void>;
	/*
	 * Repository groups. Each only changes the app's saved list, and none reads
	 * a repository again: the engine answers with the groups as saved, and the
	 * store shows that. A name that is empty or taken is said in
	 * `groupNameProblem`; the override and a failed save in `notice`, with the
	 * groups and the order last saved put back.
	 */
	/** Make a group at the end of the groups inside `parent`, or of the top level, with `repository` in it when given. True when it was saved. */
	createGroup(name: string, repository?: string, parent?: string): Promise<boolean>;
	/** Give a group a new name. True when it was saved, or there was nothing to change. */
	renameGroup(id: string, name: string): Promise<boolean>;
	/** Delete a group. Its repositories and subgroups move up a level, and stay in the list. */
	deleteGroup(id: string): Promise<void>;
	/**
	 * Set the icon of a repository or a group, or with null remove it (see
	 * `Engine.setSidebarIcon`). A saved icon shows at once; any other outcome
	 * is answered for the icon dialog to say, and changes nothing shown.
	 */
	setSidebarIcon(target: IconTarget, choice: IconChoice | null): Promise<SidebarIconResult>;
	/** Where a repository can take its icon from, or null (see `Engine.readRemoteIconSource`). Null when it cannot be read. */
	readRemoteIconSource(path: string): Promise<RemoteIconSource | null>;
	/**
	 * Move a group inside `parent` (null for the top level), before `before`, or at the end there. Shows at once. A
	 * move that is refused (see `Engine.moveRepositoryGroup`) says why in `notice` and asks nothing of the engine.
	 */
	moveGroup(id: string, parent: string | null, before: string | null): Promise<void>;
	/** Move a group one place among the groups that share its parent. Shows at once. */
	stepGroup(id: string, step: -1 | 1): Promise<void>;
	/**
	 * Put a repository in a group, or with null take it out, before `before`
	 * (a repository in that destination) or, without one, at its end. Shows at once.
	 */
	placeRepository(path: string, group: string | null, before?: string | null): Promise<void>;
	/** Move a repository one place among its siblings: the repositories of its group, or the loose ones. Shows at once. */
	stepRepository(path: string, step: -1 | 1): Promise<void>;
	/** Fold or open a repository group, named by its id, and remember it. */
	toggleRepositoryGroup(id: string): void;
	/** Put away the note about a group name, as when the person types again. */
	clearGroupNameProblem(): void;
	/** Put away the note about the latest add or remove. */
	dismissNotice(): void;
	/** Select a worktree by its identity (`Worktree.id`). One that no repository has is ignored. */
	select(worktreeId: string): void;
	/**
	 * Show a repository's issues board in place of the selected worktree, and
	 * read its trackers and the list it shows. Opening it is the only time it
	 * reads by itself: there is no timer.
	 */
	openBoard(repository: string): void;
	/** Read the board's trackers and the list it shows again, and each list that was not set up. */
	refreshBoard(repository: string): Promise<void>;
	/** Show another list on the board, remember it for the repository, and read it. */
	pickBoardList(repository: string, list: IssueList): Promise<void>;
	/** Show another tracker's lists on the board, for this run, and read the list shown. */
	pickBoardTracker(repository: string, tracker: IssueTracker): Promise<void>;
	/**
	 * Say briefly that an operation worked, or with `problem` that one failed
	 * where the details are kept. The toast disappears on its own.
	 */
	showToast(text: string, problem?: boolean): void;
	/** Put a toast away before its time is up. */
	dismissToast(id: number): void;
	/** Collapse or open the group of a repository, named by the path of its primary checkout, and remember it. */
	toggleGroup(repository: string): void;
	/**
	 * Set the sidebar width on screen, kept within its limits. Nothing is saved:
	 * call `saveLayout` when the resize ends.
	 */
	resizeSidebar(width: number): void;
	/**
	 * Show the chops panel when it is hidden and hide it when it shows, and
	 * remember that. Does nothing, and answers false, while chops are not in
	 * use, a dialog or the quit question is open, or Timber is not ready
	 * (`canToggleChopsPanel`). Answers whether the panel now shows or hides
	 * because of this call.
	 */
	toggleChopsPanel(): boolean;
	/**
	 * Show the side panel with this view, the chops or the files, or hide it
	 * when it shows that view already, and remember that. Does nothing, and
	 * answers false, when `canToggleSidePanel` says no. Answers whether the
	 * panel changed because of this call.
	 */
	toggleSidePanel(view: SidePanelView): boolean;
	/**
	 * Show this view in the side panel, from the switch in its header, and
	 * remember it. Never hides the panel. Answers whether the view changed.
	 */
	switchSidePanel(view: SidePanelView): boolean;
	/** Hide the side panel, as its Close button does, and remember that. The saved chops stay. */
	hideChopsPanel(): void;
	/**
	 * Show the side panel with this view, and remember that. Unlike
	 * `toggleSidePanel`, it never hides the panel. Does nothing, and answers
	 * false, when `canToggleSidePanel` says no.
	 */
	showSidePanel(view: SidePanelView): boolean;
	/**
	 * Open or close a folder in the file explorer of a worktree, by its
	 * identity. An opened folder is read, and watched while it shows. A closed
	 * one forgets its entries and its open folders.
	 */
	setFolderOpen(worktreeId: string, folder: string, open: boolean): void;
	/** Show or hide the entries Git ignores in the file explorer, and read the folders that show again. */
	toggleIgnoredFiles(): void;
	/** Read every folder the file explorer shows for a worktree again, as after a failure. */
	readFoldersAgain(worktreeId: string): void;
	/**
	 * Set the chops panel's width on screen, kept within its limits. Nothing
	 * is saved: call `saveLayout` when the resize ends.
	 */
	resizeChopsPanel(width: number): void;
	/**
	 * Remember the layout on screen for the next run. A save that fails leaves
	 * the screen alone and is noted in `layoutProblem`.
	 */
	saveLayout(): Promise<void>;
	/** Put away the note about the layout. */
	dismissLayoutProblem(): void;
	/**
	 * Save the preferences that `change` names, keeping the others. What is on
	 * screen follows only once the engine says it saved, so a failed save
	 * changes nothing. Never throws: an engine that could not answer is a
	 * failed save with the reason. `repositoryAgents` sets or clears default
	 * agents of repositories in the same save (`Engine.savePreferences`).
	 */
	savePreferences(change: Partial<Preferences>, repositoryAgents?: RepositoryAgentChange): Promise<SavePreferencesResult>;
	/**
	 * Look again for the saved agents' executables (`agentLocations`), as
	 * after installing one. An answer older than the one shown is dropped.
	 * Answers whether this look's answer was shown. Never throws: when the
	 * engine cannot answer, what was known stays, and the answer is false.
	 */
	locateAgents(): Promise<boolean>;
	/**
	 * Read again how each saved agent reports its status (`statusHooks`). An
	 * answer older than the one shown is dropped. Never throws: when the
	 * engine cannot answer, what was known stays.
	 */
	loadStatusHooks(): Promise<void>;
	/** Turn on, or take out, an agent's status hook as last shown, and show every row as found after. Never throws. */
	installStatusHook(request: StatusHookRequest): Promise<StatusHookResult>;
	removeStatusHook(request: StatusHookRequest): Promise<StatusHookResult>;
	/**
	 * Save the order and favorites of the chops panel as the `chopOrder`
	 * preference, with any other preferences `also` names in the same save.
	 * Shown at once (`chopOrderAim`), so a move made before the save answers
	 * builds on this one. When the latest save fails, the saved order shows
	 * again, and the result gives the reason.
	 */
	saveChopOrder(chopOrder: ChopArrangements, also?: Omit<Partial<Preferences>, "chopOrder">): Promise<SavePreferencesResult>;
	/** Say that a save about to start renames these chops, so the chops panel keeps their places until the list is read again (`chopRenaming`). */
	noteChopRenames(renames: readonly ChopRename[]): void;
	/**
	 * Zoom one step in or out, or back to 100%, from the keyboard, and save it
	 * as the zoom preference. Steps taken before a save answers count from
	 * the zoom they asked for, so quick presses add up. A toast says the zoom,
	 * also at either end, where it stays. A failed save changes nothing.
	 * Never throws.
	 */
	changeZoom(step: ZoomStep): Promise<void>;
	/**
	 * Open a worktree in the editor from the preferences. With no usable
	 * editor set, this opens Settings at Editor instead and asks nothing of
	 * the engine.
	 * Started: a toast. Anything else: `editorProblem`, which names the
	 * command. One at a time per worktree. Never throws. Answers with what the
	 * engine said, or null when it was not asked.
	 */
	openInEditor(request: OpenInEditorRequest): Promise<OpenInEditorResult | null>;
	/** Put away the note about the last "Open in editor". */
	dismissEditorProblem(): void;
	/** Show one of the views of the selected worktree. The diff and File tabs show only while a diff or a file is open there. */
	showTab(tab: WorkspaceTab): void;
	/**
	 * Close the diff tab of a worktree, named by its identity, and show the
	 * tab it was opened from when it showed.
	 */
	closeDiff(worktreeId: string): void;
	/**
	 * Open a file of a worktree, named by its identity, in its File tab, and
	 * show that tab. The path is relative to the worktree, or absolute inside
	 * it; anything else is refused without a read. Replaces the file open there.
	 */
	openFile(worktreeId: string, path: string): void;
	/** Read the open file of a worktree again, as it is on disk now. With unsaved edits, asks first. */
	readFileAgain(worktreeId: string): void;
	/** Close the file of a worktree, which hides its File tab and shows the tab it was opened from. With unsaved edits, asks first. */
	closeFile(worktreeId: string): void;
	/** Show the open file rendered or as its source. Any draft stays, and shows in either. */
	showFileAs(worktreeId: string, mode: Exclude<FileMode, "edit">): void;
	/** Edit the open file's text, starting from the file as read, or from the draft kept since. */
	editFile(worktreeId: string): void;
	/** The edited text of the open file, as typed. A file other than Markdown gets its draft from the first change. */
	changeDraft(worktreeId: string, text: string): void;
	/**
	 * Save the draft of the open file, only that file, through the engine.
	 * Nothing is written when the file changed on disk since it was read,
	 * unless `overwrite` says to write over it. Answers whether it saved.
	 */
	saveFile(worktreeId: string, options?: { overwrite?: boolean }): Promise<boolean>;
	/** Drop the draft of the open file, and show the file as it is on disk. */
	discardEdits(worktreeId: string): void;
	/**
	 * The editor's undo history, caret, and scroll for the open file of a
	 * worktree, kept outside the state so typing does not render the window.
	 * It is forgotten with the draft: on Discard, Read again, closing the
	 * file, opening another, and when the worktree leaves the list.
	 */
	fileEditMemory(worktreeId: string, path: string): FileEditMemory;
	/** Answer the question about unsaved edits: save then go on, discard then go on, or keep editing. */
	answerUnsavedFile(answer: "save" | "discard" | "keep"): Promise<void>;
	/**
	 * Read the changed files of a worktree, named by the path of its
	 * repository and its identity, into `changes`, and then the diff of the
	 * file of its diff tab. A diff tab whose file is no longer listed closes.
	 * Another worktree starts the view afresh. The latest read wins. Never
	 * throws.
	 */
	readChanges(repository: string, worktreeId: string): Promise<void>;
	/**
	 * Stage or unstage files of the Uncommitted list, as `Engine.stageFiles`
	 * and `Engine.unstageFiles` do, with the command `indexCommand` gives,
	 * then read the list again at once. Does nothing (null) outside
	 * Uncommitted, while another write runs, or for a file not listed in a
	 * group that takes the action. Never throws.
	 */
	writeIndex(action: IndexAction, files: readonly FileChangeTarget[]): Promise<IndexWriteResult | null>;
	/**
	 * Discard the changes of files of one group of the Uncommitted list, as
	 * `Engine.discardFiles` does, with the command `discardCommand` gives.
	 * The Discard dialog calls it once the person confirmed. A file open in
	 * the File tab that it names drops its unsaved edits and is read again,
	 * so it shows as it is on disk. Then the list is read again at once.
	 * Does nothing (null) outside Uncommitted, while another write runs, or
	 * for a file not listed now in a group that can be discarded. Never
	 * throws.
	 */
	discardFiles(files: readonly FileChangeTarget[]): Promise<DiscardResult | null>;
	/** Keep what is typed in the commit message box of a worktree, until a commit is made there. */
	setCommitMessage(worktreeId: string, text: string): void;
	/**
	 * Commit what is staged in the worktree the Changes view shows, with its
	 * message, as `Engine.commitStaged` does. Made: the message clears, the
	 * view says the commit, and the list and the repository are read again,
	 * so the row's counts move. Not made: the message stays and the view says
	 * what Git and the hooks printed. Does nothing (null) outside
	 * Uncommitted, while another write runs, or when `commitBlocker` gives a
	 * reason. Never throws.
	 */
	commitStaged(): Promise<CommitResult | null>;
	/**
	 * Have the agent picked in Settings write a commit message for what is
	 * staged in the worktree the Changes view shows. It goes into the box when
	 * that is still empty and nothing changed in the worktree meanwhile; else
	 * it waits beside it (`generations`). A failure or a stop leaves the box.
	 * Does nothing while one runs, or when the button may not be pressed.
	 */
	generateCommitMessage(): Promise<void>;
	/**
	 * The same for the title and description of a worktree's pull request
	 * form, by worktree id. The title starts with the linked issue's key.
	 */
	generatePullRequestText(worktreeId: string): Promise<void>;
	/** Stop a worktree's run for one kind of text. */
	stopGenerating(worktreeId: string, kind: GenerateKind): void;
	/** Put the text that waits into its field. */
	fillHeld(worktreeId: string, kind: GenerateKind): void;
	/** Drop the text that waits, or a failure shown. */
	dropGenerated(worktreeId: string, kind: GenerateKind): void;
	/**
	 * For the one-click dialog: start the worktree's form when there is none,
	 * and have the agent write its title and description, which come back and
	 * go nowhere else. `id` is the run's, for `stopRun`. Never throws.
	 */
	writePullRequest(repository: string, worktreeId: string, id: string): Promise<GenerateTextResult>;
	/** Stop a run started with `writePullRequest`. */
	stopRun(id: string): void;
	/**
	 * Read the chops of a repository, named by the path of its primary
	 * checkout, into `chops`. The latest read wins, and another repository
	 * starts afresh. Never throws.
	 */
	readChops(repository: string): Promise<void>;
	/**
	 * Run a chop in a worktree, named by its repository and identity, as
	 * `Engine.runChop` does, and show its session. A command runs in a new
	 * session named after it. A prompt goes where `target` says: a running
	 * agent session, or a new agent with `{ session: null }`. Without a
	 * target it goes to a new agent when none runs in the worktree, to the
	 * only one when it does not wait on the person, and otherwise the Send
	 * prompt dialog asks (`promptTarget`). With no agent saved in Settings,
	 * a prompt is put on the clipboard instead. A repository chop whose text
	 * was not approved opens the dialog that shows it; `approve` is the text
	 * confirmed there. No new session starts while another one starts in the
	 * worktree, or in a folder being deleted. Why a new session did not start
	 * shows in `terminalProblem`, and why a prompt did not go to a running
	 * agent in a toast. `text`, when given, is typed or sent in place of the
	 * chop's own text, once: the person edited it just before this run. It
	 * goes through the same questions, and a repository chop's own text is
	 * still the one approved. It is noted as the repository's last chop
	 * (`lastChops`). Never throws.
	 */
	runChop(repository: string, worktreeId: string, chop: string, size: { cols: number; rows: number }, options?: RunChopOptions): Promise<void>;
	/**
	 * Type a command chop of the session's repository into a running session,
	 * with no Enter, as `Engine.pasteTerminal` does. A toast says when it
	 * could not. Never throws.
	 */
	insertChop(sessionId: string, chop: string): Promise<void>;
	/**
	 * Read the ports of a worktree, named by the path of its repository and
	 * its identity, into `ports` and `portClashes`. A hidden window's answer
	 * changes nothing. The latest read of each worktree wins. Never throws.
	 */
	readPorts(repository: string, worktreeId: string): Promise<void>;
	/**
	 * Open the diff of a file of `changes` in its worktree's diff tab, show
	 * that tab, and read the diff. Replaces the diff open there. Never throws.
	 */
	selectChangedFile(file: FileChangeTarget): Promise<void>;
	/**
	 * Open the diff of the file after (`1`) or before (`-1`) the diff tab's
	 * file, among the files the Changes view lists through its filter, going
	 * round at either end. Answers the file opened, or null when there is no
	 * other. Never throws.
	 */
	stepChangedFile(step: 1 | -1): Promise<FileChange | null>;
	/**
	 * Mark a listed file of `changes` Viewed, or not, as it was not. Marking
	 * it opens the next file (see `stepChangedFile`), which it answers; null
	 * when it opened none. It stays viewed until its version changes, while
	 * the window is open.
	 */
	toggleViewed(file: FileChange): Promise<FileChange | null>;
	/** Keep what is typed in the Changes view's "Filter files" box for a worktree. */
	setChangesFilter(worktreeId: string, text: string): void;
	/**
	 * Compare the worktree of `changes` with its base or with its last commit,
	 * remember that for the worktree in the layout, and read the files again.
	 * The diff tab closes: its file is listed in the other comparison apart.
	 * Never throws.
	 */
	compareChanges(compare: Comparison): Promise<void>;
	/** Lay the diff tab's lines out in one column or side by side, for every worktree, and remember that in the layout. */
	chooseDiffLayout(layout: DiffLayout): void;
	/**
	 * Keep a review note on lines of a diff of a worktree. Answers why it was
	 * not kept, or null. Nothing is sent: notes wait in `reviews`.
	 */
	addReviewNote(worktreeId: string, note: Omit<ReviewNote, "id" | "outdated">): string | null;
	/** Change what a kept note says. Answers why it was not changed, or null. */
	editReviewNote(worktreeId: string, id: string, text: string): string | null;
	deleteReviewNote(worktreeId: string, id: string): void;
	/** Forget every note of a worktree without sending them. */
	discardReview(worktreeId: string): void;
	/**
	 * Show the file and lines of a note in the diff tab of the worktree it
	 * shows, in the note's comparison. Answers why it cannot, such as a file
	 * no longer listed there, or null. Never throws.
	 */
	showReviewNote(worktreeId: string, id: string): Promise<string | null>;
	/** The note was brought into view. */
	reviewNoteShown(): void;
	/**
	 * The review of a worktree as it would be pasted, after the diff of every
	 * noted file was read again so that changed lines are marked outdated.
	 * Null when the worktree has no notes. Never throws.
	 */
	prepareReview(worktreeId: string): Promise<string | null>;
	/**
	 * Paste `message`, as the preview showed it, into an agent session of the
	 * worktree as one bracketed paste. Once it was pasted, the worktree's
	 * notes are gone, the dialog closes, a toast says so, and the session
	 * shows. Never throws.
	 */
	sendReview(worktreeId: string, sessionId: string, message: string): Promise<PasteResult>;
	/**
	 * Start the default agent (the one the repository names, or the first
	 * saved agent found, looked for again now) as a new session of the worktree, to paste `message`, as the preview showed it, once the agent
	 * is ready, with no Enter (`OpenTerminalRequest.review`). Once started,
	 * the dialog closes, the session shows, saying it waits, and a toast says
	 * so. Once pasted, the notes that were sent are gone, unless changed
	 * meanwhile, and a toast says to press Enter there; when it is not
	 * pasted, the notes stay and a toast says why. Nothing starts while
	 * another session starts in the worktree, while another agent there waits
	 * to paste a review, in a folder being deleted, or with no default agent. Answers why nothing
	 * started, or null. Never throws.
	 */
	startReviewAgent(worktreeId: string, message: string, size: { cols: number; rows: number }): Promise<string | null>;
	/** Put `message` on the clipboard and close the dialog. The notes stay. Answers whether it was copied. */
	copyReview(message: string): Promise<boolean>;
	/**
	 * Create a worktree with `timber new`. Whatever comes of it, the
	 * repository is read again before this answers, and the worktree Timber
	 * reported is selected when the list has it. The command runs once and is
	 * never retried here. A request that did not get through is a failed result.
	 */
	newWorktree(request: NewWorktreeRequest): Promise<WorktreeCommandResult>;
	/** Open a branch or a worktree with `timber open`. Reads the repository again and selects as `newWorktree` does. */
	openWorktree(request: OpenWorktreeRequest): Promise<WorktreeCommandResult>;
	/**
	 * The branches of a repository to offer for picking. Null when they could
	 * not be read, which only means there is nothing to pick from.
	 */
	listBranches(repository: string): Promise<BranchSuggestion[] | null>;
	/**
	 * The named workflows Timber offers for a repository, to pick from when
	 * creating a worktree. Never throws: an engine that could not answer is a
	 * failure with the reason.
	 */
	listWorkflows(repository: string): Promise<WorkflowList>;
	/** The issue trackers a repository has set up, for the New worktree dialog. Never throws: a failed request is a failure with a message. */
	readIssueTrackers(repository: string): Promise<IssueTrackers>;
	/** Issues matching typed text, for suggestions in the New worktree dialog. Never throws: a failed request is a failure with a message. */
	searchIssues(request: IssueSearchRequest): Promise<IssueSearchResult>;
	/**
	 * Timber's settings for one scope, for the Settings dialog, read by
	 * Timber. Read-only. Never throws: an engine that could not answer is a
	 * failed read with the reason.
	 */
	readTimberSettings(request: TimberSettingsRequest): Promise<TimberSettingsReadResult>;
	/**
	 * Save one scope's settings through Timber. Runs once and is never retried.
	 * Once saved, the repository, or with machine defaults every repository,
	 * is read again before this answers, so a setup prompt goes at once.
	 * Never throws: an engine that could not answer is a failure that says
	 * what came of the save is unknown.
	 */
	saveTimberSettings(request: TimberSettingsSaveRequest): Promise<TimberSettingsSaveResult>;
	/** Check a login through Timber, saving nothing. Never throws, as above. */
	checkTimberConnection(request: TimberConnectionCheckRequest): Promise<TimberConnectionCheckResult>;
	/**
	 * Open a dialog over the window, in place of the one that is open. Pull,
	 * where the Pull setting skips its dialog, runs at once instead (see
	 * `syncOptionsOf` in ./state.ts): a toast says how it ended, and a refusal
	 * or a failure opens the dialog on what Git said. Nothing happens while
	 * such a pull already runs in the worktree.
	 */
	openDialog(request: DialogRequest): void;
	closeDialog(): void;
	/**
	 * Open the command palette. It never takes the place of another dialog,
	 * and it is not offered until Timber is ready, as no dialog is.
	 */
	openPalette(): void;
	/** Close the command palette. Any other dialog stays open. */
	closePalette(): void;
	/** Open the command palette, or close it when it is open. Nothing happens while another dialog or the quit question is open. */
	togglePalette(): void;
	/**
	 * Open the chop search, or close it when it is open. It opens only while
	 * chops are in use (`chopsEnabled`) and no other dialog or the quit
	 * question is open.
	 */
	toggleRunChop(): void;
	/**
	 * Ask Timber what removing a worktree would do. Read-only. Never throws: an
	 * engine that could not answer is a failed preview with the reason.
	 */
	previewDone(request: DonePreviewRequest): Promise<DonePreviewResult>;
	/**
	 * Remove a worktree, approving one preview. The engine is asked exactly
	 * once and nothing is tried again. Whatever came of it, including an
	 * engine that could not answer, the repository is read again before this
	 * answers, because the folder can be gone while the branch remains. Never
	 * throws.
	 */
	applyDone(request: DoneApplyRequest): Promise<DoneApplyResult>;
	/**
	 * Remove a worktree in the background, approving one preview: `applyDone`,
	 * kept in `removals` while it runs so the worktree's row says so and its
	 * actions are off. Null, with nothing run, while a removal of that
	 * worktree runs already. Removals of other worktrees run at the same time.
	 *
	 * Once it starts, the Done dialog of that worktree closes, so the rest of
	 * the window is free while Timber works. When it worked, the record goes
	 * and a toast says so with `toast`. When it failed, the record stays as a
	 * failure until it is dismissed, and unless the Done dialog of that
	 * worktree is open again a toast points at it. With `announce` false no
	 * toast is shown either way, for a caller that says how a batch ended.
	 * A removal that Clean up merged queued (`waiting`) may start. Never
	 * throws.
	 */
	removeWorktree(request: { repository: string; worktree: Worktree; preview: string; toast: string; announce?: boolean }): Promise<DoneApplyResult | null>;
	/**
	 * Clean up merged: remove these worktrees of one repository one at a
	 * time, each approving its own preview, so scripts that run before
	 * deletion never compete. A second run in the same repository starts once
	 * the first ended. All of them are queued (`waiting`) at once, so
	 * their actions are off until their turn. Before each turn the worktree
	 * is looked up in the list as it is then: one that left it is passed
	 * over, and one with a running session fails without running anything.
	 * A failure stays as that worktree's record, as for Done, and never
	 * stops the others. One toast says how the run ended. Never throws.
	 */
	cleanUpMerged(request: { repository: string; items: readonly { worktree: Worktree; preview: string; shown: DonePreview }[] }): Promise<void>;
	/** Put away a failed removal, once the person has seen it. A running one stays. */
	dismissRemoval(repository: string, path: string): void;
	/**
	 * Start another session in a worktree, the shell or the agent that
	 * `request.agent` names, and choose its chip. Every agent starts through
	 * here: `newWorktree` and `openWorktree` never start one. The session shows in
	 * `terminals`; why none started shows in `terminalProblem`, with the
	 * command that failed. One request at a time per worktree, so a double
	 * click starts one. Never throws.
	 */
	openTerminal(request: OpenTerminalRequest): Promise<void>;
	/**
	 * Rebase a worktree with `timber rebase --result-file` and answer how it
	 * ended (see `RebaseResult`). The engine is asked once, and never again by
	 * itself. The repository is read again before this answers, whatever the
	 * outcome, even when the engine did not answer, because a rebase that
	 * stopped or failed can have changed the branch. Never throws: an engine
	 * that does not answer is a failure that says what it did is unknown. A
	 * rebase that stopped on conflicts is left as Git left it.
	 */
	rebaseWorktree(request: RebaseRequest): Promise<RebaseResult>;
	/**
	 * Run a sync action, Pull or Push, and answer how it ended (see
	 * `SyncActionResult`). The engine is asked once. The repository is read
	 * again after every outcome, so the row's counts follow at once.
	 */
	runSyncAction(request: SyncActionRequest): Promise<SyncActionResult>;
	/**
	 * Save a worktree's base with `timber base --set --result-file` and answer
	 * how it ended (see `SetBaseResult`). The engine is asked once, and never
	 * again by itself. Once a base is saved, the worktree compares with its
	 * base in the Changes view, as the person's choice; so does one whose
	 * answer was lost but whose list read again shows a new base. The
	 * repository is read again before this answers, whatever the outcome, so
	 * the header, the row, and the Changes view show what Timber saved. Never
	 * throws.
	 */
	setWorktreeBase(request: SetBaseRequest): Promise<SetBaseResult>;
	/**
	 * Start the Pull request tab's form for a worktree with no pull request
	 * yet, once: the base starts as the saved one in the form Timber takes,
	 * and the title as the branch until the last commit's subject is read,
	 * unless the person typed one first. A form already started is kept.
	 */
	startPullRequestForm(repository: string, worktree: Worktree): void;
	/** Change what is typed in a worktree's form, by worktree id. Ignored while it runs. Clears the last failure. */
	editPullRequestForm(worktreeId: string, change: Partial<PullRequestFields>): void;
	/**
	 * Run `timber pr` for a worktree's form, once. While it runs, a second
	 * call does nothing. The repository and its pull requests are read again
	 * after every outcome that ran, since even a failure can come after the
	 * push, so the tab shows a created pull request as soon as the host lists
	 * it. Created: a toast. Already open: a note above it. Reviewers Timber
	 * could not request stay in the form under either, until put away or the
	 * next run. Refused or failed: the failure stays in the form for a retry.
	 * Never throws. Answers what the ending shows, or null when nothing ran.
	 * Without `announce` the caller shows the toast. With
	 * `text`, that title and description run in place of the form's, which
	 * stay as typed, and the caller shows a failure.
	 */
	createPullRequest(worktreeId: string, options?: { announce?: boolean; text?: { title: string; body: string } }): Promise<PullRequestCreationView | null>;
	/** Put away the reviewers a worktree's last run could not request. */
	dismissReviewerFailures(worktreeId: string): void;
	/**
	 * Restore a backup into a new worktree, once. The repository is read again
	 * after every outcome, and a recovery worktree that is complete is
	 * selected. One left behind by a partial restore is never selected.
	 */
	restoreBackup(request: BackupRestoreRequest): Promise<BackupRestoreResult>;
	/** Delete one backup, once. Its repository's backups are read again after every outcome. */
	deleteBackup(request: BackupDeleteRequest): Promise<BackupDeleteResult>;
	/** A repository's saved arena presets, by name and tool. Never throws. */
	listArenaPresets(repository: string): Promise<ArenaPresetList>;
	/** Compare an arena's attempts with Timber. Read-only. Never throws. */
	inspectArena(request: { repository: string; arena: string }): Promise<ArenaInspection>;
	/**
	 * Create an arena, once. The repository and its arenas are read again
	 * after every outcome. When every attempt is ready, each attempt that has
	 * an agent gets its own session, started as Timber says (see
	 * `startAttemptAgent`), and the first attempt is selected. After a
	 * failure nothing starts. Never throws.
	 */
	newArena(request: NewArenaRequest): Promise<NewArenaResult>;
	/** Keep one attempt of an arena, once. The repository and its arenas are read again after every outcome. Never throws. */
	pickArena(request: PickArenaRequest): Promise<PickArenaResult>;
	/**
	 * Start an arena attempt's agent in its own session, with the command
	 * Timber gives for it, and show it, as `openTerminalIn` does. The
	 * worktree must be listed. Never throws.
	 */
	startAttemptAgent(request: { repository: string; worktree: string; arena: string; attempt: string }): void;
	/**
	 * Start a plain shell session in a worktree and show it: select the
	 * worktree and show the Workspace tab, as `startSessionsIn` does.
	 * Used to resolve a rebase that stopped on conflicts. Not in the list:
	 * nothing starts. Never throws.
	 */
	openTerminalIn(repository: string, worktreePath: string): void;
	/**
	 * Start the sessions the New worktree dialog asks for in a worktree it
	 * opened, as `openTerminal` does: select the worktree and show the
	 * Workspace tab, where each session or why it did not start shows. With
	 * `setup`, the worktree's setup scripts run first in a session of their
	 * own (`timberWorktreeSetup`), with `workflow` when the worktree was made
	 * with one. With `agent`, that agent starts beside it at once, without
	 * waiting for setup, and its pane shows: one from the saved Settings by
	 * name, or a workflow's agent (`workflowAgent`), which the main process
	 * reads again from Timber. The worktree is looked up as `newWorktree` selects it.
	 * Answers at once, without waiting for the sessions: false when the list
	 * does not have the worktree, and then nothing starts. Never throws.
	 */
	startSessionsIn(repository: string, worktree: ReportedWorktree, sessions: { setup: boolean; workflow?: string; agent: SessionAgent | null }): boolean;
	/**
	 * Choose the chip of a session in its worktree, so its pane shows. The
	 * other sessions keep running. Nothing happens for a session that is gone.
	 */
	showSession(id: string): void;
	/**
	 * Bring a session to the person, as a click on its desktop notification
	 * does: select its worktree, show the Workspace tab and its chip, and ask
	 * its terminal to take the keyboard (see ../terminal-focus.ts). Nothing happens for
	 * a session that is gone.
	 */
	revealSession(id: string): void;
	/**
	 * Bring the next session that needs the person, or else that finished, as
	 * the title bar item and its shortcut do: every Needs you session, the one
	 * that has waited longest first, then every finished one not seen yet,
	 * the one that finished first first, in any repository (see
	 * ../waiting.ts). It goes to the one after the session on screen when that
	 * one is in the list, or else to the first. Shown as `revealSession` does.
	 * Nothing happens, and the answer is false, when there is none, while a
	 * dialog or the quit question is open, or while Timber is not ready.
	 */
	jumpToWaiting(): boolean;
	/**
	 * Show the session `step` chips away from this one in its worktree,
	 * wrapping around, for the keys that switch sessions from a terminal.
	 */
	stepSession(id: string, step: 1 | -1): void;
	/**
	 * Give a session another name. Answers whether the engine took it: a name
	 * with nothing in it, a session that is gone, or an engine that did not
	 * answer leaves the name as it was. Never throws.
	 */
	renameTerminal(id: string, name: string): Promise<boolean>;
	/** End a session and take it away, running or exited. The others are left alone. Never throws. */
	closeTerminal(id: string): Promise<void>;
	/**
	 * Draw what a session printed: first what the engine kept, then every new
	 * part, each once and in order. `draw` calls `done` once it has drawn, so
	 * the engine sends no more than the pane keeps up with. Returns a
	 * function that stops drawing.
	 */
	watchTerminal(id: string, draw: (draw: Draw, done: () => void) => void): () => void;
	/** Pass typed or pasted text on to a session. */
	writeTerminal(id: string, data: string): void;
	resizeTerminal(id: string, cols: number, rows: number): void;
	/** Put text from a terminal on the clipboard. Never throws. */
	copyText(text: string): Promise<void>;
	/** The clipboard's text, for pasting into a terminal. Null when there is none or it cannot be read. */
	pasteText(): Promise<string | null>;
	/** Open a web link from a terminal in the person's browser. Never throws. */
	openLink(url: string): Promise<void>;
	dismissTerminalProblem(): void;
	/**
	 * Put away the setup prompt of a repository, named by the path of its
	 * primary checkout, and remember that for the next run. The repository
	 * works as before; Settings > Repository, or `timber setup` in a terminal, still sets it up.
	 */
	dismissSetup(repository: string): void;
	/** Write a theme to a file in a folder the person picks. A failure to ask is a failed answer. */
	exportTheme(theme: Theme): Promise<ExportThemeResult>;
	/** Read a theme from a file the person picks. Saves nothing. A failure to ask is a refusal with the reason. */
	importTheme(): Promise<ImportThemeResult>;
	/** Ask for a sound file of the person's own. Saves nothing. A failure to ask is a refusal with the reason. */
	chooseSoundFile(): Promise<ChooseSoundResult>;
	/** Play a sound as a preview. A failure to ask counts as failed. */
	playSound(choice: SoundChoice): Promise<SoundOutcome>;
	/** Whether this copy of the app can uninstall itself, and what that would do. A failed read says why in `reason`. */
	uninstallPlan(): Promise<UninstallPlan>;
	/** Remove the app from this computer. The app quits right after a good answer, unless the answer has something to tell. */
	uninstall(request: UninstallRequest): Promise<UninstallResult>;
	/** Whether this copy of the app can restart itself. A failed read says why in `reason`. Never throws. */
	restartPlan(): Promise<RestartPlan>;
	/**
	 * Quit, ending every terminal, and start the app again. The window asks
	 * first while terminals run. No answer may come back when it works, as
	 * the app is gone; a lost answer that the window lives to see is a
	 * failure. Never throws.
	 */
	restart(): Promise<RestartResult>;
	/** Look for a newer release of the app now. What it finds arrives in `appUpdate`. Never throws. */
	checkForAppUpdate(): Promise<void>;
	/**
	 * Restart into the downloaded update. While sessions run it does nothing
	 * and says so, unless `endSessions` says the person agreed. No answer may
	 * come back when it works, as the app is gone. Never throws.
	 */
	installAppUpdate(request: AppUpdateInstallRequest): Promise<AppUpdateInstallResult>;
	/**
	 * Restart to update was pressed: while sessions run, ask first (in
	 * `appUpdateStep`); otherwise restart into the update. With `endSessions`
	 * the person agreed that the sessions end.
	 */
	restartForUpdate(endSessions: boolean): Promise<void>;
	/** The person did not agree to end the sessions: back to Restart to update. */
	cancelUpdateRestart(): void;
	/** The person said Later to the downloaded update: the banner goes away until another version is ready. */
	appUpdateLater(): void;
	/** The person agreed to quit while terminals run. */
	confirmQuit(): Promise<void>;
	/** The person chose to keep the app open. */
	cancelQuit(): void;
}

/** How the window is, as the page sees it. */
export interface WindowState {
	visible: boolean;
	focused: boolean;
}

/** Run `task` after `milliseconds`. Returns a function that calls it off. */
export type Schedule = (task: () => void, milliseconds: number) => () => void;

const scheduleWithTimer: Schedule = (task, milliseconds) => {
	const timer = setTimeout(task, milliseconds);
	return () => clearTimeout(timer);
};

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** Words for an engine that did not answer: "The app did not hear <what>: <the error><then>". */
function notHeard(what: string, error: unknown, then = ""): string {
	return `The app did not hear ${what}: ${messageOf(error)}${then}`;
}

/** A failure for an engine that did not answer, so there is no command and no output to show. */
function notHeardFailure(what: string, error: unknown, then = ""): TimberFailure {
	return { command: null, diagnostic: notHeard(what, error, then), output: null };
}

/** `schedule` is how the store waits before it takes a toast away. Tests pass their own clock. */
/**
 * Changes to a repository come often while an agent works, and each read of
 * its backups runs Timber over every backup. Reads asked for by such changes
 * are at least this far apart for one repository, and the last one asked for
 * meanwhile still happens.
 */
export const BACKUP_READ_SPACING_MS = 15_000;

/** As `BACKUP_READ_SPACING_MS`, for arenas: listing them asks Git about every attempt. */
export const ARENA_READ_SPACING_MS = 15_000;

/** The part of a request that names a new worktree's agent: a saved one, or a workflow's, with the pick it falls back to. */
function agentRequest(agent: SessionAgent): Pick<OpenTerminalRequest, "agent" | "workflowAgent"> {
	if (agent.kind === "saved") return { agent: agent.name };
	return { workflowAgent: { workflow: agent.workflow, ...(agent.agent === undefined ? {} : { agent: agent.agent }) } };
}

export function createAppStore(engine: Engine, schedule: Schedule = scheduleWithTimer): AppStore {
	let state = initialState;
	const listeners = new Set<() => void>();
	let lastToast = 0;
	const toastTimers = new Map<number, () => void>();

	// What the engine was last told through `attend`, and whether to tell it: only between `start` and its stop.
	let windowState: WindowState = { visible: true, focused: true };
	let attended: Attention | null = null;
	/** How many update states were heard, so an answer that crossed a newer one on its way is dropped. */
	let appUpdateChanges = 0;
	let attending = false;
	// What the seen statuses were last kept from, so most updates skip that work.
	let seenFrom: { terminals: readonly TerminalSession[]; onScreen: string | null } = { terminals: initialState.terminals, onScreen: null };

	function attend(): void {
		if (!attending) return;
		const found = selectedWorktree(state);
		const selected = found && timberReady(state) ? found : null;
		const next: Attention = {
			...windowState,
			selected: selected ? { repository: selected.repository.path, worktree: selected.worktree.path, id: selected.worktree.id } : null,
			// The main process keeps the shown chip of each worktree from these, for the save at quit. Only once a chip was
			// chosen there: until then the first one shows by default, and the saved choice still opening must not lose to it.
			session: selected && Object.hasOwn(state.shownSessions, selected.worktree.id) ? shownSession(state, selected.worktree.id)?.id ?? null : null,
		};
		if (attended && sameAttention(attended, next)) return;
		attended = next;
		try {
			engine.attend(next);
		} catch {
			// The bridge may not be up yet. The next change tells the engine again.
			attended = null;
		}
	}

	/*
	 * A branch marked force-pushed stays marked until the person has seen it:
	 * it showed in the selected worktree while the window showed and had the
	 * focus, and then the selection moved on. A mark that arrives on the
	 * selected worktree stays until the selection moves on. The engine is told
	 * the mark's `at`, so a newer rewrite stays marked.
	 */
	let shownForcePush: (ForcePushSeen & { worktree: string }) | null = null;

	function noteForcePush(): void {
		if (!attending) return;
		const selected = selectedWorktree(state);
		if (shownForcePush && selected?.worktree.id !== shownForcePush.worktree) {
			const { worktree: _left, ...seen } = shownForcePush;
			shownForcePush = null;
			try {
				engine.forcePushSeen(seen);
			} catch {
				// The mark stays, and is seen again next time.
			}
		}
		const sync = selected?.worktree.sync;
		const branch = selected?.worktree.branch;
		if (!selected || !branch || sync?.kind !== "tracking" || !sync.forcePushed || !windowState.visible || !windowState.focused) return;
		if (shownForcePush?.worktree === selected.worktree.id && shownForcePush.at === sync.forcePushed.at) return;
		shownForcePush = { repository: selected.repository.path, worktree: selected.worktree.id, branch, at: sync.forcePushed.at };
	}

	/*
	 * Linked issues come from trackers through Timber, one worktree per run,
	 * so they are read as often as pull requests: when a worktree is first
	 * listed with a link or its link changes, and for every linked worktree
	 * of a repository each time a fetch of it ends. `dueIssues` holds the
	 * worktree ids waiting for a read. The reads of one repository run one
	 * after another, so a fetch never starts one tracker request per worktree
	 * at once. Nothing is read while Timber is not ready.
	 */
	const dueIssues = new Set<string>();
	const readingIssues = new Set<string>();
	const linkedWorktrees = (repository: string) =>
		state.repositories.find(candidate => candidate.path === repository && candidate.available)?.worktrees.filter(worktree => worktree.issue?.kind === "linked") ?? [];

	const refreshIssues = mergeOverlapping<string>(async repository => {
		for (;;) {
			if (!timberReady(state)) return;
			const next = linkedWorktrees(repository).find(worktree => dueIssues.has(worktree.id));
			if (!next || next.issue?.kind !== "linked") return;
			dueIssues.delete(next.id);
			const { tracker, key } = next.issue;
			let lookup: IssueLookup;
			readingIssues.add(next.id);
			try {
				lookup = await engine.readIssue({ repository, worktree: next.path });
			} catch (error) {
				lookup = { ok: false, message: notHeard("the answer", error) };
			} finally {
				readingIssues.delete(next.id);
			}
			// A worktree that left the list, or whose link changed meanwhile, keeps nothing from this read.
			const now = linkedWorktrees(repository).find(worktree => worktree.id === next.id);
			if (now?.issue?.kind !== "linked" || now.issue.tracker !== tracker || now.issue.key !== key) {
				// The catch-up skipped it while this read ran, so a new link is read next.
				if (now) dueIssues.add(now.id);
				continue;
			}
			if (lookup.ok && lookup.outcome === "found" && (lookup.issue.tracker !== tracker || lookup.issue.key !== key)) {
				lookup = { ok: false, message: `timber __app-issue answered about ${lookup.issue.tracker} ${lookup.issue.key}, not the saved ${tracker} ${key}.` };
			}
			update({ issues: { ...state.issues, [next.id]: { tracker, key, lookup } } });
		}
	});

	/** Forget issues of worktrees no longer listed or linked the same way, and read those never read. */
	function catchUpIssues(): void {
		const linked = new Map(state.repositories.flatMap(repository => repository.available ? repository.worktrees : []).flatMap(worktree => worktree.issue?.kind === "linked" ? [[worktree.id, worktree.issue] as const] : []));
		const kept = keepEntries(state.issues, (id, entry) => {
			const link = linked.get(id);
			return link !== undefined && link.tracker === entry.tracker && link.key === entry.key;
		});
		if (kept !== state.issues) state = { ...state, issues: kept };
		for (const id of dueIssues) if (!linked.has(id)) dueIssues.delete(id);
		if (!timberReady(state)) return;
		for (const repository of state.repositories) {
			if (!repository.available) continue;
			let due = false;
			for (const worktree of repository.worktrees) {
				if (worktree.issue?.kind !== "linked") continue;
				if (!(worktree.id in state.issues) && !readingIssues.has(worktree.id)) dueIssues.add(worktree.id);
				if (dueIssues.has(worktree.id)) due = true;
			}
			if (due) void refreshIssues(repository.path);
		}
	}

	/** Read every linked issue of a repository again. */
	function issuesDue(repository: string): void {
		for (const worktree of linkedWorktrees(repository)) dueIssues.add(worktree.id);
		void refreshIssues(repository);
	}

	/** How many files with unsaved edits the main process was last told of. */
	let reportedUnsaved = 0;
	// The editor's undo history, caret, and scroll per worktree (see `fileEditMemory`).
	const editMemories = new Map<string, FileEditMemory>();

	function update(change: Partial<AppState>): void {
		const shownBefore = sessionOnScreen(state)?.id ?? null;
		const terminalsBefore = state.terminals;
		state = { ...state, ...change };
		// The File and diff tabs never show empty, and open files and diffs leave with their worktree.
		if (change.tab !== undefined || change.selection !== undefined || change.files !== undefined || change.diffs !== undefined || change.repositories !== undefined) {
			const settled = settleTabs(state);
			if (settled) state = { ...state, ...settled };
			// The editor's memory goes with its file: closed, replaced, or gone with its worktree.
			for (const [id, memory] of editMemories) if (state.files[id]?.path !== memory.path) forgetEditMemory(id);
			// The main process asks before quitting while any file holds unsaved edits.
			const unsaved = unsavedFileCount(state.files);
			if (unsaved !== reportedUnsaved) {
				reportedUnsaved = unsaved;
				try {
					engine.reportUnsavedFiles(unsaved);
				} catch {
					// Told again with the next change.
					reportedUnsaved = -1;
				}
			}
		}
		// Viewed marks and filters leave with their worktree.
		if (change.repositories && (Object.keys(state.viewed).length > 0 || Object.keys(state.changeFilters).length > 0)) {
			const listed = new Set(state.repositories.flatMap(repository => repository.worktrees.map(worktree => worktree.id)));
			const viewed = listedOnly(state.viewed, listed);
			const changeFilters = listedOnly(state.changeFilters, listed);
			if (viewed || changeFilters) state = { ...state, ...(viewed ? { viewed } : {}), ...(changeFilters ? { changeFilters } : {}) };
		}
		// A change to the list, or to Timber, may bring links to read or take some away.
		if (change.repositories || change.timber) catchUpIssues();
		// A failed removal that no longer matches the list goes with the list change that ended it.
		if (change.repositories && state.removals.length > 0) {
			const removals = reconcileRemovals(state.repositories, state.removals);
			if (removals !== state.removals) state = { ...state, removals };
		}
		// A session that moved into Needs you joins the end of the waiting order, and one that left it leaves.
		if (change.terminals) {
			const waitingOrder = withWaitingOrder(state.waitingOrder, state.terminals);
			if (waitingOrder !== state.waitingOrder) state = { ...state, waitingOrder };
		}
		// A finished session joins the end of its order, and leaves once it was seen: on screen, then not.
		const onScreen = sessionOnScreen(state);
		const finishedOrder = withFinishedOrder(state.finishedOrder, {
			before: terminalsBefore, now: state.terminals, shownBefore, shownNow: onScreen?.id ?? null,
		});
		if (finishedOrder !== state.finishedOrder) state = { ...state, finishedOrder };
		// A Done, Error, or crash on screen in a focused window is seen, and stays seen until the agent's state changes.
		const seenNow = windowState.visible && windowState.focused ? onScreen?.id ?? null : null;
		if (state.terminals !== seenFrom.terminals || seenNow !== seenFrom.onScreen) {
			seenFrom = { terminals: state.terminals, onScreen: seenNow };
			const seenStatuses = withSeenStatuses(state.seenStatuses, state.terminals, seenNow);
			if (seenStatuses !== state.seenStatuses) state = { ...state, seenStatuses };
		}
		// A session on screen is seen, whatever put it there: a chip, the selection, the tab, or a session that started or ended.
		if (onScreen && state.unseenSessions.includes(onScreen.id)) {
			state = { ...state, unseenSessions: state.unseenSessions.filter(id => id !== onScreen.id) };
		}
		for (const listener of [...listeners]) listener();
		attend();
		noteForcePush();
		followFileTree();
	}

	/*
	 * The file explorer (see docs/architecture.md, "File explorer"). Each
	 * read of a folder counts, so only the latest answer for it lands. What
	 * the engine was last asked to watch is kept, so it is told only of a
	 * change, and the worktree it watched, so folders shown again after the
	 * panel was hidden or another worktree selected are read again.
	 */
	const folderReads = new Map<string, number>();
	let watchedFolders: string | null = null;
	let watchedTree: string | null = null;
	let followingTree = false;

	function toggleSidePanel(view: SidePanelView): boolean {
		if (!canToggleSidePanel(state, view)) return false;
		const hide = sidePanelShown(state) && sidePanelView(state) === view;
		changeLayout({ ...state.layout, chopsOpen: !hide, sidePanel: view });
		void saveLayout("layout");
		return true;
	}

	function changeTree(worktreeId: string, tree: WorktreeTree): void {
		update({ fileTree: { ...state.fileTree, trees: { ...state.fileTree.trees, [worktreeId]: tree } } });
	}

	async function readFolder(worktreeId: string, folder: string): Promise<void> {
		const tree = state.fileTree.trees[worktreeId];
		if (!tree) return;
		const key = `${worktreeId}\0${folder}`;
		const read = (folderReads.get(key) ?? 0) + 1;
		folderReads.set(key, read);
		changeTree(worktreeId, { ...tree, listings: { ...tree.listings, [folder]: readingListing(tree.listings[folder]) } });
		let answer: WorktreeFolderResult;
		try {
			answer = await engine.listWorktreeFolder({ repository: tree.repository, worktree: tree.worktree, folder, ignored: state.fileTree.showIgnored });
		} catch (error) {
			answer = { outcome: "failed", message: unheard(`the files in ${folder === "" ? tree.worktree : folder}`, error) };
		}
		const now = state.fileTree.trees[worktreeId];
		// A newer read of it, another worktree at that identity, or the folder closed meanwhile: this answer is old.
		if (folderReads.get(key) !== read || !now || now.worktree !== tree.worktree || !(folder in now.listings)) return;
		const before = now.listings[folder];
		// A folder that went away closes. The worktree's own folder says why instead.
		if (answer.outcome === "missing" && folder !== "") return changeTree(worktreeId, withFolder(now, folder, false));
		const listing: FolderListing = answer.outcome === "listed"
			? { entries: answer.entries, more: answer.more, reading: false, failure: null }
			: { entries: before?.entries ?? null, more: before?.more ?? 0, reading: false, failure: answer.message };
		changeTree(worktreeId, { ...now, listings: { ...now.listings, [folder]: listing } });
	}

	/** Read the folders that show for a worktree again. */
	function readShownFolders(worktreeId: string): void {
		const tree = state.fileTree.trees[worktreeId];
		if (tree) for (const folder of shownFolders(tree)) void readFolder(worktreeId, folder);
	}

	/**
	 * After every change: while the file explorer shows a worktree, keep its
	 * tree, read its own folder the first time, read what shows again when it
	 * comes back into view, and keep the engine watching the folders that
	 * show. Otherwise nothing is watched. Trees of worktrees that left the
	 * list are forgotten.
	 */
	function followFileTree(): void {
		if (!attending || followingTree) return;
		followingTree = true;
		try {
			const known = new Set(state.repositories.flatMap(repository => repository.worktrees.map(worktree => worktree.id)));
			const gone = Object.keys(state.fileTree.trees).filter(id => !known.has(id));
			if (gone.length > 0) update({ fileTree: { ...state.fileTree, trees: Object.fromEntries(Object.entries(state.fileTree.trees).filter(([id]) => known.has(id))) } });
			const found = filesPanelShown(state) ? selectedWorktree(state) : null;
			const target = found && found.worktree.pathExists ? found : null;
			let watch: WorktreeFolderWatch | null = null;
			if (target) {
				const id = target.worktree.id;
				const tree = state.fileTree.trees[id];
				if (!tree || tree.worktree !== target.worktree.path || tree.repository !== target.repository.path) {
					changeTree(id, { repository: target.repository.path, worktree: target.worktree.path, expanded: [], listings: {} });
					void readFolder(id, "");
				} else if (watchedTree !== id) {
					readShownFolders(id);
				}
				watchedTree = id;
				watch = { repository: target.repository.path, worktree: target.worktree.path, folders: shownFolders(state.fileTree.trees[id]!) };
			} else {
				watchedTree = null;
			}
			const key = watch === null ? null : JSON.stringify(watch);
			if (key === watchedFolders) return;
			try {
				engine.watchWorktreeFolders(watch);
				watchedFolders = key;
			} catch {
				// The bridge may not be up yet. The next change tells the engine again.
				watchedFolders = null;
			}
		} finally {
			followingTree = false;
		}
	}

	function dismissToast(id: number): void {
		toastTimers.get(id)?.();
		toastTimers.delete(id);
		if (state.toasts.some(toast => toast.id === id)) update({ toasts: state.toasts.filter(toast => toast.id !== id) });
	}

	function showToast(text: string, problem = false): void {
		const id = ++lastToast;
		update({ toasts: [...state.toasts, problem ? { id, text, problem } : { id, text }] });
		toastTimers.set(id, schedule(() => dismissToast(id), TOAST_MILLISECONDS));
	}

	async function track(operation: Operation, task: () => Promise<void>): Promise<void> {
		update({ operations: [...state.operations, operation] });
		try {
			await task();
		} finally {
			update({ operations: state.operations.filter(candidate => candidate !== operation) });
		}
	}

	/*
	 * Every reload takes the next ticket when it asks the engine, so a higher
	 * ticket means data read later. `listTicket` is the ticket of the full list
	 * on screen, and `repositoryTickets` holds the ticket of each repository
	 * that a single reload put on screen. A response is dropped when what is on
	 * screen for that repository carries a higher ticket than the response does.
	 */
	let lastTicket = 0;
	let listTicket = 0;
	// The order the person moved the repositories into, until the engine has saved it, so a list read meanwhile keeps it.
	let pendingOrder: string[] | null = null;
	let orderTicket = 0;
	// Saves run one after another, so the last move is the one saved last.
	let orderSaves: Promise<void> = Promise.resolve();
	const repositoryTickets = new Map<string, number>();
	// The groups as the engine last saved them, so a save that fails can put them back.
	let savedGroups: RepositoryGroups = emptyGroups();
	// Group changes asked for that have not answered yet. A list read meanwhile keeps the groups on screen.
	let groupChanges = 0;
	// Icon changes asked for that have not answered yet, and how many have answered. A read of the icons asked for
	// before one answered may be older than it, so it is not shown.
	let iconChanges = 0;
	let iconAnswers = 0;
	// How many saves of the repositories' default agents have answered, so an older read of them is dropped too.
	let pickAnswers = 0;

	/** The saved groups, read beside the list. They come from the settings, so this is no second read of a repository. */
	const readGroups = () => engine.listRepositoryGroups().catch(() => null);

	const reloadAll = mergeOverlapping<"all">(() => track({ kind: "reload-all" }, async () => {
		const ticket = ++lastTicket;
		try {
			const answersBefore = iconAnswers;
			const picksBefore = pickAnswers;
			const [listed, groups, icons, picks] = await Promise.all([
				engine.listRepositories(), readGroups(), engine.listSidebarIcons().catch(() => null),
				// Unread, what was known stays. Never read, no default agent is known, and none starts.
				engine.listRepositoryAgents().catch(() => null),
			]);
			if (groups && groupChanges === 0) {
				savedGroups = groups;
				update({ repositoryGroups: groups });
			}
			// They come from the settings too, unless an icon was set while they were read: the store has that one already.
			if (icons && iconChanges === 0 && iconAnswers === answersBefore) update({ sidebarIcons: icons });
			// A repository that was reloaded on its own after this list was asked for keeps that newer data.
			const read = listed.map(repository => {
				const current = state.repositories.find(candidate => candidate.path === repository.path);
				const newer = (repositoryTickets.get(repository.path) ?? 0) > ticket;
				return (newer && current) || keepLastGood(current, repository);
			});
			const repositories = pendingOrder ? applyOrder(read, pendingOrder) : read;
			listTicket = ticket;
			update({
				repositories,
				// With the repositories, so one is never shown without its default agent.
				...(picks && picksBefore === pickAnswers ? { repositoryAgents: picks } : {}),
				loaded: true,
				selection: reconcileSelection(repositories, state.selection),
				board: state.board !== null && repositories.some(repository => repository.path === state.board) ? state.board : null,
				error: null,
			});
			endOrphanTerminals();
			forgetGoneForms();
			forgetGoneReviews();
			catchUpPullRequests();
			catchUpBackups();
			catchUpArenas();
			restoreOnce();
		} catch (error) {
			update({ error: { repository: null, message: messageOf(error) } });
		}
	}));

	/**
	 * Reads of one kind of answer that each listed repository has, such as its
	 * pull requests. A repository is read only while Timber is ready and it is
	 * listed and available, and what it answered is dropped when it left the
	 * list meanwhile. `answers` gives what is on screen, and `forget` keeps
	 * only some of it.
	 */
	function repositoryReads<Answer>(answers: () => Readonly<Record<string, Answer>>, forget: (kept: Readonly<Record<string, Answer>>) => void) {
		const reading = new Set<string>();
		return {
			/** Ask for the repository's answer, a failure when the engine did not answer, and hand it to `keep` unless the repository left the list. */
			async read(path: string, ask: () => Promise<Answer>, failed: (message: string) => Answer, keep: (answer: Answer) => void): Promise<void> {
				if (!timberReady(state) || !state.repositories.some(repository => repository.path === path && repository.available)) return;
				let answer: Answer;
				reading.add(path);
				try {
					answer = await ask();
				} catch (error) {
					answer = failed(notHeard("the answer", error));
				} finally {
					reading.delete(path);
				}
				// A repository that left the list meanwhile keeps nothing.
				if (state.repositories.some(repository => repository.path === path)) keep(answer);
			},
			/** Forget the answers of repositories no longer listed, and read every one that has none yet. */
			catchUp(refresh: (path: string) => Promise<void>): void {
				const listed = new Set(state.repositories.map(repository => repository.path));
				const kept = keepEntries(answers(), path => listed.has(path));
				if (kept !== answers()) forget(kept);
				for (const repository of state.repositories) {
					// One that is being read for the first time is not asked again.
					if (repository.available && !(repository.path in answers()) && !reading.has(repository.path)) void refresh(repository.path);
				}
			},
		};
	}

	/*
	 * Pull requests come from GitHub or Bitbucket through Timber, so they are read as often
	 * as the repository is fetched: once when it is first listed, then each
	 * time a fetch of it ends, in the background or after Fetch now. Reads of
	 * one repository never overlap. Nothing is read while Timber is not ready,
	 * as the Timber notice already says why.
	 */
	const pullRequestReads = repositoryReads<PullRequestList>(() => state.pullRequests, pullRequests => update({ pullRequests }));
	const refreshPullRequests = mergeOverlapping<string>(path => pullRequestReads.read(path, () => engine.readPullRequests(path), message => ({ ok: false, message }), answer => {
		// A form's note about what the last run reported lasts until this newer read, which shows the pull request or, still none, the form again.
		const forms = Object.entries(state.pullRequestForms);
		const settled = forms.map(([id, form]): [string, PullRequestForm] => form.repository === path && form.reported !== null && !form.running ? [id, { ...form, reported: null }] : [id, form]);
		const changed = settled.some(([id, form]) => form !== state.pullRequestForms[id]);
		update({ pullRequests: { ...state.pullRequests, [path]: answer }, ...(changed ? { pullRequestForms: Object.fromEntries(settled) } : {}) });
	}));

	/** Read the pull requests of every repository that has none yet, and forget those of one no longer listed. */
	function catchUpPullRequests(): void {
		pullRequestReads.catchUp(refreshPullRequests);
	}

	/*
	 * Backups are read from Timber, which reads its backup storage and each
	 * backup's manifest. A new one, or a deletion, changes a ref, which the
	 * watcher reports as a change of the repository. So they are read when a
	 * repository is first listed, on Refresh, right after the app restored or
	 * deleted one, and after a change of the repository, spaced out (see
	 * `BACKUP_READ_SPACING_MS`). A Timber that has no backup list is asked
	 * again only on Refresh or when another Timber is found. Reads of one
	 * repository never overlap, and nothing is read while Timber is not ready.
	 */
	const backupReads = repositoryReads<BackupList>(() => state.backups, backups => update({ backups }));
	// Goes up when another Timber is found, so an answer from the one before is dropped.
	let backupGeneration = 0;
	const refreshBackups = mergeOverlapping<string>(path => {
		const generation = backupGeneration;
		return backupReads.read(path, () => engine.readBackups(path), message => ({ state: "failed", message }), answer => {
			// Asked of a Timber that has since been replaced: ask the new one.
			if (generation !== backupGeneration) return void refreshBackups(path);
			update({ backups: { ...state.backups, [path]: answer } });
		});
	});

	/** Repositories whose spacing is running, and whether a read was asked for meanwhile. */
	const backupSpacing = new Map<string, { asked: boolean }>();
	function requestBackups(path: string): void {
		if (state.backups[path]?.state === "unsupported") return;
		const spacing = backupSpacing.get(path);
		if (spacing) {
			spacing.asked = true;
			return;
		}
		const started = { asked: false };
		backupSpacing.set(path, started);
		schedule(() => {
			backupSpacing.delete(path);
			if (started.asked) requestBackups(path);
		}, BACKUP_READ_SPACING_MS);
		void refreshBackups(path);
	}

	/** Read the backups of every repository that has none yet, and forget those of one no longer listed. */
	function catchUpBackups(): void {
		backupReads.catchUp(refreshBackups);
	}

	/*
	 * Arenas are read as backups are: when a repository is first listed, on
	 * Refresh, right after a create or pick, and after a change of the
	 * repository, spaced out (see `ARENA_READ_SPACING_MS`). A Timber with no
	 * arenas for apps is asked again only on Refresh or when another Timber is
	 * found. Reads of one repository never overlap.
	 */
	const arenaReads = repositoryReads<ArenaList>(() => state.arenas, arenas => update({ arenas }));
	let arenaGeneration = 0;
	const refreshArenas = mergeOverlapping<string>(path => {
		const generation = arenaGeneration;
		return arenaReads.read(path, () => engine.listArenas(path), message => ({ state: "failed", message }), answer => {
			if (generation !== arenaGeneration) return void refreshArenas(path);
			update({ arenas: { ...state.arenas, [path]: answer } });
		});
	});
	const arenaSpacing = new Map<string, { asked: boolean }>();
	function requestArenas(path: string): void {
		if (state.arenas[path]?.state === "unsupported") return;
		const spacing = arenaSpacing.get(path);
		if (spacing) {
			spacing.asked = true;
			return;
		}
		const started = { asked: false };
		arenaSpacing.set(path, started);
		schedule(() => {
			arenaSpacing.delete(path);
			if (started.asked) requestArenas(path);
		}, ARENA_READ_SPACING_MS);
		void refreshArenas(path);
	}
	function catchUpArenas(): void {
		arenaReads.catchUp(refreshArenas);
	}

	/** Refresh: every repository's backups, at once, also where Timber had no backup list. */
	async function refresh(): Promise<void> {
		await reloadAll("all");
		for (const repository of state.repositories) {
			// A read in progress may predate the press; a new one follows it.
			if (repository.available) {
				void refreshBackups(repository.path);
				void refreshArenas(repository.path);
			}
		}
	}

	const reloadOne = mergeOverlapping<string>(path => track({ kind: "reload-repository", repository: path }, async () => {
		const ticket = ++lastTicket;
		// A full list asked for after this reload has already answered: it is the newer picture.
		const stale = () => ticket < listTicket;
		try {
			const repository = await engine.loadRepository(path);
			if (stale()) return;
			if (!repository) throw new Error(`Git could not read ${path}`);
			if (!state.repositories.some(current => current.path === path)) return;
			repositoryTickets.set(path, ticket);
			const repositories = state.repositories.map(current => current.path === path ? keepLastGood(current, repository) : current);
			update({
				repositories,
				selection: reconcileSelection(repositories, state.selection),
				board: state.board !== null && repositories.some(repository => repository.path === state.board) ? state.board : null,
				error: state.error?.repository === path ? null : state.error,
			});
			endOrphanTerminals();
			forgetGoneForms();
			forgetGoneReviews();
			requestBackups(path);
			requestArenas(path);
			// The main checkout's file may have changed with its branch: read the chops on screen again.
			if (state.chops?.repository === path) void readChops(path);
		} catch (error) {
			if (stale()) return;
			update({ error: { repository: path, message: messageOf(error) } });
		}
	}));

	/*
	 * The layout as the engine holds it, null until it answered. A change made
	 * before that answer wins over it, because the person made it later.
	 */
	let savedLayout: Layout | null = null;
	let layoutTouched = false;

	async function loadLayout(): Promise<void> {
		try {
			const layout = await engine.loadLayout();
			savedLayout = layout;
			if (!layoutTouched) update({ layout });
		} catch (error) {
			update({ layoutProblem: { action: "read", message: messageOf(error) } });
		}
	}

	function changeLayout(layout: Layout): void {
		layoutTouched = true;
		update({ layout });
	}

	// One save at a time. Saves asked for meanwhile share one follow-up save of whatever is on screen by then.
	const saveLayout = mergeOverlapping<"layout">(async () => {
		if (!layoutTouched) return;
		const layout = state.layout;
		if (savedLayout && sameLayout(savedLayout, layout)) return;
		let failure: string | null = null;
		try {
			const result = await engine.saveLayout(layout);
			if (result.outcome === "failed") failure = result.message;
		} catch (error) {
			failure = messageOf(error);
		}
		if (failure !== null) {
			// One note, however many saves fail: a drag or a held key must not pile them up.
			if (state.layoutProblem?.action !== "save" || state.layoutProblem.message !== failure) {
				update({ layoutProblem: { action: "save", message: failure } });
			}
			return;
		}
		savedLayout = layout;
		if (state.layoutProblem) update({ layoutProblem: null });
	});

	/*
	 * Preferences change on screen only from an engine's answer. A save that
	 * worked carries every preference as saved, which is newer than a first
	 * read that answers after it, so that read is then dropped.
	 */
	let preferencesSaved = false;
	// Saves take a ticket when they ask, so an older answer that arrives last never replaces a newer one.
	let lastPreferenceTicket = 0;
	let shownPreferenceTicket = 0;

	async function loadPreferences(): Promise<void> {
		try {
			const preferences = await engine.loadPreferences();
			update(preferencesSaved ? { preferencesAtStart: preferences } : { preferences, preferencesAtStart: preferences });
		} catch (error) {
			update(preferencesSaved ? { preferencesAtStart: defaultPreferences() } : { preferencesProblem: messageOf(error), preferencesAtStart: defaultPreferences() });
		}
	}

	async function savePreferences(change: Partial<Preferences>, repositoryAgents?: RepositoryAgentChange): Promise<SavePreferencesResult> {
		const ticket = ++lastPreferenceTicket;
		let result: SavePreferencesResult;
		try {
			result = await (repositoryAgents === undefined ? engine.savePreferences(change) : engine.savePreferences(change, repositoryAgents));
		} catch (error) {
			result = { outcome: "failed", message: messageOf(error) };
		}
		if (result.outcome === "saved" && ticket > shownPreferenceTicket) {
			shownPreferenceTicket = ticket;
			preferencesSaved = true;
			const agentsChanged = !sameAgentSettings(state.preferences.agents, result.preferences.agents);
			if (result.repositoryAgents !== undefined) pickAnswers++;
			update({ preferences: result.preferences, preferencesProblem: null, ...(result.repositoryAgents === undefined ? {} : { repositoryAgents: result.repositoryAgents }) });
			if (agentsChanged) {
				void locateAgents();
				void loadStatusHooks();
			}
		}
		return result;
	}

	// Looks take a ticket when they ask, so an older answer that arrives last never replaces a newer one.
	let lastAgentLook = 0;
	let shownAgentLook = 0;

	async function locateAgents(): Promise<boolean> {
		const ticket = ++lastAgentLook;
		try {
			const agentLocations = await engine.locateAgents();
			if (ticket < shownAgentLook) return false;
			shownAgentLook = ticket;
			update({ agentLocations });
			return true;
		} catch {
			// What was known stays. The Agent field says when an agent is not known.
			return false;
		}
	}

	let lastHookLook = 0;
	let shownHookLook = 0;

	async function loadStatusHooks(): Promise<void> {
		const ticket = ++lastHookLook;
		try {
			const statusHooks = await engine.statusHooks();
			if (ticket < shownHookLook) return;
			shownHookLook = ticket;
			update({ statusHooks });
		} catch {
			// What was known stays.
		}
	}

	async function changeStatusHook(request: StatusHookRequest, action: "install" | "remove"): Promise<StatusHookResult> {
		const ticket = ++lastHookLook;
		let result: StatusHookResult;
		try {
			result = action === "install" ? await engine.installStatusHook(request) : await engine.removeStatusHook(request);
		} catch (error) {
			return { outcome: "failed", message: `The app could not answer: ${messageOf(error)}`, hooks: [...(state.statusHooks ?? [])] };
		}
		if (ticket >= shownHookLook) {
			shownHookLook = ticket;
			update({ statusHooks: result.hooks });
		}
		return result;
	}

	let chopOrderTicket = 0;

	async function saveChopOrder(chopOrder: ChopArrangements, also: Omit<Partial<Preferences>, "chopOrder"> = {}): Promise<SavePreferencesResult> {
		const ticket = ++chopOrderTicket;
		update({ chopOrderAim: chopOrder });
		const result = await savePreferences({ ...also, chopOrder });
		if (ticket === chopOrderTicket) update({ chopOrderAim: null });
		return result;
	}

	/** The zoom the latest key asked for, until its save answers. */
	let zoomAim: number | null = null;
	let zoomTicket = 0;
	let zoomToast = 0;

	/** One toast for the zoom: a new one takes the place of the last, so quick presses do not pile up. */
	function showZoom(zoom: number): void {
		dismissToast(zoomToast);
		showToast(`Zoom ${zoomLabel(zoom)}`);
		zoomToast = lastToast;
	}

	async function changeZoom(step: ZoomStep): Promise<void> {
		const from = zoomAim ?? state.preferences.zoom;
		const zoom = stepZoom(from, step);
		if (zoom === from) {
			showZoom(zoom);
			return;
		}
		zoomAim = zoom;
		const ticket = ++zoomTicket;
		const result = await savePreferences({ zoom });
		if (ticket === zoomTicket) zoomAim = null;
		if (result.outcome === "saved") showZoom(zoom);
	}

	/*
	 * The latest read of the changed files, and of a diff, wins: an answer that
	 * comes after a newer request was made is dropped, and so is one for a
	 * worktree or a file that no longer shows.
	 */
	let changesTicket = 0;
	let diffTicket = 0;
	const unheard = (what: string, error: unknown) => notHeard(`back about ${what}`, error);

	/**
	 * A file's diff read again, with its lines on disk where they are its new
	 * side (see ../diff-unchanged.ts), and the diff its notes are judged
	 * against: filled with the unchanged lines, so a note on one is not
	 * outdated, or null when the file should have been read and could not
	 * be checked, so nothing is judged until the next read. `listed` is the
	 * file's comparison as listed, when the window has it: without it, only
	 * a file whose diff compares with the disk is read.
	 */
	async function readJudgedDiff(repository: string, worktreePath: string, comparison: Comparison, file: FileChangeTarget, listed: readonly FileChange[] | null): Promise<{ answer: FileDiffResult; unchanged: readonly string[] | null; judged: FileDiff | null }> {
		const known = listed?.find(candidate => sameFileChange(candidate, file));
		const mayRead = known ? unchangedReadable(known, listed!) : listed === null && (file.area === "unstaged" || file.area === "base");
		const readText = async (): Promise<WorktreeFileResult | null> => {
			try {
				return await engine.readWorktreeFile({ repository, worktree: worktreePath, path: file.path });
			} catch {
				return null;
			}
		};
		const readChangesOf = async (): Promise<FileDiffResult> => {
			try {
				return await engine.readFileDiff({ repository, worktree: worktreePath, compare: comparison, file });
			} catch (error) {
				return { outcome: "failed", message: unheard(`the changes of ${file.path}`, error) };
			}
		};
		const [answer, read] = await Promise.all([readChangesOf(), mayRead ? readText() : Promise.resolve(null)]);
		if (answer.outcome !== "read") return { answer, unchanged: null, judged: null };
		// The kind as Git says it now: a file deleted since has nothing on disk to fill in.
		const readable = mayRead && answer.file !== null && unchangedReadable(answer.file, listed ?? []);
		const lines = readable && read?.outcome === "read" && read.content.kind === "text" ? fileLines(read.content.text) : null;
		const unchanged = lines !== null && linesMatchDiff(answer.diff, lines) ? lines : null;
		// A text diff of a file that should have been read, and was not or changed between the two reads, says nothing of notes on its unchanged lines.
		const unsure = answer.diff.kind === "text" && readable && unchanged === null && !(read?.outcome === "read" && read.content.kind !== "text");
		return { answer, unchanged, judged: unsure ? null : fillUnchanged(answer.diff, unchanged) };
	}

	async function readDiff(view: ChangesView, file: FileChangeTarget, worktreePath: string): Promise<void> {
		const ticket = ++diffTicket;
		const comparison = view.compared ?? "uncommitted";
		let read!: Awaited<ReturnType<typeof readJudgedDiff>>;
		await track({ kind: "read-diff", worktree: view.worktree }, async () => {
			read = await readJudgedDiff(view.repository, worktreePath, comparison, file, view.files);
		});
		const { answer, unchanged, judged } = read;
		if (judged !== null && view.compared !== null) markNotes(view.worktree, view.compared, file, judged);
		const now = state.changes;
		if (ticket !== diffTicket || now?.worktree !== view.worktree || now.selected === null || !sameFileChange(now.selected, file)) return;
		update({ changes: { ...now, diff: answer, unchanged } });
	}

	/** Mark the notes on a file outdated when its diff, read again, no longer has their lines as they were. */
	function markNotes(worktreeId: string, comparison: Comparison, file: FileChangeTarget, diff: FileDiff): void {
		const notes = state.reviews[worktreeId];
		if (!notes) return;
		const marked = markOutdated(notes, comparison, file, diff);
		if (marked !== notes) update({ reviews: { ...state.reviews, [worktreeId]: marked } });
	}

	/**
	 * The notes each new agent started with a review was given, by session,
	 * until it pasted them or did not. Only these go once it pasted: a note
	 * added or changed meanwhile stays. A reloaded window has none, and
	 * neither has it the notes, which live in the window only.
	 */
	const reviewsGiven = new Map<string, { worktree: string; notes: readonly ReviewNote[] }>();
	/** The worktrees whose new review agent's answer is on its way: what it did meanwhile is settled once the answer comes. */
	const startingReview = new Set<string>();
	/** Review agents, by session, whose review went or did not while the answer that started them was on its way, with their worktree. */
	const reviewHeardEarly = new Map<string, string>();
	/** Sessions that went while a review agent's answer was on its way, so a late answer does not bring one back. */
	const goneWhileStarting = new Set<string>();

	/** A new agent's review was pasted, or was not: drop the notes it was given, or say why. */
	function reviewSettled(session: TerminalSession, given: { worktree: string; notes: readonly ReviewNote[] } | null): void {
		reviewsGiven.delete(session.id);
		const prompt = session.prompt;
		if (prompt?.state === "sent") {
			const notes = given === null ? undefined : state.reviews[given.worktree];
			if (given !== null && notes) {
				const sent = new Map(given.notes.map(note => [note.id, note.text]));
				changeNotes(given.worktree, notes.filter(note => sent.get(note.id) !== note.text));
			}
			showToast(describeReviewSent(session.name));
		} else if (prompt?.state === "not-sent") {
			showToast(describeReviewNotPasted(prompt.message), true);
		}
	}

	let lastNote = 0;
	function changeNotes(worktreeId: string, notes: readonly ReviewNote[]): void {
		const { [worktreeId]: _gone, ...others } = state.reviews;
		const chosen = state.chosenNote;
		// A chosen note that went is no longer chosen.
		const chosenGone = chosen !== null && chosen.worktree === worktreeId && !notes.some(note => note.id === chosen.id);
		update({ reviews: notes.length > 0 ? { ...others, [worktreeId]: notes } : others, ...(chosenGone ? { chosenNote: null } : {}) });
	}

	/* The latest read of each worktree's open file wins, and an answer for a file no longer open there is dropped. */
	const fileTickets = new Map<string, number>();

	function forgetEditMemory(worktreeId: string): void {
		const memory = editMemories.get(worktreeId);
		if (memory) memory.forgotten = true;
		editMemories.delete(worktreeId);
	}

	function fileEditMemory(worktreeId: string, path: string): FileEditMemory {
		let memory = editMemories.get(worktreeId);
		if (!memory || memory.path !== path) {
			memory = createFileEditMemory(path);
			editMemories.set(worktreeId, memory);
		}
		return memory;
	}

	async function readOpenFile(worktreeId: string): Promise<void> {
		const view = state.files[worktreeId];
		if (!view) return;
		const ticket = (fileTickets.get(worktreeId) ?? 0) + 1;
		fileTickets.set(worktreeId, ticket);
		let result: WorktreeFileResult;
		// A link in the worktree that leads out opens its target, read-only, as a file outside it.
		let leadsTo: string | null = null;
		try {
			if (view.outside) {
				result = await engine.readFileOutside({ path: view.path });
			} else {
				result = await engine.readWorktreeFile({ repository: view.repository, worktree: view.worktreePath, path: view.path });
				if (result.outcome === "outside" && result.target !== undefined) {
					leadsTo = result.target;
					result = await engine.readFileOutside({ path: leadsTo });
				}
			}
		} catch (error) {
			result = { outcome: "failed", message: unheard(`the file ${leadsTo ?? view.path}`, error) };
		}
		const now = state.files[worktreeId];
		if (fileTickets.get(worktreeId) !== ticket || !now || now.path !== view.path || now.outside !== view.outside || now.worktreePath !== view.worktreePath) return;
		// Editing started while this read was on its way: the text the draft started from stays what a save checks the file
		// against, so newer text on disk is reported as a change, never written over.
		if (now.draft !== null && view.draft === null) return;
		if (leadsTo !== null) {
			// The file is now a link that leads out: its target shows read-only in its place, and a draft, which held nothing
			// unsaved as reading again asked first, goes with the editor.
			forgetEditMemory(worktreeId);
			update({ files: { ...state.files, [worktreeId]: { ...now, path: leadsTo, outside: true, mode: initialFileMode(leadsTo), draft: null, result } } });
			return;
		}
		// With no draft, the editor shows the file as read: a new read makes a new editor, so it never shows text older than
		// what a save checks the file against.
		if (now.draft === null) forgetEditMemory(worktreeId);
		update({ files: { ...state.files, [worktreeId]: { ...now, result } } });
	}

	/**
	 * Whether a step that would drop the open file's draft may go ahead now.
	 * With unsaved edits it may not: the File tab shows, and the person is
	 * asked, unless another dialog is open, when the step is just not taken.
	 */
	function mayDropDraft(worktreeId: string, then: UnsavedFileStep): boolean {
		const view = state.files[worktreeId];
		if (!view || !hasUnsavedEdits(view)) return true;
		if (state.dialog === null) {
			const selection = selectionFor(state.repositories, worktreeId);
			update({ ...(selection ? { selection, board: null, tab: "file" as const } : {}), dialog: { kind: "unsaved-file", worktree: worktreeId, then } });
		}
		return false;
	}

	function openFile(worktreeId: string, path: string): void {
		const selection = selectionFor(state.repositories, worktreeId);
		const worktree = state.repositories.find(repository => repository.path === selection?.repository)?.worktrees.find(candidate => candidate.id === worktreeId);
		if (!selection || !worktree) return;
		const relative = pathInWorktree(worktree, path);
		// A complete path outside the worktree opens read-only; a relative one that steps out does not open.
		const outside = relative === null ? normalCompletePath(path) : null;
		const open = state.files[worktreeId];
		const wanted = relative ?? outside;
		// The file open already: shown as it is, edits and all, without reading it again.
		if (open && wanted !== null && open.path === wanted && open.outside === (outside !== null) && open.worktreePath === worktree.path) {
			update({ selection, board: null, tab: "file" });
			return;
		}
		if (!mayDropDraft(worktreeId, { kind: "open", path })) return;
		const shownHere = state.selection?.worktree === worktreeId && state.board === null;
		const from = shownHere && state.tab !== "file" ? state.tab : open?.from ?? "workspace";
		const shownPath = wanted ?? path;
		const view: FileView = {
			repository: selection.repository, worktreePath: worktree.path, path: shownPath, outside: outside !== null, from, result: wanted === null ? outsideResult(path) : null,
			mode: initialFileMode(shownPath), draft: null, saving: false, saveProblem: null,
		};
		update({ selection, board: null, files: { ...state.files, [worktreeId]: view }, tab: "file" });
		if (wanted !== null) void readOpenFile(worktreeId);
	}

	function closeFile(worktreeId: string): void {
		const view = state.files[worktreeId];
		if (!view || !mayDropDraft(worktreeId, { kind: "close" })) return;
		const { [worktreeId]: _closed, ...others } = state.files;
		const shown = state.tab === "file" && state.selection?.worktree === worktreeId;
		update(shown ? { files: others, tab: view.from } : { files: others });
	}

	function readFileAgain(worktreeId: string): void {
		const view = state.files[worktreeId];
		if (!view || !mayDropDraft(worktreeId, { kind: "read-again" })) return;
		// Reading again drops the draft, which held nothing unsaved, and leaves edit mode.
		forgetEditMemory(worktreeId);
		if (view.draft !== null || view.mode === "edit" || view.saveProblem !== null) changeFile(worktreeId, { draft: null, mode: view.mode === "edit" ? initialFileMode(view.path) : view.mode, saveProblem: null });
		void readOpenFile(worktreeId);
	}

	function changeFile(worktreeId: string, change: Partial<FileView>): void {
		const view = state.files[worktreeId];
		if (view) update({ files: { ...state.files, [worktreeId]: { ...view, ...change } } });
	}

	function editFile(worktreeId: string): void {
		const view = state.files[worktreeId];
		if (!view || !canEditFile(view)) return;
		changeFile(worktreeId, { mode: "edit", draft: view.draft ?? editableFileText(view)! });
	}

	function discardEdits(worktreeId: string): void {
		const view = state.files[worktreeId];
		if (!view) return;
		forgetEditMemory(worktreeId);
		changeFile(worktreeId, { draft: null, saveProblem: null, mode: view.mode === "edit" ? initialFileMode(view.path) : view.mode });
	}

	async function saveFile(worktreeId: string, options: { overwrite?: boolean } = {}): Promise<boolean> {
		const view = state.files[worktreeId];
		// A file outside the worktree is never saved here.
		if (!view || view.draft === null || view.saving || view.outside) return false;
		const original = fileText(view);
		// A file that is not text any more is saved over only when asked to.
		if (original === null && !options.overwrite) {
			changeFile(worktreeId, { saveProblem: { kind: "changed", message: `${view.path} is not the text it was when it was opened. Nothing was saved.` } });
			return false;
		}
		const draft = view.draft;
		const text = textToSave(original ?? "", draft);
		changeFile(worktreeId, { saving: true, saveProblem: null });
		let answer: Awaited<ReturnType<Engine["writeWorktreeFile"]>>;
		try {
			answer = await engine.writeWorktreeFile({ repository: view.repository, worktree: view.worktreePath, path: view.path, text, expected: options.overwrite ? null : original });
		} catch (error) {
			answer = { outcome: "failed", message: `${unheard(`the save of ${view.path}`, error)} It may or may not have been saved; read it again to see.` };
		}
		const now = state.files[worktreeId];
		// Closed or replaced meanwhile: nothing here to tell.
		if (!now || now.path !== view.path || now.worktreePath !== view.worktreePath) return answer.outcome === "saved";
		update({ files: { ...state.files, [worktreeId]: afterSave(now, answer) } });
		return answer.outcome === "saved";
	}

	/** Take the step a question about unsaved edits held back, now that the draft may go. */
	function continueAfterDraft(worktreeId: string, then: UnsavedFileStep): void {
		if (then.kind === "close") closeFile(worktreeId);
		else if (then.kind === "read-again") readFileAgain(worktreeId);
		else openFile(worktreeId, then.path);
	}

	async function answerUnsavedFile(answer: "save" | "discard" | "keep"): Promise<void> {
		const dialog = state.dialog;
		if (dialog?.kind !== "unsaved-file") return;
		const { worktree, then } = dialog;
		if (answer === "keep") {
			update({ dialog: null });
			return;
		}
		if (answer === "save") {
			// The question stays while saving. When the save did not write, it closes and the reason shows in the File tab.
			const saved = await saveFile(worktree);
			if (!saved) {
				if (state.dialog === dialog) update({ dialog: null });
				return;
			}
		} else {
			discardEdits(worktree);
		}
		if (state.dialog === dialog) update({ dialog: null });
		continueAfterDraft(worktree, then);
	}

	/** Forget the notes of a worktree that left the list. */
	function forgetGoneReviews(): void {
		const listed = new Set(state.repositories.flatMap(repository => repository.worktrees.map(worktree => worktree.id)));
		const kept = Object.entries(state.reviews).filter(([id]) => listed.has(id));
		if (kept.length !== Object.keys(state.reviews).length) update({ reviews: Object.fromEntries(kept) });
	}

	/** A worktree in the list by its identity, with its repository's path. */
	function listedWorktree(worktreeId: string): { repository: string; worktree: Worktree } | null {
		for (const repository of state.repositories) {
			const worktree = repository.worktrees.find(candidate => candidate.id === worktreeId);
			if (worktree) return { repository: repository.path, worktree };
		}
		return null;
	}

	async function prepareReview(worktreeId: string): Promise<string | null> {
		const found = listedWorktree(worktreeId);
		const notes = state.reviews[worktreeId];
		if (!notes || notes.length === 0) return null;
		if (found) {
			// Each noted file is read again, so a line that changed since is marked before the preview shows.
			// A note on an unchanged line is judged against the diff with those lines filled in, as in the diff tab. Not heard: the note stays as it was.
			const view = state.changes;
			await Promise.all(notedFiles(notes).map(async ({ comparison, file }) => {
				const listed = view?.worktree === worktreeId && view.compared === comparison ? view.files : null;
				const { judged } = await readJudgedDiff(found.repository, found.worktree.path, comparison, file, listed);
				if (judged !== null) markNotes(worktreeId, comparison, file, judged);
			}));
		}
		const now = state.reviews[worktreeId];
		return now && now.length > 0 ? buildReviewMessage(now) : null;
	}

	async function showReviewNote(worktreeId: string, id: string): Promise<string | null> {
		const note = state.reviews[worktreeId]?.find(candidate => candidate.id === id);
		const view = state.changes;
		if (!note || view?.worktree !== worktreeId) return null;
		if (view.compared !== note.comparison) {
			if (note.comparison === "base" && view.base !== null && !view.base.usable) return "This note is on the comparison with the base, which cannot be used now.";
			await compareChanges(note.comparison);
		}
		const now = state.changes;
		if (now?.worktree !== worktreeId || now.compared !== note.comparison) return null;
		if (!now.files?.some(candidate => sameFileChange(candidate, note.file))) return `${note.file.path} is no longer listed in this comparison.`;
		update({ noteInView: { worktree: worktreeId, id }, chosenNote: { worktree: worktreeId, id } });
		await selectChangedFile(note.file);
		// Reading the diff marks the note outdated when its lines changed. Its old lines may still show in part.
		const after = state.reviews[worktreeId]?.find(candidate => candidate.id === id);
		const diff = state.changes?.diff;
		if (!after?.outdated) return null;
		const shown = diff?.outcome === "read" && noteLinesShown(after, fillUnchanged(diff.diff, state.changes?.unchanged ?? null));
		return shown ? null : "Its lines changed or left the diff since the note, so they may not show.";
	}

	function worktreeOf(repositoryPath: string, worktreeId: string) {
		return state.repositories.find(candidate => candidate.path === repositoryPath)?.worktrees.find(candidate => candidate.id === worktreeId) ?? null;
	}

	/** A listed worktree by its registered path, as requests to the engine name it. */
	function worktreeAt(repositoryPath: string, worktreePath: string) {
		return state.repositories.find(candidate => candidate.path === repositoryPath)?.worktrees.find(candidate => candidate.path === worktreePath) ?? null;
	}

	/**
	 * The files of the last stage or unstage, for the first read of the list
	 * that starts after it ended, whichever asked for it: the write's own, the
	 * watcher's, or a Refresh. A read that started earlier lists them as they were.
	 */
	let movedByWrite: { worktree: string; paths: string[]; after: number } | null = null;
	let settledWrites = 0;

	async function readChanges(repositoryPath: string, worktreeId: string): Promise<void> {
		const worktree = worktreeOf(repositoryPath, worktreeId);
		if (!worktree) return;
		const ticket = ++changesTicket;
		if (state.changes?.worktree !== worktreeId || state.changes.repository !== repositoryPath) {
			update({ changes: { repository: repositoryPath, worktree: worktreeId, files: null, more: false, compared: null, base: null, problem: null, hasCommit: true, operation: null, detached: false, writing: false, settledWrites: 0, writeProblem: null, selected: null, diff: null, unchanged: null } });
		}
		const compare = chosenComparison(state.layout, worktreeId);
		let answer!: FileChangesResult;
		await track({ kind: "read-changes", worktree: worktreeId }, async () => {
			try {
				answer = await engine.readFileChanges({ repository: repositoryPath, worktree: worktree.path, compare });
			} catch (error) {
				answer = { outcome: "failed", message: unheard("the changed files", error) };
			}
		});
		const view = state.changes;
		if (ticket !== changesTicket || view?.worktree !== worktreeId) return;
		if (answer.outcome !== "read") {
			update({ changes: { ...view, problem: answer.message } });
			return;
		}
		// Only the diff tab's diff is read: nothing is read for a file no tab shows.
		const open = state.diffs[worktreeId];
		const wanted = open?.file ?? null;
		const move = movedByWrite?.worktree === worktreeId && ticket > movedByWrite.after ? movedByWrite : null;
		if (move) movedByWrite = null;
		const moved = move?.paths ?? [];
		// A file just staged or unstaged keeps its diff tab, now on its new group's entry.
		const kept = wanted === null ? undefined : answer.files.find(file => sameFileChange(file, wanted)) ?? (moved.includes(wanted.path) ? movedEntry(answer.files, wanted.path) : undefined);
		const selected = kept ? { area: kept.area, path: kept.path, previousPath: kept.previousPath } : null;
		// The same file keeps its diff on screen until the new one answers, so it does not flicker.
		const sameComparison = view.compared === answer.compared;
		const keptDiff = kept && view.selected !== null && sameFileChange(view.selected, kept) && sameComparison ? view.diff : null;
		const next: ChangesView = { ...view, files: answer.files, more: answer.more, compared: answer.compared, base: answer.base, hasCommit: answer.hasCommit, operation: answer.operation, detached: answer.detached, settledWrites: move ? ++settledWrites : view.settledWrites, problem: null, selected, diff: keptDiff, unchanged: keptDiff === null ? null : view.unchanged };
		// A viewed file whose diff changed since, or that left the list, is no longer viewed.
		const viewed = keptViewed(worktreeId, answer.compared, answer.files);
		if (viewed !== state.viewed) update({ viewed });
		// A diff tab whose file is no longer changed has nothing to show: it closes, back to where it was opened from.
		const retargeted = open && selected !== null && !sameFileChange(open.file, selected) ? { diffs: { ...state.diffs, [worktreeId]: { ...open, file: selected } } } : {};
		update(open && !kept ? { ...closedDiff(worktreeId), changes: next } : { ...retargeted, changes: next });
		if (selected) await readDiff(next, selected, worktree.path);
	}

	const portTickets = new Map<string, number>();
	async function readPorts(repositoryPath: string, worktreeId: string): Promise<void> {
		const worktree = worktreeOf(repositoryPath, worktreeId);
		if (!worktree) return;
		const ticket = (portTickets.get(worktree.path) ?? 0) + 1;
		portTickets.set(worktree.path, ticket);
		let answer: PortsResult;
		try {
			answer = await engine.readPorts({ repository: repositoryPath, worktree: worktree.path });
		} catch {
			// Not heard: the last answer stays, and the next trigger asks again.
			return;
		}
		if (answer.outcome === "hidden" || portTickets.get(worktree.path) !== ticket) return;
		update({
			ports: { ...state.ports, [worktree.path]: answer },
			...(answer.outcome === "read" ? { portClashes: answer.clashes } : {}),
		});
	}

	let chopsTicket = 0;
	async function readChops(repositoryPath: string): Promise<void> {
		const ticket = ++chopsTicket;
		if (state.chops?.repository !== repositoryPath) update({ chops: { repository: repositoryPath, list: null } });
		let answer: ChopList;
		try {
			answer = await engine.listChops({ repository: repositoryPath });
		} catch (error) {
			answer = { outcome: "failed", message: unheard("the chops", error) };
		}
		if (ticket !== chopsTicket || state.chops?.repository !== repositoryPath) return;
		update({ chops: { repository: repositoryPath, list: answer } });
	}

	/** Put a prompt chop's text, as listed or as edited for this run, on the clipboard. */
	async function copyPrompt(repositoryPath: string, name: string, text?: string, noAgent: "none-found" | MissingPick | null = null): Promise<void> {
		const offered = offeredChops(state);
		const list = offered?.repository === repositoryPath ? offered.list : null;
		const chop = findListedChop(listedChops(list), name);
		if (chop === null || chop.kind !== "prompt") {
			showToast(`No prompt chop called "${name}" is listed for this repository now.`, true);
			return;
		}
		try {
			await engine.writeClipboard(text ?? chop.text);
		} catch {
			showToast(`${chop.name} could not be put on the clipboard.`, true);
			return;
		}
		if (noAgent !== null) showToast(describePromptCopiedNoAgentFound(chop.name, noAgent), true);
		else showToast(describePromptCopied(chop.name));
	}

	/** Send a prompt chop to a running agent session, which shows once it went. */
	async function sendPromptChop(repositoryPath: string, worktreeId: string, worktreePath: string, name: string, size: { cols: number; rows: number }, session: string, approve?: string, text?: string): Promise<void> {
		let result: RunChopResult;
		try {
			result = await engine.runChop({ repository: repositoryPath, worktree: worktreePath, chop: name, ...size, session, ...(approve === undefined ? {} : { approve }), ...(text === undefined ? {} : { text }) });
		} catch (error) {
			showToast(notHeard("back about the prompt", error, ". It may have been sent: look at the agent before you send it again."), true);
			return;
		}
		if (result.outcome === "sent") {
			if (!state.terminals.some(known => known.id === result.session.id)) update({ terminals: withTerminal(state.terminals, result.session.id, result.session) });
			showToast(describePromptSent(name, result.session.name));
			revealSession(result.session.id);
			return;
		}
		if (result.outcome === "needs-approval") {
			if (state.dialog === null || state.dialog.kind === "palette") update({ dialog: { kind: "approve-chop", repository: repositoryPath, worktree: worktreeId, chop: result.chop, path: result.path, session, ...(text === undefined ? {} : { text }) } });
			else showToast(`${name} comes from the repository and needs your approval. Send it again once this dialog is closed.`, true);
			return;
		}
		if (result.outcome === "opened") return;
		showToast(`${name} was not sent: ${result.message}`, true);
	}

	async function runChop(repositoryPath: string, worktreeId: string, name: string, size: { cols: number; rows: number }, options: RunChopOptions = {}): Promise<void> {
		const { approve, target, text } = options;
		// With "Use chops" off, nothing runs a chop, whatever asked.
		if (!state.preferences.useChops) return;
		// Chosen is enough to be the last one, even when it then asks first or cannot start.
		if (state.lastChops[repositoryPath] !== name) update({ lastChops: { ...state.lastChops, [repositoryPath]: name } });
		const listed = findListedChop(listedChops(state.chops?.repository === repositoryPath ? state.chops.list : null), name);
		if (listed?.kind === "prompt") {
			// With no agent saved, the prompt has nowhere to go: it is copied instead.
			if (state.preferences.agents.length === 0) return copyPrompt(repositoryPath, name, text);
			const worktree = worktreeOf(repositoryPath, worktreeId);
			if (!worktree) return showToast(`${name} was not sent: the worktree is no longer listed.`, true);
			if (isBeingRemoved(state, repositoryPath, worktree.path)) return showToast(`${name} was not sent: ${BEING_REMOVED_REASON}`, true);
			const where = target ?? (() => {
				const chosen = promptTarget(state.terminals, worktreeId);
				return chosen.kind === "new" ? { session: null } : chosen.kind === "session" ? { session: chosen.session } : null;
			})();
			if (where === null) {
				// Never over a dialog the person opened meanwhile.
				if (state.dialog === null || state.dialog.kind === "palette") update({ dialog: { kind: "send-prompt", repository: repositoryPath, worktree: worktreeId, chop: name, ...(text === undefined ? {} : { text }) } });
				return;
			}
			if (where.session !== null) return sendPromptChop(repositoryPath, worktreeId, worktree.path, name, size, where.session, approve, text);
			if (listed.agent === null) {
				// A new agent, the default one: looked for again now. With none found, or the repository's not there, the prompt is copied, as with none saved.
				// While not known, the main process, which looks itself, decides.
				await locateAgents();
				const { agents } = state.preferences;
				const pick = repositoryPick(state, repositoryPath);
				const why = defaultAgent(agents, state.agentLocations, pick) === null ? whyNoDefaultAgent(agents, state.agentLocations, pick) : null;
				if (why === "none-found" || (why !== null && typeof why === "object")) return copyPrompt(repositoryPath, name, text, why);
			}
		}
		const worktree = worktreeOf(repositoryPath, worktreeId);
		// After the approval dialog closed, or for a prompt, whose palette entry does not wait for a starting session,
		// a run that cannot start says so: nothing else would.
		const blocked = (why: string) => {
			if (approve !== undefined || listed?.kind === "prompt") showToast(`${name} was not started: ${why}`, true);
		};
		if (!worktree) return blocked("the worktree is no longer listed.");
		if (isBeingRemoved(state, repositoryPath, worktree.path)) return blocked(BEING_REMOVED_REASON);
		if (state.operations.some(operation => operation.kind === "open-terminal" && operation.worktree === worktreeId)) return blocked("another session is starting there. Run it again in a moment.");
		await track({ kind: "open-terminal", worktree: worktreeId, agent: name }, async () => {
			let message: string;
			let command: string | null = null;
			try {
				const result = await engine.runChop({ repository: repositoryPath, worktree: worktree.path, chop: name, ...size, ...(approve === undefined ? {} : { approve }), ...(text === undefined ? {} : { text }) });
				if (result.outcome === "opened") {
					const { session } = result;
					update({
						// A change heard meanwhile, such as the prompt being sent, is newer than this answer.
						terminals: state.terminals.some(known => known.id === session.id) ? state.terminals : withTerminal(state.terminals, session.id, session),
						shownSessions: { ...state.shownSessions, [session.worktree]: session.id },
						unseenSessions: state.unseenSessions.filter(id => id !== session.id),
						terminalProblem: state.terminalProblem?.worktree === worktreeId ? null : state.terminalProblem,
					});
					return;
				}
				if (result.outcome === "needs-approval") {
					// Never over a dialog the person opened meanwhile.
					if (state.dialog === null || state.dialog.kind === "palette") update({ dialog: { kind: "approve-chop", repository: repositoryPath, worktree: worktreeId, chop: result.chop, path: result.path, ...(text === undefined ? {} : { text }) } });
					else showToast(`${name} comes from the repository and needs your approval. Run it again once this dialog is closed.`, true);
					return;
				}
				// A run with no session never answers "sent".
				if (result.outcome === "sent") return;
				message = result.message;
				if ((result.outcome === "not-found" || result.outcome === "failed") && result.command !== undefined) command = result.command;
			} catch (error) {
				message = `The app did not hear whether ${name} started: ${messageOf(error)}`;
			}
			update({ terminalProblem: { worktree: worktreeId, agent: name, message, command } });
		});
	}

	async function insertChop(sessionId: string, name: string): Promise<void> {
		const session = state.terminals.find(candidate => candidate.id === sessionId);
		if (!session || session.state.kind !== "running") return;
		const offered = offeredChops(state);
		const list = offered?.repository === session.repository ? offered.list : null;
		const chop = findListedChop(commandChops(list), name);
		if (chop === null) {
			showToast(`No command chop called "${name}" is listed for this repository now.`, true);
			return;
		}
		let result: PasteResult;
		try {
			result = await engine.pasteTerminal(sessionId, chop.text);
		} catch (error) {
			showToast(notHeard("back about the chop", error, ". It may have been typed: look at the session before you insert it again."), true);
			return;
		}
		if (result.outcome !== "pasted") showToast(`${chop.name} was not inserted: ${result.message}`, true);
	}

	/**
	 * Stage or unstage files of the Uncommitted list (see `Engine.stageFiles`),
	 * with the command the list shows for them, then read the list again at
	 * once. A refusal or Git's failure stays in `writeProblem` until the next
	 * write works. Never throws.
	 */
	async function writeIndex(action: IndexAction, files: readonly FileChangeTarget[]): Promise<IndexWriteResult | null> {
		const view = state.changes;
		if (!view?.files || view.compared !== "uncommitted" || writesWait(state, view) || files.length === 0) return null;
		const worktree = worktreeOf(view.repository, view.worktree);
		if (!worktree) return null;
		const targets = files.map(file => ({ area: file.area, path: file.path, previousPath: file.previousPath }));
		if (!targets.every(file => canWriteIndex(action, file.area) && view.files!.some(candidate => sameFileChange(candidate, file)))) return null;
		const command = indexCommand(action, targets, view.hasCommit);
		const run = state.commitRuns[view.worktree];
		update({ changes: { ...view, writing: true }, ...(run?.committed ? { commitRuns: { ...state.commitRuns, [view.worktree]: { ...run, committed: null } } } : {}) });
		const request = { repository: view.repository, worktree: worktree.path, files: targets, shown: command.args };
		let result: IndexWriteResult;
		try {
			result = await (action === "stage" ? engine.stageFiles(request) : engine.unstageFiles(request));
		} catch (error) {
			result = { outcome: "failed", command: describeGitCommand(command), message: unheard(action === "stage" ? "staging" : "unstaging", error) };
		}
		const now = state.changes;
		if (now?.worktree === view.worktree) {
			const writeProblem = result.outcome === "written" ? null : { action, command: result.outcome === "failed" ? result.command : null, message: result.message };
			update({ changes: { ...now, writing: false, writeProblem } });
		}
		movedByWrite = { worktree: view.worktree, paths: targets.flatMap(file => (file.previousPath === null ? [file.path] : [file.path, file.previousPath])), after: changesTicket };
		await readChanges(view.repository, view.worktree);
		return result;
	}

	async function discardFiles(files: readonly FileChangeTarget[]): Promise<DiscardResult | null> {
		const view = state.changes;
		if (!view?.files || view.compared !== "uncommitted" || writesWait(state, view) || files.length === 0) return null;
		const worktree = worktreeOf(view.repository, view.worktree);
		if (!worktree) return null;
		const targets = files.map(file => ({ area: file.area, path: file.path, previousPath: file.previousPath }));
		if (!targets.every(file => fileDiscardable(file, view.hasCommit) && view.files!.some(candidate => sameFileChange(candidate, file)))) return null;
		const planned = discardCommand(targets, view.hasCommit);
		if (!planned.ok) return { outcome: "refused", message: planned.message };
		const run = state.commitRuns[view.worktree];
		update({ changes: { ...view, writing: true }, ...(run?.committed ? { commitRuns: { ...state.commitRuns, [view.worktree]: { ...run, committed: null } } } : {}) });
		let result: DiscardResult;
		try {
			result = await engine.discardFiles({ repository: view.repository, worktree: worktree.path, files: targets, shown: planned.command.args });
		} catch (error) {
			result = { outcome: "failed", command: describeGitCommand(planned.command), message: unheard("the discard", error) };
		}
		const now = state.changes;
		// A failure shows in the dialog, which stays open; an earlier stage's alert goes once a write works.
		if (now?.worktree === view.worktree) update({ changes: { ...now, writing: false, ...(result.outcome === "written" ? { writeProblem: null } : {}) } });
		const paths = discardPaths(targets);
		const open = state.files[view.worktree];
		if (result.outcome === "written" && open && open.worktreePath === worktree.path && paths.includes(open.path)) {
			// Not through readFileAgain, which keeps unsaved edits while a dialog is open: the person chose to lose them.
			forgetEditMemory(view.worktree);
			changeFile(view.worktree, { draft: null, saveProblem: null, mode: open.mode === "edit" ? initialFileMode(open.path) : open.mode });
			void readOpenFile(view.worktree);
		}
		movedByWrite = { worktree: view.worktree, paths, after: changesTicket };
		await readChanges(view.repository, view.worktree);
		return result;
	}

	function setCommitMessage(worktreeId: string, text: string): void {
		if ((state.commitMessages[worktreeId] ?? "") === text) return;
		update({ commitMessages: { ...state.commitMessages, [worktreeId]: text } });
	}

	async function commitStaged(): Promise<CommitResult | null> {
		const view = state.changes;
		if (!view?.files || view.compared !== "uncommitted" || writesWait(state, view)) return null;
		const worktree = worktreeOf(view.repository, view.worktree);
		if (!worktree) return null;
		const message = state.commitMessages[view.worktree] ?? "";
		if (commitBlocker(commitStateOf({ ...view, files: view.files }, message)) !== null) return null;
		const id = view.worktree;
		const ran = (run: CommitRun) => update({ commitRuns: { ...state.commitRuns, [id]: run } });
		ran({ running: true, problem: null, committed: null });
		let result: CommitResult;
		try {
			result = await engine.commitStaged({ repository: view.repository, worktree: worktree.path, message, shown: [...COMMIT_ARGUMENTS] });
		} catch (error) {
			result = { outcome: "failed", command: COMMIT_COMMAND_LINE, message: unheard("the commit", error) };
		}
		// Kept for the worktree whichever shows now, so a commit that ran while another worktree showed says how it ended on return.
		if (result.outcome === "committed") {
			const { [id]: _sent, ...others } = state.commitMessages;
			update({ commitMessages: others });
			if (state.generations[id]?.commit?.running === false) changeGeneration(id, "commit", null);
			ran({ running: false, problem: null, committed: { commit: result.commit, short: result.short } });
		} else {
			ran({ running: false, problem: { command: result.outcome === "failed" ? result.command : null, message: result.message }, committed: null });
		}
		// The list at once while it shows, and the repository for the row's counts. Another worktree's list is read when it shows again.
		await Promise.all([state.changes?.worktree === id ? readChanges(view.repository, id) : null, reloadOne(view.repository)]);
		return result;
	}

	function changeGeneration(worktreeId: string, kind: GenerateKind, run: GenerationRun | null): void {
		const { [kind]: _before, ...others } = state.generations[worktreeId] ?? {};
		update({ generations: { ...state.generations, [worktreeId]: run === null ? others : { ...others, [kind]: run } } });
	}

	/** Ask the engine once, naming the agent and the command as the window has them. Never throws. */
	async function askGenerator(id: string, kind: GenerateKind, repository: string, worktree: string, base: string | null): Promise<GenerateTextResult> {
		const choice = generatorOf(state);
		if (!choice.ok) return { outcome: "refused", message: choice.reason };
		try {
			return await engine.generateText({ id, kind, repository, worktree, base, shown: generateCommand(choice.generator) });
		} catch (error) {
			return { outcome: "failed", command: describeGenerateCommand(choice.generator), message: unheard("the agent", error) };
		}
	}

	/** One run whose text goes into a field, or waits beside it when `free` says the field is not as it was, or the worktree changed. */
	async function generateInto(worktreeId: string, kind: GenerateKind, repository: string, worktree: string, base: string | null, free: () => boolean): Promise<void> {
		const choice = generatorOf(state);
		if (!choice.ok) return;
		const started: GenerationRun = { id: crypto.randomUUID(), running: true, by: choice.generator.setting.name, held: null, changed: [], leftOut: 0, filled: false, problem: null };
		changeGeneration(worktreeId, kind, started);
		const result = await askGenerator(started.id, kind, repository, worktree, base);
		if (state.generations[worktreeId]?.[kind]?.id !== started.id) return;
		const ended = { ...started, running: false };
		switch (result.outcome) {
			case "stopped":
				changeGeneration(worktreeId, kind, null);
				return;
			case "refused":
				changeGeneration(worktreeId, kind, { ...ended, problem: { command: null, message: result.message } });
				return;
			case "failed":
				changeGeneration(worktreeId, kind, { ...ended, problem: { command: result.command, message: result.message } });
				return;
			case "generated": {
				const { changed, leftOut } = result;
				const waits = changed.length > 0 || !free();
				changeGeneration(worktreeId, kind, { ...ended, changed, leftOut, held: waits ? result.text : null });
				if (!waits) fillGenerated(worktreeId, kind, result.text);
			}
		}
	}

	/** Put generated text in its field, and say so. */
	function fillGenerated(worktreeId: string, kind: GenerateKind, text: GeneratedText): void {
		const run = state.generations[worktreeId]?.[kind];
		if (text.kind === "commit") setCommitMessage(worktreeId, text.message);
		else {
			const form = state.pullRequestForms[worktreeId];
			// Timber runs with what was typed: the text waits until it ended.
			if (!form || form.running) return;
			editPullRequestForm(worktreeId, { title: pullRequestTitleWithKey(text.title, null, form.titleKey), body: text.body });
		}
		if (run) changeGeneration(worktreeId, kind, { ...run, held: null, changed: [], filled: true });
	}

	async function generateCommitMessage(): Promise<void> {
		const view = state.changes;
		if (!view?.files || view.compared !== "uncommitted") return;
		const id = view.worktree;
		const worktree = worktreeOf(view.repository, id);
		if (!worktree || state.generations[id]?.commit?.running) return;
		const committing = state.commitRuns[id]?.running === true;
		if (commitBlockerOf(generatorOf(state), commitStateOf({ ...view, files: view.files }, ""), committing) !== null) return;
		// The box must still be empty when the text comes. What was typed before it stays too.
		await generateInto(id, "commit", view.repository, worktree.path, null, () => (state.commitMessages[id] ?? "").trim() === "" && state.commitRuns[id]?.running !== true);
	}

	async function generatePullRequestText(worktreeId: string): Promise<void> {
		const form = state.pullRequestForms[worktreeId];
		const worktree = form && worktreeOf(form.repository, worktreeId);
		if (!form || !worktree || state.generations[worktreeId]?.["pull-request"]?.running) return;
		if (pullRequestBlockerOf(generatorOf(state), worktree, state.pullRequests[form.repository], form) !== null) return;
		await generateInto(worktreeId, "pull-request", form.repository, form.worktree, pullRequestBaseFromText(form.base), () => {
			const now = state.pullRequestForms[worktreeId];
			return now !== undefined && !now.running && !now.titleEdited && now.body.trim() === "";
		});
	}

	async function writePullRequest(repository: string, worktreeId: string, id: string): Promise<GenerateTextResult> {
		const worktree = worktreeOf(repository, worktreeId);
		if (!worktree) return { outcome: "refused", message: "The worktree is no longer listed." };
		startPullRequestForm(repository, worktree);
		const form = state.pullRequestForms[worktreeId];
		const blocker = pullRequestBlockerOf(generatorOf(state), worktree, state.pullRequests[repository], form);
		if (!form || blocker !== null) return { outcome: "refused", message: blocker ?? "There is no pull request form for this worktree." };
		const result = await askGenerator(id, "pull-request", repository, worktree.path, pullRequestBaseFromText(form.base));
		if (result.outcome !== "generated" || result.text.kind !== "pull-request") return result;
		return { ...result, text: { ...result.text, title: pullRequestTitleWithKey(result.text.title, null, state.pullRequestForms[worktreeId]?.titleKey ?? null) } };
	}

	function stopRun(id: string): void {
		void engine.stopGenerating(id).catch(() => {});
	}

	async function selectChangedFile(file: FileChangeTarget): Promise<void> {
		const view = state.changes;
		if (!view?.files?.some(candidate => sameFileChange(candidate, file))) return;
		const worktree = worktreeOf(view.repository, view.worktree);
		if (!worktree) return;
		const selected = { area: file.area, path: file.path, previousPath: file.previousPath };
		// Another file chosen while a note was coming into view: it is not brought into view later.
		const inView = state.noteInView;
		const pending = inView === null ? null : state.reviews[inView.worktree]?.find(note => note.id === inView.id);
		if (inView !== null && (inView.worktree !== view.worktree || !pending || !sameFileChange(pending.file, selected))) update({ noteInView: null });
		const before = state.diffs[view.worktree];
		const shownHere = state.selection?.worktree === view.worktree && state.board === null;
		const from = shownHere && state.tab !== "diff" ? state.tab : before?.from ?? "workspace";
		const selection = selectionFor(state.repositories, view.worktree);
		const tab = { ...(selection ? { selection, board: null } : {}), tab: "diff" as const, diffs: { ...state.diffs, [view.worktree]: { file: selected, from } } };
		if (view.selected && sameFileChange(view.selected, selected) && view.diff !== null) {
			update(tab);
			return;
		}
		const next: ChangesView = { ...view, selected, diff: null, unchanged: null };
		update({ ...tab, changes: next });
		await readDiff(next, selected, worktree.path);
	}

	/** The files of `changes` as the list shows them, in its order, through the worktree's filter. */
	function shownFiles(view: ChangesView): FileChange[] {
		return filterFiles(listedOrder(view.files ?? []), state.changeFilters[view.worktree] ?? "");
	}

	async function stepChangedFile(step: 1 | -1): Promise<FileChange | null> {
		const view = state.changes;
		if (!view?.files) return null;
		const next = steppedFile(shownFiles(view), state.diffs[view.worktree]?.file ?? null, step);
		if (next === null) return null;
		await selectChangedFile(next);
		return next;
	}

	/** The viewed files of a worktree after its list in `comparison` was read again: those whose version changed, or that left the list, go. */
	function keptViewed(worktreeId: string, comparison: Comparison, files: readonly FileChange[]): AppState["viewed"] {
		const marked = state.viewed[worktreeId];
		if (!marked) return state.viewed;
		const prefix = `${comparison}\0`;
		const listed = new Map(files.map(file => [viewedKey(comparison, file), file.version]));
		const kept = Object.fromEntries(Object.entries(marked).filter(([key, version]) => !key.startsWith(prefix) || listed.get(key) === version));
		return Object.keys(kept).length === Object.keys(marked).length ? state.viewed : { ...state.viewed, [worktreeId]: kept };
	}

	async function toggleViewed(file: FileChange): Promise<FileChange | null> {
		const view = state.changes;
		if (!view?.files || view.compared === null) return null;
		const listed = view.files.find(candidate => sameFileChange(candidate, file));
		if (!listed) return null;
		const key = viewedKey(view.compared, listed);
		const { [key]: _was, ...others } = state.viewed[view.worktree] ?? {};
		const viewing = !fileViewed(state, view.worktree, view.compared, listed);
		update({ viewed: { ...state.viewed, [view.worktree]: viewing ? { ...others, [key]: listed.version } : others } });
		return viewing ? stepChangedFile(1) : null;
	}

	function setChangesFilter(worktreeId: string, text: string): void {
		if ((state.changeFilters[worktreeId] ?? "") === text) return;
		update({ changeFilters: { ...state.changeFilters, [worktreeId]: text } });
	}

	/** What closing the diff tab of a worktree changes: the tab goes, and the tab it came from shows when it showed. */
	function closedDiff(worktreeId: string): Partial<AppState> {
		const open = state.diffs[worktreeId];
		if (!open) return {};
		const { [worktreeId]: _closed, ...diffs } = state.diffs;
		const shown = state.tab === "diff" && state.selection?.worktree === worktreeId;
		const changes = state.changes?.worktree === worktreeId ? { ...state.changes, selected: null, diff: null, unchanged: null } : state.changes;
		return { diffs, changes, ...(shown ? { tab: open.from } : {}) };
	}

	function closeDiff(worktreeId: string): void {
		if (!state.diffs[worktreeId]) return;
		// The note on its way into view was in this diff.
		update({ ...closedDiff(worktreeId), ...(state.noteInView?.worktree === worktreeId ? { noteInView: null } : {}) });
	}

	function chooseDiffLayout(diffLayout: DiffLayout): void {
		if (state.layout.diffLayout === diffLayout) return;
		changeLayout({ ...state.layout, diffLayout });
		void saveLayout("layout");
	}

	async function compareChanges(compare: Comparison): Promise<void> {
		const view = state.changes;
		if (!view) return;
		// A note on its way into view is let go: the diff it waited for is not coming.
		if (state.noteInView !== null) update({ noteInView: null });
		const layout = chooseComparison(state.layout, view.worktree, compare);
		if (layout !== state.layout) {
			changeLayout(layout);
			void saveLayout("layout");
		}
		if (view.compared === compare) return;
		// The list of the other comparison is a different list: read it afresh, so nothing of the old one shows under the new header.
		// The diff tab shows a file of the old list, so it closes.
		update({ ...closedDiff(view.worktree), changes: { ...view, files: null, more: false, compared: null, problem: null, selected: null, diff: null, unchanged: null } });
		await readChanges(view.repository, view.worktree);
	}

	async function openInEditor(request: OpenInEditorRequest): Promise<OpenInEditorResult | null> {
		const editorSettings = () => update({ dialog: { kind: "settings", section: "editor" } });
		// No editor, or one whose command cannot be read: the place to fix that is Settings.
		if (state.preferences.editor === null || !readableEditorSetting(state.preferences.editor)) {
			editorSettings();
			return null;
		}
		if (state.operations.some(operation => operation.kind === "open-in-editor" && operation.worktree === request.worktree)) return null;
		if (isBeingRemoved(state, request.repository, request.worktree)) return null;
		const selectedAtPress = state.selection?.worktree ?? null;
		const ask = async (): Promise<OpenInEditorResult> => {
			try {
				return await engine.openInEditor(request);
			} catch (error) {
				return { outcome: "failed", command: null, message: notHeard("whether the editor started", error) };
			}
		};
		let answer!: OpenInEditorResult;
		await track({ kind: "open-in-editor", worktree: request.worktree }, async () => {
			answer = await ask();
		});
		const repository = state.repositories.find(candidate => candidate.path === request.repository);
		const worktree = repository?.worktrees.find(candidate => candidate.path === request.worktree);
		switch (answer.outcome) {
			case "opened":
				if (answer.session !== undefined) {
					// A terminal editor is a new session: it shows on the Workspace tab and takes the keyboard, so there is no toast.
					const { session } = answer;
					update({
						// A change heard meanwhile is newer than this answer.
						terminals: state.terminals.some(known => known.id === session.id) ? state.terminals : withTerminal(state.terminals, session.id, session),
						unseenSessions: state.unseenSessions.filter(id => id !== session.id),
						editorProblem: null,
					});
					// Only a person still where they pressed is taken to the session; one who moved to another worktree is not pulled back.
					if (state.selection?.worktree === session.worktree || (state.selection?.worktree ?? null) === selectedAtPress) revealSession(session.id);
					else update({ shownSessions: { ...state.shownSessions, [session.worktree]: session.id } });
					break;
				}
				update({ editorProblem: null });
				showToast(describeOpenedInEditor(request.file ?? (worktree ? worktreeLabel(worktree) : folderName(request.worktree))));
				break;
			case "not-configured":
				// Saved somewhere else since this window read the preferences.
				editorSettings();
				break;
			case "not-listed":
				update({ editorProblem: { kind: answer.outcome, worktree: request.worktree, file: request.file ?? null, command: null, message: answer.message } });
				break;
			default:
				update({ editorProblem: { kind: answer.outcome, worktree: request.worktree, file: request.file ?? null, command: answer.command, message: answer.message } });
		}
		return answer;
	}

	function showFetch(status: RepositoryFetch): void {
		const before = state.fetches[status.repository];
		update({ fetches: { ...state.fetches, [status.repository]: status } });
		// A fetch that ended, well or not, is when pull requests are read again.
		const ended = !status.fetching && (status.lastFetched !== (before?.lastFetched ?? null) || status.failure?.at !== before?.failure?.at);
		if (ended) {
			void refreshPullRequests(status.repository);
			issuesDue(status.repository);
		}
	}

	async function fetchNow(path: string): Promise<FetchResult | null> {
		if (state.operations.some(operation => operation.kind === "fetch-repository" && operation.repository === path)) return null;
		let answer!: FetchResult;
		await track({ kind: "fetch-repository", repository: path }, async () => {
			try {
				answer = await engine.fetchNow(path);
			} catch (error) {
				answer = { outcome: "not-listed", message: notHeard("how the fetch ended", error) };
			}
		});
		const name = state.repositories.find(repository => repository.path === path)?.name ?? folderName(path);
		switch (answer.outcome) {
			case "fetched":
				showFetch(answer.fetch);
				showToast(describeFetched(name));
				break;
			case "failed":
				showFetch(answer.fetch);
				break;
			case "not-listed": {
				// Nothing ran, or it stopped early; the marker on the repository says why, quietly, as for a failed fetch.
				const before = state.fetches[path] ?? { repository: path, fetching: false, lastFetched: null, failure: null };
				showFetch({ ...before, fetching: false, failure: { kind: "failed", message: answer.message, at: Date.now() } });
				break;
			}
		}
		return answer;
	}

	function findTimber(look: () => Promise<TimberStatus>): Promise<void> {
		const wasReady = timberReady(state);
		const before = JSON.stringify(state.timber);
		return track({ kind: "find-timber" }, async () => {
			try {
				update({ timber: { known: true, status: await look() } });
			} catch (error) {
				update({ timber: { known: false, message: messageOf(error) } });
			}
			// Another Timber may list backups where the last one could not, or answer otherwise: read them again.
			if (JSON.stringify(state.timber) !== before) {
				backupGeneration += 1;
				arenaGeneration += 1;
				if (Object.keys(state.backups).length > 0) update({ backups: {} });
				if (Object.keys(state.arenas).length > 0) update({ arenas: {} });
			}
			if (timberReady(state) && !wasReady) void reloadAll("all");
			else if (timberReady(state)) {
				catchUpBackups();
				catchUpArenas();
			}
		});
	}

	function selectRepository(path: string): void {
		const selection = selectionForRepository(state.repositories, path);
		if (selection && (selection.worktree !== state.selection?.worktree || state.board !== null)) update({ selection, board: null });
	}

	// One at a time: a second click while the picker is open, or while a repository is being forgotten, does nothing.
	function addRepository(): Promise<void> {
		if (state.operations.some(operation => operation.kind === "add-repository")) return Promise.resolve();
		return track({ kind: "add-repository" }, async () => {
			try {
				const result = await engine.addRepository();
				switch (result.outcome) {
					case "cancelled":
						return;
					case "added":
						update({ notice: null });
						// Read the list again instead of patching it, so it is whatever the engine saved.
						await reloadAll("all");
						selectRepository(result.repository.path);
						showToast(describeAdded(result.repository.name));
						return;
					case "already-listed":
						update({ notice: { kind: "already-listed", repository: result.repository } });
						selectRepository(result.repository);
						return;
					case "not-a-repository":
						update({ notice: { kind: "not-a-repository", folder: result.folder } });
						return;
					case "overridden":
						update({ notice: { kind: "overridden" } });
						return;
					case "failed":
						update({ notice: { kind: "failed", action: "add", message: result.message } });
						return;
				}
			} catch (error) {
				update({ notice: { kind: "failed", action: "add", message: messageOf(error) } });
			}
		});
	}

	function removeRepository(path: string): Promise<void> {
		if (state.operations.some(operation => operation.kind === "remove-repository" && operation.repository === path)) return Promise.resolve();
		return track({ kind: "remove-repository", repository: path }, async () => {
			const name = state.repositories.find(repository => repository.path === path)?.name ?? null;
			try {
				const result = await engine.removeRepository(path);
				switch (result.outcome) {
					case "removed":
						// The engine forgot the repository's collapsed group and dismissed setup prompt along with it.
						if (savedLayout) savedLayout = forgetRepository(savedLayout, path);
						// The engine dropped its "Skip pull confirmation" too, so a Save of the Pull section cannot write it back.
						update({
							notice: null,
							layout: forgetRepository(state.layout, path),
							preferences: { ...state.preferences, pull: forgetPullRepository(state.preferences.pull, path) },
							// The engine dropped its default agent and its icon in the same save.
							repositoryAgents: state.repositoryAgents && forgetRepositoryAgent(state.repositoryAgents, path),
							sidebarIcons: withIcon(state.sidebarIcons, { kind: "repository", path }, null),
						});
						await reloadAll("all");
						showToast(describeRemoved(name ?? folderName(path)));
						return;
					case "overridden":
						update({ notice: { kind: "overridden" } });
						return;
					case "failed":
						update({ notice: { kind: "failed", action: "remove", message: result.message } });
						return;
				}
			} catch (error) {
				update({ notice: { kind: "failed", action: "remove", message: messageOf(error) } });
			}
		});
	}

	function openPalette(): void {
		if (state.dialog === null && state.quitRequest === null && timberReady(state)) update({ dialog: { kind: "palette" } });
	}

	function closePalette(): void {
		if (state.dialog?.kind === "palette") update({ dialog: null });
	}

	function moveRepository(path: string, index: number): Promise<void> {
		const before = state.repositories.map(repository => repository.path);
		const order = moveInOrder(before, path, index);
		if (order.every((candidate, at) => candidate === before[at])) return Promise.resolve();
		const ticket = ++orderTicket;
		pendingOrder = order;
		update({ notice: null, repositories: applyOrder(state.repositories, order) });

		const save = async () => {
			// A later move is already on screen and will save itself.
			if (ticket !== orderTicket) return;
			let failure: AppState["notice"] = null;
			try {
				const result = await engine.reorderRepositories(order);
				if (result.outcome === "overridden") failure = { kind: "overridden" };
				if (result.outcome === "failed") failure = { kind: "failed", action: "reorder", message: result.message };
			} catch (error) {
				failure = { kind: "failed", action: "reorder", message: messageOf(error) };
			}
			if (ticket !== orderTicket) return;
			pendingOrder = null;
			if (failure) {
				update({ notice: failure });
				// Read the list again, so it shows the order that is saved.
				await reloadAll("all");
			}
		};
		orderSaves = orderSaves.then(save);
		return orderSaves;
	}

	/**
	 * Ask the engine for a change to the groups, after every move and group change asked for before it, so each
	 * builds on what the last one saved. `order` is the whole new order when the change shows a new one at once,
	 * and `before` the order to put back if it fails. Answers whether it was saved.
	 */
	function changeGroups(call: () => Promise<RepositoryGroupsResult>, shown: { order: string[]; before: string[] } | null, onSaved?: (groups: RepositoryGroups) => void, moving = false): Promise<boolean> {
		const ticket = shown ? ++orderTicket : orderTicket;
		if (shown) pendingOrder = shown.order;
		groupChanges++;
		const run = orderSaves.then(async () => {
			let result: RepositoryGroupsResult;
			try {
				result = await call();
			} catch (error) {
				result = { outcome: "failed", message: messageOf(error) };
			}
			groupChanges--;
			if (shown && ticket === orderTicket) pendingOrder = null;
			switch (result.outcome) {
				case "saved":
					savedGroups = result.groups;
					// A later change already on screen answers for itself.
					if (groupChanges === 0 || !shown) update({ repositoryGroups: result.groups });
					if (state.groupNameProblem) update({ groupNameProblem: null });
					onSaved?.(result.groups);
					return true;
				case "name-empty":
					update({ groupNameProblem: { kind: "empty" } });
					return false;
				case "name-taken":
					// A move has no name field to say it under, so the sidebar's notice says it.
					if (moving) update({ notice: { kind: "group-refused", reason: "name-taken", name: result.name }, repositoryGroups: savedGroups });
					else update({ groupNameProblem: { kind: "taken", name: result.name } });
					return false;
				case "inside-itself":
				case "too-deep":
					// Only when the groups changed on the way, as checked before asking.
					update({ notice: { kind: "group-refused", reason: result.outcome }, repositoryGroups: savedGroups });
					return false;
				case "overridden":
				case "failed":
					// Put back what is saved, without reading anything again.
					update({
						notice: result.outcome === "overridden" ? { kind: "overridden" } : { kind: "failed", action: "group", message: result.message },
						repositoryGroups: savedGroups,
						...(shown ? { repositories: applyOrder(state.repositories, shown.before) } : {}),
					});
					return false;
			}
		});
		orderSaves = run.then(() => {}, () => {});
		return run;
	}

	const pathsOnScreen = () => state.repositories.map(repository => repository.path);

	/** Show a repository in its new group and the list in its new order at once, then save both. */
	function showPlaced(path: string, group: string | null, order: string[]): Promise<void> {
		const before = pathsOnScreen();
		const membership = { ...state.repositoryGroups.membership };
		if (group === null) delete membership[path];
		else membership[path] = group;
		const unchanged = order.every((candidate, at) => candidate === before[at]) && state.repositoryGroups.membership[path] === membership[path];
		if (unchanged) return Promise.resolve();
		update({ notice: null, repositories: applyOrder(state.repositories, order), repositoryGroups: { ...state.repositoryGroups, membership } });
		return changeGroups(() => engine.placeRepository(path, group, order), { order, before }).then(() => {});
	}

	function placeRepository(path: string, group: string | null, before: string | null = null): Promise<void> {
		if (group !== null && !state.repositoryGroups.groups.some(known => known.id === group)) return Promise.resolve();
		const order = placeInOrder(pathsOnScreen(), state.repositoryGroups, path, group, before);
		return order ? showPlaced(path, group, order) : Promise.resolve();
	}

	function stepRepository(path: string, step: -1 | 1): Promise<void> {
		const order = stepAmongSiblings(pathsOnScreen(), state.repositoryGroups, path, step);
		if (!order) return Promise.resolve();
		const group = state.repositoryGroups.membership[path];
		return showPlaced(path, group !== undefined && state.repositoryGroups.groups.some(known => known.id === group) ? group : null, order);
	}

	function createGroup(name: string, repository?: string, parent?: string): Promise<boolean> {
		return changeGroups(() => engine.createRepositoryGroup(name, repository, parent), null, groups => {
			// The engine put the repository at the end of the shown order; so does the screen.
			if (repository !== undefined) update({ repositories: applyOrder(state.repositories, shownOrder(pathsOnScreen(), groups)) });
		});
	}

	function moveGroup(id: string, parent: string | null, before: string | null): Promise<void> {
		const moved = moveGroupAmong(state.repositoryGroups.groups, id, parent, before);
		switch (moved.outcome) {
			case "unchanged":
				return Promise.resolve();
			case "inside-itself":
			case "too-deep":
				update({ notice: { kind: "group-refused", reason: moved.outcome } });
				return Promise.resolve();
			case "name-taken":
				update({ notice: { kind: "group-refused", reason: "name-taken", name: moved.name } });
				return Promise.resolve();
			case "changed": {
				update({ notice: null, repositoryGroups: { ...state.repositoryGroups, groups: moved.groups } });
				const paths = pathsOnScreen();
				return changeGroups(() => engine.moveRepositoryGroup(id, parent, before), { order: paths, before: paths }, undefined, true).then(() => {});
			}
		}
	}

	function stepGroup(id: string, step: -1 | 1): Promise<void> {
		const target = stepGroupAmongSiblings(state.repositoryGroups.groups, id, step);
		return target ? moveGroup(id, target.parent, target.before) : Promise.resolve();
	}

	function deleteGroup(id: string): Promise<void> {
		return changeGroups(() => engine.deleteRepositoryGroup(id), null, () => {
			// The engine forgot that it was folded in the same save, so the layout needs no save of its own here.
			if (savedLayout) savedLayout = forgetGroup(savedLayout, id);
			const layout = forgetGroup(state.layout, id);
			if (layout !== state.layout) update({ layout });
			// And its icon.
			update({ sidebarIcons: withIcon(state.sidebarIcons, { kind: "group", id }, null) });
		}).then(() => {});
	}

	async function setSidebarIcon(target: IconTarget, choice: IconChoice | null): Promise<SidebarIconResult> {
		let result: SidebarIconResult;
		iconChanges++;
		try {
			result = await engine.setSidebarIcon(target, choice);
		} catch (error) {
			return { outcome: "failed", message: messageOf(error) };
		} finally {
			iconChanges--;
			iconAnswers++;
		}
		if (result.outcome === "saved") update({ sidebarIcons: result.icons });
		return result;
	}

	function select(worktreeId: string): void {
		const selection = selectionFor(state.repositories, worktreeId);
		if (!selection) return;
		// Choosing a worktree puts the issues board away, even the worktree that was selected under it.
		if (selection.worktree !== state.selection?.worktree) update({ selection, board: null, noteInView: null });
		else if (state.board !== null) update({ board: null });
	}

	const boardOf = (repository: string): IssueBoard => state.issueBoards[repository] ?? emptyBoard();
	const changeBoard = (repository: string, change: (board: IssueBoard) => IssueBoard) =>
		update({ issueBoards: { ...state.issueBoards, [repository]: change(boardOf(repository)) } });

	/**
	 * Read one list onto the board. `back` is the list shown before a toggle
	 * was turned to this one: when this one turns out not to be set up, the
	 * board comes back to it, and it is remembered again.
	 */
	async function listOnBoard(repository: string, tracker: IssueTracker, list: IssueList, back: IssueList | null = null): Promise<void> {
		const key = boardKey(tracker, list);
		if (boardOf(repository).reading.includes(key)) return;
		changeBoard(repository, board => withReading(board, key));
		let result: IssueListResult;
		try {
			result = await engine.listIssues({ repository, list, tracker });
		} catch (error) {
			result = { ok: false, unsupported: false, message: unheard("the issue list", error) };
		}
		// Kept under its own tracker and list, so an answer that comes late never shows on another list.
		const before = boardView(boardOf(repository), state.layout.issueLists[repository]);
		changeBoard(repository, board => withRead(board, key, { result, at: Date.now() }));
		let after = boardView(boardOf(repository), state.layout.issueLists[repository]);
		if (back !== null && before.list === list && after.list !== list && state.layout.issueLists[repository] === list && !after.hidden.includes(back)) {
			changeLayout(chooseIssueList(state.layout, repository, back));
			void saveLayout("layout");
			after = boardView(boardOf(repository), state.layout.issueLists[repository]);
		}
		// The list shown changed: a list that turned out not to be set up leaves, or a sprint set up again brings both sprint lists back.
		// The new one is read when it never was, or when its own answer still says it is not set up.
		const stale = after.latest === null || (after.latest.result.ok && after.latest.result.outcome === "failed" && after.latest.result.reason === "not-configured");
		if (after.list !== null && after.list !== before.list && after.tracker === tracker && stale) {
			await listOnBoard(repository, after.tracker, after.list);
		}
	}

	async function refreshBoard(repository: string): Promise<void> {
		if (boardOf(repository).reading.includes("trackers")) return;
		changeBoard(repository, board => withReading(board, "trackers"));
		let trackers: IssueBoard["trackers"];
		try {
			trackers = await engine.readIssueTrackers(repository);
		} catch (error) {
			trackers = { ok: false, message: unheard("the issue trackers", error) };
		}
		// A read that failed keeps the trackers read before, so the last list stays on screen.
		changeBoard(repository, board => ({ ...board, trackers: !trackers.ok && board.trackers?.ok ? board.trackers : trackers, reading: board.reading.filter(key => key !== "trackers") }));
		const board = boardOf(repository);
		const view = boardView(board, state.layout.issueLists[repository]);
		if (view.tracker === null) return;
		const tracker = view.tracker;
		await Promise.all(listsToRead(board, state.layout.issueLists[repository]).map(list => listOnBoard(repository, tracker, list)));
	}


	/** Select the worktree a Timber command reported, when the list that was just read has it. */
	/** The listed worktree Timber reported. By identity first: the registered path stands in when Timber could verify the folder in only one of the two reads. */
	function listedReported(repositoryPath: string, reported: ReportedWorktree): Worktree | undefined {
		const repository = state.repositories.find(candidate => candidate.path === repositoryPath);
		return repository?.worktrees.find(candidate => candidate.id === reported.id)
			?? repository?.worktrees.find(candidate => candidate.path === reported.path);
	}

	function selectReported(repositoryPath: string, reported: ReportedWorktree): void {
		const worktree = listedReported(repositoryPath, reported);
		if (worktree) select(worktree.id);
	}

	/**
	 * One Timber command that works on a repository's worktrees. The command is
	 * asked for once. The repository is read again after every outcome,
	 * because even a failure can leave a new worktree behind.
	 */
	async function runWorktreeCommand(repository: string, ask: () => Promise<WorktreeCommandResult>): Promise<WorktreeCommandResult> {
		let result: WorktreeCommandResult;
		try {
			result = await ask();
		} catch (error) {
			const failure = notHeardFailure("how the command ended", error, ". What it did is unknown, so check the list before trying again.");
			result = { outcome: "failed", failure, worktree: null, created: false, setupSkipped: false };
		}
		await reloadOne(repository);
		if (result.outcome !== "cancelled" && result.worktree) selectReported(repository, result.worktree);
		return result;
	}

	async function previewDone(request: DonePreviewRequest): Promise<DonePreviewResult> {
		try {
			return await engine.previewDone(request);
		} catch (error) {
			return { outcome: "failed", failure: { command: null, diagnostic: `The preview did not answer: ${messageOf(error)}`, output: null } };
		}
	}

	/** End every session of a worktree that was removed: its folder is gone, so there is nothing left to work in. */
	function closeTerminalsOf(repositoryPath: string, worktreePath: string): void {
		const repository = state.repositories.find(candidate => candidate.path === repositoryPath);
		const worktree = repository?.worktrees.find(candidate => candidate.path === worktreePath);
		const sessions = worktree ? sessionsOf(state, worktree.id) : state.terminals.filter(candidate => candidate.path === worktreePath && candidate.repository === repositoryPath);
		for (const session of sessions) void closeTerminal(session.id);
	}

	async function applyDone(request: DoneApplyRequest): Promise<DoneApplyResult> {
		// Read before the list is read again, which no longer has the worktree.
		const ending = () => closeTerminalsOf(request.repository, request.path);
		try {
			const result = await engine.applyDone(request);
			if (result.outcome === "removed") ending();
			return result;
		} catch (error) {
			// The command may have run, or may still be running. Only the list can say what is there now.
			const diagnostic = `The removal did not answer, so what it did is unknown: ${messageOf(error)}`;
			return { outcome: "failed", ran: true, failure: { command: null, diagnostic, output: null } };
		} finally {
			await reloadOne(request.repository);
		}
	}

	/** Whether the open dialog is the Done dialog of the worktree at this path, which shows how its removal ends. */
	function doneDialogShows(repository: string, worktree: Worktree): boolean {
		const { dialog } = state;
		if (dialog?.kind !== "done-worktree" || dialog.repository !== repository) return false;
		if (dialog.worktree === worktree.id) return true;
		const listed = state.repositories.find(candidate => candidate.path === repository)?.worktrees.find(candidate => candidate.id === dialog.worktree);
		return listed?.path === worktree.path;
	}

	/** Every removal but the one of the worktree at this registered path in this repository. */
	const removalsBut = (removals: readonly Removal[], repository: string, path: string) =>
		removals.filter(removal => removal.repository !== repository || removal.worktree.path !== path);

	/** Keep a failure as the worktree's record, unless its repository left the list and has nowhere to show it. */
	function recordFailure(repository: string, worktree: Worktree, toast: string, failure: TimberFailure): boolean {
		const listedRepository = state.repositories.find(candidate => candidate.path === repository);
		const gone = !listedRepository?.worktrees.some(candidate => candidate.path === worktree.path);
		const others = removalsBut(state.removals, repository, worktree.path);
		update({ removals: listedRepository ? [...others, { repository, worktree, toast, status: { kind: "failed", failure, gone } }] : others });
		return listedRepository !== undefined;
	}

	async function removeWorktree(request: { repository: string; worktree: Worktree; preview: string; toast: string; announce?: boolean }): Promise<DoneApplyResult | null> {
		const { repository, worktree, preview, toast, announce = true } = request;
		const { path } = worktree;
		if (removalAt(state, repository, path)?.status.kind === "running") return null;
		// The removal goes on in the background, so its Done dialog gets out of the way at once.
		const closing = doneDialogShows(repository, worktree);
		const record: Removal = { repository, worktree, toast, status: { kind: "running" } };
		// A queued one keeps its place, so the sidebar lists a run in its order.
		const queued = removalAt(state, repository, path);
		const removals = queued ? state.removals.map(removal => removal === queued ? record : removal) : [...state.removals, record];
		update({ removals, dialog: closing ? null : state.dialog });
		const result = await applyDone({ repository, path, preview });
		// A Done dialog opened for the worktree meanwhile, such as one for a failure before, shows the end itself.
		const watching = doneDialogShows(repository, worktree);
		if (result.outcome === "removed") {
			update({ removals: removalsBut(state.removals, repository, path), dialog: watching ? null : state.dialog });
			if (announce) showToast(toast);
			return result;
		}
		const kept = recordFailure(repository, worktree, toast, result.failure);
		if (announce && !watching) showToast(describeRemovalFailed(worktreeLabel(worktree), kept), true);
		return result;
	}

	/** The run of Clean up merged in each repository, by its path, so a second run waits for the first. */
	const cleanUps = new Map<string, Promise<void>>();

	type CleanUpItems = readonly { worktree: Worktree; preview: string; shown: DonePreview }[];
	const toastOf = (worktree: Worktree, shown: DonePreview) => describeDone(worktreeLabel(worktree), shown);

	function cleanUpMerged(request: { repository: string; items: CleanUpItems }): Promise<void> {
		const { repository } = request;
		const items = request.items.filter(item => !isBeingRemoved(state, repository, item.worktree.path));
		if (items.length === 0) return Promise.resolve();
		// Queued at once, so their actions are off even while an earlier run in the repository still works.
		const paths = new Set(items.map(item => item.worktree.path));
		update({
			removals: [
				...state.removals.filter(removal => removal.repository !== repository || !paths.has(removal.worktree.path)),
				...items.map((item): Removal => ({ repository, worktree: item.worktree, toast: toastOf(item.worktree, item.shown), status: { kind: "waiting" } })),
			],
		});
		const before = cleanUps.get(repository);
		// With nothing before it, it starts right away, so its first removal shows as running at once.
		const run = before ? before.then(() => runCleanUp(repository, items)) : runCleanUp(repository, items);
		cleanUps.set(repository, run);
		void run.finally(() => {
			if (cleanUps.get(repository) === run) cleanUps.delete(repository);
		});
		return run;
	}

	async function runCleanUp(repository: string, items: CleanUpItems): Promise<void> {
		const queued = new Set(items.map(item => item.worktree.path));
		const name = state.repositories.find(candidate => candidate.path === repository)?.name ?? repository;
		let removed = 0;
		let failed = 0;
		try {
			for (const item of items) {
				const { path } = item.worktree;
				queued.delete(path);
				// The list as it is now, which each removal before this one read again.
				const listedRepository = state.repositories.find(candidate => candidate.path === repository);
				const worktree = listedRepository?.worktrees.find(candidate => candidate.path === path);
				if (!worktree) {
					update({ removals: removalsBut(state.removals, repository, path) });
					continue;
				}
				const toast = toastOf(worktree, item.shown);
				if (runningSessionCount(state, worktree.id) > 0) {
					recordFailure(repository, worktree, toast, { command: null, diagnostic: SESSION_STARTED_DIAGNOSTIC, output: null });
					failed++;
					continue;
				}
				const result = await removeWorktree({ repository, worktree, preview: item.preview, toast, announce: false });
				// Null: a removal of it ran already, which reports for itself.
				if (result?.outcome === "removed") removed++;
				else if (result) failed++;
			}
		} finally {
			// Whatever is still queued, for example after the repository left the list, is not waiting for anything.
			if (queued.size > 0) update({ removals: state.removals.filter(removal => removal.repository !== repository || !queued.has(removal.worktree.path) || removal.status.kind !== "waiting") });
		}
		if (removed + failed > 0) showToast(describeCleanUpEnded(name, removed, failed), failed > 0);
	}

	function dismissRemoval(repository: string, path: string): void {
		const removal = removalAt(state, repository, path);
		if (removal?.status.kind === "failed") update({ removals: state.removals.filter(candidate => candidate !== removal) });
	}

	/**
	 * End the terminals of worktrees that a list read in full no longer has,
	 * such as one removed from inside its own terminal, or of a repository
	 * that left the app's list. Nothing could show them anymore. A repository
	 * whose worktrees Timber could not list, or whose folder Git cannot read,
	 * keeps its terminals: that read says nothing about them. A worktree is
	 * matched by its identity or its registered path, because its identity
	 * changes while its folder cannot be verified.
	 */
	function endOrphanTerminals(): void {
		// One toast per worktree, however many of its sessions ran.
		const ended = new Map<string, number>();
		for (const session of state.terminals) {
			const repository = state.repositories.find(candidate => candidate.path === session.repository);
			const listed = repository !== undefined && (!repository.available || repository.failure !== null || repository.worktrees.some(worktree => worktree.id === session.worktree || worktree.path === session.path));
			if (listed || state.operations.some(operation => operation.kind === "close-terminal" && operation.session === session.id)) continue;
			void closeTerminal(session.id);
			if (session.state.kind === "running") ended.set(session.path, (ended.get(session.path) ?? 0) + 1);
		}
		for (const [path, count] of ended) showToast(describeOrphanTerminal(path, count));
	}

	/** Whether Timber is removing the listed worktree with this identity. */
	function removingId(repository: string, worktreeId: string): boolean {
		const worktree = state.repositories.find(candidate => candidate.path === repository)?.worktrees.find(candidate => candidate.id === worktreeId);
		return worktree !== undefined && isBeingRemoved(state, repository, worktree.path);
	}

	/** The worktree a terminal request is tracked under: its identity when the list has it, or else its path. */
	function terminalKey(request: Pick<OpenTerminalRequest, "repository" | "worktree">): string {
		const repository = state.repositories.find(candidate => candidate.path === request.repository);
		return repository?.worktrees.find(candidate => candidate.path === request.worktree)?.id ?? request.worktree;
	}

	/*
	 * Opening the sessions of the last run again (see ./restore.ts and docs/architecture.md, "After a restart"). Once
	 * per store, when the first full list read ended well and the first list of sessions is in. The engine answers
	 * the saved sessions once per run, so a reloaded window opens nothing twice. The selected worktree goes first,
	 * then a few worktrees at a time, the sessions of each one after another, so chips keep their order. Each opens
	 * through the engine's ordinary `openTerminal`, which makes every check. Nothing here waits for it.
	 */
	let restoreAsked = false;
	let terminalsListed = false;
	/** Sessions opened again, and until when their new output is not marked unseen. */
	const quietUntil = new Map<string, number>();

	function restoreOnce(): void {
		if (restoreAsked || !terminalsListed || !state.loaded) return;
		restoreAsked = true;
		Promise.resolve().then(() => engine.takeSavedSessions()).then(saved => {
			if (saved) void restoreSaved(saved);
		}, () => {
			// Nothing to open again: the app starts as it always did.
		});
	}

	interface RestoreFailure { worktree: string; agent: string | null; message: string }

	async function restoreSaved(saved: SavedSessions): Promise<void> {
		if (saved.selected !== undefined && selectionFor(state.repositories, saved.selected)) {
			select(saved.selected);
			wantTerminalFocus(saved.selected);
		}
		const failures: RestoreFailure[] = [];
		// The rest of what was saved and not opened now is kept for the next launch by the engine.
		const gone = goneSavedWorktrees(saved, state.repositories);
		if (gone.length > 0) engine.forgetSavedSessions(gone).catch(() => {
			// Then they are kept, and the next launch skips them again.
		});
		const jobs = restoreJobs(saved, state.repositories);
		await runLimited(jobs.map(job => () => restoreWorktree(job, failures)), RESTORE_CONCURRENCY);
		if (failures.length === 0) return;
		showToast(describeRestoreFailures(failures.length), true);
		const selected = state.selection?.worktree;
		const here = failures.find(failure => failure.worktree === selected);
		if (here) update({ terminalProblem: { worktree: here.worktree, agent: here.agent, message: here.message, command: null } });
	}

	async function restoreWorktree(job: RestoreJob, failures: RestoreFailure[]): Promise<void> {
		const chosen = state.shownSessions[job.worktreeId];
		const opened: (string | null)[] = [];
		for (const [index, saved] of job.sessions.entries()) {
			// Nothing new starts in a folder that is being deleted.
			if (isBeingRemoved(state, job.repository, job.path)) return;
			const agent = saved.kind === "agent" ? saved.agent : null;
			let message: string;
			try {
				// Straight to the engine: the store's own openTerminal would show each new chip and report each problem.
				const result = await engine.openTerminal(restoreRequest(job, saved, index));
				if (result.outcome === "opened") {
					const { session } = result;
					quietUntil.set(session.id, Date.now() + RESTORE_QUIET_MILLISECONDS);
					// The engine reports the session as it changes, and may have reported it ended before this answer: that report is newer.
					const known = state.terminals.some(candidate => candidate.id === session.id);
					update({ terminals: known ? state.terminals : withTerminal(state.terminals, session.id, session), unseenSessions: state.unseenSessions.filter(id => id !== session.id) });
					opened.push(session.id);
					continue;
				}
				message = result.message;
			} catch (error) {
				message = `The app did not hear whether ${agent ?? "the terminal"} started: ${messageOf(error)}`;
			}
			opened.push(null);
			failures.push({ worktree: job.worktreeId, agent, message });
		}
		// The person's own choice of chip meanwhile wins. Otherwise the saved one shows, or the nearest one before it that opened.
		if (state.shownSessions[job.worktreeId] !== chosen) return;
		const shown = opened[pickShown(opened.map((id, index) => id === null ? null : index), job.shown)];
		const exists = shown && state.terminals.some(session => session.id === shown);
		if (exists) update({ shownSessions: { ...state.shownSessions, [job.worktreeId]: shown } });
	}

	/** The request for a session being answered in each worktree, by `terminalKey`. */
	const askingTerminal = new Map<string, Promise<void>>();

	async function openTerminal(request: OpenTerminalRequest): Promise<void> {
		// Nothing new starts in a folder that is being deleted.
		if (isBeingRemoved(state, request.repository, request.worktree)) return;
		const key = terminalKey(request);
		if (state.operations.some(operation => operation.kind === "open-terminal" && operation.worktree === key)) return;
		// What did not start, for the problem shown in the pane: the agent, the workflow whose agent it is, or setup.
		const agent = request.agent ?? (request.workflowAgent ? workflowAgentLabel(request.workflowAgent.workflow) : null)
			?? (request.timberWorktreeSetup ? WORKTREE_SETUP_SESSION_NAME : null);
		const asking = track({ kind: "open-terminal", worktree: key, agent }, async () => {
			let message: string;
			let command: string | null = null;
			try {
				const result = await engine.openTerminal(request);
				if (result.outcome === "opened") {
					const { session } = result;
					update({
						terminals: withTerminal(state.terminals, session.id, session),
						// The new session shows. What it printed while this answer was on its way counts as seen.
						shownSessions: { ...state.shownSessions, [session.worktree]: session.id },
						unseenSessions: state.unseenSessions.filter(id => id !== session.id),
						// Setup that did not start stays reported while the agent beside it starts: only another setup answers it.
						terminalProblem: state.terminalProblem?.worktree === key && (state.terminalProblem.agent !== WORKTREE_SETUP_SESSION_NAME || request.timberWorktreeSetup !== undefined) ? null : state.terminalProblem,
					});
					return;
				}
				message = result.message;
				if ((result.outcome === "not-found" || result.outcome === "failed") && result.command !== undefined) command = result.command;
			} catch (error) {
				message = `The app did not hear whether ${agent ?? "the terminal"} started: ${messageOf(error)}`;
			}
			update({ terminalProblem: { worktree: key, agent, message, command } });
		});
		askingTerminal.set(key, asking);
		try {
			await asking;
		} finally {
			if (askingTerminal.get(key) === asking) askingTerminal.delete(key);
		}
	}

	/**
	 * `openTerminal`, after any request already being answered in that
	 * worktree, instead of being dropped as a second click is: what the New
	 * worktree dialog asks for must start even while another session starts.
	 */
	async function openTerminalInTurn(request: OpenTerminalRequest): Promise<void> {
		for (let busy = askingTerminal.get(terminalKey(request)); busy !== undefined; busy = askingTerminal.get(terminalKey(request))) await busy;
		await openTerminal(request);
	}

	async function rebaseWorktree(request: RebaseRequest): Promise<RebaseResult> {
		let result: RebaseResult;
		try {
			result = await engine.rebaseWorktree(request);
		} catch (error) {
			const diagnostic = `The app did not hear how the rebase ended: ${messageOf(error)}. The engine did not answer, so what it did is unknown. Check the worktree before trying again.`;
			result = { outcome: "failed", ran: true, failure: { command: null, diagnostic, output: null } };
		} finally {
			await reloadOne(request.repository);
		}
		return result;
	}

	async function runSyncAction(request: SyncActionRequest): Promise<SyncActionResult> {
		let result: SyncActionResult;
		try {
			result = await engine.runSyncAction(request);
		} catch (error) {
			const diagnostic = `The app did not hear how the ${request.action} ended: ${messageOf(error)}. The engine did not answer, so what ${request.action === "push" ? "Timber" : "Git"} did is unknown. Check the worktree before trying again.`;
			result = { outcome: "failed", action: request.action, ran: true, failure: { command: null, diagnostic, output: null } };
		} finally {
			await reloadOne(request.repository);
		}
		return result;
	}

	/**
	 * Pull without the dialog, for a worktree whose repository skips it. The
	 * same commands and checks as the dialog's Pull (`runSyncAction`). Worked:
	 * the dialog's toast. Refused or failed: the dialog opens on the outcome,
	 * with Git's words and the commands, unless another dialog is open, which
	 * it would replace: then a toast says what Git said.
	 */
	function pullWithoutAsking(request: Extract<DialogRequest, { kind: "sync-action" }>, worktree: Worktree): boolean {
		const target = syncTargetOf(worktree.sync);
		if (target === null || worktree.sync?.kind !== "tracking") return false;
		const upstream = worktree.sync.upstream;
		const label = worktreeLabel(worktree);
		// The palette closes, as it does for every entry that is not a dialog.
		if (state.dialog?.kind === "palette") update({ dialog: null });
		void track({ kind: "pull-worktree", repository: request.repository, worktree: worktree.path }, async () => {
			const ended = await runSyncAction({ action: "pull", repository: request.repository, worktree: worktree.path, target });
			const told = presentSyncResult("pull", label, upstream, ended);
			if (told.ok) {
				showToast(told.toast, told.problem === true);
				return;
			}
			if (ended.outcome === "done") return;
			// The dialog has nothing to show for a worktree that left the list, so the toast says what Git said then too.
			const free = (state.dialog === null || state.dialog.kind === "palette") && state.quitRequest === null;
			if (free && worktreeOf(request.repository, request.worktree) !== null) update({ dialog: { ...request, ended } });
			else showToast(`${SYNC_ACTION_WORDS.pull.failureTitle} into ${label}. ${told.failure.diagnostic}`, true);
		});
		return true;
	}

	async function setWorktreeBase(request: SetBaseRequest): Promise<SetBaseResult> {
		let result: SetBaseResult;
		try {
			result = await engine.setWorktreeBase(request);
		} catch (error) {
			const diagnostic = `The app did not hear how timber base ended: ${messageOf(error)}. The engine did not answer, so whether the base was saved is unknown. Check the worktree's base before trying again.`;
			result = { outcome: "failed", ran: true, failure: { command: null, diagnostic, output: null } };
		}
		const before = worktreeAt(request.repository, request.worktree)?.base ?? null;
		await reloadOne(request.repository);
		const worktree = worktreeAt(request.repository, request.worktree);
		if (!worktree) return result;
		// When the answer was not heard or not readable, Timber may still have saved a base: the list read again says.
		const saved = result.outcome === "set" || (result.outcome === "failed" && result.ran && (worktree.base?.kind === "assigned" || worktree.base?.kind === "commit") && JSON.stringify(worktree.base) !== JSON.stringify(before));
		if (!saved) return result;
		// The worktree now compares with its base, as if the person had chosen Base there.
		const layout = chooseComparison(state.layout, worktree.id, "base");
		if (layout !== state.layout) {
			changeLayout(layout);
			void saveLayout("layout");
		}
		// A new base is a different list: read it afresh, so nothing of the old one shows under the new header.
		const view = state.changes;
		if (view?.worktree === worktree.id && view.repository === request.repository) {
			update({ changes: { ...view, files: null, more: false, compared: null, problem: null, selected: null, diff: null, unchanged: null } });
			await readChanges(request.repository, worktree.id);
		}
		return result;
	}

	function changeForm(id: string, change: Partial<PullRequestForm>): void {
		const form = state.pullRequestForms[id];
		if (form) update({ pullRequestForms: { ...state.pullRequestForms, [id]: { ...form, ...change } } });
	}

	/** Forget the form of a worktree that left the list, so one made again at that path starts afresh. One that runs is kept until it ends. */
	function forgetGoneForms(): void {
		const listed = new Set(state.repositories.flatMap(repository => repository.worktrees.map(worktree => worktree.id)));
		const forms = Object.entries(state.pullRequestForms);
		const kept = forms.filter(([id, form]) => listed.has(id) || form.running);
		if (kept.length !== forms.length) update({ pullRequestForms: Object.fromEntries(kept) });
		const generations = Object.entries(state.generations);
		const left = generations.filter(([id, runs]) => listed.has(id) || Object.values(runs).some(run => run.running));
		if (left.length !== generations.length) update({ generations: Object.fromEntries(left) });
	}

	/**
	 * Put the last commit's subject in the title, with the form's issue key as
	 * it is when the read answers, unless the person typed one or Timber runs.
	 * Read for `head`, which a later commit replaces. No answer, which is also
	 * what a failed read gives, leaves the title as it is.
	 */
	function readTitle(repository: string, worktree: Worktree): void {
		void (async () => {
			let subject: string | null;
			try {
				subject = await engine.readHeadSubject({ repository, worktree: worktree.path });
			} catch {
				subject = null;
			}
			const now = state.pullRequestForms[worktree.id];
			if (subject !== null && now && now.head === worktree.head && !now.titleEdited && !now.running) {
				changeForm(worktree.id, { subject, title: pullRequestTitleWithKey(subject, worktree.branch, now.titleKey) });
			}
		})();
	}

	function startPullRequestForm(repository: string, worktree: Worktree): void {
		const existing = state.pullRequestForms[worktree.id];
		if (existing) {
			if (existing.titleEdited || existing.running) return;
			// A link attached, changed, or removed: make the title again at once from the subject already read.
			const key = titleKeyOf(worktree.issue);
			if (existing.titleKey !== key) changeForm(worktree.id, { titleKey: key, title: pullRequestTitleWithKey(existing.subject, worktree.branch, key) });
			// A new commit since the title was read: its subject is the better title.
			if (existing.head !== worktree.head) {
				changeForm(worktree.id, { head: worktree.head });
				readTitle(repository, worktree);
			}
			return;
		}
		const form: PullRequestForm = {
			repository,
			worktree: worktree.path,
			head: worktree.head,
			titleKey: titleKeyOf(worktree.issue),
			subject: null,
			title: defaultPullRequestTitle(null, worktree.branch, worktree.issue),
			titleEdited: false,
			body: "",
			base: initialPullRequestBase(worktree.base),
			draft: false,
			reviewers: "",
			running: false,
			failure: null,
			reported: null,
			reviewerFailures: null,
		};
		update({ pullRequestForms: { ...state.pullRequestForms, [worktree.id]: form } });
		readTitle(repository, worktree);
	}

	function editPullRequestForm(worktreeId: string, change: Partial<PullRequestFields>): void {
		const form = state.pullRequestForms[worktreeId];
		if (!form || form.running) return;
		changeForm(worktreeId, { ...change, ...(change.title === undefined ? {} : { titleEdited: true }), failure: null });
	}

	function dismissReviewerFailures(worktreeId: string): void {
		if (state.pullRequestForms[worktreeId]?.reviewerFailures) changeForm(worktreeId, { reviewerFailures: null });
	}

	async function createPullRequest(worktreeId: string, { announce = true, text }: { announce?: boolean; text?: { title: string; body: string } } = {}): Promise<PullRequestCreationView | null> {
		const form = state.pullRequestForms[worktreeId];
		if (!form || form.running) return null;
		changeForm(worktreeId, { running: true, failure: null, reported: null, reviewerFailures: null });
		const { repository, worktree, base, draft, reviewers } = form;
		const { title, body } = text ?? form;
		let result: CreatePullRequestResult;
		try {
			result = await engine.createPullRequest({ repository, worktree, title, body, base: pullRequestBaseFromText(base), draft, reviewers: pullRequestReviewersFromText(reviewers) });
		} catch (error) {
			const failure = notHeardFailure("how timber pr ended", error, ". The engine did not answer, so what it did is unknown.");
			result = { outcome: "failed", ran: true, published: null, failure };
		}
		// Even a failure can come after the push, or after the host opened the pull request.
		if (result.outcome !== "failed" || result.ran) await Promise.all([reloadOne(repository), refreshPullRequests(repository)]);
		const shown = presentPullRequestCreation(result);
		changeForm(worktreeId, { running: false, failure: text === undefined ? shown.failure : null, reported: shown.reported, reviewerFailures: shown.reviewerFailures });
		if (shown.toast && announce) showToast(shown.toast);
		return shown;
	}

	async function restoreBackup(request: BackupRestoreRequest): Promise<BackupRestoreResult> {
		let result: BackupRestoreResult;
		try {
			result = await engine.restoreBackup(request);
		} catch (error) {
			const failure = notHeardFailure("how the restore ended", error, ". What it did is unknown, so check the list before trying again.");
			result = { outcome: "failed", ran: true, failure };
		}
		// Even a restore that failed can leave a worktree behind.
		await reloadOne(request.repository);
		if (result.outcome === "restored") {
			const restored = result.worktree;
			const worktree = state.repositories.find(repository => repository.path === request.repository)?.worktrees.find(candidate => candidate.path === restored);
			if (worktree) select(worktree.id);
		}
		return result;
	}

	async function deleteBackup(request: BackupDeleteRequest): Promise<BackupDeleteResult> {
		let result: BackupDeleteResult;
		try {
			result = await engine.deleteBackup(request);
		} catch (error) {
			const failure = notHeardFailure("how the deletion ended", error, ". What it did is unknown; the list of backups is read again.");
			result = { outcome: "failed", ran: true, failure };
		}
		// At once, not spaced out: the person is looking at the outcome.
		await refreshBackups(request.repository);
		return result;
	}

	async function listArenaPresets(repository: string): Promise<ArenaPresetList> {
		try {
			return await engine.listArenaPresets(repository);
		} catch (error) {
			return { ok: false, message: notHeard("the arena presets", error) };
		}
	}

	async function inspectArena(request: { repository: string; arena: string }): Promise<ArenaInspection> {
		try {
			return await engine.inspectArena(request);
		} catch (error) {
			return { state: "failed", message: notHeard("the comparison", error) };
		}
	}

	async function newArena(request: NewArenaRequest): Promise<NewArenaResult> {
		let result: NewArenaResult;
		try {
			result = await engine.newArena(request);
		} catch (error) {
			const failure = notHeardFailure("how timber arena new ended", error, ". What it did is unknown, so check the list before trying again.");
			result = { outcome: "failed", ran: true, arena: null, failure };
		}
		// Even a failure can leave attempts behind.
		await Promise.all([reloadOne(request.repository), refreshArenas(request.repository)]);
		if (result.outcome !== "created") return result;
		const listed = state.repositories.find(repository => repository.path === request.repository)?.worktrees ?? [];
		const first = listed.find(worktree => worktree.path === result.arena.attempts[0]?.path);
		if (first) {
			update({ tab: "workspace" });
			select(first.id);
		}
		// Each attempt's agent in its own session, one after another, as Timber says to start it. A manual attempt has none.
		for (const attempt of result.arena.attempts) {
			if (attempt.tool === "manual" || attempt.stage !== "ready") continue;
			await openTerminalInTurn({ repository: request.repository, worktree: attempt.path, cols: 80, rows: 24, arenaAttempt: { arena: result.arena.name, attempt: attempt.label } });
		}
		return result;
	}

	async function pickArena(request: PickArenaRequest): Promise<PickArenaResult> {
		let result: PickArenaResult;
		try {
			result = await engine.pickArena(request);
		} catch (error) {
			const failure = notHeardFailure("how timber arena pick ended", error, ". What it did is unknown, so check the list before trying again.");
			result = { outcome: "failed", ran: true, pick: null, failure };
		}
		await Promise.all([reloadOne(request.repository), refreshArenas(request.repository)]);
		return result;
	}

	function startAttemptAgent(request: { repository: string; worktree: string; arena: string; attempt: string }): void {
		const worktree = state.repositories.find(repository => repository.path === request.repository)?.worktrees.find(candidate => candidate.path === request.worktree);
		if (!worktree) return;
		wantTerminalFocus(worktree.id);
		update({ tab: "workspace" });
		select(worktree.id);
		void openTerminal({ repository: request.repository, worktree: worktree.path, cols: 80, rows: 24, arenaAttempt: { arena: request.arena, attempt: request.attempt } });
	}

	function openTerminalIn(repositoryPath: string, worktreePath: string): void {
		const worktree = state.repositories.find(repository => repository.path === repositoryPath)?.worktrees.find(candidate => candidate.path === worktreePath);
		if (!worktree) return;
		// The person asked for this session, so it takes the keyboard once it shows, also from a dialog that just closed.
		wantTerminalFocus(worktree.id);
		update({ tab: "workspace" });
		select(worktree.id);
		// The pane gives the session its real size once it shows.
		void openTerminal({ repository: repositoryPath, worktree: worktree.path, cols: 80, rows: 24 });
	}

	/**
	 * Open the session of a worktree that `timber new` in a terminal handed
	 * over, as the New worktree dialog does: select it, show the Workspace
	 * tab, and start the default agent (the one the repository names, or the
	 * first saved agent found, looked for again now) when Timber wanted its agent, or a shell, with a toast
	 * when the shell opened in place of the agent. The repository is read again first, since the worktree is new.
	 * Only a worktree in the list opens; otherwise a toast says how to open it.
	 * The terminal it was typed in is left alone.
	 */
	async function takeHandoff(handoff: WorktreeHandoff): Promise<void> {
		// The agents are looked for again beside the read, so the default agent is the one there now.
		await Promise.all([
			state.repositories.some(repository => repository.path === handoff.repository) ? reloadOne(handoff.repository) : null,
			handoff.agent ? locateAgents() : null,
		]);
		const worktree = state.repositories.find(repository => repository.path === handoff.repository)?.worktrees.find(candidate => candidate.path === handoff.worktree);
		if (!worktree) {
			showToast(describeHandoffNotListed(handoff), true);
			return;
		}
		const session = handoffSession(handoff, state.preferences.agents, state.agentLocations, repositoryPick(state, handoff.repository));
		if (session.kind === "agent") {
			startSessionsIn(handoff.repository, { id: worktree.id, path: worktree.path, branch: worktree.branch }, { setup: false, agent: { kind: "saved", name: session.agent.name } });
			return;
		}
		openTerminalIn(handoff.repository, worktree.path);
		if (session.toast !== null) showToast(session.toast, true);
	}

	function startSessionsIn(repositoryPath: string, reported: ReportedWorktree, sessions: { setup: boolean; workflow?: string; agent: SessionAgent | null }): boolean {
		const worktree = listedReported(repositoryPath, reported);
		// Not in the list, for example because reading it again failed: there is no pane to start in.
		if (!worktree) return false;
		// The person asked for this session, so it takes the keyboard once it shows, also from a dialog that just closed.
		wantTerminalFocus(worktree.id);
		update({ tab: "workspace" });
		select(worktree.id);
		// The pane gives each session its real size once it shows.
		const request = { repository: repositoryPath, worktree: worktree.path, cols: 80, rows: 24 };
		void (async () => {
			// One request at a time per worktree, so the agent is asked for once the setup session is there. Setup keeps running.
			if (sessions.setup) await openTerminalInTurn({ ...request, timberWorktreeSetup: sessions.workflow === undefined ? {} : { workflow: sessions.workflow } });
			const agent = sessions.agent;
			if (agent !== null) await openTerminalInTurn({ ...request, ...agentRequest(agent) });
		})();
		return true;
	}

	/**
	 * Whether this change stops a Timber session, such as setup, given the
	 * sessions known before it: the session ended, or it was closed while it
	 * ran. What it did shows only in the repositories, never in how it ended.
	 */
	function timberSessionStopped(known: readonly TerminalSession[], change: TerminalChange): boolean {
		const before = known.find(session => session.id === change.id);
		const session = change.session ?? before;
		if (session?.kind !== "timber" || before?.state.kind === "exited") return false;
		return change.session === null || change.session.state.kind !== "running";
	}

	async function closeTerminal(id: string): Promise<void> {
		if (state.operations.some(operation => operation.kind === "close-terminal" && operation.session === id)) return;
		await track({ kind: "close-terminal", session: id }, async () => {
			try {
				await engine.closeTerminal(id);
			} catch {
				// The engine reports the session as gone when it is. Until then it stays, so it can be closed again.
				return;
			}
			update(withoutSession(state, id));
		});
	}

	function showSession(id: string): void {
		const session = state.terminals.find(candidate => candidate.id === id);
		if (!session || state.shownSessions[session.worktree] === id) return;
		update({ shownSessions: { ...state.shownSessions, [session.worktree]: id } });
	}

	function revealSession(id: string): void {
		const session = state.terminals.find(candidate => candidate.id === id);
		const selection = session && selectionFor(state.repositories, session.worktree);
		if (!session || !selection) return;
		wantTerminalFocus(session.worktree);
		// Showing a session puts any issues board away, so the session is what shows.
		update({ selection, board: null, tab: "workspace", shownSessions: { ...state.shownSessions, [session.worktree]: id } });
	}

	function jumpToWaiting(): boolean {
		if (state.dialog !== null || state.quitRequest !== null || !timberReady(state)) return false;
		const next = nextWaitingSession(sessionsToVisit(state), sessionOnScreen(state)?.id ?? null);
		if (next === null) return false;
		revealSession(next);
		return true;
	}

	function stepSession(id: string, step: 1 | -1): void {
		const session = state.terminals.find(candidate => candidate.id === id);
		if (!session) return;
		const siblings = sessionsOf(state, session.worktree);
		const at = siblings.findIndex(candidate => candidate.id === id);
		const next = siblings[(at + step + siblings.length) % siblings.length];
		if (next && next.id !== id) showSession(next.id);
	}

	async function renameTerminal(id: string, name: string): Promise<boolean> {
		try {
			const session = await engine.renameTerminal(id, name);
			if (!session || !state.terminals.some(candidate => candidate.id === id)) return false;
			update({ terminals: withTerminal(state.terminals, id, session) });
			return true;
		} catch {
			return false;
		}
	}

	// Sessions whose parts a pane draws. The engine hears at once about every other part, so it never waits on one.
	const watched = new Map<string, number>();

	function watchTerminal(id: string, draw: (draw: Draw, done: () => void) => void): () => void {
		const feed = createTerminalFeed();
		let watching = true;
		watched.set(id, (watched.get(id) ?? 0) + 1);
		const show = (next: Draw | null) => {
			if (!watching || next === null) return;
			if (next.data === "" && !next.reset) return engine.drawnTerminal(id, next.seq);
			draw(next, () => engine.drawnTerminal(id, next.seq));
		};
		const stop = engine.onTerminalOutput(part => {
			if (part.id === id) show(feed.receive(part));
		});
		engine.readTerminal(id).then(snapshot => show(feed.begin(snapshot)), () => show(feed.begin(null)));
		return () => {
			if (!watching) return;
			watching = false;
			stop();
			const count = (watched.get(id) ?? 1) - 1;
			if (count > 0) watched.set(id, count);
			else watched.delete(id);
		};
	}

	/** Restart into the downloaded update. Never throws. */
	async function installUpdate(request: AppUpdateInstallRequest): Promise<AppUpdateInstallResult> {
		try {
			return await engine.installAppUpdate(request);
		} catch (error) {
			// When it worked the window is gone before this shows, so a lost answer seen here means the app is still open.
			return { outcome: "failed", message: `No answer came back from the update: ${messageOf(error)}. If the app is still open, quit it and start it again.` };
		}
	}

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		start() {
			let heard: TerminalChange[] | null = [];
			const stops = [
				// The main checkout's chops file changed: list them again, if they are on screen.
				engine.onChopsChanged(repository => {
					if (state.chops?.repository === repository) void readChops(repository);
				}),
				engine.onRepositoryChanged(path => {
					// Only a repository on screen can be refreshed. Reload everything to pick up a new one.
					if (state.repositories.some(repository => repository.path === path)) void reloadOne(path);
					// What Git ignores may have changed with it, in folders the watch does not see.
					if (watchedTree !== null && state.fileTree.trees[watchedTree]?.repository === path) readShownFolders(watchedTree);
				}),
				// A folder the file explorer shows changed: read it again, if it still shows.
				engine.onWorktreeFolderChanged(change => {
					const id = watchedTree;
					const tree = id === null ? undefined : state.fileTree.trees[id];
					if (id !== null && tree?.worktree === change.worktree && shownFolders(tree).includes(change.folder)) void readFolder(id, change.folder);
				}),
				engine.onTerminalChanged(change => {
					// Until the first list answers, changes wait, and are applied on top of it.
					if (heard !== null) return void heard.push(change);
					const stopped = timberSessionStopped(state.terminals, change);
					const promptBefore = state.terminals.find(session => session.id === change.id)?.prompt;
					// A hook is checked again when a session of its agent starts, so Settings never shows an old answer.
					const isNew = change.session !== null && !state.terminals.some(session => session.id === change.id);
					if (isNew && change.session?.program !== undefined && hookedAgent(change.session.program) !== null) void loadStatusHooks();
					if (change.session) update({ terminals: withTerminal(state.terminals, change.id, change.session) });
					else update(withoutSession(state, change.id));
					// A new agent's prompt went, or could not: say so, since the person may be looking elsewhere.
					const prompt = change.session?.prompt;
					if (change.session === null) {
						reviewsGiven.delete(change.id);
						reviewHeardEarly.delete(change.id);
						if (startingReview.size > 0) goneWhileStarting.add(change.id);
					}
					if (prompt && promptBefore?.state === "pending" && prompt.state !== "pending") {
						// A new agent's review: settled here, or, while the answer that started it is on its way, once it comes.
						if (prompt.what === "review") {
							const given = reviewsGiven.get(change.id) ?? null;
							if (given !== null || !startingReview.has(change.session!.worktree)) reviewSettled(change.session!, given);
							else reviewHeardEarly.set(change.id, change.session!.worktree);
						} else if (prompt.state === "sent") showToast(describePromptSent(null, change.session!.name));
						else showToast(`The prompt was not sent: ${prompt.message}`, true);
					}
					// What a Timber session such as setup changed shows in the repositories. Read them all again,
					// since how it ended does not say which ones it touched.
					if (stopped) void reloadAll("all");
				}),
				engine.onTerminalOutput(part => {
					if (!watched.has(part.id)) engine.drawnTerminal(part.id, part.seq);
					// A chip marks a session that printed while it was not on screen.
					if (part.data === "" || state.unseenSessions.includes(part.id) || sessionOnScreen(state)?.id === part.id) return;
					// A session opened again after a restart prints as it starts, which is not news.
					const quiet = quietUntil.get(part.id);
					if (quiet !== undefined) {
						if (quiet > Date.now()) return;
						quietUntil.delete(part.id);
					}
					if (state.terminals.some(session => session.id === part.id)) update({ unseenSessions: [...state.unseenSessions, part.id] });
				}),
				engine.onQuitRequested(live => update({ quitRequest: live })),
				engine.onShowSession(id => revealSession(id)),
				engine.onWorktreeHandedOff(handoff => void takeHandoff(handoff)),
				// A newer Timber release came out: ask for the status again, so the banner shows.
				engine.onTimberChanged(() => void findTimber(() => engine.timberStatus())),
				engine.onAppUpdateChanged(next => {
					appUpdateChanges += 1;
					// Another version is on its way, so what Restart to update said about the last one is old.
					update(next.kind === "downloading" ? { appUpdate: next, appUpdateStep: { kind: "offer" } } : { appUpdate: next });
				}),
				engine.onFetchChanged(status => {
					heardFetches.add(status.repository);
					showFetch(status);
				}),
			];
			// What was heard while the first answer was on its way is newer than it.
			const heardFetches = new Set<string>();
			engine.fetchStatuses().then(statuses => {
				const fetches = { ...state.fetches };
				for (const status of statuses) {
					if (!heardFetches.has(status.repository)) fetches[status.repository] = status;
				}
				update({ fetches });
			}, () => {
				// Nothing is known until the next fetch reports itself.
			});
			void loadLayout();
			void loadPreferences();
			void locateAgents();
			void findTimber(() => engine.timberStatus());
			engine.appInfo().then(info => update({ appVersion: info.version, rendering: info.rendering }), () => {
				// About says the version is not known.
			});
			const heardBefore = appUpdateChanges;
			engine.appUpdate().then(next => {
				if (appUpdateChanges === heardBefore) update({ appUpdate: next });
			}, () => {
				// Settings, About can look again.
			});
			// Sessions outlive the window, for example when it reloads. Changes heard meanwhile are newer than this answer.
			const settle = (listed: readonly TerminalSession[]) => {
				let terminals = listed;
				let stopped = false;
				for (const change of heard ?? []) {
					// The list may already hold the session as it ended, so any ending heard meanwhile counts.
					const session = change.session ?? terminals.find(candidate => candidate.id === change.id);
					stopped ||= session?.kind === "timber" && (change.session === null || change.session.state.kind !== "running");
					terminals = withTerminal(terminals, change.id, change.session);
				}
				heard = null;
				update({ terminals, unseenSessions: state.unseenSessions.filter(id => terminals.some(session => session.id === id)) });
				// A Timber session that stopped before the sessions were listed may have changed things after the repositories were read.
				if (stopped) void reloadAll("all");
				terminalsListed = true;
				restoreOnce();
			};
			engine.listTerminals().then(settle, () => settle(state.terminals));
			attending = true;
			attend();
			return () => {
				attending = false;
				for (const stop of stops) stop();
			};
		},
		windowChanged(next) {
			if (next.visible === windowState.visible && next.focused === windowState.focused) return;
			windowState = { visible: next.visible, focused: next.focused };
			// Through `update`, which tells the engine and repaints: the focus coming back may make a status seen.
			update({});
		},
		retryTimber: () => findTimber(() => engine.recheckTimber()),
		refresh,
		reloadRepository: path => reloadOne(path),
		fetchNow,
		addRepository,
		removeRepository,
		moveRepository,
		createGroup,
		renameGroup: (id, name) => changeGroups(() => engine.renameRepositoryGroup(id, name), null),
		deleteGroup,
		setSidebarIcon,
		readRemoteIconSource: path => engine.readRemoteIconSource(path).catch(() => null),
		moveGroup,
		stepGroup,
		placeRepository,
		stepRepository,
		toggleRepositoryGroup(id) {
			changeLayout(toggleGroupCollapsed(state.layout, id));
			void saveLayout("layout");
		},
		clearGroupNameProblem() {
			if (state.groupNameProblem) update({ groupNameProblem: null });
		},
		dismissNotice() {
			if (state.notice) update({ notice: null });
		},
		select,
		openBoard(repository) {
			if (!state.repositories.some(candidate => candidate.path === repository)) return;
			if (state.board !== repository) update({ board: repository });
			void refreshBoard(repository);
		},
		refreshBoard,
		async pickBoardList(repository, list) {
			const shown = boardView(boardOf(repository), state.layout.issueLists[repository]).list;
			const layout = chooseIssueList(state.layout, repository, list);
			if (layout !== state.layout) {
				changeLayout(layout);
				void saveLayout("layout");
			}
			const view = boardView(boardOf(repository), list);
			if (view.tracker !== null && view.list === list) await listOnBoard(repository, view.tracker, list, shown !== list ? shown : null);
		},
		async pickBoardTracker(repository, tracker) {
			changeBoard(repository, board => ({ ...board, picked: tracker }));
			const board = boardOf(repository);
			const view = boardView(board, state.layout.issueLists[repository]);
			if (view.tracker === null) return;
			const shown = view.tracker;
			await Promise.all(listsToRead(board, state.layout.issueLists[repository]).map(list => listOnBoard(repository, shown, list)));
		},
		showToast,
		dismissToast,
		newWorktree: request => runWorktreeCommand(request.repository, () => engine.newWorktree(request)),
		openWorktree: request => runWorktreeCommand(request.repository, () => engine.openWorktree(request)),
		async listBranches(repository) {
			try {
				return await engine.listBranches(repository);
			} catch {
				return null;
			}
		},
		async listWorkflows(repository) {
			try {
				return await engine.listWorkflows(repository);
			} catch (error) {
				return { ok: false, message: unheard("the workflows", error) };
			}
		},
		async readIssueTrackers(repository) {
			try {
				return await engine.readIssueTrackers(repository);
			} catch (error) {
				return { ok: false, message: unheard("the issue trackers", error) };
			}
		},
		async searchIssues(request) {
			try {
				return await engine.searchIssues(request);
			} catch (error) {
				return { ok: false, unsupported: false, message: unheard("the issue search", error) };
			}
		},
		toggleGroup(repository) {
			changeLayout(toggleCollapsed(state.layout, repository));
			void saveLayout("layout");
		},
		resizeSidebar(width) {
			const sidebarWidth = clampSidebarWidth(width);
			if (sidebarWidth !== state.layout.sidebarWidth) changeLayout({ ...state.layout, sidebarWidth });
		},
		toggleChopsPanel: () => toggleSidePanel("chops"),
		toggleSidePanel,
		switchSidePanel(view) {
			if (!canToggleSidePanel(state, view) || !sidePanelShown(state) || sidePanelView(state) === view) return false;
			changeLayout({ ...state.layout, sidePanel: view });
			void saveLayout("layout");
			return true;
		},
		setFolderOpen(worktreeId, folder, open) {
			const tree = state.fileTree.trees[worktreeId];
			if (!tree) return;
			const next = withFolder(tree, folder, open);
			if (next === tree) return;
			changeTree(worktreeId, next);
			if (open) void readFolder(worktreeId, folder);
		},
		toggleIgnoredFiles() {
			update({ fileTree: { ...state.fileTree, showIgnored: !state.fileTree.showIgnored } });
			// Only the worktree on screen is read again now. Another one is read again when it shows (`followFileTree`).
			if (watchedTree !== null) readShownFolders(watchedTree);
		},
		readFoldersAgain: readShownFolders,
		showSidePanel(view) {
			if (!canToggleSidePanel(state, view)) return false;
			if (sidePanelShown(state) && sidePanelView(state) === view) return true;
			changeLayout({ ...state.layout, chopsOpen: true, sidePanel: view });
			void saveLayout("layout");
			return true;
		},
		hideChopsPanel() {
			if (!state.layout.chopsOpen) return;
			changeLayout({ ...state.layout, chopsOpen: false });
			void saveLayout("layout");
		},
		resizeChopsPanel(width) {
			const chopsWidth = clampChopsWidth(width);
			if (chopsWidth !== state.layout.chopsWidth) changeLayout({ ...state.layout, chopsWidth });
		},
		saveLayout: () => saveLayout("layout"),
		dismissLayoutProblem() {
			if (state.layoutProblem) update({ layoutProblem: null });
		},
		savePreferences,
		locateAgents,
		loadStatusHooks,
		installStatusHook: request => changeStatusHook(request, "install"),
		removeStatusHook: request => changeStatusHook(request, "remove"),
		saveChopOrder,
		noteChopRenames(renames) {
			update({ chopRenaming: renames.length === 0 ? null : { renames, list: state.chops?.list ?? null } });
		},
		changeZoom,
		openInEditor,
		dismissEditorProblem() {
			if (state.editorProblem) update({ editorProblem: null });
		},
		showTab(tab) {
			// A worktree's tab is asked for, so the worktree shows in place of any issues board.
			if (tab === "file" && (state.selection === null || state.files[state.selection.worktree] === undefined)) return;
			if (tab === "diff" && (state.selection === null || state.diffs[state.selection.worktree] === undefined)) return;
			if (tab !== state.tab || state.board !== null) update({ tab, board: null });
		},
		closeDiff,
		stepChangedFile,
		toggleViewed,
		setChangesFilter,
		setCommitMessage,
		commitStaged,
		generateCommitMessage,
		generatePullRequestText,
		stopGenerating(worktreeId, kind) {
			const run = state.generations[worktreeId]?.[kind];
			if (run?.running) stopRun(run.id);
		},
		fillHeld(worktreeId, kind) {
			const held = state.generations[worktreeId]?.[kind]?.held;
			if (held) fillGenerated(worktreeId, kind, held);
		},
		dropGenerated(worktreeId, kind) {
			if (state.generations[worktreeId]?.[kind]?.running !== true) changeGeneration(worktreeId, kind, null);
		},
		writePullRequest,
		stopRun,
		openFile,
		readFileAgain,
		closeFile,
		showFileAs: (worktreeId, mode) => changeFile(worktreeId, { mode }),
		editFile,
		changeDraft: (worktreeId, text) => {
			const view = state.files[worktreeId];
			// A file other than Markdown is edited where it shows, so its first change starts the draft.
			if (view && (view.draft !== null || (view.mode === "edit" && canEditFile(view)))) changeFile(worktreeId, { draft: text });
		},
		saveFile,
		discardEdits,
		fileEditMemory,
		answerUnsavedFile,
		readChanges,
		readChops,
		runChop,
		insertChop,
		readPorts,
		selectChangedFile,
		writeIndex,
		discardFiles,
		compareChanges,
		chooseDiffLayout,
		addReviewNote(worktreeId, note) {
			const text = normalizeNoteText(note.text);
			const problem = noteProblem(text);
			if (problem !== null) return problem;
			if (note.lines.length === 0) return "Choose the lines the note is on.";
			const kept: ReviewNote = { ...note, text, lines: note.lines.map(line => ({ ...line })), id: `note-${++lastNote}`, outdated: false };
			changeNotes(worktreeId, [...(state.reviews[worktreeId] ?? []), kept]);
			return null;
		},
		editReviewNote(worktreeId, id, edited) {
			const notes = state.reviews[worktreeId] ?? [];
			if (!notes.some(note => note.id === id)) return "The note is gone.";
			const text = normalizeNoteText(edited);
			const problem = noteProblem(text);
			if (problem !== null) return problem;
			changeNotes(worktreeId, notes.map(note => note.id === id ? { ...note, text } : note));
			return null;
		},
		deleteReviewNote(worktreeId, id) {
			const notes = state.reviews[worktreeId];
			if (notes?.some(note => note.id === id)) changeNotes(worktreeId, notes.filter(note => note.id !== id));
		},
		discardReview(worktreeId) {
			if (state.reviews[worktreeId]) changeNotes(worktreeId, []);
		},
		showReviewNote,
		reviewNoteShown() {
			if (state.noteInView) update({ noteInView: null });
		},
		prepareReview,
		async sendReview(worktreeId, sessionId, message) {
			const session = state.terminals.find(candidate => candidate.id === sessionId);
			// Only an agent of the worktree the review is about gets it.
			if (!session || session.worktree !== worktreeId || session.kind !== "agent") return { outcome: "not-agent", message: "That session is not an agent of this worktree." };
			let result: PasteResult;
			try {
				result = await engine.pasteTerminal(sessionId, message);
			} catch (error) {
				// The paste may have gone through: say so, so the review is not pasted twice without a look.
				return { outcome: "gone", message: notHeard("back about the paste", error, ". It may have been pasted: look at the agent before you send it again.") };
			}
			if (result.outcome !== "pasted") return result;
			changeNotes(worktreeId, []);
			if (state.dialog?.kind === "send-review") update({ dialog: null });
			showToast(describeReviewSent(session.name));
			revealSession(sessionId);
			return result;
		},
		async startReviewAgent(worktreeId, message, size) {
			// The default agent, looked for again now: never a missing one ahead of one that is there.
			if (state.preferences.agents.length > 0) await locateAgents();
			const listed = listedWorktree(worktreeId);
			if (listed === null) return "The worktree is no longer listed.";
			const pick = repositoryPick(state, listed.repository);
			const agent = defaultAgent(state.preferences.agents, state.agentLocations, pick);
			if (agent === null) return noNewReviewAgent(whyNoDefaultAgent(state.preferences.agents, state.agentLocations, pick));
			if (isBeingRemoved(state, listed.repository, listed.worktree.path)) return BEING_REMOVED_REASON;
			if (startingReview.has(worktreeId) || state.operations.some(operation => operation.kind === "open-terminal" && operation.worktree === worktreeId)) {
				return "Another session is starting there. Send the review again in a moment.";
			}
			const waiting = reviewWaiting(state.terminals, worktreeId);
			if (waiting !== null) return reviewAlreadyWaiting(waiting.name);
			// The notes as they are now are the ones the message holds.
			const notes = state.reviews[worktreeId] ?? [];
			let problem: string | null = null;
			startingReview.add(worktreeId);
			try {
				await track({ kind: "open-terminal", worktree: worktreeId, agent: agent.name }, async () => {
					let result: OpenTerminalResult;
					try {
						result = await engine.openTerminal({ repository: listed.repository, worktree: listed.worktree.path, ...size, agent: agent.name, review: message });
					} catch (error) {
						problem = notHeard("back about the new agent", error, ". It may have started: look at the worktree's sessions before you send the review again.");
						return;
					}
					if (result.outcome !== "opened") {
						problem = result.message;
						return;
					}
					// A session closed meanwhile stays gone, and has nothing left to settle.
					if (goneWhileStarting.has(result.session.id)) return;
					// A change heard meanwhile, such as the review being pasted, is newer than this answer.
					const known = state.terminals.find(candidate => candidate.id === result.session.id);
					reviewHeardEarly.delete(result.session.id);
					update({
						terminals: known ? state.terminals : withTerminal(state.terminals, result.session.id, result.session),
						unseenSessions: state.unseenSessions.filter(id => id !== result.session.id),
						...(state.dialog?.kind === "send-review" ? { dialog: null } : {}),
					});
					revealSession(result.session.id);
					const session = known ?? result.session;
					const given = { worktree: worktreeId, notes };
					if (session.prompt?.state === "pending") {
						reviewsGiven.set(session.id, given);
						showToast(describeReviewAgentStarted(session.name));
					} else {
						reviewSettled(session, given);
					}
				});
			} finally {
				startingReview.delete(worktreeId);
				if (startingReview.size === 0) goneWhileStarting.clear();
				// The answer was lost, but the agent was heard: settle what it did with the notes it was given.
				for (const [id, worktree] of reviewHeardEarly) {
					if (worktree !== worktreeId) continue;
					reviewHeardEarly.delete(id);
					const session = state.terminals.find(candidate => candidate.id === id);
					if (session) reviewSettled(session, { worktree: worktreeId, notes });
				}
			}
			return problem;
		},
		async copyReview(message) {
			try {
				await engine.writeClipboard(message);
			} catch {
				return false;
			}
			if (state.dialog?.kind === "send-review") update({ dialog: null });
			showToast(REVIEW_COPIED);
			return true;
		},
		async readTimberSettings(request) {
			try {
				return await engine.readTimberSettings(request);
			} catch (error) {
				return { outcome: "failed", failure: notHeardFailure("back", error) };
			}
		},
		async saveTimberSettings(request) {
			let result: TimberSettingsSaveResult;
			try {
				result = await engine.saveTimberSettings(request);
			} catch (error) {
				return { outcome: "failed", failure: notHeardFailure("back, so whether the settings were saved is unknown", error, ". Read them again before saving.") };
			}
			// Nothing watches Timber's files, so read again what the save may have set up: one repository,
			// or with machine defaults every one. The setup prompt then goes without waiting for the window's focus.
			if (result.outcome === "saved") {
				if (request.scope === "repository" && request.repository !== null) await reloadOne(request.repository);
				else await reloadAll("all");
				// The open Issues board reads its trackers and lists again, so a sprint just set up shows. Another board does so when it opens.
				// A read already running when the save landed is not repeated: Refresh reads again.
				const shown = state.board;
				if (shown !== null && (request.scope === "machine" || shown === request.repository)) void refreshBoard(shown);
			}
			return result;
		},
		async checkTimberConnection(request) {
			try {
				return await engine.checkTimberConnection(request);
			} catch (error) {
				return { outcome: "failed", failure: notHeardFailure("back", error) };
			}
		},
		openDialog(request) {
			// Neither Done, Rebase, nor Set base starts on a worktree that Timber is removing.
			if ((request.kind === "done-worktree" || request.kind === "rebase-worktree" || request.kind === "set-base" || request.kind === "sync-action") && removingId(request.repository, request.worktree)) return;
			if (request.kind === "sync-action" && request.action === "pull" && request.ended === undefined) {
				const worktree = worktreeOf(request.repository, request.worktree);
				if (worktree && syncOptionsOf(state, request.repository, worktree.path).pulling) return;
				if (worktree && !confirmsPull(state.preferences.pull, request.repository) && pullWithoutAsking(request, worktree)) return;
			}
			update({ dialog: request });
		},
		closeDialog() {
			if (state.dialog) update({ dialog: null });
		},
		openPalette,
		closePalette,
		togglePalette() {
			if (state.dialog?.kind === "palette") closePalette();
			else openPalette();
		},
		toggleRunChop() {
			if (state.dialog?.kind === "run-chop") update({ dialog: null });
			else if (state.dialog === null && state.quitRequest === null && chopsEnabled(state)) update({ dialog: { kind: "run-chop" } });
		},
		previewDone,
		applyDone,
		removeWorktree,
		cleanUpMerged,
		dismissRemoval,
		openTerminal,
		startSessionsIn,
		rebaseWorktree,
		runSyncAction,
		setWorktreeBase,
		startPullRequestForm,
		editPullRequestForm,
		createPullRequest,
		dismissReviewerFailures,
		restoreBackup,
		listArenaPresets,
		inspectArena,
		newArena,
		pickArena,
		startAttemptAgent,
		deleteBackup,
		openTerminalIn,
		showSession,
		revealSession,
		jumpToWaiting,
		stepSession,
		renameTerminal,
		closeTerminal,
		watchTerminal,
		writeTerminal: (id, data) => engine.writeTerminal(id, data),
		resizeTerminal: (id, cols, rows) => engine.resizeTerminal(id, cols, rows),
		async copyText(text) {
			try {
				await engine.writeClipboard(text);
			} catch {
				// Nothing was copied. The selection is still there to try again.
			}
		},
		async pasteText() {
			try {
				return await engine.readClipboard();
			} catch {
				return null;
			}
		},
		async openLink(url) {
			try {
				await engine.openLink(url);
			} catch {
				// The link stays in the terminal, to copy instead.
			}
		},
		dismissTerminalProblem() {
			if (state.terminalProblem) update({ terminalProblem: null });
		},
		dismissSetup(repository) {
			changeLayout(dismissSetup(state.layout, repository));
			void saveLayout("layout");
		},
		async exportTheme(theme) {
			try {
				return await engine.exportTheme(theme);
			} catch (error) {
				return { outcome: "failed", message: messageOf(error) };
			}
		},
		async importTheme() {
			try {
				return await engine.importTheme();
			} catch (error) {
				return { outcome: "refused", file: "", reason: messageOf(error) };
			}
		},
		async chooseSoundFile() {
			try {
				return await engine.chooseSoundFile();
			} catch (error) {
				return { outcome: "refused", message: messageOf(error) };
			}
		},
		async playSound(choice) {
			try {
				return await engine.playSound(choice);
			} catch {
				return { outcome: "failed" };
			}
		},
		async uninstallPlan() {
			try {
				return await engine.uninstallPlan();
			} catch (error) {
				return { available: false, reason: `Could not check whether this copy can be uninstalled: ${messageOf(error)}` };
			}
		},
		async uninstall(request) {
			try {
				return await engine.uninstall(request);
			} catch (error) {
				// The uninstaller may have run all the same. The section says to look before trying again.
				return { outcome: "failed", message: `No answer came back from the uninstaller: ${messageOf(error)}` };
			}
		},
		async restartPlan() {
			try {
				return await engine.restartPlan();
			} catch (error) {
				return { available: false, reason: `Could not check whether the app can restart itself: ${messageOf(error)}` };
			}
		},
		async restart() {
			try {
				return await engine.restart();
			} catch (error) {
				// When the restart worked the window is gone before this shows, so a lost answer seen here means the app is still open.
				return { outcome: "failed", message: `No answer came back from the restart: ${messageOf(error)}. If the app is still open, quit it and start it again.` };
			}
		},
		async checkForAppUpdate() {
			const heardBefore = appUpdateChanges;
			try {
				const next = await engine.checkForAppUpdate();
				// A change heard while the answer was on its way is newer than it.
				if (appUpdateChanges === heardBefore) update({ appUpdate: next });
			} catch (error) {
				update({ appUpdate: { kind: "failed", stage: "check", message: `No answer came back from the look: ${messageOf(error)}.` } });
			}
		},
		installAppUpdate: installUpdate,
		async restartForUpdate(endSessions) {
			const live = liveTerminalCount(state.terminals);
			// Unsaved edits are lost with the restart too, so they are asked about as running sessions are.
			if ((live > 0 || unsavedFileCount(state.files) > 0) && !endSessions) {
				update({ appUpdateStep: { kind: "confirm", live } });
				return;
			}
			update({ appUpdateStep: { kind: "restarting" } });
			const result = await installUpdate({ endSessions });
			update({ appUpdateStep: installStepOf(result) });
		},
		cancelUpdateRestart() {
			update({ appUpdateStep: { kind: "offer" } });
		},
		appUpdateLater() {
			if (state.appUpdate.kind === "ready") update({ appUpdateLater: state.appUpdate.version });
		},
		async confirmQuit() {
			update({ quitRequest: null });
			try {
				await engine.confirmQuit();
			} catch {
				// The app is quitting, or did not hear the answer. Quitting again asks again.
			}
		},
		cancelQuit() {
			if (state.quitRequest !== null) update({ quitRequest: null });
		},
	};
}
