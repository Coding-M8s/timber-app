import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import {
	CHOPS_PANEL_SHORTCUT, CHOPS_PANEL_SHORTCUT_MAC, chopMatches, chopSourceShort, chopsButtonHint, chopsPanelModel, chopsTabAfterKey, describeChopsPanelEmpty,
	describeChopsTabEmpty, isChopsPanelShortcut, takesChopsPanelKey,
} from "../src/mainview/chops-panel-format";
import { BEING_REMOVED_REASON } from "../src/mainview/done-format";
import { worktreeLabel } from "../src/mainview/format";
import { FOLDER_MISSING_FOR_SESSION, NO_WORKTREE_SELECTED, STARTING_SESSION, chopBlockedReason, isPaletteShortcut, paletteEntries } from "../src/mainview/palette";
import { runChopIn } from "../src/mainview/palette-run";
import { chopsWidthAfterDrag, chopsWidthAfterKey, SIDEBAR_KEY_STEP } from "../src/mainview/shell";
import { createMockEngine, sampleRepositories, sampleTimberStatuses } from "../src/mainview/engine/mock";
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
const chop = { name: "Test", kind: "command" as const, text: "bun test", description: "", agent: null, repository: null, sound: null };

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
		expect(panel).toMatch(/<pre id="[^"]+" class="chops-panel-text" data-chop-text="Test" tabindex="0">bun test<\/pre>/);
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

describe("the chops panel's list and filter", () => {
	const sample = [
		{ name: "Typecheck", kind: "command" as const, text: "bun run typecheck", description: "", agent: null, source: "personal-repository" as const },
		{ name: "Deploy", kind: "command" as const, text: "bun run deploy --preview", description: "", agent: null, source: "repository-file" as const },
	];

	test("the filter matches names and text, ignoring case and spaces around it, and not the description", () => {
		expect(sample.filter(chop => chopMatches(chop, "")).map(chop => chop.name)).toEqual(["Typecheck", "Deploy"]);
		expect(sample.filter(chop => chopMatches(chop, " typeCHECK ")).map(chop => chop.name)).toEqual(["Typecheck"]);
		expect(sample.filter(chop => chopMatches(chop, "--preview")).map(chop => chop.name)).toEqual(["Deploy"]);
		expect(chopMatches({ name: "A", text: "b" }, "description")).toBe(false);
	});

	test("says so when nothing matches, and when a tab has none", () => {
		expect(describeChopsTabEmpty("command", " lint ")).toBe('No commands match "lint".');
		expect(describeChopsTabEmpty("prompt", "x")).toBe('No prompts match "x".');
		expect(describeChopsTabEmpty("prompt", "")).toBe("No prompts yet. Make one with New chop.");
	});

	test("each source in few words", () => {
		expect(chopSourceShort("repository-file")).toBe(".timber");
		expect(chopSourceShort("personal-repository")).toBe("this repository");
		expect(chopSourceShort("personal-every")).toBe("every repository");
	});

	test("the arrows move between the two tabs, Home and End go to the first and last", () => {
		expect(chopsTabAfterKey("command", "ArrowRight")).toBe("prompt");
		expect(chopsTabAfterKey("prompt", "ArrowRight")).toBe("command");
		expect(chopsTabAfterKey("command", "ArrowLeft")).toBe("prompt");
		expect(chopsTabAfterKey("prompt", "Home")).toBe("command");
		expect(chopsTabAfterKey("command", "End")).toBe("prompt");
		expect(chopsTabAfterKey("command", "Enter")).toBeNull();
	});
});

describe("the chops panel's model (mock engine)", () => {
	const TIMBER = "/work/timber";
	const FEATURE = sampleRepositories[0]!.worktrees[1]!;
	const label = worktreeLabel(FEATURE);

	async function panelStore() {
		const started = await startedStore();
		await started.store.savePreferences({ chops: [chop] });
		started.store.select(FEATURE.id);
		await started.store.readChops(TIMBER);
		return started;
	}

	test("counts each kind, lists the tab's chops with source and text, and says where a command runs", async () => {
		const { store } = await panelStore();
		const model = chopsPanelModel(store.getState(), "command", "");
		expect(model.repository).toBe(TIMBER);
		// The sample file shares Test, Dev server, and a prompt; the personal Test takes the file's place.
		expect(model.counts).toEqual({ command: 2, prompt: 1 });
		expect(model.rows.map(row => [row.chop.name, row.source, row.chop.text, row.word, row.label])).toEqual([
			["Test", "every repository", "bun test", "Run", "Run Test"],
			["Dev server", ".timber", "bun run dev:web", "Run", "Run Dev server"],
		]);
		expect(model.rows[1]!.sourceTitle).toBe("From the repository");
		expect(model.blocked).toBeNull();
		expect(model.footer).toBe(`Commands run in a new terminal in ${label}.`);
		expect(model.tabEmpty).toBeNull();
	});

	test("the filter narrows the tab, and the counts stay", async () => {
		const { store } = await panelStore();
		expect(chopsPanelModel(store.getState(), "command", "dev:web").rows.map(row => row.chop.name)).toEqual(["Dev server"]);
		const none = chopsPanelModel(store.getState(), "command", "nothing like it");
		expect(none.rows).toEqual([]);
		expect(none.tabEmpty).toBe('No commands match "nothing like it".');
		expect(none.counts).toEqual({ command: 2, prompt: 1 });
	});

	test("with no worktree selected, the chops last read stay listed and none can run, with the reason", async () => {
		const { store } = await panelStore();
		const model = chopsPanelModel({ ...store.getState(), selection: null }, "command", "");
		expect(model.rows.map(row => row.chop.name)).toEqual(["Test", "Dev server"]);
		expect(model.blocked).toBe(NO_WORKTREE_SELECTED);
		expect(model.footer).toBe(NO_WORKTREE_SELECTED);
		expect(chopsPanelModel({ ...store.getState(), selection: null }, "prompt", "").blocked).toBe(NO_WORKTREE_SELECTED);
	});

	test("blocked for the palette's reasons: a missing folder, a session starting, the worktree being removed", async () => {
		const { store } = await panelStore();
		const state = store.getState();
		const starting = { ...state, operations: [...state.operations, { kind: "open-terminal" as const, worktree: FEATURE.id, agent: null }] };
		expect(chopsPanelModel(starting, "command", "").blocked).toBe(STARTING_SESSION);
		// A prompt waits for no session to start.
		expect(chopsPanelModel(starting, "prompt", "").blocked).toBeNull();
		const removing = { ...state, removals: [{ repository: TIMBER, worktree: FEATURE, toast: "", status: { kind: "running" as const } }] };
		expect(chopsPanelModel(removing, "command", "").footer).toBe(BEING_REMOVED_REASON);
		// The palette gives the same reason for the same chop.
		expect(paletteEntries(removing).find(entry => entry.label === "Run chop: Test")?.disabledReason).toBe(BEING_REMOVED_REASON);
		expect(chopBlockedReason("run", { pathExists: false, starting: true, removing: true })).toBe(FOLDER_MISSING_FOR_SESSION);
		expect(chopBlockedReason("copy", { pathExists: false, starting: true, removing: true })).toBeNull();
		expect(chopBlockedReason("copy", null)).toBe(NO_WORKTREE_SELECTED);
	});

	test("the Prompts tab says where a prompt goes: a new agent, the only one running, the one picked, or the clipboard", async () => {
		const { store } = await panelStore();
		const first = store.getState().preferences.agents[0]!.name;
		const none = chopsPanelModel(store.getState(), "prompt", "");
		expect(none.rows.map(row => [row.chop.name, row.word, row.label])).toEqual([["Review the diff", "Send", "Send Review the diff"]]);
		expect(none.footer).toBe(`Prompts start a new agent in ${label}: the one the chop names, or ${first}.`);
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE.path, cols: 80, rows: 24, agent: first });
		await settle();
		expect(chopsPanelModel(store.getState(), "prompt", "").footer).toBe(`Prompts go to ${first} in ${label}.`);
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE.path, cols: 80, rows: 24, agent: first });
		await settle();
		expect(chopsPanelModel(store.getState(), "prompt", "").footer).toBe(`You pick the agent in ${label} when you send a prompt.`);
		await store.savePreferences({ agents: [] });
		const copy = chopsPanelModel(store.getState(), "prompt", "");
		expect(copy.rows[0]).toMatchObject({ word: "Copy", label: "Copy Review the diff" });
		expect(copy.footer).toBe("No agent is saved in Settings, Agents, so a prompt is copied to the clipboard.");
	});
});

describe("running a chop from the panel (mock engine)", () => {
	const TIMBER = "/work/timber";
	const FEATURE = sampleRepositories[0]!.worktrees[1]!;
	const size = () => ({ cols: 80, rows: 24 });

	async function panelStore() {
		const started = await startedStore();
		await started.store.savePreferences({ chops: [chop, { name: "Hello", kind: "command", text: "pwd", description: "", agent: null, repository: null, sound: null }] });
		started.store.select(FEATURE.id);
		await started.store.readChops(TIMBER);
		return started;
	}

	test("a personal command runs in a new terminal in the selected worktree, and the Workspace tab shows it", async () => {
		const { engine, store } = await panelStore();
		store.showTab("changes");
		runChopIn(store, TIMBER, FEATURE.id, "Hello", size);
		await settle();
		const session = store.getState().terminals.find(candidate => candidate.name === "Hello")!;
		expect(session).toMatchObject({ kind: "terminal", worktree: FEATURE.id, state: { kind: "running" } });
		expect(store.getState().tab).toBe("workspace");
		expect(engine.typedInto(session.id)).toBe("pwd\r");
	});

	test("a chop from .timber/chops.json still asks before its first run, and runs nothing until approved", async () => {
		const { store } = await panelStore();
		runChopIn(store, TIMBER, FEATURE.id, "Dev server", size);
		await settle();
		expect(store.getState().terminals).toEqual([]);
		expect(store.getState().dialog).toMatchObject({ kind: "approve-chop", chop: { name: "Dev server", text: "bun run dev:web" } });
	});

	test("Run puts the issues board away, as choosing the worktree does", async () => {
		const { store } = await panelStore();
		store.openBoard(TIMBER);
		expect(store.getState().board).toBe(TIMBER);
		runChopIn(store, TIMBER, FEATURE.id, "Hello", size);
		await settle();
		expect(store.getState().board).toBeNull();
	});

	test("Copy with no agent saved leaves the view as it is", async () => {
		const { engine, store } = await panelStore();
		await store.savePreferences({ agents: [] });
		store.showTab("changes");
		runChopIn(store, TIMBER, FEATURE.id, "Review the diff", size, false);
		await settle();
		expect(store.getState().tab).toBe("changes");
		expect(await engine.readClipboard()).toContain("Review the changes on this branch");
	});

	test("a prompt goes to the only agent running, as from the palette", async () => {
		const { engine, store } = await panelStore();
		const agent = store.getState().preferences.agents[0]!.name;
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE.path, ...size(), agent });
		await settle();
		const running = store.getState().terminals[0]!;
		// The sample file's prompt asks first; approved, it goes to the running agent and no agent starts.
		runChopIn(store, TIMBER, FEATURE.id, "Review the diff", size);
		await settle();
		expect(store.getState().dialog).toMatchObject({ kind: "approve-chop", chop: { name: "Review the diff" }, session: running.id });
		store.closeDialog();
		await store.runChop(TIMBER, FEATURE.id, "Review the diff", size(), "Review the changes on this branch against main.\nList risks and missing tests, most serious first.", { session: running.id });
		await settle();
		expect(store.getState().terminals).toHaveLength(1);
		expect(engine.promptsSentTo(running.id)).toHaveLength(1);
	});

	test("with Use chops off nothing runs", async () => {
		const { store } = await panelStore();
		await store.savePreferences({ useChops: false });
		runChopIn(store, TIMBER, FEATURE.id, "Hello", size);
		await settle();
		expect(store.getState().terminals).toEqual([]);
	});
});

describe("the chops panel as drawn, with runs", () => {
	test("tabs with counts, a filter, rows with source and Run, and the footer", async () => {
		const { store } = await startedStore();
		await store.savePreferences({ chops: [chop] });
		store.select(sampleRepositories[0]!.worktrees[1]!.id);
		await store.readChops("/work/timber");
		store.toggleChopsPanel();
		const panel = render(store).split('id="chops-panel"')[1]!;
		expect(panel).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Commands <span class="chops-panel-count">2<\/span>/);
		expect(panel).toMatch(/role="tab"[^>]*aria-selected="false"[^>]*>Prompts <span class="chops-panel-count">1<\/span>/);
		expect(panel).toContain('aria-label="Filter chops"');
		expect(panel).toContain('<span class="chop-item-meta" title="From the repository">.timber</span>');
		expect(panel).toMatch(/aria-label="Run Dev server" aria-disabled="false"/);
		expect(panel).toContain("Commands run in a new terminal in");
	});

	test("with no worktree selected, Run is disabled with the reason, and stays focusable", async () => {
		const { store } = await startedStore();
		await store.savePreferences({ chops: [chop] });
		await store.readChops("/work/timber");
		store.toggleChopsPanel();
		const state = store.getState();
		(state as { selection: unknown }).selection = null;
		const panel = render(store).split('id="chops-panel"')[1]!;
		expect(panel).toMatch(new RegExp(`aria-label="Run Test" aria-disabled="true" aria-describedby="[^"]+-text-0 [^"]+-footer" title="${NO_WORKTREE_SELECTED}"`));
		expect(panel).not.toMatch(/chops-panel-run"[^>]* disabled=""/);
		expect(panel).toContain(`class="chops-panel-footer">${NO_WORKTREE_SELECTED}</p>`);
	});
});
