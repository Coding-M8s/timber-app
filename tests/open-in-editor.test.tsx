import { defaultTerminalAppearance } from "../src/shared/terminal-appearance";
import { AGENT_PRESETS } from "../src/shared/agent";
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { EditorSectionView, type EditorSectionViewProps } from "../src/mainview/components/settings/EditorSection";
import {
	EXAMPLE_WORKTREE, FOLDER_MISSING_REASON, NO_EDITOR_HINT, chooseEditor, describeEditorAction, draftOf, editEditor, editorDraftModel,
} from "../src/mainview/editor-format";
import { createMockEngine, sampleUnavailableRepository } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import type { Engine } from "../src/shared/engine";
import { TERMINAL_EDITOR_REASON } from "../src/shared/editor";
import { defaultFetchSetting } from "../src/shared/fetch-setting";
import { defaultStateSounds } from "../src/shared/sound-setting";
import { defaultThemeChoice } from "../src/shared/theme";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const API_SERVER = "/work/api-server";
const MISSING = "/work/api-server-worktrees/old-removed-folder";

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { store, engine };
}

async function withEditor(command: string, terminal = false) {
	const started = await startedStore();
	await started.store.savePreferences({ editor: { command, terminal } });
	return started;
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

/** The opening tags of every element with this class name. */
const tagsOf = (markup: string, className: string) => markup.match(new RegExp(`<[a-z0-9]+ [^>]*class="${className}"[^>]*>`, "g")) ?? [];

/** The opening tag of the editor control beside the row of the worktree at `path`. */
function rowEditor(markup: string, path: string): string {
	// The row's tooltip starts with its path. The saved base may follow it.
	const row = [`title="${path}"`, `title="${path} (`].map(start => markup.indexOf(start)).find(at => at >= 0) ?? -1;
	if (row < 0) throw new Error(`No row for ${path}`);
	const tag = /<button [^>]*class="icon-button row-editor"[^>]*>/.exec(markup.slice(row));
	if (!tag) throw new Error(`No editor control after the row for ${path}`);
	return tag[0];
}

describe("the control for a worktree", () => {
	test("with no editor set, it is offered and says it opens Settings", () => {
		const action = describeEditorAction(null, { path: FEATURE, pathExists: true }, false);
		expect(action).toEqual({ available: true, opensSettings: true, command: null, tooltip: `Open in editor. ${NO_EDITOR_HINT}`, reason: null });
	});

	test("with an editor set, its tooltip is the exact command", () => {
		const action = describeEditorAction({ command: "code", terminal: false }, { path: "/work/my repo", pathExists: true }, false);
		expect(action).toMatchObject({ available: true, opensSettings: false, command: "code '/work/my repo'", tooltip: "Open in editor: code '/work/my repo'" });
	});

	test("a terminal editor, or a folder that is missing, is unavailable with the reason", () => {
		expect(describeEditorAction({ command: "nvim", terminal: true }, { path: FEATURE, pathExists: true }, false))
			.toMatchObject({ available: false, reason: TERMINAL_EDITOR_REASON, tooltip: `Open in editor: nvim ${FEATURE}. ${TERMINAL_EDITOR_REASON}` });
		expect(describeEditorAction({ command: "code", terminal: false }, { path: MISSING, pathExists: false }, false))
			.toMatchObject({ available: false, reason: FOLDER_MISSING_REASON });
	});

	test("while the editor starts, it cannot be pressed again", () => {
		expect(describeEditorAction({ command: "code", terminal: false }, { path: FEATURE, pathExists: true }, true)).toMatchObject({ available: false, reason: null });
	});
});

describe("Open in editor in the window", () => {
	test("each row has the control beside it, not inside it, and the rows are still the rows", async () => {
		const { store } = await withEditor("code");
		const markup = render(store);
		expect(tagsOf(markup, "icon-button row-editor").length).toBe(7);
		expect(markup.match(/class="row( selected)?"/g)?.length).toBe(7);
		// The row is a button, and a button cannot hold another.
		expect(markup).not.toMatch(/<button [^>]*class="row[^"]*"[^>]*>(?:(?!<\/button>).)*<button/);
		expect(rowEditor(markup, FEATURE)).toContain(`title="Open in editor: code ${FEATURE}"`);
		expect(rowEditor(markup, FEATURE)).toContain('aria-label="Open in editor: feat/github-issue-lookup"');
		expect(rowEditor(markup, FEATURE)).not.toContain("disabled");
	});

	test("the workspace header has it too, for the selected worktree", async () => {
		const { store } = await withEditor("zed --new");
		const [header] = tagsOf(render(store), "button workspace-editor");
		expect(header).toContain(`title="Open in editor: zed --new ${TIMBER}"`);
		expect(header).not.toContain("disabled");
	});

	test("a row whose folder is missing has it disabled, with the reason", async () => {
		const { store } = await withEditor("code");
		const tag = rowEditor(render(store), MISSING);
		expect(tag).toContain("disabled");
		expect(tag).toContain(FOLDER_MISSING_REASON);
	});

	test("with a terminal editor it is disabled with the reason, in the header in words", async () => {
		const { store } = await withEditor("nvim", true);
		const markup = render(store);
		expect(rowEditor(markup, FEATURE)).toContain("disabled");
		const [header] = tagsOf(markup, "button workspace-editor");
		expect(header).toContain("disabled");
		expect(header).toContain('aria-describedby="workspace-editor-reason"');
		expect(markup).toContain(`<p id="workspace-editor-reason" class="workspace-note">${TERMINAL_EDITOR_REASON}</p>`);
	});

	test("with no editor set, pressing it opens Settings at Editor and starts nothing", async () => {
		const { store, engine } = await startedStore();
		expect(rowEditor(render(store), FEATURE)).toContain('aria-haspopup="dialog"');
		expect(await store.openInEditor({ repository: TIMBER, worktree: FEATURE })).toBeNull();
		expect(store.getState().dialog).toEqual({ kind: "settings", section: "editor" });
		expect(engine.launchedEditors()).toEqual([]);
		expect(render(store)).toMatch(/class="settings-nav-item selected" aria-current="page"[^>]*><svg class="settings-nav-icon"[^]*?<\/svg>Editor</);
	});

	test("a started editor is a toast, and the command was the saved one with the worktree's path", async () => {
		const { store, engine } = await withEditor("code -n");
		const result = await store.openInEditor({ repository: TIMBER, worktree: FEATURE });
		expect(result).toEqual({ outcome: "opened", command: `code -n ${FEATURE}` });
		expect(engine.launchedEditors()).toEqual([{ request: { repository: TIMBER, worktree: FEATURE }, command: `code -n ${FEATURE}` }]);
		expect(store.getState().toasts.map(toast => toast.text)).toEqual(["Opened feat/github-issue-lookup in the editor"]);
		expect(store.getState().editorProblem).toBeNull();
	});

	test("a missing executable is a note that names the command, until dismissed, and is not a toast", async () => {
		const { store, engine } = await withEditor("code");
		engine.endEditorLaunches("not-found");
		await store.openInEditor({ repository: TIMBER, worktree: FEATURE });
		expect(store.getState().toasts).toEqual([]);
		const markup = render(store);
		expect(markup).toContain("Could not open feat/github-issue-lookup in the editor");
		expect(markup).toContain("&quot;code&quot; was not found on the PATH the app was started with");
		expect(markup).toContain(`<pre class="dialog-command" aria-label="Editor command">code ${FEATURE}</pre>`);
		store.dismissEditorProblem();
		expect(render(store)).not.toContain("editor-problem");
	});

	test("an editor that stops right away is a note, and the next one that starts puts it away", async () => {
		const { store, engine } = await withEditor("code");
		engine.endEditorLaunches("fails");
		await store.openInEditor({ repository: TIMBER, worktree: FEATURE });
		expect(store.getState().editorProblem).toMatchObject({ kind: "failed", worktree: FEATURE, command: `code ${FEATURE}` });
		engine.endEditorLaunches("opens");
		await store.openInEditor({ repository: TIMBER, worktree: FEATURE });
		expect(store.getState().editorProblem).toBeNull();
	});

	test("a worktree that is no longer listed is refused, and an engine that does not answer is a failure", async () => {
		const { store } = await withEditor("code");
		await store.openInEditor({ repository: TIMBER, worktree: "/work/elsewhere" });
		expect(store.getState().editorProblem).toMatchObject({ kind: "not-listed", command: null });

		const engine = createMockEngine();
		const broken: Engine = { ...engine, openInEditor: async () => { throw new Error("connection lost"); } };
		const second = await startedStore(broken as typeof engine);
		await second.store.savePreferences({ editor: { command: "code", terminal: false } });
		await second.store.openInEditor({ repository: TIMBER, worktree: FEATURE });
		expect(second.store.getState().editorProblem).toMatchObject({ kind: "failed", message: "The app did not hear whether the editor started: connection lost" });
	});

	test("a terminal editor asked for anyway starts nothing and says why", async () => {
		const { store, engine } = await withEditor("nvim", true);
		const result = await store.openInEditor({ repository: TIMBER, worktree: FEATURE });
		expect(result).toMatchObject({ outcome: "terminal-editor", command: `nvim ${FEATURE}` });
		expect(engine.launchedEditors()).toEqual([]);
		expect(render(store)).toContain("Cannot open feat/github-issue-lookup in a terminal editor yet");
	});

	test("one at a time per worktree", async () => {
		const { store, engine } = await withEditor("code");
		const both = [store.openInEditor({ repository: TIMBER, worktree: FEATURE }), store.openInEditor({ repository: TIMBER, worktree: FEATURE })];
		expect(rowEditor(render(store), FEATURE)).toContain("disabled");
		expect(await both[1]).toBeNull();
		await both[0];
		expect(engine.launchedEditors().length).toBe(1);
	});
});

describe("the Editor section of Settings", () => {
	const none = draftOf(null);

	test("a preset fills the command, None empties it, and Other keeps it to edit", () => {
		const zed = chooseEditor(none, "zed");
		expect(zed).toEqual({ choice: "zed", command: "zed", terminal: false });
		expect(chooseEditor(zed, "neovim")).toEqual({ choice: "neovim", command: "nvim", terminal: true });
		expect(chooseEditor(zed, "other")).toEqual({ choice: "other", command: "zed", terminal: false });
		expect(chooseEditor(zed, "none")).toEqual(none);
	});

	test("typing decides the choice from what was typed", () => {
		expect(editEditor(none, { command: "code" }).choice).toBe("vscode");
		expect(editEditor(none, { command: "code --wait" }).choice).toBe("other");
		expect(editEditor(chooseEditor(none, "neovim"), { terminal: false }).choice).toBe("other");
		// Emptying the field is a command still to type, never quietly "None".
		expect(editEditor(chooseEditor(none, "zed"), { command: "  " }).choice).toBe("other");
		expect(draftOf({ command: "nvim", terminal: true }).choice).toBe("neovim");
	});

	test("the model shows the exact command for an example folder, and Save only for a change that can be read", () => {
		const code = editorDraftModel(chooseEditor(none, "vscode"), null);
		expect(code).toEqual({ setting: { command: "code", terminal: false }, error: null, hint: null, warning: null, note: null, example: `code '${EXAMPLE_WORKTREE}'`, canSave: true });
		expect(editorDraftModel(chooseEditor(none, "vscode"), { command: "code", terminal: false }).canSave).toBe(false);
		const broken = editorDraftModel(editEditor(none, { command: `code "x` }), null);
		expect(broken).toMatchObject({ error: "The double quote at character 6 is never closed.", canSave: false, example: null });
		expect(editorDraftModel(editEditor(none, { command: `"" x` }), null).canSave).toBe(false);
		expect(editorDraftModel(none, { command: "code", terminal: false })).toEqual({ setting: null, error: null, hint: null, warning: null, note: null, example: null, canSave: true });
		expect(editorDraftModel(none, null).canSave).toBe(false);
	});

	test("Other with nothing typed cannot be saved, so it never clears a saved editor by accident", () => {
		const saved = { command: "code", terminal: false };
		for (const draft of [chooseEditor(none, "other"), editEditor(draftOf(saved), { command: "" })]) {
			expect(editorDraftModel(draft, saved)).toMatchObject({ setting: null, canSave: false, hint: "Type a command, or choose None for no editor." });
		}
		expect(editorDraftModel(chooseEditor(draftOf(saved), "none"), saved)).toMatchObject({ setting: null, canSave: true });
	});

	test("a known terminal editor without Runs in a terminal gets a warning, and can still be saved", () => {
		for (const [command, name] of [["vim", "vim"], ["/usr/bin/nvim -p", "nvim"], ["hx", "hx"], ["nano", "nano"], ["micro", "micro"], ["vi", "vi"], ["emacs -nw", "emacs -nw"], [`"C:\\Tools\\nvim.exe"`, "nvim"]] as const) {
			const model = editorDraftModel(editEditor(none, { command }), null);
			expect(model.warning).toBe(`${name} runs in a terminal. Without "Runs in a terminal" it would be started with no terminal to show it in.`);
			expect(model.canSave).toBe(true);
			expect(editorDraftModel(editEditor(none, { command, terminal: true }), null).warning).toBeNull();
		}
		for (const command of ["code", "emacs", "zed", "vimdiff-free-editor"]) expect(editorDraftModel(editEditor(none, { command }), null).warning).toBeNull();
	});

	test("Zed says that zeditor is tried where zed is not on the PATH, however the command came to start with zed", () => {
		const note = 'Where "zed" is not on the PATH, "zeditor" is tried, the name some Linux packages install it under. The command that ran is shown once the editor is started.';
		expect(editorDraftModel(chooseEditor(none, "zed"), null)).toMatchObject({ setting: { command: "zed", terminal: false }, note, example: `zed '${EXAMPLE_WORKTREE}'`, canSave: true });
		expect(editorDraftModel(editEditor(none, { command: "zed --new" }), null).note).toBe(note);
		for (const command of ["code", "zeditor", "/usr/bin/zed", "nvim", "constructor"]) expect(editorDraftModel(editEditor(none, { command }), null).note).toBeNull();
		// With "Runs in a terminal" nothing is started from here, so nothing is tried.
		expect(editorDraftModel(editEditor(none, { command: "zed", terminal: true }), null).note).toBeNull();
	});

	const view = (props: Partial<EditorSectionViewProps>) => renderToStaticMarkup(
		<EditorSectionView draft={none} saved={null} save={{ state: "idle" }} onChoose={() => {}} onEdit={() => {}} onSave={() => {}} {...props} />,
	);

	test("draws the presets, the command, and the example command", () => {
		const markup = view({ draft: chooseEditor(none, "vscode") });
		for (const label of ["None", "VS Code", "Zed", "Neovim", "Other command"]) expect(markup).toContain(`<span class="check-text">${label}</span>`);
		expect(markup).toContain(`<input type="radio" name="editor-choice" checked="" value="vscode"/>`);
		expect(markup).toContain('value="code"');
		expect(markup).toContain(`<pre class="dialog-command" aria-label="Example command">code &#x27;${EXAMPLE_WORKTREE}&#x27;</pre>`);
		expect(markup).toContain(`<button type="submit" class="button primary" aria-disabled="false">Save</button>`);
	});

	test("an unreadable command says why, and Save is disabled", () => {
		const markup = view({ draft: editEditor(none, { command: `code "x` }) });
		expect(markup).toContain("This command cannot be read");
		expect(markup).toContain('aria-invalid="true"');
		expect(markup).toContain(`<button type="submit" class="button primary" aria-disabled="true">Save</button>`);
	});

	test("draws the hint and the warning", () => {
		expect(view({ draft: chooseEditor(none, "other") })).toContain("Type a command, or choose None for no editor.");
		expect(view({ draft: editEditor(none, { command: "vim" }) })).toContain("This looks like a terminal editor");
		expect(view({ draft: chooseEditor(none, "zed") })).toContain('<p class="dialog-note">Where &quot;zed&quot; is not on the PATH, &quot;zeditor&quot; is tried,');
		expect(view({ draft: chooseEditor(none, "vscode") })).not.toContain("is tried");
	});

	test("Neovim says it is not started from here yet", () => {
		const markup = view({ draft: chooseEditor(none, "neovim") });
		expect(markup).toContain(TERMINAL_EDITOR_REASON);
		expect(markup).toContain(`nvim &#x27;${EXAMPLE_WORKTREE}&#x27;`);
	});

	test("is listed in Settings and saves through the preferences", async () => {
		const { store, engine } = await startedStore();
		store.openDialog({ kind: "settings", section: "editor" });
		const markup = render(store);
		expect(markup).toMatch(/class="settings-nav-item"[^>]*><svg class="settings-nav-icon"[^]*?<\/svg>Layout</);
		expect(markup).toMatch(/class="settings-nav-item selected" aria-current="page"[^>]*><svg class="settings-nav-icon"[^]*?<\/svg>Editor</);
		expect(markup).toContain('<h3 id="');
		expect(markup).toMatch(/class="settings-section-title">Editor</);
		await store.savePreferences({ editor: { command: "zed", terminal: false } });
		expect(await engine.loadPreferences()).toEqual({ sidebarSide: "left", editor: { command: "zed", terminal: false }, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, shortcuts: {}, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } });
	});
});

describe("the mock engine", () => {
	test("acts out each ending, and refuses an unknown one", async () => {
		const engine = createMockEngine();
		expect(await engine.openInEditor({ repository: TIMBER, worktree: FEATURE })).toEqual({ outcome: "not-configured" });
		await engine.savePreferences({ editor: { command: "code", terminal: false } });
		expect((await engine.openInEditor({ repository: TIMBER, worktree: FEATURE })).outcome).toBe("opened");
		engine.endEditorLaunches("not-found");
		expect(await engine.openInEditor({ repository: TIMBER, worktree: FEATURE })).toMatchObject({ outcome: "not-found", executable: "code" });
		await engine.savePreferences({ editor: { command: "zed", terminal: false } });
		const missing = await engine.openInEditor({ repository: TIMBER, worktree: FEATURE });
		expect(missing.outcome === "not-found" && missing.message).toBe('Could not start the editor. Neither "zed" nor "zeditor" was found on the PATH the app was started with: /usr/local/bin:/usr/bin:/bin. A change to PATH needs a restart of the app, or use the full path in Settings, Editor.');
		engine.endEditorLaunches("fails");
		expect((await engine.openInEditor({ repository: TIMBER, worktree: FEATURE })).outcome).toBe("failed");
		expect((await engine.openInEditor({ repository: API_SERVER, worktree: MISSING })).outcome).toBe("not-listed");
		engine.setRepositories([sampleUnavailableRepository]);
		expect(await engine.openInEditor({ repository: sampleUnavailableRepository.path, worktree: sampleUnavailableRepository.path }))
			.toEqual({ outcome: "not-listed", message: `Git cannot read the repository at ${sampleUnavailableRepository.path}. No editor was started.` });
		expect(() => engine.endEditorLaunches("explodes" as never)).toThrow("Unknown ending: explodes");
	});
});
