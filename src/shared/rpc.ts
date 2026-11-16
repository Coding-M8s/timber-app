import type { RPCSchema } from "electrobun/view";
import type { Layout } from "./layout";
import type { AddRepositoryResult, BranchSuggestion, NewWorktreeRequest, OpenInEditorRequest, OpenInEditorResult, OpenWorktreeRequest, RemoveRepositoryResult, Repository, SaveLayoutResult, SavePreferencesResult, TimberStatus, WorktreeCommandResult } from "./model";
import type { Preferences } from "./preferences";
import type { DoneApplyRequest, DoneApplyResult, DonePreviewRequest, DonePreviewResult } from "./timber-done";

/**
 * The typed bridge between the Bun main process and the interface.
 * Types only: both sides import this file and it emits no runtime code.
 * Keep it in step with `Engine` in ./engine.ts.
 */
export type AppRPC = {
	bun: RPCSchema<{
		requests: {
			timberStatus: { params: {}; response: TimberStatus };
			recheckTimber: { params: {}; response: TimberStatus };
			listRepositories: { params: {}; response: Repository[] };
			/** Answers only when the folder picker closes, so the caller must not time it out. */
			addRepository: { params: {}; response: AddRepositoryResult };
			removeRepository: { params: { path: string }; response: RemoveRepositoryResult };
			loadRepository: { params: { path: string }; response: Repository | null };
			listBranches: { params: { repository: string }; response: BranchSuggestion[] | null };
			/** Answers only when Timber and its setup scripts have ended, so the caller must not time it out. */
			newWorktree: { params: NewWorktreeRequest; response: WorktreeCommandResult };
			/** As `newWorktree`: no time limit. */
			openWorktree: { params: OpenWorktreeRequest; response: WorktreeCommandResult };
			loadLayout: { params: {}; response: Layout };
			saveLayout: { params: { layout: Layout }; response: SaveLayoutResult };
			loadPreferences: { params: {}; response: Preferences };
			savePreferences: { params: { change: Partial<Preferences> }; response: SavePreferencesResult };
			openInEditor: { params: OpenInEditorRequest; response: OpenInEditorResult };
			previewDone: { params: DonePreviewRequest; response: DonePreviewResult };
			/** Answers only when Timber has ended. Scripts that run before deletion take as long as they take, so the caller must not time it out. */
			applyDone: { params: DoneApplyRequest; response: DoneApplyResult };
		};
		messages: {};
	}>;
	webview: RPCSchema<{
		requests: {};
		messages: {
			/** A repository changed. `path` is its primary checkout. */
			repositoryChanged: { path: string };
		};
	}>;
};
