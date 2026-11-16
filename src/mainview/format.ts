import type { Repository, SyncState, TimberStatus, Worktree } from "../shared/model";
import { TIMBER_LS_COMMAND } from "../shared/timber-ls";
import { REQUIRED_TIMBER_VERSION, TIMBER_OVERRIDE_VARIABLE } from "../shared/timber-version";
import type { ListNotice } from "./store/state";

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

/** The last part of a path, whichever separator it uses. */
function folderName(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** What Remove does, said wherever it is offered. */
export const REMOVE_REPOSITORY_HINT = "Removes it from this list only. Nothing on disk is changed.";

/**
 * What to tell the person when adding or removing a repository left the list
 * as it was. `problem` is false when nothing went wrong.
 */
export function describeListNotice(
	notice: ListNotice,
	repositories: readonly Repository[],
): { title: string; text: string; problem: boolean } {
	switch (notice.kind) {
		case "already-listed": {
			const name = repositories.find(repository => repository.path === notice.repository)?.name ?? folderName(notice.repository);
			return { title: `${name} is already in the list`, text: "That folder belongs to it, so nothing was added.", problem: false };
		}
		case "not-a-repository":
			return {
				title: "Not a Git repository",
				text: `${notice.folder} is not inside a Git repository. Pick a repository folder or one of its worktrees.`,
				problem: true,
			};
		case "overridden":
			return {
				title: "The list comes from TIMBER_APP_REPOS",
				text: "That variable is set, so the app shows its repositories and leaves the saved list alone. Unset it to add or remove repositories here.",
				problem: true,
			};
		case "failed":
			return {
				title: notice.action === "add" ? "Could not add the repository" : "Could not remove the repository",
				text: notice.message,
				problem: true,
			};
	}
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

/** One plain sentence for the working tree. When Timber could not read it, the sentence says why. */
export function describeChanges(worktree: Worktree): string {
	const { changes } = worktree;
	if (changes.kind === "unknown") return `Status unknown: ${changes.reason}`;
	const modified = changes.modified.length;
	const untracked = changes.untracked.length;
	if (modified === 0 && untracked === 0) return "Clean";
	return `${modified} modified, ${untracked} untracked`;
}

/**
 * The short line under a worktree's name: what kind it is, or what is unusual
 * about it. A missing folder and an unreadable status are always said.
 */
export function describeWorktreeState(worktree: Worktree): string {
	const notes: string[] = [];
	if (!worktree.pathExists) notes.push("folder missing");
	else if (worktree.changes.kind === "unknown") notes.push("status unknown");
	if (worktree.locked) notes.push("locked");
	// A missing folder is why Git calls a worktree prunable, so that alone says it.
	if (worktree.prunable && worktree.pathExists) notes.push("prunable");
	if (notes.length === 0) return worktree.primary ? "Primary checkout" : "Worktree";
	const text = notes.join(", ");
	return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The longer explanation of a worktree for a tooltip: its upstream state, or why its status is unknown. */
export function describeWorktreeDetail(worktree: Worktree): string {
	if (worktree.changes.kind === "unknown") return `${worktree.changes.reason}: ${worktree.path}`;
	return worktree.sync ? describeSync(worktree.sync) : worktree.path;
}

/** What to say on a repository whose worktrees Timber could not list. */
export const TIMBER_LIST_FAILURE_TITLE = `${TIMBER_LS_COMMAND} failed`;
