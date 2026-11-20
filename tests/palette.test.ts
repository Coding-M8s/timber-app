import { describe, expect, test } from "bun:test";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { DONE_PRIMARY_NOTE } from "../src/mainview/done-format";
import {
	ADDING_REPOSITORY, FETCHING_NOW, FOLDER_MISSING_FOR_SESSION, NO_WORKTREE_SELECTED, STARTING_SESSION, isPaletteShortcut, matchEntries, paletteEntries,
	paletteHint, rowAfterKey,
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

describe("palette entries", () => {
	test("lists every worktree of every available repository, then the actions", async () => {
		const { state } = await sampleState();
		const entries = paletteEntries(state);
		const worktrees = entries.filter(entry => entry.kind === "worktree");
		const total = state.repositories.filter(repository => repository.available).flatMap(repository => repository.worktrees).length;
		expect(worktrees.length).toBe(total);
		const feature = worktrees.find(entry => entry.label === "feat/github-issue-lookup")!;
		expect(feature.detail).toBe("timber");
		expect(feature.keywords).toContain("timber");
		expect(feature.keywords).toContain("feat-github-issue-lookup");
		expect(feature.action).toEqual({ kind: "select", worktree: FEATURE_ID });
		const labels = entries.filter(entry => entry.kind === "action").map(entry => entry.label);
		expect(labels).toEqual([
			"New worktree", "Open existing branch", "Fetch now", "Rebase", "Done", "Open in editor", "Open terminal", "Start Claude Code", "Start Codex",
			"Settings", "Add repository",
		]);
	});

	test("actions for a worktree name the selected one", async () => {
		const { state, store } = await sampleState();
		store.select(FEATURE_ID);
		const entries = paletteEntries(store.getState());
		for (const label of ["Rebase", "Done", "Open in editor", "Open terminal", "Start Codex"]) {
			expect(entries.find(entry => entry.label === label)!.detail).toBe("feat/github-issue-lookup in timber");
		}
		for (const label of ["New worktree", "Open existing branch", "Fetch now"]) {
			expect(entries.find(entry => entry.label === label)!.detail).toBe("In timber");
		}
		expect(state.selection).not.toBeNull();
	});

	test("the actions open the dialogs the buttons open", async () => {
		const { store } = await sampleState();
		store.select(FEATURE_ID);
		const state = store.getState();
		expect(byLabel(state, "Rebase").action).toEqual({ kind: "dialog", request: { kind: "rebase-worktree", repository: TIMBER, worktree: FEATURE_ID } });
		expect(byLabel(state, "Done").action).toEqual({ kind: "dialog", request: { kind: "done-worktree", repository: TIMBER, worktree: FEATURE_ID } });
		expect(byLabel(state, "Open existing branch").action).toEqual({ kind: "dialog", request: { kind: "new-worktree", repository: TIMBER, mode: "existing" } });
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
		expect(byLabel(state, "Rebase").disabledReason).toBeNull();
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

	test("Open in editor opens Settings when no editor is set, and waits for one that is set", async () => {
		const { store } = await sampleState();
		store.select(FEATURE_ID);
		const state = store.getState();
		expect(state.preferences.editor).toBeNull();
		expect(byLabel(state, "Open in editor").disabledReason).toBeNull();
		const terminalEditor: AppState = { ...state, preferences: { ...state.preferences, editor: { command: "nvim", terminal: true } } };
		expect(byLabel(terminalEditor, "Open in editor").disabledReason).not.toBeNull();
	});

	test("an unavailable repository lists no worktrees", async () => {
		const { state } = await sampleState();
		const unavailable: Repository = { ...state.repositories[0]!, path: "/gone", name: "gone", available: false };
		const entries = paletteEntries({ ...state, repositories: [...state.repositories, unavailable] });
		expect(entries.some(entry => entry.detail === "gone")).toBe(false);
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
		expect(matches.some(match => match.entry.kind === "worktree" && match.entry.detail === "api-server")).toBe(true);
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
