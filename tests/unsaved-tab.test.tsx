import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { type MockEngine, createMockEngine, sampleRepositories, sampleStatesRepository } from "../src/mainview/engine/mock";
import { GALLERY_WORKTREE, modifiedSample } from "../src/mainview/engine/mock-file-changes";
import { fileTabTitle } from "../src/mainview/file-view-format";
import { createAppStore } from "../src/mainview/store/store";
import type { Engine } from "../src/shared/engine";
import type { Repository } from "../src/shared/model";
import { fileContentOf } from "../src/shared/worktree-files";

/**
 * The File tab's unsaved mark, and the worktree's status after a save (issue
 * 328): the mark and its words, the reload a save asks for, and the status
 * the mock answers with then. How the mark is drawn is tested in a real
 * browser (tests/tab-names-browser.test.ts).
 */

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const PRIMARY = sampleRepositories[0]!.worktrees[0]!;
const FEATURE = sampleRepositories[0]!.worktrees[1]!;
type Store = ReturnType<typeof createAppStore>;

async function started(engine: Engine): Promise<Store> {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return store;
}

/** A store with `path` open in the feature worktree, holding `text`. */
async function opened(engine: Engine, mock: MockEngine, path = "notes.md", text = "# Notes\n"): Promise<Store> {
	mock.setWorktreeFile(FEATURE.path, path, text);
	const store = await started(engine);
	store.select(FEATURE.id);
	store.openFile(FEATURE.id, path);
	await settle();
	store.editFile(FEATURE.id);
	return store;
}

/** The File tab as the window draws it: what is seen, what is heard, and its tooltip. */
function fileTab(store: Store) {
	const markup = renderToStaticMarkup(<App store={store} />);
	const tab = /<button[^>]*id="tab-file"[^>]*>(.*?)<\/button>/s.exec(markup)?.[1];
	if (tab === undefined) throw new Error("no File tab");
	const words = (html: string) => html.replace(/<[^>]+>/g, "");
	return {
		seen: words(tab.replace(/<span class="visually-hidden">.*?<\/span>/g, "")),
		heard: words(tab.replace(/<span[^>]*aria-hidden="true"[^>]*>.*?<\/span>/g, "")),
		title: /title="([^"]*)"/.exec(tab)?.[1],
	};
}

const SAVED = { seen: "notes.md", heard: "notes.md", title: "notes.md" };
const UNSAVED = { seen: "notes.md●", heard: "notes.md (unsaved)", title: "notes.md (unsaved)" };

const changesOf = (repositories: readonly Repository[], path: string) => {
	for (const repository of repositories) for (const worktree of repository.worktrees) if (worktree.path === path) return worktree.changes;
	throw new Error(`no worktree at ${path}`);
};
const modifiedIn = (store: Store, path = FEATURE.path) => {
	const changes = changesOf(store.getState().repositories, path);
	return changes.kind === "known" ? changes.modified : null;
};

describe("the File tab's unsaved mark", () => {
	test("shows while the file has unsaved edits, also while another tab shows, and goes with a save", async () => {
		const mock = createMockEngine();
		const store = await opened(mock, mock);
		expect(fileTab(store)).toEqual(SAVED);
		store.changeDraft(FEATURE.id, "# Notes\n\nMore\n");
		expect(fileTab(store)).toEqual(UNSAVED);
		for (const tab of ["workspace", "pull-request"] as const) {
			store.showTab(tab);
			expect(fileTab(store)).toEqual(UNSAVED);
		}
		expect(renderToStaticMarkup(<App store={store} />)).toContain('aria-label="Close notes.md"');
		expect(await store.saveFile(FEATURE.id)).toBe(true);
		expect(fileTab(store)).toEqual(SAVED);
		// Typed on after the save: unsaved again.
		store.changeDraft(FEATURE.id, "# Notes\n\nMore still\n");
		expect(fileTab(store)).toEqual(UNSAVED);
	});

	test("goes when the edits are discarded, and when they are undone", async () => {
		const mock = createMockEngine();
		const store = await opened(mock, mock);
		store.changeDraft(FEATURE.id, "mine\n");
		expect(fileTab(store)).toEqual(UNSAVED);
		store.changeDraft(FEATURE.id, "# Notes\n");
		expect(fileTab(store)).toEqual(SAVED);
		store.changeDraft(FEATURE.id, "mine\n");
		store.discardEdits(FEATURE.id);
		expect(fileTab(store)).toEqual(SAVED);
	});

	test("goes with the Changes list's Discard of the open file", async () => {
		const mock = createMockEngine();
		mock.setFileChanges(FEATURE.path, [modifiedSample("notes.md")]);
		const store = await opened(mock, mock);
		await store.readChanges(TIMBER, FEATURE.id);
		await store.compareChanges("uncommitted");
		store.changeDraft(FEATURE.id, "mine\n");
		expect(fileTab(store)).toEqual(UNSAVED);
		expect(await store.discardFiles([modifiedSample("notes.md").change])).toMatchObject({ outcome: "written" });
		await settle();
		expect(fileTab(store)).toEqual(SAVED);
	});

	test("stays through a save that wrote nothing, and goes with Save over it", async () => {
		const mock = createMockEngine();
		const store = await opened(mock, mock);
		store.changeDraft(FEATURE.id, "mine\n");
		mock.setWorktreeFile(FEATURE.path, "notes.md", "the agent's\n");
		expect(await store.saveFile(FEATURE.id)).toBe(false);
		expect(fileTab(store)).toEqual(UNSAVED);
		expect(await store.saveFile(FEATURE.id, { overwrite: true })).toBe(true);
		expect(fileTab(store)).toEqual(SAVED);
	});

	test("the tooltip says the path, and that the edits are unsaved while they are", () => {
		const result = { outcome: "read" as const, path: "docs/plan.md", content: fileContentOf(new TextEncoder().encode("a\n"), 2) };
		expect(fileTabTitle({ path: "docs/plan.md", draft: null, result })).toBe("docs/plan.md");
		expect(fileTabTitle({ path: "docs/plan.md", draft: "a\n", result })).toBe("docs/plan.md");
		expect(fileTabTitle({ path: "docs/plan.md", draft: "b\n", result })).toBe("docs/plan.md (unsaved)");
		// A draft of a file that is no longer text is unsaved, whatever it holds.
		expect(fileTabTitle({ path: "docs/plan.md", draft: "a\n", result: { outcome: "missing", path: "docs/plan.md", message: "Gone." } })).toBe("docs/plan.md (unsaved)");
	});
});

describe("the status after a save", () => {
	/** A mock engine that notes each repository read again, and can hold those reads. */
	function reloads(mock: MockEngine) {
		const asked: string[] = [];
		let held: Promise<void> | null = null;
		const engine: Engine = {
			...mock,
			loadRepository: async path => {
				asked.push(path);
				const answer = await mock.loadRepository(path);
				await held;
				return answer;
			},
		};
		return {
			engine,
			asked,
			hold() {
				let release!: () => void;
				held = new Promise(resolve => { release = resolve; });
				return () => { held = null; release(); };
			},
		};
	}

	test("the saved worktree's repository is read again once, and its row's counts follow", async () => {
		const mock = createMockEngine();
		const { engine, asked } = reloads(mock);
		const store = await opened(engine, mock);
		const before = modifiedIn(store)!;
		store.changeDraft(FEATURE.id, "mine\n");
		expect(await store.saveFile(FEATURE.id)).toBe(true);
		await settle();
		expect(asked).toEqual([TIMBER]);
		expect(modifiedIn(store)).toEqual([...before, "notes.md"]);
		expect(renderToStaticMarkup(<App store={store} />)).toContain("4 modified, 1 untracked");
		// The edits and the file stay as the save left them.
		expect(store.getState().files[FEATURE.id]).toMatchObject({ draft: "mine\n", saving: false, saveProblem: null });
	});

	test("the worktree is a new object after it, which is when the Changes list is read again, and the list has the file", async () => {
		const mock = createMockEngine();
		const store = await opened(mock, mock);
		await store.readChanges(TIMBER, FEATURE.id);
		await store.compareChanges("uncommitted");
		store.changeDraft(FEATURE.id, "mine\n");
		const worktree = () => store.getState().repositories[0]!.worktrees[1];
		const before = worktree();
		await store.saveFile(FEATURE.id);
		await settle();
		// ChangesReader reads the list whenever the worktree is a new object.
		expect(worktree()).not.toBe(before);
		await store.readChanges(TIMBER, FEATURE.id);
		expect(store.getState().changes?.files?.filter(file => file.path === "notes.md")).toMatchObject([{ area: "unstaged", kind: "modified" }]);
	});

	test("a save does not wait for it, and one that lands during a read is followed by another read", async () => {
		const mock = createMockEngine();
		const { engine, asked, hold } = reloads(mock);
		const store = await opened(engine, mock);
		const release = hold();
		const early = store.reloadRepository(TIMBER);
		await settle();
		store.changeDraft(FEATURE.id, "mine\n");
		expect(await store.saveFile(FEATURE.id)).toBe(true);
		expect(asked).toEqual([TIMBER]);
		expect(modifiedIn(store)).not.toContain("notes.md");
		release();
		await early;
		await settle();
		expect(asked).toEqual([TIMBER, TIMBER]);
		expect(modifiedIn(store)).toContain("notes.md");
	});

	test("nothing is read again when nothing was saved, or when it is not known", async () => {
		const mock = createMockEngine();
		const { engine, asked } = reloads(mock);
		const store = await opened(engine, mock);
		store.changeDraft(FEATURE.id, "mine\n");
		mock.setWorktreeFile(FEATURE.path, "notes.md", "the agent's\n");
		expect(await store.saveFile(FEATURE.id)).toBe(false);
		mock.setWorktreeFile(FEATURE.path, "notes.md", null);
		expect(await store.saveFile(FEATURE.id, { overwrite: true })).toBe(false);
		engine.writeWorktreeFile = async () => { throw new Error("bridge closed"); };
		expect(await store.saveFile(FEATURE.id, { overwrite: true })).toBe(false);
		await settle();
		expect(asked).toEqual([]);
		expect(store.getState().error).toBeNull();
	});

	/** A save that answers only once let go, with what happens meanwhile. */
	async function during(meanwhile: (store: Store) => void | Promise<void>) {
		const mock = createMockEngine();
		const { engine, asked } = reloads(mock);
		let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		engine.writeWorktreeFile = async request => {
			const answer = await mock.writeWorktreeFile(request);
			await gate;
			return answer;
		};
		const store = await opened(engine, mock);
		store.changeDraft(FEATURE.id, "mine\n");
		const saving = store.saveFile(FEATURE.id);
		await settle();
		await meanwhile(store);
		asked.length = 0;
		release();
		expect(await saving).toBe(true);
		await settle();
		return { store, asked };
	}

	test("the status is read again also when another file was opened before the save answered", async () => {
		const { store, asked } = await during(shown => {
			shown.discardEdits(FEATURE.id);
			shown.openFile(FEATURE.id, "report.txt");
		});
		expect(store.getState().files[FEATURE.id]?.path).toBe("report.txt");
		expect(asked).toEqual([TIMBER]);
		expect(modifiedIn(store)).toContain("notes.md");
	});

	test("a repository removed before the save answered is not read, and no error shows", async () => {
		const { store, asked } = await during(shown => shown.removeRepository(TIMBER));
		expect(store.getState().repositories.map(repository => repository.path)).not.toContain(TIMBER);
		expect(asked).toEqual([]);
		expect(store.getState().error).toBeNull();
	});
});

describe("the mock's status after a save", () => {
	const save = (mock: MockEngine, path: string, text: string, worktree = FEATURE.path, repository = TIMBER) =>
		mock.writeWorktreeFile({ repository, worktree, path, text, expected: null });
	const statusOf = async (mock: MockEngine, worktree = FEATURE.path) => changesOf(await mock.listRepositories(), worktree);
	const uncommitted = async (mock: MockEngine, worktree = FEATURE.path, repository = TIMBER) => {
		const answer = await mock.readFileChanges({ repository, worktree, compare: "uncommitted" });
		if (answer.outcome !== "read") throw new Error(answer.message);
		return (path: string) => answer.files.filter(file => file.path === path).map(file => `${file.area} ${file.kind}`);
	};

	test("lists the saved file as modified, once, in that worktree alone, as its text was saved", async () => {
		const mock = createMockEngine();
		const before = await mock.listRepositories();
		const kept = structuredClone(sampleRepositories);
		expect(await save(mock, "docs/plan.md", "one\n")).toMatchObject({ outcome: "saved" });
		expect(await save(mock, "docs/plan.md", "two\n")).toMatchObject({ outcome: "saved" });
		const changes = changesOf(before, FEATURE.path);
		if (changes.kind !== "known") throw new Error("the sample's status is known");
		expect(await statusOf(mock)).toEqual({ ...changes, modified: [...changes.modified, "docs/plan.md"] });
		expect((await uncommitted(mock))("docs/plan.md")).toEqual(["unstaged modified"]);
		expect(mock.readWorktreeFileNow(FEATURE.path, "docs/plan.md")).toBe("two\n");
		for (const repository of before) {
			for (const worktree of repository.worktrees) if (worktree.path !== FEATURE.path) expect(await statusOf(mock, worktree.path)).toEqual(worktree.changes);
		}
		// The samples themselves, which every mock engine starts from, stay as they were.
		expect(sampleRepositories).toEqual(kept);
	});

	test("leaves the status as it is for a file already changed, an ignored one, the same text again, and a save that wrote nothing", async () => {
		const mock = createMockEngine();
		const before = await statusOf(mock);
		if (before.kind !== "known") throw new Error("the sample's status is known");
		expect(await save(mock, before.modified[0]!, "changed again\n")).toMatchObject({ outcome: "saved" });
		expect(await save(mock, before.untracked[0]!, "still new\n")).toMatchObject({ outcome: "saved" });
		expect(await save(mock, "debug.log", "ignored\n")).toMatchObject({ outcome: "saved" });
		expect(await save(mock, "README.md", "# Sample\n\nA pretend worktree for trying the app without Git.\n", PRIMARY.path)).toMatchObject({ outcome: "saved" });
		expect(await mock.writeWorktreeFile({ repository: TIMBER, worktree: FEATURE.path, path: "docs/plan.md", text: "mine\n", expected: "not this" })).toMatchObject({ outcome: "changed" });
		expect(await save(mock, "gone.md", "nothing\n")).toMatchObject({ outcome: "missing" });
		expect(await statusOf(mock)).toEqual(before);
		expect(await statusOf(mock, PRIMARY.path)).toEqual(PRIMARY.changes);
		const files = await uncommitted(mock);
		expect(files(before.modified[0]!)).toEqual(["unstaged modified"]);
		expect(files(before.untracked[0]!)).toEqual(["untracked untracked"]);
		expect(files("debug.log")).toEqual([]);
	});

	test("a file staged, committed on the branch, or discarded before is modified again in the Changes list", async () => {
		const mock = createMockEngine();
		const { change } = modifiedSample("docs/plan.md");
		mock.setFileChanges(FEATURE.path, [{ ...modifiedSample("docs/plan.md"), change: { ...change, area: "staged" } }]);
		await save(mock, "docs/plan.md", "after staging\n");
		expect((await uncommitted(mock))("docs/plan.md")).toEqual(["staged modified", "unstaged modified"]);

		// README.md is committed on the branch of a worktree with a base.
		expect((await uncommitted(mock))("README.md")).toEqual([]);
		await save(mock, "README.md", "after the commit\n");
		expect((await uncommitted(mock))("README.md")).toEqual(["unstaged modified"]);

		const second = createMockEngine();
		await save(second, "docs/plan.md", "one\n");
		const store = await started(second);
		store.select(FEATURE.id);
		await store.readChanges(TIMBER, FEATURE.id);
		await store.compareChanges("uncommitted");
		expect(await store.discardFiles([change])).toMatchObject({ outcome: "written" });
		expect((await uncommitted(second))("docs/plan.md")).toEqual([]);
		await save(second, "docs/plan.md", "two\n");
		expect((await uncommitted(second))("docs/plan.md")).toEqual(["unstaged modified"]);
		const changes = await statusOf(second);
		expect(changes.kind === "known" && changes.modified.filter(path => path === "docs/plan.md")).toEqual(["docs/plan.md"]);
	});

	test("the worktree with every kind of change gains the file too, and a status that could not be read stays so", async () => {
		const mock = createMockEngine([...sampleRepositories, sampleStatesRepository]);
		const { path: billing, worktrees } = sampleStatesRepository;
		const total = async () => {
			const answer = await mock.readFileChanges({ repository: billing, worktree: GALLERY_WORKTREE, compare: "uncommitted" });
			return answer.outcome === "read" ? answer.files.length : null;
		};
		const before = (await total())!;
		await save(mock, "docs/plan.md", "mine\n", GALLERY_WORKTREE, billing);
		expect(await total()).toBe(before + 1);
		expect((await uncommitted(mock, GALLERY_WORKTREE, billing))("docs/plan.md")).toEqual(["unstaged modified"]);
		// A conflicted file is changed on disk already, and stays one entry.
		await save(mock, "src/tax/rates.ts", "export const vat = 0.22;\n", GALLERY_WORKTREE, billing);
		expect((await uncommitted(mock, GALLERY_WORKTREE, billing))("src/tax/rates.ts")).toEqual(["conflicted conflicted"]);

		const unreadable = worktrees.find(worktree => worktree.branch === "fix/unreadable")!;
		expect(await save(mock, "docs/plan.md", "mine\n", unreadable.path, billing)).toMatchObject({ outcome: "saved" });
		expect(await statusOf(mock, unreadable.path)).toEqual(unreadable.changes);
	});
});
