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

export interface WorktreeStatus {
	/** Tracked files with staged or unstaged changes, each counted once. */
	modified: number;
	untracked: number;
	sync: SyncState;
}

export interface Worktree {
	/** Absolute path. Unique across repositories, so it doubles as the identity. */
	path: string;
	/** Short branch name, or null on a detached HEAD. */
	branch: string | null;
	head: string | null;
	/** The primary checkout. Timber never removes it. */
	primary: boolean;
	locked: boolean;
	prunable: boolean;
	/** Null when the folder is missing or Git could not read it. */
	status: WorktreeStatus | null;
}

export interface Repository {
	/** Absolute path of the primary checkout. */
	path: string;
	name: string;
	worktrees: Worktree[];
}
