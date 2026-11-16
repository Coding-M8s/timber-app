import type { FileChangesRequest, FileChangesResult, FileDiffRequest, FileDiffResult } from "./file-changes";
import type { Layout } from "./layout";
import type { AddRepositoryResult, BranchSuggestion, NewWorktreeRequest, OpenInEditorRequest, OpenInEditorResult, OpenWorktreeRequest, RemoveRepositoryResult, Repository, SaveLayoutResult, SavePreferencesResult, TimberStatus, WorktreeCommandResult } from "./model";
import type { Preferences } from "./preferences";
import type { OpenTerminalRequest, OpenTerminalResult, TerminalChange, TerminalOutput, TerminalSession, TerminalSnapshot } from "./terminal";
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
	 * `rows` are the pane's size.
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
}
