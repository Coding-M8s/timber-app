import type { Layout } from "./layout";
import type { AddRepositoryResult, BranchSuggestion, NewWorktreeRequest, OpenWorktreeRequest, RemoveRepositoryResult, Repository, SaveLayoutResult, TimberStatus, WorktreeCommandResult } from "./model";
import type { DoneApplyRequest, DoneApplyResult, DonePreviewRequest, DonePreviewResult } from "./timber-done";

/**
 * Everything the interface may ask of the machine it runs on.
 *
 * The interface only ever talks to this contract. The desktop app answers it
 * from the Bun main process; the browser build answers it from sample data.
 * Grow it one capability at a time, and keep every method safe to call again.
 */
export interface Engine {
	/** Whether a usable Timber is installed, as of the last look. */
	timberStatus(): Promise<TimberStatus>;
	/** Look for Timber again, for example after the person installed it. */
	recheckTimber(): Promise<TimberStatus>;
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
	 * How the window was arranged when the layout was last saved: the sidebar
	 * width and the collapsed repository groups. The defaults when nothing was
	 * saved yet.
	 */
	loadLayout(): Promise<Layout>;
	/**
	 * Remember the layout for the next run. The whole layout is given each time,
	 * so the latest call wins. Removing a repository also forgets its collapsed
	 * group.
	 */
	saveLayout(layout: Layout): Promise<SaveLayoutResult>;
}
