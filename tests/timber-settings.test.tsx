import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import {
	GitFields, LauncherFields, ScriptsFields, TimberGroupForm, TrackingFields,
} from "../src/mainview/components/settings/TimberSections";
import { createMockEngine, sampleTimberStatuses } from "../src/mainview/engine/mock";
import { MOCK_MACHINE_CONFIG, sampleMachineValues } from "../src/mainview/engine/mock-timber-config";
import { createAppStore } from "../src/mainview/store/store";
import {
	type GroupOutcome, type TrackingDraft, credentialsToCheck, credentialsToSave, describeCheck, draftsOf, groupChanged, groupMessages, outcomeOfSave, typingPutsAway,
	valuesWith, withPreset, EDITOR_PRESETS,
} from "../src/mainview/timber-settings-format";
import type { TimberCredentialStates, TimberValues } from "../src/shared/timber-config";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const API = "/work/api-server";
const SECRET = "lin_api_SuperSecretKey123";
const noop = () => {};

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { engine, store };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

/** Settings as Timber reads them for a repository: a named workflow and a key from a later Timber, both kept as they are. */
const READ: TimberValues = {
	base_branch: "main",
	hooks: { post_create: ["bun install", "echo 'one\ntwo'"] },
	editor: { command: "code", args: ["--new-window"], enabled: false },
	workflows: { review: { description: "Review a pull request", post_create: ["gh pr checkout"] } },
	future_key: { kept: true },
};

describe("a group of Timber's settings as data", () => {
	test("the fields as read change nothing", () => {
		const drafts = draftsOf(READ);
		for (const group of ["editor", "agent", "git", "scripts", "tracking"] as const) {
			expect(valuesWith(group, drafts[group], READ)).toEqual(READ);
			expect(groupChanged(group, drafts[group], READ)).toBe(false);
		}
	});

	test("a group writes only its own keys, and named workflows and keys this app does not know go back as they were", () => {
		const drafts = draftsOf(READ);
		const git = valuesWith("git", { ...drafts.git, base_branch: "", remote: "upstream" }, READ);
		expect(git).toEqual({ ...READ, base_branch: undefined, remote: "upstream" } as never);
		expect("base_branch" in git).toBe(false);
		expect(git.workflows).toEqual(READ.workflows);
		expect(git.future_key).toEqual({ kept: true });
		expect(git.editor).toEqual(READ.editor);
	});

	test("inherit leaves a table out, off writes false, and set writes every field", () => {
		const { editor, agent, scripts } = draftsOf(READ);
		expect("editor" in valuesWith("editor", { ...editor, mode: "inherit" }, READ)).toBe(false);
		expect(valuesWith("editor", { ...editor, mode: "off" }, READ).editor).toBe(false);
		expect(valuesWith("editor", withPreset(editor, EDITOR_PRESETS[2]!), READ).editor).toEqual({ command: "orca-ide", args: [], enabled: false, integration: "orca" });
		expect(valuesWith("agent", { ...agent, mode: "set", command: "codex", args: ["--model", "a b"], enabled: true }, READ).agent).toEqual({ command: "codex", args: ["--model", "a b"], enabled: true });
		expect(valuesWith("agent", { ...agent, mode: "set", command: "codex", waitForSetup: true }, READ).agent).toMatchObject({ wait_for_setup: true });
		// A script that spans lines stays one entry.
		expect(valuesWith("scripts", { ...scripts, preDone: ["make clean"] }, READ).hooks).toEqual({ post_create: ["bun install", "echo 'one\ntwo'"], pre_delete: ["make clean"] });
		expect(valuesWith("scripts", { ...scripts, mode: "off" }, READ).hooks).toBe(false);
	});

	test("a login typed is saved, removing one sends null, and neither is ever part of the settings", () => {
		const tracking: TrackingDraft = { ...draftsOf(READ).tracking, linearKey: SECRET };
		expect(credentialsToSave(tracking)).toEqual({ linear: { token: SECRET } });
		expect(groupChanged("tracking", tracking, READ)).toBe(true);
		expect(JSON.stringify(valuesWith("tracking", tracking, READ))).not.toContain(SECRET);
		expect(credentialsToSave({ ...tracking, linearKey: "", removeLinear: true, removeJira: true })).toEqual({ linear: null, jira: null });
		expect(credentialsToCheck(tracking, "linear")).toEqual({ linear: { token: SECRET } });
		expect(credentialsToCheck({ ...tracking, removeLinear: true }, "linear")).toBeUndefined();
		expect(credentialsToCheck(tracking, "jira")).toBeUndefined();
		expect(credentialsToSave(draftsOf(READ).tracking)).toBeUndefined();
	});

	test("Timber's messages go to the field they name, the rest to the group", () => {
		const messages = groupMessages(["hooks.post_create.1 is invalid", "<root> is invalid", "editor.command is invalid"], ["hooks.post_create", "editor.command"]);
		expect(messages.at("hooks.post_create.1")).toEqual(["hooks.post_create.1 is invalid"]);
		expect(messages.rest).toEqual(["<root> is invalid"]);
	});

	test("a check says what was checked and that nothing was saved", () => {
		expect(describeCheck({ integration: "github", ok: true, source: "github-cli", account: "sam", diagnostic: null })).toBe("GitHub accepted with the GitHub CLI login, signed in as sam. Nothing was saved.");
		expect(describeCheck({ integration: "linear", ok: false, source: "draft", account: null, diagnostic: "Linear authentication failed." })).toBe("Linear did not accept with the login typed here: Linear authentication failed. Nothing was saved.");
	});

	test("Timber's answer to a save becomes the group's outcome", () => {
		const failure = { command: "timber config apply", diagnostic: "No.", output: null };
		const credentials = { jira: "unchanged", linear: "unchanged" } as const;
		expect(outcomeOfSave({ outcome: "saved", command: "timber config apply", revision: null, credentials })).toEqual({ state: "saved" });
		expect(outcomeOfSave({ outcome: "invalid", invalidFields: ["editor.command is invalid"], failure })).toEqual({ state: "invalid", fields: ["editor.command is invalid"], failure });
		expect(outcomeOfSave({ outcome: "conflict", failure })).toEqual({ state: "conflict", failure });
		expect(outcomeOfSave({ outcome: "refused", failure })).toEqual({ state: "refused", failure });
		expect(outcomeOfSave({ outcome: "failed", failure })).toEqual({ state: "failed", failure });
	});

	test("typing puts a past outcome away, but not field messages, a conflict, or a save still running", () => {
		const failure = { command: null, diagnostic: "No.", output: null };
		const away: GroupOutcome[] = [{ state: "idle" }, { state: "saved" }, { state: "refused", failure }, { state: "failed", failure }];
		const kept: GroupOutcome[] = [{ state: "saving" }, { state: "conflict", failure }, { state: "invalid", fields: [], failure }];
		expect(away.map(typingPutsAway)).toEqual([true, true, true, true]);
		expect(kept.map(typingPutsAway)).toEqual([false, false, false]);
	});
});

const CREDENTIALS: TimberCredentialStates = {
	jira: { configured: true, state: "saved", environmentOverride: false },
	linear: { state: "none", environmentOverride: true },
};

describe("the fields of a group on screen", () => {
	test("the editor shows the presets of timber setup and its program and arguments as free-form fields", () => {
		const markup = renderToStaticMarkup(<LauncherFields kind="editor" draft={draftsOf(READ).editor} onChange={noop} scope="repository" machine={sampleMachineValues} messages={[]} />);
		for (const label of ["VS Code", "Zed", "Orca"]) expect(markup).toContain(`>${label}</button>`);
		expect(markup).toContain('value="code"');
		expect(markup).toContain('value="--new-window"');
		expect(markup).toContain("Use the machine default: Off");
	});

	test("a repository's blank field shows what it falls back to", () => {
		const markup = renderToStaticMarkup(<GitFields draft={draftsOf({}).git} onChange={noop} scope="repository" machine={{ remote: "upstream" }} messages={[]} />);
		expect(markup).toContain('placeholder="upstream (machine default)"');
		expect(markup).toContain('placeholder="Automatic"');
	});

	test("Timber's message shows at the field it names, and the field is marked", () => {
		const markup = renderToStaticMarkup(<ScriptsFields draft={draftsOf(READ).scripts} onChange={noop} scope="repository" machine={null} messages={["hooks.post_create.1 is invalid"]} />);
		expect(markup).toMatch(/aria-label="Setup script 2" aria-invalid="true"[^>]*>echo &#x27;one\ntwo&#x27;<\/textarea><span class="field-error" role="alert">Timber does not accept this value.<\/span>/);
		expect(markup).toMatch(/aria-label="Setup script 1" aria-invalid="false"/);
	});

	test("logins are never filled in: only whether one is saved, and each check shows its command", () => {
		const draft: TrackingDraft = { ...draftsOf(READ).tracking, linearKey: SECRET };
		const markup = renderToStaticMarkup(<TrackingFields draft={{ ...draft, linearKey: "" }} onChange={noop} scope="machine" machine={null} messages={[]} credentials={CREDENTIALS} checks={{}} onCheck={noop} busy={false} />);
		expect(markup).toContain("A login is saved for this Jira site.");
		expect(markup).toContain("LINEAR_API_KEY is set for the app");
		expect(markup).toContain('type="password"');
		expect(markup).not.toContain(SECRET);
		expect(markup).toContain("timber __app-config check github --scope global --input-file &lt;settings draft&gt;");
		expect(markup).toContain("timber __app-config check jira --scope global --input-file &lt;settings draft&gt;");
		expect(markup).toContain("Remove the saved Jira login");
	});

	const form = (outcome: GroupOutcome, editTracked = false, blocked: string | null = null) => renderToStaticMarkup(
		<TimberGroupForm group="git" scope="repository" outcome={outcome} canSave blocked={blocked} editTracked={editTracked} onSave={noop} onReadAgain={noop}><span /></TimberGroupForm>,
	);
	const failure = { command: "timber __app-config apply", diagnostic: "Settings at /work/timber/.timber.toml changed since they were read.", output: null };

	test("every group shows the exact save command before it runs", () => {
		expect(form({ state: "idle" })).toContain('aria-label="Branch, remote, and folder save command">timber __app-config apply --scope repository --input-file &lt;settings draft&gt; --result-file &lt;temporary file&gt;</pre>');
		expect(form({ state: "idle" }, true)).toContain("--scope repository --edit-tracked --input-file");
	});

	test("a conflict asks to read again, and says what was typed is kept", () => {
		const markup = form({ state: "conflict", failure });
		expect(markup).toContain("These settings changed outside the app");
		expect(markup).toContain("changed since they were read");
		expect(markup).toContain(">Read again</button>");
	});

	test("refused fields say nothing was saved, and Save held back says why", () => {
		const markup = form({ state: "invalid", fields: ["<root> is invalid"], failure }, false, "Tick \"Change the tracked file\" above to save.");
		expect(markup).toContain("Timber refused these settings");
		expect(markup).toContain("&lt;root&gt; is invalid");
		expect(markup).toContain("Nothing was saved.");
		expect(markup).toMatch(/aria-disabled="true" aria-describedby="[^"]+">Save</);
	});
});

describe("Timber's settings through the store and the mock engine", () => {
	test("the sections are listed under Timber, and no longer offer timber setup", async () => {
		const { store } = await startedStore();
		store.openDialog({ kind: "settings", section: "machine" });
		const markup = render(store);
		const order = ["Layout", "Editor", "Agents", "Timber", "Machine", "Repository"].map(label => markup.indexOf(`>${label}<`));
		expect(order.every(at => at >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
		expect(markup).not.toContain("Run timber setup");
	});

	test("a save Timber accepts is what the next read shows, and keeps the named workflows", async () => {
		const { store } = await startedStore();
		const read = await store.readTimberSettings({ scope: "repository", repository: TIMBER });
		if (read.outcome !== "read") throw new Error("not read");
		expect(read.command).toBe("timber __app-config read --scope repository");
		const values = valuesWith("git", { ...draftsOf(read.settings.values).git, remote: "upstream" }, read.settings.values);
		const saved = await store.saveTimberSettings({ scope: "repository", repository: TIMBER, revision: read.settings.revision, values, editTracked: true });
		expect(saved).toMatchObject({ outcome: "saved" });
		const again = await store.readTimberSettings({ scope: "repository", repository: TIMBER });
		expect(again).toMatchObject({ outcome: "read", settings: { values: { remote: "upstream", workflows: read.settings.values.workflows } } });
	});

	test("a tracked file is refused without the person's say-so, and a change in between is a conflict", async () => {
		const { store, engine } = await startedStore();
		const read = await store.readTimberSettings({ scope: "repository", repository: TIMBER });
		if (read.outcome !== "read") throw new Error("not read");
		expect(read.settings.tracked).toBe(true);
		const request = { scope: "repository" as const, repository: TIMBER, revision: read.settings.revision, values: read.settings.values, editTracked: false };
		expect(await store.saveTimberSettings(request)).toMatchObject({ outcome: "refused", failure: { diagnostic: expect.stringContaining("tracked by Git") } });
		engine.setTimberConfig(TIMBER, { remote: "origin" });
		expect(await store.saveTimberSettings({ ...request, editTracked: true })).toMatchObject({ outcome: "conflict" });
		expect(await store.readTimberSettings({ scope: "repository", repository: TIMBER })).toMatchObject({ settings: { values: { remote: "origin" } } });
	});

	test("an invalid value is refused by field, and nothing is written", async () => {
		const { store } = await startedStore();
		const read = await store.readTimberSettings({ scope: "machine", repository: null });
		if (read.outcome !== "read") throw new Error("not read");
		const result = await store.saveTimberSettings({ scope: "machine", repository: null, revision: read.settings.revision, values: { ...read.settings.values, agent: { command: " ", args: [], enabled: false } }, editTracked: false });
		expect(result).toMatchObject({ outcome: "invalid", invalidFields: ["agent.command is invalid"] });
		expect(await store.readTimberSettings({ scope: "machine", repository: null })).toEqual(read);
	});

	test("a login saved is only ever said to be saved, and a check saves nothing", async () => {
		const { store } = await startedStore();
		const read = await store.readTimberSettings({ scope: "machine", repository: null });
		if (read.outcome !== "read") throw new Error("not read");
		expect(read.settings.path).toBe(MOCK_MACHINE_CONFIG);
		const checked = await store.checkTimberConnection({ scope: "machine", repository: null, integration: "linear", values: read.settings.values, credentials: { linear: { token: SECRET } } });
		expect(checked).toMatchObject({ outcome: "checked", check: { ok: true, source: "draft" } });
		expect(await store.readTimberSettings({ scope: "machine", repository: null })).toEqual(read);
		const saved = await store.saveTimberSettings({ scope: "machine", repository: null, revision: read.settings.revision, values: read.settings.values, credentials: { linear: null }, editTracked: false });
		expect(saved).toMatchObject({ outcome: "saved", credentials: { linear: "removed" } });
		const again = await store.readTimberSettings({ scope: "machine", repository: null });
		expect(again).toMatchObject({ settings: { credentials: { linear: { state: "none" } } } });
		expect(JSON.stringify(again)).not.toContain(SECRET);
	});

	test("a file Timber cannot read, a repository not in the list, and no Timber are failures, never throws", async () => {
		const { store, engine } = await startedStore();
		engine.breakTimberConfig(TIMBER, "Invalid TOML in /work/timber/.timber.toml");
		expect(await store.readTimberSettings({ scope: "repository", repository: TIMBER })).toMatchObject({ outcome: "failed", failure: { diagnostic: "Invalid TOML in /work/timber/.timber.toml" } });
		expect(await store.readTimberSettings({ scope: "repository", repository: "/nowhere" })).toMatchObject({ outcome: "failed", failure: { command: null } });
		expect(await store.readTimberSettings({ scope: "repository", repository: API })).toMatchObject({ outcome: "read", settings: { exists: false, revision: null } });
		const { store: without } = await startedStore(createMockEngine(undefined, sampleTimberStatuses["not-found"]));
		expect(await without.readTimberSettings({ scope: "machine", repository: null })).toMatchObject({ outcome: "failed" });
		const closed = createMockEngine();
		closed.saveTimberSettings = async () => {
			throw new Error("bridge closed");
		};
		const { store: broken } = await startedStore(closed);
		expect(await broken.saveTimberSettings({ scope: "machine", repository: null, revision: null, values: {}, editTracked: false })).toMatchObject({
			outcome: "failed",
			failure: { diagnostic: expect.stringContaining("whether the settings were saved is unknown") },
		});
	});
});
