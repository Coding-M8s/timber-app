import type { RPCSchema } from "electrobun/view";
import type { AddRepositoryResult, NewWorktreeRequest, OpenWorktreeRequest, RemoveRepositoryResult, Repository, TimberStatus, WorktreeCommandResult } from "./model";

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
			/** Answers only when Timber and its setup scripts have ended, so the caller must not time it out. */
			newWorktree: { params: NewWorktreeRequest; response: WorktreeCommandResult };
			/** As `newWorktree`: no time limit. */
			openWorktree: { params: OpenWorktreeRequest; response: WorktreeCommandResult };
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
