import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import {
	describeFilterResult, describeLineCounts, describeSteppedTo, filterFiles, speakLineCounts, steppedFile, totalLineCounts,
} from "../src/mainview/changes-format";
import { fileStepOf, takesFileStepKey } from "../src/mainview/changes-panel-format";
import {
	describeUnchangedLines, fileLines, fillUnchanged, linesMatchDiff, shownSections, unchangedGaps, unchangedReadable,
} from "../src/mainview/diff-unchanged";
import { browserSampleRepositories, createMockEngine } from "../src/mainview/engine/mock";
import { GALLERY_WORKTREE, type MockFileChange, listMockFileChanges, mockLineCounts, sampleSpreadEdit, samplePatch } from "../src/mainview/engine/mock-file-changes";
import { fileViewed, initialState } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { type DiffSection, type FileChange, type FileDiff, parseDiff } from "../src/shared/file-changes";
import { OUTDATED_MARK } from "../src/shared/review";
import type { Repository } from "../src/shared/model";

const settle = () => Bun.sleep(0);
const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

const change = (path: string, area: FileChange["area"] = "unstaged", kind: FileChange["kind"] = "modified", counts: [number | null, number | null] = [1, 1]): FileChange =>
	({ area, kind, path, previousPath: null, added: counts[0], removed: counts[1], version: "v" });

function find(repositories: readonly Repository[], path: string) {
	for (const repository of repositories) {
		const worktree = repository.worktrees.find(candidate => candidate.path === path);
		if (worktree) return { repository, worktree };
	}
	throw new Error(`No worktree at ${path}`);
}

/** A file of 40 lines with lines 6 and 24 changed: hunks for lines 3 to 9 and 21 to 27. */
const SPREAD = sampleSpreadEdit("src/spread.ts", 40, [6, 24]);
const spreadDiff = parseDiff(SPREAD.patch);
const spreadLines = fileLines(SPREAD.text!);

describe("unchanged lines between hunks", () => {
	test("each hunk has the unchanged lines before it, from the first line of the file", () => {
		const section = (spreadDiff as Extract<FileDiff, { kind: "text" }>).sections[0]!;
		expect(unchangedGaps(section)).toEqual([{ from: 1, to: 2, offset: 0 }, { from: 10, to: 20, offset: 0 }]);
	});

	test("a hunk that adds or removes lines moves the old numbers of the lines after it", () => {
		const section: DiffSection = { header: [], hunks: [
			{ header: "@@ -3,2 +2,0 @@", lines: [] },
			{ header: "@@ -10,1 +8,3 @@", lines: [] },
			{ header: "@@ -20 +20 @@", lines: [] },
		] };
		expect(unchangedGaps(section)).toEqual([{ from: 1, to: 2, offset: 0 }, { from: 3, to: 7, offset: 2 }, { from: 11, to: 19, offset: 0 }]);
		// A new file starts at line 1, a deleted one has no new lines: nothing comes before either.
		expect(unchangedGaps({ header: [], hunks: [{ header: "@@ -0,0 +1,3 @@", lines: [] }] })).toEqual([{ from: 1, to: 0, offset: 0 }]);
		expect(unchangedGaps({ header: [], hunks: [{ header: "@@ -1,3 +0,0 @@", lines: [] }] })).toEqual([{ from: 1, to: 0, offset: 0 }]);
		// A combined diff numbers no lines.
		expect(unchangedGaps({ header: [], hunks: [{ header: "@@@ -1,1 -1,1 +1,5 @@@", lines: [] }] })).toEqual([null]);
	});

	test("filling a diff adds each gap's lines with their old and new numbers, only when the file is the diff's new side", () => {
		expect(linesMatchDiff(spreadDiff, spreadLines)).toBe(true);
		const filled = fillUnchanged(spreadDiff, spreadLines);
		const lines = filled.kind === "text" ? filled.sections[0]!.hunks.flatMap(hunk => hunk.lines) : [];
		expect(lines.filter(line => line.kind === "context").map(line => line.newLine)).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26, 27]);
		expect(lines.find(line => line.newLine === 15)).toEqual({ kind: "context", text: "export const line15 = 15;", oldLine: 15, newLine: 15 });
		// A file that changed since the diff was read is not filled in.
		const edited = spreadLines.map((line, index) => (index === 6 ? "something else" : line));
		expect(linesMatchDiff(spreadDiff, edited)).toBe(false);
		expect(fillUnchanged(spreadDiff, edited)).toBe(spreadDiff);
		expect(fillUnchanged(spreadDiff, null)).toBe(spreadDiff);
	});

	test("the shown sections keep a slot before each hunk, so a hunk's index never moves when its gap opens", () => {
		const closed = shownSections(spreadDiff, spreadLines, () => false)[0]!;
		const open = shownSections(spreadDiff, spreadLines, gap => gap.from === 10)[0]!;
		expect(closed.hunks.map(hunk => [hunk.header === "" ? "gap" : "hunk", hunk.lines.length, hunk.unchanged])).toEqual([
			["gap", 0, { count: 2, shown: false, from: 1 }],
			["hunk", 8, null],
			["gap", 0, { count: 11, shown: false, from: 10 }],
			["hunk", 8, null],
		]);
		expect(open.hunks[2]!.lines.map(line => line.newLine)).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
		expect(open.hunks[1]).toEqual(closed.hunks[1]!);
		expect(open.hunks[3]).toEqual(closed.hunks[3]!);
		// Without the file, every slot is there and empty.
		expect(shownSections(spreadDiff, null, () => true)[0]!.hunks.map(hunk => [hunk.lines.length, hunk.unchanged])).toEqual([[0, null], [8, null], [0, null], [8, null]]);
		expect(describeUnchangedLines(1)).toBe("Show 1 unchanged line");
		expect(describeUnchangedLines(11)).toBe("Show 11 unchanged lines");
	});

	test("only a file whose diff has it on disk as its new side can be filled in", () => {
		expect(unchangedReadable(change("a.ts"), [])).toBe(true);
		expect(unchangedReadable(change("a.ts", "base"), [])).toBe(true);
		expect(unchangedReadable(change("a.ts", "staged"), [change("a.ts", "staged")])).toBe(true);
		// Staged with edits on disk after it: the new side is the index, not the file.
		expect(unchangedReadable(change("a.ts", "staged"), [change("a.ts", "staged"), change("a.ts")])).toBe(false);
		for (const kind of ["deleted", "conflicted", "untracked", "type-changed"] as const) expect(unchangedReadable(change("a.ts", "unstaged", kind), [])).toBe(false);
		expect(fileLines("a\nb\n")).toEqual(["a", "b"]);
		expect(fileLines("a\r\nb")).toEqual(["a\r", "b"]);
	});
});

describe("words and keys of the review helpers", () => {
	test("line counts as a row shows and a screen reader says them, and none for a binary file", () => {
		expect(describeLineCounts(change("a.ts", "unstaged", "modified", [12, 3]))).toEqual({ added: "+12", removed: "-3" });
		expect(describeLineCounts(change("a.png", "unstaged", "modified", [null, null]))).toBeNull();
		expect(speakLineCounts(change("a.ts", "unstaged", "modified", [1, 0]))).toBe("1 line added, 0 removed");
		expect(speakLineCounts(change("a.png", "unstaged", "modified", [null, null]))).toBe("");
		expect(totalLineCounts([change("a", "unstaged", "modified", [3, 1]), change("b", "unstaged", "modified", [null, null]), change("c", "staged", "added", [2, 0])])).toEqual({ added: 5, removed: 1 });
	});

	test("the filter keeps the paths that hold the typed text, ignoring case and spaces around it", () => {
		const files = [change("src/Tax/Report.ts"), change("docs/tax.md"), change("README.md")];
		expect(filterFiles(files, "  TAX ").map(file => file.path)).toEqual(["src/Tax/Report.ts", "docs/tax.md"]);
		expect(filterFiles(files, "")).toEqual(files);
		expect(describeFilterResult(2, 3, "tax")).toBe("2 of 3 files match");
		expect(describeFilterResult(1, 3, "read")).toBe("1 of 3 files matches");
		expect(describeFilterResult(0, 3, " zz ")).toBe('No changed file matches "zz".');
		expect(describeFilterResult(3, 3, "")).toBe("");
	});

	test("the previous and next file go round at either end, and a lone file has no other", () => {
		const [a, b, c] = [change("a"), change("b"), change("c")];
		expect(steppedFile([a, b, c], b, 1)).toBe(c);
		expect(steppedFile([a, b, c], c, 1)).toBe(a);
		expect(steppedFile([a, b, c], a, -1)).toBe(c);
		expect(steppedFile([a], a, 1)).toBeNull();
		expect(steppedFile([], null, 1)).toBeNull();
		// The open file filtered out: the first or the last file of what shows.
		expect(steppedFile([b, c], a, 1)).toBe(b);
		expect(steppedFile([b, c], a, -1)).toBe(c);
		expect(describeSteppedTo(c, 3, 3)).toBe("c, file 3 of 3");
	});

	test("Alt+Up and Alt+Down step while the diff tab shows, and never from a field that edits text", () => {
		const key = (key: string, more: Partial<KeyboardEvent> = {}) => ({ type: "keydown", key, ctrlKey: false, shiftKey: false, metaKey: false, altKey: true, ...more });
		expect(fileStepOf(key("ArrowUp"))).toBe(-1);
		expect(fileStepOf(key("ArrowDown"))).toBe(1);
		expect(fileStepOf(key("ArrowDown", { altKey: false }))).toBeNull();
		expect(fileStepOf(key("ArrowDown", { shiftKey: true }))).toBeNull();
		expect(fileStepOf(key("ArrowDown", { ctrlKey: true }))).toBeNull();
		const diffShown = { ...initialState, tab: "diff" as const, selection: { repository: "/r", worktree: "w" }, diffs: { w: { file: { area: "unstaged" as const, path: "a", previousPath: null }, from: "workspace" as const } } };
		expect(takesFileStepKey(key("ArrowDown"), diffShown, false)).toBe(1);
		expect(takesFileStepKey(key("ArrowDown"), diffShown, true)).toBeNull();
		expect(takesFileStepKey(key("ArrowDown"), { ...diffShown, tab: "workspace" }, false)).toBeNull();
		expect(takesFileStepKey(key("ArrowDown"), { ...diffShown, diffs: {} }, false)).toBeNull();
		expect(takesFileStepKey(key("ArrowDown"), { ...diffShown, dialog: { kind: "settings", section: "editor" } }, false)).toBeNull();
	});
});

describe("the mock engine's line counts and versions", () => {
	test("counts the added and removed lines of each patch, none for a binary file or a conflict, and the version follows the patch", () => {
		expect(mockLineCounts({ kind: "modified" }, samplePatch("a.ts"))).toEqual({ added: 2, removed: 1 });
		expect(mockLineCounts({ kind: "modified" }, "diff --git a/b b/b\nindex 1..2 100644\nBinary files a/b and b/b differ\n")).toEqual({ added: null, removed: null });
		expect(mockLineCounts({ kind: "conflicted" }, samplePatch("a.ts"))).toEqual({ added: null, removed: null });
		const worktree = find(browserSampleRepositories, GALLERY_WORKTREE).worktree;
		const listed = (files: MockFileChange[]) => {
			const answer = listMockFileChanges(files, worktree, "uncommitted");
			return answer.outcome === "read" ? answer.files : [];
		};
		const first = listed([{ change: change("a.ts"), patch: samplePatch("a.ts") }])[0]!;
		const again = listed([{ change: change("a.ts"), patch: samplePatch("a.ts") }])[0]!;
		const edited = listed([{ change: change("a.ts"), patch: samplePatch("a.ts").replace("retries = 5", "retries = 6") }])[0]!;
		expect([first.added, first.removed]).toEqual([2, 1]);
		expect(again.version).toBe(first.version);
		expect([edited.added, edited.removed]).toEqual([2, 1]);
		expect(edited.version).not.toBe(first.version);
	});
});

describe("the review helpers in the store and the diff tab", () => {
	const FILES = (patchOf: (path: string) => string = samplePatch): MockFileChange[] => ["src/a.ts", "src/b.ts", "docs/c.md"].map(path => ({ change: change(path), patch: patchOf(path) }));

	async function opened(files: MockFileChange[] = FILES()) {
		const engine = createMockEngine(browserSampleRepositories);
		const { worktree } = find(browserSampleRepositories, GALLERY_WORKTREE);
		engine.setFileChanges(worktree.path, files);
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		const { repository } = find(store.getState().repositories, GALLERY_WORKTREE);
		store.select(worktree.id);
		store.showSidePanel("changes");
		await store.readChanges(repository.path, worktree.id);
		await store.compareChanges("uncommitted");
		return { engine, store, repository, worktree };
	}

	test("Viewed dims and checks the file, opens the next one, and is gone once the file's diff changes, even with the same counts", async () => {
		const { engine, store, repository, worktree } = await opened();
		const listed = () => store.getState().changes!.files!;
		await store.selectChangedFile(listed()[0]!);
		await store.toggleViewed(listed()[0]!);
		expect(fileViewed(store.getState(), worktree.id, "uncommitted", listed()[0]!)).toBe(true);
		expect(store.getState().diffs[worktree.id]?.file.path).toBe("src/b.ts");
		const markup = render(store);
		expect(markup).toContain('aria-label="src/a.ts, Modified, Unstaged, 2 lines added, 1 removed, viewed"');
		expect(markup).toContain('class="change-file viewed"');
		// Read again unchanged: still viewed.
		await store.readChanges(repository.path, worktree.id);
		expect(fileViewed(store.getState(), worktree.id, "uncommitted", listed()[0]!)).toBe(true);
		// An agent edits a line it already changed: the counts stay, the diff does not.
		engine.setFileChanges(worktree.path, FILES(path => (path === "src/a.ts" ? samplePatch(path).replace("retries = 5", "retries = 7") : samplePatch(path))));
		await store.readChanges(repository.path, worktree.id);
		const a = listed().find(file => file.path === "src/a.ts")!;
		expect([a.added, a.removed]).toEqual([2, 1]);
		expect(fileViewed(store.getState(), worktree.id, "uncommitted", a)).toBe(false);
		expect(store.getState().viewed[worktree.id]).toEqual({});
	});

	test("unticking Viewed keeps the file open, and the diff tab has the previous and next buttons, the counts, and the box", async () => {
		const { store, worktree } = await opened();
		const [a] = store.getState().changes!.files!;
		await store.selectChangedFile(a!);
		await store.toggleViewed(a!);
		await store.selectChangedFile(a!);
		await store.toggleViewed(a!);
		expect(fileViewed(store.getState(), worktree.id, "uncommitted", a!)).toBe(false);
		expect(store.getState().diffs[worktree.id]?.file.path).toBe("src/a.ts");
		const markup = render(store);
		expect(markup).toContain('aria-label="Previous file" title="Previous file (Alt+Up)" aria-keyshortcuts="Alt+ArrowUp"');
		expect(markup).toContain('aria-label="Next file" title="Next file (Alt+Down)" aria-keyshortcuts="Alt+ArrowDown"');
		expect(markup).toMatch(/<label class="diff-viewed"[^>]*><input type="checkbox"\/>Viewed<\/label>/);
		expect(markup).toContain('<span class="change-counts" aria-hidden="true"><span class="change-added">+2</span> <span class="change-removed">-1</span></span>');
	});

	test("the filter narrows the list and the files the previous and next buttons go through", async () => {
		const { store, worktree } = await opened();
		store.setChangesFilter(worktree.id, "SRC/");
		let markup = render(store);
		expect(markup).toContain('placeholder="Filter files"');
		expect(markup).toContain('<span class="visually-hidden" role="status">2 of 3 files match</span>');
		expect(markup).toContain('aria-label="src/a.ts, ');
		expect(markup).not.toContain('aria-label="docs/c.md, ');
		await store.selectChangedFile(store.getState().changes!.files!.find(file => file.path === "src/b.ts")!);
		expect((await store.stepChangedFile(1))?.path).toBe("src/a.ts");
		expect((await store.stepChangedFile(-1))?.path).toBe("src/b.ts");
		store.setChangesFilter(worktree.id, "nothing like it");
		markup = render(store);
		expect(markup).toContain('No changed file matches &quot;nothing like it&quot;.');
	});

	test("a diff with unchanged lines between hunks shows a row for each gap, and a note on an unchanged line shows its gap and is not outdated", async () => {
		const spread = sampleSpreadEdit("src/spread.ts", 40, [6, 24]);
		const { store, repository, worktree } = await opened([spread, ...FILES()]);
		const file = store.getState().changes!.files!.find(candidate => candidate.path === "src/spread.ts")!;
		await store.selectChangedFile(file);
		expect(store.getState().changes!.unchanged).toEqual(fileLines(spread.text!));
		let markup = render(store);
		expect(markup).toContain(">Show 2 unchanged lines</button>");
		expect(markup).toContain(">Show 11 unchanged lines</button>");
		// A note on line 15, one of the unchanged lines.
		const filled = fillUnchanged(store.getState().changes!.diff!.outcome === "read" ? (store.getState().changes!.diff as { diff: FileDiff }).diff : { kind: "unchanged" }, store.getState().changes!.unchanged);
		const line15 = filled.kind === "text" ? filled.sections[0]!.hunks.flatMap(hunk => hunk.lines).find(line => line.newLine === 15)! : null;
		expect(store.addReviewNote(worktree.id, { comparison: "uncommitted", file, lines: [{ kind: "context", text: line15!.text, oldLine: 15, newLine: 15 }], text: "Why 15?" })).toBeNull();
		markup = render(store);
		expect(markup).not.toContain(">Show 11 unchanged lines</button>");
		expect(markup).toContain('aria-label="Add a note on line 15"');
		expect(markup).toContain("Why 15?");
		await store.readChanges(repository.path, worktree.id);
		expect(store.getState().reviews[worktree.id]?.[0]?.outdated).toBe(false);
		// Send review and Copy review read each noted file again, and judge it the same way.
		const message = await store.prepareReview(worktree.id);
		expect(message).toContain("Why 15?");
		expect(message).not.toContain(OUTDATED_MARK);
		expect(store.getState().reviews[worktree.id]?.[0]?.outdated).toBe(false);
	});

	test("a staged file edited again on disk offers no unchanged lines, and reading it outdates no note", async () => {
		const spread = sampleSpreadEdit("src/spread.ts", 40, [6, 24]);
		const staged: MockFileChange = { ...spread, change: { ...spread.change, area: "staged" } };
		const { store } = await opened([staged, { change: change("src/spread.ts"), patch: samplePatch("src/spread.ts") }]);
		const file = store.getState().changes!.files!.find(candidate => candidate.area === "staged")!;
		await store.selectChangedFile(file);
		expect(store.getState().changes!.unchanged).toBeNull();
		expect(render(store)).not.toContain("unchanged lines</button>");
	});
});
