import type { CapturedOutput, Repository, SyncState, TimberStatus, Worktree } from "../shared/model";
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
export function folderName(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** The toast after a repository was added to the list. */
export const describeAdded = (name: string) => `Added ${name}`;

/** The toast after a repository was taken off the list. It says "from the list" because nothing on disk changed. */
export const describeRemoved = (name: string) => `Removed ${name} from the list`;

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
	if (sync.forcePushed) return `${sync.upstream} was rewritten: ${sync.ahead} ahead, ${sync.behind} behind`;
	if (sync.ahead > 0 && sync.behind > 0) return `${sync.ahead} ahead, ${sync.behind} behind ${sync.upstream}`;
	if (sync.ahead > 0) return `${sync.ahead} to push to ${sync.upstream}`;
	if (sync.behind > 0) return `${sync.behind} to pull from ${sync.upstream}`;
	return `In sync with ${sync.upstream}`;
}

/**
 * One plain sentence for how a worktree's branch stands against its upstream,
 * or null on a detached HEAD, which has none. A branch Git could not answer
 * about says so, so that it is never taken for up to date.
 */
export function describeWorktreeSync(worktree: Worktree): string | null {
	if (worktree.branch === null) return null;
	return worktree.sync ? describeSync(worktree.sync) : "Sync unknown";
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

/** The short line under a worktree's name: which kind of checkout it is. */
export function describeWorktreeKind(worktree: Worktree): string {
	return worktree.primary ? "Primary checkout" : "Worktree";
}

/** Everything a worktree row can be marked with. */
export type RowMarkerKind =
	| "behind"
	| "ahead"
	| "local-only"
	| "upstream-gone"
	| "force-pushed"
	| "sync-unknown"
	| "detached"
	| "folder-missing"
	| "status-unknown"
	| "locked"
	| "prunable"
	| "modified"
	| "untracked";

/** One thing worth knowing about a worktree at a glance. */
export interface RowMarker {
	kind: RowMarkerKind;
	/** Where in the row it sits: beside the branch name, on the line below it, or with the change counts. */
	place: "branch" | "state" | "changes";
	/** What the row shows. For "behind" and "ahead" this is the count alone, and the row draws the arrow. */
	text: string;
	/** A whole sentence in plain words, for the tooltip and for assistive technology. */
	tooltip: string;
}

const counted = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;

/** End a text that came from elsewhere with a full stop, unless it already ends a sentence. */
const asSentence = (text: string) => /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;

/** How the branch stands against its upstream. A detached HEAD has no branch, so it has none of these. */
function syncMarkers(worktree: Worktree): RowMarker[] {
	if (worktree.branch === null) return [];
	const { sync } = worktree;
	const marker = (kind: RowMarkerKind, text: string, tooltip: string): RowMarker => ({ kind, place: "branch", text, tooltip });
	// Not knowing is said, so that it is never read as "nothing to push or pull".
	if (sync === null) return [marker("sync-unknown", "sync unknown", "Git could not say how this branch stands against its upstream. It may have commits to push or to pull.")];
	if (sync.kind === "unpublished") return [marker("local-only", "local only", "This branch has no upstream. It has not been published.")];
	if (sync.kind === "gone") return [marker("upstream-gone", "upstream gone", `The upstream branch ${sync.upstream} no longer exists, as of the last fetch.`)];
	const markers: RowMarker[] = [];
	// First: a rewritten upstream changes what pulling or pushing would do.
	if (sync.forcePushed) {
		markers.push(marker("force-pushed", "force-pushed", `The upstream branch ${sync.upstream} was rewritten, for example by a force-push: commits that were on it are no longer there. Look before you pull or push. This goes once you have selected this worktree and moved on.`));
	}
	if (sync.behind > 0) markers.push(marker("behind", String(sync.behind), `${counted(sync.behind, "commit")} to pull from ${sync.upstream}, as of the last fetch.`));
	if (sync.ahead > 0) markers.push(marker("ahead", String(sync.ahead), `${counted(sync.ahead, "commit")} to push to ${sync.upstream}, as of the last fetch.`));
	return markers;
}

/**
 * Everything a worktree row is marked with, in the order the row shows it. A
 * clean worktree on a branch that is level with its upstream has no markers.
 *
 * A status or an upstream state that could not be read always gets a marker
 * of its own, so a row without markers never means "not known".
 */
export function describeRowMarkers(worktree: Worktree): RowMarker[] {
	const { changes } = worktree;
	const markers = syncMarkers(worktree);
	const state = (kind: RowMarkerKind, text: string, tooltip: string) => void markers.push({ kind, place: "state", text, tooltip });

	if (worktree.branch === null) {
		const where = worktree.head ? ` The folder is at commit ${worktree.head.slice(0, 7)}.` : "";
		state("detached", "detached HEAD", `No branch is checked out here.${where}`);
	}
	if (!worktree.pathExists) {
		const unknown = changes.kind === "unknown" ? " Its status is unknown." : "";
		state("folder-missing", "folder missing", `The folder is missing: ${worktree.path}.${unknown}`);
	} else if (changes.kind === "unknown") {
		state("status-unknown", "status unknown", `Timber could not read this worktree, so it may hold changes. Timber says: ${asSentence(changes.reason)}`);
	}
	if (worktree.locked) state("locked", "locked", "Locked: Git will not prune, move, or remove this worktree until it is unlocked.");
	// A missing folder is why Git calls a worktree prunable, so that marker alone says it.
	if (worktree.prunable && worktree.pathExists) {
		state("prunable", "prunable", "Prunable: Git considers the record of this worktree stale, and git worktree prune would remove the record.");
	}

	if (changes.kind === "known") {
		const modified = changes.modified.length;
		const untracked = changes.untracked.length;
		if (modified > 0) {
			markers.push({ kind: "modified", place: "changes", text: `${modified}M`, tooltip: `${counted(modified, "file")} with uncommitted changes: modified, added, deleted, or renamed.` });
		}
		if (untracked > 0) {
			markers.push({ kind: "untracked", place: "changes", text: `${untracked}U`, tooltip: `${counted(untracked, "untracked file")}: new, and not added to Git.` });
		}
	}
	return markers;
}

/** Every marker's sentence in one text: what a row tells assistive technology beyond its name. */
export function describeRow(markers: readonly RowMarker[]): string {
	return markers.map(marker => marker.tooltip).join(" ");
}

/** What to say on a repository whose worktrees Timber could not list. */
export const TIMBER_LIST_FAILURE_TITLE = `${TIMBER_LS_COMMAND} failed`;

/** Said beside captured output wherever it is shown. */
export const OUTPUT_PRIVACY_NOTE = "This can hold private content from setup scripts. It is shown here only and is not written to any log.";

/** The line above captured output: what it is, and whether the start is missing. */
export function describeOutput(output: CapturedOutput): string {
	if (output.text.trim() === "") return "The command printed nothing.";
	return output.truncated ? "The command printed more than is kept. This is the end of it." : "What the command printed.";
}
