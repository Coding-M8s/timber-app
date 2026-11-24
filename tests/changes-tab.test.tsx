import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tags } from "@lezer/highlight";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import {
	MORE_FILES_NOTE, NO_REFRESH, REFRESHING_CHANGES, baseUnavailable, describeComparison, describeDiffNotice, describeFileArea, describeFileCounts, describeNoChanges, diffCommand, fileAfterKey, groupFileChanges, listedOrder, nextRefreshSpan, splitPath,
} from "../src/mainview/changes-format";
import { FOLDER_MISSING_CHANGES } from "../src/mainview/components/ChangesList";
import { codeHighlightStyle, pickLanguage } from "../src/mainview/editor-language";
import { browserSampleRepositories, createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { derivedFileChanges, GALLERY_WORKTREE, MOCK_BRANCH_POINT, type MockFileChange, sampleNewFilePatch, samplePatch } from "../src/mainview/engine/mock-file-changes";
import { changesBusy } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import type { Engine } from "../src/shared/engine";
import type { Comparison, FileChange, FileChangesResult, FileDiffResult } from "../src/shared/file-changes";
import type { Repository } from "../src/shared/model";
import { defaultLayout } from "../src/shared/layout";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const FEATURE = sampleRepositories[0]!.worktrees[1]!;
const BILLING = "/work/billing";

function find(repositories: readonly Repository[], path: string) {
	for (const repository of repositories) {
		const worktree = repository.worktrees.find(candidate => candidate.path === path);
		if (worktree) return { repository, worktree };
	}
	throw new Error(`No worktree at ${path}`);
}

async function started(engine: Engine = createMockEngine(browserSampleRepositories)) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return store;
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);
/** Text as React writes it into markup. */
const escaped = (text: string) => text.replaceAll("&", "&amp;").replaceAll("'", "&#x27;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** A mock engine on which FEATURE's Changes tab was set to Uncommitted, as a person would. */
async function uncommittedEngine() {
	const engine = createMockEngine();
	await engine.saveLayout({ ...defaultLayout(), uncommittedChanges: [FEATURE.id] });
	return engine;
}

const file = (area: FileChange["area"], kind: FileChange["kind"], path: string, previousPath: string | null = null): FileChange => ({ area, kind, path, previousPath, added: null, removed: null, version: "" });
/** A listed file as the engine answers it, whatever its counts and version. */
const named = (area: FileChange["area"], kind: FileChange["kind"], path: string, previousPath: string | null = null) => ({ area, kind, path, previousPath });
const mock = (change: FileChange, patch = samplePatch(change.path)): MockFileChange => ({ change, patch });

describe("the store's Changes view", () => {
	test("reads the files, and no diff until a file is chosen, which opens it in the diff tab", async () => {
		const engine = await uncommittedEngine();
		engine.setFileChanges(FEATURE.path, [
			mock(file("unstaged", "modified", "b.ts")),
			mock(file("staged", "added", "a.ts"), sampleNewFilePatch("a.ts")),
		]);
		const store = await started(engine);
		store.select(FEATURE.id);
		await store.readChanges(TIMBER, FEATURE.id);
		const view = store.getState().changes!;
		expect(view.files?.map(entry => `${entry.area} ${entry.path}`)).toEqual(["unstaged b.ts", "staged a.ts"]);
		// Nothing is open, so nothing is read for a diff, and the tab that showed stays.
		expect(view).toMatchObject({ selected: null, diff: null });
		expect(store.getState().diffs).toEqual({});
		expect(store.getState().tab).toBe("workspace");
		expect(store.getState().operations).toEqual([]);

		await store.selectChangedFile(file("staged", "added", "a.ts"));
		const opened = store.getState();
		expect(opened.tab).toBe("diff");
		expect(opened.diffs[FEATURE.id]).toEqual({ file: { area: "staged", path: "a.ts", previousPath: null }, from: "workspace" });
		expect(opened.changes?.selected).toEqual({ area: "staged", path: "a.ts", previousPath: null });
		expect(opened.changes?.diff?.outcome === "read" && opened.changes.diff.diff.kind).toBe("text");
	});

	test("keeps the diff tab's file across reads while it is listed, and closes the tab when it is gone", async () => {
		const engine = await uncommittedEngine();
		const a = mock(file("unstaged", "modified", "a.ts"));
		const b = mock(file("unstaged", "modified", "b.ts"));
		engine.setFileChanges(FEATURE.path, [a, b]);
		const store = await started(engine);
		store.select(FEATURE.id);
		store.showTab("pull-request");
		await store.readChanges(TIMBER, FEATURE.id);
		await store.selectChangedFile(b.change);
		expect(store.getState().changes?.selected?.path).toBe("b.ts");

		// The file changed again: the same file stays selected and its diff is read again.
		engine.setFileChanges(FEATURE.path, [a, mock(b.change, samplePatch("b.ts").replace("retries = 5", "retries = 9"))]);
		await store.readChanges(TIMBER, FEATURE.id);
		const view = store.getState().changes!;
		expect(view.selected?.path).toBe("b.ts");
		const added = view.diff?.outcome === "read" && view.diff.diff.kind === "text" ? view.diff.diff.sections[0]!.hunks[0]!.lines.filter(line => line.kind === "added").map(line => line.text) : [];
		expect(added).toContain("export const retries = 9;");

		// b.ts is no longer changed: its diff tab closes, back to the tab it was opened from.
		engine.setFileChanges(FEATURE.path, [a]);
		await store.readChanges(TIMBER, FEATURE.id);
		expect(store.getState().changes).toMatchObject({ selected: null, diff: null });
		expect(store.getState().diffs).toEqual({});
		expect(store.getState().tab).toBe("pull-request");

		engine.setFileChanges(FEATURE.path, []);
		await store.readChanges(TIMBER, FEATURE.id);
		expect(store.getState().changes).toMatchObject({ files: [], selected: null, diff: null });
	});

	test("ignores a file that is not in the list", async () => {
		const engine = await uncommittedEngine();
		engine.setFileChanges(FEATURE.path, [mock(file("unstaged", "modified", "a.ts"))]);
		const store = await started(engine);
		await store.readChanges(TIMBER, FEATURE.id);
		await store.selectChangedFile({ area: "staged", path: "a.ts", previousPath: null });
		await store.selectChangedFile({ area: "unstaged", path: "../outside", previousPath: null });
		expect(store.getState().changes?.selected).toBeNull();
		expect(store.getState().diffs).toEqual({});
	});

	test("a failed read keeps the last good list beside the reason, until a read works", async () => {
		const engine = await uncommittedEngine();
		engine.setFileChanges(FEATURE.path, [mock(file("unstaged", "modified", "a.ts"))]);
		const store = await started(engine);
		await store.readChanges(TIMBER, FEATURE.id);
		engine.failFileChanges("Git is busy");
		await store.readChanges(TIMBER, FEATURE.id);
		expect(store.getState().changes).toMatchObject({ problem: "Git is busy", files: [named("unstaged", "modified", "a.ts")] });
		engine.failFileChanges(null);
		await store.readChanges(TIMBER, FEATURE.id);
		expect(store.getState().changes?.problem).toBeNull();
	});

	test("an engine that throws is a failed read with the reason, and never throws itself", async () => {
		const base = createMockEngine();
		const engine: Engine = {
			...base,
			readFileChanges: async () => { throw new Error("bridge closed"); },
		};
		const store = await started(engine);
		await store.readChanges(TIMBER, FEATURE.id);
		expect(store.getState().changes?.problem).toBe("The app did not hear back about the changed files: bridge closed");
	});

	test("drops answers that come after a newer read, or for a worktree that no longer shows", async () => {
		const base = createMockEngine();
		const pending: ((result: FileChangesResult) => void)[] = [];
		const diffs: ((result: FileDiffResult) => void)[] = [];
		const engine: Engine = {
			...base,
			readFileChanges: () => new Promise(resolve => pending.push(resolve)),
			readFileDiff: () => new Promise(resolve => diffs.push(resolve)),
		};
		const store = await started(engine);
		const main = sampleRepositories[0]!.worktrees[0]!;
		const first = store.readChanges(TIMBER, FEATURE.id);
		const second = store.readChanges(TIMBER, FEATURE.id);
		await settle();
		pending[1]!({ outcome: "read", files: [file("unstaged", "modified", "new.ts")], more: false, compared: "uncommitted", base: { usable: false, reason: "No base." }, hasCommit: true, operation: null, detached: false });
		await second;
		pending[0]!({ outcome: "read", files: [file("unstaged", "modified", "old.ts")], more: false, compared: "uncommitted", base: { usable: false, reason: "No base." }, hasCommit: true, operation: null, detached: false });
		await first;
		expect(store.getState().changes?.files?.map(entry => entry.path)).toEqual(["new.ts"]);
		const opening = store.selectChangedFile(file("unstaged", "modified", "new.ts"));
		await settle();

		// Another worktree starts afresh, and the first one's diff answering late changes nothing.
		const third = store.readChanges(TIMBER, main.id);
		expect(store.getState().changes).toMatchObject({ worktree: main.id, files: null, selected: null });
		diffs[0]!({ outcome: "read", file: file("unstaged", "modified", "new.ts"), diff: { kind: "binary" } });
		await opening;
		expect(store.getState().changes).toMatchObject({ worktree: main.id, diff: null });
		pending[2]!({ outcome: "read", files: [], more: false, compared: "uncommitted", base: { usable: false, reason: "No base." }, hasCommit: true, operation: null, detached: false });
		await third;
		expect(store.getState().changes).toMatchObject({ worktree: main.id, files: [] });
	});
});

describe("the Changes tab", () => {
	/** The gallery worktree's Changes tab, comparing as asked: Uncommitted unless a test says otherwise. */
	async function gallery(compare: Comparison = "uncommitted") {
		const store = await started();
		const { repository, worktree } = find(store.getState().repositories, GALLERY_WORKTREE);
		store.select(worktree.id);
		store.showSidePanel("changes");
		await store.readChanges(repository.path, worktree.id);
		await store.compareChanges(compare);
		return store;
	}

	test("lists conflicts, staged, unstaged, and untracked files apart, each with its letter", async () => {
		const markup = render(await gallery());
		const titles = [...markup.matchAll(/<h3 class="change-group-title">([^<]+)<span class="change-group-count">(\d+)<\/span><\/h3>/g)].map(match => `${match[1]} ${match[2]}`);
		expect(titles).toEqual(["Merge conflicts 1", "Staged 4", "Unstaged 8", "Untracked 5"]);
		expect(markup).toContain("1 conflicted, 4 staged, 8 unstaged, 5 untracked");
		expect(markup).toContain('aria-label="src/tax/brackets.ts, Renamed from src/tax/bands.ts, Staged, 1 line added, 1 removed"');
		expect(markup).toContain('aria-label="src/tax/zażółć.ts, Untracked, 2 lines added, 0 removed"');
		for (const letter of ["!", "M", "R", "A", "D", "T", "U"]) expect(markup).toContain(`aria-hidden="true">${letter}</span>`);
		// Nothing is open yet: the first file listed is the only tab stop of the list, and none is marked.
		expect(markup).not.toContain('class="change-file selected"');
		expect(markup.match(/class="change-file"[^>]*tabindex="0"/g)).toHaveLength(1);
		expect(markup).not.toContain('aria-label="Diff of ');
	});

	test("choosing a file marks it in the list and shows its diff in a tab named after it, after Pull request", async () => {
		const store = await gallery();
		await store.selectChangedFile(file("staged", "modified", "src/tax/rules.ts"));
		const markup = render(store);
		expect(markup.match(/class="change-file selected" aria-current="true"[^>]*tabindex="0"/g)).toHaveLength(1);
		const tabs = [...markup.matchAll(/role="tab" id="tab-([a-z-]+)"/g)].map(match => match[1]);
		expect(tabs).toEqual(["workspace", "pull-request", "diff"]);
		expect(markup).toContain('<span title="Diff of src/tax/rules.ts"><span class="tab-kind" aria-hidden="true">diff</span><span class="visually-hidden">Diff of </span>rules.ts</span>');
		expect(markup).toContain('aria-label="Close the diff of rules.ts"');
		expect(markup).toContain('aria-label="Diff of src/tax/rules.ts"');
	});

	test("draws a diff with line numbers and markers", async () => {
		const store = await gallery();
		await store.selectChangedFile(file("staged", "modified", "src/tax/rules.ts"));
		const markup = render(store);
		expect(markup).toContain('<div class="diff-hunk-header">@@ -1,6 +1,7 @@</div>');
		// Each numbered line's numbers are a button that starts a review note on it.
		expect(markup).toContain('<div class="diff-line removed notable"><button type="button" class="diff-note-target" tabindex="-1" data-line="0-1-2" aria-label="Add a note on removed line 3" title="Add a note. Drag the + over more lines of this hunk, or Shift+click one, for a range."><span class="diff-note-plus" aria-hidden="true">+</span><span class="diff-number">3</span><span class="diff-number"></span></button><span class="diff-marker" aria-hidden="true">-</span><span class="diff-text">');
		expect(markup).toContain('<div class="diff-line added notable"><button type="button" class="diff-note-target" tabindex="-1" data-line="0-1-3" aria-label="Add a note on line 3" title="Add a note. Drag the + over more lines of this hunk, or Shift+click one, for a range."><span class="diff-note-plus" aria-hidden="true">+</span><span class="diff-number"></span><span class="diff-number">3</span></button><span class="diff-marker" aria-hidden="true">+</span><span class="diff-text">');
	});

	test("colors a diff's code as the editor does, and marks the words that changed", async () => {
		const language = pickLanguage("src/tax/rules.ts", { lines: 1, length: 1 });
		if (language.kind !== "colored") throw new Error("TypeScript was not picked");
		await language.description.load();
		const store = await gallery();
		await store.selectChangedFile(file("staged", "modified", "src/tax/rules.ts"));
		const markup = render(store);
		const keyword = codeHighlightStyle.style([tags.keyword])!;
		const number = codeHighlightStyle.style([tags.number])!;
		expect(markup).toContain(`<span class="diff-text"><span class="${keyword}">export</span> <span class="${keyword}">const</span>`);
		// The one number that changed is marked on both lines, and still colored as a number.
		expect(markup).toContain(`<span class="diff-word ${number}">3</span>`);
		expect(markup).toContain(`<span class="diff-word ${number}">5</span>`);
		expect(markup.match(/class="diff-word/g)).toHaveLength(2);
	});

	test("shows a notice for binary, very large, and empty files, and a rename's header", async () => {
		const store = await gallery();
		const shown = async (change: FileChange) => {
			await store.selectChangedFile(change);
			return render(store);
		};
		expect(await shown(file("unstaged", "modified", "assets/logo.png"))).toContain("Binary file");
		expect(await shown(file("untracked", "untracked", "assets/icon.ico"))).toContain("Binary file");
		const large = await shown(file("unstaged", "modified", "src/generated/rows.ts"));
		expect(large).toContain("This diff is too large to show");
		expect(large).toContain("It is 6,005 lines, more than 5,000. Run git diff -- src/generated/rows.ts in a terminal to see it.");
		expect(large).not.toContain("diff-line");
		expect(await shown(file("untracked", "untracked", "notes/empty.txt"))).toContain("Empty file");
		const renamed = await shown(file("staged", "renamed", "src/tax/brackets.ts", "src/tax/bands.ts"));
		expect(renamed).toContain("<div>rename from src/tax/bands.ts</div>");
		expect(renamed).toContain('<span class="diff-previous">src/tax/bands.ts → </span>src/tax/brackets.ts');
	});

	test("offers Open in editor for the selected file with its exact command, but not for a deleted file", async () => {
		const store = await gallery();
		await store.savePreferences({ editor: { command: "code", terminal: false } });
		await store.selectChangedFile(file("untracked", "untracked", "src/tax/new rules.ts"));
		const markup = render(store);
		expect(markup).toContain(`title="${escaped(`Open in editor: code '${GALLERY_WORKTREE}/src/tax/new rules.ts'`)}"`);

		await store.selectChangedFile(file("staged", "deleted", "src/tax/legacy.ts"));
		expect(render(store)).not.toContain("diff-editor");
	});

	test("opening a file starts the editor on that file and says so", async () => {
		const engine = createMockEngine(browserSampleRepositories);
		const store = await started(engine);
		await store.savePreferences({ editor: { command: "code", terminal: false } });
		const answer = await store.openInEditor({ repository: BILLING, worktree: GALLERY_WORKTREE, file: "src/tax/rules.ts" });
		expect(answer).toEqual({ outcome: "opened", command: `code ${GALLERY_WORKTREE}/src/tax/rules.ts` });
		expect(engine.launchedEditors().at(-1)?.request).toEqual({ repository: BILLING, worktree: GALLERY_WORKTREE, file: "src/tax/rules.ts" });
		expect(store.getState().toasts.at(-1)?.text).toBe("Opened src/tax/rules.ts in the editor");
	});

	test("says why when the changes or a diff cannot be read", async () => {
		const engine = createMockEngine(browserSampleRepositories);
		const store = await started(engine);
		const { repository, worktree } = find(store.getState().repositories, GALLERY_WORKTREE);
		store.select(worktree.id);
		store.showSidePanel("changes");
		engine.failFileChanges("Git is busy");
		await store.readChanges(repository.path, worktree.id);
		const markup = render(store);
		expect(markup).toContain("Could not read the changes");
		expect(markup).toContain("Git is busy");
	});

	test("says there are no changes for a clean worktree, and does not read a missing folder", async () => {
		const store = await started();
		store.showSidePanel("changes");
		const main = sampleRepositories[0]!.worktrees[0]!;
		await store.readChanges(TIMBER, main.id);
		expect(render(store)).toContain("This worktree matches its last commit.");

		const { worktree } = find(store.getState().repositories, "/work/api-server-worktrees/old-removed-folder");
		store.select(worktree.id);
		expect(render(store)).toContain(escaped(FOLDER_MISSING_CHANGES));
	});

	test("says when only some files are listed", async () => {
		const engine = await uncommittedEngine();
		engine.setFileChanges(FEATURE.path, Array.from({ length: 5001 }, (_, index) => mock(file("untracked", "untracked", `n/${index}.ts`), sampleNewFilePatch(`n/${index}.ts`))));
		const store = await started(engine);
		store.select(FEATURE.id);
		store.showSidePanel("changes");
		await store.readChanges(TIMBER, FEATURE.id);
		const markup = render(store);
		expect(markup).toContain(MORE_FILES_NOTE);
		expect(markup).toContain("5000 untracked, and more");
	});
});

describe("refreshing the Changes tab", () => {
	/** The gallery worktree's Changes tab, read once, on an engine whose reported changes the test can send. */
	async function shown() {
		const base = createMockEngine(browserSampleRepositories);
		let report: (path: string) => void = () => {};
		const engine: Engine = {
			...base,
			onRepositoryChanged(listener) {
				report = listener;
				return base.onRepositoryChanged(listener);
			},
		};
		const store = await started(engine);
		const { repository, worktree } = find(store.getState().repositories, GALLERY_WORKTREE);
		store.select(worktree.id);
		store.showSidePanel("changes");
		await store.readChanges(repository.path, worktree.id);
		await store.compareChanges("uncommitted");
		return { store, repository, worktree, report: (path: string) => report(path) };
	}

	const bar = (markup: string) => /<div class="changes-bar">(.*?)<\/div>/.exec(markup)?.[1] ?? "";
	const SPINNER = '<span class="changes-spinner"><svg class="status-glyph status-working"';
	const ANNOUNCED = `<span class="visually-hidden" role="status">${REFRESHING_CHANGES}</span>`;
	const QUIET = '<span class="visually-hidden" role="status"></span>';

	test("at rest: no spinner, an empty announcement, the counts, and Refresh ready", async () => {
		const { store } = await shown();
		const markup = render(store);
		const settled = bar(markup);
		expect(settled).not.toContain("changes-spinner");
		expect(settled).toContain(QUIET);
		expect(settled).toContain('<span class="changes-count" role="status">1 conflicted, 4 staged, 8 unstaged, 5 untracked<span class="visually-hidden">, 6020 lines added, 11 removed</span></span>');
		expect(settled).toMatch(/<button type="button" class="text-button" title="[^"]+">Refresh<\/button>/);
		expect(markup).toContain('<div class="change-groups">');
	});

	test("the tab's Refresh shows the spinner, keeps the list dimmed and the counts, and says Refreshing once", async () => {
		const { store, repository } = await shown();
		const reloading = store.reloadRepository(repository.path);
		const markup = render(store);
		const busy = bar(markup);
		expect(busy).toContain(SPINNER);
		expect(busy).toContain("1 conflicted, 4 staged, 8 unstaged, 5 untracked");
		// One live region says it; the counts' own does not change.
		expect(busy.split(REFRESHING_CHANGES)).toHaveLength(2);
		expect(busy).toContain(ANNOUNCED);
		// The button keeps its label, so it does not change width, and cannot start a second read.
		expect(busy).toMatch(/<button type="button" class="text-button" disabled="" title="[^"]+">Refresh<\/button>/);
		expect(markup).toContain('<div class="change-groups refreshing">');
		await reloading;
	});

	test("the sidebar's Refresh, a reported change, and a read of the changes show the spinner too", async () => {
		const { store, repository, worktree, report } = await shown();
		const all = store.refresh();
		expect(bar(render(store))).toContain(SPINNER);
		await all;

		report(repository.path);
		expect(bar(render(store))).toContain(SPINNER);
		expect(bar(render(store))).toContain(ANNOUNCED);
		await settle();

		const reading = store.readChanges(repository.path, worktree.id);
		expect(bar(render(store))).toContain(SPINNER);
		await reading;
	});

	test("switching Compare with shows the spinner, and says Reading changes in place of the old counts, not Refreshing as well", async () => {
		const { store } = await shown();
		const switching = store.compareChanges("base");
		const busy = bar(render(store));
		expect(busy).toContain(SPINNER);
		expect(busy).toContain('<span class="changes-count" role="status">Reading changes</span>');
		expect(busy).toContain(QUIET);
		await switching;
	});

	test("a clean worktree's No changes stays, dimmed, while it is read again", async () => {
		const store = await started();
		store.showSidePanel("changes");
		const main = sampleRepositories[0]!.worktrees[0]!;
		await store.readChanges(TIMBER, main.id);
		const reading = store.readChanges(TIMBER, main.id);
		expect(render(store)).toContain('<div class="changes-clean refreshing">');
		await reading;
	});

	test("the tab is busy for its own reads, its repository's, and every repository's, not another worktree's", async () => {
		const { store, repository, worktree } = await shown();
		const state = (operations: ReturnType<typeof store.getState>["operations"]) => ({ ...store.getState(), operations });
		expect(changesBusy(state([]), repository.path, worktree.id)).toBe(false);
		expect(changesBusy(state([{ kind: "read-changes", worktree: worktree.id }]), repository.path, worktree.id)).toBe(true);
		expect(changesBusy(state([{ kind: "read-changes", worktree: "other" }]), repository.path, worktree.id)).toBe(false);
		expect(changesBusy(state([{ kind: "reload-repository", repository: repository.path }]), repository.path, worktree.id)).toBe(true);
		expect(changesBusy(state([{ kind: "reload-repository", repository: "/elsewhere" }]), repository.path, worktree.id)).toBe(false);
		expect(changesBusy(state([{ kind: "reload-all" }]), repository.path, worktree.id)).toBe(true);
	});

	test("a refresh is over a list only if one showed as it began, so a first read or a switch of Compare with is never called Refreshing", () => {
		// Each step is one render: whether reading (or just done), and whether a list shows.
		const run = (worktree: string, steps: readonly [boolean, boolean][]) => {
			let span = NO_REFRESH;
			return steps.map(([active, listShown]) => (span = nextRefreshSpan(span, worktree, active, listShown)).overList);
		};
		// A refresh of a list on screen, through the moment between the reload and the read.
		expect(run("w", [[true, true], [true, true], [true, true], [false, true]])).toEqual([true, true, true, false]);
		// A first read: the list arrives while the indicator still shows, and is not dimmed or announced.
		expect(run("w", [[true, false], [true, true], [false, true]])).toEqual([false, false, false]);
		// A switch of Compare with mid-refresh empties the list; the new list is not a refresh either.
		expect(run("w", [[true, true], [true, false], [true, true]])).toEqual([true, false, false]);
		// The next refresh starts afresh.
		let span = nextRefreshSpan(NO_REFRESH, "w", true, false);
		span = nextRefreshSpan(span, "w", false, true);
		expect(nextRefreshSpan(span, "w", true, true).overList).toBe(true);
		// Another worktree starts its own span, over no list until its own shows.
		expect(nextRefreshSpan({ worktree: "w", overList: true }, "v", true, false)).toEqual({ worktree: "v", overList: false });
		// An unchanged span is the same object, so the panel does not render again for it.
		const same = { worktree: "w", overList: true };
		expect(nextRefreshSpan(same, "w", true, true)).toBe(same);
	});

	test("the spinner is the working ring, which stands still when less motion is asked for, and the dimmed list does not fade then", () => {
		const styles = readFileSync(join(import.meta.dir, "..", "src/mainview/styles.css"), "utf8").replace(/\r\n/g, "\n");
		const reduced = [...styles.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)];
		const still = (pattern: RegExp) => reduced.find(match => pattern.test(match[1]!));
		expect(still(/\.status-glyph\.status-working\s*\{\s*animation:\s*none;/)).toBeDefined();
		expect(styles).toMatch(/\.change-groups\.refreshing,\s*\.changes-clean\.refreshing\s*\{\s*opacity:\s*0\.7;/);
		// The still rule comes after the fade it turns off: at equal specificity, the later rule wins.
		const fade = /\n\.change-groups,\s*\.changes-clean\s*\{\s*transition:\s*opacity/.exec(styles);
		const stopped = still(/\.change-groups,\s*\.changes-clean\s*\{\s*transition:\s*none;/);
		expect(fade).not.toBeNull();
		expect(stopped?.index).toBeGreaterThan(fade!.index);
	});
});

describe("words and keys of the Changes tab", () => {
	const files = [file("unstaged", "modified", "z.ts"), file("staged", "added", "a.ts"), file("conflicted", "conflicted", "c.ts"), file("untracked", "untracked", "n.ts")];

	test("groups conflicts, then staged, then unstaged, then untracked, and leaves out empty groups", () => {
		expect(groupFileChanges(files).map(group => [group.area, group.files.map(entry => entry.path)])).toEqual([
			["conflicted", ["c.ts"]], ["staged", ["a.ts"]], ["unstaged", ["z.ts"]], ["untracked", ["n.ts"]],
		]);
		expect(groupFileChanges([files[0]!]).map(group => group.area)).toEqual(["unstaged"]);
		expect(groupFileChanges([files[3]!]).map(group => group.area)).toEqual(["untracked"]);
		expect(describeFileCounts(files, false)).toBe("1 conflicted, 1 staged, 1 unstaged, 1 untracked");
		expect(describeFileCounts([], false)).toBe("No changes");
	});

	test("the arrows move through the list as shown and stop at its ends", () => {
		const order = listedOrder(files);
		expect(fileAfterKey(order, null, "ArrowDown")?.path).toBe("c.ts");
		expect(fileAfterKey(order, order[0]!, "ArrowDown")?.path).toBe("a.ts");
		expect(fileAfterKey(order, order[0]!, "ArrowUp")?.path).toBe("c.ts");
		expect(fileAfterKey(order, order[3]!, "ArrowDown")?.path).toBe("n.ts");
		expect(fileAfterKey(order, order[1]!, "End")?.path).toBe("n.ts");
		expect(fileAfterKey(order, order[3]!, "Home")?.path).toBe("c.ts");
		expect(fileAfterKey(order, order[0]!, "Enter")).toBeNull();
		expect(fileAfterKey([], null, "ArrowDown")).toBeNull();
	});

	test("splits a path into its name and folder", () => {
		expect(splitPath("a.ts")).toEqual({ name: "a.ts", folder: "" });
		expect(splitPath("src/deep/a b.ts")).toEqual({ name: "a b.ts", folder: "src/deep" });
	});

	test("names the Git command for each kind of diff, quoted for a shell", () => {
		expect(diffCommand(file("staged", "modified", "a b.ts"))).toBe("git diff --cached -- 'a b.ts'");
		expect(diffCommand(file("unstaged", "modified", "a.ts"))).toBe("git diff -- a.ts");
		expect(diffCommand(file("staged", "renamed", "new.ts", "old.ts"))).toBe("git diff --cached -- old.ts new.ts");
		expect(diffCommand(file("untracked", "untracked", "n.ts"))).toBe("git diff --no-index -- /dev/null n.ts");
	});

	test("says nothing extra for a diff with lines or a header", () => {
		const modified = file("unstaged", "modified", "a.ts");
		expect(describeDiffNotice({ kind: "text", sections: [{ header: [], hunks: [{ header: "@@ -1 +1 @@", lines: [] }] }] }, modified)).toBeNull();
		expect(describeDiffNotice({ kind: "text", sections: [{ header: ["old mode 100644", "new mode 100755"], hunks: [] }] }, modified)).toBeNull();
		expect(describeDiffNotice({ kind: "text", sections: [] }, modified)?.title).toBe("No line changes");
		expect(describeDiffNotice({ kind: "too-large", lines: null }, modified)?.text).toBe("It is more than 512 KiB. Run git diff -- a.ts in a terminal to see it.");
		expect(describeDiffNotice({ kind: "unchanged" }, modified)?.title).toBe("No longer changed");
	});

	test("Uncommitted lists untracked files in their own group after Unstaged, as the mock engine does", async () => {
		const engine = await uncommittedEngine();
		engine.setFileChanges(FEATURE.path, [
			mock(file("staged", "added", "a.ts"), sampleNewFilePatch("a.ts")),
			mock(file("unstaged", "modified", "b.ts")),
			mock(file("untracked", "untracked", "n.ts"), sampleNewFilePatch("n.ts")),
			mock(file("base", "modified", "committed.ts")),
		]);
		const store = await started(engine);
		await store.readChanges(TIMBER, FEATURE.id);
		const view = store.getState().changes!;
		expect(view.compared).toBe("uncommitted");
		expect(groupFileChanges(view.files!).map(group => [group.area, group.files.map(entry => entry.path)])).toEqual([
			["staged", ["a.ts"]], ["unstaged", ["b.ts"]], ["untracked", ["n.ts"]],
		]);
		await store.selectChangedFile(file("untracked", "untracked", "n.ts"));
		const diff = store.getState().changes?.diff;
		expect(diff?.outcome === "read" && diff.file?.path).toBe("n.ts");

		// A sample worktree's own untracked files are listed the same way.
		const sample = { ...FEATURE, changes: { kind: "known" as const, modified: ["m.ts"], untracked: ["u.ts"] }, base: null };
		expect(derivedFileChanges(sample).map(({ change }) => `${change.area} ${change.kind} ${change.path}`)).toEqual(["unstaged modified m.ts", "untracked untracked u.ts"]);
	});
});

describe("comparing with the base", () => {
	const MAIN = sampleRepositories[0]!.worktrees[0]!;

	test("a worktree with a saved base compares with it first, committed work included", async () => {
		const engine = createMockEngine();
		engine.setFileChanges(FEATURE.path, [
			mock(file("base", "modified", "committed.ts")),
			mock(file("staged", "added", "a.ts"), sampleNewFilePatch("a.ts")),
			mock(file("unstaged", "modified", "a.ts")),
			mock(file("untracked", "untracked", "n.ts"), sampleNewFilePatch("n.ts")),
		]);
		const store = await started(engine);
		await store.readChanges(TIMBER, FEATURE.id);
		const view = store.getState().changes!;
		expect(view.compared).toBe("base");
		expect(view.base).toEqual({ usable: true, ref: "refs/remotes/origin/main", name: "origin/main", commit: MOCK_BRANCH_POINT });
		expect(view.files?.map(entry => `${entry.area} ${entry.kind} ${entry.path}`)).toEqual(["base modified committed.ts", "base added a.ts", "untracked untracked n.ts"]);
		expect(view.selected).toBeNull();
		await store.selectChangedFile(file("base", "modified", "committed.ts"));
		const diff = store.getState().changes?.diff;
		expect(diff?.outcome === "read" && diff.file?.path).toBe("committed.ts");
	});

	test("choosing Uncommitted reads that list afresh, and is remembered for the worktree after a restart", async () => {
		const engine = createMockEngine();
		engine.setFileChanges(FEATURE.path, [mock(file("base", "modified", "committed.ts")), mock(file("unstaged", "modified", "b.ts"))]);
		const store = await started(engine);
		await store.readChanges(TIMBER, FEATURE.id);
		await store.selectChangedFile(file("base", "modified", "committed.ts"));
		await store.compareChanges("uncommitted");
		// The diff tab showed a file of the other list, so it closed.
		expect(store.getState().changes).toMatchObject({ compared: "uncommitted", files: [named("unstaged", "modified", "b.ts")], selected: null });
		expect(store.getState().diffs).toEqual({});
		expect(store.getState().layout.uncommittedChanges).toEqual([FEATURE.id]);
		await settle();
		expect((await engine.loadLayout()).uncommittedChanges).toEqual([FEATURE.id]);

		const again = await started(engine);
		await again.readChanges(TIMBER, FEATURE.id);
		expect(again.getState().changes?.compared).toBe("uncommitted");
		// Another worktree keeps comparing with its base.
		await again.compareChanges("base");
		expect(again.getState().changes?.compared).toBe("base");
		expect(again.getState().layout.uncommittedChanges).toEqual([]);
	});

	test("a worktree with no saved base shows Uncommitted, with Base disabled and the reason", async () => {
		const store = await started();
		store.select(MAIN.id);
		store.showSidePanel("changes");
		await store.readChanges(TIMBER, MAIN.id);
		expect(store.getState().changes).toMatchObject({ compared: "uncommitted", base: { usable: false, reason: "Timber has no base saved for this worktree." }, problem: null });
		await store.compareChanges("base");
		expect(store.getState().changes).toMatchObject({ compared: "uncommitted", problem: null });
		const markup = render(store);
		expect(markup).toContain("Base is not available: Timber has no base saved for this worktree.");
		expect(markup).toMatch(/<input class="mode-radio" type="radio" disabled="" name="[^"]*"\/><span class="mode-label">Base<\/span>/);
		expect(markup).toMatch(/<input class="mode-radio" type="radio" name="[^"]*" checked=""\/><span class="mode-label">Uncommitted<\/span>/);
		expect(markup).toContain("This worktree matches its last commit.");
	});

	test("the gallery lists conflicts, changed, and untracked files, under a header that names the base and the branch point", async () => {
		const store = await started();
		const { repository, worktree } = find(store.getState().repositories, GALLERY_WORKTREE);
		store.select(worktree.id);
		store.showSidePanel("changes");
		await store.readChanges(repository.path, worktree.id);
		const markup = render(store);
		const titles = [...markup.matchAll(/<h3 class="change-group-title">([^<]+)<span class="change-group-count">(\d+)<\/span><\/h3>/g)].map(match => `${match[1]} ${match[2]}`);
		expect(titles).toEqual(["Merge conflicts 1", "Changed 13", "Untracked 5"]);
		expect(markup).toContain(`>origin/main @ ${MOCK_BRANCH_POINT.slice(0, 7)}</span>`);
		expect(markup).toContain('aria-label="src/tax/report.ts, Modified, Changed, 2 lines added, 1 removed"');
		expect(markup).not.toContain("Base is not available");

		await store.selectChangedFile(file("base", "modified", "src/generated/rows.ts"));
		const large = render(store);
		expect(large).toContain("Modified since the base");
		expect(large).toContain(`Run git diff ${MOCK_BRANCH_POINT} -- src/generated/rows.ts in a terminal to see it.`);
	});
});

describe("words of comparing with the base", () => {
	const usable = { usable: true as const, ref: "refs/remotes/origin/main", name: "origin/main", commit: MOCK_BRANCH_POINT };

	test("the header names the base and the branch point, or the last commit", () => {
		expect(describeComparison("base", usable).text).toBe("origin/main @ a1b2c3d");
		expect(describeComparison("uncommitted", usable).text).toBe("Last commit");
		expect(describeComparison("base", { usable: false, reason: "No base." }).text).toBe("Last commit");
		expect(baseUnavailable(usable)).toBeNull();
		expect(baseUnavailable(null)).toBeNull();
		expect(baseUnavailable({ usable: false, reason: "Timber has no base saved for this worktree." })).toBe("Base is not available: Timber has no base saved for this worktree.");
	});

	test("a commit base that is the branch point shows once, and one the branch left earlier shows both", () => {
		const atCommit = { usable: true as const, ref: MOCK_BRANCH_POINT, name: "a1b2c3d", commit: MOCK_BRANCH_POINT };
		expect(describeComparison("base", atCommit)).toEqual({ text: "a1b2c3d", title: "Everything this branch changed since commit a1b2c3d, its saved base, committed or not." });
		expect(describeNoChanges("base", atCommit)).toBe("This branch matches commit a1b2c3d, its saved base. Nothing is untracked.");

		const leftEarlier = { usable: true as const, ref: "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432", name: "9f8e7d6", commit: MOCK_BRANCH_POINT };
		expect(describeComparison("base", leftEarlier)).toEqual({
			text: "9f8e7d6 @ a1b2c3d",
			title: "Everything this branch changed since it left the history of commit 9f8e7d6 at a1b2c3d, committed or not. Commits between a1b2c3d and 9f8e7d6 are left out.",
		});
		expect(describeNoChanges("base", leftEarlier)).toBe("This branch matches a1b2c3d, where it left the history of commit 9f8e7d6. Nothing is untracked.");
	});

	test("counts, commands, and the empty list speak of the base", () => {
		expect(describeFileCounts([file("base", "modified", "a.ts"), file("untracked", "untracked", "n.ts"), file("conflicted", "conflicted", "c.ts")], false)).toBe("1 conflicted, 1 changed, 1 untracked");
		expect(diffCommand(file("base", "renamed", "new.ts", "old.ts"), MOCK_BRANCH_POINT)).toBe(`git diff ${MOCK_BRANCH_POINT} -- old.ts new.ts`);
		expect(diffCommand(file("untracked", "untracked", "n.ts"), MOCK_BRANCH_POINT)).toBe("git diff --no-index -- /dev/null n.ts");
		expect(describeNoChanges("base", usable)).toBe("This branch matches origin/main at a1b2c3d, where it started. Nothing is untracked.");
		expect(describeFileArea(file("base", "deleted", "a.ts"))).toBe("Deleted since the base");
		expect(describeFileArea(file("untracked", "untracked", "a.ts"))).toBe("Untracked");
		expect(describeFileArea(file("staged", "added", "a.ts"))).toBe("Added, staged");
	});
});
