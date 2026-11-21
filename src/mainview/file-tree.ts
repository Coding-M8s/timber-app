import type { FolderEntry } from "../shared/worktree-folders";

/**
 * The file explorer's tree: what is listed of each folder, which folders are
 * open, the rows that show, and where the keyboard goes. Pure, so it can be
 * tested without a window. The store reads the folders (see
 * ./store/store.ts) and the panel draws the rows (see
 * ./components/FilesPanel.tsx).
 */

/** One folder as last read. `entries` stays while it is read again, so the tree does not flicker. */
export interface FolderListing {
	entries: readonly FolderEntry[] | null;
	/** How many entries past the cap are not listed. */
	more: number;
	reading: boolean;
	/** Why the last read failed, or null. */
	failure: string | null;
}

/** The tree of one worktree. */
export interface WorktreeTree {
	repository: string;
	/** The worktree's registered path, which every read names. */
	worktree: string;
	/** The open folders, relative to the worktree. The worktree's own folder, "", is always open. */
	expanded: readonly string[];
	/** By folder, "" for the worktree's own. A folder not here was never read. */
	listings: Readonly<Record<string, FolderListing>>;
}

export interface FileTreeState {
	/** Whether entries Git ignores show. Not saved: each start hides them. */
	showIgnored: boolean;
	/** By the worktree's identity (`Worktree.id`). Kept in the window only, and forgotten when the worktree leaves the list. */
	trees: Readonly<Record<string, WorktreeTree>>;
}

export const emptyFileTree = (): FileTreeState => ({ showIgnored: false, trees: {} });

export const readingListing = (before?: FolderListing): FolderListing => ({ entries: before?.entries ?? null, more: before?.more ?? 0, reading: true, failure: null });

/** The folders whose listing is kept and shown: the worktree's own, and each open one whose parents are open too. */
export function shownFolders(tree: WorktreeTree): string[] {
	const open = new Set(tree.expanded);
	const shown = (folder: string): boolean => {
		const slash = folder.lastIndexOf("/");
		return slash === -1 ? open.has(folder) : open.has(folder) && shown(folder.slice(0, slash));
	};
	return ["", ...tree.expanded.filter(folder => folder !== "" && shown(folder))];
}

/** The tree with a folder opened, or closed with every folder below it. */
export function withFolder(tree: WorktreeTree, folder: string, open: boolean): WorktreeTree {
	if (folder === "") return tree;
	const below = (other: string) => other === folder || other.startsWith(`${folder}/`);
	const expanded = open
		? tree.expanded.includes(folder) ? tree.expanded : [...tree.expanded, folder]
		: tree.expanded.filter(other => !below(other));
	if (expanded === tree.expanded) return tree;
	// A closed folder is read again when it opens, so what it held is not kept.
	const listings = open ? tree.listings : Object.fromEntries(Object.entries(tree.listings).filter(([other]) => !below(other)));
	return { ...tree, expanded, listings };
}

export type TreeRow =
	| {
		kind: "entry";
		/** The entry's path, which names the row. */
		id: string;
		entry: FolderEntry;
		/** 1 for an entry of the worktree's own folder. */
		level: number;
		/** For a folder, whether it is open. Null for a file or a link. */
		expanded: boolean | null;
		/** Its place among its folder's entries, from 1, and how many there are, for a screen reader. */
		position: number;
		count: number;
	}
	/** A line under an open folder that is not an entry: it is being read, it could not be, it is empty, or more are not shown. */
	| { kind: "note"; id: string; level: number; text: string; failure: boolean };

/** How many entries past the cap are not shown, as the last row of a folder says it. */
export function describeMore(more: number): string {
	return `${more.toLocaleString("en-US")} more not shown`;
}

/** The rows that show, in order: each open folder followed by its entries, deeper ones indented. */
export function treeRows(tree: WorktreeTree): TreeRow[] {
	const rows: TreeRow[] = [];
	const open = new Set(tree.expanded);
	const add = (folder: string, level: number) => {
		const listing = tree.listings[folder];
		const noteId = (what: string) => `${what}:${folder}`;
		if (!listing || listing.entries === null) {
			if (listing?.failure) rows.push({ kind: "note", id: noteId("failure"), level, text: listing.failure, failure: true });
			else rows.push({ kind: "note", id: noteId("reading"), level, text: "Reading", failure: false });
			return;
		}
		if (listing.failure) rows.push({ kind: "note", id: noteId("failure"), level, text: listing.failure, failure: true });
		if (listing.entries.length === 0 && listing.more === 0) rows.push({ kind: "note", id: noteId("empty"), level, text: "Empty", failure: false });
		listing.entries.forEach((entry, index) => {
			const isFolder = entry.kind === "folder";
			const expanded = isFolder ? open.has(entry.path) : null;
			rows.push({ kind: "entry", id: entry.path, entry, level, expanded, position: index + 1, count: listing.entries!.length });
			if (expanded) add(entry.path, level + 1);
		});
		if (listing.more > 0) rows.push({ kind: "note", id: noteId("more"), level, text: describeMore(listing.more), failure: false });
	};
	// The worktree's own folder is not a row: its entries are the first level.
	const root = tree.listings[""];
	if (root?.entries !== null && root !== undefined) add("", 1);
	return rows;
}

/** What a key does in the tree, by the WAI-ARIA tree pattern. */
export type TreeKeyAction =
	| { kind: "focus"; id: string }
	| { kind: "open-folder"; path: string }
	| { kind: "close-folder"; path: string }
	| { kind: "open-file"; path: string };

/** The folder a row is in, or null for the first level. */
function parentRowIndex(rows: readonly TreeRow[], index: number): number | null {
	const level = rows[index]!.level;
	for (let at = index - 1; at >= 0; at--) if (rows[at]!.level < level) return at;
	return null;
}

/**
 * What a key does on the row `focused`, or null when the tree does not take
 * it. Down and Up move a row, Home and End to the first and last. Right
 * opens a closed folder and moves into an open one; Left closes an open
 * folder and moves out to the folder a row is in. Enter opens a file, and
 * opens or closes a folder. A row that is gone counts as the first.
 */
export function treeKeyAction(rows: readonly TreeRow[], focused: string | null, key: string): TreeKeyAction | null {
	if (rows.length === 0) return null;
	const found = focused === null ? -1 : rows.findIndex(row => row.id === focused);
	const index = Math.max(0, found);
	const row = rows[index]!;
	const focus = (at: number): TreeKeyAction => ({ kind: "focus", id: rows[at]!.id });
	switch (key) {
		case "ArrowDown":
			return focus(found === -1 ? 0 : Math.min(rows.length - 1, index + 1));
		case "ArrowUp":
			return focus(Math.max(0, index - 1));
		case "Home":
			return focus(0);
		case "End":
			return focus(rows.length - 1);
		case "ArrowRight":
			if (row.kind !== "entry" || row.expanded === null) return null;
			if (!row.expanded) return { kind: "open-folder", path: row.id };
			return index + 1 < rows.length && rows[index + 1]!.level > row.level ? focus(index + 1) : null;
		case "ArrowLeft": {
			if (row.kind === "entry" && row.expanded === true) return { kind: "close-folder", path: row.id };
			const parent = parentRowIndex(rows, index);
			return parent === null ? null : focus(parent);
		}
		case "Enter":
			if (row.kind !== "entry") return null;
			if (row.expanded === null) return { kind: "open-file", path: row.id };
			return { kind: row.expanded ? "close-folder" : "open-folder", path: row.id };
		default:
			return null;
	}
}

/** The row to focus after the rows changed: the same one, else the nearest one before it that still shows, else the first. */
export function keptFocus(before: readonly TreeRow[], after: readonly TreeRow[], focused: string | null): string | null {
	if (after.length === 0) return null;
	if (focused !== null && after.some(row => row.id === focused)) return focused;
	const was = focused === null ? -1 : before.findIndex(row => row.id === focused);
	for (let at = was - 1; at >= 0; at--) {
		const id = before[at]!.id;
		if (after.some(row => row.id === id)) return id;
	}
	return after[0]!.id;
}
