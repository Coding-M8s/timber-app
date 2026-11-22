import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import {
	CHANGES_BUTTON_ID, changesButtonHint, describeChangesPanelEmpty, describeChangesViewNotes, diffTabLabel, diffTabTitle, isChangesPanelShortcut, reviewButtonLabel, takesChangesPanelKey,
} from "../src/mainview/changes-panel-format";
import { settleTabs } from "../src/mainview/file-view-format";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { type MockFileChange, samplePatch } from "../src/mainview/engine/mock-file-changes";
import { paletteEntries } from "../src/mainview/palette";
import { runPaletteEntry } from "../src/mainview/palette-run";
import { canToggleSidePanel, changesPanelShown, changesWanted, initialState, offeredSidePanelViews, sidePanelShown, sidePanelView } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import type { FileChange } from "../src/shared/file-changes";
import { defaultLayout } from "../src/shared/layout";
import { notedLines } from "../src/shared/review";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const PRIMARY = sampleRepositories[0]!.worktrees[0]!;
const FEATURE = sampleRepositories[0]!.worktrees[1]!;

const file = (path: string): FileChange => ({ area: "unstaged", kind: "modified", path, previousPath: null });
const mock = (change: FileChange): MockFileChange => ({ change, patch: samplePatch(change.path) });
const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);
const tabIds = (markup: string) => [...markup.matchAll(/role="tab" id="tab-([a-z-]+)"/g)].map(match => match[1]);

/** FEATURE selected, comparing Uncommitted, with two changed files on it and none on PRIMARY. */
async function startedStore() {
	const engine = createMockEngine();
	await engine.saveLayout({ ...defaultLayout(), uncommittedChanges: [FEATURE.id, PRIMARY.id] });
	engine.setFileChanges(FEATURE.path, [mock(file("src/a.ts")), mock(file("src/deep/b.ts"))]);
	engine.setFileChanges(PRIMARY.path, [mock(file("README.md"))]);
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	store.select(FEATURE.id);
	return { engine, store };
}

describe("the side panel's Changes view", () => {
	test("Changes shows, switches to, and hides the panel, and is remembered", async () => {
		const { engine, store } = await startedStore();
		expect(store.toggleSidePanel("changes")).toBe(true);
		expect(changesPanelShown(store.getState())).toBe(true);
		expect(store.toggleSidePanel("files")).toBe(true);
		expect(sidePanelView(store.getState())).toBe("files");
		expect(store.toggleSidePanel("changes")).toBe(true);
		expect(store.toggleSidePanel("changes")).toBe(true);
		expect(sidePanelShown(store.getState())).toBe(false);
		expect(store.toggleSidePanel("changes")).toBe(true);
		await settle();
		expect(await engine.loadLayout()).toMatchObject({ chopsOpen: true, sidePanel: "changes" });
		// Shown from elsewhere, such as the arena's Open changes, it never hides.
		expect(store.showSidePanel("changes")).toBe(true);
		expect(changesPanelShown(store.getState())).toBe(true);
	});

	test("the switch offers Chops, Files, and Changes, or Files and Changes with chops off, which keeps Changes", async () => {
		const { store } = await startedStore();
		store.toggleSidePanel("changes");
		await settle();
		const views = (markup: string) => [...markup.matchAll(/class="side-panel-view" aria-pressed="(true|false)">([A-Za-z]+)/g)].map(match => `${match[2]}${match[1] === "true" ? "*" : ""}`);
		expect(views(render(store))).toEqual(["Chops", "Files", "Changes*"]);
		expect(offeredSidePanelViews(store.getState())).toEqual(["chops", "files", "changes"]);
		await store.savePreferences({ useChops: false });
		expect(offeredSidePanelViews(store.getState())).toEqual(["files", "changes"]);
		expect(changesPanelShown(store.getState())).toBe(true);
		expect(canToggleSidePanel(store.getState(), "changes")).toBe(true);
		expect(canToggleSidePanel(store.getState(), "chops")).toBe(false);
		expect(views(render(store))).toEqual(["Files", "Changes*"]);
	});

	test("drawn, it holds Compare with, the base, the counts and Refresh, the files, and the Review section, and reads the changes", async () => {
		const { store } = await startedStore();
		store.toggleSidePanel("changes");
		expect(changesWanted(store.getState())).toBe(true);
		await store.readChanges(TIMBER, FEATURE.id);
		const markup = render(store);
		expect(markup).toContain('data-view="changes"');
		expect(markup).toContain('<span class="changes-compare-label" aria-hidden="true">Compare with</span>');
		expect(markup).toContain(">Change base…</button>");
		expect(markup).toContain('<span class="changes-count" role="status">2 unstaged</span>');
		expect(markup).toMatch(/>Refresh<\/button>/);
		expect(markup).toContain('aria-label="src/deep/b.ts, Modified, Unstaged"');
		expect(markup).toContain('<section class="review-panel" aria-label="Review">');
		expect(markup).toContain('aria-label="Changes panel width"');
		expect(markup).toContain(`id="${CHANGES_BUTTON_ID}"`);
		expect(markup).toMatch(new RegExp(`id="${CHANGES_BUTTON_ID}" class="[^"]+" aria-pressed="true"`));
	});

	test("with no worktree selected, it says so", async () => {
		const store = createAppStore(createMockEngine([]), () => () => {});
		store.start();
		await settle();
		store.toggleSidePanel("changes");
		expect(render(store)).toContain(describeChangesPanelEmpty(false)!);
	});
});

describe("the diff tab", () => {
	test("opens after Pull request from the tab that showed, and closes back to it", async () => {
		const { store } = await startedStore();
		store.toggleSidePanel("changes");
		store.showTab("pull-request");
		await store.readChanges(TIMBER, FEATURE.id);
		await store.selectChangedFile(file("src/deep/b.ts"));
		expect(store.getState().tab).toBe("diff");
		expect(store.getState().diffs[FEATURE.id]).toEqual({ file: { area: "unstaged", path: "src/deep/b.ts", previousPath: null }, from: "pull-request" });
		expect(tabIds(render(store))).toEqual(["workspace", "pull-request", "diff"]);

		// Another file replaces it, and still closes back to Pull request.
		await store.selectChangedFile(file("src/a.ts"));
		expect(store.getState().diffs[FEATURE.id]?.from).toBe("pull-request");
		expect(store.getState().changes?.selected?.path).toBe("src/a.ts");

		store.closeDiff(FEATURE.id);
		expect(store.getState().tab).toBe("pull-request");
		expect(store.getState().diffs).toEqual({});
		expect(store.getState().changes).toMatchObject({ selected: null, diff: null });
		expect(tabIds(render(store))).toEqual(["workspace", "pull-request"]);
	});

	test("closed while another tab shows, it goes and that tab stays", async () => {
		const { store } = await startedStore();
		await store.readChanges(TIMBER, FEATURE.id);
		await store.selectChangedFile(file("src/a.ts"));
		store.showTab("workspace");
		store.closeDiff(FEATURE.id);
		expect(store.getState().tab).toBe("workspace");
		expect(store.getState().diffs).toEqual({});
	});

	test("belongs to its worktree: another worktree has none, and coming back reads its diff again", async () => {
		const { store } = await startedStore();
		await store.readChanges(TIMBER, FEATURE.id);
		await store.selectChangedFile(file("src/deep/b.ts"));
		store.select(PRIMARY.id);
		expect(store.getState().tab).toBe("workspace");
		expect(tabIds(render(store))).toEqual(["workspace", "pull-request"]);
		await store.readChanges(TIMBER, PRIMARY.id);
		expect(store.getState().changes).toMatchObject({ worktree: PRIMARY.id, selected: null });

		store.select(FEATURE.id);
		store.showTab("diff");
		expect(store.getState().tab).toBe("diff");
		// With the side panel hidden, the diff tab alone asks for the changes.
		expect(sidePanelShown(store.getState())).toBe(false);
		expect(changesWanted(store.getState())).toBe(true);
		expect(render(store)).toContain("Reading the diff");
		await store.readChanges(TIMBER, FEATURE.id);
		expect(store.getState().changes?.selected?.path).toBe("src/deep/b.ts");
		const markup = render(store);
		expect(markup).toContain('aria-label="Diff of src/deep/b.ts"');
		expect(markup).toContain('<span title="Diff of src/deep/b.ts"><span class="tab-kind" aria-hidden="true">diff</span><span class="visually-hidden">Diff of </span>b.ts</span>');
		expect(markup).toContain(">Close</button>");
	});

	test("a diff tab of a worktree that left the list goes, and the tab gives way to Workspace", () => {
		const diffs = { [FEATURE.id]: { file: file("a.ts"), from: "workspace" as const } };
		const state = { ...initialState, tab: "diff" as const, selection: { repository: TIMBER, worktree: FEATURE.id }, repositories: [], diffs };
		expect(settleTabs(state)).toEqual({ diffs: {}, tab: "workspace" });
		expect(settleTabs({ ...state, repositories: sampleRepositories })).toBeNull();
		// A File tab opened from a diff that has closed since closes to Workspace.
		expect(settleTabs({ ...state, repositories: sampleRepositories, diffs: {} })).toEqual({ tab: "workspace" });
	});

	test("choosing a note's reference opens its file's diff and marks its lines", async () => {
		const { store } = await startedStore();
		store.toggleSidePanel("changes");
		await store.readChanges(TIMBER, FEATURE.id);
		await store.selectChangedFile(file("src/a.ts"));
		const view = store.getState().changes!;
		const diff = view.diff?.outcome === "read" && view.diff.diff.kind === "text" ? view.diff.diff : null;
		const lines = notedLines(diff!.sections[0]!.hunks[0]!.lines, 2, 4)!;
		expect(store.addReviewNote(FEATURE.id, { comparison: view.compared!, file: view.selected!, lines, text: "Why?" })).toBeNull();
		store.closeDiff(FEATURE.id);
		store.showTab("workspace");

		const [note] = store.getState().reviews[FEATURE.id]!;
		expect(await store.showReviewNote(FEATURE.id, note!.id)).toBeNull();
		expect(store.getState().tab).toBe("diff");
		expect(store.getState().diffs[FEATURE.id]?.file.path).toBe("src/a.ts");
		expect(render(store).match(/class="diff-line [a-z]+ notable shown"/g)).toHaveLength(3);
	});
});

describe("the Changes shortcut and palette entry", () => {
	const chord = { type: "keydown", key: "G", ctrlKey: true, shiftKey: true, metaKey: false, altKey: false };

	test("Ctrl+Shift+G or Cmd+Shift+G, and nothing else, is the shortcut", () => {
		expect(isChangesPanelShortcut(chord)).toBe(true);
		expect(isChangesPanelShortcut({ ...chord, ctrlKey: false, metaKey: true, key: "g" })).toBe(true);
		expect(isChangesPanelShortcut({ ...chord, shiftKey: false })).toBe(false);
		expect(isChangesPanelShortcut({ ...chord, altKey: true })).toBe(false);
		expect(isChangesPanelShortcut({ ...chord, type: "keyup" })).toBe(false);
		expect(isChangesPanelShortcut({ ...chord, key: "E" })).toBe(false);
	});

	test("is taken only while the Changes view can be shown or hidden, with chops off too", async () => {
		const { store } = await startedStore();
		expect(takesChangesPanelKey(chord, store.getState())).toBe(true);
		await store.savePreferences({ useChops: false });
		expect(takesChangesPanelKey(chord, store.getState())).toBe(true);
		store.openPalette();
		expect(takesChangesPanelKey(chord, store.getState())).toBe(false);
	});

	test("the palette's entry shows the Changes view, and then hides it", async () => {
		const { store } = await startedStore();
		const entry = () => paletteEntries(store.getState()).find(candidate => candidate.id === "action:changes")!;
		expect(entry()).toMatchObject({ label: "Show changes", section: "app", disabledReason: null, action: { kind: "side-panel", view: "changes" } });
		const size = () => ({ cols: 80, rows: 24 });
		store.openPalette();
		// No page here to give the keyboard to: the store's half of the toggle is what counts.
		Object.assign(globalThis, { document: { getElementById: () => null, activeElement: null }, HTMLElement: class {} });
		try {
			runPaletteEntry(store, entry(), size);
			expect(store.getState().dialog).toBeNull();
			expect(changesPanelShown(store.getState())).toBe(true);
			expect(entry().label).toBe("Hide changes");
			runPaletteEntry(store, entry(), size);
			expect(sidePanelShown(store.getState())).toBe(false);
		} finally {
			Reflect.deleteProperty(globalThis, "document");
			Reflect.deleteProperty(globalThis, "HTMLElement");
		}
	});
});

describe("words of the Changes view and the diff tab", () => {
	test("name the tab after the file, with its path and any rename in the tooltip", () => {
		expect(diffTabLabel(file("src/deep/b.ts"))).toBe("b.ts");
		expect(diffTabLabel(file("README.md"))).toBe("README.md");
		expect(diffTabTitle(file("src/a.ts"))).toBe("Diff of src/a.ts");
		expect(diffTabTitle({ path: "src/new.ts", previousPath: "src/old.ts" })).toBe("Diff of src/new.ts, renamed from src/old.ts");
	});

	test("say what the button does, how many notes wait, and when there is no worktree", () => {
		expect(changesButtonHint(false, false)).toBe("Show changes (Ctrl+Shift+G)");
		expect(changesButtonHint(true, true)).toBe("Hide changes (Cmd+Shift+G)");
		expect(describeChangesViewNotes(0)).toBe("");
		expect(describeChangesViewNotes(2)).toBe(", 2 review notes");
		expect(reviewButtonLabel(1)).toBe("Review, 1 review note. Show the Changes view");
		expect(describeChangesPanelEmpty(true)).toBeNull();
	});
});
