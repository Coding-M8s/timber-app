import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { fileIndexAction, groupIndexAction, movedEntry } from "../src/mainview/changes-format";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { type MockFileChange, answerMockIndexWrite, sampleNewFilePatch, samplePatch } from "../src/mainview/engine/mock-file-changes";
import { createAppStore } from "../src/mainview/store/store";
import type { FileChange } from "../src/shared/file-changes";
import { indexCommand } from "../src/shared/index-writes";
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
	change("unstaged", "deleted", "docs/old.md"),
	change("untracked", "untracked", "notes/todo.md"),
];

/** The feature worktree selected with the Changes view shown, comparing `compare`. */
async function started(compare: "uncommitted" | "base" = "uncommitted") {
	const engine = createMockEngine();
	await engine.saveLayout({ ...defaultLayout(), ...(compare === "uncommitted" ? { uncommittedChanges: [FEATURE.id] } : {}) });
	engine.setFileChanges(FEATURE.path, FILES.map(mock));
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

describe("the words of Stage and Unstage", () => {
	test("a file says Stage, Unstage, or Mark resolved, and a group the same for all; Base's Changed has none", () => {
		expect(fileIndexAction({ area: "unstaged" })).toEqual({ action: "stage", label: "Stage" });
		expect(fileIndexAction({ area: "untracked" })).toEqual({ action: "stage", label: "Stage" });
		expect(fileIndexAction({ area: "conflicted" })).toEqual({ action: "stage", label: "Mark resolved" });
		expect(fileIndexAction({ area: "staged" })).toEqual({ action: "unstage", label: "Unstage" });
		expect(fileIndexAction({ area: "base" })).toBeNull();
		expect(groupIndexAction("conflicted")?.label).toBe("Mark all resolved");
		expect(groupIndexAction("untracked")?.label).toBe("Stage all");
		expect(groupIndexAction("staged")?.label).toBe("Unstage all");
		expect(groupIndexAction("base")).toBeNull();
	});

	test("after a write the keyboard finds the file by path, first in the list's order", () => {
		const after = [change("staged", "added", "a.ts"), change("unstaged", "modified", "b.ts"), change("staged", "modified", "b.ts")];
		expect(movedEntry(after, "b.ts")).toEqual(change("staged", "modified", "b.ts"));
		expect(movedEntry(after, "gone.ts")).toBeUndefined();
	});
});

describe("staging and unstaging from the Changes view", () => {
	test("each row and group of Uncommitted has its button, with the command it runs as its tooltip", async () => {
		const { store } = await started();
		const markup = render(store);
		expect(markup).toContain(`title="Runs git add -- src/rates.ts" aria-label="Mark resolved src/rates.ts"`);
		expect(markup).toContain(`title="Runs git add -- src/total.ts" aria-label="Stage src/total.ts"`);
		expect(markup).toContain(`title="Runs git restore --staged -- src/bands.ts src/brackets.ts" aria-label="Unstage src/brackets.ts"`);
		expect(markup).toContain(`title="Runs git add -- src/rules.ts src/total.ts docs/old.md" aria-label="Stage all: 3 files in Unstaged"`);
		expect(markup).toContain(`aria-label="Mark all resolved: 1 file in Merge conflicts"`);
		expect(markup).toContain(`aria-label="Unstage all: 2 files in Staged"`);
		expect(markup).toContain(`aria-label="Stage all: 1 file in Untracked"`);
		expect(markup).toMatch(/class="change-file[^"]*"[^>]*aria-keyshortcuts="Space"/);
	});

	test("Base mode is review only: no write buttons and no Space", async () => {
		const { store } = await started("base");
		expect(store.getState().changes?.compared).toBe("base");
		const markup = render(store);
		expect(markup).toContain("change-file");
		expect(markup).not.toContain("change-file-action");
		expect(markup).not.toContain("change-group-action");
		expect(markup).not.toMatch(/class="change-file[^"]*"[^>]*aria-keyshortcuts/);
		// And the store refuses to write from it.
		expect(await store.writeIndex("stage", [file(store, "untracked", "notes/todo.md")])).toBeNull();
	});

	test("stages a file, which reads the list again with it in Staged", async () => {
		const { engine, store } = await started();
		const result = await store.writeIndex("stage", [file(store, "unstaged", "src/total.ts")]);
		expect(result).toEqual({ outcome: "written", command: "git add -- src/total.ts" });
		expect(listed(store)).toContain("staged modified src/total.ts");
		expect(listed(store)).not.toContain("unstaged modified src/total.ts");
		expect(engine.indexWrites()).toEqual([{ worktree: FEATURE.path, command: "git add -- src/total.ts" }]);
		expect(store.getState().changes?.writing).toBe(false);
	});

	test("stages a whole group, and unstages one, a rename coming back as a deletion and a new file", async () => {
		const { store } = await started();
		await store.writeIndex("stage", store.getState().changes!.files!.filter(candidate => candidate.area === "untracked"));
		expect(listed(store)).toContain("staged added notes/todo.md");
		await store.writeIndex("unstage", store.getState().changes!.files!.filter(candidate => candidate.area === "staged"));
		expect(listed(store).filter(line => line.startsWith("staged"))).toEqual([]);
		expect(listed(store)).toEqual(expect.arrayContaining(["unstaged deleted src/bands.ts", "untracked untracked src/brackets.ts", "untracked untracked notes/todo.md", "unstaged modified src/rules.ts"]));
	});

	test("Mark resolved moves a conflicted file out of Merge conflicts", async () => {
		const { store } = await started();
		await store.writeIndex("stage", [file(store, "conflicted", "src/rates.ts")]);
		expect(listed(store).filter(line => line.startsWith("conflicted"))).toEqual([]);
		expect(listed(store)).toContain("staged modified src/rates.ts");
		expect(render(store)).not.toContain("Merge conflicts");
	});

	test("a failure shows Git's message and the command, and changes nothing; the next write that works clears it", async () => {
		const { engine, store } = await started();
		const before = listed(store);
		engine.failIndexWrites("fatal: Unable to create '/work/.git/index.lock': File exists.");
		const result = await store.writeIndex("stage", [file(store, "unstaged", "src/total.ts")]);
		expect(result).toEqual({ outcome: "failed", command: "git add -- src/total.ts", message: "fatal: Unable to create '/work/.git/index.lock': File exists." });
		expect(listed(store)).toEqual(before);
		expect(store.getState().changes?.writeProblem).toEqual({ action: "stage", command: "git add -- src/total.ts", message: "fatal: Unable to create '/work/.git/index.lock': File exists." });
		const markup = render(store);
		expect(markup).toContain("Could not stage");
		expect(markup).toContain("index.lock&#x27;: File exists.");
		engine.failIndexWrites(null);
		await store.writeIndex("stage", [file(store, "unstaged", "src/total.ts")]);
		expect(store.getState().changes?.writeProblem).toBeNull();
	});

	test("the store writes only files listed in a group that takes the action", async () => {
		const { engine, store } = await started();
		expect(await store.writeIndex("stage", [change("unstaged", "modified", "not/listed.ts")])).toBeNull();
		expect(await store.writeIndex("unstage", [file(store, "unstaged", "src/total.ts")])).toBeNull();
		expect(await store.writeIndex("stage", [])).toBeNull();
		expect(engine.indexWrites()).toEqual([]);
	});

	test("the mock refuses a path not in its list, and a command other than the one shown, as the main process does", () => {
		const all = FILES.map(mock);
		const missing = [change("unstaged", "modified", "nowhere.ts")];
		expect(answerMockIndexWrite(all, "stage", { repository: TIMBER, worktree: FEATURE.path, files: missing, shown: indexCommand("stage", missing, true).args }))
			.toEqual({ result: { outcome: "refused", message: "nowhere.ts is no longer a change that can be staged in this worktree. Nothing was staged." }, files: null });
		const total = [change("unstaged", "modified", "src/total.ts")];
		expect(answerMockIndexWrite(all, "stage", { repository: TIMBER, worktree: FEATURE.path, files: total, shown: ["add", "--", "other.ts"] }).result.outcome).toBe("refused");
	});

	test("the diff tab of a file just staged stays open, on its staged entry", async () => {
		const { store } = await started();
		await store.selectChangedFile(file(store, "unstaged", "src/total.ts"));
		expect(store.getState().tab).toBe("diff");
		await store.writeIndex("stage", [file(store, "unstaged", "src/total.ts")]);
		expect(store.getState().tab).toBe("diff");
		expect(store.getState().diffs[FEATURE.id]?.file).toEqual({ area: "staged", path: "src/total.ts", previousPath: null });
		expect(store.getState().changes?.selected).toEqual({ area: "staged", path: "src/total.ts", previousPath: null });
	});

	test("a read the watcher starts while the write runs does not lose the diff tab, and the list counts the write once it is read again", async () => {
		const { store } = await started();
		await store.selectChangedFile(file(store, "unstaged", "src/total.ts"));
		const before = store.getState().changes!.settledWrites;
		const writing = store.writeIndex("stage", [file(store, "unstaged", "src/total.ts")]);
		const watcher = store.readChanges(TIMBER, FEATURE.id);
		await Promise.all([writing, watcher]);
		expect(store.getState().diffs[FEATURE.id]?.file).toEqual({ area: "staged", path: "src/total.ts", previousPath: null });
		expect(store.getState().changes!.settledWrites).toBe(before + 1);
		// A later read with nothing written moves nothing.
		await store.readChanges(TIMBER, FEATURE.id);
		expect(store.getState().changes!.settledWrites).toBe(before + 1);
	});
});
