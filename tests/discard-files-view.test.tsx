import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { describeAlsoUnstaged, describeDiscardEffect, describeDiscardTitle, describeDiscarded, discardSubmitLabel } from "../src/mainview/discard-format";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { type MockFileChange, answerMockDiscard, sampleNewFilePatch, samplePatch } from "../src/mainview/engine/mock-file-changes";
import { createAppStore } from "../src/mainview/store/store";
import type { FileChange } from "../src/shared/file-changes";
import { defaultLayout } from "../src/shared/layout";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const FEATURE = sampleRepositories[0]!.worktrees[1]!;

const change = (area: FileChange["area"], kind: FileChange["kind"], path: string, previousPath: string | null = null): FileChange =>
	({ area, kind, path, previousPath, added: null, removed: null, version: "" });
const mock = (file: FileChange): MockFileChange => ({ change: file, patch: file.kind === "untracked" || file.kind === "added" ? sampleNewFilePatch(file.path) : samplePatch(file.path) });
const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);
const listed = (store: ReturnType<typeof createAppStore>) => (store.getState().changes?.files ?? []).map(file => `${file.area} ${file.kind} ${file.path}`);

const FILES = [
	change("conflicted", "conflicted", "src/rates.ts"),
	change("staged", "modified", "src/rules.ts"),
	change("staged", "renamed", "src/brackets.ts", "src/bands.ts"),
	change("unstaged", "modified", "src/rules.ts"),
	change("unstaged", "modified", "src/total.ts"),
	change("untracked", "untracked", "notes/todo.md"),
	change("untracked", "untracked", "nested/"),
];

/** The feature worktree selected with the Changes view shown, comparing `compare`, its list read with or without a commit. */
async function started(compare: "uncommitted" | "base" = "uncommitted", { hasCommit = true }: { hasCommit?: boolean } = {}) {
	const engine = createMockEngine();
	await engine.saveLayout({ ...defaultLayout(), ...(compare === "uncommitted" ? { uncommittedChanges: [FEATURE.id] } : {}) });
	engine.setFileChanges(FEATURE.path, FILES.map(mock));
	if (!hasCommit) {
		const read = engine.readFileChanges.bind(engine);
		engine.readFileChanges = async request => {
			const answer = await read(request);
			return answer.outcome === "read" ? { ...answer, hasCommit: false } : answer;
		};
	}
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	store.select(FEATURE.id);
	store.showSidePanel("changes");
	await store.readChanges(TIMBER, FEATURE.id);
	return { engine, store };
}

const file = (store: ReturnType<typeof createAppStore>, area: FileChange["area"], path: string) =>
	store.getState().changes!.files!.find(candidate => candidate.area === area && candidate.path === path)!;

describe("the words of Discard", () => {
	test("the dialog's title, effect, and button say what happens to the files", () => {
		expect(describeDiscardTitle([change("unstaged", "modified", "a.ts")])).toBe("Discard changes to a.ts?");
		expect(describeDiscardTitle([change("staged", "modified", "a.ts"), change("staged", "added", "b.ts")])).toBe("Discard staged changes to 2 files?");
		expect(describeDiscardTitle([change("untracked", "untracked", "a.ts")])).toBe("Delete a.ts?");
		expect(describeDiscardTitle([change("untracked", "untracked", "a.ts"), change("untracked", "untracked", "b.ts")])).toBe("Delete 2 untracked files?");
		expect(discardSubmitLabel("untracked")).toBe("Delete");
		expect(discardSubmitLabel("staged")).toBe("Discard");
		for (const area of ["unstaged", "staged", "untracked"] as const) expect(describeDiscardEffect(area, 1)).toEndWith("This cannot be undone.");
		expect(describeDiscardEffect("untracked", 2)).toContain("Their folders stay");
		expect(describeAlsoUnstaged(["a.ts"])).toBe("a.ts also has unstaged changes. They are lost too.");
		expect(describeAlsoUnstaged([])).toBeNull();
		expect(describeDiscarded([change("untracked", "untracked", "a.ts")])).toBe("Deleted a.ts");
		expect(describeDiscarded([change("unstaged", "modified", "a.ts"), change("unstaged", "modified", "b.ts")])).toBe("Discarded changes to 2 files");
	});
});

describe("discarding from the Changes view", () => {
	test("each unstaged, staged, and untracked row and group has Discard with its command; conflicts and folders have none", async () => {
		const { store } = await started();
		const markup = render(store);
		expect(markup).toContain(`title="Runs git restore --worktree -- src/total.ts" aria-label="Discard src/total.ts"`);
		expect(markup).toContain(`title="Runs git restore --staged --worktree --source=HEAD -- src/bands.ts src/brackets.ts" aria-label="Discard src/brackets.ts"`);
		expect(markup).toContain(`title="Runs git clean -f -- notes/todo.md" aria-label="Discard notes/todo.md"`);
		expect(markup).not.toContain(`aria-label="Discard src/rates.ts"`);
		expect(markup).not.toContain(`aria-label="Discard nested/"`);
		expect(markup).toContain(`aria-label="Discard all: 2 files in Unstaged"`);
		expect(markup).toContain(`aria-label="Discard all: 2 files in Staged"`);
		// The group's Discard all leaves the folder out.
		expect(markup).toContain(`title="Runs git clean -f -- notes/todo.md" aria-label="Discard all: 1 file in Untracked"`);
		expect(markup).not.toContain("Discard all: 1 file in Merge conflicts");
		expect(markup).toMatch(/class="change-file[^"]*"[^>]*aria-keyshortcuts="Space Delete"/);
	});

	test("staged files have no Discard before the first commit, and Base has none at all", async () => {
		const { store } = await started("uncommitted", { hasCommit: false });
		expect(store.getState().changes?.hasCommit).toBe(false);
		const markup = render(store);
		// The unstaged src/rules.ts keeps its Discard; the staged one has none.
		expect(markup).not.toContain("--source=HEAD");
		expect(markup).not.toContain("Discard all: 2 files in Staged");
		expect(markup).toContain(`aria-label="Discard src/total.ts"`);
		expect(await store.discardFiles([file(store, "staged", "src/rules.ts")])).toBeNull();
		const base = await started("base");
		expect(render(base.store)).not.toContain("Discard");
		expect(await base.store.discardFiles([file(base.store, "untracked", "notes/todo.md")])).toBeNull();
	});

	test("Discard opens the dialog with the files and the command, and nothing runs until it is confirmed", async () => {
		const { engine, store } = await started();
		store.openDialog({ kind: "discard-files", repository: TIMBER, worktree: FEATURE.id, files: [file(store, "staged", "src/rules.ts")] });
		const markup = render(store);
		expect(markup).toContain("Discard staged changes to src/rules.ts?");
		expect(markup).toContain(`<pre class="dialog-command" aria-label="Command that will run">git restore --staged --worktree --source=HEAD -- src/rules.ts</pre>`);
		expect(markup).toContain("src/rules.ts also has unstaged changes. They are lost too.");
		expect(markup).toContain("This cannot be undone.");
		expect(markup).toMatch(/<button type="button" class="button quiet"[^>]*>Cancel<\/button>/);
		store.closeDialog();
		expect(engine.indexWrites()).toEqual([]);
		expect(listed(store)).toContain("staged modified src/rules.ts");
	});

	test("an unstaged discard keeps what is staged; a staged one takes the file's unstaged entry too; an untracked one is gone", async () => {
		const { engine, store } = await started();
		expect(await store.discardFiles([file(store, "unstaged", "src/total.ts")])).toEqual({ outcome: "written", command: "git restore --worktree -- src/total.ts" });
		expect(listed(store)).not.toContain("unstaged modified src/total.ts");
		expect(await store.discardFiles([file(store, "staged", "src/rules.ts")])).toEqual({ outcome: "written", command: "git restore --staged --worktree --source=HEAD -- src/rules.ts" });
		expect(listed(store).filter(line => line.endsWith(" src/rules.ts"))).toEqual([]);
		await store.discardFiles([file(store, "untracked", "notes/todo.md")]);
		expect(listed(store)).not.toContain("untracked untracked notes/todo.md");
		expect(engine.indexWrites().map(write => write.command)).toEqual([
			"git restore --worktree -- src/total.ts",
			"git restore --staged --worktree --source=HEAD -- src/rules.ts",
			"git clean -f -- notes/todo.md",
		]);
		expect(store.getState().changes?.writing).toBe(false);
	});

	test("the store refuses conflicts, folders, and files not listed, without running anything", async () => {
		const { engine, store } = await started();
		expect(await store.discardFiles([file(store, "conflicted", "src/rates.ts")])).toBeNull();
		expect(await store.discardFiles([file(store, "untracked", "nested/")])).toBeNull();
		expect(await store.discardFiles([change("unstaged", "modified", "not/listed.ts")])).toBeNull();
		expect(await store.discardFiles([])).toBeNull();
		expect(engine.indexWrites()).toEqual([]);
	});

	test("a failure comes back with Git's message and changes nothing", async () => {
		const { engine, store } = await started();
		const before = listed(store);
		engine.failIndexWrites("fatal: Unable to create '/work/.git/index.lock': File exists.");
		expect(await store.discardFiles([file(store, "unstaged", "src/total.ts")]))
			.toEqual({ outcome: "failed", command: "git restore --worktree -- src/total.ts", message: "fatal: Unable to create '/work/.git/index.lock': File exists." });
		expect(listed(store)).toEqual(before);
	});

	/** The disk as the File tab reads it: `src/total.ts` holds `text` until a discard, then `after`; `notes/todo.md` is gone after its discard. */
	function disk(engine: ReturnType<typeof createMockEngine>) {
		const discarded = new Set<string>();
		const discard = engine.discardFiles.bind(engine);
		engine.discardFiles = async request => {
			const answer = await discard(request);
			if (answer.outcome === "written") for (const target of request.files) discarded.add(target.path);
			return answer;
		};
		engine.readWorktreeFile = async request => {
			if (request.path === "notes/todo.md" && discarded.has(request.path)) return { outcome: "missing", path: request.path, message: "Nothing is at notes/todo.md." };
			const text = discarded.has(request.path) ? "as committed\n" : "edited on disk\n";
			return { outcome: "read", path: request.path, content: { kind: "text", text, lines: 1 } };
		};
	}

	test("a file open with unsaved edits is named in the dialog, drops them after the discard, and shows the file as it is on disk", async () => {
		const { engine, store } = await started();
		disk(engine);
		store.openFile(FEATURE.id, "src/total.ts");
		await settle();
		expect(store.getState().files[FEATURE.id]?.result).toMatchObject({ content: { text: "edited on disk\n" } });
		store.editFile(FEATURE.id);
		store.changeDraft(FEATURE.id, "unsaved text\n");
		expect(store.getState().files[FEATURE.id]?.draft).toBe("unsaved text\n");
		store.openDialog({ kind: "discard-files", repository: TIMBER, worktree: FEATURE.id, files: [file(store, "unstaged", "src/total.ts")] });
		expect(render(store)).toContain("src/total.ts is open in the editor with unsaved edits. They are lost too");
		store.closeDialog();
		await store.discardFiles([file(store, "unstaged", "src/total.ts")]);
		await settle();
		const open = store.getState().files[FEATURE.id]!;
		expect(open.draft).toBeNull();
		expect(open.result).toMatchObject({ outcome: "read", content: { text: "as committed\n" } });
	});

	test("a failed discard keeps the open file's unsaved edits", async () => {
		const { engine, store } = await started();
		disk(engine);
		store.openFile(FEATURE.id, "src/total.ts");
		await settle();
		store.editFile(FEATURE.id);
		store.changeDraft(FEATURE.id, "unsaved text\n");
		engine.failIndexWrites("fatal: Unable to create '/work/.git/index.lock': File exists.");
		await store.discardFiles([file(store, "unstaged", "src/total.ts")]);
		await settle();
		expect(store.getState().files[FEATURE.id]?.draft).toBe("unsaved text\n");
	});

	test("an open untracked file that is deleted shows as missing", async () => {
		const { engine, store } = await started();
		disk(engine);
		store.openFile(FEATURE.id, "notes/todo.md");
		await settle();
		expect(store.getState().files[FEATURE.id]?.result?.outcome).toBe("read");
		await store.discardFiles([file(store, "untracked", "notes/todo.md")]);
		await settle();
		expect(store.getState().files[FEATURE.id]?.result?.outcome).toBe("missing");
	});

	test("the mock refuses a conflict and a command other than the one shown, as the main process does", () => {
		const all = FILES.map(mock);
		const conflict = [change("conflicted", "conflicted", "src/rates.ts")];
		expect(answerMockDiscard(all, { repository: TIMBER, worktree: FEATURE.path, files: conflict, shown: ["restore", "--worktree", "--", "src/rates.ts"] }).result)
			.toEqual({ outcome: "refused", message: "src/rates.ts is no longer a change that can be discarded in this worktree. Nothing was discarded." });
		const total = [change("unstaged", "modified", "src/total.ts")];
		expect(answerMockDiscard(all, { repository: TIMBER, worktree: FEATURE.path, files: total, shown: ["checkout", "--", "src/total.ts"] }).result.outcome).toBe("refused");
	});
});
