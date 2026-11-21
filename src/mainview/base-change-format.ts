import type { SavedBase } from "../shared/model";
import { shortCommit } from "../shared/file-changes";
import { savedBaseSelector } from "../shared/rebase-command";
import type { SetBaseResult } from "../shared/timber-base";
import type { SubmissionOutcome } from "./store/submission";

/**
 * The words of the Set base dialog and the control that opens it. Pure. They
 * say how `timber base --set` ended, as Timber's record does.
 */

/** Whether the worktree has a saved base to change, a ref or a commit, or none yet. Metadata Timber cannot use is not a base. */
function hasSavedBase(base: SavedBase | null): boolean {
	return base?.kind === "assigned" || base?.kind === "commit";
}

/** The control beside the Compare with switch. */
export function describeBaseAction(base: SavedBase | null): string {
	return hasSavedBase(base) ? "Change base…" : "Set base…";
}

/** The control's tooltip. */
export const BASE_ACTION_TITLE = "Save the base Timber keeps for this worktree, which Changes compares with";

/** The dialog's title. */
export function describeBaseDialogTitle(label: string, base: SavedBase | null): string {
	return hasSavedBase(base) ? `Change the base of ${label}` : `Set the base of ${label}`;
}

/** What the dialog does, under its title. */
export const BASE_CHANGES_ONLY_METADATA =
	"Timber saves this as the worktree's base. It changes only Timber's record of the base: the branch, its commits, and the files are left alone. Changes then compares with it.";

/** Under the Base field. */
export const BASE_FIELD_HINT =
	"A remote branch, such as origin/main, is checked against the remote without fetching, so it needs the network, and Changes can compare with it only once it is fetched. A local branch is given as refs/heads/<name>, and a commit by its full hash; both are checked here.";

/** Above Timber's reason when it refused. */
export const BASE_REFUSED_TITLE = "Timber refused the base";

/** Below a refusal. Timber refuses before it changes anything. */
export const BASE_REFUSED_NOTE = "Nothing was changed.";

/** Above the reason when the command failed. */
export const BASE_FAILED_TITLE = "Could not save the base";

/** Below a failure. The branch and files are never touched, but whether the saved base changed is Timber's to say. */
export const BASE_FAILED_NOTE =
	"The branch and its files were not touched. The list was read again, so the base it shows is the one saved now: check it before you try again.";

/** Above the reason when the app refused before it ran anything. */
export const BASE_NOT_RUN_TITLE = "The base was not saved";

/** Why the dialog was left open, to choose the words above its failure. */
export type BaseFailureKind = "refused" | "failed" | "not-run";

/** The toast once Timber saved the base: a ref in the form Timber takes, a commit by its short hash. */
export function describeBaseSaved(label: string, base: SavedBase & { kind: "assigned" | "commit" }): string {
	return `Saved ${base.kind === "assigned" ? savedBaseSelector(base.ref) : shortCommit(base.commit)} as the base of ${label}`;
}

/**
 * How the dialog shows each way `timber base --set` can end. A saved base
 * closes the dialog with a toast. Everything else stays open with Timber's
 * reason, or the app's own words when it never ran Timber, and the field
 * keeps what was typed.
 */
export function presentSetBase(label: string, result: SetBaseResult): { outcome: SubmissionOutcome; failureKind: BaseFailureKind | null } {
	switch (result.outcome) {
		case "set":
			return { outcome: { ok: true, toast: describeBaseSaved(label, result.current) }, failureKind: null };
		case "refused":
			return { outcome: { ok: false, failure: result.failure }, failureKind: "refused" };
		case "failed":
			return { outcome: { ok: false, failure: result.failure }, failureKind: result.ran ? "failed" : "not-run" };
	}
}
