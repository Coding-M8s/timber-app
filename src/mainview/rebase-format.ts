import type { Worktree } from "../shared/model";

/**
 * The words of the Rebase dialog. Pure. None of them says how a rebase went:
 * that is only what Timber prints in the session.
 */

/** What the dialog does, under its title. */
export const REBASE_RUNS_IN_TERMINAL =
	"The rebase runs in a new session in this worktree, beside any it has, so you see what Timber prints. If it stops on conflicts, Timber says what to run and the session ends: resolve them in a terminal here with git rebase --continue or --abort.";

/** Under the Onto field. */
export const REBASE_ONTO_HINT =
	"It starts as the base Timber saved for this worktree, when Timber reports one. Leave it empty to pass no base: Timber then chooses, starting with the saved one. A base given here is saved by Timber for next time. A remote branch is fetched first; a local branch, refs/heads/<name>, is used as it is.";

/** Timber's own warning, before anything runs. */
export const REBASE_REWRITES = "Rebasing rewrites the branch's commits, including ones already pushed.";

/** Shown when the list knows of files that Timber refuses to rebase with. Timber decides; the dialog does not block. */
export const REBASE_DIRTY_NOTE =
	"The list shows modified or untracked files here. Timber refuses to rebase a worktree that has any, until they are committed or moved away.";

/** The Rebase control's tooltip. */
export const REBASE_CONTROL_TITLE = "Rebase this worktree with Timber, in a new session";

/** The Rebase control's tooltip when the worktree's folder is missing. */
export const REBASE_FOLDER_MISSING = "The worktree's folder is missing, so a rebase cannot start there.";

/** Whether the list shows files that Timber would refuse to rebase with. Unknown changes say nothing. */
export function hasLocalChanges(worktree: Worktree): boolean {
	const { changes } = worktree;
	return changes.kind === "known" && (changes.modified.length > 0 || changes.untracked.length > 0);
}

/** The toast once the session started. It says only that it started. */
export function describeRebaseStarted(label: string): string {
	return `Started timber rebase in a new session in ${label}`;
}
