import type { Worktree } from "../shared/model";
import { type RebaseResult, shortBase } from "../shared/timber-rebase";
import type { SubmissionOutcome } from "./store/submission";

/**
 * The words of the Rebase dialog. Pure. They say how a rebase ended, as
 * Timber's record does.
 */

/** Under the Onto field. */
export const REBASE_ONTO_HINT =
	"It starts as the base Timber saved for this worktree, when Timber reports one. Leave it empty to pass no base: Timber then chooses, starting with the saved one. A base given here is saved by Timber for next time. A remote branch is fetched first; a local branch, refs/heads/<name>, is used as it is.";

/** Timber's own warning, before anything runs. */
export const REBASE_REWRITES = "Rebasing rewrites the branch's commits, including ones already pushed.";

/** Shown when the list knows of files that Timber refuses to rebase with. Timber decides; the dialog does not block. */
export const REBASE_DIRTY_NOTE =
	"The list shows modified or untracked files here. Timber refuses to rebase a worktree that has any, until they are committed or moved away.";

/** The Rebase control's tooltip. */
export const REBASE_CONTROL_TITLE = "Rebase this worktree with Timber";

/** The Rebase control's tooltip when the worktree's folder is missing. */
export const REBASE_FOLDER_MISSING = "The worktree's folder is missing, so a rebase cannot start there.";

/** Whether the list shows files that Timber would refuse to rebase with. Unknown changes say nothing. */
export function hasLocalChanges(worktree: Worktree): boolean {
	const { changes } = worktree;
	return changes.kind === "known" && (changes.modified.length > 0 || changes.untracked.length > 0);
}

/** What the dialog does under its title when Timber reports how the rebase ended. */
export const REBASE_REPORTS_RESULT =
	"Timber rebases this worktree, and this dialog shows how it ended. A rebase that stops on conflicts stays paused for you to resolve in a terminal in this worktree.";

/** Above Timber's reason when it refused to start. */
export const REBASE_REFUSED_TITLE = "Timber refused the rebase";

/** Below a refusal. Timber refuses before it changes anything. */
export const REBASE_REFUSED_NOTE = "Nothing was changed.";

/** Above the reason when the rebase failed. */
export const REBASE_FAILED_TITLE = "The rebase failed";

/** Below a failure. A failed rebase can have changed the branch, so it does not say that nothing changed. */
export const REBASE_FAILED_NOTE =
	"The list was read again. Check the branch and the worktree before you try again, because a failed rebase can leave them changed.";

/** Above the reason when the app refused before it ran anything. */
export const REBASE_NOT_RUN_TITLE = "The rebase did not run";

/** The toast when the branch was rebased. */
export function describeRebased(label: string, base: string | null): string {
	return `Rebased ${label} onto ${shortBase(base)}`;
}

/** The toast when there was nothing to rebase. */
export function describeUpToDate(label: string, base: string | null): string {
	return `${label} is already up to date with ${shortBase(base)}`;
}

/** The title of the dialog once the rebase stopped on conflicts. */
export function describeConflictsTitle(label: string): string {
	return `Rebase of ${label} stopped on conflicts`;
}

/** What the conflicts view says about where things stand. What to do next follows it, with the Git commands set as code. */
export function describeConflictsAdvice(base: string | null): string {
	return `Git paused the rebase onto ${shortBase(base)}, and it was left exactly as Git left it: the app ran no Git command.`;
}

/** Why a rebase that ran left the dialog open, to choose the words above its failure. */
export type RebaseFailureKind = "refused" | "failed" | "not-run";

/** A rebase that stopped on conflicts, as `readRebaseResult` reports it. */
export type RebaseConflicts = Extract<RebaseResult, { outcome: "conflicts" }>;

/** What the dialog does with one answer. */
export interface RebaseShown {
	/** What the submission comes to: a toast that closes the dialog, or a failure that keeps it open. */
	outcome: SubmissionOutcome;
	/** Which words go above a failure. Null when the dialog closes or switches to the conflicts view. */
	failureKind: RebaseFailureKind | null;
	/** Set when the dialog switches to the conflicts view. */
	conflicts: RebaseConflicts | null;
}

/**
 * How the dialog shows each way a rebase can end. A rebase or an up to date
 * branch closes the dialog with a toast. Conflicts switch it to the list of
 * files. Everything else stays open with Timber's reason, or the app's own
 * words when it never ran Timber.
 */
export function presentRebase(label: string, result: RebaseResult): RebaseShown {
	switch (result.outcome) {
		case "rebased":
			return { outcome: { ok: true, toast: describeRebased(label, result.base) }, failureKind: null, conflicts: null };
		case "up-to-date":
			return { outcome: { ok: true, toast: describeUpToDate(label, result.base) }, failureKind: null, conflicts: null };
		case "conflicts":
			return { outcome: { ok: false, failure: result.failure }, failureKind: null, conflicts: result };
		case "refused":
			return { outcome: { ok: false, failure: result.failure }, failureKind: "refused", conflicts: null };
		case "failed":
			// A run that never started changed nothing, so the words for a failed rebase do not fit it.
			return { outcome: { ok: false, failure: result.failure }, failureKind: result.ran ? "failed" : "not-run", conflicts: null };
	}
}
