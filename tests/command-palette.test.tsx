import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { matchEntries, paletteEntries } from "../src/mainview/palette";
import { runPaletteEntry } from "../src/mainview/palette-run";
import { createAppStore } from "../src/mainview/store/store";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const FEATURE_ID = sampleRepositories[0]!.worktrees[1]!.id;
const API_MAIN_ID = sampleRepositories[1]!.worktrees[0]!.id;
const size = () => ({ cols: 100, rows: 30 });

async function startedStore() {
	const store = createAppStore(createMockEngine());
	store.start();
	await settle();
	return store;
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);
/** Only the palette's dialog, so the sidebar's rows do not count. */
const renderPalette = (store: ReturnType<typeof createAppStore>) => {
	const markup = render(store);
	const start = markup.indexOf('<dialog class="dialog palette"');
	return markup.slice(start, markup.indexOf("</dialog>", start));
};
const choose = (store: Awaited<ReturnType<typeof startedStore>>, label: string) => {
	const entry = paletteEntries(store.getState()).find(candidate => candidate.label === label)!;
	runPaletteEntry(store, entry, size);
};

describe("the command palette", () => {
	test("the title bar button opens it as a dialog with a combobox and a listbox", async () => {
		const store = await startedStore();
		expect(render(store)).not.toContain('role="combobox"');
		store.openDialog({ kind: "palette" });
		const markup = render(store);
		expect(markup).toContain('role="combobox"');
		expect(markup).toContain('role="listbox"');
		expect(markup).toContain('class="dialog palette"');
		expect(markup).toMatch(/role="option"[^>]*aria-selected="true"/);
		expect(markup).toContain("feat/github-issue-lookup");
	});

	test("it opens scoped to the selected worktree's repository, in sections, with a line for the highlighted entry", async () => {
		const store = await startedStore();
		store.openDialog({ kind: "palette" });
		const markup = renderPalette(store);
		expect(markup).toContain('class="palette-scope"');
		expect(markup).toContain("Searching timber only. Search every repository");
		for (const heading of ["In main", "In timber", "Worktrees in timber", "App"]) expect(markup).toContain(`>${heading}</div>`);
		expect(markup).not.toContain("feat/rate-limit-headers");
		expect(markup).toContain(`Starts a shell in ${sampleRepositories[0]!.worktrees[0]!.path}.`);
		expect(markup).toContain("Backspace: all repositories");
		expect(markup).toContain(">Current</span>");
	});

	test("an action that cannot run is left out of the list and named in the line under it", async () => {
		const store = await startedStore();
		store.openDialog({ kind: "palette" });
		const markup = renderPalette(store);
		expect(markup).not.toMatch(/role="option"[^>]*>.*?<span class="palette-label">Done<\/span>/);
		expect(markup).toMatch(/class="palette-unavailable"[^>]*>[^<]*Done/);
		expect(markup).not.toContain("The primary checkout is never removed.");
	});

	test("the rows are the listbox's options, and headings are not", async () => {
		const store = await startedStore();
		store.openDialog({ kind: "palette" });
		const markup = renderPalette(store);
		const options = markup.match(/role="option"/g)!.length;
		const ids = [...markup.matchAll(/id="([^"]*-row-(\d+))"/g)].map(match => Number(match[2]));
		expect(ids).toEqual(Array.from({ length: options }, (_, index) => index));
		expect(markup).toMatch(/class="palette-heading" aria-hidden="true"/);
	});

	test("choosing a worktree selects it and closes the palette", async () => {
		const store = await startedStore();
		store.openDialog({ kind: "palette" });
		const match = matchEntries(paletteEntries(store.getState()), "rate-limit")[0]!;
		runPaletteEntry(store, match.entry, size);
		expect(store.getState().dialog).toBeNull();
		expect(store.getState().selection?.worktree).toBe(sampleRepositories[1]!.worktrees[1]!.id);
	});

	test("Rebase opens the rebase dialog for the selected worktree", async () => {
		const store = await startedStore();
		store.select(FEATURE_ID);
		store.openDialog({ kind: "palette" });
		choose(store, "Rebase");
		expect(store.getState().dialog).toEqual({ kind: "rebase-worktree", repository: TIMBER, worktree: FEATURE_ID });
	});

	test("Done on the primary checkout does nothing", async () => {
		const store = await startedStore();
		store.openDialog({ kind: "palette" });
		choose(store, "Done");
		expect(store.getState().dialog).toEqual({ kind: "palette" });
	});

	test("Open starts the New worktree dialog on its Existing branch mode", async () => {
		const store = await startedStore();
		store.openDialog({ kind: "palette" });
		choose(store, "Open existing branch");
		expect(store.getState().dialog).toEqual({ kind: "new-worktree", repository: TIMBER, mode: "existing" });
		expect(render(store)).toMatch(/class="mode-option selected"><input[^>]*checked=""\/><span class="mode-label">Existing branch/);
	});

	test("New worktree and the plus button start on New branch", async () => {
		const store = await startedStore();
		store.openDialog({ kind: "new-worktree", repository: TIMBER });
		expect(render(store)).toMatch(/class="mode-option selected"><input[^>]*checked=""\/><span class="mode-label">New branch/);
		choose(store, "New worktree");
		expect(render(store)).toMatch(/class="mode-option selected"><input[^>]*checked=""\/><span class="mode-label">New branch/);
	});

	test("Settings opens Settings, and Open in editor with no editor does too", async () => {
		const store = await startedStore();
		store.openDialog({ kind: "palette" });
		choose(store, "Settings");
		expect(store.getState().dialog).toEqual({ kind: "settings" });
		store.openDialog({ kind: "palette" });
		choose(store, "Open in editor");
		expect(store.getState().dialog).toEqual({ kind: "settings", section: "editor" });
	});

	test("an agent entry selects the worktree, shows Workspace, and starts the session", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		store.start();
		await settle();
		store.showTab("pull-request");
		store.openDialog({ kind: "palette" });
		choose(store, "Start Codex");
		await settle();
		const state = store.getState();
		expect(state.dialog).toBeNull();
		expect(state.tab).toBe("workspace");
		expect(state.terminals.length).toBe(1);
		expect(state.terminals[0]!.worktree).toBe(state.selection!.worktree);
	});

	test("Add repository and Fetch now run what their buttons run", async () => {
		const store = await startedStore();
		store.openDialog({ kind: "palette" });
		choose(store, "Fetch now");
		expect(store.getState().dialog).toBeNull();
		expect(store.getState().operations.some(operation => operation.kind === "fetch-repository" && operation.repository === TIMBER)).toBe(true);
		store.select(API_MAIN_ID);
		store.openDialog({ kind: "palette" });
		choose(store, "Add repository");
		expect(store.getState().dialog).toBeNull();
	});
});

describe("opening and closing the palette", () => {
	test("togglePalette opens it and closes it again", async () => {
		const store = await startedStore();
		store.togglePalette();
		expect(store.getState().dialog).toEqual({ kind: "palette" });
		store.togglePalette();
		expect(store.getState().dialog).toBeNull();
	});

	test("it never takes the place of another dialog", async () => {
		const store = await startedStore();
		store.openDialog({ kind: "settings" });
		store.togglePalette();
		store.openPalette();
		expect(store.getState().dialog).toEqual({ kind: "settings" });
		store.closePalette();
		expect(store.getState().dialog).toEqual({ kind: "settings" });
	});

	test("it is not offered before Timber is ready", () => {
		const store = createAppStore(createMockEngine());
		store.openPalette();
		expect(store.getState().dialog).toBeNull();
	});
});
