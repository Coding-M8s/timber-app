import type { Preferences } from "./preferences";

/**
 * Whether a usable Timber is installed. Everything that runs Timber depends on
 * this being "ready".
 */
export type TimberStatus =
	| { state: "ready"; path: string; version: string }
	/** No Timber answered. `override` is the development override's value when it was set. */
	| { state: "not-found"; override: string | null }
	| { state: "too-old"; path: string; found: string; required: string };

/** How a branch stands against its upstream, as of the last fetch. */
export type SyncState =
	/** No upstream is configured: the branch has never been published. */
	| { kind: "unpublished" }
	/** An upstream is configured, but its remote-tracking ref no longer exists. */
	| { kind: "gone"; upstream: string }
	| { kind: "tracking"; upstream: string; ahead: number; behind: number };

/**
 * The files Timber found changed in a worktree. The paths are relative to the
 * worktree, as Git reports them. Unknown when Timber could not read the
 * folder, for example because it is missing; `reason` is Timber's own wording.
 */
export type WorktreeChanges =
	| { kind: "known"; modified: string[]; untracked: string[] }
	| { kind: "unknown"; reason: string };

/** One worktree, as `timber ls --json` lists it. */
export interface Worktree {
	/**
	 * Identity: the repository's common Git directory plus the worktree's
	 * canonical path (see `worktreeId`). Compare worktrees by this, never by
	 * branch or label.
	 */
	id: string;
	/** The path registered with Git, verbatim. The exact selector for Timber commands. */
	path: string;
	/** The path with links resolved. Null when Timber could not verify the folder. */
	canonicalPath: string | null;
	/** Exact branch name, or null on a detached HEAD. */
	branch: string | null;
	/** Null on a branch with no commit yet. */
	head: string | null;
	/** The primary checkout. Timber never removes it. */
	primary: boolean;
	detached: boolean;
	locked: boolean;
	prunable: boolean;
	/** False when the folder was missing when Timber looked. */
	pathExists: boolean;
	changes: WorktreeChanges;
	/**
	 * How the branch stands against its upstream, read from Git because Timber
	 * does not report it. Null on a detached HEAD, or when Git could not say.
	 */
	sync: SyncState | null;
}

/**
 * The identity of a worktree. Timber gives a canonical path only for a folder
 * it verified. Otherwise the registered path stands in, marked as such, so a
 * missing or replaced folder never shares an identity with a verified one.
 */
export function worktreeId(commonGitDir: string, worktree: { path: string; canonicalPath: string | null }): string {
	return worktree.canonicalPath === null
		? [commonGitDir, "registered", worktree.path].join("\0")
		: [commonGitDir, "verified", worktree.canonicalPath].join("\0");
}

export interface Repository {
	/** Absolute path of the primary checkout. */
	path: string;
	name: string;
	/**
	 * False when the saved folder is missing or Git can no longer read it as a
	 * primary checkout. The repository then stays listed, with no worktrees.
	 */
	available: boolean;
	/**
	 * Why Timber could not list the worktrees on the latest read, or null when
	 * it did. A failed read carries no worktrees of its own: the engine answers
	 * with none, and the interface keeps showing the last good list.
	 */
	failure: string | null;
	worktrees: Worktree[];
}

/** What came of asking to add a repository through the folder picker. */
export type AddRepositoryResult =
	| { outcome: "added"; repository: Repository }
	/** The picked folder belongs to a repository in the list. `repository` is its path there. */
	| { outcome: "already-listed"; repository: string }
	| { outcome: "not-a-repository"; folder: string }
	/** The person closed the picker without choosing. */
	| { outcome: "cancelled" }
	/** The list comes from the development override, so the app does not change it. */
	| { outcome: "overridden" }
	| { outcome: "failed"; message: string };

/** What came of asking to forget a repository. Nothing on disk changes either way. */
export type RemoveRepositoryResult =
	| { outcome: "removed" }
	| { outcome: "overridden" }
	| { outcome: "failed"; message: string };

/** What came of asking to remember the layout. A failure never changes what is on screen. */
export type SaveLayoutResult =
	| { outcome: "saved" }
	| { outcome: "failed"; message: string };

/** How saving a change to the preferences ended. Saved carries every preference as saved, not only the changed ones. */
export type SavePreferencesResult =
	| { outcome: "saved"; preferences: Preferences }
	| { outcome: "failed"; message: string };

/**
 * What a Timber command printed, standard output and standard error together
 * in the order they arrived. It is limited in size: when the command printed
 * more, only the end is kept and `truncated` is true.
 *
 * Private: setup scripts can print anything, so this is shown to the person
 * and never written to a log.
 */
export interface CapturedOutput {
	text: string;
	truncated: boolean;
}

/** A Timber command that failed, as every dialog reports it. */
export interface TimberFailure {
	/** The command as it was shown before it ran. Null when the failure came before any command ran. */
	command: string | null;
	/** Why it failed: the diagnostic from Timber's record, or the app's own words when there is no usable record. */
	diagnostic: string;
	/** Null when nothing was captured, for example because the command never started. */
	output: CapturedOutput | null;
}

/** What to create with `timber new`. */
export interface NewWorktreeRequest {
	/** The path of the repository's primary checkout. Timber runs there. */
	repository: string;
	/** A branch name, a sentence, or a ticket, as the person typed it. Timber decides what branch it becomes. */
	name: string;
	/** The ref to start from, or null to let Timber pick its configured base. */
	base: string | null;
}

/** What to open with `timber open`. */
export interface OpenWorktreeRequest {
	/** The path of the repository's primary checkout. Timber runs there. */
	repository: string;
	/** A branch, a ticket, or the exact registered path of a worktree (`Worktree.path`). */
	selector: string;
	/** Run the setup scripts again in a worktree that already exists. */
	setup: boolean;
}

/** The worktree a Timber command reported: enough to find it in the list and to name it to Timber again. */
export interface ReportedWorktree {
	/** The same identity the list uses (`Worktree.id`). */
	id: string;
	/** The path registered with Git, verbatim. The exact selector for a later Timber command. */
	path: string;
	/** Exact branch name, or null on a detached HEAD. */
	branch: string | null;
}

/**
 * How `timber new` or `timber open` ended, as the interface needs it.
 *
 * `created` is true when this run made a worktree that Timber verified. A
 * failure with `created` true means the worktree exists and only what came
 * after, such as a setup script, did not finish: offer to run setup again in
 * `worktree`, never to start over. A failure with `worktree` null says
 * nothing about what exists, so read the list again.
 */
export type WorktreeCommandResult =
	| { outcome: "succeeded"; worktree: ReportedWorktree; created: boolean }
	/** The person closed Timber's own chooser before anything was changed. */
	| { outcome: "cancelled" }
	| { outcome: "failed"; failure: TimberFailure; worktree: ReportedWorktree | null; created: boolean };

/** A branch offered for picking wherever a branch is typed. Only a suggestion: any text may be typed instead. */
export interface BranchSuggestion {
	/**
	 * The name as it is shown and as it is given to Timber: a local branch by
	 * its name, a remote-tracking branch as `<remote>/<branch>`.
	 */
	selector: string;
	kind: "local" | "remote";
}
