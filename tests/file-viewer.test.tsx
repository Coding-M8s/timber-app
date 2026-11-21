import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import type { MockFileChange } from "../src/mainview/engine/mock-file-changes";
import { samplePatch } from "../src/mainview/engine/mock-file-changes";
import { describeFileNotice, fileTabLabel, pathInWorktree, settleFiles } from "../src/mainview/file-view-format";
import { createAppStore } from "../src/mainview/store/store";
import { initialState } from "../src/mainview/store/state";
import type { Engine } from "../src/shared/engine";
import { MAX_FILE_BYTES, MAX_FILE_LINES } from "../src/shared/worktree-files";

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
		store.showTab("changes");
		expect(tabs(render(store))).toEqual(["Workspace", "Changes", "Pull request"]);
		// Asking for the File tab with no file open does nothing.
		store.showTab("file");
		expect(store.getState().tab).toBe("changes");

		store.openFile(FEATURE.id, "docs/plan.md");
		expect(store.getState().tab).toBe("file");
		await settle();
		const markup = render(store);
		expect(tabs(markup)).toEqual(["Workspace", "Changes", "Pull request", "plan.md"]);
		expect(markup).toContain('aria-label="Close plan.md"');
		expect(markup).toContain("Read-only");
		expect(markup).toContain("# Plan");
		// The numbers are their own block, one per line.
		expect(markup).toMatch(/file-viewer-numbers" aria-hidden="true">1\n2\n3\n4\n5\n6\n7<\/pre>/);

		store.closeFile(FEATURE.id);
		expect(store.getState().tab).toBe("changes");
		expect(tabs(render(store))).toEqual(["Workspace", "Changes", "Pull request"]);
	});

	test("belongs to its worktree: another worktree has none, and coming back finds the file", async () => {
		const store = await started();
		store.select(FEATURE.id);
		store.openFile(FEATURE.id, "docs/plan.md");
		await settle();
		store.select(PRIMARY.id);
		expect(store.getState().tab).toBe("workspace");
		expect(tabs(render(store))).toEqual(["Workspace", "Changes", "Pull request"]);
		store.select(FEATURE.id);
		store.showTab("file");
		expect(store.getState().tab).toBe("file");
		expect(render(store)).toContain("Written by an agent");
	});

	test("opens an absolute path inside the worktree, as a terminal prints it, and refuses one outside without reading", async () => {
		const engine = createMockEngine();
		let reads = 0;
		const counting: Engine = { ...engine, readWorktreeFile: request => (reads++, engine.readWorktreeFile(request)) };
		const store = await started(counting);
		store.openFile(FEATURE.id, `${FEATURE.path}/docs/plan.md`);
		await settle();
		expect(store.getState().files[FEATURE.id]?.path).toBe("docs/plan.md");
		expect(store.getState().files[FEATURE.id]?.result?.outcome).toBe("read");
		expect(reads).toBe(1);

		store.openFile(FEATURE.id, "/etc/passwd");
		await settle();
		expect(reads).toBe(1);
		const markup = render(store);
		expect(markup).toContain("Outside this worktree");
		expect(markup).toContain("/etc/passwd is not inside this worktree.");
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

	test("Read again shows the file as it is now", async () => {
		const engine = createMockEngine();
		engine.setWorktreeFile(FEATURE.path, "notes.md", "first\n");
		const store = await started(engine);
		store.openFile(FEATURE.id, "notes.md");
		await settle();
		engine.setWorktreeFile(FEATURE.path, "notes.md", "second\n");
		store.readFileAgain(FEATURE.id);
		await settle();
		expect(render(store)).toContain("second");
	});

	test("opens from the Changes tab's View file", async () => {
		const engine = createMockEngine();
		const change: MockFileChange = { change: { area: "unstaged", kind: "modified", path: "src/net.ts", previousPath: null }, patch: samplePatch("src/net.ts") };
		engine.setFileChanges(FEATURE.path, [change]);
		const store = await started(engine);
		store.select(FEATURE.id);
		store.showTab("changes");
		await store.readChanges(TIMBER, FEATURE.id);
		expect(render(store)).toContain(">View file</button>");
		// The button calls this; the file's text is what the mock has on disk.
		store.openFile(FEATURE.id, "src/net.ts");
		await settle();
		expect(render(store)).toContain("export const retries = 5;");
	});

	test("an open file leaves with its worktree", () => {
		const state = { ...initialState, tab: "file" as const, selection: { repository: TIMBER, worktree: FEATURE.id }, repositories: [], files: { [FEATURE.id]: { repository: TIMBER, worktreePath: FEATURE.path, path: "a.md", from: "workspace" as const, result: null } } };
		expect(settleFiles(state)).toEqual({ files: {}, tab: "workspace" });
		expect(settleFiles({ ...state, repositories: sampleRepositories })).toBeNull();
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
		expect(fileTabLabel({ repository: TIMBER, worktreePath: FEATURE.path, path: "docs/plan.md", from: "workspace", result: null })).toBe("plan.md");
	});
});
