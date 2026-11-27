import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { MARKS_INCOMPLETE_NOTE } from "../src/mainview/file-marks";
import { createAppStore } from "../src/mainview/store/store";
import type { FileChange, FileChangesRequest } from "../src/shared/file-changes";

const settle = async () => {
	for (let round = 0; round < 8; round += 1) await Bun.sleep(0);
};
const REPOSITORY = sampleRepositories[0]!;
const PRIMARY = REPOSITORY.worktrees[0]!;
const FEATURE = REPOSITORY.worktrees[1]!;

const change = (area: FileChange["area"], kind: FileChange["kind"], path: string): FileChange =>
	({ area, kind, path, previousPath: null, added: 1, removed: 0, version: "" });

async function featureFiles(engine = createMockEngine()) {
	const asked: FileChangesRequest[] = [];
	const read = engine.readFileChanges.bind(engine);
	engine.readFileChanges = async request => {
		asked.push(structuredClone(request));
		return read(request);
	};
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	store.select(FEATURE.id);
	store.toggleSidePanel("files");
	await settle();
	return { engine, store, asked };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);
/** The opening tag and contents of the tree row for `path`. */
const rowOf = (markup: string, path: string) => {
	const start = markup.indexOf(`data-row="${path}"`);
	if (start === -1) return null;
	return markup.slice(markup.lastIndexOf("<li", start), markup.indexOf("</li>", start));
};
const panelOf = (markup: string) => markup.slice(markup.indexOf('data-view="files"'), markup.indexOf("</aside>", markup.indexOf('data-view="files"')));

describe("the file explorer's change marks", () => {
	test("a closed folder above changes shows a dot with its count, and its files their letters once open", async () => {
		const { store } = await featureFiles();
		expect(store.getState().fileTree.trees[FEATURE.id]!.marks).toMatchObject({
			files: { "src/changed-1.ts": "modified", "src/changed-2.ts": "modified", "src/changed-3.ts": "modified", "src/new-1.ts": "untracked" },
			folders: { src: 4 },
			more: false,
		});
		let markup = render(store);
		const folder = rowOf(markup, "src")!;
		expect(folder).toContain('aria-expanded="false"');
		expect(folder).toContain('aria-description="4 changed files"');
		expect(folder).toContain('class="files-tree-dot"');
		expect(folder).toMatch(/title="src, 4 changed files"/);
		expect(rowOf(markup, "docs")).not.toContain("files-tree-dot");
		expect(rowOf(markup, "README.md")).not.toContain("change-letter");

		store.setFolderOpen(FEATURE.id, "src", true);
		await settle();
		markup = render(store);
		const modified = rowOf(markup, "src/changed-1.ts")!;
		expect(modified).toContain('aria-description="Modified"');
		expect(modified).toMatch(/class="change-letter modified"[^>]*>M</);
		const fresh = rowOf(markup, "src/new-1.ts")!;
		expect(fresh).toContain('aria-description="Untracked"');
		expect(fresh).toMatch(/class="change-letter untracked"[^>]*>U</);
	});

	test("an ignored entry keeps its own words, and a changed one adds its status", async () => {
		const { engine, store } = await featureFiles();
		engine.setFileChanges(FEATURE.path, [{ change: change("unstaged", "modified", "README.md"), patch: "" }]);
		engine.announceChange(REPOSITORY.path);
		await settle();
		store.toggleIgnoredFiles();
		await settle();
		const markup = render(store);
		expect(rowOf(markup, "README.md")).toContain('aria-description="Modified"');
		expect(rowOf(markup, "debug.log")).toContain('aria-description="Ignored"');
	});

	test("marks always come from the uncommitted changes, even while the Changes view compares with the base", async () => {
		const { engine, store, asked } = await featureFiles();
		store.switchSidePanel("changes");
		await store.readChanges(REPOSITORY.path, FEATURE.id);
		await store.compareChanges("base");
		await settle();
		expect(store.getState().changes?.compared).toBe("base");
		store.switchSidePanel("files");
		await settle();
		asked.length = 0;
		engine.announceChange(REPOSITORY.path);
		await settle();
		expect(asked.length).toBeGreaterThan(0);
		expect(asked.every(request => request.compare === "uncommitted")).toBe(true);
		expect(store.getState().fileTree.trees[FEATURE.id]!.marks?.files["src/new-1.ts"]).toBe("untracked");
	});

	test("marks appear and clear without reopening the panel when the files change, are committed, or are reverted", async () => {
		const { engine, store } = await featureFiles();
		engine.setFileChanges(FEATURE.path, [{ change: change("untracked", "untracked", "brand/new/file.ts"), patch: "" }]);
		engine.announceChange(REPOSITORY.path);
		await settle();
		expect(store.getState().fileTree.trees[FEATURE.id]!.marks).toMatchObject({ files: { "brand/new/file.ts": "untracked" }, folders: { brand: 1, "brand/new": 1 } });

		engine.setFileChanges(FEATURE.path, []);
		engine.announceChange(REPOSITORY.path);
		await settle();
		expect(store.getState().fileTree.trees[FEATURE.id]!.marks).toEqual({ files: {}, folders: {}, more: false });
		expect(render(store)).not.toContain("files-tree-dot");
	});

	test("a change heard in a folder that shows reads the marks again", async () => {
		const { engine, store, asked } = await featureFiles();
		asked.length = 0;
		engine.changeWorktreeFolder(FEATURE.path, "");
		await settle();
		expect(asked.some(request => request.worktree === FEATURE.path && request.compare === "uncommitted")).toBe(true);
		expect(store.getState().fileTree.trees[FEATURE.id]!.marks?.folders.src).toBe(4);
	});

	test("a failed read keeps the last marks", async () => {
		const { engine, store } = await featureFiles();
		engine.failFileChanges("Git could not read the status.");
		engine.announceChange(REPOSITORY.path);
		await settle();
		expect(store.getState().fileTree.trees[FEATURE.id]!.marks?.folders.src).toBe(4);
	});

	test("reading the marks is quiet: no operation runs, so the Changes view never dims for it", async () => {
		const engine = createMockEngine();
		const read = engine.readFileChanges.bind(engine);
		let release = () => {};
		let held = false;
		engine.readFileChanges = async request => {
			if (held) await new Promise<void>(resolve => (release = resolve));
			return read(request);
		};
		const { store } = await featureFiles(engine);
		held = true;
		engine.announceChange(REPOSITORY.path);
		await settle();
		expect(store.getState().operations.some(operation => operation.kind === "read-changes")).toBe(false);
		held = false;
		release();
		await settle();
	});

	test("when the list was cut short, the panel says marks may be incomplete, with no control", async () => {
		const engine = createMockEngine();
		const read = engine.readFileChanges.bind(engine);
		engine.readFileChanges = async request => {
			const answer = await read(request);
			return answer.outcome === "read" ? { ...answer, more: true } : answer;
		};
		const { store } = await featureFiles(engine);
		const panel = panelOf(render(store));
		expect(panel).toContain(MARKS_INCOMPLETE_NOTE);
		const note = panel.slice(panel.lastIndexOf("<p", panel.indexOf(MARKS_INCOMPLETE_NOTE)), panel.indexOf(MARKS_INCOMPLETE_NOTE));
		expect(note).not.toContain("<button");
	});

	test("no button, toggle, or filter is added: the panel has the same controls with marks as without", async () => {
		const { store } = await featureFiles();
		const controls = (markup: string) => [...panelOf(markup).matchAll(/<(button|input|select)\b/g)].length;
		const withMarks = controls(render(store));
		store.select(PRIMARY.id);
		await settle();
		expect(store.getState().fileTree.trees[PRIMARY.id]!.marks).toEqual({ files: {}, folders: {}, more: false });
		expect(controls(render(store))).toBe(withMarks);
	});

	test("nothing is read for marks while the Files view does not show", async () => {
		const engine = createMockEngine();
		const asked: FileChangesRequest[] = [];
		const read = engine.readFileChanges.bind(engine);
		engine.readFileChanges = async request => {
			asked.push(request);
			return read(request);
		};
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		store.select(FEATURE.id);
		engine.announceChange(REPOSITORY.path);
		await settle();
		expect(asked).toEqual([]);
	});
});
