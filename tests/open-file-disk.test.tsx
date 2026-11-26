import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createWorktreeFiles } from "../src/bun/worktree-files";
import { App } from "../src/mainview/App";
import { createMockEngine } from "../src/mainview/engine/mock";
import { FILE_CHECK_MILLISECONDS, createAppStore } from "../src/mainview/store/store";
import type { Engine } from "../src/shared/engine";
import type { Repository } from "../src/shared/model";
import { manualClock } from "./support/clock";
import { windows } from "./support/runtime";
import { fingerprint, git } from "./support/timber";

/**
 * The File tab keeping up with the open file on disk (issue 398), over a
 * real temporary repository: the mock engine lists it, and every file
 * call goes to the main process's own `createWorktreeFiles`. The clock is
 * moved by hand, so each check runs when a test says.
 */

let root: string;
let primary: string;
let linked: string;
let outside: string;

const repositoryOf = (): Repository => ({
	path: primary, name: "sample", available: true, failure: null, setup: "repository", fallbackBase: null,
	worktrees: [primary, linked].map(path => ({
		id: path, path, canonicalPath: path, branch: path === primary ? "main" : "feat/x", head: null, primary: path === primary, detached: false, locked: false, prunable: false,
		pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null, baseCounts: null,
	})),
});

/** Waits until `ready` holds, as the real file reads answer in their own time. */
async function until(ready: () => boolean, what: string): Promise<void> {
	for (let round = 0; round < 400; round++) {
		if (ready()) return;
		await Bun.sleep(5);
	}
	throw new Error(`Never happened: ${what}`);
}

function started() {
	const files = createWorktreeFiles({ findRepository: async path => path === primary ? repositoryOf() : null });
	const mock = createMockEngine([repositoryOf()]);
	const calls = { stamps: 0, reads: 0 };
	const engine: Engine = {
		...mock,
		readWorktreeFile: request => (calls.reads++, files.read(request)),
		readFileOutside: request => (calls.reads++, files.readOutside(request)),
		writeWorktreeFile: request => files.write(request),
		readFileStamp: request => (calls.stamps++, files.stamp(request)),
	};
	const clock = manualClock();
	const store = createAppStore(engine, clock.schedule);
	store.start();
	const view = () => store.getState().files[linked];
	const text = () => {
		const result = view()?.result;
		return result?.outcome === "read" && result.content.kind === "text" ? result.content.text : null;
	};
	/** Moves the clock to the next check, and waits for its stamp, and its read if one follows, to answer. */
	const check = async () => {
		const before = { ...calls };
		clock.advance(FILE_CHECK_MILLISECONDS);
		await until(() => calls.stamps > before.stamps, "the file was checked");
		await Bun.sleep(30);
	};
	const open = async (path: string) => {
		await until(() => store.getState().loaded, "the list was read");
		store.select(linked);
		store.openFile(linked, path);
		await until(() => view()?.result !== null && view()?.result !== undefined, "the file was read");
		await Bun.sleep(30);
	};
	const render = () => renderToStaticMarkup(<App store={store} />);
	return { store, calls, view, text, check, open, render };
}

/** Writes `text` with a modification time of its own, so a file written twice within one tick of the disk's clock still changes its stamp. */
function write(path: string, text: string, seconds: number) {
	writeFileSync(path, text);
	utimesSync(path, seconds, seconds);
}

// The tree has a link, which Windows makes only with extra rights.
describe.skipIf(windows)("the open file keeps up with the disk", () => {
	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-open-file-")));
		primary = join(root, "sample");
		linked = join(root, "sample-worktrees", "feat x");
		outside = join(root, "outside.txt");
		writeFileSync(outside, "not yours\n");
		git(root, "init", "--initial-branch=main", primary);
		writeFileSync(join(primary, "notes.txt"), "one\ntwo\nthree\n");
		git(primary, "add", "--all");
		git(primary, "commit", "-m", "Notes");
		git(primary, "worktree", "add", "-b", "feat/x", linked);
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	beforeEach(() => {
		write(join(linked, "notes.txt"), "one\ntwo\nthree\n", 1_000);
		rmSync(join(linked, "link.txt"), { force: true });
	});

	test("with no unsaved edits, an edit on disk shows by itself, in the same editor", async () => {
		const { store, view, text, check, open, render } = await started();
		await open("notes.txt");
		const memory = store.fileEditMemory(linked, "notes.txt");
		write(join(linked, "notes.txt"), "one\ntwo\nthree\nfour\n", 2_000);
		await check();
		expect(text()).toBe("one\ntwo\nthree\nfour\n");
		expect(view()).toMatchObject({ draft: null, diskChange: null });
		// The editor is kept, so its caret, scroll, and search stay (tests/text-editor-browser.test.ts).
		expect(store.fileEditMemory(linked, "notes.txt")).toBe(memory);
		expect(memory.forgotten).toBe(false);
		expect(render()).not.toContain("Read again");
	});

	test("a second edit of a file that is modified already shows too, and a file that did not change is not read again", async () => {
		const { view, text, calls, check, open } = await started();
		write(join(linked, "notes.txt"), "one\ntwo\nthree\nA\n", 2_000);
		expect(git(linked, "status", "--porcelain")).toContain("notes.txt");
		await open("notes.txt");
		const reads = calls.reads;
		await check();
		await check();
		// Nothing changed: stamps only, and the same view as before.
		expect(calls.reads).toBe(reads);
		const shown = view();
		// The same size, so only the time tells.
		write(join(linked, "notes.txt"), "one\ntwo\nthree\nB\n", 3_000);
		expect(git(linked, "status", "--porcelain")).toContain("notes.txt");
		await check();
		expect(text()).toBe("one\ntwo\nthree\nB\n");
		expect(calls.reads).toBe(reads + 1);
		// Touched with the same text: read, and nothing on screen changes.
		utimesSync(join(linked, "notes.txt"), 4_000, 4_000);
		const now = view();
		await check();
		expect(calls.reads).toBe(reads + 2);
		expect(view()).toBe(now);
		expect(shown).not.toBe(now);
	});

	test("with unsaved edits, the text stays, the note offers Load from disk and Save over it, and Load from disk asks first", async () => {
		const { store, view, text, check, open, render } = await started();
		await open("notes.txt");
		store.changeDraft(linked, "mine\n");
		write(join(linked, "notes.txt"), "the agent's\n", 2_000);
		await check();
		expect(view()).toMatchObject({ draft: "mine\n", diskChange: "changed" });
		expect(text()).toBe("one\ntwo\nthree\n");
		const markup = render();
		expect(markup).toContain("notes.txt changed on disk since you started editing.");
		expect(markup).toContain(">Load from disk</button>");
		expect(markup).toContain(">Save over it</button>");

		store.loadFromDisk(linked);
		expect(store.getState().dialog).toEqual({ kind: "unsaved-file", worktree: linked, then: { kind: "load" } });
		expect(render()).toContain("Loading it from disk drops them unless you save first.");
		await store.answerUnsavedFile("keep");
		expect(view()).toMatchObject({ draft: "mine\n", diskChange: "changed" });
		store.loadFromDisk(linked);
		await store.answerUnsavedFile("discard");
		await until(() => text() === "the agent's\n", "the file on disk showed");
		expect(view()).toMatchObject({ draft: null, diskChange: null });
		expect(readFileSync(join(linked, "notes.txt"), "utf8")).toBe("the agent's\n");
	});

	test("Save over it writes the edits over the change on disk, and the note goes", async () => {
		const { store, view, check, open } = await started();
		await open("notes.txt");
		store.changeDraft(linked, "mine\n");
		write(join(linked, "notes.txt"), "the agent's\n", 2_000);
		await check();
		expect(view()?.diskChange).toBe("changed");
		// A plain save finds the change and writes nothing.
		expect(await store.saveFile(linked)).toBe(false);
		expect(readFileSync(join(linked, "notes.txt"), "utf8")).toBe("the agent's\n");
		expect(await store.saveFile(linked, { overwrite: true })).toBe(true);
		expect(readFileSync(join(linked, "notes.txt"), "utf8")).toBe("mine\n");
		expect(view()).toMatchObject({ diskChange: null, saveProblem: null });
		// The next check finds the file as saved, and changes nothing.
		const saved = view();
		await check();
		expect(view()).toBe(saved);
	});

	test("undoing every edit while the file changed on disk shows the new text", async () => {
		const { store, view, text, check, open } = await started();
		await open("notes.txt");
		store.changeDraft(linked, "mine\n");
		write(join(linked, "notes.txt"), "the agent's\n", 2_000);
		await check();
		store.changeDraft(linked, "one\ntwo\nthree\n");
		await until(() => text() === "the agent's\n", "the file on disk showed");
		expect(view()).toMatchObject({ diskChange: null, draft: "the agent's\n" });
	});

	test("deleting the file shows the missing-file notice, and making it again shows its text", async () => {
		const { view, text, check, open, render } = await started();
		await open("notes.txt");
		rmSync(join(linked, "notes.txt"));
		await check();
		expect(view()?.result?.outcome).toBe("missing");
		expect(render()).toContain("File not found");
		write(join(linked, "notes.txt"), "back\n", 2_000);
		await check();
		expect(text()).toBe("back\n");
		expect(render()).not.toContain("File not found");
	});

	test("deleting the file while it holds unsaved edits keeps them, and says so", async () => {
		const { store, view, text, check, open, render } = await started();
		await open("notes.txt");
		store.changeDraft(linked, "mine\n");
		rmSync(join(linked, "notes.txt"));
		await check();
		expect(view()).toMatchObject({ draft: "mine\n", diskChange: "deleted" });
		expect(text()).toBe("one\ntwo\nthree\n");
		const markup = render();
		expect(markup).toContain("notes.txt was deleted on disk since you started editing.");
		expect(markup).not.toContain(">Save over it</button>");
		// It comes back as it was: nothing changed after all.
		write(join(linked, "notes.txt"), "one\ntwo\nthree\n", 2_000);
		await check();
		expect(view()).toMatchObject({ draft: "mine\n", diskChange: null });
	});

	test("a file that turns into a link leading out keeps unsaved edits, and shows the link's target once there are none", async () => {
		const { store, view, check, open } = await started();
		write(join(linked, "link.txt"), "inside\n", 1_000);
		await open("link.txt");
		store.changeDraft(linked, "mine\n");
		rmSync(join(linked, "link.txt"));
		symlinkSync(outside, join(linked, "link.txt"));
		await check();
		expect(view()).toMatchObject({ path: "link.txt", outside: false, draft: "mine\n", diskChange: "changed" });
		store.discardEdits(linked);
		await until(() => view()?.outside === true, "the link's target showed");
		expect(view()).toMatchObject({ path: outside, draft: null, diskChange: null });
	});

	test("checks only the File tab that shows, while the window shows, and writes nothing", async () => {
		const { store, calls, check, open } = await started();
		await open("notes.txt");
		// Without optional locks, so asking Git leaves the index alone too.
		const snapshot = () => [git(linked, "--no-optional-locks", "status", "--porcelain"), fingerprint(linked), fingerprint(primary)];
		const before = snapshot();
		await check();
		await check();
		expect(snapshot()).toEqual(before);

		const stamps = calls.stamps;
		store.showTab("workspace");
		await Bun.sleep(30);
		store.windowChanged({ visible: true, focused: true });
		await Bun.sleep(30);
		expect(calls.stamps).toBe(stamps);
		// Shown again: checked at once.
		store.showTab("file");
		await until(() => calls.stamps === stamps + 1, "the file was checked as it showed");
		store.windowChanged({ visible: false, focused: false });
		await Bun.sleep(30);
		expect(calls.stamps).toBe(stamps + 1);
	});
});
