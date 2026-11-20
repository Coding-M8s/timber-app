import type { BranchSuggestion, SavedBase } from "./model";

/**
 * What the Rebase dialog offers and passes as the base. Pure. The command
 * itself is built by `rebaseResultArguments` in ./timber-rebase.ts.
 */

/** What was typed as the base: the spaces around it are left off, and nothing at all means the saved base. */
export function ontoFromText(text: string): string | null {
	const onto = text.trim();
	return onto === "" ? null : onto;
}

/**
 * The branches to offer as a base, in the form Timber takes for `--base`.
 * Timber reads a plain name as a branch on a remote, so a local branch is
 * offered by its full ref, `refs/heads/<name>`. A remote-tracking branch is
 * offered as `<remote>/<branch>`, which Timber fetches before it rebases.
 */
export function rebaseBases(branches: readonly BranchSuggestion[]): BranchSuggestion[] {
	return branches.map(branch => branch.kind === "local" ? { ...branch, selector: `refs/heads/${branch.selector}` } : { ...branch });
}

const REMOTE_REF = "refs/remotes/";

/**
 * A saved base in the form Timber takes for `--base` and prints in its own
 * list, which is also the form `rebaseBases` offers: a remote-tracking ref
 * `refs/remotes/<remote>/<branch>` as `<remote>/<branch>`, and a local
 * branch by its full ref, `refs/heads/<name>`, as saved. Any other ref is
 * left as it is.
 */
export function savedBaseSelector(ref: string): string {
	return ref.startsWith(REMOTE_REF) && ref.length > REMOTE_REF.length ? ref.slice(REMOTE_REF.length) : ref;
}

/**
 * What the Rebase dialog's Onto field starts as: the saved base, in the form
 * Timber takes, or nothing. Only a base Timber reported as assigned is ever
 * filled in. No saved base, unusable metadata, and a Timber that does not
 * report bases all leave the field empty.
 */
export function initialOnto(base: SavedBase | null): string {
	return base?.kind === "assigned" ? savedBaseSelector(base.ref) : "";
}
