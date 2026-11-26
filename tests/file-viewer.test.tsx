import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import type { MockFileChange } from "../src/mainview/engine/mock-file-changes";
import { samplePatch } from "../src/mainview/engine/mock-file-changes";
import { describeFileNotice, fileTabLabel, pathInWorktree, settleTabs } from "../src/mainview/file-view-format";
import { createAppStore } from "../src/mainview/store/store";
import { initialState } from "../src/mainview/store/state";
import type { Engine } from "../src/shared/engine";
import { MAX_FILE_BYTES, MAX_FILE_LINES } from "../src/shared/worktree-files";
import { MOCK_NOTES_FOLDER } from "../src/mainview/engine/mock-worktree-files";
import { OPEN_IN_EDITOR } from "../src/mainview/editor-format";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const PRIMARY = sampleRepositories[0]!.worktrees[0]!;
const FEATURE = sampleRepositories[0]!.worktrees[1]!;

async function started(engine: Engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return store;
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);
const tabs = (markup: string) => [...markup.matchAll(/role="tab"[^>]*>(.*?)<\/button>/g)].map(match => match[1]!.replace(/<[^>]+>/g, ""));

describe("the File tab", () => {
	test("shows only while a file is open, and closing it goes back to the tab it came from", async () => {
		const engine = createMockEngine();
		const store = await started(engine);
		store.select(FEATURE.id);
		store.showTab("pull-request");
		expect(tabs(render(store))).toEqual(["Workspace", "Pull request"]);
		// Asking for the File tab with no file open does nothing.
		store.showTab("file");
		expect(store.getState().tab).toBe("pull-request");

		store.openFile(FEATURE.id, "docs/plan.md");
		expect(store.getState().tab).toBe("file");
		await settle();
		const markup = render(store);
		expect(tabs(markup)).toEqual(["Workspace", "Pull request", "plan.md"]);
		expect(markup).toContain('aria-label="Close plan.md"');
		// Markdown opens rendered (see markdown-reader.test.tsx); its source shows in the editor, read-only, colored.
		expect(markup).toContain(">Plan</h1>");
		store.showFileAs(FEATURE.id, "source");
		const source = render(store);
		expect(source).toContain('<div class="text-editor-host"');
		expect(source).toContain('<span class="text-editor-language">Markdown</span>');
		expect(source).toContain("Read-only. Ctrl+F to find");

		store.closeFile(FEATURE.id);
		expect(store.getState().tab).toBe("pull-request");
		expect(tabs(render(store))).toEqual(["Workspace", "Pull request"]);
	});

	test("belongs to its worktree: another worktree has none, and coming back finds the file", async () => {
		const store = await started();
		store.select(FEATURE.id);
		store.openFile(FEATURE.id, "docs/plan.md");
		await settle();
		store.select(PRIMARY.id);
		expect(store.getState().tab).toBe("workspace");
		expect(tabs(render(store))).toEqual(["Workspace", "Pull request"]);
		store.select(FEATURE.id);
		store.showTab("file");
		expect(store.getState().tab).toBe("file");
		expect(render(store)).toContain("Written by an agent");
	});

	test("opens an absolute path inside the worktree, as a terminal prints it, through the worktree's own read", async () => {
		const engine = createMockEngine();
		let reads = 0;
		let outsideReads = 0;
		const counting: Engine = { ...engine, readWorktreeFile: request => (reads++, engine.readWorktreeFile(request)), readFileOutside: request => (outsideReads++, engine.readFileOutside(request)) };
		const store = await started(counting);
		store.openFile(FEATURE.id, `${FEATURE.path}/docs/plan.md`);
		await settle();
		expect(store.getState().files[FEATURE.id]).toMatchObject({ path: "docs/plan.md", outside: false, result: { outcome: "read" } });
		expect([reads, outsideReads]).toEqual([1, 0]);
	});

	test("opens a complete path outside the worktree read-only, with the full path above and the name on the tab", async () => {
		const engine = createMockEngine();
		let reads = 0;
		let outsideReads = 0;
		let writes = 0;
		const counting: Engine = {
			...engine,
			readWorktreeFile: request => (reads++, engine.readWorktreeFile(request)),
			readFileOutside: request => (outsideReads++, engine.readFileOutside(request)),
			writeWorktreeFile: request => (writes++, engine.writeWorktreeFile(request)),
		};
		const store = await started(counting);
		store.select(FEATURE.id);
		store.openFile(FEATURE.id, `${MOCK_NOTES_FOLDER}/run.log`);
		await settle();
		expect([reads, outsideReads]).toEqual([0, 1]);
		expect(store.getState().files[FEATURE.id]).toMatchObject({ path: `${MOCK_NOTES_FOLDER}/run.log`, outside: true, result: { outcome: "read" } });
		const markup = render(store);
		expect(tabs(markup)).toContain("run.log");
		expect(markup).toContain(`<span class="diff-path" title="${MOCK_NOTES_FOLDER}/run.log">${MOCK_NOTES_FOLDER}/run.log</span>`);
		expect(markup).toContain("Read-only here. It is outside this worktree. Open it in your own editor to change it.");
		expect(markup).toContain("Read-only. Ctrl+F to find");
		const viewer = markup.slice(markup.indexOf('<section class="file-viewer"'));
		expect(viewer).not.toContain(">Save<");
		expect(viewer).not.toContain(OPEN_IN_EDITOR);

		// Nothing makes it editable, and nothing saves it.
		store.editFile(FEATURE.id);
		store.changeDraft(FEATURE.id, "mine\n");
		expect(store.getState().files[FEATURE.id]?.draft).toBeNull();
		expect(await store.saveFile(FEATURE.id)).toBe(false);
		expect(writes).toBe(0);

		// Load from disk reads it outside again; opening it again shows it as it is.
		store.loadFromDisk(FEATURE.id);
		await settle();
		expect(outsideReads).toBe(2);
		store.openFile(FEATURE.id, `${MOCK_NOTES_FOLDER}/run.log`);
		await settle();
		expect(outsideReads).toBe(2);
	});

	test("opens a Markdown file outside the worktree rendered, with its source, and its links stay beside it", async () => {
		const store = await started();
		store.select(FEATURE.id);
		store.openFile(FEATURE.id, `${MOCK_NOTES_FOLDER}/plan.md`);
		await settle();
		const markup = render(store);
		expect(markup).toContain(">Scratch plan</h1>");
		// Its link to run.log leads beside it, not into the worktree.
		expect(markup).toContain(`title="Open ${MOCK_NOTES_FOLDER}/run.log here"`);
		expect(markup).toContain(">Rendered<");
		expect(markup).toContain(">Source<");
		expect(markup).not.toContain(">Edit<");
		store.showFileAs(FEATURE.id, "source");
		expect(render(store)).toContain("Read-only. Ctrl+F to find");
		store.editFile(FEATURE.id);
		expect(store.getState().files[FEATURE.id]?.draft).toBeNull();
	});

	test("gives a file outside the worktree the same notices: binary, missing, and a folder", async () => {
		const store = await started();
		store.select(FEATURE.id);
		store.openFile(FEATURE.id, `${MOCK_NOTES_FOLDER}/trace.bin`);
		await settle();
		expect(render(store)).toContain(`${MOCK_NOTES_FOLDER}/trace.bin is binary, so it is not shown here.`);
		store.openFile(FEATURE.id, `${MOCK_NOTES_FOLDER}/gone.md`);
		await settle();
		expect(render(store)).toContain(`${MOCK_NOTES_FOLDER}/gone.md is not there. It may have been moved or deleted.`);
		store.openFile(FEATURE.id, MOCK_NOTES_FOLDER);
		await settle();
		expect(render(store)).toContain(`${MOCK_NOTES_FOLDER} is a folder, not a file.`);
	});

	test("opens the target of a link in the worktree that leads out, read-only", async () => {
		const engine = createMockEngine();
		engine.setWorktreeFile(FEATURE.path, "notes.md", { kind: "link", target: `${MOCK_NOTES_FOLDER}/plan.md` });
		const store = await started(engine);
		store.select(FEATURE.id);
		store.openFile(FEATURE.id, "notes.md");
		await settle();
		await settle();
		expect(store.getState().files[FEATURE.id]).toMatchObject({ path: `${MOCK_NOTES_FOLDER}/plan.md`, outside: true, mode: "rendered", result: { outcome: "read" } });
		expect(render(store)).toContain(">Scratch plan</h1>");
	});

	test("keeps edits typed while a read finds the file has become a link that leads out", async () => {
		const engine = createMockEngine();
		let release = () => {};
		let hold = false;
		const held: Engine = {
			...engine,
			readWorktreeFile: async request => {
				const answer = await engine.readWorktreeFile(request);
				if (hold) await new Promise<void>(resolve => (release = resolve));
				return answer;
			},
		};
		const store = await started(held);
		store.select(FEATURE.id);
		store.openFile(FEATURE.id, "report.txt");
		await settle();
		hold = true;
		engine.setWorktreeFile(FEATURE.path, "report.txt", { kind: "link", target: `${MOCK_NOTES_FOLDER}/run.log` });
		store.loadFromDisk(FEATURE.id);
		await settle();
		store.changeDraft(FEATURE.id, "typed meanwhile\n");
		release();
		await settle();
		await settle();
		// The edits stay, and the File tab says the file changed on disk.
		expect(store.getState().files[FEATURE.id]).toMatchObject({ path: "report.txt", outside: false, draft: "typed meanwhile\n", diskChange: "changed" });
	});

	test("still refuses a relative path that steps out of the worktree, without reading", async () => {
		const engine = createMockEngine();
		let reads = 0;
		const counting: Engine = { ...engine, readWorktreeFile: request => (reads++, engine.readWorktreeFile(request)), readFileOutside: request => (reads++, engine.readFileOutside(request)) };
		const store = await started(counting);
		for (const path of ["../x.md", "docs/../../x.md", "./../x.md"]) {
			store.openFile(FEATURE.id, path);
			await settle();
			expect(store.getState().files[FEATURE.id]?.result?.outcome).toBe("outside");
		}
		expect(reads).toBe(0);
		const markup = render(store);
		expect(markup).toContain("Outside this worktree");
		expect(markup).toContain("./../x.md is not inside this worktree. A path that steps out of the worktree does not open; its complete path opens it read-only.");
	});

	test("says clearly when a file is missing, binary, or too large", async () => {
		const engine = createMockEngine();
		engine.setWorktreeFile(FEATURE.path, "big.log", "x".repeat(MAX_FILE_BYTES + 1));
		const store = await started(engine);

		store.openFile(FEATURE.id, "gone.md");
		await settle();
		expect(render(store)).toContain("File not found");

		store.openFile(FEATURE.id, "logo.png");
		await settle();
		expect(render(store)).toContain("logo.png is binary, so it is not shown here.");

		store.openFile(FEATURE.id, "big.log");
		await settle();
		expect(render(store)).toContain("big.log is too large to show here. It is 1.0 MB; the viewer shows up to 1.0 MB.");

		store.openFile(FEATURE.id, "docs");
		await settle();
		expect(render(store)).toContain("docs is a folder, not a file.");
	});

	test("Load from disk shows the file as it is now", async () => {
		const engine = createMockEngine();
		engine.setWorktreeFile(FEATURE.path, "notes.md", "first\n");
		const store = await started(engine);
		store.openFile(FEATURE.id, "notes.md");
		await settle();
		engine.setWorktreeFile(FEATURE.path, "notes.md", "second\n");
		store.loadFromDisk(FEATURE.id);
		await settle();
		expect(render(store)).toContain("second");
	});

	test("opens from the diff tab's View file, and closing it goes back to the diff", async () => {
		const engine = createMockEngine();
		const change: MockFileChange = { change: { area: "unstaged", kind: "modified", path: "src/net.ts", previousPath: null, added: null, removed: null, version: "" }, patch: samplePatch("src/net.ts") };
		engine.setFileChanges(FEATURE.path, [change]);
		const store = await started(engine);
		store.select(FEATURE.id);
		await store.readChanges(TIMBER, FEATURE.id);
		// Listed as the comparison lists it: with the base, the file is under Changed.
		await store.selectChangedFile(store.getState().changes!.files![0]!);
		expect(store.getState().tab).toBe("diff");
		expect(render(store)).toContain(">View file</button>");
		// The button calls this; the file's text is what the mock has on disk.
		store.openFile(FEATURE.id, "src/net.ts");
		await settle();
		const view = store.getState().files[FEATURE.id];
		expect(view?.result?.outcome === "read" && view.result.content.kind === "text" && view.result.content.text).toContain("export const retries = 5;");
		// It opens in the editor, colored as TypeScript.
		const markup = render(store);
		expect(markup).toContain('<div class="text-editor-host"');
		expect(markup).toContain('<span class="text-editor-language">TypeScript</span>');
		expect(tabs(markup)).toEqual(["Workspace", "Pull request", "diffDiff of net.ts", "net.ts"]);
		store.closeFile(FEATURE.id);
		expect(store.getState().tab).toBe("diff");
	});

	test("an open file leaves with its worktree", () => {
		const state = { ...initialState, tab: "file" as const, selection: { repository: TIMBER, worktree: FEATURE.id }, repositories: [], files: { [FEATURE.id]: { repository: TIMBER, worktreePath: FEATURE.path, path: "a.md", outside: false, from: "workspace" as const, result: null, mode: "source" as const, draft: null, saving: false, saveProblem: null, diskChange: null, goTo: null } } };
		expect(settleTabs(state)).toEqual({ files: {}, tab: "workspace" });
		expect(settleTabs({ ...state, repositories: sampleRepositories })).toBeNull();
	});
});

describe("describeFileNotice", () => {
	test("says nothing for text, and why for every refusal", () => {
		expect(describeFileNotice({ outcome: "read", path: "a.md", content: { kind: "text", text: "a", lines: 1 } })).toBeNull();
		expect(describeFileNotice({ outcome: "read", path: "a.log", content: { kind: "too-large", bytes: 30_000, lines: MAX_FILE_LINES + 1 } })?.text)
			.toBe("a.log is too large to show here. It has 20,001 lines; the viewer shows up to 20,000. Open it in your editor.");
		expect(describeFileNotice({ outcome: "outside", path: "x", message: "x leads outside." })?.title).toBe("Outside this worktree");
		expect(describeFileNotice({ outcome: "failed", message: "Disk gone" })).toEqual({ title: "Could not read the file", text: "Disk gone" });
	});

	test("takes an absolute path under the worktree's registered or real path", () => {
		const worktree = { path: "/tmp/app", canonicalPath: "/private/tmp/app" };
		expect(pathInWorktree(worktree, "/tmp/app/a.md")).toBe("a.md");
		expect(pathInWorktree(worktree, "/private/tmp/app/docs/a.md")).toBe("docs/a.md");
		expect(pathInWorktree(worktree, "/private/tmp/other/a.md")).toBeNull();
		expect(pathInWorktree({ path: "/tmp/app", canonicalPath: null }, "/private/tmp/app/a.md")).toBeNull();
		expect(pathInWorktree(worktree, "../a.md")).toBeNull();
	});

	test("names the tab after the file", () => {
		expect(fileTabLabel(undefined)).toBe("File");
		expect(fileTabLabel({ repository: TIMBER, worktreePath: FEATURE.path, path: "docs/plan.md", outside: false, from: "workspace", result: null, mode: "source", draft: null, saving: false, saveProblem: null, diskChange: null, goTo: null })).toBe("plan.md");
	});
});
