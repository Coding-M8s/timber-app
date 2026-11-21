import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import {
	CHOPS_PANEL_SHORTCUT, CHOPS_PANEL_SHORTCUT_MAC, chopsButtonHint, describeChopsPanelEmpty, isChopsPanelShortcut, takesChopsPanelKey,
} from "../src/mainview/chops-panel-format";
import { isPaletteShortcut } from "../src/mainview/palette";
import { chopsWidthAfterDrag, chopsWidthAfterKey, SIDEBAR_KEY_STEP } from "../src/mainview/shell";
import { createMockEngine, sampleTimberStatuses } from "../src/mainview/engine/mock";
import { canToggleChopsPanel, chopsEnabled, chopsPanelShown } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { isWaitingShortcut } from "../src/mainview/waiting";
import { DEFAULT_CHOPS_WIDTH, MAX_CHOPS_WIDTH, MIN_CHOPS_WIDTH } from "../src/shared/layout";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { engine, store };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);
const key = (key: string, modifiers: Partial<Record<"ctrlKey" | "shiftKey" | "metaKey" | "altKey", boolean>> = {}) =>
	({ type: "keydown", key, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, ...modifiers });
const chop = { name: "Test", kind: "command" as const, text: "bun test", description: "", agent: null, repository: null };

describe("the chops panel shortcut", () => {
	test("is Ctrl+Shift+K, or Cmd+Shift+K on macOS, read by the character", () => {
		expect(isChopsPanelShortcut(key("K", { ctrlKey: true, shiftKey: true }))).toBe(true);
		expect(isChopsPanelShortcut(key("k", { metaKey: true, shiftKey: true }))).toBe(true);
		expect(CHOPS_PANEL_SHORTCUT).toBe("Ctrl+Shift+K");
		expect(CHOPS_PANEL_SHORTCUT_MAC).toBe("Cmd+Shift+K");
	});

	test("is not Ctrl+K, Ctrl+Alt+K (AltGr on Windows), the mock's Ctrl+Alt+C, or a key let go", () => {
		expect(isChopsPanelShortcut(key("k", { ctrlKey: true }))).toBe(false);
		expect(isChopsPanelShortcut(key("K", { ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
		expect(isChopsPanelShortcut(key("c", { ctrlKey: true, altKey: true }))).toBe(false);
		expect(isChopsPanelShortcut(key("K", { shiftKey: true }))).toBe(false);
		expect(isChopsPanelShortcut({ ...key("K", { ctrlKey: true, shiftKey: true }), type: "keyup" })).toBe(false);
	});

	test("does not clash with the app's other shortcuts", () => {
		const chord = key("K", { ctrlKey: true, shiftKey: true });
		expect(isPaletteShortcut(chord)).toBe(false);
		expect(isWaitingShortcut(chord)).toBe(false);
		for (const other of ["P", "J", "S", "C", "V"]) expect(isChopsPanelShortcut(key(other, { ctrlKey: true, shiftKey: true }))).toBe(false);
	});

	test("the button's tooltip says what a click does and names the shortcut", () => {
		expect(chopsButtonHint(false, false)).toBe("Show chops (Ctrl+Shift+K)");
		expect(chopsButtonHint(true, true)).toBe("Hide chops (Cmd+Shift+K)");
	});
});

describe("the chops panel's width from its edge", () => {
	test("the arrow toward the workspace widens it, the other narrows it, within its limits", () => {
		expect(chopsWidthAfterKey(320, "ArrowLeft")).toBe(320 + SIDEBAR_KEY_STEP);
		expect(chopsWidthAfterKey(320, "ArrowRight")).toBe(320 - SIDEBAR_KEY_STEP);
		expect(chopsWidthAfterKey(320, "Home")).toBe(MIN_CHOPS_WIDTH);
		expect(chopsWidthAfterKey(320, "End")).toBe(MAX_CHOPS_WIDTH);
		expect(chopsWidthAfterKey(MAX_CHOPS_WIDTH, "ArrowLeft")).toBe(MAX_CHOPS_WIDTH);
		expect(chopsWidthAfterKey(320, "Enter")).toBeNull();
	});

	test("a drag to the left widens it", () => {
		expect(chopsWidthAfterDrag(320, -40)).toBe(360);
		expect(chopsWidthAfterDrag(320, 40)).toBe(280);
		expect(chopsWidthAfterDrag(320, 4000)).toBe(MIN_CHOPS_WIDTH);
	});
});

describe("the chops panel in the store", () => {
	test("toggling shows and hides it, and a new store on the same engine remembers it, as a restart does", async () => {
		const { engine, store } = await startedStore();
		expect(chopsPanelShown(store.getState())).toBe(false);
		expect(store.toggleChopsPanel()).toBe(true);
		store.resizeChopsPanel(400);
		await store.saveLayout();
		await settle();
		expect(chopsPanelShown(store.getState())).toBe(true);
		expect(await engine.loadLayout()).toMatchObject({ chopsOpen: true, chopsWidth: 400 });
		const restarted = (await startedStore(engine)).store;
		expect(restarted.getState().layout).toMatchObject({ chopsOpen: true, chopsWidth: 400 });
		restarted.hideChopsPanel();
		await settle();
		expect(await engine.loadLayout()).toMatchObject({ chopsOpen: false, chopsWidth: 400 });
	});

	test("a width out of bounds is clamped", async () => {
		const { store } = await startedStore();
		store.resizeChopsPanel(5);
		expect(store.getState().layout.chopsWidth).toBe(MIN_CHOPS_WIDTH);
	});

	test("does nothing while a dialog is open", async () => {
		const { store } = await startedStore();
		store.openPalette();
		expect(canToggleChopsPanel(store.getState())).toBe(false);
		expect(store.toggleChopsPanel()).toBe(false);
		expect(store.getState().layout.chopsOpen).toBe(false);
		expect(takesChopsPanelKey(key("K", { ctrlKey: true, shiftKey: true }), store.getState())).toBe(false);
	});

	test("does nothing while Timber is not ready", async () => {
		const { store } = await startedStore(createMockEngine(undefined, sampleTimberStatuses["not-found"]));
		expect(chopsEnabled(store.getState())).toBe(false);
		expect(store.toggleChopsPanel()).toBe(false);
	});

	test("with Use chops off: no toggle, the key is not the app's, the panel does not show, and the saved chops stay", async () => {
		const { engine, store } = await startedStore();
		await store.savePreferences({ chops: [chop] });
		store.toggleChopsPanel();
		await store.savePreferences({ useChops: false });
		expect(chopsEnabled(store.getState())).toBe(false);
		expect(chopsPanelShown(store.getState())).toBe(false);
		expect(store.toggleChopsPanel()).toBe(false);
		expect(takesChopsPanelKey(key("K", { ctrlKey: true, shiftKey: true }), store.getState())).toBe(false);
		expect((await engine.loadPreferences()).chops).toEqual([chop]);
		// On again, the chops and the panel come back as they were.
		await store.savePreferences({ useChops: true });
		expect(store.getState().preferences.chops).toEqual([chop]);
		expect(chopsPanelShown(store.getState())).toBe(true);
		expect(takesChopsPanelKey(key("K", { ctrlKey: true, shiftKey: true }), store.getState())).toBe(true);
	});
});

describe("the chops panel as drawn", () => {
	test("the title bar has a Chops button, not pressed, and no panel shows by default", async () => {
		const { store } = await startedStore();
		const markup = render(store);
		expect(markup).toMatch(/<button type="button" id="titlebar-chops" class="titlebar-chops" aria-pressed="false" title="Show chops \((Ctrl|Cmd)\+Shift\+K\)">/);
		expect(markup).not.toContain('id="chops-panel"');
		expect(markup).not.toContain("Chops panel width");
	});

	test("shown, the panel sits on the workspace's right with its edge, and the button is pressed", async () => {
		const { store } = await startedStore();
		store.toggleChopsPanel();
		const markup = render(store);
		expect(markup).toMatch(/aria-pressed="true" aria-controls="chops-panel"/);
		expect(markup).toContain(`--chops-width:${DEFAULT_CHOPS_WIDTH}px`);
		const workspace = markup.indexOf('class="workspace');
		const edge = markup.indexOf('aria-label="Chops panel width"');
		const panel = markup.indexOf('id="chops-panel"');
		const sidebar = markup.indexOf('class="sidebar"');
		expect(sidebar).toBeLessThan(workspace);
		expect(workspace).toBeLessThan(edge);
		expect(edge).toBeLessThan(panel);
		expect(markup).toContain('aria-label="Hide the chops panel"');
	});

	test("with the sidebar on the right, the panel stays on the workspace's right, before the sidebar", async () => {
		const { store } = await startedStore();
		await store.savePreferences({ sidebarSide: "right" });
		store.toggleChopsPanel();
		const markup = render(store);
		const workspace = markup.indexOf('class="workspace');
		const panel = markup.indexOf('id="chops-panel"');
		const sidebarEdge = markup.indexOf('aria-label="Sidebar width"');
		expect(workspace).toBeLessThan(panel);
		expect(panel).toBeLessThan(sidebarEdge);
	});

	test("lists the chops of the selected worktree's repository", async () => {
		const { store } = await startedStore();
		await store.savePreferences({ chops: [chop] });
		// ChopsKeeper reads them in a window; a page drawn once runs no effects.
		await store.readChops("/work/timber");
		store.toggleChopsPanel();
		const markup = render(store);
		const panel = markup.slice(markup.indexOf('id="chops-panel"'));
		expect(panel).toContain('<span class="chop-item-name">Test</span>');
		expect(panel).toContain('<pre class="chops-panel-text">bun test</pre>');
	});

	test("with Use chops off there is no button, panel, or edge, even when the panel was left open", async () => {
		const { store } = await startedStore();
		store.toggleChopsPanel();
		await store.savePreferences({ useChops: false });
		const markup = render(store);
		expect(markup).not.toContain("titlebar-chops");
		expect(markup).not.toContain('id="chops-panel"');
		expect(markup).not.toContain("Chops panel width");
	});

	test("says what it is waiting for when there is nothing to list", () => {
		expect(describeChopsPanelEmpty(false, null)).toBe("Select a worktree to see the chops of its repository.");
		expect(describeChopsPanelEmpty(true, null)).toBe("Reading the chops");
		expect(describeChopsPanelEmpty(true, 0)).toContain("No chops yet");
		expect(describeChopsPanelEmpty(true, 2)).toBeNull();
	});
});
