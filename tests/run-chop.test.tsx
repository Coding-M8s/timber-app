import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { ApproveChopView } from "../src/mainview/components/ApproveChopDialog";
import { chopsButtonHint, takesChopsPanelKey } from "../src/mainview/chops-panel-format";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { NO_WORKTREE_SELECTED } from "../src/mainview/palette";
import { runChopIn } from "../src/mainview/palette-run";
import {
	describeRunChopRow, findChops, firstLine, runChopFilterAfter, runChopKeys, runChopListKey, runChopModel, runChopShortcut, runsEditedText, takesRunChopKey,
} from "../src/mainview/run-chop-format";
import { createAppStore } from "../src/mainview/store/store";
import type { ArrangedChop } from "../src/shared/chop-order";
import type { ListedChop } from "../src/shared/chops";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const FEATURE = sampleRepositories[0]!.worktrees[1]!;
const size = () => ({ cols: 80, rows: 24 });
const key = (key: string, modifiers: Partial<Record<"ctrlKey" | "shiftKey" | "metaKey" | "altKey", boolean>> = {}) =>
	({ type: "keydown", key, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, ...modifiers });
const CTRL_SHIFT_T = key("T", { ctrlKey: true, shiftKey: true });

const chop = (name: string, text: string, more: Partial<ListedChop> = {}): ListedChop => ({ name, kind: "command", text, description: "", agent: null, source: "personal-every", sound: null, ...more });
const arranged = (...chops: (ListedChop | [ListedChop, "favorite"])[]): ArrangedChop[] =>
	chops.map(entry => Array.isArray(entry) ? { chop: entry[0], favorite: true } : { chop: entry, favorite: false });
const names = (found: { chop: ListedChop }[]) => found.map(item => item.chop.name);

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { engine, store };
}

/** A store with the feature worktree selected and personal chops saved, so nothing asks for approval. */
async function chopStore() {
	const started = await startedStore();
	const { store } = started;
	expect(await store.savePreferences({
		chops: [
			{ name: "Typecheck", kind: "command", text: "bun run typecheck && bun run typecheck:desktop", description: "", agent: null, repository: null, sound: null },
			{ name: "Ask", kind: "prompt", text: "Write the tests.\nThen run them.", description: "", agent: null, repository: null, sound: null },
		],
	})).toMatchObject({ outcome: "saved" });
	store.select(FEATURE.id);
	await store.readChops(TIMBER);
	await settle();
	return started;
}

describe("finding a chop", () => {
	const typecheck = chop("Typecheck", "bun run typecheck && bun run typecheck:desktop");
	const test_ = chop("Test", "bun test tests/y");
	const tests = chop("Write the tests", "Write tests for the new code.\nUse bun:test.", { kind: "prompt" });
	const lint = chop("Lint", "bun run lint");

	test("with nothing typed: the last chop on top, then favorites, then the rest in the panel's order", () => {
		const list = arranged([lint, "favorite"], typecheck, test_, tests);
		expect(names(findChops(list, "", "all", null))).toEqual(["Lint", "Typecheck", "Test", "Write the tests"]);
		expect(names(findChops(list, "", "all", "test"))).toEqual(["Test", "Lint", "Typecheck", "Write the tests"]);
	});

	test("a name that has the query beats one with its letters in order, which beats a match in the text", () => {
		const list = arranged(typecheck, test_, tests, lint);
		// "Test" and "Write the tests" have "test" in their names; Typecheck's shown line has its letters in order, so it comes last.
		expect(names(findChops(list, "test", "all", null))).toEqual(["Test", "Write the tests", "Typecheck"]);
		// "tyc": Typecheck's name has its letters in order; Test's text has "t", "y" and nothing with "c" after.
		const found = findChops(list, "tyc", "all", null);
		expect(names(found)[0]).toBe("Typecheck");
		expect(found[0]!.namePositions).toEqual([0, 1, 4]);
		// "lint" is in Lint's name and in its text: the name decides.
		expect(names(findChops(list, "run lint", "all", null))).toEqual(["Lint"]);
	});

	test("the text matches as one piece anywhere, or letter by letter only in its first line", () => {
		const list = arranged(typecheck, tests);
		// In the second line, as one piece: found, with nothing marked in the first line.
		const piece = findChops(list, "bun:test", "all", null);
		expect(names(piece)).toEqual(["Write the tests"]);
		expect(piece[0]!.linePositions).toEqual([]);
		// Letters spread over the second line find nothing.
		expect(findChops(list, "ubt", "all", null).map(found => found.chop.name)).not.toContain("Write the tests");
		// In the first line, the letters are marked.
		const inLine = findChops(arranged(typecheck), "desktop", "all", null);
		const at = typecheck.text.indexOf("desktop");
		expect(inLine[0]!.linePositions).toEqual([0, 1, 2, 3, 4, 5, 6].map(offset => at + offset));
	});

	test("within a tier the last chop comes first, then favorites, then the better match", () => {
		const testAll = chop("Test all", "bun test");
		const list = arranged(test_, [testAll, "favorite"]);
		expect(names(findChops(list, "test", "all", null))).toEqual(["Test all", "Test"]);
		expect(names(findChops(list, "test", "all", "Test"))).toEqual(["Test", "Test all"]);
		// A favorite never lifts a match in the text above a match in a name.
		expect(names(findChops(arranged([lint, "favorite"], test_), "test", "all", "lint"))).toEqual(["Test"]);
	});

	test("spaces in the query are kept for the text and dropped for letters in order", () => {
		// "bun test" as one piece is in Test's text; Typecheck's line only has its letters in order.
		expect(names(findChops(arranged(typecheck, test_), "  bun   test ", "all", null))).toEqual(["Test", "Typecheck"]);
		expect(names(findChops(arranged(typecheck), "type check", "all", null))).toEqual(["Typecheck"]);
	});

	test("the filter shows one kind, and Tab goes All, Commands, Prompts, and around; Shift+Tab back", () => {
		const list = arranged(typecheck, tests);
		expect(names(findChops(list, "", "command", null))).toEqual(["Typecheck"]);
		expect(names(findChops(list, "", "prompt", null))).toEqual(["Write the tests"]);
		expect(runChopFilterAfter("all", false)).toBe("command");
		expect(runChopFilterAfter("command", false)).toBe("prompt");
		expect(runChopFilterAfter("prompt", false)).toBe("all");
		expect(runChopFilterAfter("all", true)).toBe("prompt");
	});

	test("a row shows the first line of the text", () => {
		expect(firstLine("one\ntwo")).toBe("one");
		expect(firstLine("")).toBe("");
	});
});

describe("the keys in the chop search", () => {
	test("Enter runs, Ctrl+Enter or Cmd+Enter edits first, Tab and Shift+Tab change the kind", () => {
		expect(runChopListKey(key("Enter"))).toBe("run");
		expect(runChopListKey(key("Enter", { ctrlKey: true }))).toBe("edit");
		expect(runChopListKey(key("Enter", { metaKey: true }))).toBe("edit");
		expect(runChopListKey(key("Tab"))).toBe("next-filter");
		expect(runChopListKey(key("Tab", { shiftKey: true }))).toBe("previous-filter");
		expect(runChopListKey(key("Enter", { shiftKey: true }))).toBeNull();
		expect(runChopListKey(key("a"))).toBeNull();
	});

	test("Enter while an input method is composing does nothing", () => {
		expect(runChopListKey({ ...key("Enter"), isComposing: true })).toBeNull();
		expect(runsEditedText({ ...key("Enter"), isComposing: true })).toBe(false);
	});

	test("a held key acts once: a repeat of Ctrl+Enter never runs the text in the edit box it opened", () => {
		expect(runChopListKey({ ...key("Enter", { ctrlKey: true }), repeat: true })).toBeNull();
		expect(runChopListKey({ ...key("Enter"), repeat: true })).toBeNull();
		expect(runsEditedText({ ...key("Enter", { ctrlKey: true }), repeat: true })).toBe(false);
	});

	test("in the edit box Enter runs and Shift+Enter is a new line", () => {
		expect(runsEditedText(key("Enter"))).toBe(true);
		expect(runsEditedText(key("Enter", { ctrlKey: true }))).toBe(true);
		expect(runsEditedText(key("Enter", { shiftKey: true }))).toBe(false);
	});

	test("the footer names this platform's key to edit first", () => {
		expect(runChopKeys(false).map(entry => entry.keys)).toEqual(["Enter", "Ctrl+Enter", "Tab"]);
		expect(runChopKeys(true)[1]!.keys).toBe("Cmd+Enter");
	});
});

describe("the chop search's shortcut", () => {
	test("is Ctrl+Shift+T until another is set, and is taken while chops are in use and no other dialog is open", async () => {
		const { store } = await startedStore();
		expect(runChopShortcut(store.getState(), false)).toBe("Ctrl+Shift+T");
		expect(runChopShortcut(store.getState(), true)).toBe("Cmd+Shift+T");
		expect(takesRunChopKey(CTRL_SHIFT_T, store.getState())).toBe(true);
		expect(takesRunChopKey(key("t", { ctrlKey: true }), store.getState())).toBe(false);
		// Its own dialog open: the key closes it.
		store.toggleRunChop();
		expect(store.getState().dialog).toEqual({ kind: "run-chop" });
		expect(takesRunChopKey(CTRL_SHIFT_T, store.getState())).toBe(true);
		store.toggleRunChop();
		expect(store.getState().dialog).toBeNull();
		// Another dialog keeps the keyboard, and a terminal program gets the key.
		store.openDialog({ kind: "settings" });
		expect(takesRunChopKey(CTRL_SHIFT_T, store.getState())).toBe(false);
		store.toggleRunChop();
		expect(store.getState().dialog).toMatchObject({ kind: "settings" });
	});

	test("opens with the chops panel hidden", async () => {
		const { store } = await startedStore();
		expect(store.getState().layout.chopsOpen).toBe(false);
		store.toggleRunChop();
		expect(store.getState().dialog).toEqual({ kind: "run-chop" });
		expect(renderToStaticMarkup(<App store={store} />)).toContain('aria-label="Run a chop"');
	});

	test("is gone with Use chops off: not taken, and nothing opens", async () => {
		const { store } = await startedStore();
		expect(await store.savePreferences({ useChops: false })).toMatchObject({ outcome: "saved" });
		expect(takesRunChopKey(CTRL_SHIFT_T, store.getState())).toBe(false);
		store.toggleRunChop();
		expect(store.getState().dialog).toBeNull();
	});

	test("follows the keys set in Settings, for the search and the panel, and the tooltip names the panel's", async () => {
		const { store } = await startedStore();
		expect(await store.savePreferences({ shortcuts: { "run-chop": "Ctrl+Shift+K", "chops-panel": "Ctrl+Shift+L" } })).toMatchObject({ outcome: "saved" });
		const state = store.getState();
		expect(takesRunChopKey(CTRL_SHIFT_T, state)).toBe(false);
		expect(takesRunChopKey(key("K", { ctrlKey: true, shiftKey: true }), state)).toBe(true);
		expect(takesChopsPanelKey(key("K", { ctrlKey: true, shiftKey: true }), state)).toBe(false);
		expect(takesChopsPanelKey(key("L", { ctrlKey: true, shiftKey: true }), state)).toBe(true);
		expect(runChopShortcut(state, false)).toBe("Ctrl+Shift+K");
		expect(chopsButtonHint(false, false, "L")).toBe("Show chops (Ctrl+Shift+L)");
		expect(renderToStaticMarkup(<App store={store} />)).toContain("Show chops (Ctrl+Shift+L)");
	});

	test("a save that gives both one key, or takes the palette's, is refused and changes nothing", async () => {
		const { store } = await startedStore();
		expect(await store.savePreferences({ shortcuts: { "run-chop": "Ctrl+Shift+P" } })).not.toMatchObject({ outcome: "saved" });
		expect(await store.savePreferences({ shortcuts: { "run-chop": "Ctrl+Shift+K" } })).not.toMatchObject({ outcome: "saved" });
		expect(store.getState().preferences.shortcuts).toEqual({});
	});
});

describe("the chop search's list", () => {
	test("lists the selected repository's chops, says where each prompt goes, and why none runs with no worktree selected", async () => {
		const { store } = await chopStore();
		const model = runChopModel(store.getState(), "", "all");
		expect(model.worktree).toBe(FEATURE.branch);
		expect(model.rows.map(row => row.chop.name)).toEqual(expect.arrayContaining(["Typecheck", "Ask", "Test", "Review the diff"]));
		const ask = model.rows.find(row => row.chop.name === "Ask")!;
		expect(ask).toMatchObject({ kindWord: "Prompt", action: "send", target: "to a new Claude Code", blocked: null });
		expect(model.rows.find(row => row.chop.name === "Typecheck")).toMatchObject({ kindWord: "Command", target: null, blocked: null });
		expect(describeRunChopRow(model.rows.find(row => row.chop.name === "Typecheck"), model.worktree)).toBe(`Enter runs Typecheck in a new terminal in ${FEATURE.branch}.`);

		const none = runChopModel({ ...store.getState(), selection: null }, "", "all");
		expect(none.worktree).toBeNull();
		expect(none.rows.length).toBeGreaterThan(0);
		expect(none.rows.every(row => row.blocked === NO_WORKTREE_SELECTED)).toBe(true);
	});

	test("says when nothing matches, and when a kind has none", async () => {
		const { store } = await chopStore();
		expect(runChopModel(store.getState(), "zzzz", "all").empty).toBe('No chops match "zzzz".');
		expect(runChopModel(store.getState(), "zzzz", "prompt").empty).toBe('No prompts match "zzzz".');
	});

	test("with no worktree selected and nothing read, says to select one; while reading, says so", async () => {
		const { store } = await startedStore();
		expect(runChopModel({ ...store.getState(), selection: null, chops: null }, "", "all").empty).toBe("Select a worktree to see the chops of its repository.");
		expect(runChopModel({ ...store.getState(), chops: null }, "", "all").empty).toBe("Reading the chops");
	});

	test("the chop last run, from the panel's path or any other, is on top next time", async () => {
		const { store } = await chopStore();
		runChopIn(store, TIMBER, FEATURE.id, "Ask", size);
		await settle();
		expect(store.getState().lastChops[TIMBER]).toBe("Ask");
		expect(runChopModel(store.getState(), "", "all").rows[0]!.chop.name).toBe("Ask");
	});
});

describe("running from the chop search", () => {
	test("Enter's path is the panel's: a command runs in a new terminal in the selected worktree", async () => {
		const { engine, store } = await chopStore();
		store.toggleRunChop();
		store.closeDialog();
		runChopIn(store, TIMBER, FEATURE.id, "Typecheck", size);
		await settle();
		const session = store.getState().terminals.find(candidate => candidate.name === "Typecheck")!;
		expect(session.worktree).toBe(FEATURE.id);
		expect(engine.typedInto(session.id)).toBe("bun run typecheck && bun run typecheck:desktop\r");
	});

	test("an edited command runs once as edited, and the chop stays as saved", async () => {
		const { engine, store } = await chopStore();
		runChopIn(store, TIMBER, FEATURE.id, "Typecheck", size, true, "bun run typecheck");
		await settle();
		const session = store.getState().terminals.find(candidate => candidate.name === "Typecheck")!;
		expect(engine.typedInto(session.id)).toBe("bun run typecheck\r");
		expect(store.getState().preferences.chops.find(saved => saved.name === "Typecheck")?.text).toBe("bun run typecheck && bun run typecheck:desktop");
	});

	test("an edited prompt goes to the agent as edited, also after the person picks the agent", async () => {
		const { engine, store } = await chopStore();
		await store.runChop(TIMBER, FEATURE.id, "Ask", size(), { text: "Write one test." });
		await settle();
		const agent = store.getState().terminals.find(candidate => candidate.name === "Claude Code")!;
		expect(engine.promptsSentTo(agent.id)).toEqual(["Write one test."]);
	});

	test("when the agent must be picked, the dialog shows the edited prompt, which is what is sent", async () => {
		const { engine, store } = await chopStore();
		for (const agent of ["Claude Code", "Codex"]) await store.openTerminal({ repository: TIMBER, worktree: FEATURE.path, ...size(), agent });
		await settle();
		await store.runChop(TIMBER, FEATURE.id, "Ask", size(), { text: "Edited ask." });
		expect(store.getState().dialog).toMatchObject({ kind: "send-prompt", chop: "Ask", text: "Edited ask." });
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain(">Edited ask.</pre>");
		expect(markup).not.toContain("Then run them.");
		const codex = store.getState().terminals.find(session => session.name === "Codex")!;
		store.closeDialog();
		await store.runChop(TIMBER, FEATURE.id, "Ask", size(), { target: { session: codex.id }, text: "Edited ask." });
		await settle();
		expect(engine.promptsSentTo(codex.id)).toEqual(["Edited ask."]);
	});

	test("with no agent saved, an edited prompt is copied as edited", async () => {
		const { engine, store } = await chopStore();
		expect(await store.savePreferences({ agents: [] })).toMatchObject({ outcome: "saved" });
		await store.runChop(TIMBER, FEATURE.id, "Ask", size(), { text: "Only this." });
		await settle();
		expect(await engine.readClipboard()).toBe("Only this.");
	});

	test("an edited repository chop still asks for its own text first, keeps the edit, and runs it once approved", async () => {
		const { engine, store } = await chopStore();
		await store.runChop(TIMBER, FEATURE.id, "Test", size(), { text: "bun test tests/run-chop.test.tsx" });
		const dialog = store.getState().dialog;
		expect(dialog).toMatchObject({ kind: "approve-chop", chop: { text: "bun test" }, text: "bun test tests/run-chop.test.tsx" });
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain(">bun test</");
		expect(markup).toContain("You edited it for this run.");
		expect(markup).toContain(">bun test tests/run-chop.test.tsx</");
		store.closeDialog();
		await store.runChop(TIMBER, FEATURE.id, "Test", size(), { approve: "bun test", text: "bun test tests/run-chop.test.tsx" });
		await settle();
		const session = store.getState().terminals.find(candidate => candidate.name === "Test")!;
		expect(engine.typedInto(session.id)).toBe("bun test tests/run-chop.test.tsx\r");
		// What was approved is the file's own text.
		expect(Object.keys(engine.chopApprovals())).toEqual([TIMBER]);
	});

	test("the approval view shows the edited text only when there is one", () => {
		const fileChop = chop("Lint", "bun run lint", { source: "repository-file" });
		expect(renderToStaticMarkup(<ApproveChopView chop={fileChop} path="/r/.timber/chops.json" onRun={() => {}} onClose={() => {}} />)).not.toContain("You edited it");
		expect(renderToStaticMarkup(<ApproveChopView chop={fileChop} path="/r/.timber/chops.json" edited="bun run lint --fix" onRun={() => {}} onClose={() => {}} />)).toContain(">bun run lint --fix</");
	});

	test("an edited text that is blank or too long starts nothing and says why", async () => {
		const { store } = await chopStore();
		await store.runChop(TIMBER, FEATURE.id, "Typecheck", size(), { text: "   " });
		expect(store.getState().terminalProblem).toMatchObject({ message: "The edited command is empty. Nothing was started." });
		await store.runChop(TIMBER, FEATURE.id, "Typecheck", size(), { text: "x".repeat(10_001) });
		expect(store.getState().terminalProblem?.message).toContain("longer than 10000 characters");
		expect(store.getState().terminals).toEqual([]);
	});
});
