import type { WorktreeHandoff } from "./handoff";
import type { RPCSchema } from "electrobun/view";
import type { NewArenaRequest, PickArenaRequest } from "./arenas";
import type { ChopsRequest, RunChopRequest } from "./chops";
import type { Attention } from "./attention";
import type { BackupDeleteRequest, BackupRestoreRequest } from "./backups";
import type { Engine } from "./engine";
import type { ForcePushSeen, RepositoryFetch } from "./git-fetch";
import type { FileChangesRequest, FileDiffRequest } from "./file-changes";
import type { WorktreeFileRequest } from "./worktree-files";
import type { Layout } from "./layout";
import type { PortsRequest } from "./ports";
import type { RebaseRequest } from "./timber-rebase";
import type { SetBaseRequest } from "./timber-base";
import type { CreatePullRequestRequest, HeadSubjectRequest } from "./timber-pr";
import type { NewWorktreeRequest, OpenInEditorRequest, OpenWorktreeRequest } from "./model";
import type { Preferences } from "./preferences";
import type { IssueSearchRequest } from "./issue-search";
import type { IssueListRequest } from "./issue-lists";
import type { IssueRequest } from "./issues";
import type { Theme } from "./theme";
import type { SoundChoice } from "./sound-setting";
import type { OpenTerminalRequest, TerminalChange, TerminalOutput } from "./terminal";
import type { TimberConnectionCheckRequest, TimberSettingsRequest, TimberSettingsSaveRequest } from "./timber-config";
import type { DoneApplyRequest, DonePreviewRequest } from "./timber-done";
import type { UninstallRequest } from "./uninstall";
import type { AppUpdateInstallRequest, AppUpdateState } from "./app-update";

/** What the engine answers for a request, so the bridge and the contract cannot drift apart. */
type Answer<Name extends keyof Engine> = Awaited<ReturnType<Engine[Name]>>;

/**
 * The typed bridge between the Bun main process and the interface.
 * Types only: both sides import this file and it emits no runtime code.
 * Each response is what `Engine` in ./engine.ts answers. Keep the requests
 * and their params in step with it.
 */
export type AppRPC = {
	bun: RPCSchema<{
		requests: {
			appInfo: { params: {}; response: Answer<"appInfo"> };
			timberStatus: { params: {}; response: Answer<"timberStatus"> };
			recheckTimber: { params: {}; response: Answer<"recheckTimber"> };
			listRepositories: { params: {}; response: Answer<"listRepositories"> };
			/** Answers only when the folder picker closes, so the caller must not time it out. */
			addRepository: { params: {}; response: Answer<"addRepository"> };
			removeRepository: { params: { path: string }; response: Answer<"removeRepository"> };
			reorderRepositories: { params: { order: string[] }; response: Answer<"reorderRepositories"> };
			listRepositoryGroups: { params: {}; response: Answer<"listRepositoryGroups"> };
			createRepositoryGroup: { params: { name: string; repository: string | null }; response: Answer<"createRepositoryGroup"> };
			renameRepositoryGroup: { params: { id: string; name: string }; response: Answer<"renameRepositoryGroup"> };
			deleteRepositoryGroup: { params: { id: string }; response: Answer<"deleteRepositoryGroup"> };
			reorderRepositoryGroups: { params: { order: string[] }; response: Answer<"reorderRepositoryGroups"> };
			placeRepository: { params: { path: string; group: string | null; order: string[] | null }; response: Answer<"placeRepository"> };
			loadRepository: { params: { path: string }; response: Answer<"loadRepository"> };
			listBranches: { params: { repository: string }; response: Answer<"listBranches"> };
			/** Answers only when Timber and its setup scripts have ended, so the caller must not time it out. */
			newWorktree: { params: NewWorktreeRequest; response: Answer<"newWorktree"> };
			/** As `newWorktree`: no time limit. */
			openWorktree: { params: OpenWorktreeRequest; response: Answer<"openWorktree"> };
			/** As `newWorktree`: Git hooks and a fetch take as long as they take, so the caller must not time it out. */
			rebaseWorktree: { params: RebaseRequest; response: Answer<"rebaseWorktree"> };
			/** As `newWorktree`: checking a remote base reaches the network, so the caller must not time it out. */
			setWorktreeBase: { params: SetBaseRequest; response: Answer<"setWorktreeBase"> };
			/** As `newWorktree`: a push and GitHub take as long as they take, so the caller must not time it out. */
			createPullRequest: { params: CreatePullRequestRequest; response: Answer<"createPullRequest"> };
			readHeadSubject: { params: HeadSubjectRequest; response: Answer<"readHeadSubject"> };
			loadLayout: { params: {}; response: Answer<"loadLayout"> };
			saveLayout: { params: { layout: Layout }; response: Answer<"saveLayout"> };
			loadPreferences: { params: {}; response: Answer<"loadPreferences"> };
			savePreferences: { params: { change: Partial<Preferences> }; response: Answer<"savePreferences"> };
			/** Waits for the person to pick a folder, so the caller must not time it out. */
			exportTheme: { params: { theme: Theme }; response: Answer<"exportTheme"> };
			/** Waits for the person to pick a file, so the caller must not time it out. */
			importTheme: { params: {}; response: Answer<"importTheme"> };
			chooseSoundFile: { params: {}; response: Answer<"chooseSoundFile"> };
			playSound: { params: { choice: SoundChoice }; response: Answer<"playSound"> };
			openInEditor: { params: OpenInEditorRequest; response: Answer<"openInEditor"> };
			/** Waits up to thirty seconds for Timber, so the caller allows longer. */
			readTimberSettings: { params: TimberSettingsRequest; response: Answer<"readTimberSettings"> };
			/** Answers only when Timber has ended. It holds a lock and may wait on it, so the caller must not time it out. */
			saveTimberSettings: { params: TimberSettingsSaveRequest; response: Answer<"saveTimberSettings"> };
			/** Waits up to thirty seconds for Timber's login check, so the caller allows longer. */
			checkTimberConnection: { params: TimberConnectionCheckRequest; response: Answer<"checkTimberConnection"> };
			/** The main process stops Timber after ten seconds, inside the default time limit. */
			listWorkflows: { params: { repository: string }; response: Answer<"listWorkflows"> };
			/** The main process stops Timber after thirty seconds and Git after ten, so the caller allows longer. */
			readIssueTrackers: { params: { repository: string }; response: Answer<"readIssueTrackers"> };
			/** The main process stops Timber after thirty seconds, so the caller allows longer. */
			readPullRequests: { params: { repository: string }; response: Answer<"readPullRequests"> };
			readIssue: { params: IssueRequest; response: Answer<"readIssue"> };
			/** The main process stops Timber after thirty seconds, so the caller allows longer. */
			searchIssues: { params: IssueSearchRequest; response: Answer<"searchIssues"> };
			/** The main process stops Timber after thirty seconds, so the caller allows longer. */
			listIssues: { params: IssueListRequest; response: Answer<"listIssues"> };
			/** The main process stops Timber after thirty seconds, so the caller allows longer. */
			readBackups: { params: { repository: string }; response: Answer<"readBackups"> };
			/** Answers only when Timber has ended, after it copied every file back, so the caller must not time it out. */
			restoreBackup: { params: BackupRestoreRequest; response: Answer<"restoreBackup"> };
			/** As `restoreBackup`: no time limit. */
			deleteBackup: { params: BackupDeleteRequest; response: Answer<"deleteBackup"> };
			/** The main process stops Timber after thirty seconds, so the caller allows longer. */
			listArenas: { params: { repository: string }; response: Answer<"listArenas"> };
			/** As `listArenas`. */
			listArenaPresets: { params: { repository: string }; response: Answer<"listArenaPresets"> };
			/** As `listArenas`. */
			inspectArena: { params: { repository: string; arena: string }; response: Answer<"inspectArena"> };
			/** Answers only when Timber and every attempt's setup have ended, so the caller must not time it out. */
			newArena: { params: NewArenaRequest; response: Answer<"newArena"> };
			/** Answers only when Timber has archived and removed the other attempts, so the caller must not time it out. */
			pickArena: { params: PickArenaRequest; response: Answer<"pickArena"> };
			previewDone: { params: DonePreviewRequest; response: Answer<"previewDone"> };
			/** Answers only when Timber has ended. Scripts that run before deletion take as long as they take, so the caller must not time it out. */
			applyDone: { params: DoneApplyRequest; response: Answer<"applyDone"> };
			readFileChanges: { params: FileChangesRequest; response: Answer<"readFileChanges"> };
			readFileDiff: { params: FileDiffRequest; response: Answer<"readFileDiff"> };
			readWorktreeFile: { params: WorktreeFileRequest; response: Answer<"readWorktreeFile"> };
			readPorts: { params: PortsRequest; response: Answer<"readPorts"> };
			listChops: { params: ChopsRequest; response: Answer<"listChops"> };
			runChop: { params: RunChopRequest; response: Answer<"runChop"> };
			listTerminals: { params: {}; response: Answer<"listTerminals"> };
			takeSavedSessions: { params: {}; response: Answer<"takeSavedSessions"> };
			forgetSavedSessions: { params: { worktrees: string[] }; response: Answer<"forgetSavedSessions"> };
			openTerminal: { params: OpenTerminalRequest; response: Answer<"openTerminal"> };
			readTerminal: { params: { id: string }; response: Answer<"readTerminal"> };
			renameTerminal: { params: { id: string; name: string }; response: Answer<"renameTerminal"> };
			closeTerminal: { params: { id: string }; response: Answer<"closeTerminal"> };
			pasteTerminal: { params: { id: string; text: string }; response: Answer<"pasteTerminal"> };
			confirmQuit: { params: {}; response: Answer<"confirmQuit"> };
			writeClipboard: { params: { text: string }; response: Answer<"writeClipboard"> };
			readClipboard: { params: {}; response: Answer<"readClipboard"> };
			openLink: { params: { url: string }; response: Answer<"openLink"> };
			fetchStatuses: { params: {}; response: Answer<"fetchStatuses"> };
			/** Answers only when the fetch has ended, which can take minutes, so the caller must not time it out. */
			fetchNow: { params: { repository: string }; response: Answer<"fetchNow"> };
			uninstallPlan: { params: {}; response: Answer<"uninstallPlan"> };
			/** The main process stops a stuck uninstaller after a minute, so the caller allows longer. The app quits right after a good answer. */
			uninstall: { params: UninstallRequest; response: Answer<"uninstall"> };
			restartPlan: { params: {}; response: Answer<"restartPlan"> };
			/** Ending every session can take a moment, so the caller allows longer. When it works, the app quits before it answers. */
			restart: { params: {}; response: Answer<"restart"> };
			appUpdate: { params: {}; response: Answer<"appUpdate"> };
			checkForAppUpdate: { params: {}; response: Answer<"checkForAppUpdate"> };
			/** Ending every session can take a moment, so the caller allows longer. When it works, the app quits before it answers. */
			installAppUpdate: { params: AppUpdateInstallRequest; response: Answer<"installAppUpdate"> };
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
			/** The chops file in a repository's main checkout may have changed. `repository` is its primary checkout. */
			chopsChanged: { repository: string };
			/** Part of what a session printed. */
			terminalOutput: TerminalOutput;
			terminalChanged: TerminalChange;
			/** The person clicked the desktop notification of a session: show it. */
			showSession: { id: string };
			/** `timber new` in a terminal handed over the worktree it created: open its session. */
			worktreeHandedOff: WorktreeHandoff;
			/** Where fetching stands for a repository. */
			fetchChanged: RepositoryFetch;
			/** The Timber status changed without being asked, for example a newer release came out. Ask `timberStatus` for it. */
			timberChanged: {};
			/** Where updating the app stands changed. */
			appUpdateChanged: AppUpdateState;
		};
	}>;
};
