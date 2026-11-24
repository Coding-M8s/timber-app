import { describeCommandLine } from "../shared/command-line";
import { type GitCommand, type IndexAction, describeGitCommand, indexActionOf } from "../shared/index-writes";
import {
	type BaseComparison, type ChangeArea, type ChangeKind, type Comparison, type FileChange, type FileChangeTarget, type FileDiff, isCommitHash, MAX_DIFF_BYTES, MAX_DIFF_LINES, MAX_LISTED_FILES, sameFileChange, shortCommit,
} from "../shared/file-changes";

/**
 * Words and keyboard rules of the Changes view. Pure, so they can be tested
 * without a window.
 */

/**
 * The groups of the list, in the order they show. Conflicts come first: they
 * block a commit. Comparing with the last commit lists staged, unstaged, and
 * untracked files, comparing with the base lists changed and untracked ones.
 */
export const AREA_ORDER: readonly ChangeArea[] = ["conflicted", "staged", "unstaged", "base", "untracked"];

export const AREA_TITLES: Record<ChangeArea, string> = {
	conflicted: "Merge conflicts",
	staged: "Staged",
	unstaged: "Unstaged",
	base: "Changed",
	untracked: "Untracked",
};

/** How the heading counts the files of each group, such as "2 staged". */
const AREA_COUNTS: Record<ChangeArea, string> = {
	conflicted: "conflicted",
	staged: "staged",
	unstaged: "unstaged",
	base: "changed",
	untracked: "untracked",
};

/** The choices of the "Compare with" switch, in order. */
export const COMPARISONS: readonly Comparison[] = ["base", "uncommitted"];

export const COMPARISON_LABELS: Record<Comparison, string> = {
	base: "Base",
	uncommitted: "Uncommitted",
};

/** A commit as the list's header and the commands show it. */
export { shortCommit };

/**
 * What the list's header says is compared, such as `origin/main @ a1b2c3d`,
 * with a sentence for its tooltip. `compared` is the comparison the files
 * came from. A commit base that is the branch point itself shows once, as
 * `a1b2c3d`; one the branch left earlier shows both, as `a1b2c3d @ 9f8e7d6`.
 */
export function describeComparison(compared: Comparison, base: BaseComparison | null): { text: string; title: string } {
	if (compared === "base" && base?.usable) {
		const point = shortCommit(base.commit);
		if (isCommitHash(base.ref)) {
			if (base.ref === base.commit) {
				return { text: base.name, title: `Everything this branch changed since commit ${base.name}, its saved base, committed or not.` };
			}
			return {
				text: `${base.name} @ ${point}`,
				title: `Everything this branch changed since it left the history of commit ${base.name} at ${point}, committed or not. Commits between ${point} and ${base.name} are left out.`,
			};
		}
		return {
			text: `${base.name} @ ${point}`,
			title: `Everything this branch changed since it left ${base.name} at ${point}, committed or not. Later commits on ${base.name} are left out.`,
		};
	}
	return { text: "Last commit", title: "What changed since the last commit: staged, unstaged, and untracked files." };
}

/** Why Base cannot be chosen, or null when it can, or before the first read answered. */
export function baseUnavailable(base: BaseComparison | null): string | null {
	return base !== null && !base.usable ? `Base is not available: ${base.reason}` : null;
}

/** What the tab says when nothing changed. */
export function describeNoChanges(compared: Comparison, base: BaseComparison | null): string {
	if (compared === "base" && base?.usable) {
		const point = shortCommit(base.commit);
		if (isCommitHash(base.ref)) {
			if (base.ref === base.commit) return `This branch matches commit ${base.name}, its saved base. Nothing is untracked.`;
			return `This branch matches ${point}, where it left the history of commit ${base.name}. Nothing is untracked.`;
		}
		return `This branch matches ${base.name} at ${point}, where it started. Nothing is untracked.`;
	}
	return "This worktree matches its last commit. Nothing is staged or untracked.";
}

/** The words beside the diff's file name: the kind, and the group unless the kind already says it. */
export function describeFileArea(file: Pick<FileChange, "area" | "kind">): string {
	if (file.area === "conflicted" || file.area === "untracked") return KIND_LABELS[file.kind];
	if (file.area === "base") return `${KIND_LABELS[file.kind]} since the base`;
	return `${KIND_LABELS[file.kind]}, ${AREA_TITLES[file.area].toLowerCase()}`;
}

/** The letter beside a file, as Git and VS Code show it. */
export const KIND_LETTERS: Record<ChangeKind, string> = {
	modified: "M",
	added: "A",
	deleted: "D",
	renamed: "R",
	copied: "C",
	"type-changed": "T",
	untracked: "U",
	conflicted: "!",
};

export const KIND_LABELS: Record<ChangeKind, string> = {
	modified: "Modified",
	added: "Added",
	deleted: "Deleted",
	renamed: "Renamed",
	copied: "Copied",
	"type-changed": "Type changed",
	untracked: "Untracked",
	conflicted: "Conflicted",
};

/** The color a kind is drawn in: yellow for edits, green for new files, red for removals and conflicts. */
export function kindTone(kind: ChangeKind): "modified" | "untracked" | "removed" {
	if (kind === "added" || kind === "untracked" || kind === "copied") return "untracked";
	if (kind === "deleted" || kind === "conflicted") return "removed";
	return "modified";
}

/** The non-empty groups of the list, each in Git's order. */
export function groupFileChanges(files: readonly FileChange[]): { area: ChangeArea; files: FileChange[] }[] {
	return AREA_ORDER
		.map(area => ({ area, files: files.filter(file => file.area === area) }))
		.filter(group => group.files.length > 0);
}

/** The files in the order the list shows them, for moving through it by keyboard. */
export const listedOrder = (files: readonly FileChange[]) => groupFileChanges(files).flatMap(group => group.files);

/**
 * Where a file is in the list after it was staged or unstaged: its first
 * entry with that path, in the list's order. Undefined when it left the
 * list, as a conflict resolved to the last commit's text does.
 */
export function movedEntry(files: readonly FileChange[], path: string): FileChange | undefined {
	return listedOrder(files).find(file => file.path === path);
}

/** A path as its file name and the folder it is in, which is empty at the top of the worktree. */
export function splitPath(path: string): { name: string; folder: string } {
	const slash = path.lastIndexOf("/");
	return slash < 0 ? { name: path, folder: "" } : { name: path.slice(slash + 1), folder: path.slice(0, slash) };
}

/** What the list's heading says about the files, such as "2 staged, 5 unstaged". */
export function describeFileCounts(files: readonly FileChange[], more: boolean): string {
	if (files.length === 0) return "No changes";
	const parts = groupFileChanges(files).map(group => `${group.files.length} ${AREA_COUNTS[group.area]}`);
	return more ? `${parts.join(", ")}, and more` : parts.join(", ");
}

/** A key for a changed file, unique in a list of changes. */
export const fileKey = (file: FileChangeTarget) => `${file.area}\0${file.path}\0${file.previousPath ?? ""}`;

/** A file's line counts as its row shows them, `+12` and `-3`, or null when Git counted none, as for a binary file. */
export function describeLineCounts(file: Pick<FileChange, "added" | "removed">): { added: string; removed: string } | null {
	return file.added === null || file.removed === null ? null : { added: `+${file.added}`, removed: `-${file.removed}` };
}

/** The lines added and removed in all the files that have counts. */
export function totalLineCounts(files: readonly Pick<FileChange, "added" | "removed">[]): { added: number; removed: number } {
	let [added, removed] = [0, 0];
	for (const file of files) {
		added += file.added ?? 0;
		removed += file.removed ?? 0;
	}
	return { added, removed };
}

/** The counts as a screen reader says them, such as "12 lines added, 3 removed". Empty without counts. */
export function speakLineCounts(file: Pick<FileChange, "added" | "removed">): string {
	if (file.added === null || file.removed === null) return "";
	return `${file.added} ${file.added === 1 ? "line" : "lines"} added, ${file.removed} removed`;
}

/** The files whose path holds the typed text, ignoring case. Nothing typed keeps every file. */
export function filterFiles<T extends Pick<FileChange, "path">>(files: readonly T[], typed: string): T[] {
	const wanted = typed.trim().toLowerCase();
	return wanted === "" ? [...files] : files.filter(file => file.path.toLowerCase().includes(wanted));
}

/** What the filter's status says: nothing without a filter, else how many files match. */
export function describeFilterResult(shown: number, total: number, typed: string): string {
	if (typed.trim() === "") return "";
	if (shown === 0) return `No changed file matches "${typed.trim()}".`;
	return `${shown} of ${total} ${total === 1 ? "file" : "files"} ${shown === 1 ? "matches" : "match"}`;
}

/** The file `step` places after or before `current` in `order`, going round at either end. Null when there is no other file. */
export function steppedFile<T extends FileChangeTarget>(order: readonly T[], current: FileChangeTarget | null, step: 1 | -1): T | null {
	if (order.length === 0) return null;
	const index = current === null ? -1 : order.findIndex(file => sameFileChange(file, current));
	if (index < 0) return step === 1 ? order[0]! : order[order.length - 1]!;
	if (order.length === 1) return null;
	return order[(index + step + order.length) % order.length]!;
}

export const PREVIOUS_FILE = "Previous file";
export const NEXT_FILE = "Next file";

/** Said after the previous or next file opens, so a screen reader hears where the keyboard went. */
export const describeSteppedTo = (file: Pick<FileChange, "path">, position: number, total: number) => `${file.path}, file ${position} of ${total}`;

/** Said once, politely, while the Changes view reads again what is already on screen. */
export const REFRESHING_CHANGES = "Refreshing…";

/**
 * One refresh of a worktree's Changes view, from the first read to a moment
 * after the last. `overList` says whether it began with a list on screen and
 * still has one: only then is the list dimmed and "Refreshing" said. A first
 * read, or the read of the other comparison's list, has no list to refresh,
 * and the bar says "Reading changes" for it.
 */
export interface RefreshSpan {
	worktree: string | null;
	overList: boolean;
}

export const NO_REFRESH: RefreshSpan = { worktree: null, overList: false };

/** The span after a render that is `active` (reading, or just done) for `worktree`, with or without a list on screen. */
export function nextRefreshSpan(previous: RefreshSpan, worktree: string, active: boolean, listShown: boolean): RefreshSpan {
	if (!active) return NO_REFRESH;
	// A new span, or another worktree: it is over a list only if one shows as it starts.
	if (previous.worktree !== worktree) return { worktree, overList: listShown };
	// A list that goes, as on a switch of "Compare with", does not come back as refreshed in this span.
	const overList = previous.overList && listShown;
	return overList === previous.overList ? previous : { worktree, overList };
}

export const MORE_FILES_NOTE = `Only the first ${MAX_LISTED_FILES.toLocaleString("en-US")} changed files are listed. Run git status in a terminal to see them all.`;

/** The file a key moves to in the list: the arrows step, Home and End jump. Null for any other key, or an empty list. */
export function fileAfterKey(order: readonly FileChange[], current: FileChangeTarget | null, key: string): FileChange | null {
	if (order.length === 0) return null;
	const index = current === null ? -1 : order.findIndex(file => sameFileChange(file, current));
	switch (key) {
		case "ArrowDown":
			return order[Math.min(index + 1, order.length - 1)]!;
		case "ArrowUp":
			return order[Math.max(index - 1, 0)]!;
		case "Home":
			return order[0]!;
		case "End":
			return order[order.length - 1]!;
		default:
			return null;
	}
}

/**
 * The Git command that shows the same diff in a terminal. Only for showing.
 * A file changed since the base needs the branch point, `commit`.
 */
export function diffCommand(file: Pick<FileChange, "area" | "kind" | "path" | "previousPath">, commit: string | null = null): string {
	if (file.kind === "untracked") return describeCommandLine(["git", "diff", "--no-index", "--", "/dev/null", file.path]);
	const paths = file.previousPath === null ? [file.path] : [file.previousPath, file.path];
	const against = file.area === "staged" ? ["--cached"] : file.area === "base" && commit !== null ? [commit] : [];
	return describeCommandLine(["git", "diff", ...against, "--", ...paths]);
}

/** What shows in place of a diff that has no lines to draw. Null for a diff with lines. `commit` is the branch point, as for `diffCommand`. */
export function describeDiffNotice(diff: FileDiff, file: FileChange, commit: string | null = null): { title: string; text: string } | null {
	switch (diff.kind) {
		case "binary":
			return { title: "Binary file", text: "Git treats this file as binary, so there are no lines to compare. Open it in your editor to look at it." };
		case "too-large": {
			const size = diff.lines === null
				? `more than ${Math.round(MAX_DIFF_BYTES / 1024)} KiB`
				: `${diff.lines.toLocaleString("en-US")} lines, more than ${MAX_DIFF_LINES.toLocaleString("en-US")}`;
			return { title: "This diff is too large to show", text: `It is ${size}. Run ${diffCommand(file, commit)} in a terminal to see it.` };
		}
		case "unchanged":
			return { title: "No longer changed", text: "This file has no changes here any more. The list updates with the worktree." };
		case "text": {
			const empty = diff.sections.every(section => section.hunks.length === 0);
			if (!empty) return null;
			if (file.kind === "untracked" || file.kind === "added") return { title: "Empty file", text: "The new file has no content." };
			// A rename or a change of mode alone: its header lines say what changed.
			const header = diff.sections.some(section => section.header.length > 0);
			return header ? null : { title: "No line changes", text: "Only the file's details changed." };
		}
	}
}

/** The key on a focused file that stages or unstages it, as its button does. */
export const INDEX_KEY = " ";
/** The key as docs/design.md names it, and as a file's `aria-keyshortcuts` says it. */
export const INDEX_KEY_NAME = "Space";

/** What a file's button does and says: Stage, Unstage, or Mark resolved for a conflict, which is what `git add` does to it. Null where it has none. */
export function fileIndexAction(file: Pick<FileChange, "area">): { action: IndexAction; label: string } | null {
	const action = indexActionOf(file.area);
	if (action === null) return null;
	if (file.area === "conflicted") return { action, label: "Mark resolved" };
	return { action, label: action === "stage" ? "Stage" : "Unstage" };
}

/** What a group's button does and says: Stage all, Unstage all, or Mark all resolved. Null for Base's Changed group. */
export function groupIndexAction(area: ChangeArea): { action: IndexAction; label: string } | null {
	const one = fileIndexAction({ area });
	if (one === null) return null;
	return { action: one.action, label: area === "conflicted" ? "Mark all resolved" : `${one.label} all` };
}

/** A write button's tooltip: the exact command it runs, before it runs. */
export const describeIndexCommand = (command: GitCommand) => `Runs ${describeGitCommand(command)}`;

/** Said when a stage or unstage did not happen, as the list's alert title. */
export const INDEX_WRITE_FAILED: Record<IndexAction, string> = {
	stage: "Could not stage",
	unstage: "Could not unstage",
};
