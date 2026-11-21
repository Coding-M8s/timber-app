import type { SavedBase, SavedBaseProblem } from "../shared/model";
import { shortCommit } from "../shared/file-changes";
import { savedBaseSelector } from "../shared/rebase-command";

/**
 * The words for the base Timber saved for a worktree. Pure. They say only
 * what Timber reported: a base is never inferred from branches or history.
 */

export interface SavedBaseDescription {
	/** The short form, for the workspace header and the row's tooltip. */
	text: string;
	/** A whole sentence in plain words. */
	sentence: string;
	/** True when saved metadata exists and cannot be used, so the base is not known. */
	warning: boolean;
}

const PROBLEMS: Record<SavedBaseProblem, string> = {
	malformed: "it is not in the form Timber expects",
	stale: "it does not match this worktree, or Timber could not verify the worktree",
	unreadable: "it could not be read",
};

/** The short marker for metadata Timber cannot use. Shown in the row, the header, and the Rebase dialog. */
export const SAVED_BASE_UNKNOWN = "base unknown";

/** Why the base is not known, as one sentence. */
export function describeInvalidBase(reason: SavedBaseProblem): string {
	return `Timber found a saved base for this worktree but cannot use it: ${PROBLEMS[reason]}. The base is not known, and the app does not guess one.`;
}

/**
 * What to show for a worktree's saved base, or null when Timber's record did
 * not say, as with a Timber from before the field. Null means show nothing.
 */
export function describeSavedBase(base: SavedBase | null): SavedBaseDescription | null {
	if (base === null) return null;
	switch (base.kind) {
		case "assigned": {
			const selector = savedBaseSelector(base.ref);
			return { text: `Base ${selector}`, sentence: `Timber rebases this worktree onto ${selector}, the base saved for it.`, warning: false };
		}
		case "commit": {
			const commit = shortCommit(base.commit);
			return { text: `Base ${commit}`, sentence: `Timber rebases this worktree onto commit ${commit}, the base saved for it.`, warning: false };
		}
		case "unassigned":
			return { text: "No saved base", sentence: "Timber has no base saved for this worktree.", warning: false };
		case "invalid":
			return { text: "Base unknown", sentence: describeInvalidBase(base.reason), warning: true };
	}
}

/**
 * The tooltip of a worktree row: its path, after it the saved base when
 * Timber reported one, then the linked issue's short form when there is one
 * (see `issueTitlePart` in ./issue-format.ts). One line.
 */
export function describeRowTitle(worktree: { path: string; base: SavedBase | null }, issue: string | null = null): string {
	const base = describeSavedBase(worktree.base);
	return [worktree.path, ...[base?.text, issue].filter(part => part != null).map(part => `(${part})`)].join(" ");
}

/** What the Rebase dialog says about the saved base, above its Onto field. Null when Timber did not report one. */
export function describeRebaseBase(base: SavedBase | null): { text: string; warning: boolean } | null {
	if (base === null) return null;
	switch (base.kind) {
		case "assigned":
			return { text: `Timber saved ${savedBaseSelector(base.ref)} as the base of this worktree, so Onto starts from it.`, warning: false };
		case "commit":
			return { text: `Timber saved commit ${shortCommit(base.commit)} as the base of this worktree, so Onto starts from its full hash.`, warning: false };
		case "unassigned":
			return { text: "No saved base: Timber has none for this worktree. With Onto left empty, Timber picks a base from its settings.", warning: false };
		case "invalid":
			return { text: `${describeInvalidBase(base.reason)} Onto is left empty. Timber decides whether a base given here can replace it.`, warning: true };
	}
}
