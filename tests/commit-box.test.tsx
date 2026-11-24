import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { commitStateOf, describeCommitButton, isCommitKey } from "../src/mainview/commit-format";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { type MockFileChange, sampleNewFilePatch, samplePatch } from "../src/mainview/engine/mock-file-changes";
import { createAppStore } from "../src/mainview/store/store";
import type { FileChange } from "../src/shared/file-changes";
import { defaultLayout } from "../src/shared/layout";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
// Tracking its upstream, two commits ahead and none behind, so the row offers Push.
const FEATURE = sampleRepositories[0]!.worktrees[1]!;

const change = (area: FileChange["area"], kind: FileChange["kind"], path: string): FileChange => ({ area, kind, path, previousPath: null, added: null, removed: null, version: "" });
const mock = (file: FileChange): MockFileChange => ({ change: file, patch: file.kind === "untracked" || file.kind === "added" ? sampleNewFilePatch(file.path) : samplePatch(file.path) });
const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);
const listed = (store: ReturnType<typeof createAppStore>) => (store.getState().changes?.files ?? []).map(file => `${file.area} ${file.path}`);
const feature = (store: ReturnType<typeof createAppStore>) => store.getState().repositories[0]!.worktrees.find(worktree => worktree.id === FEATURE.id)!;

const FILES = [
	change("staged", "modified", "src/rules.ts"),
	change("staged", "added", "src/new.ts"),
	change("unstaged", "modified", "src/rules.ts"),
	change("unstaged", "modified", "src/total.ts"),
	change("untracked", "untracked", "notes/todo.md"),
];

/** The feature worktree selected with the Changes view shown, comparing `compare`. */
async function started(compare: "uncommitted" | "base" = "uncommitted", files: FileChange[] = FILES) {
	const engine = createMockEngine();
	await engine.saveLayout({ ...defaultLayout(), ...(compare === "uncommitted" ? { uncommittedChanges: [FEATURE.id] } : {}) });
	engine.setFileChanges(FEATURE.path, files.map(mock));
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	store.select(FEATURE.id);
	store.showSidePanel("changes");
	await store.readChanges(TIMBER, FEATURE.id);
	return { engine, store };
}

describe("the commit box's words and rules", () => {
	test("Ctrl+Enter or Cmd+Enter commits; Enter alone is a new line", () => {
		const key = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });
		expect(isCommitKey(key("Enter", { ctrlKey: true }))).toBe(true);
		expect(isCommitKey(key("Enter", { metaKey: true }))).toBe(true);
		expect(isCommitKey(key("Enter"))).toBe(false);
		expect(isCommitKey(key("Enter", { ctrlKey: true, shiftKey: true }))).toBe(false);
		expect(isCommitKey(key("a", { ctrlKey: true }))).toBe(false);
		expect(describeCommitButton(false)).toBe("Runs git commit -F -, with the message on standard input (Ctrl+Enter in the message box)");
		expect(describeCommitButton(true)).toContain("(Cmd+Enter in the message box)");
	});

	test("counts the staged files on screen, and offers Commit when more files changed than are listed", () => {
		const view = { operation: null, detached: false, more: false };
		expect(commitStateOf({ ...view, files: FILES }, "m").staged).toBe(2);
		expect(commitStateOf({ ...view, files: FILES.filter(file => file.area !== "staged") }, "m").staged).toBe(0);
		expect(commitStateOf({ ...view, more: true, files: FILES.filter(file => file.area !== "staged") }, "m").staged).toBe(1);
	});
});

describe("committing from the Changes view", () => {
	test("Uncommitted has the box and Commit, disabled with its reason until there is a message", async () => {
		const { store } = await started();
		let markup = render(store);
		expect(markup).toContain(`placeholder="Commit message"`);
		expect(markup).toMatch(/<button type="button" class="button primary commit-button" disabled="" title="Runs git commit -F -, with the message on standard input \(Ctrl\+Enter in the message box\)"/);
		expect(markup).toContain("Write a commit message first.");
		store.setCommitMessage(FEATURE.id, "Add the rules");
		markup = render(store);
		expect(markup).not.toContain("Write a commit message first.");
		expect(markup).not.toMatch(/commit-button" disabled/);
	});

	test("with nothing staged Commit is disabled and says so, and never stages anything", async () => {
		const { engine, store } = await started("uncommitted", FILES.filter(file => file.area !== "staged"));
		store.setCommitMessage(FEATURE.id, "Everything");
		expect(render(store)).toContain("Nothing is staged. Stage the files to commit first.");
		expect(await store.commitStaged()).toBeNull();
		expect(engine.commits()).toEqual([]);
		expect(listed(store)).toEqual(["unstaged src/rules.ts", "unstaged src/total.ts", "untracked notes/todo.md"]);
	});

	test("during a merge Commit is disabled with a note to finish it in the terminal", async () => {
		const { engine, store } = await started();
		engine.setOperation(FEATURE.path, "merge");
		await store.readChanges(TIMBER, FEATURE.id);
		store.setCommitMessage(FEATURE.id, "Merge");
		expect(render(store)).toContain("A merge is in progress. Finish it in the terminal, then commit.");
		expect(await store.commitStaged()).toBeNull();
		expect(engine.commits()).toEqual([]);
	});

	test("a commit clears the message, says its hash with Push, reads the list again, and the row's count moves", async () => {
		const { engine, store } = await started();
		expect(feature(store).sync).toMatchObject({ ahead: 2, behind: 0 });
		store.setCommitMessage(FEATURE.id, "Add the rules\n\nAnd a new file.");
		const result = await store.commitStaged();
		expect(result?.outcome).toBe("committed");
		if (result?.outcome !== "committed") return;
		expect(engine.commits()).toEqual([{ worktree: FEATURE.path, message: "Add the rules\n\nAnd a new file.", commit: result.commit }]);
		expect(store.getState().commitMessages[FEATURE.id]).toBeUndefined();
		expect(store.getState().changes?.committed).toEqual({ commit: result.commit, short: result.short });
		// The unstaged edit of a staged file stays, as do the others.
		expect(listed(store)).toEqual(["unstaged src/rules.ts", "unstaged src/total.ts", "untracked notes/todo.md"]);
		expect(feature(store).sync).toMatchObject({ ahead: 3, behind: 0 });
		const markup = render(store);
		expect(markup).toContain(`Committed ${result.short}`);
		expect(markup).toMatch(/aria-haspopup="dialog">Push<\/button>/);
		// The box is empty again, and Commit waits for something staged.
		expect(markup).toContain("Nothing is staged. Stage the files to commit first.");
	});

	test("a failing hook shows what it printed, keeps the message, and commits nothing", async () => {
		const { engine, store } = await started();
		engine.failCommits("lint: 2 problems in src/rules.ts");
		store.setCommitMessage(FEATURE.id, "Add the rules");
		const result = await store.commitStaged();
		expect(result).toEqual({ outcome: "failed", command: "git commit -F -, with the message on standard input", message: "lint: 2 problems in src/rules.ts" });
		expect(store.getState().commitMessages[FEATURE.id]).toBe("Add the rules");
		expect(store.getState().changes?.commitProblem).toEqual({ command: "git commit -F -, with the message on standard input", message: "lint: 2 problems in src/rules.ts" });
		expect(listed(store)).toEqual(FILES.map(file => `${file.area} ${file.path}`));
		expect(feature(store).sync).toMatchObject({ ahead: 2 });
		const markup = render(store);
		expect(markup).toContain("Could not commit");
		expect(markup).toContain(`<pre class="commit-output">lint: 2 problems in src/rules.ts</pre>`);
		expect(markup).toContain(">Add the rules</textarea>");
		// Fixed, the same message commits.
		engine.failCommits(null);
		expect((await store.commitStaged())?.outcome).toBe("committed");
		expect(store.getState().changes?.commitProblem).toBeNull();
	});

	test("the message is kept for each worktree while switching between them", async () => {
		const { store } = await started();
		store.setCommitMessage(FEATURE.id, "Half written");
		const other = sampleRepositories[0]!.worktrees[2]!;
		store.select(other.id);
		await store.readChanges(TIMBER, other.id);
		store.select(FEATURE.id);
		await store.readChanges(TIMBER, FEATURE.id);
		expect(render(store)).toContain(">Half written</textarea>");
	});

	test("Base has Commit… in place of the box", async () => {
		const { store } = await started("base");
		expect(store.getState().changes?.compared).toBe("base");
		const markup = render(store);
		expect(markup).toContain("Commit…</button>");
		expect(markup).not.toContain(`class="commit-message"`);
	});
});
