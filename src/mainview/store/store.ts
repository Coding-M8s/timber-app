import { type Attention, sameAttention } from "../../shared/attention";
import type { UninstallPlan, UninstallRequest, UninstallResult } from "../../shared/uninstall";
import type { RestartPlan, RestartResult } from "../../shared/restart";
import { readableEditorSetting } from "../../shared/editor";
import type { Engine } from "../../shared/engine";
import type { FetchResult, ForcePushSeen, RepositoryFetch } from "../../shared/git-fetch";
import { type FileChangeTarget, type FileChangesResult, type FileDiffResult, sameFileChange } from "../../shared/file-changes";
import { type Layout, clampSidebarWidth, dismissSetup, forgetRepository, sameLayout, toggleCollapsed } from "../../shared/layout";
import type { BranchSuggestion, NewWorktreeRequest, OpenInEditorRequest, OpenInEditorResult, OpenWorktreeRequest, ReportedWorktree, SavePreferencesResult, TimberStatus, Worktree, WorktreeCommandResult } from "../../shared/model";
import { type Preferences, defaultPreferences } from "../../shared/preferences";
import type { IssueLookup } from "../../shared/issues";
import type { BackupDeleteRequest, BackupDeleteResult, BackupList, BackupRestoreRequest, BackupRestoreResult } from "../../shared/backups";
import type { PullRequestList } from "../../shared/pull-requests";
import { applyOrder, moveInOrder } from "../../shared/repository-order";
import { type ZoomStep, stepZoom, zoomLabel } from "../../shared/zoom";
import type { Theme } from "../../shared/theme";
import type { ChooseSoundResult, SoundChoice, SoundOutcome } from "../../shared/sound-setting";
import type { ExportThemeResult, ImportThemeResult } from "../../shared/theme-file";
import type { StartRebaseRequest, StartRebaseResult } from "../../shared/rebase-command";
import { type OpenTerminalRequest, type TerminalChange, type TerminalSession, WORKTREE_SETUP_SESSION_NAME } from "../../shared/terminal";
import type { TimberConnectionCheckRequest, TimberConnectionCheckResult, TimberSettingsReadResult, TimberSettingsRequest, TimberSettingsSaveRequest, TimberSettingsSaveResult } from "../../shared/timber-config";
import type { DoneApplyRequest, DoneApplyResult, DonePreviewRequest, DonePreviewResult } from "../../shared/timber-done";
import type { RebaseRequest, RebaseResult } from "../../shared/timber-rebase";
import { type CreatePullRequestResult, initialPullRequestBase, pullRequestBaseFromText } from "../../shared/timber-pr";
import { type PullRequestFields, defaultPullRequestTitle, presentPullRequestCreation } from "../pull-request-create-format";
import type { WorkflowList } from "../../shared/workflows";
import { type Draw, createTerminalFeed } from "../terminal-feed";
import { describeOrphanTerminal } from "../terminal-format";
import { describeRemovalFailed } from "../done-format";
import { listedOrder } from "../changes-format";
import { describeOpenedInEditor } from "../editor-format";
import { describeAdded, describeRemoved, folderName, worktreeLabel } from "../format";
import { describeFetched } from "../fetch-format";
import { wantTerminalFocus } from "../terminal-focus";
import { mergeOverlapping } from "./merge";
import {
	type AppState, type ChangesView, type DialogRequest, type Operation, type PullRequestForm, type Removal, type WorkspaceTab, TOAST_MILLISECONDS, initialState, isBeingRemoved, keepLastGood,
	reconcileRemovals, removalAt, reconcileSelection, selectedWorktree, selectionFor, selectionForRepository, sessionOnScreen, sessionsOf, timberReady, withTerminal, withoutSession } from "./state";

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
	/** Put away the note about the latest add or remove. */
	dismissNotice(): void;
	/** Select a worktree by its identity (`Worktree.id`). One that no repository has is ignored. */
	select(worktreeId: string): void;
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
	/** Select a file of `changes` and read its diff. Never throws. */
	selectChangedFile(file: FileChangeTarget): Promise<void>;
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
	 * When it worked, the record goes, a toast says so with `toast`, and the
	 * Done dialog of that worktree closes if it is still open. When it failed,
	 * the record stays as a failure until it is dismissed, and unless that
	 * dialog is open a toast points at it. Never throws.
	 */
	removeWorktree(request: { repository: string; worktree: Worktree; preview: string; toast: string }): Promise<DoneApplyResult | null>;
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
	 * Start `timber rebase` in a new Timber session in a worktree, beside its
	 * other sessions. The engine is asked once. A session that started shows,
	 * in the Workspace tab, and when it stops the repositories are read again,
	 * as for any Timber session. Nothing here says how the rebase went. Never
	 * throws.
	 */
	startRebase(request: StartRebaseRequest): Promise<StartRebaseResult>;
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
	 * it. Created: a toast. Already open: a note above it. Refused or failed:
	 * the failure stays in the form for a retry. Never throws.
	 */
	createPullRequest(worktreeId: string): Promise<void>;
	/**
	 * Restore a backup into a new worktree, once. The repository is read again
	 * after every outcome, and a recovery worktree that is complete is
	 * selected. One left behind by a partial restore is never selected.
	 */
	restoreBackup(request: BackupRestoreRequest): Promise<BackupRestoreResult>;
	/** Delete one backup, once. Its repository's backups are read again after every outcome. */
	deleteBackup(request: BackupDeleteRequest): Promise<BackupDeleteResult>;
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
	 * with one. With `agent`, that agent from the saved
	 * Settings starts beside it at once, without waiting for setup, and its
	 * pane shows. The worktree is looked up as `newWorktree` selects it.
	 * Answers at once, without waiting for the sessions: false when the list
	 * does not have the worktree, and then nothing starts. Never throws.
	 */
	startSessionsIn(repository: string, worktree: ReportedWorktree, sessions: { setup: boolean; workflow?: string; agent: string | null }): boolean;
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

/** `schedule` is how the store waits before it takes a toast away. Tests pass their own clock. */
/**
 * Changes to a repository come often while an agent works, and each read of
 * its backups runs Timber over every backup. Reads asked for by such changes
 * are at least this far apart for one repository, and the last one asked for
 * meanwhile still happens.
 */
export const BACKUP_READ_SPACING_MS = 15_000;

export function createAppStore(engine: Engine, schedule: Schedule = scheduleWithTimer): AppStore {
	let state = initialState;
	const listeners = new Set<() => void>();
	let lastToast = 0;
	const toastTimers = new Map<number, () => void>();

	// What the engine was last told through `attend`, and whether to tell it: only between `start` and its stop.
	let windowState: WindowState = { visible: true, focused: true };
	let attended: Attention | null = null;
	let attending = false;

	function attend(): void {
		if (!attending) return;
		const selected = selectedWorktree(state);
		const next: Attention = {
			...windowState,
			selected: selected && timberReady(state) ? { repository: selected.repository.path, worktree: selected.worktree.path } : null,
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
				lookup = { ok: false, message: `The app did not hear the answer: ${messageOf(error)}` };
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
		const kept = Object.fromEntries(Object.entries(state.issues).filter(([id, entry]) => {
			const link = linked.get(id);
			return link !== undefined && link.tracker === entry.tracker && link.key === entry.key;
		}));
		if (Object.keys(kept).length !== Object.keys(state.issues).length) state = { ...state, issues: kept };
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
		state = { ...state, ...change };
		// A change to the list, or to Timber, may bring links to read or take some away.
		if (change.repositories || change.timber) catchUpIssues();
		// A failed removal that no longer matches the list goes with the list change that ended it.
		if (change.repositories && state.removals.length > 0) {
			const removals = reconcileRemovals(state.repositories, state.removals);
			if (removals !== state.removals) state = { ...state, removals };
		}
		// A session on screen is seen, whatever put it there: a chip, the selection, the tab, or a session that started or ended.
		const onScreen = sessionOnScreen(state);
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

	const reloadAll = mergeOverlapping<"all">(() => track({ kind: "reload-all" }, async () => {
		const ticket = ++lastTicket;
		try {
			const listed = await engine.listRepositories();
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
				error: null,
			});
			endOrphanTerminals();
			forgetGoneForms();
			catchUpPullRequests();
			catchUpBackups();
		} catch (error) {
			update({ error: { repository: null, message: messageOf(error) } });
		}
	}));

	/*
	 * Pull requests come from GitHub through Timber, so they are read as often
	 * as the repository is fetched: once when it is first listed, then each
	 * time a fetch of it ends, in the background or after Fetch now. Reads of
	 * one repository never overlap. Nothing is read while Timber is not ready,
	 * as the Timber notice already says why.
	 */
	const readingPullRequests = new Set<string>();
	const refreshPullRequests = mergeOverlapping<string>(async path => {
		if (!timberReady(state) || !state.repositories.some(repository => repository.path === path && repository.available)) return;
		let answer: PullRequestList;
		readingPullRequests.add(path);
		try {
			answer = await engine.readPullRequests(path);
		} catch (error) {
			answer = { ok: false, message: `The app did not hear the answer: ${messageOf(error)}` };
		} finally {
			readingPullRequests.delete(path);
		}
		// A repository that left the list meanwhile keeps nothing.
		if (!state.repositories.some(repository => repository.path === path)) return;
		// A form's note about what the last run reported lasts until this newer read, which shows the pull request or, still none, the form again.
		const forms = Object.entries(state.pullRequestForms);
		const settled = forms.map(([id, form]): [string, PullRequestForm] => form.repository === path && form.reported !== null && !form.running ? [id, { ...form, reported: null }] : [id, form]);
		const changed = settled.some(([id, form]) => form !== state.pullRequestForms[id]);
		update({ pullRequests: { ...state.pullRequests, [path]: answer }, ...(changed ? { pullRequestForms: Object.fromEntries(settled) } : {}) });
	});

	/** Read the pull requests of every repository that has none yet, and forget those of one no longer listed. */
	function catchUpPullRequests(): void {
		const listed = new Set(state.repositories.map(repository => repository.path));
		const kept = Object.fromEntries(Object.entries(state.pullRequests).filter(([path]) => listed.has(path)));
		if (Object.keys(kept).length !== Object.keys(state.pullRequests).length) update({ pullRequests: kept });
		for (const repository of state.repositories) {
			// One that is being read for the first time is not asked again.
			if (repository.available && !(repository.path in state.pullRequests) && !readingPullRequests.has(repository.path)) void refreshPullRequests(repository.path);
		}
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
	const readingBackups = new Set<string>();
	// Goes up when another Timber is found, so an answer from the one before is dropped.
	let backupGeneration = 0;
	const refreshBackups = mergeOverlapping<string>(async path => {
		if (!timberReady(state) || !state.repositories.some(repository => repository.path === path && repository.available)) return;
		const generation = backupGeneration;
		let answer: BackupList;
		readingBackups.add(path);
		try {
			answer = await engine.readBackups(path);
		} catch (error) {
			answer = { state: "failed", message: `The app did not hear the answer: ${messageOf(error)}` };
		} finally {
			readingBackups.delete(path);
		}
		// A repository that left the list meanwhile keeps nothing.
		if (!state.repositories.some(repository => repository.path === path)) return;
		// Asked of a Timber that has since been replaced: ask the new one.
		if (generation !== backupGeneration) return void refreshBackups(path);
		update({ backups: { ...state.backups, [path]: answer } });
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
		const listed = new Set(state.repositories.map(repository => repository.path));
		const kept = Object.fromEntries(Object.entries(state.backups).filter(([path]) => listed.has(path)));
		if (Object.keys(kept).length !== Object.keys(state.backups).length) update({ backups: kept });
		for (const repository of state.repositories) {
			if (repository.available && !(repository.path in state.backups) && !readingBackups.has(repository.path)) void refreshBackups(repository.path);
		}
	}

	/** Refresh: every repository's backups, at once, also where Timber had no backup list. */
	async function refresh(): Promise<void> {
		await reloadAll("all");
		for (const repository of state.repositories) {
			// A read in progress may predate the press; a new one follows it.
			if (repository.available) void refreshBackups(repository.path);
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
				error: state.error?.repository === path ? null : state.error,
			});
			endOrphanTerminals();
			forgetGoneForms();
			requestBackups(path);
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
	const unheard = (what: string, error: unknown) => `The app did not hear back about ${what}: ${messageOf(error)}`;

	async function readDiff(view: ChangesView, file: FileChangeTarget, worktreePath: string): Promise<void> {
		const ticket = ++diffTicket;
		let answer!: FileDiffResult;
		await track({ kind: "read-diff", worktree: view.worktree }, async () => {
			try {
				answer = await engine.readFileDiff({ repository: view.repository, worktree: worktreePath, file });
			} catch (error) {
				answer = { outcome: "failed", message: unheard(`the changes of ${file.path}`, error) };
			}
		});
		const now = state.changes;
		if (ticket !== diffTicket || now?.worktree !== view.worktree || now.selected === null || !sameFileChange(now.selected, file)) return;
		update({ changes: { ...now, diff: answer } });
	}

	function worktreeOf(repositoryPath: string, worktreeId: string) {
		return state.repositories.find(candidate => candidate.path === repositoryPath)?.worktrees.find(candidate => candidate.id === worktreeId) ?? null;
	}

	async function readChanges(repositoryPath: string, worktreeId: string): Promise<void> {
		const worktree = worktreeOf(repositoryPath, worktreeId);
		if (!worktree) return;
		const ticket = ++changesTicket;
		if (state.changes?.worktree !== worktreeId || state.changes.repository !== repositoryPath) {
			update({ changes: { repository: repositoryPath, worktree: worktreeId, files: null, more: false, problem: null, selected: null, diff: null } });
		}
		let answer!: FileChangesResult;
		await track({ kind: "read-changes", worktree: worktreeId }, async () => {
			try {
				answer = await engine.readFileChanges({ repository: repositoryPath, worktree: worktree.path });
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
		const next: ChangesView = { ...view, files: answer.files, more: answer.more, problem: null, selected, diff: kept ? view.diff : null };
		update({ changes: next });
		if (selected) await readDiff(next, selected, worktree.path);
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
				return { outcome: "failed", command: null, message: `The app did not hear whether the editor started: ${messageOf(error)}` };
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
				answer = { outcome: "not-listed", message: `The app did not hear how the fetch ended: ${messageOf(error)}` };
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
				if (Object.keys(state.backups).length > 0) update({ backups: {} });
			}
			if (timberReady(state) && !wasReady) void reloadAll("all");
			else if (timberReady(state)) catchUpBackups();
		});
	}

	function selectRepository(path: string): void {
		const selection = selectionForRepository(state.repositories, path);
		if (selection && selection.worktree !== state.selection?.worktree) update({ selection });
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

	function select(worktreeId: string): void {
		const selection = selectionFor(state.repositories, worktreeId);
		if (selection && selection.worktree !== state.selection?.worktree) update({ selection });
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
			const diagnostic = `The app did not hear how the command ended: ${messageOf(error)}. What it did is unknown, so check the list before trying again.`;
			result = { outcome: "failed", failure: { command: null, diagnostic, output: null }, worktree: null, created: false, setupSkipped: false };
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

	async function removeWorktree(request: { repository: string; worktree: Worktree; preview: string; toast: string }): Promise<DoneApplyResult | null> {
		const { repository, worktree, preview, toast } = request;
		const { path } = worktree;
		if (isBeingRemoved(state, repository, path)) return null;
		const others = (removals: readonly Removal[]) => removals.filter(removal => removal.repository !== repository || removal.worktree.path !== path);
		update({ removals: [...others(state.removals), { repository, worktree, toast, status: { kind: "running" } }] });
		const result = await applyDone({ repository, path, preview });
		const watching = doneDialogShows(repository, worktree);
		if (result.outcome === "removed") {
			update({ removals: others(state.removals), dialog: watching ? null : state.dialog });
			showToast(toast);
			return result;
		}
		const listedRepository = state.repositories.find(candidate => candidate.path === repository);
		const gone = !listedRepository?.worktrees.some(candidate => candidate.path === path);
		// A repository that left the list meanwhile has nowhere to show the failure, so nothing is kept for it.
		update({ removals: listedRepository ? [...others(state.removals), { repository, worktree, toast, status: { kind: "failed", failure: result.failure, gone } }] : others(state.removals) });
		if (!watching) showToast(describeRemovalFailed(worktreeLabel(worktree), listedRepository !== undefined), true);
		return result;
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

	/** The request for a session being answered in each worktree, by `terminalKey`. */
	const askingTerminal = new Map<string, Promise<void>>();

	async function openTerminal(request: OpenTerminalRequest): Promise<void> {
		// Nothing new starts in a folder that is being deleted.
		if (isBeingRemoved(state, request.repository, request.worktree)) return;
		const key = terminalKey(request);
		if (state.operations.some(operation => operation.kind === "open-terminal" && operation.worktree === key)) return;
		const agent = request.agent ?? (request.timberWorktreeSetup ? WORKTREE_SETUP_SESSION_NAME : null);
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

	async function startRebase(request: StartRebaseRequest): Promise<StartRebaseResult> {
		const { repository, worktree, onto, cols, rows } = request;
		let result;
		try {
			result = await engine.openTerminal({ repository, worktree, cols, rows, timberRebase: { onto } });
		} catch (error) {
			return {
				outcome: "unknown",
				message: `The app did not hear whether the rebase started: ${messageOf(error)}. Look at the worktree's sessions before trying again.`,
			};
		}
		if (result.outcome !== "opened") return { outcome: "not-run", message: result.message };
		const { session } = result;
		// The engine reports the session as it changes, and may have reported it ended before this answer: that report is newer.
		const known = state.terminals.some(candidate => candidate.id === session.id);
		update({
			terminals: known ? state.terminals : withTerminal(state.terminals, session.id, session),
			shownSessions: { ...state.shownSessions, [session.worktree]: session.id },
			unseenSessions: state.unseenSessions.filter(id => id !== session.id),
			tab: "workspace",
		});
		return { outcome: "started", session };
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

	/** Put the last commit's subject in the title, unless the person typed one or Timber runs. Read for `head`, which a later commit replaces. */
	function readTitle(repository: string, worktree: Worktree): void {
		void (async () => {
			let subject: string | null;
			try {
				subject = await engine.readHeadSubject({ repository, worktree: worktree.path });
			} catch {
				subject = null;
			}
			const now = state.pullRequestForms[worktree.id];
			if (subject !== null && now && now.head === worktree.head && !now.titleEdited && !now.running) changeForm(worktree.id, { title: defaultPullRequestTitle(subject, worktree.branch) });
		})();
	}

	function startPullRequestForm(repository: string, worktree: Worktree): void {
		const existing = state.pullRequestForms[worktree.id];
		if (existing) {
			// A new commit since the title was read: its subject is the better title, unless one was typed.
			if (existing.head !== worktree.head && !existing.titleEdited && !existing.running) {
				changeForm(worktree.id, { head: worktree.head });
				readTitle(repository, worktree);
			}
			return;
		}
		const form: PullRequestForm = {
			repository,
			worktree: worktree.path,
			head: worktree.head,
			title: defaultPullRequestTitle(null, worktree.branch),
			titleEdited: false,
			body: "",
			base: initialPullRequestBase(worktree.base),
			draft: false,
			running: false,
			failure: null,
			reported: null,
		};
		update({ pullRequestForms: { ...state.pullRequestForms, [worktree.id]: form } });
		readTitle(repository, worktree);
	}

	function editPullRequestForm(worktreeId: string, change: Partial<PullRequestFields>): void {
		const form = state.pullRequestForms[worktreeId];
		if (!form || form.running) return;
		changeForm(worktreeId, { ...change, ...(change.title === undefined ? {} : { titleEdited: true }), failure: null });
	}

	async function createPullRequest(worktreeId: string): Promise<void> {
		const form = state.pullRequestForms[worktreeId];
		if (!form || form.running) return;
		changeForm(worktreeId, { running: true, failure: null, reported: null });
		const { repository, worktree, title, body, base, draft } = form;
		let result: CreatePullRequestResult;
		try {
			result = await engine.createPullRequest({ repository, worktree, title, body, base: pullRequestBaseFromText(base), draft });
		} catch (error) {
			const diagnostic = `The app did not hear how timber pr ended: ${messageOf(error)}. The engine did not answer, so what it did is unknown.`;
			result = { outcome: "failed", ran: true, published: null, failure: { command: null, diagnostic, output: null } };
		}
		// Even a failure can come after the push, or after GitHub opened the pull request.
		if (result.outcome !== "failed" || result.ran) await Promise.all([reloadOne(repository), refreshPullRequests(repository)]);
		const shown = presentPullRequestCreation(result);
		changeForm(worktreeId, { running: false, failure: shown.failure, reported: shown.reported });
		if (shown.toast) showToast(shown.toast);
	}

	async function restoreBackup(request: BackupRestoreRequest): Promise<BackupRestoreResult> {
		let result: BackupRestoreResult;
		try {
			result = await engine.restoreBackup(request);
		} catch (error) {
			const diagnostic = `The app did not hear how the restore ended: ${messageOf(error)}. What it did is unknown, so check the list before trying again.`;
			result = { outcome: "failed", ran: true, failure: { command: null, diagnostic, output: null } };
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
			const diagnostic = `The app did not hear how the deletion ended: ${messageOf(error)}. What it did is unknown; the list of backups is read again.`;
			result = { outcome: "failed", ran: true, failure: { command: null, diagnostic, output: null } };
		}
		// At once, not spaced out: the person is looking at the outcome.
		await refreshBackups(request.repository);
		return result;
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

	function startSessionsIn(repositoryPath: string, reported: ReportedWorktree, sessions: { setup: boolean; workflow?: string; agent: string | null }): boolean {
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
			if (sessions.agent !== null) await openTerminalInTurn({ ...request, agent: sessions.agent });
		})();
		return true;
	}

	/**
	 * Whether this change stops a Timber session, such as a rebase, given the
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
		update({ selection, tab: "workspace", shownSessions: { ...state.shownSessions, [session.worktree]: id } });
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

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		start() {
			let heard: TerminalChange[] | null = [];
			const stops = [
				engine.onRepositoryChanged(path => {
					// Only a repository on screen can be refreshed. Reload everything to pick up a new one.
					if (state.repositories.some(repository => repository.path === path)) void reloadOne(path);
				}),
				engine.onTerminalChanged(change => {
					// Until the first list answers, changes wait, and are applied on top of it.
					if (heard !== null) return void heard.push(change);
					const stopped = timberSessionStopped(state.terminals, change);
					if (change.session) update({ terminals: withTerminal(state.terminals, change.id, change.session) });
					else update(withoutSession(state, change.id));
					// What a Timber session such as a rebase changed shows in the repositories. Read them all again,
					// since how it ended does not say which ones it touched.
					if (stopped) void reloadAll("all");
				}),
				engine.onTerminalOutput(part => {
					if (!watched.has(part.id)) engine.drawnTerminal(part.id, part.seq);
					// A chip marks a session that printed while it was not on screen.
					if (part.data === "" || state.unseenSessions.includes(part.id) || sessionOnScreen(state)?.id === part.id) return;
					if (state.terminals.some(session => session.id === part.id)) update({ unseenSessions: [...state.unseenSessions, part.id] });
				}),
				engine.onQuitRequested(live => update({ quitRequest: live })),
				engine.onShowSession(id => revealSession(id)),
				// A newer Timber release came out: ask for the status again, so the banner shows.
				engine.onTimberChanged(() => void findTimber(() => engine.timberStatus())),
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
			attend();
			noteForcePush();
		},
		retryTimber: () => findTimber(() => engine.recheckTimber()),
		refresh,
		reloadRepository: path => reloadOne(path),
		fetchNow,
		addRepository,
		removeRepository,
		moveRepository,
		dismissNotice() {
			if (state.notice) update({ notice: null });
		},
		select,
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
			if (tab !== state.tab) update({ tab });
		},
		readChanges,
		selectChangedFile,
		async readTimberSettings(request) {
			try {
				return await engine.readTimberSettings(request);
			} catch (error) {
				return { outcome: "failed", failure: { command: null, diagnostic: `The app did not hear back: ${messageOf(error)}`, output: null } };
			}
		},
		async saveTimberSettings(request) {
			let result: TimberSettingsSaveResult;
			try {
				result = await engine.saveTimberSettings(request);
			} catch (error) {
				return { outcome: "failed", failure: { command: null, diagnostic: `The app did not hear back, so whether the settings were saved is unknown: ${messageOf(error)}. Read them again before saving.`, output: null } };
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
				return { outcome: "failed", failure: { command: null, diagnostic: `The app did not hear back: ${messageOf(error)}`, output: null } };
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
		previewDone,
		applyDone,
		removeWorktree,
		dismissRemoval,
		openTerminal,
		startRebase,
		startSessionsIn,
		rebaseWorktree,
		startPullRequestForm,
		editPullRequestForm,
		createPullRequest,
		restoreBackup,
		deleteBackup,
		openTerminalIn,
		showSession,
		revealSession,
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
