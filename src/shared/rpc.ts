import type { RPCSchema } from "electrobun/view";
import type { AppInfo } from "./app-info";
import type { Attention } from "./attention";
import type { BackupDeleteRequest, BackupDeleteResult, BackupList, BackupRestoreRequest, BackupRestoreResult } from "./backups";
import type { FetchResult, ForcePushSeen, RepositoryFetch } from "./git-fetch";
import type { FileChangesRequest, FileChangesResult, FileDiffRequest, FileDiffResult } from "./file-changes";
import type { Layout } from "./layout";
import type { RebaseRequest, RebaseResult } from "./timber-rebase";
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
import type { DoneApplyRequest, DoneApplyResult, DonePreviewRequest, DonePreviewResult } from "./timber-done";
import type { UninstallPlan, UninstallRequest, UninstallResult } from "./uninstall";
import type { WorkflowList } from "./workflows";

/**
 * The typed bridge between the Bun main process and the interface.
 * Types only: both sides import this file and it emits no runtime code.
 * Keep it in step with `Engine` in ./engine.ts.
 */
export type AppRPC = {
	bun: RPCSchema<{
		requests: {
			appInfo: { params: {}; response: AppInfo };
			timberStatus: { params: {}; response: TimberStatus };
			recheckTimber: { params: {}; response: TimberStatus };
			listRepositories: { params: {}; response: Repository[] };
			/** Answers only when the folder picker closes, so the caller must not time it out. */
			addRepository: { params: {}; response: AddRepositoryResult };
			removeRepository: { params: { path: string }; response: RemoveRepositoryResult };
			reorderRepositories: { params: { order: string[] }; response: ReorderRepositoriesResult };
			loadRepository: { params: { path: string }; response: Repository | null };
			listBranches: { params: { repository: string }; response: BranchSuggestion[] | null };
			/** Answers only when Timber and its setup scripts have ended, so the caller must not time it out. */
			newWorktree: { params: NewWorktreeRequest; response: WorktreeCommandResult };
			/** As `newWorktree`: no time limit. */
			openWorktree: { params: OpenWorktreeRequest; response: WorktreeCommandResult };
			/** As `newWorktree`: Git hooks and a fetch take as long as they take, so the caller must not time it out. */
			rebaseWorktree: { params: RebaseRequest; response: RebaseResult };
			loadLayout: { params: {}; response: Layout };
			saveLayout: { params: { layout: Layout }; response: SaveLayoutResult };
			loadPreferences: { params: {}; response: Preferences };
			savePreferences: { params: { change: Partial<Preferences> }; response: SavePreferencesResult };
			/** Waits for the person to pick a folder, so the caller must not time it out. */
			exportTheme: { params: { theme: Theme }; response: ExportThemeResult };
			/** Waits for the person to pick a file, so the caller must not time it out. */
			importTheme: { params: {}; response: ImportThemeResult };
			chooseSoundFile: { params: {}; response: ChooseSoundResult };
			playSound: { params: { choice: SoundChoice }; response: SoundOutcome };
			openInEditor: { params: OpenInEditorRequest; response: OpenInEditorResult };
			/** Waits up to thirty seconds for Timber, so the caller allows longer. */
			readTimberSettings: { params: TimberSettingsRequest; response: TimberSettingsReadResult };
			/** Answers only when Timber has ended. It holds a lock and may wait on it, so the caller must not time it out. */
			saveTimberSettings: { params: TimberSettingsSaveRequest; response: TimberSettingsSaveResult };
			/** Waits up to thirty seconds for Timber's login check, so the caller allows longer. */
			checkTimberConnection: { params: TimberConnectionCheckRequest; response: TimberConnectionCheckResult };
			/** The main process stops Timber after ten seconds, inside the default time limit. */
			listWorkflows: { params: { repository: string }; response: WorkflowList };
			/** The main process stops Timber after thirty seconds, so the caller allows longer. */
			readPullRequests: { params: { repository: string }; response: PullRequestList };
			readIssue: { params: IssueRequest; response: IssueLookup };
			/** The main process stops Timber after thirty seconds, so the caller allows longer. */
			readBackups: { params: { repository: string }; response: BackupList };
			/** Answers only when Timber has ended, after it copied every file back, so the caller must not time it out. */
			restoreBackup: { params: BackupRestoreRequest; response: BackupRestoreResult };
			/** As `restoreBackup`: no time limit. */
			deleteBackup: { params: BackupDeleteRequest; response: BackupDeleteResult };
			previewDone: { params: DonePreviewRequest; response: DonePreviewResult };
			/** Answers only when Timber has ended. Scripts that run before deletion take as long as they take, so the caller must not time it out. */
			applyDone: { params: DoneApplyRequest; response: DoneApplyResult };
			readFileChanges: { params: FileChangesRequest; response: FileChangesResult };
			readFileDiff: { params: FileDiffRequest; response: FileDiffResult };
			listTerminals: { params: {}; response: TerminalSession[] };
			openTerminal: { params: OpenTerminalRequest; response: OpenTerminalResult };
			readTerminal: { params: { id: string }; response: TerminalSnapshot | null };
			renameTerminal: { params: { id: string; name: string }; response: TerminalSession | null };
			closeTerminal: { params: { id: string }; response: void };
			confirmQuit: { params: {}; response: void };
			writeClipboard: { params: { text: string }; response: void };
			readClipboard: { params: {}; response: string | null };
			openLink: { params: { url: string }; response: boolean };
			fetchStatuses: { params: {}; response: RepositoryFetch[] };
			/** Answers only when the fetch has ended, which can take minutes, so the caller must not time it out. */
			fetchNow: { params: { repository: string }; response: FetchResult };
			uninstallPlan: { params: {}; response: UninstallPlan };
			/** The main process stops a stuck uninstaller after a minute, so the caller allows longer. The app quits right after a good answer. */
			uninstall: { params: UninstallRequest; response: UninstallResult };
			restartPlan: { params: {}; response: RestartPlan };
			/** Ending every session can take a moment, so the caller allows longer. When it works, the app quits before it answers. */
			restart: { params: {}; response: RestartResult };
		};
		messages: {
			/** Typed or pasted text for a session. */
			writeTerminal: { id: string; data: string };
			resizeTerminal: { id: string; cols: number; rows: number };
			/** The window drew a session's parts up to `seq`. */
			terminalDrawn: { id: string; seq: number };
			/** How the window is, and which worktree is selected (see `Engine.attend`). */
			attend: Attention;
			/** The person saw a branch marked force-pushed (see `Engine.forcePushSeen`). */
			forcePushSeen: ForcePushSeen;
			/** The interface has drawn itself, so the window can show (see `Engine.windowReady`). */
			windowReady: {};
		};
	}>;
	webview: RPCSchema<{
		requests: {
			/** Show the question before quitting. Answers whether the window shows it, at once. */
			askQuit: { params: { live: number }; response: boolean };
		};
		messages: {
			/** A repository changed. `path` is its primary checkout. */
			repositoryChanged: { path: string };
			/** Part of what a session printed. */
			terminalOutput: TerminalOutput;
			terminalChanged: TerminalChange;
			/** The person clicked the desktop notification of a session: show it. */
			showSession: { id: string };
			/** Where fetching stands for a repository. */
			fetchChanged: RepositoryFetch;
			/** The Timber status changed without being asked, for example a newer release came out. Ask `timberStatus` for it. */
			timberChanged: {};
		};
	}>;
};
