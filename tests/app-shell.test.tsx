import { describe, expect, test } from "bun:test";
import type { MouseEvent, ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { Sidebar } from "../src/mainview/components/Sidebar";
import { createMockEngine, sampleRepositories, sampleTimberStatuses, sampleUnavailableRepository } from "../src/mainview/engine/mock";
import { StoreProvider } from "../src/mainview/store/react";
import { createAppStore } from "../src/mainview/store/store";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const API_SERVER = "/work/api-server";
const FEATURE_ID = sampleRepositories[0]!.worktrees[1]!.id;
const API_MAIN_ID = sampleRepositories[1]!.worktrees[0]!.id;

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine);
	store.start();
	await settle();
	return { store, engine };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

/** The opening tag of the first element with this class name. */
function tagOf(markup: string, className: string): string {
	const match = new RegExp(`<[a-z0-9]+ [^>]*class="${className}"[^>]*>`).exec(markup);
	if (!match) throw new Error(`No element with class "${className}"`);
	return match[0];
}

/** The markup of the sidebar group of one repository. */
function groupOf(markup: string, name: string): string {
	const match = new RegExp(`<section class="group" aria-label="${name}">.*?</section>`).exec(markup);
	if (!match) throw new Error(`No group for ${name}`);
	return match[0];
}

const rowsIn = (markup: string) => markup.match(/class="row( selected)?"/g)?.length ?? 0;

describe("title bar", () => {
	test("has the logo, the breadcrumb of the selection, and the palette button", async () => {
		const { store } = await startedStore();
		const markup = render(store);
		expect(markup).toMatch(/<img class="titlebar-logo"[^>]*alt="Timber"/);
		expect(markup).toMatch(/class="titlebar-repo" title="timber">timber</);
		expect(markup).toMatch(/class="titlebar-branch" title="main">main</);
	});

	test("the palette button is disabled and says it is not built yet", async () => {
		const { store } = await startedStore();
		const button = tagOf(render(store), "icon-button titlebar-palette");
		expect(button).toContain("disabled");
		expect(button).toContain('title="Command palette. Not built yet."');
		expect(button).toContain('aria-label="Command palette. Not built yet."');
	});

	test("the breadcrumb follows the selection into another repository", async () => {
		const { store } = await startedStore();
		store.select(API_MAIN_ID);
		const markup = render(store);
		expect(markup).toMatch(/class="titlebar-repo" title="api-server">api-server</);
		expect(markup).toMatch(/class="titlebar-branch" title="main">main</);
		expect(markup).toMatch(/class="path">\/work\/api-server</);
	});
});

describe("sidebar", () => {
	test("groups worktrees under a header per repository, with Add repository after the list and Settings at the bottom", async () => {
		const { store } = await startedStore();
		const markup = render(store);
		expect(rowsIn(groupOf(markup, "timber"))).toBe(4);
		expect(rowsIn(groupOf(markup, "api-server"))).toBe(3);
		const lastGroup = markup.lastIndexOf('<section class="group"');
		const add = markup.indexOf('class="add-repository"');
		const settings = markup.indexOf('class="icon-button sidebar-settings"');
		expect(lastGroup).toBeLessThan(add);
		expect(add).toBeLessThan(settings);
		expect(settings).toBeLessThan(markup.indexOf("</aside>"));
	});

	test("the Settings cog works and is named Settings", async () => {
		const { store } = await startedStore();
		const button = tagOf(render(store), "icon-button sidebar-settings");
		expect(button).not.toContain("disabled");
		expect(button).toContain('aria-label="Settings"');
		expect(button).toContain('aria-haspopup="dialog"');
	});

	test("a collapsed group hides its rows, says so, and is still collapsed after a restart", async () => {
		const { store, engine } = await startedStore();
		expect(groupOf(render(store), "api-server")).toContain('aria-expanded="true"');

		store.toggleGroup(API_SERVER);
		await settle();
		let markup = render(store);
		expect(groupOf(markup, "api-server")).toContain('aria-expanded="false"');
		expect(rowsIn(groupOf(markup, "api-server"))).toBe(0);
		expect(rowsIn(groupOf(markup, "timber"))).toBe(4);

		// A new store on the same engine is what the window has after a restart.
		const restarted = (await startedStore(engine)).store;
		markup = render(restarted);
		expect(groupOf(markup, "api-server")).toContain('aria-expanded="false"');
		expect(rowsIn(markup)).toBe(4);

		restarted.toggleGroup(API_SERVER);
		await settle();
		markup = render((await startedStore(engine)).store);
		expect(groupOf(markup, "api-server")).toContain('aria-expanded="true"');
		expect(rowsIn(markup)).toBe(7);
	});

	test("the sidebar takes the saved width, and its handle is a focusable separator that says where it stands", async () => {
		const { store, engine } = await startedStore();
		expect(tagOf(render(store), "body")).toContain('style="--sidebar-width:272px"');
		store.resizeSidebar(360);
		await store.saveLayout();

		const markup = render((await startedStore(engine)).store);
		expect(tagOf(markup, "body")).toContain('style="--sidebar-width:360px"');
		const handle = tagOf(markup, "resizer");
		for (const part of ['role="separator"', 'aria-orientation="vertical"', 'aria-label="Sidebar width"', 'aria-controls="sidebar"', 'aria-valuemin="200"', 'aria-valuemax="480"', 'aria-valuenow="360"', 'tabindex="0"']) {
			expect(handle).toContain(part);
		}
		expect(markup).toContain('<aside id="sidebar"');
	});

	test("a layout that could not be saved is noted in the sidebar until dismissed, without a toast", async () => {
		const { store, engine } = await startedStore();
		engine.failLayoutSaves("Could not save settings to /cfg/settings.json: disk full");
		store.toggleGroup(TIMBER);
		await settle();
		let markup = render(store);
		expect(markup).toContain("Could not save the layout");
		expect(markup).toContain("Could not save settings to /cfg/settings.json: disk full");
		expect(markup).not.toContain('class="toast"');
		// The change itself stays on screen.
		expect(groupOf(markup, "timber")).toContain('aria-expanded="false"');

		store.dismissLayoutProblem();
		markup = render(store);
		expect(markup).not.toContain("Could not save the layout");
	});

	test("every available repository has a + for a new worktree, and an unavailable one has none", async () => {
		const { store } = await startedStore(createMockEngine([...sampleRepositories, sampleUnavailableRepository]));
		const markup = render(store);
		for (const name of ["timber", "api-server"]) {
			const button = tagOf(groupOf(markup, name), "icon-button group-new");
			expect(button).toContain(`aria-label="New worktree in ${name}"`);
			expect(button).toContain(`title="New worktree in ${name}"`);
		}
		expect(groupOf(markup, "old-prototype")).not.toContain("group-new");
	});
});

/** Every element in a rendered tree, in order. */
function elementsIn(node: ReactNode): ReactElement<Record<string, unknown>>[] {
	if (Array.isArray(node)) return node.flatMap(elementsIn);
	if (typeof node !== "object" || node === null || !("props" in node)) return [];
	const element = node as ReactElement<Record<string, unknown>>;
	return [element, ...elementsIn(element.props.children as ReactNode)];
}

describe("the + on a repository header", () => {
	test("asks for the New dialog of that repository, which is drawn until it is closed", async () => {
		const { store } = await startedStore();
		expect(store.getState().dialog).toBeNull();

		// Render the sidebar once to reach the button's own handler, then click it.
		let plus: ReactElement<Record<string, unknown>> | undefined;
		function Probe() {
			plus = elementsIn(Sidebar()).find(element => element.props["aria-label"] === "New worktree in api-server");
			return null;
		}
		renderToStaticMarkup(<StoreProvider store={store}><Probe /></StoreProvider>);
		expect(plus?.props.className).toBe("icon-button group-new");
		(plus!.props.onClick as (event: MouseEvent) => void)({} as MouseEvent);

		expect(store.getState().dialog).toEqual({ kind: "new-worktree", repository: API_SERVER });
		// The request is held in the store, and the New dialog is drawn for it.
		expect(render(store)).toContain("<dialog");
		store.closeDialog();
		expect(store.getState().dialog).toBeNull();
		expect(render(store)).not.toContain("<dialog");
	});
});

describe("workspace", () => {
	test("follows the selection: header, path, and breadcrumb all change together", async () => {
		const { store } = await startedStore();
		let markup = render(store);
		expect(markup).toMatch(/class="workspace-title" title="main">main</);
		expect(markup).toMatch(/class="path">\/work\/timber</);

		store.select(FEATURE_ID);
		markup = render(store);
		expect(markup).toMatch(/class="workspace-title" title="feat\/github-issue-lookup">feat\/github-issue-lookup</);
		expect(markup).toMatch(/class="titlebar-branch" title="feat\/github-issue-lookup">/);
		expect(markup).toMatch(/class="path">\/work\/timber-worktrees\/feat-github-issue-lookup</);
		expect(markup).toContain("3 modified, 1 untracked");
	});

	test("has a tab list with Workspace showing, and only that tab is a tab stop", async () => {
		const { store } = await startedStore();
		const markup = render(store);
		expect(markup).toMatch(/<div class="tabs" role="tablist" aria-label="[^"]+">/);
		expect(markup).toMatch(/<button type="button" role="tab" id="tab-workspace" class="tab selected" aria-selected="true" aria-controls="workspace-panel" tabindex="0">Workspace</);
		expect(markup).toMatch(/<button type="button" role="tab" id="tab-changes" class="tab" aria-selected="false" aria-controls="workspace-panel" tabindex="-1">Changes</);
		const panel = tagOf(markup, "tabpanel workspace-panel");
		expect(panel).toContain('role="tabpanel"');
		expect(panel).toContain('id="workspace-panel"');
		expect(panel).toContain('aria-labelledby="tab-workspace"');
		// It holds the button that starts a terminal, so it needs no tab stop of its own.
		expect(panel).not.toContain("tabindex");
		expect(markup).toContain("No terminal here yet");
		expect(markup).toContain(">Open terminal</button>");
	});

	test("the Changes tab shows its own panel, and the tab stop moves with it", async () => {
		const { store } = await startedStore();
		store.showTab("changes");
		const markup = render(store);
		expect(markup).toMatch(/id="tab-changes" class="tab selected" aria-selected="true" aria-controls="workspace-panel" tabindex="0"/);
		expect(markup).toMatch(/id="tab-workspace" class="tab" aria-selected="false" aria-controls="workspace-panel" tabindex="-1"/);
		expect(tagOf(markup, "tabpanel workspace-panel")).toContain('aria-labelledby="tab-changes"');
		// Before the first read answers.
		expect(markup).toContain("Reading changes");
		expect(markup).not.toContain("No terminal here yet");
	});

	test("an arrow key on the tab list shows the next tab", async () => {
		const { store } = await startedStore();
		// The tab list's own key handler, called as the browser would on ArrowRight.
		const { Workspace } = await import("../src/mainview/components/Workspace");
		let tabs: ReactElement<Record<string, unknown>> | undefined;
		function Probe() {
			tabs = elementsIn(Workspace()).find(element => element.props.role === "tablist");
			return null;
		}
		const press = (key: string) => {
			renderToStaticMarkup(<StoreProvider store={store}><Probe /></StoreProvider>);
			let prevented = false;
			(tabs!.props.onKeyDown as (event: unknown) => void)({ key, preventDefault: () => { prevented = true; } });
			return prevented;
		};
		// The handler also moves focus, which needs a document. This run has none worth the name.
		Object.assign(globalThis, { document: { getElementById: () => null } });
		try {
			expect(press("ArrowRight")).toBe(true);
			expect(store.getState().tab).toBe("changes");
			expect(press("ArrowRight")).toBe(true);
			expect(store.getState().tab).toBe("workspace");
			expect(press("End")).toBe(true);
			expect(store.getState().tab).toBe("changes");
			expect(press("Tab")).toBe(false);
			expect(store.getState().tab).toBe("changes");
		} finally {
			Reflect.deleteProperty(globalThis, "document");
		}
	});

	test("with nothing selected there are no tabs, only the offer to add a repository", async () => {
		const { store } = await startedStore(createMockEngine([]));
		const markup = render(store);
		expect(markup).toContain("No repository yet");
		expect(markup).not.toContain('role="tablist"');
		expect(markup).toMatch(/class="titlebar-repo">Timber</);
	});
});

describe("very long names", () => {
	const longRepository = "platform-services-monorepo-with-an-unreasonably-long-repository-folder-name";
	const longBranch = "feat/PROJ-12345-rework-the-entire-authentication-flow-so-that-refresh-tokens-rotate-on-every-request";

	test("carry the whole name as a tooltip in the breadcrumb, the group header, and the workspace header", async () => {
		const changed = structuredClone(sampleRepositories);
		changed[0]!.name = longRepository;
		changed[0]!.worktrees[0]!.branch = longBranch;
		const { store } = await startedStore(createMockEngine(changed));
		const markup = render(store);
		expect(markup).toContain(`class="titlebar-repo" title="${longRepository}">${longRepository}<`);
		expect(markup).toContain(`class="titlebar-branch" title="${longBranch}">${longBranch}<`);
		expect(markup).toContain(`class="workspace-title" title="${longBranch}">${longBranch}<`);
		expect(tagOf(markup, "group-header")).toContain(`title="${longRepository} (${TIMBER})"`);
	});
});

/** Where in the markup each part of the body starts, so their order can be compared. */
function bodyOrder(markup: string) {
	return {
		sidebar: markup.indexOf('<aside id="sidebar"'),
		resizer: markup.indexOf('class="resizer"'),
		workspace: markup.indexOf('<main class="workspace"'),
	};
}

describe("sidebar side", () => {
	test("the sidebar is on the left at first: sidebar, edge, workspace", async () => {
		const { store } = await startedStore();
		const markup = render(store);
		const order = bodyOrder(markup);
		expect(markup).toContain('<div class="body" ');
		expect(markup).not.toContain("sidebar-right");
		expect(order.sidebar).toBeGreaterThan(-1);
		expect(order.sidebar).toBeLessThan(order.resizer);
		expect(order.resizer).toBeLessThan(order.workspace);
	});

	test("saved on the right, the parts come in the order they are seen, so the keyboard reaches them that way too", async () => {
		const { store } = await startedStore();
		await store.savePreferences({ sidebarSide: "right" });
		const markup = render(store);
		const order = bodyOrder(markup);
		expect(markup).toContain('<div class="body sidebar-right" ');
		expect(order.workspace).toBeGreaterThan(-1);
		expect(order.workspace).toBeLessThan(order.resizer);
		expect(order.resizer).toBeLessThan(order.sidebar);
		// The edge still says what it controls and how wide it is.
		expect(tagOf(markup, "resizer")).toContain('aria-controls="sidebar"');
		expect(tagOf(markup, "resizer")).toContain('aria-valuenow="272"');
	});

	test("a restarted app puts the sidebar where it was saved", async () => {
		const engine = createMockEngine();
		await (await startedStore(engine)).store.savePreferences({ sidebarSide: "right" });
		const { store } = await startedStore(engine);
		expect(render(store)).toContain('<div class="body sidebar-right" ');
	});

	test("the main window has no control for the side, only Settings has", async () => {
		const { store } = await startedStore();
		const markup = render(store);
		expect(markup).not.toContain("Sidebar side");
		expect(markup).not.toContain('name="sidebar-side"');
		store.openDialog({ kind: "settings" });
		expect(render(store)).toContain("Sidebar side");
	});
});

describe("settings dialog", () => {
	test("opens at Layout, with the sections down the side and the saved side chosen", async () => {
		const { store } = await startedStore();
		store.openDialog({ kind: "settings" });
		const markup = render(store);
		expect(markup).toMatch(/<dialog class="dialog settings-dialog" aria-labelledby="[^"]+">/);
		expect(markup).toMatch(/<h2 [^>]*class="dialog-title">Settings<\/h2>/);
		expect(markup).toContain('<nav class="settings-nav" aria-label="Settings sections">');
		expect(markup).toMatch(/class="settings-nav-item selected" aria-current="page"[^>]*>Layout</);
		expect(markup).toContain('<input type="radio" name="sidebar-side" checked="" value="left"/>');
		expect(markup).toContain('<input type="radio" name="sidebar-side" value="right"/>');
	});

	test("Save is marked unavailable while nothing differs from what is saved, and stays focusable", async () => {
		const { store } = await startedStore();
		store.openDialog({ kind: "settings", section: "layout" });
		expect(render(store)).toContain('<button type="submit" class="button primary" aria-disabled="true">Save</button>');
	});

	test("each section is a panel named by its entry in the list, and only the chosen one shows", async () => {
		const { store } = await startedStore();
		store.openDialog({ kind: "settings" });
		const markup = render(store);
		const nav = /<button type="button" id="([^"]+)" class="settings-nav-item selected" aria-current="page" aria-controls="([^"]+)"/.exec(markup);
		expect(nav).not.toBeNull();
		expect(markup).toContain(`<div class="settings-panel" id="${nav![2]}" aria-labelledby="${nav![1]}">`);
		// Every other section stays mounted, hidden, so what was typed in it survives a switch.
		expect(markup.match(/class="settings-panel"[^>]*hidden=""/g)?.length).toBe(1);
		expect(markup).toMatch(/class="settings-panel" id="[^"]*-panel-editor"[^>]*hidden=""/);
	});

	test("says when the saved settings could not be read", async () => {
		const engine = createMockEngine();
		engine.loadPreferences = async () => {
			throw new Error("permission denied");
		};
		const { store } = await startedStore(engine);
		store.openDialog({ kind: "settings" });
		const markup = render(store);
		expect(markup).toContain("Could not read the saved settings");
		expect(markup).toContain("permission denied");
	});

	test("shows what is saved, and like every dialog waits for Timber", async () => {
		const { store } = await startedStore();
		await store.savePreferences({ sidebarSide: "right" });
		store.openDialog({ kind: "settings" });
		expect(render(store)).toContain('<input type="radio" name="sidebar-side" checked="" value="right"/>');

		const { store: waiting } = await startedStore(createMockEngine(sampleRepositories, sampleTimberStatuses["not-found"]));
		waiting.openDialog({ kind: "settings" });
		expect(render(waiting)).not.toContain("settings-dialog");
	});
});
