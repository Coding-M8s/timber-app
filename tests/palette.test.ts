import { describe, expect, test } from "bun:test";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { DONE_PRIMARY_NOTE } from "../src/mainview/done-format";
import {
	ADDING_REPOSITORY, FETCHING_NOW, FOLDER_MISSING_FOR_SESSION, NO_WORKTREE_SELECTED, OTHER_REPOSITORIES, STARTING_SESSION, describeHighlighted, describeScopeChip, describeUnavailable,
	isPaletteShortcut, matchEntries, paletteEntries, paletteHint, paletteScope, paletteView, pointerMoved, rowAfterKey, rowTarget,
} from "../src/mainview/palette";
import { REBASE_FOLDER_MISSING } from "../src/mainview/rebase-format";
import { type AppState, initialState } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import type { Repository, Worktree } from "../src/shared/model";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const FEATURE_ID = sampleRepositories[0]!.worktrees[1]!.id;
const MISSING_ID = sampleRepositories[1]!.worktrees[2]!.id;

async function sampleState(): Promise<{ state: AppState; store: ReturnType<typeof createAppStore> }> {
	const store = createAppStore(createMockEngine());
	store.start();
	await settle();
	return { state: store.getState(), store };
}

const byLabel = (state: AppState, label: string) => paletteEntries(state).find(entry => entry.label === label)!;

describe("palette shortcuts", () => {
	const keys = (state: AppState, mac: boolean) => Object.fromEntries(paletteEntries(state, mac).filter(entry => entry.shortcut !== undefined).map(entry => [entry.id, entry.shortcut]));

	test("every command with a key shows it, with Ctrl off macOS and Cmd on macOS", async () => {
		const { state } = await sampleState();
		expect(keys(state, false)).toEqual({
			"action:next-waiting": "Ctrl+Shift+J", "action:chops": "Ctrl+Shift+K", "action:run-chop": "Ctrl+Shift+T", "action:files": "Ctrl+Shift+E", "action:changes": "Ctrl+Shift+G",
		});
		expect(keys(state, true)).toEqual({
			"action:next-waiting": "Cmd+Shift+J", "action:chops": "Cmd+Shift+K", "action:run-chop": "Cmd+Shift+T", "action:files": "Cmd+Shift+E", "action:changes": "Cmd+Shift+G",
		});
	});

	test("entries with no key of their own have no shortcut, a single chop's row included", async () => {
		const { store } = await sampleState();
		store.select(FEATURE_ID);
		await store.readChops(TIMBER);
		const entries = paletteEntries(store.getState());
		expect(entries.some(entry => entry.label.startsWith("Run chop: "))).toBe(true);
		for (const entry of entries.filter(candidate => candidate.kind === "worktree" || candidate.label.startsWith("Run chop: ") || candidate.label === "Settings")) {
			expect(entry.shortcut).toBeUndefined();
		}
	});

	test("the chop keys read as set in Settings", async () => {
		const { store } = await sampleState();
		await store.savePreferences({ shortcuts: { "chops-panel": "Ctrl+Shift+L", "run-chop": "Ctrl+Shift+Y" } });
		expect(keys(store.getState(), false)).toMatchObject({ "action:chops": "Ctrl+Shift+L", "action:run-chop": "Ctrl+Shift+Y" });
		expect(keys(store.getState(), true)).toMatchObject({ "action:chops": "Cmd+Shift+L", "action:run-chop": "Cmd+Shift+Y" });
	});

	test("with chops off, neither chop command is listed, and Files and Changes stay", async () => {
		const { store } = await sampleState();
		await store.savePreferences({ useChops: false });
		const ids = paletteEntries(store.getState()).map(entry => entry.id);
		expect(ids).not.toContain("action:chops");
		expect(ids).not.toContain("action:run-chop");
		expect(ids).toEqual(expect.arrayContaining(["action:files", "action:changes"]));
	});

	test("Files and Chops say Hide while they show, and Run a chop opens the search", async () => {
		const { store } = await sampleState();
		expect(byLabel(store.getState(), "Run a chop").action).toEqual({ kind: "dialog", request: { kind: "run-chop" } });
		expect(store.toggleSidePanel("files")).toBe(true);
		expect(paletteEntries(store.getState()).map(entry => entry.label)).toEqual(expect.arrayContaining(["Hide files", "Show chops"]));
		expect(store.toggleSidePanel("chops")).toBe(true);
		expect(paletteEntries(store.getState()).map(entry => entry.label)).toEqual(expect.arrayContaining(["Show files", "Hide chops"]));
	});

	test("the scope chip's tooltip names the whole repository and worktree", () => {
		const repositoryName = "a-repository-name-long-enough-to-be-cut-short";
		const worktreeName = "feat/a-branch-long-enough-to-be-cut-short";
		expect(describeScopeChip({ repository: "/work/x", repositoryName, worktreeName })).toBe(`${repositoryName} / ${worktreeName}. Search every repository (Backspace)`);
	});
});

describe("palette entries", () => {
	test("lists the actions, then every worktree of every available repository", async () => {
		const { state } = await sampleState();
		const entries = paletteEntries(state);
		const worktrees = entries.filter(entry => entry.kind === "worktree");
		const total = state.repositories.filter(repository => repository.available).flatMap(repository => repository.worktrees).length;
		expect(worktrees.length).toBe(total);
		const feature = worktrees.find(entry => entry.label === "feat/github-issue-lookup")!;
		expect(feature.repositoryName).toBe("timber");
		expect(feature.repository).toBe(TIMBER);
		expect(feature.section).toBe("worktrees");
		expect(feature.keywords).toContain("timber");
		expect(feature.keywords).toContain("feat-github-issue-lookup");
		expect(feature.action).toEqual({ kind: "select", worktree: FEATURE_ID });
		const labels = entries.filter(entry => entry.kind === "action").map(entry => entry.label);
		expect(labels).toEqual([
			"Open terminal", "Start Claude Code", "Start Codex", "Pull", "Open in editor", "Set tag...", "Done", "New worktree", "Open existing branch", "New arena (Beta)", "Fetch now",
			"Clean up merged", "Clean up merged", "Show next session that needs you or is done", "Show chops", "Run a chop", "Show files", "Show changes", "Settings", "Add repository",
		]);
	});

	test("Push is listed for a worktree that is ahead, and Pull for one that is behind, each saying what its dialog shows", async () => {
		const { store } = await sampleState();
		store.select(FEATURE_ID);
		const push = byLabel(store.getState(), "Push");
		expect(push).toMatchObject({ section: "worktree", icon: "push", repository: TIMBER });
		expect(push.hint).toBe("Opens Push for feat/github-issue-lookup, which shows the Timber command before it runs.");
		expect(push.keywords).toEqual(expect.arrayContaining(["git", "publish"]));
		expect(push.action).toEqual({ kind: "dialog", request: { kind: "sync-action", action: "push", repository: TIMBER, worktree: FEATURE_ID } });
		expect(paletteEntries(store.getState()).some(entry => entry.label === "Pull")).toBe(false);
		const { state } = await sampleState();
		expect(byLabel(state, "Pull")).toMatchObject({ icon: "fetch", hint: "Opens Pull for main, which shows the Git commands before they run." });
		expect(paletteEntries(state).some(entry => entry.label === "Push")).toBe(false);
	});

	test("Pull says it runs at once where its dialog is skipped, and is off while it runs", async () => {
		const { store } = await sampleState();
		await store.savePreferences({ pull: { ask: false, skip: [] } });
		expect(byLabel(store.getState(), "Pull")).toMatchObject({ hint: "Pulls into main now, without asking first. The dialog opens only when Git refuses or it fails.", disabledReason: null });
		const main = store.getState().repositories[0]!.worktrees.find(worktree => worktree.primary)!;
		store.openDialog({ kind: "sync-action", action: "pull", repository: TIMBER, worktree: main.id });
		expect(byLabel(store.getState(), "Pull").disabledReason).toBe("Pulling now.");
		await settle();
	});

	test("actions for a worktree are in its section and say what they do to it", async () => {
		const { store } = await sampleState();
		store.select(FEATURE_ID);
		const entries = paletteEntries(store.getState());
		for (const label of ["Rebase", "Done", "Open in editor", "Open terminal", "Start Codex"]) {
			const entry = entries.find(candidate => candidate.label === label)!;
			expect(entry.section).toBe("worktree");
			expect(entry.repository).toBe(TIMBER);
			expect(entry.detail).toBe("");
		}
		expect(byLabel(store.getState(), "Rebase").hint).toContain("feat/github-issue-lookup");
		expect(byLabel(store.getState(), "Open terminal").hint).toBe(`Starts a shell in ${sampleRepositories[0]!.worktrees[1]!.path}.`);
		for (const label of ["New worktree", "Open existing branch", "Fetch now"]) {
			const entry = entries.find(candidate => candidate.label === label)!;
			expect(entry.section).toBe("repository");
			expect(entry.hint).toContain("timber");
		}
		for (const label of ["Settings", "Add repository", "Show next session that needs you or is done"]) {
			const entry = entries.find(candidate => candidate.label === label)!;
			expect(entry.section).toBe("app");
			expect(entry.repository).toBeNull();
		}
	});

	test("the actions open the dialogs the buttons open", async () => {
		const { store } = await sampleState();
		store.select(FEATURE_ID);
		const state = store.getState();
		expect(byLabel(state, "Rebase").action).toEqual({ kind: "dialog", request: { kind: "rebase-worktree", repository: TIMBER, worktree: FEATURE_ID } });
		expect(byLabel(state, "Done").action).toEqual({ kind: "dialog", request: { kind: "done-worktree", repository: TIMBER, worktree: FEATURE_ID } });
		expect(byLabel(state, "Open existing branch").action).toEqual({ kind: "dialog", request: { kind: "new-worktree", repository: TIMBER, mode: "existing" } });
		// New arena opens the New worktree dialog on its Arena mode.
		expect(byLabel(state, "New arena (Beta)").action).toEqual({ kind: "dialog", request: { kind: "new-worktree", repository: TIMBER, mode: "arena" } });
		expect(byLabel(state, "Settings").action).toEqual({ kind: "dialog", request: { kind: "settings" } });
	});

	test("with nothing selected every worktree action says to select one", () => {
		const state: AppState = { ...initialState, repositories: sampleRepositories };
		for (const label of ["New worktree", "Open existing branch", "Fetch now", "Rebase", "Done", "Open in editor", "Open terminal", "Start Codex"]) {
			expect(byLabel(state, label).disabledReason).toBe(NO_WORKTREE_SELECTED);
		}
		expect(byLabel(state, "Settings").disabledReason).toBeNull();
		expect(byLabel(state, "Add repository").disabledReason).toBeNull();
	});

	test("the primary checkout cannot be marked done", async () => {
		const { state } = await sampleState();
		expect(state.selection).not.toBeNull();
		expect(byLabel(state, "Done").disabledReason).toBe(DONE_PRIMARY_NOTE);
		// Its base is its own upstream, so Pull takes Rebase's place.
		expect(byLabel(state, "Rebase")).toBeUndefined();
		expect(byLabel(state, "Pull").disabledReason).toBeNull();
	});

	test("a missing folder disables rebase, terminals, and agents", async () => {
		const { store } = await sampleState();
		store.select(MISSING_ID);
		const state = store.getState();
		expect(byLabel(state, "Rebase").disabledReason).toBe(REBASE_FOLDER_MISSING);
		expect(byLabel(state, "Open terminal").disabledReason).toBe(FOLDER_MISSING_FOR_SESSION);
		expect(byLabel(state, "Start Claude Code").disabledReason).toBe(FOLDER_MISSING_FOR_SESSION);
	});

	test("a session that is starting, a fetch, and an added repository disable their actions", async () => {
		const { store } = await sampleState();
		store.select(FEATURE_ID);
		const busy: AppState = {
			...store.getState(),
			operations: [
				{ kind: "open-terminal", worktree: FEATURE_ID, agent: null },
				{ kind: "fetch-repository", repository: TIMBER },
				{ kind: "add-repository" },
			],
		};
		expect(byLabel(busy, "Open terminal").disabledReason).toBe(STARTING_SESSION);
		expect(byLabel(busy, "Fetch now").disabledReason).toBe(FETCHING_NOW);
		expect(byLabel(busy, "Add repository").disabledReason).toBe(ADDING_REPOSITORY);
	});

	test("Open in editor opens Settings when no editor is set, and is available with a terminal editor", async () => {
		const { store } = await sampleState();
		store.select(FEATURE_ID);
		const state = store.getState();
		expect(state.preferences.editor).toBeNull();
		expect(byLabel(state, "Open in editor").disabledReason).toBeNull();
		const terminalEditor: AppState = { ...state, preferences: { ...state.preferences, editor: { command: "nvim", terminal: true } } };
		expect(byLabel(terminalEditor, "Open in editor").disabledReason).toBeNull();
		expect(byLabel(terminalEditor, "Open in editor").hint).toContain("with nvim ");
	});

	test("an unavailable repository lists no worktrees", async () => {
		const { state } = await sampleState();
		const unavailable: Repository = { ...state.repositories[0]!, path: "/gone", name: "gone", available: false };
		const entries = paletteEntries({ ...state, repositories: [...state.repositories, unavailable] });
		expect(entries.some(entry => entry.kind === "worktree" && entry.repositoryName === "gone")).toBe(false);
		expect(entries.some(entry => entry.repository === "/gone")).toBe(false);
	});
});

function manyWorktrees(count: number): AppState {
	const worktrees = Array.from({ length: count }, (_, index): Worktree => ({
		...sampleRepositories[0]!.worktrees[1]!,
		id: `wt-${index}`,
		path: `/work/big-worktrees/feature-${index}`,
		branch: `feature/topic-${index}`,
	}));
	const big: Repository = { ...sampleRepositories[0]!, path: "/work/big", name: "big", worktrees };
	return { ...initialState, repositories: [big], selection: { repository: "/work/big", worktree: "wt-0" } };
}

describe("matching", () => {
	test("typing part of a branch name finds its worktree and ranks it first", async () => {
		const { state } = await sampleState();
		const matches = matchEntries(paletteEntries(state), "github");
		expect(matches[0]!.entry.label).toBe("feat/github-issue-lookup");
		expect(matches[0]!.positions).toEqual([5, 6, 7, 8, 9, 10]);
	});

	test("letters in order are enough, in any case", async () => {
		const { state } = await sampleState();
		expect(matchEntries(paletteEntries(state), "FGIL")[0]!.entry.label).toBe("feat/github-issue-lookup");
	});

	test("the repository name finds its worktrees", async () => {
		const { state } = await sampleState();
		const matches = matchEntries(paletteEntries(state), "api-server");
		expect(matches.some(match => match.entry.kind === "worktree" && match.entry.repositoryName === "api-server")).toBe(true);
	});

	test("a prefix beats a later match and a shorter name beats a longer one", async () => {
		const { state } = await sampleState();
		const labels = matchEntries(paletteEntries(state), "do").map(match => match.entry.label);
		expect(labels[0]).toBe("Done");
	});

	test("an empty query keeps the order, and the result is capped", () => {
		const state = manyWorktrees(500);
		const entries = paletteEntries(state);
		expect(matchEntries(entries, "", 50).map(match => match.entry.id)).toEqual(entries.slice(0, 50).map(entry => entry.id));
		expect(matchEntries(entries, "feature", 50).length).toBe(50);
	});

	test("nothing matches nonsense", async () => {
		const { state } = await sampleState();
		expect(matchEntries(paletteEntries(state), "zzzzqq")).toEqual([]);
	});

	test("500 worktrees build and match quickly", () => {
		const state = manyWorktrees(500);
		const start = performance.now();
		const entries = paletteEntries(state);
		const matches = matchEntries(entries, "topic-499");
		const elapsed = performance.now() - start;
		expect(matches[0]!.entry.label).toBe("feature/topic-499");
		expect(elapsed).toBeLessThan(50);
	});
});

describe("the view: scoped to the repository, in sections", () => {
	const API = "/work/api-server";
	const labelsOf = (view: ReturnType<typeof paletteView>) => view.options.map(match => match.entry.label);

	test("scoped with nothing typed: only this repository and the app, in four sections", async () => {
		const { state } = await sampleState();
		const context = paletteScope(state)!;
		expect(context).toEqual({ repository: TIMBER, repositoryName: "timber", worktreeName: "main" });
		const view = paletteView(paletteEntries(state), "", context, true);
		expect(view.groups.map(group => group.heading)).toEqual(["In main", "In timber", "Worktrees in timber", "App"]);
		for (const { entry } of view.options) expect(entry.repository === null || entry.repository === TIMBER).toBe(true);
		const worktrees = view.groups[2]!.matches.map(match => match.entry);
		expect(worktrees.length).toBe(sampleRepositories[0]!.worktrees.length);
		expect(worktrees.filter(entry => entry.current).map(entry => entry.label)).toEqual(["main"]);
	});

	test("with nothing typed, actions that cannot run are left out and named in one line", async () => {
		const { state } = await sampleState();
		const view = paletteView(paletteEntries(state), "", paletteScope(state), true);
		expect(view.options.every(match => match.entry.disabledReason === null)).toBe(true);
		expect(labelsOf(view)).not.toContain("Done");
		expect(view.unavailable).toContain("Done");
		expect(view.unavailable).toMatch(/^\d actions are not available here: .*\. Type one to see why\.$/);
	});

	test("typing finds an action that cannot run, with its reason for the line under the list", async () => {
		const { state } = await sampleState();
		const view = paletteView(paletteEntries(state), "done", paletteScope(state), true);
		const done = view.options.find(match => match.entry.label === "Done")!;
		expect(done.entry.disabledReason).toBe(DONE_PRIMARY_NOTE);
		expect(describeHighlighted(done.entry)).toBe(DONE_PRIMARY_NOTE);
		expect(view.unavailable).toBeNull();
	});

	test("typing lists this repository first, then other repositories' worktrees, never their actions", async () => {
		const { state } = await sampleState();
		const view = paletteView(paletteEntries(state), "rate", paletteScope(state), true);
		expect(view.groups.map(group => group.heading)).toEqual(["In timber", OTHER_REPOSITORIES]);
		const others = view.groups[1]!.matches.map(match => match.entry);
		expect(others.map(entry => entry.label)).toEqual(["feat/rate-limit-headers"]);
		expect(others.every(entry => entry.kind === "worktree" && entry.repository === API)).toBe(true);
		const cleanUps = paletteView(paletteEntries(state), "clean up", paletteScope(state), true).options.filter(match => match.entry.label === "Clean up merged");
		expect(cleanUps.map(match => match.entry.repository)).toEqual([TIMBER]);
	});

	test("unscoped, every repository's worktrees and each repository's Clean up merged are found", async () => {
		const { state } = await sampleState();
		const context = paletteScope(state);
		const empty = paletteView(paletteEntries(state), "", context, false);
		expect(empty.groups.map(group => group.heading)).toEqual(["In main", "In timber", "Worktrees", "App"]);
		const repositories = new Set(empty.groups[2]!.matches.map(match => match.entry.repository));
		expect(repositories).toEqual(new Set([TIMBER, API]));
		const typed = paletteView(paletteEntries(state), "clean up", context, false);
		expect(typed.groups.map(group => group.heading)).toEqual([null]);
		expect(typed.options.filter(match => match.entry.label === "Clean up merged").map(match => match.entry.repository).sort()).toEqual([API, TIMBER]);
	});

	test("with no worktree selected it is unscoped, and many unavailable actions are only counted", () => {
		const state: AppState = { ...initialState, repositories: sampleRepositories };
		expect(paletteScope(state)).toBeNull();
		const view = paletteView(paletteEntries(state), "", null, true);
		expect(view.groups.map(group => group.heading)).toEqual(["Worktrees", "App"]);
		expect(view.unavailable).toMatch(/^\d+ actions are not available here\. Type one to see why\.$/);
	});

	test("Clean up merged shows in the repository section, with its count, once something merged", async () => {
		const { state } = await sampleState();
		const feature = sampleRepositories[0]!.worktrees[1]!;
		const merged: AppState = {
			...state,
			pullRequests: {
				...state.pullRequests,
				[TIMBER]: { ok: true, worktrees: [{ path: feature.path, branch: feature.branch!, outcome: "found", pullRequest: { state: "merged" } as never }] },
			},
		};
		const view = paletteView(paletteEntries(merged), "", paletteScope(merged), true);
		const cleanUp = view.groups[1]!.matches.find(match => match.entry.label === "Clean up merged")!;
		expect(cleanUp.entry.detail).toBe("1 merged");
		expect(view.unavailable ?? "").not.toContain("Clean up merged");
	});

	test("the limit never lets other repositories push this repository's matches out", async () => {
		const { state } = await sampleState();
		const view = paletteView(paletteEntries(state), "e", paletteScope(state), true, 3);
		expect(view.options.length).toBe(3);
		expect(view.options.every(match => match.entry.repository !== API)).toBe(true);
	});

	test("with nothing typed and many worktrees, only the worktrees give way to the limit", () => {
		const state = manyWorktrees(500);
		const view = paletteView(paletteEntries(state), "", paletteScope(state), true);
		expect(view.options.length).toBe(50);
		expect(view.groups.map(group => group.heading)).toEqual(["In feature/topic-0", "In big", "Worktrees in big", "App"]);
		expect(labelsOf(view)).toContain("Settings");
		expect(labelsOf(view)).toContain("Add repository");
	});

	test("rows say what they are for when no chip or heading does", async () => {
		const { state } = await sampleState();
		const context = paletteScope(state);
		const entries = paletteEntries(state);
		const of = (label: string) => entries.find(entry => entry.label === label)!;
		const apiWorktree = entries.find(entry => entry.kind === "worktree" && entry.repository === API)!;
		const timberWorktree = entries.find(entry => entry.kind === "worktree" && entry.repository === TIMBER)!;
		expect(rowTarget(of("Pull"), context, true, true)).toBeNull();
		expect(rowTarget(timberWorktree, context, true, true)).toBeNull();
		expect(rowTarget(apiWorktree, context, true, true)).toBe("api-server");
		expect(rowTarget(timberWorktree, context, false, true)).toBe("timber");
		expect(rowTarget(of("Pull"), context, false, false)).toBe("main in timber");
		expect(rowTarget(of("Fetch now"), context, false, false)).toBe("timber");
		expect(rowTarget(of("Settings"), context, false, false)).toBeNull();
		const apiCleanUp = entries.find(entry => entry.label === "Clean up merged" && entry.repository === API)!;
		const timberCleanUp = entries.find(entry => entry.label === "Clean up merged" && entry.repository === TIMBER)!;
		expect(rowTarget(apiCleanUp, context, false, true)).toBe("api-server");
		expect(rowTarget(timberCleanUp, context, false, true)).toBe("timber");
		expect(rowTarget(timberCleanUp, context, true, true)).toBeNull();
	});

	test("the line for left-out actions", () => {
		expect(describeUnavailable([])).toBeNull();
		expect(describeUnavailable(["Done", "Done"])).toBe("1 action is not available here: Done. Type one to see why.");
		expect(describeUnavailable(["A", "B", "C", "D", "E"])).toBe("5 actions are not available here. Type one to see why.");
	});
});

describe("the shortcut and the list keys", () => {
	const key = (init: Partial<KeyboardEvent>) => ({ type: "keydown", key: "P", ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, ...init });

	test("Ctrl+Shift+P and Cmd+Shift+P open it", () => {
		expect(isPaletteShortcut(key({ ctrlKey: true, shiftKey: true }))).toBe(true);
		expect(isPaletteShortcut(key({ metaKey: true, shiftKey: true, key: "p" }))).toBe(true);
	});

	test("other chords do not", () => {
		expect(isPaletteShortcut(key({ ctrlKey: true }))).toBe(false);
		expect(isPaletteShortcut(key({ shiftKey: true }))).toBe(false);
		expect(isPaletteShortcut(key({ ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
		expect(isPaletteShortcut(key({ ctrlKey: true, shiftKey: true, key: "S" }))).toBe(false);
		expect(isPaletteShortcut(key({ ctrlKey: true, shiftKey: true, type: "keyup" }))).toBe(false);
	});

	test("the hint names the shortcut for the platform", () => {
		expect(paletteHint(false)).toBe("Command palette (Ctrl+Shift+P)");
		expect(paletteHint(true)).toBe("Command palette (Cmd+Shift+P)");
	});

	test("only a pointer that moved takes the highlight, never a move sent after the list scrolled", () => {
		expect(pointerMoved(null, { x: 10, y: 20 })).toBe(false);
		expect(pointerMoved({ x: 10, y: 20 }, { x: 10, y: 20 })).toBe(false);
		expect(pointerMoved({ x: 10, y: 20 }, { x: 10, y: 24 })).toBe(true);
		expect(pointerMoved({ x: 10, y: 20 }, { x: 11, y: 20 })).toBe(true);
	});

	test("the arrows step and wrap, Home and End jump", () => {
		expect(rowAfterKey(3, 0, "ArrowDown")).toBe(1);
		expect(rowAfterKey(3, 2, "ArrowDown")).toBe(0);
		expect(rowAfterKey(3, 0, "ArrowUp")).toBe(2);
		expect(rowAfterKey(3, 1, "Home")).toBe(0);
		expect(rowAfterKey(3, 1, "End")).toBe(2);
		expect(rowAfterKey(3, 1, "a")).toBeNull();
		expect(rowAfterKey(0, 0, "ArrowDown")).toBeNull();
	});
});

describe("Pull in place of Rebase", () => {
	/** The sample state with the selected primary checkout of timber changed. */
	const withPrimary = (state: AppState, change: Partial<Worktree>, repository: Partial<Repository> = {}): AppState => ({
		...state,
		repositories: state.repositories.map(candidate => candidate.path !== TIMBER ? candidate : {
			...candidate,
			...repository,
			worktrees: candidate.worktrees.map(worktree => worktree.primary ? { ...worktree, ...change } : worktree),
		}),
	});
	const actionLabels = (state: AppState) => paletteEntries(state).filter(entry => entry.section === "worktree").map(entry => entry.label);

	test("the primary checkout on the default branch, with no saved base, lists Pull once and no Rebase, and typing rebase finds it", async () => {
		const { state } = await sampleState();
		const labels = actionLabels(state);
		expect(labels.filter(label => label === "Pull")).toHaveLength(1);
		expect(labels).not.toContain("Rebase");
		const pull = byLabel(state, "Pull");
		const primary = state.repositories[0]!.worktrees.find(worktree => worktree.primary)!;
		expect(pull.id).toBe("action:sync:pull");
		expect(pull.action).toEqual({ kind: "dialog", request: { kind: "sync-action", action: "pull", repository: TIMBER, worktree: primary.id } });
		expect(matchEntries(paletteEntries(state), "rebase").map(match => match.entry.label)).toContain("Pull");
	});

	test("it is listed also when the branch is not behind, where the row offers no Pull", async () => {
		const { state } = await sampleState();
		const level = withPrimary(state, { sync: { kind: "tracking", upstream: "origin/main", ahead: 1, behind: 0, remote: "origin", upstreamRef: "refs/remotes/origin/main" } });
		const labels = actionLabels(level);
		expect(labels.filter(label => label === "Pull")).toHaveLength(1);
		expect(labels).not.toContain("Rebase");
		// Ahead, so the row's Push is there too, after Pull.
		expect(labels.indexOf("Pull")).toBeLessThan(labels.indexOf("Push"));
	});

	test("the primary checkout on a feature branch with another base keeps Rebase", async () => {
		const { state } = await sampleState();
		const feature = withPrimary(state, {
			branch: "feat/login",
			base: { kind: "assigned", ref: "refs/remotes/origin/main" },
			sync: { kind: "tracking", upstream: "origin/feat/login", ahead: 0, behind: 0, remote: "origin", upstreamRef: "refs/remotes/origin/feat/login" },
		});
		expect(actionLabels(feature)).toContain("Rebase");
		expect(actionLabels(feature)).not.toContain("Pull");
	});

	test("an unknown fallback base, as when the remote has no cached default, keeps Rebase", async () => {
		const { state } = await sampleState();
		const configured = withPrimary(state, {}, { fallbackBase: null });
		expect(actionLabels(configured)).toContain("Rebase");
		// The row's own Pull, for a branch that is behind, stays as before.
		expect(actionLabels(configured)).toContain("Pull");
	});

	test("a linked worktree keeps Rebase", async () => {
		const { store } = await sampleState();
		store.select(FEATURE_ID);
		expect(actionLabels(store.getState())).toContain("Rebase");
	});
});
