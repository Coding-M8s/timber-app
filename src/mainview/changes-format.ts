import { describeCommandLine } from "../shared/command-line";
import { type ChangeArea, type ChangeKind, type FileChange, type FileChangeTarget, type FileDiff, MAX_DIFF_BYTES, MAX_DIFF_LINES, MAX_LISTED_FILES, sameFileChange } from "../shared/file-changes";

/**
 * Words and keyboard rules of the Changes tab. Pure, so they can be tested
 * without a window.
 */

/** The groups of the list, in the order they show. Conflicts come first: they block a commit. */
export const AREA_ORDER: readonly ChangeArea[] = ["conflicted", "staged", "unstaged"];

export const AREA_TITLES: Record<ChangeArea, string> = {
	conflicted: "Merge conflicts",
	staged: "Staged",
	unstaged: "Unstaged",
};

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

/** A path as its file name and the folder it is in, which is empty at the top of the worktree. */
export function splitPath(path: string): { name: string; folder: string } {
	const slash = path.lastIndexOf("/");
	return slash < 0 ? { name: path, folder: "" } : { name: path.slice(slash + 1), folder: path.slice(0, slash) };
}

/** What the list's heading says about the files, such as "2 staged, 5 unstaged". */
export function describeFileCounts(files: readonly FileChange[], more: boolean): string {
	if (files.length === 0) return "No changes";
	const parts = groupFileChanges(files).map(group => `${group.files.length} ${group.area === "conflicted" ? "conflicted" : group.area}`);
	return more ? `${parts.join(", ")}, and more` : parts.join(", ");
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

/** The Git command that shows the same diff in a terminal. Only for showing. */
export function diffCommand(file: Pick<FileChange, "area" | "kind" | "path" | "previousPath">): string {
	if (file.kind === "untracked") return describeCommandLine(["git", "diff", "--no-index", "--", "/dev/null", file.path]);
	const paths = file.previousPath === null ? [file.path] : [file.previousPath, file.path];
	return describeCommandLine(["git", "diff", ...(file.area === "staged" ? ["--cached"] : []), "--", ...paths]);
}

/** What shows in place of a diff that has no lines to draw. Null for a diff with lines. */
export function describeDiffNotice(diff: FileDiff, file: FileChange): { title: string; text: string } | null {
	switch (diff.kind) {
		case "binary":
			return { title: "Binary file", text: "Git treats this file as binary, so there are no lines to compare. Open it in your editor to look at it." };
		case "too-large": {
			const size = diff.lines === null
				? `more than ${Math.round(MAX_DIFF_BYTES / 1024)} KiB`
				: `${diff.lines.toLocaleString("en-US")} lines, more than ${MAX_DIFF_LINES.toLocaleString("en-US")}`;
			return { title: "This diff is too large to show", text: `It is ${size}. Run ${diffCommand(file)} in a terminal to see it.` };
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
