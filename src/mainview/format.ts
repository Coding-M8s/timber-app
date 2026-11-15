import type { SyncState, Worktree } from "../shared/model";

/** The name shown for a worktree: its branch, or a short commit when detached. */
export function worktreeLabel(worktree: Worktree): string {
	if (worktree.branch) return worktree.branch;
	return worktree.head ? `detached at ${worktree.head.slice(0, 7)}` : "detached";
}

/** One plain sentence for how a branch stands against its upstream. */
export function describeSync(sync: SyncState): string {
	if (sync.kind === "unpublished") return "Not published yet";
	if (sync.kind === "gone") return `Upstream ${sync.upstream} was deleted`;
	if (sync.ahead > 0 && sync.behind > 0) return `${sync.ahead} ahead, ${sync.behind} behind ${sync.upstream}`;
	if (sync.ahead > 0) return `${sync.ahead} to push to ${sync.upstream}`;
	if (sync.behind > 0) return `${sync.behind} to pull from ${sync.upstream}`;
	return `In sync with ${sync.upstream}`;
}

/** One plain sentence for the working tree, or null when Git could not read it. */
export function describeChanges(worktree: Worktree): string | null {
	if (!worktree.status) return null;
	const { modified, untracked } = worktree.status;
	if (modified === 0 && untracked === 0) return "Clean";
	return `${modified} modified, ${untracked} untracked`;
}
