import { type ChangeArea, type ChangeKind, type FileChange, MAX_LISTED_FILES } from "../shared/file-changes";
import { KIND_LABELS } from "./changes-format";

/**
 * The Git status marks of the file explorer's rows: a letter on each changed
 * file and a dot on each folder above one. Pure, so it can be tested without
 * a window. The store reads the uncommitted changes with `readFileChanges`,
 * always as `git status` lists them whatever the Changes view compares with,
 * and keeps these marks on the worktree's tree (see ./file-tree.ts).
 */

export interface TreeMarks {
	/** The kind of each changed path on disk, relative to the worktree, by `/`. */
	files: Readonly<Record<string, ChangeKind>>;
	/** How many changed paths are somewhere below each folder. A folder with none is not here. */
	folders: Readonly<Record<string, number>>;
	/** Whether the list was cut at `MAX_LISTED_FILES`, so some changes may have no mark. */
	more: boolean;
}

/** Which entry of a path gives its one mark: a conflict first, then what is staged, then what is not. */
const AREA_RANK: Record<ChangeArea, number> = { conflicted: 0, staged: 1, base: 2, unstaged: 3, untracked: 4 };

/**
 * The marks of a change list. A file staged and edited again has one mark,
 * the staged kind; a conflict wins over everything. Deleted files have no
 * row, as the tree lists what is on disk, so they get no mark and no folder
 * counts them: a file deleted on disk is left out, and so is a deletion only
 * staged, which leaves the file's mark to what is on disk now. A folder Git
 * reports as one entry, such as a nested repository, is marked under its
 * path without the slash.
 */
export function treeMarks(changes: readonly FileChange[], more: boolean): TreeMarks {
	const byPath = new Map<string, FileChange[]>();
	for (const change of changes) {
		const path = change.path.replace(/\/+$/, "");
		if (path === "") continue;
		const entries = byPath.get(path);
		if (entries) entries.push(change);
		else byPath.set(path, [change]);
	}
	const files: Record<string, ChangeKind> = {};
	const folders: Record<string, number> = {};
	for (const [path, entries] of byPath) {
		if (entries.some(entry => entry.kind === "deleted" && entry.area !== "staged")) continue;
		const shown = entries.filter(entry => entry.kind !== "deleted").sort((a, b) => AREA_RANK[a.area] - AREA_RANK[b.area])[0];
		if (!shown) continue;
		files[path] = shown.kind;
		for (let slash = path.indexOf("/"); slash !== -1; slash = path.indexOf("/", slash + 1)) {
			const folder = path.slice(0, slash);
			folders[folder] = (folders[folder] ?? 0) + 1;
		}
	}
	return { files, folders, more };
}

/** What one row shows: a changed path's letter, a folder's count of changes below it, or nothing. */
export type RowMark = { kind: "file"; change: ChangeKind } | { kind: "folder"; count: number };

/** The mark of the row at `path`. A folder that is itself a change, such as a nested repository, shows its letter. */
export function rowMark(marks: TreeMarks | undefined, path: string, folder: boolean): RowMark | null {
	if (!marks) return null;
	const change = marks.files[path];
	if (change !== undefined) return { kind: "file", change };
	const count = folder ? marks.folders[path] ?? 0 : 0;
	return count > 0 ? { kind: "folder", count } : null;
}

export function describeChangedCount(count: number): string {
	return `${count.toLocaleString("en-US")} changed ${count === 1 ? "file" : "files"}`;
}

/** The words a screen reader hears, and the tooltip says, for a row's mark. */
export function describeRowMark(mark: RowMark): string {
	return mark.kind === "file" ? KIND_LABELS[mark.change] : describeChangedCount(mark.count);
}

/** Said under the tree when the change list was cut short. */
export const MARKS_INCOMPLETE_NOTE = `More than ${MAX_LISTED_FILES.toLocaleString("en-US")} files changed, so some may have no mark.`;

/** Whether two reads gave the same marks, so the tree need not change. */
export function sameTreeMarks(a: TreeMarks | undefined, b: TreeMarks): boolean {
	if (!a || a.more !== b.more) return false;
	const same = (x: Readonly<Record<string, unknown>>, y: Readonly<Record<string, unknown>>) => {
		const keys = Object.keys(x);
		return keys.length === Object.keys(y).length && keys.every(key => x[key] === y[key]);
	};
	return same(a.files, b.files) && same(a.folders, b.folders);
}
