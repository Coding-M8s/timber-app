import { describe, expect, test } from "bun:test";
import { isRunChopShortcut } from "../src/mainview/run-chop-format";
import { DEFAULT_SHORTCUTS } from "../src/shared/shortcuts";
import { type FolderListing, type TreeRow, type WorktreeTree, describeMore, hasOpenFolder, keptFocus, shownFolders, treeKeyAction, treeRows, withAllClosed, withFolder } from "../src/mainview/file-tree";
import {
	FILES_PANEL_SHORTCUT, FILES_PANEL_SHORTCUT_MAC, describeFilesPanelEmpty, filesButtonHint, isFilesPanelShortcut,
} from "../src/mainview/files-panel-format";
import { isChopsPanelShortcut } from "../src/mainview/chops-panel-format";
import { isPaletteShortcut } from "../src/mainview/palette";
import { isWaitingShortcut } from "../src/mainview/waiting";
import type { FolderEntry } from "../src/shared/worktree-folders";

const file = (path: string, ignored = false): FolderEntry => ({ name: path.split("/").at(-1)!, path, kind: "file", ignored });
const folder = (path: string, ignored = false): FolderEntry => ({ ...file(path, ignored), kind: "folder" });
const listed = (...entries: FolderEntry[]): FolderListing => ({ entries, more: 0, reading: false, failure: null });

const tree = (change: Partial<WorktreeTree> = {}): WorktreeTree => ({
	repository: "/work/app",
	worktree: "/work/app-worktrees/feat",
	expanded: ["src"],
	listings: {
		"": listed(folder("docs"), folder("src"), file("README.md")),
		src: listed(folder("src/lib"), file("src/app.ts")),
	},
	...change,
});

const ids = (rows: readonly TreeRow[]) => rows.map(row => `${"  ".repeat(row.level - 1)}${row.kind === "note" ? `(${row.text})` : row.id}`);

describe("the rows of the file tree", () => {
	test("show each open folder's entries under it, one level deeper, with their place among them", () => {
		const rows = treeRows(tree());
		expect(ids(rows)).toEqual(["docs", "src", "  src/lib", "  src/app.ts", "README.md"]);
		expect(rows[1]).toMatchObject({ kind: "entry", expanded: true, position: 2, count: 3 });
		expect(rows[0]).toMatchObject({ expanded: false });
		expect(rows[4]).toMatchObject({ expanded: null, position: 3, count: 3 });
	});

	test("say when a folder is being read, could not be, is empty, or has more than are shown", () => {
		expect(ids(treeRows(tree({ expanded: ["src", "docs"], listings: { ...tree().listings } })))).toContain("  (Reading)");
		expect(ids(treeRows(tree({ listings: { ...tree().listings, src: { entries: null, more: 0, reading: false, failure: "Could not list src." } } })))).toContain("  (Could not list src.)");
		expect(ids(treeRows(tree({ listings: { ...tree().listings, src: listed() } })))).toContain("  (Empty)");
		expect(ids(treeRows(tree({ listings: { ...tree().listings, src: { ...listed(file("src/a.ts")), more: 1234 } } })))).toContain(`  (${describeMore(1234)})`);
		expect(describeMore(1234)).toBe("1,234 more not shown");
	});

	test("keep what was read while a folder is read again, and show nothing before the worktree's own folder is read", () => {
		const again = tree({ listings: { ...tree().listings, src: { ...listed(file("src/app.ts")), reading: true } } });
		expect(ids(treeRows(again))).toContain("  src/app.ts");
		expect(treeRows(tree({ listings: {} }))).toEqual([]);
	});
});

describe("opening and closing folders", () => {
	test("opening adds the folder once; closing forgets it, what is open below it, and what was read of them", () => {
		const opened = withFolder(tree({ expanded: ["src", "src/lib"] }), "docs", true);
		expect(opened.expanded).toEqual(["src", "src/lib", "docs"]);
		expect(withFolder(opened, "docs", true)).toBe(opened);
		const closed = withFolder(opened, "src", false);
		expect(closed.expanded).toEqual(["docs"]);
		expect(Object.keys(closed.listings)).toEqual([""]);
	});

	test("closing all forgets every open folder, nested ones and ones that do not show too, and keeps the worktree's own listing", () => {
		const opened = tree({
			expanded: ["src", "src/lib", "src/lib/deep", "docs", "node_modules"],
			listings: { ...tree().listings, "src/lib": listed(folder("src/lib/deep")), "src/lib/deep": listed(file("src/lib/deep/a.ts")), docs: listed(file("docs/plan.md")), node_modules: listed() },
		});
		const before = structuredClone(opened);
		const closed = withAllClosed(opened);
		expect(closed.expanded).toEqual([]);
		expect(Object.keys(closed.listings)).toEqual([""]);
		expect(closed.listings[""]).toBe(opened.listings[""]!);
		expect(ids(treeRows(closed))).toEqual(["docs", "src", "README.md"]);
		expect({ repository: closed.repository, worktree: closed.worktree }).toEqual({ repository: opened.repository, worktree: opened.worktree });
		expect(opened).toEqual(before);
		// Nothing open: the same tree, so nothing is drawn again.
		expect(withAllClosed(closed)).toBe(closed);
	});

	test("a folder counts as open only while its row shows", () => {
		expect(hasOpenFolder(treeRows(tree()))).toBe(true);
		expect(hasOpenFolder(treeRows(withAllClosed(tree())))).toBe(false);
		expect(hasOpenFolder([])).toBe(false);
		// Opened while ignored entries showed, then hidden again.
		expect(hasOpenFolder(treeRows(tree({ expanded: ["node_modules"] })))).toBe(false);
		// Open and still being read, or not readable.
		expect(hasOpenFolder(treeRows(tree({ expanded: ["docs"] })))).toBe(true);
		expect(hasOpenFolder(treeRows(tree({ listings: { ...tree().listings, src: { entries: null, more: 0, reading: false, failure: "Could not list src." } } })))).toBe(true);
	});

	test("the folders that show are the worktree's own and each open one whose parents are open", () => {
		expect(shownFolders(tree({ expanded: ["src", "src/lib", "docs/old"] }))).toEqual(["", "src", "src/lib"]);
	});
});

describe("the tree by keyboard", () => {
	const rows = treeRows(tree());

	test("Down and Up move a row, Home and End to the ends, and nothing focused starts at the first", () => {
		expect(treeKeyAction(rows, "docs", "ArrowDown")).toEqual({ kind: "focus", id: "src" });
		expect(treeKeyAction(rows, "README.md", "ArrowDown")).toEqual({ kind: "focus", id: "README.md" });
		expect(treeKeyAction(rows, "src", "ArrowUp")).toEqual({ kind: "focus", id: "docs" });
		expect(treeKeyAction(rows, "src", "End")).toEqual({ kind: "focus", id: "README.md" });
		expect(treeKeyAction(rows, "src", "Home")).toEqual({ kind: "focus", id: "docs" });
		expect(treeKeyAction(rows, null, "ArrowDown")).toEqual({ kind: "focus", id: "docs" });
		expect(treeKeyAction(rows, "gone", "ArrowDown")).toEqual({ kind: "focus", id: "docs" });
	});

	test("Right opens a closed folder, then moves into it; on a file it does nothing", () => {
		expect(treeKeyAction(rows, "docs", "ArrowRight")).toEqual({ kind: "open-folder", path: "docs" });
		expect(treeKeyAction(rows, "src", "ArrowRight")).toEqual({ kind: "focus", id: "src/lib" });
		expect(treeKeyAction(rows, "README.md", "ArrowRight")).toBeNull();
	});

	test("Left closes an open folder, and moves from an entry to its folder", () => {
		expect(treeKeyAction(rows, "src", "ArrowLeft")).toEqual({ kind: "close-folder", path: "src" });
		expect(treeKeyAction(rows, "src/app.ts", "ArrowLeft")).toEqual({ kind: "focus", id: "src" });
		expect(treeKeyAction(rows, "README.md", "ArrowLeft")).toBeNull();
	});

	test("Enter opens a file in the viewer and opens or closes a folder; other keys are left to the page", () => {
		expect(treeKeyAction(rows, "src/app.ts", "Enter")).toEqual({ kind: "open-file", path: "src/app.ts" });
		expect(treeKeyAction(rows, "docs", "Enter")).toEqual({ kind: "open-folder", path: "docs" });
		expect(treeKeyAction(rows, "src", "Enter")).toEqual({ kind: "close-folder", path: "src" });
		expect(treeKeyAction(rows, "src", "Tab")).toBeNull();
		expect(treeKeyAction([], null, "ArrowDown")).toBeNull();
	});

	test("the focused row stays when the rows change, or moves to the nearest one before it that still shows", () => {
		const closed = treeRows(withFolder(tree(), "src", false));
		expect(keptFocus(rows, closed, "README.md")).toBe("README.md");
		expect(keptFocus(rows, closed, "src/app.ts")).toBe("src");
		expect(keptFocus(rows, closed, null)).toBe("docs");
		// All closed, a row deep in a folder gives way to its top-level folder.
		const deep = tree({ expanded: ["src", "src/lib"], listings: { ...tree().listings, "src/lib": listed(file("src/lib/a.ts"), file("src/lib/b.ts")) } });
		expect(keptFocus(treeRows(deep), treeRows(withAllClosed(deep)), "src/lib/b.ts")).toBe("src");
		expect(keptFocus(treeRows(deep), treeRows(withAllClosed(deep)), "README.md")).toBe("README.md");
		expect(keptFocus(rows, [], "src")).toBeNull();
	});
});

describe("the files panel's words and shortcut", () => {
	const key = (key: string, modifiers: Partial<Record<"ctrlKey" | "shiftKey" | "metaKey" | "altKey", boolean>> = {}) =>
		({ type: "keydown", key, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, ...modifiers });

	test("the shortcut is Ctrl+Shift+E, or Cmd+Shift+E on macOS, and clashes with no other", () => {
		expect(isFilesPanelShortcut(key("E", { ctrlKey: true, shiftKey: true }))).toBe(true);
		expect(isFilesPanelShortcut(key("e", { metaKey: true, shiftKey: true }))).toBe(true);
		expect(isFilesPanelShortcut(key("e", { ctrlKey: true }))).toBe(false);
		expect(isFilesPanelShortcut(key("E", { ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
		const chord = key("E", { ctrlKey: true, shiftKey: true });
		expect(isPaletteShortcut(chord) || isWaitingShortcut(chord) || isChopsPanelShortcut(chord) || isRunChopShortcut(chord, DEFAULT_SHORTCUTS["run-chop"])).toBe(false);
		expect([FILES_PANEL_SHORTCUT, FILES_PANEL_SHORTCUT_MAC]).toEqual(["Ctrl+Shift+E", "Cmd+Shift+E"]);
		expect(filesButtonHint(false, false)).toBe("Show files (Ctrl+Shift+E)");
		expect(filesButtonHint(true, true)).toBe("Hide files (Cmd+Shift+E)");
	});

	test("says what to do with no worktree selected or its folder missing", () => {
		expect(describeFilesPanelEmpty(null)).toBe("Select a worktree to see its files.");
		expect(describeFilesPanelEmpty({ name: "feat", pathExists: false })).toBe("The folder of feat is missing.");
		expect(describeFilesPanelEmpty({ name: "feat", pathExists: true })).toBeNull();
	});
});
