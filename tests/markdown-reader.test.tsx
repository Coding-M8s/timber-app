import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { InstallControlsView } from "../src/mainview/components/AppUpdate";
import { MarkdownView } from "../src/mainview/components/MarkdownView";
import { RestartPromptView } from "../src/mainview/components/settings/RestartPrompt";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { updateConfirmText } from "../src/mainview/app-update-format";
import { afterSave, describeQuitQuestion, describeUnsavedFileQuestion, describeUnsavedFiles, hasUnsavedEdits, unsavedFileCount } from "../src/mainview/file-view-format";
import { decodeEntities, headingId, headingIds, markdownLink } from "../src/mainview/markdown-format";
import { restartStepAfterPlan } from "../src/mainview/restart-format";
import { createAppStore } from "../src/mainview/store/store";
import type { FileView } from "../src/mainview/store/state";
import type { Engine } from "../src/shared/engine";
import { editableText, isMarkdownPath, textToSave, textToSaveProblem, usesCrLf } from "../src/shared/worktree-files";

const settle = () => Bun.sleep(0);
const FEATURE = sampleRepositories[0]!.worktrees[1]!;
const nothing = () => {};

async function started(engine: Engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return store;
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);
const markdown = (text: string, path = "docs/plan.md") => renderToStaticMarkup(<MarkdownView text={text} path={path} onOpenLink={nothing} onOpenFile={nothing} />);

const view = (change: Partial<FileView> = {}): FileView => ({
	repository: "/work/timber", worktreePath: FEATURE.path, path: "notes.md", from: "workspace",
	result: { outcome: "read", path: "notes.md", content: { kind: "text", text: "a\r\nb\r\n", lines: 2 } },
	mode: "edit", draft: null, saving: false, saveProblem: null, ...change,
});

describe("rendering Markdown", () => {
	test("draws headings, lists, tasks, tables, quotes, code, and emphasis", () => {
		const markup = markdown([
			"# Plan",
			"",
			"Some **bold**, *slanted*, ~~struck~~, and `code` &amp; more.",
			"",
			"- [x] done",
			"- [ ] to do",
			"",
			"3. third",
			"4. fourth",
			"",
			"> quoted",
			"",
			"```ts",
			"if (a < b) {}",
			"```",
			"",
			"| Name | Size |",
			"|:-----|-----:|",
			"| a | 1 |",
			"",
			"---",
		].join("\n"));
		expect(markup).toContain('<h1 id="markdown-plan" tabindex="-1">Plan</h1>');
		expect(markup).toContain("<strong>bold</strong>");
		expect(markup).toContain("<em>slanted</em>");
		expect(markup).toContain("<del>struck</del>");
		expect(markup).toContain("<code>code</code> &amp; more.");
		expect(markup).toMatch(/<input type="checkbox" class="markdown-checkbox" disabled="" readOnly="" aria-label="Done" checked=""\/>/);
		expect(markup).toContain('aria-label="Not done"');
		expect(markup).toContain('<ol start="3">');
		expect(markup).toContain("<blockquote><p>quoted</p></blockquote>");
		expect(markup).toContain('<pre class="markdown-code" data-language="ts"><code>if (a &lt; b) {}</code></pre>');
		expect(markup).toContain('<th style="text-align:left">Name</th>');
		expect(markup).toContain('<td style="text-align:right">1</td>');
		expect(markup).toContain("<hr/>");
	});

	test("runs nothing from the file: HTML shows as text, and no link, image, or frame reaches the page", () => {
		const hostile = [
			"<script>alert(1)</script>",
			"",
			"<iframe src=\"https://evil.example\"></iframe>",
			"",
			"Inline <img src=x onerror=\"alert(1)\"> and <a href=\"javascript:alert(1)\">a</a>.",
			"",
			"[click](javascript:alert(1)) [data](data:text/html,<script>alert(1)</script>) [file](file:///etc/passwd)",
			"",
			"![tracker](https://evil.example/pixel.png) ![local](logo.png)",
			"",
			"<style>body { display: none }</style>",
		].join("\n");
		const markup = markdown(hostile);
		for (const tag of ["<script", "<iframe", "<img", "<style", "<a href", "<object", "<embed"]) expect(markup).not.toContain(tag);
		// No attribute from the file: no event handler, no address the page could follow.
		expect(markup).not.toMatch(/<[^>]*\son[a-z]+=/i);
		expect(markup).not.toMatch(/<[^>]*\s(href|src|srcdoc|action|formaction)=/i);
		expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(markup).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
		// Links that are not followed are text, with their address in the tooltip.
		expect(markup).toContain('<span class="markdown-link-off" title="javascript:alert(1) is not opened from here">click</span>');
		expect(markup).toContain('<span class="markdown-link-off" title="file:///etc/passwd is not opened from here">file</span>');
		// Images are their descriptions; a web image can be opened in the browser, never loaded here.
		expect(markup).toContain("Image: tracker");
		expect(markup).toContain('title="Open https://evil.example/pixel.png in the browser"');
		expect(markup).toContain("Image: local");
	});

	test("links open in the browser, in the File tab, or at a heading, and never by the page itself", () => {
		const markup = markdown("[site](https://example.com/a) [plan](../README.md) [top](#plan)\n\n<https://example.com/b>");
		expect(markup).toContain('<a class="markdown-link" role="link" tabindex="0" title="Open https://example.com/a in the browser">site</a>');
		expect(markup).toContain('title="Open README.md here"');
		expect(markup).toContain('title="Go to this heading"');
		expect(markup).toContain('title="Open https://example.com/b in the browser"');
	});

	test("reads where a link leads", () => {
		expect(markdownLink("https://example.com/x?y#z", "a.md")).toEqual({ kind: "web", url: "https://example.com/x?y#z" });
		expect(markdownLink("HTTP://Example.com", "a.md")).toEqual({ kind: "web", url: "http://example.com/" });
		expect(markdownLink("docs/b.md", "a.md")).toEqual({ kind: "file", path: "docs/b.md" });
		expect(markdownLink("./b.md#part", "docs/a.md")).toEqual({ kind: "file", path: "docs/b.md" });
		expect(markdownLink("../README.md", "docs/a.md")).toEqual({ kind: "file", path: "README.md" });
		expect(markdownLink("/src/x.ts", "docs/deep/a.md")).toEqual({ kind: "file", path: "src/x.ts" });
		expect(markdownLink("my%20notes.md", "a.md")).toEqual({ kind: "file", path: "my notes.md" });
		expect(markdownLink("#Next Steps", "a.md")).toEqual({ kind: "heading", id: "markdown-next-steps" });
		for (const href of ["../../outside.md", "javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "file:///etc/passwd", "mailto:a@example.com", "vbscript:x", "//evil.example/x", "", "#", " "]) {
			expect(markdownLink(href, "docs/a.md")).toEqual({ kind: "none" });
		}
	});

	test("gives headings ids as GitHub does, repeats numbered", () => {
		expect(headingId("Hello, World!")).toBe("markdown-hello-world");
		expect(headingId("Zażółć gęślą")).toBe("markdown-zażółć-gęślą");
		const next = headingIds();
		expect([next("Setup"), next("Setup"), next("Setup")]).toEqual(["markdown-setup", "markdown-setup-1", "markdown-setup-2"]);
	});

	test("reads character references as characters, and keeps unknown ones", () => {
		expect(decodeEntities("a &amp; b &lt;c&gt; &#65;&#x42; &unknown; &#0;")).toBe("a & b <c> AB &unknown; �");
	});
});

describe("editing and saving text", () => {
	test("knows a Markdown file by its name", () => {
		for (const path of ["a.md", "docs/B.MD", "x.markdown"]) expect(isMarkdownPath(path)).toBe(true);
		for (const path of ["a.txt", "md", "a.md.bak", "README"]) expect(isMarkdownPath(path)).toBe(false);
	});

	test("edits with plain new lines and saves with the file's own", () => {
		expect(usesCrLf("a\r\nb\r\n")).toBe(true);
		expect(usesCrLf("a\r\nb\n")).toBe(false);
		expect(usesCrLf("a\nb\n")).toBe(false);
		expect(editableText("a\r\nb\r\n")).toBe("a\nb\n");
		expect(textToSave("a\r\nb\r\n", "a\nb\nc\n")).toBe("a\r\nb\r\nc\r\n");
		expect(textToSave("a\nb\n", "a\nb\nc\n")).toBe("a\nb\nc\n");
		expect(textToSaveProblem("x".repeat(10))).toBeNull();
		expect(textToSaveProblem("x\n".repeat(20_001))).toContain("20,001 lines");
	});

	test("counts edits as unsaved only when they differ from the file", () => {
		expect(hasUnsavedEdits(view())).toBe(false);
		expect(hasUnsavedEdits(view({ draft: "a\nb\n" }))).toBe(false);
		expect(hasUnsavedEdits(view({ draft: "a\nb\nc\n" }))).toBe(true);
		expect(hasUnsavedEdits(view({ draft: "a\n", result: { outcome: "missing", path: "notes.md", message: "gone" } }))).toBe(true);
		expect(unsavedFileCount({ one: view({ draft: "x" }), two: view(), three: view({ draft: "y" }) })).toBe(2);
	});

	test("says what a save answered", () => {
		const saved = afterSave(view({ draft: "c\n", saving: true }), { outcome: "saved", path: "notes.md", content: { kind: "text", text: "c\n", lines: 1 } });
		expect(saved.saving).toBe(false);
		expect(hasUnsavedEdits(saved)).toBe(false);
		expect(afterSave(view({ saving: true }), { outcome: "changed", path: "notes.md", content: { kind: "binary" }, message: "notes.md changed." }).saveProblem).toEqual({ kind: "changed", message: "notes.md changed." });
		expect(afterSave(view(), { outcome: "missing", path: "notes.md", message: "notes.md is not in this worktree." }).saveProblem).toEqual({ kind: "failed", message: "notes.md is not in this worktree. Nothing was saved." });
	});

	test("asks in plain words", () => {
		expect(describeUnsavedFileQuestion("docs/plan.md", { kind: "close" })).toEqual({ title: "Save plan.md?", text: "docs/plan.md has edits that are not saved. Closing it drops them unless you save first." });
		expect(describeUnsavedFileQuestion("docs/plan.md", { kind: "open", path: "src/a.ts" }).text).toContain("Opening a.ts in its place drops them");
		expect(describeUnsavedFiles([])).toBeNull();
		expect(describeUnsavedFiles(["docs/plan.md"])).toBe("plan.md has unsaved edits, which will be lost.");
		expect(describeUnsavedFiles(["a.md", "b.md"])).toBe("2 files have unsaved edits, which will be lost.");
		expect(describeQuitQuestion(0, ["a.md"])).toEqual({ title: "Quit Timber?", text: "a.md has unsaved edits, which will be lost.", stay: "Keep editing" });
		expect(describeQuitQuestion(2, ["a.md"]).text).toEndWith("They open again when Timber does, and agents go back to their conversations. a.md has unsaved edits, which will be lost.");
	});
});

describe("the Markdown reader in the File tab", () => {
	test("opens a Markdown file rendered, with a switch to its source, and other files read-only", async () => {
		const store = await started();
		store.openFile(FEATURE.id, "docs/plan.md");
		await settle();
		let markup = render(store);
		expect(store.getState().files[FEATURE.id]?.mode).toBe("rendered");
		expect(markup).toContain('<h1 id="markdown-plan" tabindex="-1">Plan</h1>');
		expect(markup).toContain('role="radiogroup" aria-label="How to show docs/plan.md"');
		expect(markup).not.toContain("Read-only");

		store.showFileAs(FEATURE.id, "source");
		markup = render(store);
		expect(markup).toContain("# Plan");
		expect(markup).toMatch(/file-viewer-numbers" aria-hidden="true">1\n2\n3/);

		store.openFile(FEATURE.id, "report.txt");
		await settle();
		markup = render(store);
		expect(store.getState().files[FEATURE.id]?.mode).toBe("source");
		expect(markup).toContain("Read-only");
		expect(markup).not.toContain("radiogroup");
		// Edit is only for Markdown.
		store.editFile(FEATURE.id);
		expect(store.getState().files[FEATURE.id]?.draft).toBeNull();
	});

	test("edits the source, keeps the draft across tabs, previews it rendered, and saves only that file", async () => {
		const engine = createMockEngine();
		engine.setWorktreeFile(FEATURE.path, "notes.md", "# Notes\n");
		engine.setWorktreeFile(FEATURE.path, "other.md", "# Other\n");
		const store = await started(engine);
		store.openFile(FEATURE.id, "notes.md");
		await settle();
		store.editFile(FEATURE.id);
		let markup = render(store);
		expect(markup).toContain('<textarea class="file-editor" aria-label="Source of notes.md"');
		expect(markup).toContain("# Notes\n</textarea>");
		expect(engine.unsavedFilesReported()).toBe(0);

		store.changeDraft(FEATURE.id, "# Notes\n\nNew line\n");
		expect(engine.unsavedFilesReported()).toBe(1);
		expect(render(store)).toContain(">Unsaved</span>");

		// Another tab, and back: the draft is still there.
		store.showTab("workspace");
		store.showTab("file");
		expect(store.getState().files[FEATURE.id]?.draft).toBe("# Notes\n\nNew line\n");
		store.showFileAs(FEATURE.id, "rendered");
		expect(render(store)).toContain("<p>New line</p>");
		store.editFile(FEATURE.id);

		expect(await store.saveFile(FEATURE.id)).toBe(true);
		expect(engine.readWorktreeFileNow(FEATURE.path, "notes.md")).toBe("# Notes\n\nNew line\n");
		expect(engine.readWorktreeFileNow(FEATURE.path, "other.md")).toBe("# Other\n");
		expect(engine.unsavedFilesReported()).toBe(0);
		markup = render(store);
		expect(markup).not.toContain(">Unsaved</span>");
		expect(markup).toContain(">Done</button>");
		store.discardEdits(FEATURE.id);
		expect(store.getState().files[FEATURE.id]?.mode).toBe("rendered");
		expect(store.getState().files[FEATURE.id]?.draft).toBeNull();
	});

	test("asks before closing, reading again, or opening another file over unsaved edits", async () => {
		const engine = createMockEngine();
		engine.setWorktreeFile(FEATURE.path, "notes.md", "# Notes\n");
		const store = await started(engine);
		store.openFile(FEATURE.id, "notes.md");
		await settle();
		store.editFile(FEATURE.id);
		store.changeDraft(FEATURE.id, "edited\n");

		for (const [act, then] of [
			[() => store.closeFile(FEATURE.id), { kind: "close" }],
			[() => store.readFileAgain(FEATURE.id), { kind: "read-again" }],
			[() => store.openFile(FEATURE.id, "docs/plan.md"), { kind: "open", path: "docs/plan.md" }],
		] as const) {
			act();
			await settle();
			expect(store.getState().dialog).toEqual({ kind: "unsaved-file", worktree: FEATURE.id, then });
			expect(store.getState().files[FEATURE.id]?.path).toBe("notes.md");
			expect(store.getState().files[FEATURE.id]?.draft).toBe("edited\n");
			expect(render(store)).toContain("Save notes.md?");
			await store.answerUnsavedFile("keep");
			expect(store.getState().dialog).toBeNull();
			expect(store.getState().files[FEATURE.id]?.draft).toBe("edited\n");
		}

		// Opening the same file again shows it, edits and all, without asking.
		store.showTab("workspace");
		store.openFile(FEATURE.id, "notes.md");
		expect(store.getState().dialog).toBeNull();
		expect(store.getState().tab).toBe("file");
		expect(store.getState().files[FEATURE.id]?.draft).toBe("edited\n");

		// Save, then go on: the file is written, then closed.
		store.closeFile(FEATURE.id);
		await store.answerUnsavedFile("save");
		expect(engine.readWorktreeFileNow(FEATURE.path, "notes.md")).toBe("edited\n");
		expect(store.getState().files[FEATURE.id]).toBeUndefined();
		expect(store.getState().dialog).toBeNull();

		// Discard, then go on: nothing is written, and the other file opens.
		store.openFile(FEATURE.id, "notes.md");
		await settle();
		store.editFile(FEATURE.id);
		store.changeDraft(FEATURE.id, "thrown away\n");
		store.openFile(FEATURE.id, "docs/plan.md");
		await store.answerUnsavedFile("discard");
		await settle();
		expect(engine.readWorktreeFileNow(FEATURE.path, "notes.md")).toBe("edited\n");
		expect(store.getState().files[FEATURE.id]?.path).toBe("docs/plan.md");
	});

	test("does not overwrite a file an agent changed meanwhile, unless asked, and keeps the draft", async () => {
		const engine = createMockEngine();
		engine.setWorktreeFile(FEATURE.path, "notes.md", "# Notes\n");
		const store = await started(engine);
		store.openFile(FEATURE.id, "notes.md");
		await settle();
		store.editFile(FEATURE.id);
		store.changeDraft(FEATURE.id, "mine\n");
		engine.setWorktreeFile(FEATURE.path, "notes.md", "the agent's\n");

		expect(await store.saveFile(FEATURE.id)).toBe(false);
		expect(engine.readWorktreeFileNow(FEATURE.path, "notes.md")).toBe("the agent's\n");
		expect(store.getState().files[FEATURE.id]?.draft).toBe("mine\n");
		expect(store.getState().files[FEATURE.id]?.saveProblem?.kind).toBe("changed");
		expect(render(store)).toContain("notes.md changed on disk since it was opened. Nothing was saved.");
		expect(render(store)).toContain(">Save over it</button>");

		expect(await store.saveFile(FEATURE.id, { overwrite: true })).toBe(true);
		expect(engine.readWorktreeFileNow(FEATURE.path, "notes.md")).toBe("mine\n");
		expect(store.getState().files[FEATURE.id]?.saveProblem).toBeNull();
	});

	test("a failed save says why and keeps the edits", async () => {
		const engine = createMockEngine();
		engine.setWorktreeFile(FEATURE.path, "notes.md", "# Notes\n");
		const store = await started(engine);
		store.openFile(FEATURE.id, "notes.md");
		await settle();
		store.editFile(FEATURE.id);
		store.changeDraft(FEATURE.id, "mine\n");
		engine.setWorktreeFile(FEATURE.path, "notes.md", null);
		expect(await store.saveFile(FEATURE.id, { overwrite: true })).toBe(false);
		expect(store.getState().files[FEATURE.id]?.draft).toBe("mine\n");
		expect(render(store)).toContain("notes.md is not in this worktree. It may have been moved or deleted. Nothing was saved.");
	});

	test("quitting, restarting, or updating asks while edits are unsaved, even with no session running", async () => {
		const engine = createMockEngine();
		engine.setWorktreeFile(FEATURE.path, "notes.md", "# Notes\n");
		const store = await started(engine);
		store.openFile(FEATURE.id, "notes.md");
		await settle();
		store.editFile(FEATURE.id);
		store.changeDraft(FEATURE.id, "mine\n");
		expect(engine.requestQuit()).toBe(false);
		expect(store.getState().quitRequest).not.toBeNull();
		expect(render(store)).toContain("notes.md has unsaved edits, which will be lost.");
		store.cancelQuit();

		expect(restartStepAfterPlan({ available: true }, 0, 1)).toEqual({ kind: "confirm" });
		expect(restartStepAfterPlan({ available: true }, 0, 0)).toBe("restart");
		expect(renderToStaticMarkup(<RestartPromptView step={{ kind: "confirm" }} liveTerminals={0} unsavedFiles={["notes.md"]} onRestart={nothing} onLater={nothing} onConfirm={nothing} onCancel={nothing} />))
			.toContain("notes.md has unsaved edits, which will be lost.");
		expect(updateConfirmText(0, ["notes.md"])).toBe("Restart to install the update now? notes.md has unsaved edits, which will be lost.");
		expect(renderToStaticMarkup(<InstallControlsView step={{ kind: "confirm", live: 0 }} unsavedFiles={["notes.md"]} onRestart={nothing} onConfirm={nothing} onCancel={nothing} />))
			.toContain("notes.md has unsaved edits");
		await store.restartForUpdate(false);
		expect(store.getState().appUpdateStep).toEqual({ kind: "confirm", live: 0 });

		store.discardEdits(FEATURE.id);
		expect(engine.unsavedFilesReported()).toBe(0);
	});
});
