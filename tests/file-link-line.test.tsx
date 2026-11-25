import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { MOCK_NOTES_FOLDER } from "../src/mainview/engine/mock-worktree-files";
import { openFileMode } from "../src/mainview/file-view-format";
import { createAppStore } from "../src/mainview/store/store";
import { placeOffset } from "../src/mainview/text-editor-format";
import type { Engine } from "../src/shared/engine";

/**
 * A terminal link with a line, such as `src/a.ts:45:4`: the store keeps the
 * place for the editor to go to, and drops it where no editor will show the
 * file. The caret in a real editor is tested in text-editor-browser.test.ts.
 */

const settle = () => Bun.sleep(0);
const FEATURE = sampleRepositories[0]!.worktrees[1]!;
const LINES = Array.from({ length: 50 }, (_, index) => `line ${index + 1}`).join("\n") + "\n";

async function started(engine: Engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return store;
}

function withFiles() {
	const engine = createMockEngine();
	engine.setWorktreeFile(FEATURE.path, "src/a.ts", LINES);
	engine.setWorktreeFile(FEATURE.path, "notes.md", "# Notes\n\nA line.\n");
	engine.setWorktreeFile(FEATURE.path, "trace.bin", { kind: "bytes", bytes: [0, 1, 2, 0] });
	return engine;
}

describe("where a link's place puts the caret", () => {
	const doc = Text.of(["first", "second line", "", "last"]);

	test("goes to the line and the column, counted from 1", () => {
		expect(placeOffset(doc, { line: 2, column: null })).toBe(doc.line(2).from);
		expect(placeOffset(doc, { line: 2, column: 4 })).toBe(doc.line(2).from + 3);
		expect(placeOffset(doc, { line: 1, column: 1 })).toBe(0);
	});

	test("keeps a place past the end, or before the start, inside the text", () => {
		// A line past the end is the start of the last line, whatever the column.
		expect(placeOffset(doc, { line: 99, column: 3 })).toBe(doc.line(4).from);
		expect(placeOffset(doc, { line: 0, column: null })).toBe(0);
		// A column past the line's end is its end.
		expect(placeOffset(doc, { line: 2, column: 80 })).toBe(doc.line(2).to);
		expect(placeOffset(doc, { line: 3, column: 5 })).toBe(doc.line(3).from);
		expect(placeOffset(doc, { line: 1, column: 0 })).toBe(0);
	});

	test("opens Markdown with a line in Source, and without one rendered", () => {
		expect(openFileMode("docs/design.md", { line: 120, column: null })).toBe("source");
		expect(openFileMode("docs/design.md", null)).toBe("rendered");
		expect(openFileMode("src/a.ts", { line: 4, column: null })).toBe("edit");
	});
});

describe("opening a file at a line", () => {
	test("keeps the place for the editor, and a path without one opens as before", async () => {
		const store = await started(withFiles());
		store.openFile(FEATURE.id, "src/a.ts", { line: 45 });
		await settle();
		expect(store.getState().files[FEATURE.id]).toMatchObject({ path: "src/a.ts", mode: "edit", goTo: { line: 45, column: null }, result: { outcome: "read" } });
		expect(store.getState().tab).toBe("file");

		store.closeFile(FEATURE.id);
		store.openFile(FEATURE.id, "src/a.ts");
		await settle();
		expect(store.getState().files[FEATURE.id]?.goTo).toBeNull();
	});

	test("opens Markdown with a line in Source, and without one rendered", async () => {
		const store = await started(withFiles());
		store.openFile(FEATURE.id, "notes.md", { line: 3, column: 2 });
		await settle();
		expect(store.getState().files[FEATURE.id]).toMatchObject({ mode: "source", goTo: { line: 3, column: 2 } });

		store.closeFile(FEATURE.id);
		store.openFile(FEATURE.id, "notes.md");
		await settle();
		expect(store.getState().files[FEATURE.id]).toMatchObject({ mode: "rendered", goTo: null });
	});

	test("the editor's word that it went there drops the place, unless a newer one came", async () => {
		const store = await started(withFiles());
		store.openFile(FEATURE.id, "src/a.ts", { line: 10 });
		await settle();
		const first = store.getState().files[FEATURE.id]!.goTo!;
		store.openFile(FEATURE.id, "src/a.ts", { line: 10 });
		const second = store.getState().files[FEATURE.id]!.goTo!;
		// The same place asked again is a new request, so it is gone to again.
		expect(second).not.toBe(first);
		store.wentTo(FEATURE.id, first);
		expect(store.getState().files[FEATURE.id]?.goTo).toBe(second);
		store.wentTo(FEATURE.id, second);
		expect(store.getState().files[FEATURE.id]?.goTo).toBeNull();
	});

	test("a second link into the open file moves the caret and keeps unsaved edits, with no question", async () => {
		const store = await started(withFiles());
		store.openFile(FEATURE.id, "src/a.ts", { line: 5 });
		await settle();
		store.changeDraft(FEATURE.id, `edited\n${LINES}`);
		store.showTab("workspace");
		store.openFile(FEATURE.id, "src/a.ts", { line: 40, column: 3 });
		expect(store.getState().dialog).toBeNull();
		expect(store.getState().tab).toBe("file");
		expect(store.getState().files[FEATURE.id]).toMatchObject({ draft: `edited\n${LINES}`, goTo: { line: 40, column: 3 } });
	});

	test("a link into open Markdown shows its source, and stays in Edit while editing", async () => {
		const store = await started(withFiles());
		store.openFile(FEATURE.id, "notes.md");
		await settle();
		store.openFile(FEATURE.id, "notes.md", { line: 3 });
		expect(store.getState().files[FEATURE.id]).toMatchObject({ mode: "source", goTo: { line: 3, column: null } });
		store.editFile(FEATURE.id);
		store.changeDraft(FEATURE.id, "# Notes\n\nEdited.\n");
		store.openFile(FEATURE.id, "notes.md", { line: 1 });
		expect(store.getState().files[FEATURE.id]).toMatchObject({ mode: "edit", draft: "# Notes\n\nEdited.\n", goTo: { line: 1, column: null } });
		// Edited, then previewed rendered: back to Edit, where the draft can be typed in, not read-only Source.
		store.showFileAs(FEATURE.id, "rendered");
		store.openFile(FEATURE.id, "notes.md", { line: 2 });
		expect(store.getState().files[FEATURE.id]).toMatchObject({ mode: "edit", draft: "# Notes\n\nEdited.\n", goTo: { line: 2, column: null } });
	});

	test("a click without a line drops a place not gone to yet, so the file shows where it was left", async () => {
		const store = await started(withFiles());
		store.openFile(FEATURE.id, "src/a.ts", { line: 30 });
		store.showTab("workspace");
		store.openFile(FEATURE.id, "src/a.ts");
		await settle();
		expect(store.getState().files[FEATURE.id]?.goTo).toBeNull();
		expect(store.getState().tab).toBe("file");
	});

	test("switching Markdown to Rendered drops the place, as Rendered has no lines", async () => {
		const store = await started(withFiles());
		store.openFile(FEATURE.id, "notes.md", { line: 3 });
		store.showFileAs(FEATURE.id, "rendered");
		await settle();
		expect(store.getState().files[FEATURE.id]).toMatchObject({ mode: "rendered", goTo: null });
	});

	test("a file shown as a notice ignores the line", async () => {
		const store = await started(withFiles());
		store.openFile(FEATURE.id, "trace.bin", { line: 4 });
		expect(store.getState().files[FEATURE.id]?.goTo).toEqual({ line: 4, column: null });
		await settle();
		expect(store.getState().files[FEATURE.id]).toMatchObject({ result: { outcome: "read", content: { kind: "binary" } }, goTo: null });
		// Open already as a notice, a second link asks for nothing either.
		store.openFile(FEATURE.id, "trace.bin", { line: 4 });
		expect(store.getState().files[FEATURE.id]?.goTo).toBeNull();

		store.openFile(FEATURE.id, "gone.ts", { line: 2 });
		await settle();
		expect(store.getState().files[FEATURE.id]).toMatchObject({ path: "gone.ts", result: { outcome: "missing" }, goTo: null });

		// A relative path that steps out does not open, so it has nothing to go to.
		store.openFile(FEATURE.id, "../elsewhere/a.ts", { line: 2 });
		expect(store.getState().files[FEATURE.id]?.goTo).toBeNull();
	});

	test("a link in the worktree that leads out to Markdown shows its target's source at the line", async () => {
		const engine = withFiles();
		engine.setWorktreeFile(FEATURE.path, "plan.md", { kind: "link", target: `${MOCK_NOTES_FOLDER}/plan.md` });
		const store = await started(engine);
		store.openFile(FEATURE.id, "plan.md", { line: 2 });
		await settle();
		await settle();
		expect(store.getState().files[FEATURE.id]).toMatchObject({ path: `${MOCK_NOTES_FOLDER}/plan.md`, outside: true, mode: "source", goTo: { line: 2, column: null } });
	});

	test("the place waits behind the question about unsaved edits, then goes with the file", async () => {
		for (const answer of ["save", "discard"] as const) {
			const engine = withFiles();
			const store = await started(engine);
			store.openFile(FEATURE.id, "notes.md");
			await settle();
			store.editFile(FEATURE.id);
			store.changeDraft(FEATURE.id, "edited\n");
			store.openFile(FEATURE.id, "src/a.ts", { line: 45, column: 4 });
			expect(store.getState().dialog).toEqual({ kind: "unsaved-file", worktree: FEATURE.id, then: { kind: "open", path: "src/a.ts", at: { line: 45, column: 4 } } });
			await store.answerUnsavedFile(answer);
			await settle();
			expect(store.getState().files[FEATURE.id]).toMatchObject({ path: "src/a.ts", goTo: { line: 45, column: 4 } });
		}
	});

	test("keeping the unsaved edits drops the link and its place", async () => {
		const store = await started(withFiles());
		store.openFile(FEATURE.id, "notes.md");
		await settle();
		store.editFile(FEATURE.id);
		store.changeDraft(FEATURE.id, "edited\n");
		store.openFile(FEATURE.id, "src/a.ts", { line: 45 });
		await store.answerUnsavedFile("keep");
		await settle();
		expect(store.getState().dialog).toBeNull();
		expect(store.getState().files[FEATURE.id]).toMatchObject({ path: "notes.md", draft: "edited\n", goTo: null });
	});
});
