import { describe, expect, test } from "bun:test";
import type { Engine } from "../src/shared/engine";
import { DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, defaultLayout } from "../src/shared/layout";
import type { Layout } from "../src/shared/layout";
import type { SaveLayoutResult, SavePreferencesResult } from "../src/shared/model";
import { type Preferences, defaultPreferences } from "../src/shared/preferences";
import { createMockEngine } from "../src/mainview/engine/mock";
import { SIDEBAR_KEY_STEP, describeLayoutProblem, describeRepository, sidebarWidthAfterDrag, sidebarWidthAfterKey, tabAfterKey } from "../src/mainview/shell";
import { createAppStore } from "../src/mainview/store/store";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const API_SERVER = "/work/api-server";

describe("tabAfterKey", () => {
	test("the arrows step between the tabs and wrap around", () => {
		expect(tabAfterKey("workspace", "ArrowRight")).toBe("changes");
		expect(tabAfterKey("changes", "ArrowRight")).toBe("workspace");
		expect(tabAfterKey("workspace", "ArrowLeft")).toBe("changes");
		expect(tabAfterKey("changes", "ArrowLeft")).toBe("workspace");
	});

	test("Home and End go to the first and the last tab", () => {
		expect(tabAfterKey("changes", "Home")).toBe("workspace");
		expect(tabAfterKey("workspace", "End")).toBe("changes");
	});

	test("any other key is left alone", () => {
		for (const key of ["Tab", "Enter", " ", "ArrowDown", "a"]) expect(tabAfterKey("workspace", key)).toBeNull();
	});
});

describe("sidebarWidthAfterKey", () => {
	test("the arrows move the edge one step", () => {
		expect(sidebarWidthAfterKey(300, "ArrowRight")).toBe(300 + SIDEBAR_KEY_STEP);
		expect(sidebarWidthAfterKey(300, "ArrowLeft")).toBe(300 - SIDEBAR_KEY_STEP);
	});

	test("the width stops at the narrowest and the widest", () => {
		expect(sidebarWidthAfterKey(MIN_SIDEBAR_WIDTH + 3, "ArrowLeft")).toBe(MIN_SIDEBAR_WIDTH);
		expect(sidebarWidthAfterKey(MAX_SIDEBAR_WIDTH - 3, "ArrowRight")).toBe(MAX_SIDEBAR_WIDTH);
		expect(sidebarWidthAfterKey(300, "Home")).toBe(MIN_SIDEBAR_WIDTH);
		expect(sidebarWidthAfterKey(300, "End")).toBe(MAX_SIDEBAR_WIDTH);
	});

	test("any other key is left alone", () => {
		for (const key of ["Tab", "Enter", "ArrowUp", "ArrowDown"]) expect(sidebarWidthAfterKey(300, key)).toBeNull();
		for (const key of ["Tab", "Enter", "ArrowUp", "ArrowDown"]) expect(sidebarWidthAfterKey(300, key, "right")).toBeNull();
	});

	test("with the sidebar on the right, the arrow toward the workspace widens it", () => {
		expect(sidebarWidthAfterKey(300, "ArrowLeft", "right")).toBe(300 + SIDEBAR_KEY_STEP);
		expect(sidebarWidthAfterKey(300, "ArrowRight", "right")).toBe(300 - SIDEBAR_KEY_STEP);
		expect(sidebarWidthAfterKey(MAX_SIDEBAR_WIDTH - 3, "ArrowLeft", "right")).toBe(MAX_SIDEBAR_WIDTH);
		expect(sidebarWidthAfterKey(MIN_SIDEBAR_WIDTH + 3, "ArrowRight", "right")).toBe(MIN_SIDEBAR_WIDTH);
	});

	test("Home and End mean the narrowest and the widest on either side", () => {
		expect(sidebarWidthAfterKey(300, "Home", "right")).toBe(MIN_SIDEBAR_WIDTH);
		expect(sidebarWidthAfterKey(300, "End", "right")).toBe(MAX_SIDEBAR_WIDTH);
	});
});

describe("sidebarWidthAfterDrag", () => {
	test("the edge follows the pointer: on the left a drag to the right widens", () => {
		expect(sidebarWidthAfterDrag(300, 40)).toBe(340);
		expect(sidebarWidthAfterDrag(300, -40, "left")).toBe(260);
	});

	test("on the right a drag to the left widens", () => {
		expect(sidebarWidthAfterDrag(300, -40, "right")).toBe(340);
		expect(sidebarWidthAfterDrag(300, 40, "right")).toBe(260);
	});

	test("the width stays within the limits on either side", () => {
		expect(sidebarWidthAfterDrag(300, -5000, "right")).toBe(MAX_SIDEBAR_WIDTH);
		expect(sidebarWidthAfterDrag(300, 5000, "right")).toBe(MIN_SIDEBAR_WIDTH);
		expect(sidebarWidthAfterDrag(300, 5000)).toBe(MAX_SIDEBAR_WIDTH);
	});
});

describe("describeRepository and describeLayoutProblem", () => {
	test("a repository's tooltip holds its whole name and its folder", () => {
		expect(describeRepository({ name: "timber", path: "/work/timber" })).toBe("timber (/work/timber)");
	});

	test("a layout problem says what failed and what that means", () => {
		expect(describeLayoutProblem({ action: "save", message: "disk full" })).toMatchObject({ title: "Could not save the layout", text: "disk full" });
		expect(describeLayoutProblem({ action: "read", message: "bridge closed" })).toMatchObject({ title: "Could not read the saved layout", text: "bridge closed" });
	});
});

/** A mock engine that also notes every layout it was asked to save. */
function notingEngine() {
	const engine = createMockEngine();
	const saves: Layout[] = [];
	const save = engine.saveLayout;
	engine.saveLayout = layout => {
		saves.push(structuredClone(layout));
		return save(layout);
	};
	return { engine, saves };
}

async function startedStore(engine: Engine = createMockEngine()) {
	const store = createAppStore(engine);
	store.start();
	await settle();
	return store;
}

describe("the layout in the store", () => {
	test("starts as the default and takes what the engine remembers", async () => {
		const engine = createMockEngine();
		await engine.saveLayout({ sidebarWidth: 340, collapsed: [API_SERVER] });
		const store = createAppStore(engine);
		expect(store.getState().layout).toEqual(defaultLayout());
		store.start();
		await settle();
		expect(store.getState().layout).toEqual({ sidebarWidth: 340, collapsed: [API_SERVER] });
		expect(store.getState().layoutProblem).toBeNull();
	});

	test("saving an untouched layout while its read is pending preserves the saved preferences", async () => {
		const engine = createMockEngine();
		const saved = { sidebarWidth: 400, collapsed: [API_SERVER] };
		await engine.saveLayout(saved);
		const load = engine.loadLayout;
		let answer!: (layout: Layout) => void;
		engine.loadLayout = () => new Promise(resolve => { answer = resolve; });
		const store = createAppStore(engine);
		store.start();

		// The resize handle asks to save on blur and key up, even without a resize.
		await store.saveLayout();
		answer(saved);
		await settle();
		expect(store.getState().layout).toEqual(saved);
		expect(await load()).toEqual(saved);

		store.resizeSidebar(350);
		await store.saveLayout();
		expect(await load()).toEqual({ sidebarWidth: 350, collapsed: [API_SERVER] });
	});

	test("collapsing a group is saved at once, and a restarted store has it", async () => {
		const { engine, saves } = notingEngine();
		const store = await startedStore(engine);
		store.toggleGroup(API_SERVER);
		expect(store.getState().layout.collapsed).toEqual([API_SERVER]);
		await settle();
		expect(saves).toEqual([{ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, collapsed: [API_SERVER] }]);

		// A new store on the same engine is what a restarted interface has.
		expect((await startedStore(engine)).getState().layout.collapsed).toEqual([API_SERVER]);

		store.toggleGroup(API_SERVER);
		await settle();
		expect((await startedStore(engine)).getState().layout.collapsed).toEqual([]);
	});

	test("resizing shows at once, within the limits, and is saved only when asked", async () => {
		const { engine, saves } = notingEngine();
		const store = await startedStore(engine);
		// As a drag does: many moves, then one save when it ends.
		for (const width of [280, 300, 320, 9999, 10, 333.4]) store.resizeSidebar(width);
		expect(store.getState().layout.sidebarWidth).toBe(333);
		await settle();
		expect(saves).toEqual([]);

		await store.saveLayout();
		expect(saves).toEqual([{ sidebarWidth: 333, collapsed: [] }]);
		expect((await startedStore(engine)).getState().layout.sidebarWidth).toBe(333);

		// Asking again with nothing changed does not reach the engine.
		await store.saveLayout();
		expect(saves.length).toBe(1);
	});

	test("saves asked for while one is running share one follow-up save of the latest layout", async () => {
		const answers: ((result: SaveLayoutResult) => void)[] = [];
		const saves: Layout[] = [];
		const engine = createMockEngine();
		engine.saveLayout = layout => new Promise(resolve => {
			saves.push(layout);
			answers.push(resolve);
		});
		const store = await startedStore(engine);
		for (const width of [300, 310, 320, 330]) {
			store.resizeSidebar(width);
			void store.saveLayout();
		}
		expect(saves.map(layout => layout.sidebarWidth)).toEqual([300]);
		answers.shift()!({ outcome: "saved" });
		await settle();
		expect(saves.map(layout => layout.sidebarWidth)).toEqual([300, 330]);
		answers.shift()!({ outcome: "saved" });
		await settle();
		expect(saves.length).toBe(2);
	});

	test("a save that fails keeps the layout on screen and leaves one note, however often it fails", async () => {
		const engine = createMockEngine();
		const store = await startedStore(engine);
		engine.failLayoutSaves("Could not save settings: disk full");
		let changes = 0;
		store.subscribe(() => changes++);

		store.toggleGroup(TIMBER);
		await settle();
		expect(store.getState().layout.collapsed).toEqual([TIMBER]);
		expect(store.getState().layoutProblem).toEqual({ action: "save", message: "Could not save settings: disk full" });
		expect(store.getState().toasts).toEqual([]);
		expect(changes).toBe(2);

		// The same failure again changes nothing more than the layout itself.
		store.resizeSidebar(300);
		await store.saveLayout();
		expect(changes).toBe(3);
		expect(store.getState().layout).toEqual({ sidebarWidth: 300, collapsed: [TIMBER] });

		// Nothing reached the engine, so a restart has the old layout.
		expect((await startedStore(engine)).getState().layout).toEqual(defaultLayout());

		// The next save that works clears the note and saves everything changed since.
		engine.failLayoutSaves(null);
		await store.saveLayout();
		expect(store.getState().layoutProblem).toBeNull();
		expect((await startedStore(engine)).getState().layout).toEqual({ sidebarWidth: 300, collapsed: [TIMBER] });
	});

	test("an engine that throws on save is a failed save, not a broken interface", async () => {
		const engine = createMockEngine();
		engine.saveLayout = async () => {
			throw new Error("bridge closed");
		};
		const store = await startedStore(engine);
		store.toggleGroup(TIMBER);
		await settle();
		expect(store.getState().layoutProblem).toEqual({ action: "save", message: "bridge closed" });
		store.dismissLayoutProblem();
		expect(store.getState().layoutProblem).toBeNull();
		expect(store.getState().layout.collapsed).toEqual([TIMBER]);
	});

	test("a layout that cannot be read leaves the defaults, a note, and a working list", async () => {
		const engine = createMockEngine();
		engine.loadLayout = async () => {
			throw new Error("bridge closed");
		};
		const store = await startedStore(engine);
		expect(store.getState().layout).toEqual(defaultLayout());
		expect(store.getState().layoutProblem).toEqual({ action: "read", message: "bridge closed" });
		expect(store.getState().repositories.length).toBe(2);
	});

	test("a change made before the saved layout arrives is kept", async () => {
		const engine = createMockEngine();
		await engine.saveLayout({ sidebarWidth: 400, collapsed: [API_SERVER] });
		const store = createAppStore(engine);
		store.start();
		store.toggleGroup(TIMBER);
		await settle();
		expect(store.getState().layout).toEqual({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, collapsed: [TIMBER] });
	});

	test("removing a repository forgets its collapsed group", async () => {
		const { engine, saves } = notingEngine();
		const store = await startedStore(engine);
		store.toggleGroup(API_SERVER);
		store.toggleGroup(TIMBER);
		await settle();
		await store.removeRepository(API_SERVER);
		expect(store.getState().layout.collapsed).toEqual([TIMBER]);
		expect((await startedStore(engine)).getState().layout.collapsed).toEqual([TIMBER]);
		// The engine forgot it with the repository, so no save of the layout was needed for that.
		const before = saves.length;
		await store.saveLayout();
		expect(saves.length).toBe(before);
	});
});

describe("tabs and the dialog request in the store", () => {
	test("the Workspace tab shows first, and showTab changes it", async () => {
		const store = await startedStore();
		expect(store.getState().tab).toBe("workspace");
		store.showTab("changes");
		expect(store.getState().tab).toBe("changes");
	});

	test("openDialog holds one request, and closeDialog clears it", async () => {
		const store = await startedStore();
		expect(store.getState().dialog).toBeNull();
		store.openDialog({ kind: "new-worktree", repository: TIMBER });
		expect(store.getState().dialog).toEqual({ kind: "new-worktree", repository: TIMBER });
		store.openDialog({ kind: "new-worktree", repository: API_SERVER });
		expect(store.getState().dialog).toEqual({ kind: "new-worktree", repository: API_SERVER });
		store.closeDialog();
		expect(store.getState().dialog).toBeNull();
	});

	test("the settings dialog is a request like the others, with an optional section", async () => {
		const store = await startedStore();
		store.openDialog({ kind: "settings" });
		expect(store.getState().dialog).toEqual({ kind: "settings" });
		store.openDialog({ kind: "settings", section: "layout" });
		expect(store.getState().dialog).toEqual({ kind: "settings", section: "layout" });
	});
});

describe("the preferences in the store", () => {
	test("start as the defaults and take what the engine remembers", async () => {
		const engine = createMockEngine();
		await engine.savePreferences({ sidebarSide: "right" });
		const store = createAppStore(engine);
		expect(store.getState().preferences).toEqual(defaultPreferences());
		store.start();
		await settle();
		expect(store.getState().preferences).toEqual({ sidebarSide: "right", editor: null });
	});

	test("a save that worked shows at once, and a restarted store has it", async () => {
		const engine = createMockEngine();
		const store = await startedStore(engine);
		expect(await store.savePreferences({ sidebarSide: "right" })).toEqual({ outcome: "saved", preferences: { sidebarSide: "right", editor: null } });
		expect(store.getState().preferences).toEqual({ sidebarSide: "right", editor: null });
		expect((await startedStore(engine)).getState().preferences).toEqual({ sidebarSide: "right", editor: null });
	});

	test("a save that failed changes nothing on screen and answers with the reason", async () => {
		const engine = createMockEngine();
		const store = await startedStore(engine);
		engine.failPreferenceSaves("disk full");
		expect(await store.savePreferences({ sidebarSide: "right" })).toEqual({ outcome: "failed", message: "disk full" });
		expect(store.getState().preferences).toEqual(defaultPreferences());
	});

	test("an engine that throws on save is a failed save, not a broken interface", async () => {
		const engine = createMockEngine();
		engine.savePreferences = async () => {
			throw new Error("The bridge closed");
		};
		const store = await startedStore(engine);
		expect(await store.savePreferences({ sidebarSide: "right" })).toEqual({ outcome: "failed", message: "The bridge closed" });
		expect(store.getState().preferences).toEqual(defaultPreferences());
	});

	test("a first read that answers after a save is older, so it is dropped", async () => {
		const engine = createMockEngine();
		let answer!: (preferences: Preferences) => void;
		engine.loadPreferences = () => new Promise(resolve => {
			answer = resolve;
		});
		const store = createAppStore(engine);
		store.start();
		await store.savePreferences({ sidebarSide: "right" });
		answer({ sidebarSide: "left", editor: null });
		await settle();
		expect(store.getState().preferences).toEqual({ sidebarSide: "right", editor: null });
	});

	test("preferences that cannot be read leave the defaults and a reason, until a save works", async () => {
		const engine = createMockEngine();
		engine.loadPreferences = async () => {
			throw new Error("permission denied");
		};
		const store = await startedStore(engine);
		expect(store.getState().preferences).toEqual(defaultPreferences());
		expect(store.getState().preferencesProblem).toBe("permission denied");
		await store.savePreferences({ sidebarSide: "right" });
		expect(store.getState().preferencesProblem).toBeNull();
	});

	test("an older save that answers after a newer one never replaces it on screen", async () => {
		const engine = createMockEngine();
		const answers: ((result: SavePreferencesResult) => void)[] = [];
		engine.savePreferences = () => new Promise(resolve => {
			answers.push(resolve);
		});
		const store = await startedStore(engine);
		const first = store.savePreferences({ sidebarSide: "left" });
		const second = store.savePreferences({ sidebarSide: "right" });
		answers[1]!({ outcome: "saved", preferences: { sidebarSide: "right", editor: null } });
		await second;
		answers[0]!({ outcome: "saved", preferences: { sidebarSide: "left", editor: null } });
		await first;
		expect(store.getState().preferences).toEqual({ sidebarSide: "right", editor: null });
	});

	test("a change the engine cannot read is a failed save", async () => {
		const store = await startedStore();
		const result = await store.savePreferences({ sidebarSide: "top" as "left" });
		expect(result.outcome).toBe("failed");
		expect(store.getState().preferences).toEqual(defaultPreferences());
	});

	test("saving the side leaves the layout alone", async () => {
		const engine = createMockEngine();
		const store = await startedStore(engine);
		store.resizeSidebar(360);
		await store.saveLayout();
		await store.savePreferences({ sidebarSide: "right" });
		expect(store.getState().layout.sidebarWidth).toBe(360);
		expect((await engine.loadLayout()).sidebarWidth).toBe(360);
	});
});
