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
import type { WorktreeHandoff } from "../../shared/handoff";
import type { FetchResult, ForcePushSeen, RepositoryFetch } from "../../shared/git-fetch";
import { type ChopList, type RunChopResult, commandChops, findListedChop, listedChops } from "../../shared/chops";
import { promptTarget } from "../agent-sessions";
import { describePromptCopied, describePromptSent } from "../chop-format";
import { type Comparison, type FileChangeTarget, type FileChangesResult, type FileDiff, type FileDiffResult, sameFileChange } from "../../shared/file-changes";
import type { PortsResult } from "../../shared/ports";
import { type Layout, chooseComparison, chooseIssueList, chosenComparison, clampSidebarWidth, dismissSetup, forgetGroup, forgetRepository, sameLayout, toggleCollapsed, toggleGroupCollapsed } from "../../shared/layout";
import type { BranchSuggestion, NewWorktreeRequest, OpenInEditorRequest, OpenInEditorResult, OpenWorktreeRequest, RepositoryGroupsResult, ReportedWorktree, SavePreferencesResult, TimberFailure, TimberStatus, Worktree, WorktreeCommandResult } from "../../shared/model";
import { type Preferences, defaultPreferences } from "../../shared/preferences";
import type { IssueLookup } from "../../shared/issues";
import type { BackupDeleteRequest, BackupDeleteResult, BackupList, BackupRestoreRequest, BackupRestoreResult } from "../../shared/backups";
import type { ArenaInspection, ArenaList, ArenaPresetList, NewArenaRequest, NewArenaResult, PickArenaRequest, PickArenaResult } from "../../shared/arenas";
import type { PullRequestList } from "../../shared/pull-requests";
import { applyOrder, moveInOrder } from "../../shared/repository-order";
import { type RepositoryGroups, emptyGroups, placeInOrder, shownOrder, stepAmongSiblings } from "../../shared/repository-groups";
import { type ZoomStep, stepZoom, zoomLabel } from "../../shared/zoom";
import type { Theme } from "../../shared/theme";
import type { ChooseSoundResult, SoundChoice, SoundOutcome } from "../../shared/sound-setting";
import type { ExportThemeResult, ImportThemeResult } from "../../shared/theme-file";
import { type OpenTerminalRequest, type PasteResult, type TerminalChange, type TerminalSession, WORKTREE_SETUP_SESSION_NAME } from "../../shared/terminal";
import { type ReviewNote, buildReviewMessage, markOutdated, normalizeNoteText, notedFiles, noteProblem } from "../../shared/review";
import { REVIEW_COPIED, describeReviewSent } from "../review-format";
import type { TimberConnectionCheckRequest, TimberConnectionCheckResult, TimberSettingsReadResult, TimberSettingsRequest, TimberSettingsSaveRequest, TimberSettingsSaveResult } from "../../shared/timber-config";
import type { DoneApplyRequest, DoneApplyResult, DonePreview, DonePreviewRequest, DonePreviewResult } from "../../shared/timber-done";
import type { RebaseRequest, RebaseResult } from "../../shared/timber-rebase";
import { type CreatePullRequestResult, initialPullRequestBase, pullRequestBaseFromText, pullRequestReviewersFromText } from "../../shared/timber-pr";
import { type PullRequestFields, defaultPullRequestTitle, presentPullRequestCreation, pullRequestTitleWithKey, titleKeyOf } from "../pull-request-create-format";
import type { WorkflowList } from "../../shared/workflows";
import type { IssueTrackers } from "../../shared/issue-trackers";
import { type Draw, createTerminalFeed } from "../terminal-feed";
import { describeOrphanTerminal, describeRestoreFailures, liveTerminalCount } from "../terminal-format";
import { installStepOf } from "../app-update-format";
import { BEING_REMOVED_REASON, describeDone, describeRemovalFailed } from "../done-format";
import { SESSION_STARTED_DIAGNOSTIC, describeCleanUpEnded } from "../clean-up-format";
import { listedOrder } from "../changes-format";
import { describeOpenedInEditor } from "../editor-format";
import { HANDOFF_NO_AGENT, describeHandoffNotListed, handoffAgent } from "../handoff-format";
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
import {
	type AppState, type ChangesView, type DialogRequest, type Operation, type PullRequestForm, type Removal, type SessionAgent, type WorkspaceTab, TOAST_MILLISECONDS, initialState, isBeingRemoved, keepLastGood,
	reconcileRemovals, removalAt, reconcileSelection, runningSessionCount, selectedWorktree, selectionFor, selectionForRepository, sessionOnScreen, sessionsOf, sessionsToVisit, shownSession, timberReady, withTerminal, withoutSession } from "./state";

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
	/** Make a group at the end, with `repository` in it when given. True when it was saved. */
	createGroup(name: string, repository?: string): Promise<boolean>;
	/** Give a group a new name. True when it was saved, or there was nothing to change. */
	renameGroup(id: string, name: string): Promise<boolean>;
	/** Delete a group. Its repositories stay in the list, loose. */
	deleteGroup(id: string): Promise<void>;
	/** Move a group to `index` among the groups, counted without it. Shows at once. */
	moveGroup(id: string, index: number): Promise<void>;
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
	 * failed save with the reason.
	 */
	savePreferences(change: Partial<Preferences>): Promise<SavePreferencesResult>;
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
	/** Show one of the views of the selected worktree. */
	showTab(tab: WorkspaceTab): void;
	/**
	 * Read the changed files of a worktree, named by the path of its
	 * repository and its identity, into `changes`, and then the diff of the
	 * selected file: the one selected before when it is still listed,
	 * otherwise the first. Another worktree starts the view afresh. The
	 * latest read wins. Never throws.
	 */
	readChanges(repository: string, worktreeId: string): Promise<void>;
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
	 * agent in a toast. Never throws.
	 */
	runChop(repository: string, worktreeId: string, chop: string, size: { cols: number; rows: number }, approve?: string, target?: { session: string | null }): Promise<void>;
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
	/** Select a file of `changes` and read its diff. Never throws. */
	selectChangedFile(file: FileChangeTarget): Promise<void>;
	/**
	 * Compare the worktree of `changes` with its base or with its last commit,
	 * remember that for the worktree in the layout, and read the files again.
	 * Never throws.
	 */
	compareChanges(compare: Comparison): Promise<void>;
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
	 * Show the file and lines of a note in the Changes tab of the worktree it
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
	/** Open a dialog over the window, in place of the one that is open. */
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
	 * push, so the tab shows a created pull request as soon as GitHub lists
	 * it. Created: a toast. Already open: a note above it. Reviewers Timber
	 * could not request stay in the form under either, until put away or the
	 * next run. Refused or failed: the failure stays in the form for a retry.
	 * Never throws.
	 */
	createPullRequest(worktreeId: string): Promise<void>;
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

	function update(change: Partial<AppState>): void {
		const shownBefore = sessionOnScreen(state)?.id ?? null;
		const terminalsBefore = state.terminals;
		state = { ...state, ...change };
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

	/** The saved groups, read beside the list. They come from the settings, so this is no second read of a repository. */
	const readGroups = () => engine.listRepositoryGroups().catch(() => null);

	const reloadAll = mergeOverlapping<"all">(() => track({ kind: "reload-all" }, async () => {
		const ticket = ++lastTicket;
		try {
			const [listed, groups] = await Promise.all([engine.listRepositories(), readGroups()]);
			if (groups && groupChanges === 0) {
				savedGroups = groups;
				update({ repositoryGroups: groups });
			}
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
	 * Pull requests come from GitHub through Timber, so they are read as often
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

	async function savePreferences(change: Partial<Preferences>): Promise<SavePreferencesResult> {
		const ticket = ++lastPreferenceTicket;
		let result: SavePreferencesResult;
		try {
			result = await engine.savePreferences(change);
		} catch (error) {
			result = { outcome: "failed", message: messageOf(error) };
		}
		if (result.outcome === "saved" && ticket > shownPreferenceTicket) {
			shownPreferenceTicket = ticket;
			preferencesSaved = true;
			update({ preferences: result.preferences, preferencesProblem: null });
		}
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

	async function readDiff(view: ChangesView, file: FileChangeTarget, worktreePath: string): Promise<void> {
		const ticket = ++diffTicket;
		let answer!: FileDiffResult;
		await track({ kind: "read-diff", worktree: view.worktree }, async () => {
			try {
				answer = await engine.readFileDiff({ repository: view.repository, worktree: worktreePath, compare: view.compared ?? "uncommitted", file });
			} catch (error) {
				answer = { outcome: "failed", message: unheard(`the changes of ${file.path}`, error) };
			}
		});
		if (answer.outcome === "read" && view.compared !== null) markNotes(view.worktree, view.compared, file, answer.diff);
		const now = state.changes;
		if (ticket !== diffTicket || now?.worktree !== view.worktree || now.selected === null || !sameFileChange(now.selected, file)) return;
		update({ changes: { ...now, diff: answer } });
	}

	/** Mark the notes on a file outdated when its diff, read again, no longer has their lines as they were. */
	function markNotes(worktreeId: string, comparison: Comparison, file: FileChangeTarget, diff: FileDiff): void {
		const notes = state.reviews[worktreeId];
		if (!notes) return;
		const marked = markOutdated(notes, comparison, file, diff);
		if (marked !== notes) update({ reviews: { ...state.reviews, [worktreeId]: marked } });
	}

	let lastNote = 0;
	function changeNotes(worktreeId: string, notes: readonly ReviewNote[]): void {
		const { [worktreeId]: _gone, ...others } = state.reviews;
		update({ reviews: notes.length > 0 ? { ...others, [worktreeId]: notes } : others });
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
			await Promise.all(notedFiles(notes).map(async ({ comparison, file }) => {
				try {
					const answer = await engine.readFileDiff({ repository: found.repository, worktree: found.worktree.path, compare: comparison, file });
					if (answer.outcome === "read") markNotes(worktreeId, comparison, file, answer.diff);
				} catch {
					// Not heard: the note stays as it was.
				}
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
		update({ noteInView: { worktree: worktreeId, id } });
		await selectChangedFile(note.file);
		return note.outdated ? "Its lines changed or left the diff since the note, so they may not show." : null;
	}

	function worktreeOf(repositoryPath: string, worktreeId: string) {
		return state.repositories.find(candidate => candidate.path === repositoryPath)?.worktrees.find(candidate => candidate.id === worktreeId) ?? null;
	}

	async function readChanges(repositoryPath: string, worktreeId: string): Promise<void> {
		const worktree = worktreeOf(repositoryPath, worktreeId);
		if (!worktree) return;
		const ticket = ++changesTicket;
		if (state.changes?.worktree !== worktreeId || state.changes.repository !== repositoryPath) {
			update({ changes: { repository: repositoryPath, worktree: worktreeId, files: null, more: false, compared: null, base: null, problem: null, selected: null, diff: null } });
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
		const kept = view.selected === null ? undefined : answer.files.find(file => sameFileChange(file, view.selected!));
		const chosen = kept ?? listedOrder(answer.files)[0] ?? null;
		const selected = chosen && { area: chosen.area, path: chosen.path, previousPath: chosen.previousPath };
		// The same file keeps its diff on screen until the new one answers, so it does not flicker.
		const sameComparison = view.compared === answer.compared;
		const next: ChangesView = { ...view, files: answer.files, more: answer.more, compared: answer.compared, base: answer.base, problem: null, selected, diff: kept && sameComparison ? view.diff : null };
		update({ changes: next });
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

	/** Put a prompt chop's text, as listed, on the clipboard. */
	async function copyPrompt(repositoryPath: string, name: string): Promise<void> {
		const list = state.chops?.repository === repositoryPath ? state.chops.list : null;
		const chop = findListedChop(listedChops(list), name);
		if (chop === null || chop.kind !== "prompt") {
			showToast(`No prompt chop called "${name}" is listed for this repository now.`, true);
			return;
		}
		try {
			await engine.writeClipboard(chop.text);
		} catch {
			showToast(`${chop.name} could not be put on the clipboard.`, true);
			return;
		}
		showToast(describePromptCopied(chop.name));
	}

	/** Send a prompt chop to a running agent session, which shows once it went. */
	async function sendPromptChop(repositoryPath: string, worktreeId: string, worktreePath: string, name: string, size: { cols: number; rows: number }, session: string, approve?: string): Promise<void> {
		let result: RunChopResult;
		try {
			result = await engine.runChop({ repository: repositoryPath, worktree: worktreePath, chop: name, ...size, session, ...(approve === undefined ? {} : { approve }) });
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
			if (state.dialog === null || state.dialog.kind === "palette") update({ dialog: { kind: "approve-chop", repository: repositoryPath, worktree: worktreeId, chop: result.chop, path: result.path, session } });
			else showToast(`${name} comes from the repository and needs your approval. Send it again once this dialog is closed.`, true);
			return;
		}
		if (result.outcome === "opened") return;
		showToast(`${name} was not sent: ${result.message}`, true);
	}

	async function runChop(repositoryPath: string, worktreeId: string, name: string, size: { cols: number; rows: number }, approve?: string, target?: { session: string | null }): Promise<void> {
		const listed = findListedChop(listedChops(state.chops?.repository === repositoryPath ? state.chops.list : null), name);
		if (listed?.kind === "prompt") {
			// With no agent saved, the prompt has nowhere to go: it is copied instead.
			if (state.preferences.agents.length === 0) return copyPrompt(repositoryPath, name);
			const worktree = worktreeOf(repositoryPath, worktreeId);
			if (!worktree) return showToast(`${name} was not sent: the worktree is no longer listed.`, true);
			if (isBeingRemoved(state, repositoryPath, worktree.path)) return showToast(`${name} was not sent: ${BEING_REMOVED_REASON}`, true);
			const where = target ?? (() => {
				const chosen = promptTarget(state.terminals, worktreeId);
				return chosen.kind === "new" ? { session: null } : chosen.kind === "session" ? { session: chosen.session } : null;
			})();
			if (where === null) {
				// Never over a dialog the person opened meanwhile.
				if (state.dialog === null || state.dialog.kind === "palette") update({ dialog: { kind: "send-prompt", repository: repositoryPath, worktree: worktreeId, chop: name } });
				return;
			}
			if (where.session !== null) return sendPromptChop(repositoryPath, worktreeId, worktree.path, name, size, where.session, approve);
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
				const result = await engine.runChop({ repository: repositoryPath, worktree: worktree.path, chop: name, ...size, ...(approve === undefined ? {} : { approve }) });
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
					if (state.dialog === null || state.dialog.kind === "palette") update({ dialog: { kind: "approve-chop", repository: repositoryPath, worktree: worktreeId, chop: result.chop, path: result.path } });
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
		const list = state.chops?.repository === session.repository ? state.chops.list : null;
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

	async function selectChangedFile(file: FileChangeTarget): Promise<void> {
		const view = state.changes;
		if (!view?.files?.some(candidate => sameFileChange(candidate, file))) return;
		const worktree = worktreeOf(view.repository, view.worktree);
		if (!worktree) return;
		const selected = { area: file.area, path: file.path, previousPath: file.previousPath };
		if (view.selected && sameFileChange(view.selected, selected) && view.diff !== null) return;
		const next: ChangesView = { ...view, selected, diff: null };
		update({ changes: next });
		await readDiff(next, selected, worktree.path);
	}

	async function compareChanges(compare: Comparison): Promise<void> {
		const view = state.changes;
		if (!view) return;
		const layout = chooseComparison(state.layout, view.worktree, compare);
		if (layout !== state.layout) {
			changeLayout(layout);
			void saveLayout("layout");
		}
		if (view.compared === compare) return;
		// The list of the other comparison is a different list: read it afresh, so nothing of the old one shows under the new header.
		update({ changes: { ...view, files: null, more: false, compared: null, problem: null, selected: null, diff: null } });
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
						update({ notice: null, layout: forgetRepository(state.layout, path) });
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
	function changeGroups(call: () => Promise<RepositoryGroupsResult>, shown: { order: string[]; before: string[] } | null, onSaved?: (groups: RepositoryGroups) => void): Promise<boolean> {
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
					update({ groupNameProblem: { kind: "taken", name: result.name } });
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

	function createGroup(name: string, repository?: string): Promise<boolean> {
		return changeGroups(() => engine.createRepositoryGroup(name, repository), null, groups => {
			// The engine put the repository at the end of the shown order; so does the screen.
			if (repository !== undefined) update({ repositories: applyOrder(state.repositories, shownOrder(pathsOnScreen(), groups)) });
		});
	}

	function moveGroup(id: string, index: number): Promise<void> {
		const before = state.repositoryGroups.groups.map(group => group.id);
		const order = moveInOrder(before, id, index);
		if (order.every((candidate, at) => candidate === before[at])) return Promise.resolve();
		const byId = new Map(state.repositoryGroups.groups.map(group => [group.id, group]));
		update({ notice: null, repositoryGroups: { ...state.repositoryGroups, groups: order.map(known => byId.get(known)!) } });
		const paths = pathsOnScreen();
		return changeGroups(() => engine.reorderRepositoryGroups(order), { order: paths, before: paths }).then(() => {});
	}

	function deleteGroup(id: string): Promise<void> {
		return changeGroups(() => engine.deleteRepositoryGroup(id), null, () => {
			// The engine forgot that it was folded in the same save, so the layout needs no save of its own here.
			if (savedLayout) savedLayout = forgetGroup(savedLayout, id);
			const layout = forgetGroup(state.layout, id);
			if (layout !== state.layout) update({ layout });
		}).then(() => {});
	}

	function select(worktreeId: string): void {
		const selection = selectionFor(state.repositories, worktreeId);
		if (!selection) return;
		// Choosing a worktree puts the issues board away, even the worktree that was selected under it.
		if (selection.worktree !== state.selection?.worktree) update({ selection, board: null });
		else if (state.board !== null) update({ board: null });
	}

	const boardOf = (repository: string): IssueBoard => state.issueBoards[repository] ?? emptyBoard();
	const changeBoard = (repository: string, change: (board: IssueBoard) => IssueBoard) =>
		update({ issueBoards: { ...state.issueBoards, [repository]: change(boardOf(repository)) } });

	async function listOnBoard(repository: string, tracker: IssueTracker, list: IssueList): Promise<void> {
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
		// A list that turned out not to be set up leaves the picker. The next one shows, and is read when it never was.
		const after = boardView(boardOf(repository), state.layout.issueLists[repository]);
		if (before.list === list && after.list !== null && after.list !== list && after.tracker !== null && after.latest === null) {
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

	async function createPullRequest(worktreeId: string): Promise<void> {
		const form = state.pullRequestForms[worktreeId];
		if (!form || form.running) return;
		changeForm(worktreeId, { running: true, failure: null, reported: null, reviewerFailures: null });
		const { repository, worktree, title, body, base, draft, reviewers } = form;
		let result: CreatePullRequestResult;
		try {
			result = await engine.createPullRequest({ repository, worktree, title, body, base: pullRequestBaseFromText(base), draft, reviewers: pullRequestReviewersFromText(reviewers) });
		} catch (error) {
			const failure = notHeardFailure("how timber pr ended", error, ". The engine did not answer, so what it did is unknown.");
			result = { outcome: "failed", ran: true, published: null, failure };
		}
		// Even a failure can come after the push, or after GitHub opened the pull request.
		if (result.outcome !== "failed" || result.ran) await Promise.all([reloadOne(repository), refreshPullRequests(repository)]);
		const shown = presentPullRequestCreation(result);
		changeForm(worktreeId, { running: false, failure: shown.failure, reported: shown.reported, reviewerFailures: shown.reviewerFailures });
		if (shown.toast) showToast(shown.toast);
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
	 * tab, and start the first saved agent when Timber wanted its agent, or a
	 * shell. The repository is read again first, since the worktree is new.
	 * Only a worktree in the list opens; otherwise a toast says how to open it.
	 * The terminal it was typed in is left alone.
	 */
	async function takeHandoff(handoff: WorktreeHandoff): Promise<void> {
		if (state.repositories.some(repository => repository.path === handoff.repository)) await reloadOne(handoff.repository);
		const worktree = state.repositories.find(repository => repository.path === handoff.repository)?.worktrees.find(candidate => candidate.path === handoff.worktree);
		if (!worktree) {
			showToast(describeHandoffNotListed(handoff), true);
			return;
		}
		const agent = handoffAgent(handoff, state.preferences.agents);
		if (agent !== null) {
			startSessionsIn(handoff.repository, { id: worktree.id, path: worktree.path, branch: worktree.branch }, { setup: false, agent: { kind: "saved", name: agent.name } });
			return;
		}
		openTerminalIn(handoff.repository, worktree.path);
		if (handoff.agent) showToast(HANDOFF_NO_AGENT, true);
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
				}),
				engine.onTerminalChanged(change => {
					// Until the first list answers, changes wait, and are applied on top of it.
					if (heard !== null) return void heard.push(change);
					const stopped = timberSessionStopped(state.terminals, change);
					const promptBefore = state.terminals.find(session => session.id === change.id)?.prompt;
					if (change.session) update({ terminals: withTerminal(state.terminals, change.id, change.session) });
					else update(withoutSession(state, change.id));
					// A new agent's prompt went, or could not: say so, since the person may be looking elsewhere.
					const prompt = change.session?.prompt;
					if (prompt && promptBefore?.state === "pending" && prompt.state !== "pending") {
						if (prompt.state === "sent") showToast(describePromptSent(null, change.session!.name));
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
		moveGroup,
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
			const layout = chooseIssueList(state.layout, repository, list);
			if (layout !== state.layout) {
				changeLayout(layout);
				void saveLayout("layout");
			}
			const view = boardView(boardOf(repository), list);
			if (view.tracker !== null && view.list === list) await listOnBoard(repository, view.tracker, list);
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
		saveLayout: () => saveLayout("layout"),
		dismissLayoutProblem() {
			if (state.layoutProblem) update({ layoutProblem: null });
		},
		savePreferences,
		changeZoom,
		openInEditor,
		dismissEditorProblem() {
			if (state.editorProblem) update({ editorProblem: null });
		},
		showTab(tab) {
			// A worktree's tab is asked for, so the worktree shows in place of any issues board.
			if (tab !== state.tab || state.board !== null) update({ tab, board: null });
		},
		readChanges,
		readChops,
		runChop,
		insertChop,
		readPorts,
		selectChangedFile,
		compareChanges,
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
			// Neither Done nor Rebase starts on a worktree that Timber is removing.
			if ((request.kind === "done-worktree" || request.kind === "rebase-worktree") && removingId(request.repository, request.worktree)) return;
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
		previewDone,
		applyDone,
		removeWorktree,
		cleanUpMerged,
		dismissRemoval,
		openTerminal,
		startSessionsIn,
		rebaseWorktree,
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
			if (live > 0 && !endSessions) {
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
