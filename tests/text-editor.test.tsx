import { describe, expect, test } from "bun:test";
import { history, redo, undo } from "@codemirror/commands";
import { Compartment, EditorState, StateEffect, Text, type Transaction } from "@codemirror/state";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { canEditFile, editRefusal } from "../src/mainview/file-view-format";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import type { FileView } from "../src/mainview/store/state";
import { editorKeys, reloadFromDisk } from "../src/mainview/components/TextEditor";
import { defaultKeymap, deleteLine, historyKeymap, moveLineUp, toggleBlockComment, toggleComment, undo as undoCommand } from "@codemirror/commands";
import { gotoLine, searchKeymap, selectNextOccurrence } from "@codemirror/search";
import { MAX_MATCHES, describeCaret, describeLineCount, describeMatches, indentUnitOf } from "../src/mainview/text-editor-format";
import type { Engine } from "../src/shared/engine";
import { countLines, lineEndingProblem } from "../src/shared/worktree-files";

const settle = () => Bun.sleep(0);
const FEATURE = sampleRepositories[0]!.worktrees[1]!;

async function started(engine: Engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return store;
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

const textView = (text: string, change: Partial<FileView> = {}): FileView => ({
	repository: "/work/timber", worktreePath: FEATURE.path, path: "src/a.ts", outside: false, from: "workspace",
	result: { outcome: "read", path: "src/a.ts", content: { kind: "text", text, lines: countLines(text) } },
	mode: "source", draft: null, saving: false, saveProblem: null, diskChange: null, goTo: null, ...change,
});

/** Run a command such as undo on a state, and give back the state after it. */
function run(state: EditorState, command: (target: { state: EditorState; dispatch: (transaction: Transaction) => void }) => boolean): EditorState {
	let next = state;
	command({ state, dispatch: transaction => { next = transaction.state; } });
	return next;
}

describe("the editor's words and rules", () => {
	test("counts matches in plain words", () => {
		expect(describeMatches("", 0, -1)).toBe("");
		expect(describeMatches("x", 0, -1)).toBe("No matches");
		expect(describeMatches("x", 1, -1)).toBe("1 match");
		expect(describeMatches("x", 12, -1)).toBe("12 matches");
		expect(describeMatches("x", 12, 2)).toBe("3 of 12");
		expect(describeMatches("x", MAX_MATCHES, 0)).toBe("1 of 10,000 or more");
	});

	test("says where the caret is and how long the file is", () => {
		expect(describeCaret(1, 1)).toBe("Ln 1, Col 1");
		expect(describeCaret(10_000, 18)).toBe("Ln 10,000, Col 18");
		expect(describeLineCount(1)).toBe("1 line");
		expect(describeLineCount(10_001)).toBe("10,001 lines");
	});

	test("indents as the file does", () => {
		expect(indentUnitOf("a\n\tb\n")).toBe("\t");
		expect(indentUnitOf("a\n  b\n    c\n")).toBe("  ");
		expect(indentUnitOf("a\nb\n")).toBe("\t");
		expect(indentUnitOf("a\n" + " ".repeat(12) + "b")).toBe(" ".repeat(8));
	});

	test("keeps only typing, undo, search, indenting, and line comment keys, and none the window keeps", () => {
		const kept = editorKeys([...defaultKeymap, ...historyKeymap, ...searchKeymap]);
		const runs = new Set(kept.map(binding => binding.run));
		for (const left of [deleteLine, moveLineUp, gotoLine, selectNextOccurrence, toggleBlockComment]) expect(runs.has(left)).toBe(false);
		expect(runs.has(undoCommand)).toBe(true);
		expect(kept.find(binding => binding.key === "Mod-/")?.run).toBe(toggleComment);
		const keys = kept.flatMap(binding => [binding.key, binding.mac]).filter(Boolean).map(key => key!.toLowerCase().split("-").sort().join("-"));
		for (const window of ["k-mod-shift", "mod-p-shift", "j-mod-shift", "g-mod-shift"]) expect(keys).not.toContain(window);
		// Find previous is Shift on Mod-g's binding; Shift there is Ctrl+Shift+G, the Changes view's, so it goes. Mod-g still finds the next.
		const modG = kept.filter(binding => binding.key === "Mod-g");
		expect(modG.length).toBeGreaterThan(0);
		for (const binding of modG) expect(binding.shift).toBeUndefined();
	});

		test("undo outlives the editor: a kept state, given the next editor's handlers, still undoes", () => {
		let state = EditorState.create({ doc: "one\n", extensions: [history()] });
		state = state.update({ changes: { from: 3, insert: " two" } }).state;
		// As the editor does when it shows again.
		state = state.update({ effects: StateEffect.reconfigure.of([history()]) }).state;
		state = run(state, undo);
		expect(state.doc.toString()).toBe("one\n");
		state = run(state, redo);
		expect(state.doc.toString()).toBe("one two\n");
	});
});

describe("which files can be edited", () => {
	test("any text file, unless its line endings could not be saved as they were", () => {
		expect(canEditFile(textView("a\nb\n"))).toBe(true);
		expect(canEditFile(textView("a\r\nb\r\n"))).toBe(true);
		expect(lineEndingProblem("a\r\nb\n")).toContain("both CR LF and LF");
		expect(lineEndingProblem("a\rb\n")).toContain("carriage return");
		expect(canEditFile(textView("a\r\nb\n"))).toBe(false);
		expect(editRefusal(textView("a\r\nb\n"))).toEndWith("Open it in your editor to change it.");
		expect(canEditFile(textView("", { result: { outcome: "read", path: "a.png", content: { kind: "binary" } } }))).toBe(false);
		expect(editRefusal(textView("", { result: null }))).toBeNull();
	});

	test("a file with mixed line endings opens in the editor read-only, and says why", async () => {
		const engine = createMockEngine();
		engine.setWorktreeFile(FEATURE.path, "mixed.txt", "a\r\nb\n");
		const store = await started(engine);
		store.openFile(FEATURE.id, "mixed.txt");
		await settle();
		const markup = render(store);
		expect(markup).toContain("Read-only here. Its lines end in both CR LF and LF");
		expect(markup).toContain('<div class="text-editor-host"');
		expect(markup).toContain("Read-only. Ctrl+F to find");
		expect(markup).not.toContain("radiogroup");
		expect(markup).not.toContain(">Save<");
		store.editFile(FEATURE.id);
		store.changeDraft(FEATURE.id, "c\n");
		expect(store.getState().files[FEATURE.id]?.draft).toBeNull();
	});
});

describe("the editor in the File tab", () => {
	test("edits any text file, with a status line, and saves it", async () => {
		const engine = createMockEngine();
		engine.setWorktreeFile(FEATURE.path, "src/a.ts", "const a = 1;\nconst b = 2;\n");
		const store = await started(engine);
		store.openFile(FEATURE.id, "src/a.ts");
		await settle();
		// Straight in the editor, with no switch.
		expect(store.getState().files[FEATURE.id]?.mode).toBe("edit");
		const markup = render(store);
		expect(markup).toContain('<div class="text-editor-host"');
		expect(markup).not.toContain("radiogroup");
		expect(markup).toContain('<span>Ln 1, Col 1</span><span>3 lines</span><span class="text-editor-language">TypeScript</span>');
		expect(markup).toContain("Escape then Tab to leave the text");

		store.changeDraft(FEATURE.id, "const a = 10;\nconst b = 2;\n");
		expect(await store.saveFile(FEATURE.id)).toBe(true);
		expect(engine.readWorktreeFileNow(FEATURE.path, "src/a.ts")).toBe("const a = 10;\nconst b = 2;\n");
	});

	test("Load from disk and Discard stay in the editor, and forget it, so a new one starts from the file", async () => {
		const engine = createMockEngine();
		engine.setWorktreeFile(FEATURE.path, "src/a.ts", "x\n");
		const store = await started(engine);
		store.openFile(FEATURE.id, "src/a.ts");
		await settle();
		const memory = store.fileEditMemory(FEATURE.id, "src/a.ts");
		memory.state = EditorState.create({ doc: "x\n" });
		store.changeDraft(FEATURE.id, "y\n");
		store.discardEdits(FEATURE.id);
		expect(store.getState().files[FEATURE.id]?.mode).toBe("edit");
		expect(store.getState().files[FEATURE.id]?.draft).toBeNull();
		expect(memory.forgotten).toBe(true);
		const next = store.fileEditMemory(FEATURE.id, "src/a.ts");
		expect(next.state).toBeNull();
		expect(next.id).not.toBe(memory.id);

		store.changeDraft(FEATURE.id, "y\n");
		store.discardEdits(FEATURE.id);
		store.loadFromDisk(FEATURE.id);
		expect(store.getState().files[FEATURE.id]?.mode).toBe("edit");
		expect(next.forgotten).toBe(true);
		expect(store.fileEditMemory(FEATURE.id, "src/a.ts").state).toBeNull();
	});

	test("keeps the editor across tabs, and forgets it when the file closes or another opens", async () => {
		const store = await started();
		store.openFile(FEATURE.id, "report.txt");
		await settle();
		store.editFile(FEATURE.id);
		const memory = store.fileEditMemory(FEATURE.id, "report.txt");
		store.showTab("workspace");
		store.showTab("file");
		expect(store.fileEditMemory(FEATURE.id, "report.txt")).toBe(memory);
		store.openFile(FEATURE.id, "docs/plan.md");
		await settle();
		expect(store.fileEditMemory(FEATURE.id, "report.txt")).not.toBe(memory);
		const plan = store.fileEditMemory(FEATURE.id, "docs/plan.md");
		store.closeFile(FEATURE.id);
		expect(store.fileEditMemory(FEATURE.id, "docs/plan.md")).not.toBe(plan);
	});
});

describe("typing in a long file", () => {
	// A guard against work per keystroke that grows with the file, not a measure of the window: that is in docs/verification.md.
	test("a keystroke in a 10,000 line file, with the check for unsaved edits, costs well under a frame", () => {
		const base = Array.from({ length: 10_000 }, (_, index) => `\tconst value${index} = compute(${index}, "some text on the line");`).join("\n") + "\n";
		const baseText = Text.of(base.split("\n"));
		let state = EditorState.create({ doc: base, extensions: [history()] });
		let caret = Math.floor(base.length / 2);
		const keystrokes = 300;
		const started = performance.now();
		for (let index = 0; index < keystrokes; index++) {
			state = state.update({ changes: { from: caret, insert: "x" }, selection: { anchor: caret + 1 }, userEvent: "input.type" }).state;
			caret++;
			expect(state.doc.eq(baseText)).toBe(false);
		}
		const perKeystroke = (performance.now() - started) / keystrokes;
		expect(perKeystroke).toBeLessThan(8);
		state = run(state, undo);
		expect(state.doc.eq(baseText)).toBe(true);
	});
});

describe("the file read again from disk, in the editor", () => {
	const showIn = (state: EditorState, text: string, slot: Compartment) => {
		let next = state;
		for (const spec of reloadFromDisk(next, text, slot) ?? []) next = next.update(spec).state;
		return next;
	};

	test("puts the new text in, keeps the caret's line and column, and leaves undo nothing from before", () => {
		const slot = new Compartment();
		let state = EditorState.create({ doc: "alpha\nline2\nbeta\ngamma\n", extensions: [slot.of(history())], selection: { anchor: 14 } });
		// Typed and taken back, so the text is as on disk, with steps in the history recorded against it.
		state = state.update({ changes: { from: 6, to: 11 }, userEvent: "delete" }).state;
		state = state.update({ changes: { from: 6, insert: "line2" }, userEvent: "input.type" }).state;
		state = state.update({ selection: { anchor: 14 } }).state;
		expect(state.doc.toString()).toBe("alpha\nline2\nbeta\ngamma\n");

		const shown = showIn(state, "header\nalpha\nbeta\ngamma\ndelta\n", slot);
		expect(shown.doc.toString()).toBe("header\nalpha\nbeta\ngamma\ndelta\n");
		// Line 3, column 3, as before.
		const head = shown.selection.main.head;
		expect([shown.doc.lineAt(head).number, head - shown.doc.lineAt(head).from + 1]).toEqual([3, 3]);
		expect(run(shown, undo).doc.toString()).toBe(shown.doc.toString());
		// A shorter file keeps the caret inside it; the same text changes nothing.
		const shorter = showIn(shown, "x\n", slot);
		expect(shorter.selection.main.head).toBe(2);
		expect(reloadFromDisk(shorter, "x\n", slot)).toBeNull();
	});
});
