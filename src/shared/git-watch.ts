/**
 * Which file events in a repository's common Git directory mean that the
 * sidebar may be out of date. Pure, so it can be tested without a file system.
 *
 * The main process watches four places (see src/bun/repository-watcher.ts):
 *
 * - `common`: the common Git directory itself, not recursively.
 * - `refs`: its `refs` folder, recursively.
 * - `worktrees`: its `worktrees` folder, recursively, where each linked
 *   worktree keeps its HEAD, index, and lock.
 * - `reftable`: its `reftable` folder, for a repository that keeps refs there.
 *
 * Only names that can change what the app shows count. Lock files, logs, and
 * the scratch files of a commit, merge, or rebase in progress are left out, so
 * a long operation causes as few events as possible.
 */
export type WatchedArea = "common" | "refs" | "worktrees" | "reftable";

/** The entries of the common Git directory whose change can alter the list or a branch's state. */
const COMMON_NAMES: ReadonlySet<string> = new Set([
	"HEAD",
	"index",
	"packed-refs",
	// Upstream settings live here.
	"config",
	"FETCH_HEAD",
	"ORIG_HEAD",
	// Created or removed as a whole: the first linked worktree, or a repository moving to reftable.
	"worktrees",
	"refs",
	"reftable",
]);

/** The entries of a linked worktree's folder in `worktrees/<name>` that count. */
const WORKTREE_NAMES: ReadonlySet<string> = new Set(["HEAD", "index", "locked", "gitdir"]);

/**
 * Whether an event for `name`, relative to the watched folder of `area`, can
 * change what the app shows. A missing name means the platform did not say
 * which entry changed, so it counts.
 */
export function isRelevantChange(area: WatchedArea, name: string | null | undefined): boolean {
	if (name === null || name === undefined || name === "") return true;
	const parts = name.replace(/\\/g, "/").split("/").filter(part => part !== "");
	const last = parts[parts.length - 1];
	if (last === undefined) return true;
	if (last.endsWith(".lock")) return false;
	switch (area) {
		case "common":
			return parts.length === 1 && COMMON_NAMES.has(last);
		case "refs":
		case "reftable":
			return true;
		case "worktrees":
			// The folder of a worktree appearing or going, or one of the entries that count inside it.
			return parts.length === 1 || (parts.length === 2 && WORKTREE_NAMES.has(last));
	}
}
