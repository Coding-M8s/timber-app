import type { BaseCounts, SavedBase, SavedBaseProblem } from "../shared/model";
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

const NBSP = "\u00a0";

const counted = (count: number) => `${count} ${count === 1 ? "commit" : "commits"}`;

/** How far a worktree is from its saved base, in the words the row and the header use. */
export interface BaseCountsDescription {
	/**
	 * The row's flag, such as "4 ahead, 1 behind base". Each part's spaces do
	 * not break, so in a narrow sidebar it wraps only after its comma.
	 */
	flag: string;
	/** What the header adds after the base, such as "4 ahead, 1 behind". */
	short: string;
	/** A whole sentence that names the base, for tooltips and assistive technology. */
	sentence: string;
}

/** The base as the counts' sentence names it: `origin/main`, `refs/heads/main` as the header shows it, or `commit a1b2c3d`. */
function countedBaseName(base: SavedBase): string | null {
	if (base.kind === "assigned") return savedBaseSelector(base.ref);
	if (base.kind === "commit") return `commit ${shortCommit(base.commit)}`;
	return null;
}

/**
 * The words for how far a worktree is from its saved base, or null when
 * there is nothing to show: no counts, counts Git could not read (the
 * header's sentence says that, see `describeSavedBase`), or a worktree level
 * with its base. A remote-tracking base is as of the last fetch.
 */
export function describeBaseCounts(base: SavedBase | null, counts: BaseCounts | null): BaseCountsDescription | null {
	if (base === null || counts === null || counts.kind !== "counted") return null;
	const name = countedBaseName(base);
	const { ahead, behind } = counts;
	if (name === null || (ahead === 0 && behind === 0)) return null;
	const fetched = base.kind === "assigned" && base.ref.startsWith("refs/remotes/") ? ", as of the last fetch" : "";
	if (ahead > 0 && behind > 0) {
		return { flag: `${ahead}${NBSP}ahead, ${behind}${NBSP}behind${NBSP}base`, short: `${ahead} ahead, ${behind} behind`, sentence: `${counted(ahead)} ahead of ${name} and ${behind} behind${fetched}.` };
	}
	if (ahead > 0) return { flag: `${ahead}${NBSP}ahead${NBSP}of${NBSP}base`, short: `${ahead} ahead`, sentence: `${counted(ahead)} ahead of ${name}${fetched}.` };
	return { flag: `${behind}${NBSP}behind${NBSP}base`, short: `${behind} behind`, sentence: `${counted(behind)} behind ${name}${fetched}.` };
}

/** Said in the header's base tooltip when Git could not count against the base. */
export const BASE_COUNTS_UNREADABLE = "The app could not count the commits between this worktree and its base, as when the base no longer exists.";

/**
 * What to show for a worktree's saved base, or null when Timber's record did
 * not say, as with a Timber from before the field. Null means show nothing.
 * With `counts`, the header's form: the base, then how far the worktree is
 * from it (see `describeBaseCounts`).
 */
export function describeSavedBase(base: SavedBase | null, counts: BaseCounts | null = null): SavedBaseDescription | null {
	const described = describeBaseOnly(base);
	if (described === null || counts === null) return described;
	if (counts.kind === "unreadable") return { ...described, sentence: `${described.sentence} ${BASE_COUNTS_UNREADABLE}` };
	const words = describeBaseCounts(base, counts);
	return words === null ? described : { ...described, text: `${described.text} · ${words.short}`, sentence: `${described.sentence} ${words.sentence}` };
}

function describeBaseOnly(base: SavedBase | null): SavedBaseDescription | null {
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
