import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { treeRows } from "../src/mainview/file-tree";
import { takesFilesPanelKey } from "../src/mainview/files-panel-format";
import { chopsPanelShown, filesPanelShown, sidePanelView } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import type { WorktreeFolderRequest, WorktreeFolderResult } from "../src/shared/worktree-folders";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const PRIMARY = sampleRepositories[0]!.worktrees[0]!;
const FEATURE = sampleRepositories[0]!.worktrees[1]!;
const MISSING = sampleRepositories[1]!.worktrees.find(worktree => !worktree.pathExists)!;

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { engine, store };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);
const rowsOf = (store: ReturnType<typeof createAppStore>, id = PRIMARY.id) => {
	const tree = store.getState().fileTree.trees[id];
	return tree ? treeRows(tree).map(row => row.id) : [];
};

describe("the side panel's two views", () => {
	test("Files shows the panel on the files, Chops switches it back, and pressing the shown one hides it; the view is remembered", async () => {
		const { engine, store } = await startedStore();
		expect(store.toggleSidePanel("files")).toBe(true);
		expect(filesPanelShown(store.getState())).toBe(true);
		expect(store.toggleSidePanel("chops")).toBe(true);
		expect(chopsPanelShown(store.getState())).toBe(true);
		expect(store.switchSidePanel("files")).toBe(true);
		expect(store.switchSidePanel("files")).toBe(false);
		expect(store.toggleSidePanel("files")).toBe(true);
		expect(store.getState().layout.chopsOpen).toBe(false);
		await settle();
		expect(await engine.loadLayout()).toMatchObject({ chopsOpen: false, sidePanel: "files" });
		const restarted = (await startedStore(engine)).store;
		expect(sidePanelView(restarted.getState())).toBe("files");
	});

	test("with chops off, the files still show, without a switch, and a panel left on the chops stays hidden", async () => {
		const { store } = await startedStore();
		store.toggleSidePanel("chops");
		await store.savePreferences({ useChops: false });
		expect(store.getState().layout.chopsOpen).toBe(true);
		expect(filesPanelShown(store.getState()) || chopsPanelShown(store.getState())).toBe(false);
		expect(store.toggleSidePanel("chops")).toBe(false);
		expect(store.toggleSidePanel("files")).toBe(true);
		await settle();
		const markup = render(store);
		expect(markup).toContain('id="titlebar-files"');
		expect(markup).not.toContain('id="titlebar-chops"');
		expect(markup).toContain('data-view="files"');
		expect(markup).not.toContain("side-panel-switch");
		expect(markup).toContain('<h2 id="');
	});

	test("the Files shortcut is taken only while the files can be shown", async () => {
		const { store } = await startedStore();
		const chord = { type: "keydown", key: "E", ctrlKey: true, shiftKey: true, metaKey: false, altKey: false };
		expect(takesFilesPanelKey(chord, store.getState())).toBe(true);
		store.openPalette();
		expect(takesFilesPanelKey(chord, store.getState())).toBe(false);
	});

	test("drawn, the files view has the switch, the ignored toggle, and the tree of the selected worktree", async () => {
		const { store } = await startedStore();
		store.toggleSidePanel("files");
		await settle();
		const markup = render(store);
		expect(markup).toContain('aria-pressed="true">Files</button>');
		expect(markup).toContain('aria-pressed="false">Chops</button>');
		expect(markup).toMatch(/class="files-panel-ignored" aria-pressed="false"/);
		expect(markup).toContain('role="tree"');
		expect(markup).toMatch(/role="treeitem" aria-level="1" aria-setsize="\d+" aria-posinset="1" aria-expanded="false"/);
		expect(markup).toContain(">README.md</span>");
		// One row is the tab stop.
		expect(markup.match(/role="treeitem"[^>]*tabindex="0"/g)).toHaveLength(1);
		expect(markup).toContain('aria-label="Files panel width"');
	});
});

describe("the file explorer's folders", () => {
	test("shows the selected worktree's own folder, without what Git ignores, and watches only while it shows", async () => {
		const { engine, store } = await startedStore();
		expect(engine.watchedWorktreeFolders()).toBeNull();
		store.toggleSidePanel("files");
		await settle();
		expect(rowsOf(store)).toEqual(["docs", "src", ".gitignore", "logo.png", "README.md", "report.txt"]);
		expect(engine.watchedWorktreeFolders()).toEqual({ repository: "/work/timber", worktree: PRIMARY.path, folders: [""] });
		store.hideChopsPanel();
		expect(engine.watchedWorktreeFolders()).toBeNull();
	});

	test("opening a folder reads and watches it; closing forgets it", async () => {
		const { engine, store } = await startedStore();
		store.toggleSidePanel("files");
		await settle();
		store.setFolderOpen(PRIMARY.id, "docs", true);
		await settle();
		expect(rowsOf(store)).toContain("docs/plan.md");
		expect(engine.watchedWorktreeFolders()?.folders).toEqual(["", "docs"]);
		store.setFolderOpen(PRIMARY.id, "docs", false);
		expect(rowsOf(store)).not.toContain("docs/plan.md");
		expect(engine.watchedWorktreeFolders()?.folders).toEqual([""]);
	});

	test("a file made or removed in a folder that shows appears or goes", async () => {
		const { engine, store } = await startedStore();
		store.toggleSidePanel("files");
		await settle();
		store.setFolderOpen(PRIMARY.id, "docs", true);
		await settle();
		engine.setWorktreeFile(PRIMARY.path, "docs/notes.md", "# Notes\n");
		await settle();
		expect(rowsOf(store)).toContain("docs/notes.md");
		engine.setWorktreeFile(PRIMARY.path, "README.md", null);
		await settle();
		expect(rowsOf(store)).not.toContain("README.md");
	});

	test("ignored entries show when asked, and an ignored folder opens", async () => {
		const { store } = await startedStore();
		store.toggleSidePanel("files");
		await settle();
		expect(rowsOf(store)).not.toContain("node_modules");
		store.toggleIgnoredFiles();
		await settle();
		expect(rowsOf(store)).toEqual(expect.arrayContaining(["node_modules", "debug.log"]));
		const tree = store.getState().fileTree.trees[PRIMARY.id]!;
		expect(tree.listings[""]!.entries!.find(entry => entry.path === "node_modules")).toMatchObject({ kind: "folder", ignored: true });
		store.setFolderOpen(PRIMARY.id, "node_modules", true);
		await settle();
		store.setFolderOpen(PRIMARY.id, "node_modules/left-pad", true);
		await settle();
		expect(rowsOf(store)).toContain("node_modules/left-pad/index.js");
		expect(render(store)).toMatch(/class="files-tree-row ignored"/);
	});

	test("each worktree keeps its own tree, read again when it shows again", async () => {
		const { engine, store } = await startedStore();
		store.toggleSidePanel("files");
		await settle();
		store.setFolderOpen(PRIMARY.id, "docs", true);
		await settle();
		store.select(FEATURE.id);
		await settle();
		expect(engine.watchedWorktreeFolders()).toMatchObject({ worktree: FEATURE.path, folders: [""] });
		engine.setWorktreeFile(PRIMARY.path, "docs/later.md", "later\n");
		store.select(PRIMARY.id);
		await settle();
		expect(rowsOf(store)).toContain("docs/later.md");
		expect(engine.watchedWorktreeFolders()?.folders).toEqual(["", "docs"]);
	});

	test("with no worktree selected, or its folder missing, the panel says so", async () => {
		const { store } = await startedStore();
		store.toggleSidePanel("files");
		store.select(MISSING.id);
		await settle();
		expect(render(store)).toContain("is missing.");
	});

	test("a late answer for a folder read again is dropped, and a failure says why and keeps what showed", async () => {
		const engine = createMockEngine();
		const waiting: { request: WorktreeFolderRequest; answer: (result: WorktreeFolderResult) => void }[] = [];
		const list = engine.listWorktreeFolder.bind(engine);
		let hold = false;
		engine.listWorktreeFolder = request => hold ? new Promise(answer => waiting.push({ request, answer })) : list(request);
		const { store } = await startedStore(engine);
		store.toggleSidePanel("files");
		await settle();
		hold = true;
		store.readFoldersAgain(PRIMARY.id);
		store.readFoldersAgain(PRIMARY.id);
		expect(waiting).toHaveLength(2);
		waiting[1]!.answer({ outcome: "failed", message: "Git could not say which files it ignores." });
		await settle();
		waiting[0]!.answer({ outcome: "listed", folder: "", entries: [], more: 0 });
		await settle();
		const root = store.getState().fileTree.trees[PRIMARY.id]!.listings[""]!;
		expect(root.failure).toBe("Git could not say which files it ignores.");
		expect(root.entries?.some(entry => entry.path === "README.md")).toBe(true);
	});

	test("listing writes nothing on the pretend disk", async () => {
		const { engine, store } = await startedStore();
		const before = engine.readWorktreeFileNow(PRIMARY.path, "README.md");
		store.toggleSidePanel("files");
		await settle();
		store.toggleIgnoredFiles();
		store.setFolderOpen(PRIMARY.id, "docs", true);
		await settle();
		expect(engine.readWorktreeFileNow(PRIMARY.path, "README.md")).toBe(before);
	});
});
