import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { createMockEngine, sampleChanges, sampleRepositories, sampleTimberStatuses, sampleUnavailableRepository } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";

const settle = () => Bun.sleep(0);
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const FEATURE_ID = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === FEATURE)!.id;

/** The text of one element, found by its class name. */
function textOf(markup: string, className: string): string | null {
	const match = new RegExp(`class="${className}"[^>]*>([^<]*)<`).exec(markup);
	return match ? match[1]! : null;
}

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine);
	store.start();
	await settle();
	return { store, engine };
}

describe("App", () => {
	test("title bar, sidebar, and workspace all show the store's selection", async () => {
		const { store } = await startedStore();
		store.select(FEATURE_ID);
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(textOf(markup, "titlebar-repo")).toBe("timber");
		expect(textOf(markup, "titlebar-branch")).toBe("feat/github-issue-lookup");
		expect(textOf(markup, "workspace-title")).toBe("feat/github-issue-lookup");
		expect(markup).toMatch(/class="row selected" aria-current="true"[^>]*>.*?feat\/github-issue-lookup/);
		expect(markup.match(/class="row selected"/g)?.length).toBe(1);
	});

	test("every part follows a pushed change", async () => {
		const { store, engine } = await startedStore();
		store.select(FEATURE_ID);
		const changed = structuredClone(sampleRepositories);
		changed[0]!.worktrees[1]!.branch = "feat/renamed";
		changed[0]!.worktrees[1]!.changes = sampleChanges(12, 1);
		engine.setRepositories(changed);
		engine.announceChange("/work/timber");
		await settle();

		const markup = renderToStaticMarkup(<App store={store} />);
		expect(textOf(markup, "titlebar-branch")).toBe("feat/renamed");
		expect(textOf(markup, "workspace-title")).toBe("feat/renamed");
		expect(textOf(markup, "count modified")).toBe("12M");
		expect(markup).toContain("12 modified, 1 untracked");
	});

	test("a failed refresh keeps the list on screen and shows the error", async () => {
		const { store, engine } = await startedStore();
		engine.failReads("Git is busy");
		await store.refresh();
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain('role="alert"');
		expect(textOf(markup, "sidebar-error-title")).toBe("Could not refresh");
		expect(markup).toContain("Git is busy");
		expect(markup).toContain("Showing what was read last.");
		expect(markup.match(/class="row( selected)?"/g)?.length).toBe(7);
		expect(textOf(markup, "titlebar-repo")).toBe("timber");
	});

	test("a failed reload of one repository names it", async () => {
		const { store, engine } = await startedStore();
		engine.failReads("Git is busy");
		await store.reloadRepository("/work/api-server");
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(textOf(markup, "sidebar-error-title")).toBe("Could not refresh api-server");
	});

	test("a first load that fails shows the error without claiming there is no repository", async () => {
		const engine = createMockEngine();
		engine.failReads("Git is busy");
		const { store } = await startedStore(engine);
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(textOf(markup, "sidebar-error-title")).toBe("Could not refresh");
		expect(markup).not.toContain("Showing what was read last.");
		expect(markup).not.toContain("No repository yet");
		expect(markup).not.toContain("Reading worktrees");
	});

	test("shows the Timber notice, and nothing that needs Timber, while Timber is missing", async () => {
		const { store } = await startedStore(createMockEngine(sampleRepositories, sampleTimberStatuses["not-found"]));
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain("Timber is not installed");
		expect(markup).not.toContain('class="sidebar"');
	});

	test("offers Add repository below the list, and Remove on every repository", async () => {
		const { store } = await startedStore();
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toMatch(/class="add-repository"[^>]*>.*?Add repository/);
		expect(markup).toContain('aria-label="Remove timber from the list"');
		expect(markup).toContain('aria-label="Remove api-server from the list"');
		expect(markup).toContain("Nothing on disk is changed.");
	});

	test("an added repository appears in the sidebar, selected", async () => {
		const { store } = await startedStore();
		await store.addRepository();
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain('aria-label="docs-site"');
		expect(textOf(markup, "titlebar-repo")).toBe("docs-site");
		expect(markup.match(/class="row( selected)?"/g)?.length).toBe(9);
	});

	test("a folder that is not a Git repository is refused with a clear message", async () => {
		const { store, engine } = await startedStore();
		engine.pickFolder("/home/sam/Documents");
		await store.addRepository();
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain('role="alert"');
		expect(textOf(markup, "sidebar-error-title")).toBe("Not a Git repository");
		expect(markup).toContain("/home/sam/Documents is not inside a Git repository.");
		expect(markup.match(/class="row( selected)?"/g)?.length).toBe(7);
	});

	test("adding a repository again says it is already listed, without an alert", async () => {
		const { store, engine } = await startedStore();
		engine.pickFolder(FEATURE);
		await store.addRepository();
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain("timber is already in the list");
		expect(markup).toContain('role="status"');
		expect(markup).not.toContain('role="alert"');
	});

	test("a repository whose folder is missing stays in the sidebar, marked unavailable, with Remove", async () => {
		const { store } = await startedStore(createMockEngine([...sampleRepositories, sampleUnavailableRepository]));
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain('aria-label="old-prototype"');
		expect(textOf(markup, "group-flag")).toBe("unavailable");
		expect(markup).toContain("The folder is missing, or it is no longer a Git repository.");
		expect(markup).toContain("/work/old-prototype");
		expect(markup).toMatch(/class="text-button"[^>]*>Remove</);
		expect(markup.match(/class="row( selected)?"/g)?.length).toBe(7);
	});

	test("a worktree with a missing folder still has a row, marked as such", async () => {
		const { store } = await startedStore();
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toMatch(/title="\/work\/api-server-worktrees\/old-removed-folder"[^>]*>.*?old\/removed-folder.*?folder missing/);
		expect(markup).toContain("The folder is missing: /work/api-server-worktrees/old-removed-folder. Its status is unknown.");
		store.select(sampleRepositories[1]!.worktrees[2]!.id);
		expect(renderToStaticMarkup(<App store={store} />)).toContain("Status unknown: Worktree path is missing");
	});

	test("a detached HEAD and an unknown status still have rows, marked as such", async () => {
		const changed = structuredClone(sampleRepositories);
		Object.assign(changed[0]!.worktrees[1]!, { branch: null, detached: true, head: "abcdef1234567890abcdef1234567890abcdef12", sync: null });
		Object.assign(changed[0]!.worktrees[2]!, { canonicalPath: null, changes: { kind: "unknown", reason: "Path no longer identifies this Git worktree" } });
		const { store } = await startedStore(createMockEngine(changed));
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup.match(/class="row( selected)?"/g)?.length).toBe(7);
		expect(markup).toContain("detached at abcdef1");
		expect(markup).toMatch(/detached at abcdef1.*?detached HEAD/);
		expect(markup).toMatch(/fix\/macos-portability.*?status unknown/);
	});

	test("when Timber cannot list a repository, its diagnostic shows and the last good list stays", async () => {
		const { store, engine } = await startedStore();
		engine.failTimber("/work/timber", "Not a Git repository: /work/timber");
		await store.refresh();
		let markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain('role="alert"');
		expect(markup).toContain("timber ls --json failed");
		expect(markup).toContain("Not a Git repository: /work/timber");
		expect(markup).toContain("Showing the worktrees that were listed last.");
		expect(markup.match(/class="row( selected)?"/g)?.length).toBe(7);
		expect(textOf(markup, "titlebar-repo")).toBe("timber");

		engine.failTimber("/work/timber", null);
		await store.reloadRepository("/work/timber");
		markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).not.toContain("timber ls --json failed");
		expect(markup.match(/class="row( selected)?"/g)?.length).toBe(7);
	});

	test("when Timber fails on the first read, the diagnostic shows and no list is made up", async () => {
		const engine = createMockEngine();
		engine.failTimber("/work/api-server", "Could not read configuration.");
		const { store } = await startedStore(engine);
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain("Could not read configuration.");
		expect(markup).toContain("No worktrees are shown.");
		expect(markup.match(/class="row( selected)?"/g)?.length).toBe(4);
	});

	test("with no repository, the workspace offers to add one", async () => {
		const { store } = await startedStore(createMockEngine([]));
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain("No repository yet");
		expect(markup).toMatch(/class="button"[^>]*>Add repository</);
		expect(markup).not.toContain("TIMBER_APP_REPOS");
	});

	test("says it is looking before Timber has answered", () => {
		const markup = renderToStaticMarkup(<App store={createAppStore(createMockEngine())} />);
		expect(markup).toContain("Looking for Timber");
	});
});
