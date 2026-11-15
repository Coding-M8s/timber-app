import type { Repository, SyncState, TimberStatus, Worktree } from "../shared/model";
import { REQUIRED_TIMBER_VERSION, TIMBER_OVERRIDE_VARIABLE } from "../shared/timber-version";

/** The command Timber's own quick start gives for installing and for updating. */
export const TIMBER_INSTALL_COMMAND = "curl -fsSL https://github.com/Coding-M8s/timber/releases/latest/download/install.sh | sh";
export const TIMBER_INSTALL_GUIDE = "https://github.com/Coding-M8s/timber#quick-start";

export interface TimberProblem {
	title: string;
	text: string;
	/** The line above the install command. */
	action: string;
}

/** What to tell the person when Timber is not usable, or null when it is ready. */
export function describeTimberProblem(status: TimberStatus): TimberProblem | null {
	switch (status.state) {
		case "ready":
			return null;
		case "too-old":
			return {
				title: "Timber is too old",
				text: `Found Timber ${status.found} at ${status.path}. Timber app needs ${status.required} or newer.`,
				action: "Update it with:",
			};
		case "not-found":
			return status.override
				? {
					title: "Timber did not answer at the override",
					text: `${TIMBER_OVERRIDE_VARIABLE} points to ${status.override}, but no Timber answered there. Correct it, or unset it to use the timber on your PATH.`,
					action: "To install Timber:",
				}
				: {
					title: "Timber is not installed",
					text: `Timber app needs the timber command, version ${REQUIRED_TIMBER_VERSION} or newer, on your PATH.`,
					action: "Install it with:",
				};
	}
}

/**
 * What to tell the person when a reload failed. `repository` is the path of
 * the one that was being reloaded, or null when it was everything.
 */
export function describeReloadError(
	error: { repository: string | null; message: string },
	repositories: readonly Repository[],
): { title: string; text: string } {
	const name = repositories.find(repository => repository.path === error.repository)?.name;
	return { title: name ? `Could not refresh ${name}` : "Could not refresh", text: error.message };
}

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
