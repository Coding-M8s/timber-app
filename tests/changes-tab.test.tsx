import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import {
	MORE_FILES_NOTE, describeDiffNotice, describeFileCounts, diffCommand, fileAfterKey, groupFileChanges, listedOrder, splitPath,
} from "../src/mainview/changes-format";
import { FOLDER_MISSING_CHANGES } from "../src/mainview/components/ChangesPanel";
import { browserSampleRepositories, createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { GALLERY_WORKTREE, type MockFileChange, sampleNewFilePatch, samplePatch } from "../src/mainview/engine/mock-file-changes";
import { createAppStore } from "../src/mainview/store/store";
import type { Engine } from "../src/shared/engine";
import type { FileChange, FileChangesResult, FileDiffResult } from "../src/shared/file-changes";
import type { Repository } from "../src/shared/model";

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

const file = (area: FileChange["area"], kind: FileChange["kind"], path: string, previousPath: string | null = null): FileChange => ({ area, kind, path, previousPath });
const mock = (change: FileChange, patch = samplePatch(change.path)): MockFileChange => ({ change, patch });

describe("the store's Changes view", () => {
	test("reads the files, selects the first one as listed, and reads its diff", async () => {
		const engine = createMockEngine();
		engine.setFileChanges(FEATURE.path, [
			mock(file("unstaged", "modified", "b.ts")),
			mock(file("staged", "added", "a.ts"), sampleNewFilePatch("a.ts")),
		]);
		const store = await started(engine);
		await store.readChanges(TIMBER, FEATURE.id);
		const view = store.getState().changes!;
		expect(view.files?.map(entry => `${entry.area} ${entry.path}`)).toEqual(["unstaged b.ts", "staged a.ts"]);
		// Staged shows before unstaged, so it is the first file listed.
		expect(view.selected).toEqual({ area: "staged", path: "a.ts", previousPath: null });
		expect(view.diff?.outcome === "read" && view.diff.diff.kind).toBe("text");
		expect(store.getState().operations).toEqual([]);
	});

	test("keeps the selected file across reads while it is listed, and moves to the first when it is gone", async () => {
		const engine = createMockEngine();
		const a = mock(file("unstaged", "modified", "a.ts"));
		const b = mock(file("unstaged", "modified", "b.ts"));
		engine.setFileChanges(FEATURE.path, [a, b]);
		const store = await started(engine);
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

		engine.setFileChanges(FEATURE.path, [a]);
		await store.readChanges(TIMBER, FEATURE.id);
		expect(store.getState().changes?.selected?.path).toBe("a.ts");

		engine.setFileChanges(FEATURE.path, []);
		await store.readChanges(TIMBER, FEATURE.id);
		expect(store.getState().changes).toMatchObject({ files: [], selected: null, diff: null });
	});

	test("ignores a file that is not in the list", async () => {
		const engine = createMockEngine();
		engine.setFileChanges(FEATURE.path, [mock(file("unstaged", "modified", "a.ts"))]);
		const store = await started(engine);
		await store.readChanges(TIMBER, FEATURE.id);
		await store.selectChangedFile({ area: "staged", path: "a.ts", previousPath: null });
		await store.selectChangedFile({ area: "unstaged", path: "../outside", previousPath: null });
		expect(store.getState().changes?.selected).toEqual({ area: "unstaged", path: "a.ts", previousPath: null });
	});

	test("a failed read keeps the last good list beside the reason, until a read works", async () => {
		const engine = createMockEngine();
		engine.setFileChanges(FEATURE.path, [mock(file("unstaged", "modified", "a.ts"))]);
		const store = await started(engine);
		await store.readChanges(TIMBER, FEATURE.id);
		engine.failFileChanges("Git is busy");
		await store.readChanges(TIMBER, FEATURE.id);
		expect(store.getState().changes).toMatchObject({ problem: "Git is busy", files: [file("unstaged", "modified", "a.ts")] });
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
		pending[1]!({ outcome: "read", files: [file("unstaged", "modified", "new.ts")], more: false });
		await settle();
		pending[0]!({ outcome: "read", files: [file("unstaged", "modified", "old.ts")], more: false });
		await first;
		expect(store.getState().changes?.files?.map(entry => entry.path)).toEqual(["new.ts"]);

		// Another worktree starts afresh, and the first one's diff answering late changes nothing.
		const third = store.readChanges(TIMBER, main.id);
		expect(store.getState().changes).toMatchObject({ worktree: main.id, files: null, selected: null });
		diffs[0]!({ outcome: "read", file: file("unstaged", "modified", "new.ts"), diff: { kind: "binary" } });
		await second;
		expect(store.getState().changes).toMatchObject({ worktree: main.id, diff: null });
		pending[2]!({ outcome: "read", files: [], more: false });
		await third;
		expect(store.getState().changes).toMatchObject({ worktree: main.id, files: [] });
	});
});

describe("the Changes tab", () => {
	async function gallery() {
		const store = await started();
		const { repository, worktree } = find(store.getState().repositories, GALLERY_WORKTREE);
		store.select(worktree.id);
		store.showTab("changes");
		await store.readChanges(repository.path, worktree.id);
		return store;
	}

	test("lists conflicts, staged, and unstaged files apart, each with its letter", async () => {
		const markup = render(await gallery());
		const titles = [...markup.matchAll(/<h2 class="change-group-title">([^<]+)<span class="change-group-count">(\d+)<\/span><\/h2>/g)].map(match => `${match[1]} ${match[2]}`);
		expect(titles).toEqual(["Merge conflicts 1", "Staged 4", "Unstaged 12"]);
		expect(markup).toContain("1 conflicted, 4 staged, 12 unstaged");
		expect(markup).toContain('aria-label="src/tax/brackets.ts, Renamed from src/tax/bands.ts, Staged"');
		expect(markup).toContain('aria-label="src/tax/zażółć.ts, Untracked, Unstaged"');
		for (const letter of ["!", "M", "R", "A", "D", "T", "U"]) expect(markup).toContain(`aria-hidden="true">${letter}</span>`);
		// The first file listed is selected, and it is the only tab stop of the list.
		expect(markup.match(/class="change-file selected"/g)).toHaveLength(1);
		expect(markup.match(/class="change-file( selected)?" aria-current="true"[^>]*tabindex="0"/g)).toHaveLength(1);
		expect(markup).toContain('aria-label="Diff of src/tax/rates.ts"');
	});

	test("draws a diff with line numbers and markers", async () => {
		const store = await gallery();
		await store.selectChangedFile(file("staged", "modified", "src/tax/rules.ts"));
		const markup = render(store);
		expect(markup).toContain('<div class="diff-hunk-header">@@ -1,6 +1,7 @@</div>');
		expect(markup).toContain('<div class="diff-line removed"><span class="diff-number">3</span><span class="diff-number"></span><span class="diff-marker" aria-hidden="true">-</span><span class="diff-text">export const retries = 3;</span></div>');
		expect(markup).toContain('<div class="diff-line added"><span class="diff-number"></span><span class="diff-number">3</span><span class="diff-marker" aria-hidden="true">+</span><span class="diff-text">export const retries = 5;</span></div>');
	});

	test("shows a notice for binary, very large, and empty files, and a rename's header", async () => {
		const store = await gallery();
		const shown = async (change: FileChange) => {
			await store.selectChangedFile(change);
			return render(store);
		};
		expect(await shown(file("unstaged", "modified", "assets/logo.png"))).toContain("Binary file");
		expect(await shown(file("unstaged", "untracked", "assets/icon.ico"))).toContain("Binary file");
		const large = await shown(file("unstaged", "modified", "src/generated/rows.ts"));
		expect(large).toContain("This diff is too large to show");
		expect(large).toContain("It is 6,005 lines, more than 5,000. Run git diff -- src/generated/rows.ts in a terminal to see it.");
		expect(large).not.toContain("diff-line");
		expect(await shown(file("unstaged", "untracked", "notes/empty.txt"))).toContain("Empty file");
		const renamed = await shown(file("staged", "renamed", "src/tax/brackets.ts", "src/tax/bands.ts"));
		expect(renamed).toContain("<div>rename from src/tax/bands.ts</div>");
		expect(renamed).toContain('<span class="diff-previous">src/tax/bands.ts → </span>src/tax/brackets.ts');
	});

	test("offers Open in editor for the selected file with its exact command, but not for a deleted file", async () => {
		const store = await gallery();
		await store.savePreferences({ editor: { command: "code", terminal: false } });
		await store.selectChangedFile(file("unstaged", "untracked", "src/tax/new rules.ts"));
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
		store.showTab("changes");
		engine.failFileChanges("Git is busy");
		await store.readChanges(repository.path, worktree.id);
		const markup = render(store);
		expect(markup).toContain("Could not read the changes");
		expect(markup).toContain("Git is busy");
	});

	test("says there are no changes for a clean worktree, and does not read a missing folder", async () => {
		const store = await started();
		store.showTab("changes");
		const main = sampleRepositories[0]!.worktrees[0]!;
		await store.readChanges(TIMBER, main.id);
		expect(render(store)).toContain("This worktree matches its last commit.");

		const { worktree } = find(store.getState().repositories, "/work/api-server-worktrees/old-removed-folder");
		store.select(worktree.id);
		expect(render(store)).toContain(escaped(FOLDER_MISSING_CHANGES));
	});

	test("says when only some files are listed", async () => {
		const engine = createMockEngine();
		engine.setFileChanges(FEATURE.path, Array.from({ length: 5001 }, (_, index) => mock(file("unstaged", "untracked", `n/${index}.ts`), sampleNewFilePatch(`n/${index}.ts`))));
		const store = await started(engine);
		store.select(FEATURE.id);
		store.showTab("changes");
		await store.readChanges(TIMBER, FEATURE.id);
		const markup = render(store);
		expect(markup).toContain(MORE_FILES_NOTE);
		expect(markup).toContain("5000 unstaged, and more");
	});
});

describe("words and keys of the Changes tab", () => {
	const files = [file("unstaged", "modified", "z.ts"), file("staged", "added", "a.ts"), file("conflicted", "conflicted", "c.ts"), file("unstaged", "untracked", "n.ts")];

	test("groups conflicts, then staged, then unstaged, and leaves out empty groups", () => {
		expect(groupFileChanges(files).map(group => [group.area, group.files.map(entry => entry.path)])).toEqual([
			["conflicted", ["c.ts"]], ["staged", ["a.ts"]], ["unstaged", ["z.ts", "n.ts"]],
		]);
		expect(groupFileChanges([files[0]!]).map(group => group.area)).toEqual(["unstaged"]);
		expect(describeFileCounts(files, false)).toBe("1 conflicted, 1 staged, 2 unstaged");
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
		expect(diffCommand(file("unstaged", "untracked", "n.ts"))).toBe("git diff --no-index -- /dev/null n.ts");
	});

	test("says nothing extra for a diff with lines or a header", () => {
		const modified = file("unstaged", "modified", "a.ts");
		expect(describeDiffNotice({ kind: "text", sections: [{ header: [], hunks: [{ header: "@@ -1 +1 @@", lines: [] }] }] }, modified)).toBeNull();
		expect(describeDiffNotice({ kind: "text", sections: [{ header: ["old mode 100644", "new mode 100755"], hunks: [] }] }, modified)).toBeNull();
		expect(describeDiffNotice({ kind: "text", sections: [] }, modified)?.title).toBe("No line changes");
		expect(describeDiffNotice({ kind: "too-large", lines: null }, modified)?.text).toBe("It is more than 512 KiB. Run git diff -- a.ts in a terminal to see it.");
		expect(describeDiffNotice({ kind: "unchanged" }, modified)?.title).toBe("No longer changed");
	});
});
