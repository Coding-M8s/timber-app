import type { BranchSuggestion, SavedBase } from "./model";
import type { TerminalSession } from "./terminal";

/**
 * The interim `timber rebase` the app runs, until Timber has a machine
 * interface for it. Pure: the Rebase dialog words the command from the same
 * function the main process runs it from (`timberRebase` in
 * src/bun/terminals.ts), so the command shown is the command that runs.
 *
 * The command runs in a Timber session in the worktree, so the person sees
 * what Timber prints. The app never reads that output and never says how the
 * rebase went.
 */

/** Rebase one worktree. Named as for "Open in editor". */
export interface StartRebaseRequest {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. It is the selector given to Timber. */
	worktree: string;
	/** What to rebase onto, given to Timber as `--base`. Null for the base Timber saved for the worktree. */
	onto: string | null;
	/** The size of the pane the session will show in. */
	cols: number;
	rows: number;
}

export type StartRebaseResult =
	/** The command started in a new session. How it ends is only what Timber prints there. */
	| { outcome: "started"; session: TerminalSession }
	/** Nothing was run, and the message says why. */
	| { outcome: "not-run"; message: string }
	/** Only the interface answers this: the engine did not answer, so whether the session started is not known. */
	| { outcome: "unknown"; message: string };

/**
 * Everything after `timber`: the option first, then `--`, then the
 * worktree's registered path as one argument, so a path that starts with a
 * dash is never read as an option.
 */
export function rebaseArguments(request: Pick<StartRebaseRequest, "worktree" | "onto">): string[] {
	const base = request.onto === null ? [] : ["--base", request.onto];
	return ["rebase", ...base, "--", request.worktree];
}

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
