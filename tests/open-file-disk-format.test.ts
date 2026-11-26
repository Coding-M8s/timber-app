import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { MOCK_NOTES_FOLDER } from "../src/mainview/engine/mock-worktree-files";
import { describeDiskChange, describeUnsavedFileQuestion, sameFileResult } from "../src/mainview/file-view-format";
import { FILE_CHECK_MILLISECONDS, createAppStore } from "../src/mainview/store/store";
import { caretAfterReload, changeBetween } from "../src/mainview/text-editor-format";
import { manualClock } from "./support/clock";
import type { WorktreeFileResult } from "../src/shared/worktree-files";

const TIMBER = "/work/timber";
const FEATURE = sampleRepositories[0]!.worktrees[1]!;
/** The mock engine whose file reads fail while `failFileChanges` says so, and whose stamps keep working, as when only a read is not heard. */
function failingReads(mock: ReturnType<typeof createMockEngine>) {
	let failure: string | null = null;
	return {
		...mock,
		failFileChanges: (message: string | null) => void (failure = message),
		readWorktreeFile: async (request: Parameters<typeof mock.readWorktreeFile>[0]) => failure === null ? mock.readWorktreeFile(request) : { outcome: "failed" as const, message: failure },
	};
}

const text = (value: string): WorktreeFileResult => ({ outcome: "read", path: "a.txt", content: { kind: "text", text: value, lines: 1 } });

describe("keeping the open file up to date, without a window", () => {
	test("changeBetween changes only what differs", () => {
		expect(changeBetween("abc", "abc")).toBeNull();
		expect(changeBetween("one\ntwo\nthree\n", "one\nTWO\nthree\n")).toEqual({ from: 4, to: 7, insert: "TWO" });
		expect(changeBetween("a\n", "header\na\n")).toEqual({ from: 0, to: 0, insert: "header\n" });
		expect(changeBetween("aaa", "aa")).toEqual({ from: 2, to: 3, insert: "" });
		expect(changeBetween("", "new")).toEqual({ from: 0, to: 0, insert: "new" });
		for (const [before, after] of [["xyx", "xy"], ["abcabc", "abc"], ["hello\n", "help\n"]] as const) {
			const change = changeBetween(before, after)!;
			expect(before.slice(0, change.from) + change.insert + before.slice(change.to)).toBe(after);
		}
	});

	test("caretAfterReload keeps the line and column, inside the new text", () => {
		const doc = Text.of(["first", "second", "x"]);
		expect(caretAfterReload(doc, 2, 4)).toBe(6 + 3);
		// A line that got shorter puts the caret at its end, and a file that did on its last line.
		expect(caretAfterReload(doc, 3, 9)).toBe(doc.line(3).to);
		expect(caretAfterReload(doc, 40, 2)).toBe(doc.line(3).from + 1);
		expect(caretAfterReload(Text.of([""]), 7, 7)).toBe(0);
	});

	test("sameFileResult tells a read that changes nothing on screen", () => {
		expect(sameFileResult(null, text("a"))).toBe(false);
		expect(sameFileResult(text("a"), text("a"))).toBe(true);
		expect(sameFileResult(text("a"), text("b"))).toBe(false);
		const missing: WorktreeFileResult = { outcome: "missing", path: "a.txt", message: "gone" };
		expect(sameFileResult(missing, { ...missing })).toBe(true);
		expect(sameFileResult(text("a"), missing)).toBe(false);
		expect(sameFileResult({ outcome: "read", path: "a", content: { kind: "binary" } }, { outcome: "read", path: "a", content: { kind: "binary" } })).toBe(true);
		expect(sameFileResult({ outcome: "read", path: "a", content: { kind: "too-large", bytes: 5, lines: null } }, { outcome: "read", path: "a", content: { kind: "too-large", bytes: 6, lines: null } })).toBe(false);
	});

	test("says what happened on disk, and what Load from disk drops", () => {
		expect(describeDiskChange({ path: "a.txt", diskChange: null })).toBeNull();
		expect(describeDiskChange({ path: "a.txt", diskChange: "changed" })).toStartWith("a.txt changed on disk since you started editing.");
		expect(describeDiskChange({ path: "a.txt", diskChange: "deleted" })).toStartWith("a.txt was deleted on disk since you started editing.");
		expect(describeUnsavedFileQuestion("docs/a.txt", { kind: "load" }).text).toBe("docs/a.txt has edits that are not saved. Loading it from disk drops them unless you save first.");
	});

	test("the mock engine's stamp follows a file put on its pretend disk, and stays while nothing changes", async () => {
		const engine = createMockEngine();
		const request = { repository: TIMBER, worktree: FEATURE.path, path: "notes.md" };
		const missing = await engine.readFileStamp(request);
		engine.setWorktreeFile(FEATURE.path, "notes.md", "first\n");
		const first = await engine.readFileStamp(request);
		expect(first).not.toBe(missing);
		expect(await engine.readFileStamp(request)).toBe(first);
		engine.setWorktreeFile(FEATURE.path, "notes.md", "second\n");
		expect(await engine.readFileStamp(request)).not.toBe(first);
		expect(await engine.readFileStamp({ path: `${MOCK_NOTES_FOLDER}/plan.md` })).toBe(await engine.readFileStamp({ path: `${MOCK_NOTES_FOLDER}/plan.md` }));
		expect(await engine.readFileStamp({ repository: "/nowhere", worktree: FEATURE.path, path: "notes.md" })).toBe("not-listed");
	});

	test("over the mock engine, a file changed with setWorktreeFile shows in the open File tab at the next check", async () => {
		const engine = createMockEngine();
		engine.setWorktreeFile(FEATURE.path, "notes.md", "first\n");
		const clock = manualClock();
		const store = createAppStore(engine, clock.schedule);
		store.start();
		await Bun.sleep(0);
		store.select(FEATURE.id);
		store.openFile(FEATURE.id, "notes.md");
		const shown = () => {
			const result = store.getState().files[FEATURE.id]?.result;
			return result?.outcome === "read" && result.content.kind === "text" ? result.content.text : null;
		};
		for (let round = 0; round < 50 && shown() === null; round++) await Bun.sleep(1);
		expect(shown()).toBe("first\n");
		engine.setWorktreeFile(FEATURE.path, "notes.md", "second\n");
		clock.advance(FILE_CHECK_MILLISECONDS);
		for (let round = 0; round < 50 && shown() !== "second\n"; round++) await Bun.sleep(1);
		expect(shown()).toBe("second\n");
		expect(store.getState().files[FEATURE.id]?.mode).toBe("rendered");
	});

	test("a read that fails is no news: the text and the edits stay, and the next check reads again", async () => {
		const mock = createMockEngine();
		mock.setWorktreeFile(FEATURE.path, "notes.txt", "first\n");
		const engine = failingReads(mock);
		const clock = manualClock();
		const store = createAppStore(engine, clock.schedule);
		store.start();
		await Bun.sleep(0);
		store.select(FEATURE.id);
		store.openFile(FEATURE.id, "notes.txt");
		const view = () => store.getState().files[FEATURE.id];
		const shown = () => {
			const result = view()?.result;
			return result?.outcome === "read" && result.content.kind === "text" ? result.content.text : null;
		};
		const tick = async () => {
			clock.advance(FILE_CHECK_MILLISECONDS);
			for (let round = 0; round < 5; round++) await Bun.sleep(1);
		};
		for (let round = 0; round < 50 && shown() === null; round++) await Bun.sleep(1);
		engine.failFileChanges("Git is busy");
		mock.setWorktreeFile(FEATURE.path, "notes.txt", "second\n");
		await tick();
		await tick();
		expect(shown()).toBe("first\n");
		// With unsaved edits, a failure does not say the file changed.
		store.changeDraft(FEATURE.id, "mine\n");
		await tick();
		expect(view()).toMatchObject({ draft: "mine\n", diskChange: null });
		engine.failFileChanges(null);
		await tick();
		expect(view()).toMatchObject({ draft: "mine\n", diskChange: "changed" });

		// A save refused over the change, then every edit undone: the text on disk shows, and the refusal goes with it.
		expect(await store.saveFile(FEATURE.id)).toBe(false);
		expect(view()?.saveProblem?.kind).toBe("changed");
		store.changeDraft(FEATURE.id, "first\n");
		for (let round = 0; round < 50 && shown() !== "second\n"; round++) await Bun.sleep(1);
		expect(view()).toMatchObject({ diskChange: null, saveProblem: null, draft: "second\n" });
	});

	test("a first read that fails shows why, and the next check reads again", async () => {
		const mock = createMockEngine();
		mock.setWorktreeFile(FEATURE.path, "notes.txt", "first\n");
		const engine = failingReads(mock);
		engine.failFileChanges("Git is busy");
		const clock = manualClock();
		const store = createAppStore(engine, clock.schedule);
		store.start();
		await Bun.sleep(0);
		store.select(FEATURE.id);
		store.openFile(FEATURE.id, "notes.txt");
		const result = () => store.getState().files[FEATURE.id]?.result;
		for (let round = 0; round < 50 && result() === null; round++) await Bun.sleep(1);
		expect(result()?.outcome).toBe("failed");
		engine.failFileChanges(null);
		clock.advance(FILE_CHECK_MILLISECONDS);
		for (let round = 0; round < 50 && result()?.outcome !== "read"; round++) await Bun.sleep(1);
		expect(result()?.outcome).toBe("read");
	});
});
