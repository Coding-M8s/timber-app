import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { keyboardToFileTree } from "../src/mainview/components/FilesPanel";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { treeRows } from "../src/mainview/file-tree";
import { COLLAPSE_FOLDERS_LABEL, FILES_NOT_READ, NO_FOLDER_OPEN, collapseUnavailable, takesFilesPanelKey } from "../src/mainview/files-panel-format";
import { NO_WORKTREE_SELECTED, paletteEntries, paletteScope, paletteView } from "../src/mainview/palette";
import { runPaletteEntry } from "../src/mainview/palette-run";
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

describe("the side panel's views", () => {
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

	test("with chops off, the files still show, with a switch of Files and Changes, and a panel left on the chops stays hidden", async () => {
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
		const views = [...markup.matchAll(/class="side-panel-view" aria-pressed="(?:true|false)">([A-Za-z]+)/g)].map(match => match[1]);
		expect(views).toEqual(["Files", "Changes"]);
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

	test("each file and folder row shows its icon before its name, hidden from the screen reader and never dragged on its own", async () => {
		const { store } = await startedStore();
		store.toggleSidePanel("files");
		await settle();
		store.setFolderOpen(PRIMARY.id, "docs", true);
		await settle();
		const markup = render(store);
		const icon = (file: string) => `<img class="files-tree-icon" src="/assets/material-icons/${file}.svg" alt="" aria-hidden="true" width="16" height="16" loading="lazy" decoding="async" draggable="false"/>`;
		expect(markup).toContain(`${icon("folder-docs-open")}<span class="files-tree-name">docs</span>`);
		expect(markup).toContain(`${icon("readme")}<span class="files-tree-name">README.md</span>`);
		expect(markup).toContain(`${icon("markdown")}<span class="files-tree-name">plan.md</span>`);
		// Every entry row has exactly one icon.
		const rows = markup.match(/<li[^>]*role="treeitem"(?![^>]*aria-disabled)[^>]*>.*?<\/li>/g) ?? [];
		expect(rows.length).toBeGreaterThan(2);
		for (const row of rows) expect(row.match(/class="files-tree-icon"/g)).toHaveLength(1);
	});
});

describe("collapsing all folders", () => {
	/** The button as drawn, or null when it is not. */
	const button = (store: ReturnType<typeof createAppStore>) => /<button[^>]*files-panel-collapse[^>]*>/.exec(render(store))?.[0] ?? null;
	const isOff = (store: ReturnType<typeof createAppStore>) => button(store)!.includes('aria-disabled="true"');
	async function opened(engine = createMockEngine(), folders = ["node_modules", "node_modules/left-pad", "docs"]) {
		const started = await startedStore(engine);
		started.store.toggleIgnoredFiles();
		started.store.toggleSidePanel("files");
		await settle();
		for (const folder of folders) {
			started.store.setFolderOpen(PRIMARY.id, folder, true);
			await settle();
		}
		return started;
	}

	test("the row is under the header in the Files view only, with the button named and off while nothing is open", async () => {
		const { store } = await startedStore();
		store.toggleSidePanel("files");
		await settle();
		const markup = render(store);
		expect(markup.match(/class="files-panel-tools"/g)).toHaveLength(1);
		const order = ['class="chops-panel-head"', 'class="files-panel-tools" role="group" aria-label="File actions"', 'class="chops-panel-body files-panel-body"'].map(part => markup.indexOf(part));
		expect(order.every(at => at >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		expect(button(store)).toContain(`aria-label="${COLLAPSE_FOLDERS_LABEL}"`);
		expect(button(store)).toContain(`title="${COLLAPSE_FOLDERS_LABEL}. ${NO_FOLDER_OPEN}"`);
		expect(isOff(store)).toBe(true);
		// The row is not in the header, and stays reachable: never `disabled`, only said to be.
		expect(button(store)).not.toContain(" disabled");
		store.setFolderOpen(PRIMARY.id, "docs", true);
		expect(isOff(store)).toBe(false);
		expect(button(store)).toContain(`title="${COLLAPSE_FOLDERS_LABEL}"`);
		for (const view of ["chops", "changes"] as const) {
			store.switchSidePanel(view);
			expect(render(store)).toContain(`data-view="${view}"`);
			expect(render(store)).not.toContain("files-panel-tools");
		}
	});

	test("closes every open folder, nested ones too, in one go, and stops watching them", async () => {
		const { engine, store } = await opened();
		expect(rowsOf(store)).toEqual(expect.arrayContaining(["docs/plan.md", "node_modules/left-pad/index.js"]));
		expect(engine.watchedWorktreeFolders()?.folders).toEqual(["", "node_modules", "node_modules/left-pad", "docs"]);
		store.closeAllFolders(PRIMARY.id);
		expect(rowsOf(store).every(row => !row.includes("/"))).toBe(true);
		expect(rowsOf(store)).toEqual(expect.arrayContaining(["docs", "node_modules", "README.md"]));
		expect(engine.watchedWorktreeFolders()?.folders).toEqual([""]);
		expect(isOff(store)).toBe(true);
		const before = store.getState();
		store.closeAllFolders(PRIMARY.id);
		store.closeAllFolders("no such worktree");
		expect(store.getState()).toBe(before);
	});

	test("a folder opened after reads again and shows what is there now, its own folders closed", async () => {
		const { engine, store } = await opened();
		store.closeAllFolders(PRIMARY.id);
		engine.setWorktreeFile(PRIMARY.path, "docs/later.md", "later\n");
		engine.setWorktreeFile(PRIMARY.path, "docs/plan.md", null);
		await settle();
		store.setFolderOpen(PRIMARY.id, "docs", true);
		expect(rowsOf(store)).toContain("reading:docs");
		store.setFolderOpen(PRIMARY.id, "node_modules", true);
		await settle();
		expect(rowsOf(store)).toContain("docs/later.md");
		expect(rowsOf(store)).not.toContain("docs/plan.md");
		expect(rowsOf(store)).toContain("node_modules/left-pad");
		expect(rowsOf(store)).not.toContain("node_modules/left-pad/index.js");
	});

	test("an answer for a folder that was being read when it collapsed is dropped", async () => {
		const engine = createMockEngine();
		const list = engine.listWorktreeFolder.bind(engine);
		const { store } = await opened(engine, []);
		const held: ((result: WorktreeFolderResult) => void)[] = [];
		engine.listWorktreeFolder = () => new Promise(answer => held.push(answer));
		store.setFolderOpen(PRIMARY.id, "docs", true);
		store.closeAllFolders(PRIMARY.id);
		engine.listWorktreeFolder = list;
		store.setFolderOpen(PRIMARY.id, "docs", true);
		await settle();
		held[0]!({ outcome: "listed", folder: "docs", entries: [], more: 0 });
		await settle();
		expect(rowsOf(store)).toContain("docs/plan.md");
	});

	test("the open file stays open, and its row is marked again once its folder is open again", async () => {
		const { store } = await opened();
		store.openFile(PRIMARY.id, "docs/plan.md");
		await settle();
		const file = store.getState().files[PRIMARY.id];
		const marked = () => /data-row="docs\/plan\.md"[^>]*aria-current="true"/.test(render(store));
		expect(marked()).toBe(true);
		store.closeAllFolders(PRIMARY.id);
		expect(store.getState().files[PRIMARY.id]).toBe(file!);
		expect(store.getState().tab).toBe("file");
		expect(render(store)).not.toContain('data-row="docs/plan.md"');
		store.setFolderOpen(PRIMARY.id, "docs", true);
		await settle();
		expect(marked()).toBe(true);
	});

	test("another worktree's tree is left as it is", async () => {
		const { store } = await opened();
		store.select(FEATURE.id);
		await settle();
		store.setFolderOpen(FEATURE.id, "docs", true);
		await settle();
		const other = store.getState().fileTree.trees[PRIMARY.id];
		store.closeAllFolders(FEATURE.id);
		expect(store.getState().fileTree.trees[PRIMARY.id]).toBe(other!);
		expect(store.getState().fileTree.trees[FEATURE.id]!.expanded).toEqual([]);
	});

	test("a folder open among hidden ignored entries does not turn the button on, and is closed with the rest", async () => {
		const { store } = await opened();
		store.setFolderOpen(PRIMARY.id, "docs", false);
		store.toggleIgnoredFiles();
		await settle();
		expect(collapseUnavailable(store.getState())).toBe(NO_FOLDER_OPEN);
		store.setFolderOpen(PRIMARY.id, "docs", true);
		store.closeAllFolders(PRIMARY.id);
		store.toggleIgnoredFiles();
		await settle();
		expect(rowsOf(store)).toContain("node_modules");
		expect(collapseUnavailable(store.getState())).toBe(NO_FOLDER_OPEN);
	});

	test("it is off while the tree is read for the first time, is empty, or could not be read, with no folder to show, and with no worktree", async () => {
		const engine = createMockEngine();
		let answer: (result: WorktreeFolderResult) => void = () => {};
		engine.listWorktreeFolder = () => new Promise(done => { answer = done; });
		const { store } = await startedStore(engine);
		store.toggleSidePanel("files");
		expect(collapseUnavailable(store.getState())).toBe(FILES_NOT_READ);
		expect(isOff(store)).toBe(true);
		answer({ outcome: "failed", message: "Git could not be run." });
		await settle();
		expect(collapseUnavailable(store.getState())).toBe("Git could not be run.");
		expect(isOff(store)).toBe(true);
		store.readFoldersAgain(PRIMARY.id);
		expect(collapseUnavailable(store.getState())).toBe(FILES_NOT_READ);
		answer({ outcome: "listed", folder: "", entries: [], more: 0 });
		await settle();
		expect(collapseUnavailable(store.getState())).toBe(NO_FOLDER_OPEN);
		expect(isOff(store)).toBe(true);
		store.select(MISSING.id);
		expect(collapseUnavailable(store.getState())).toContain("is missing.");
		expect(isOff(store)).toBe(true);
		expect(collapseUnavailable({ ...store.getState(), selection: null })).toBe("Select a worktree to see its files.");
	});

	test("it stays on while a tree that shows is read again, and when that fails, as its folders still show", async () => {
		const { engine, store } = await opened();
		let answer: (result: WorktreeFolderResult) => void = () => {};
		engine.listWorktreeFolder = ({ folder }) => new Promise(done => { if (folder === "") answer = done; });
		store.readFoldersAgain(PRIMARY.id);
		expect(isOff(store)).toBe(false);
		answer({ outcome: "failed", message: "Git could not be run." });
		await settle();
		expect(rowsOf(store)).toContain("docs/plan.md");
		expect(isOff(store)).toBe(false);
	});

	test("the palette offers it while the Files view shows, with the button's reason", async () => {
		const { store } = await startedStore();
		const entry = () => paletteEntries(store.getState()).find(candidate => candidate.label === COLLAPSE_FOLDERS_LABEL);
		expect(entry()).toBeUndefined();
		store.toggleSidePanel("files");
		await settle();
		expect(entry()).toMatchObject({ section: "worktree", repository: "/work/timber", disabledReason: NO_FOLDER_OPEN, action: { kind: "collapse-folders", worktree: PRIMARY.id } });
		store.setFolderOpen(PRIMARY.id, "docs", true);
		await settle();
		expect(entry()!.disabledReason).toBeNull();
		const view = (query: string) => paletteView(paletteEntries(store.getState()), query, paletteScope(store.getState()), true).options.map(match => match.entry.label);
		expect(view("")).toContain(COLLAPSE_FOLDERS_LABEL);
		expect(view("collapse")[0]).toBe(COLLAPSE_FOLDERS_LABEL);
		expect(paletteEntries({ ...store.getState(), selection: null }).find(candidate => candidate.label === COLLAPSE_FOLDERS_LABEL)).toMatchObject({ disabledReason: NO_WORKTREE_SELECTED });
		store.switchSidePanel("changes");
		expect(entry()).toBeUndefined();
		store.hideChopsPanel();
		expect(entry()).toBeUndefined();
	});

	test("chosen in the palette, it closes the palette and every folder; with its reason it does nothing", async () => {
		const { store } = await opened();
		const entry = () => paletteEntries(store.getState()).find(candidate => candidate.label === COLLAPSE_FOLDERS_LABEL)!;
		const size = () => ({ cols: 80, rows: 24 });
		store.openPalette();
		const root = { focused: 0, focus() { this.focused += 1; } };
		const page = { body: {}, activeElement: null as unknown, querySelector: () => root };
		Object.assign(globalThis, { document: page });
		try {
			runPaletteEntry(store, entry(), size);
			expect(store.getState().dialog).toBeNull();
			expect(store.getState().fileTree.trees[PRIMARY.id]!.expanded).toEqual([]);
			// The keyboard goes to the tree once the palette has closed, unless something took it since.
			expect(root.focused).toBe(0);
			await Bun.sleep(5);
			expect(root.focused).toBe(1);
			page.activeElement = {};
			keyboardToFileTree(run => run());
			expect(root.focused).toBe(1);
			store.openPalette();
			runPaletteEntry(store, entry(), size);
			expect(store.getState().dialog).not.toBeNull();
		} finally {
			Reflect.deleteProperty(globalThis, "document");
		}
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
