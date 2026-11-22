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
	type GroupOutcome, type TrackingDraft, credentialsToCheck, credentialsToSave, describeCheck, draftsOf, groupChanged, groupMessages, jiraDefault, outcomeOfSave,
	scopePlaceholder, typingPutsAway, valuesWith, withJiraMode, withPreset, EDITOR_PRESETS,
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

	test("inherit leaves a table out, off writes false, and set writes every drawn field", () => {
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

	/** Keys set by hand inside tables the app partly draws. */
	const HAND_SET: TimberValues = {
		...READ,
		editor: { command: "code", args: [], enabled: false, integration: "orca", later_key: "kept" },
		agent: { command: "claude", args: [], enabled: true, wait_for_setup: true, resolve_handoff: "ask", resolve_instructions: "Read NOTES.md" },
		hooks: { post_create: ["bun install"], later_key: ["kept"] },
		jira: { site_url: "https://example.atlassian.net", cloud_id: "abc", board: 123, project: "TIM", later_key: "kept" },
		github: { project: "octo/2", later_key: "kept" },
	} as TimberValues;
	const JIRA_EXTRAS = { board: 123, project: "TIM", later_key: "kept" };

	test("keys a group does not draw inside a table it sets stay as read, and an untouched group has nothing to save", () => {
		const drafts = draftsOf(HAND_SET);
		for (const group of ["editor", "agent", "git", "scripts", "tracking"] as const) {
			expect(valuesWith(group, drafts[group], HAND_SET)).toEqual(HAND_SET);
			expect(groupChanged(group, drafts[group], HAND_SET)).toBe(false);
		}
		const tracking = valuesWith("tracking", { ...drafts.tracking, tracker: "jira", siteUrl: "https://other.atlassian.net", cloudId: "xyz" }, HAND_SET);
		expect<unknown>(tracking.jira).toEqual({ site_url: "https://other.atlassian.net", cloud_id: "xyz", ...JIRA_EXTRAS });
		expect(tracking.default_tracker).toBe("jira");
		const noCloud = valuesWith("tracking", { ...drafts.tracking, cloudId: "" }, HAND_SET).jira as object;
		expect(noCloud).toEqual({ site_url: "https://example.atlassian.net", ...JIRA_EXTRAS });
		expect("cloud_id" in noCloud).toBe(false);
		expect<unknown>(valuesWith("editor", { ...drafts.editor, orca: false, command: "zed" }, HAND_SET).editor).toEqual({ command: "zed", args: [], enabled: false, later_key: "kept" });
		expect<unknown>(valuesWith("agent", { ...drafts.agent, waitForSetup: null, command: "codex" }, HAND_SET).agent)
			.toEqual({ command: "codex", args: [], enabled: true, resolve_handoff: "ask", resolve_instructions: "Read NOTES.md" });
		expect<unknown>(valuesWith("scripts", { ...drafts.scripts, preDone: ["make clean"] }, HAND_SET).hooks).toEqual({ post_create: ["bun install"], pre_delete: ["make clean"], later_key: ["kept"] });
	});

	test("switching a table with hand-set keys off or to inherit still replaces it", () => {
		const { tracking, agent, editor } = draftsOf(HAND_SET);
		expect(valuesWith("tracking", { ...tracking, jiraMode: "off" }, HAND_SET).jira).toBe(false);
		expect("jira" in valuesWith("tracking", { ...tracking, jiraMode: "inherit" }, HAND_SET)).toBe(false);
		expect(valuesWith("agent", { ...agent, mode: "off" }, HAND_SET).agent).toBe(false);
		expect("editor" in valuesWith("editor", { ...editor, mode: "inherit" }, HAND_SET)).toBe(false);
		// From off back to set, there is no table as read to keep keys from.
		const off = { ...HAND_SET, jira: false as const };
		expect(valuesWith("tracking", { ...draftsOf(off).tracking, jiraMode: "set", siteUrl: "https://example.atlassian.net" }, off).jira).toEqual({ site_url: "https://example.atlassian.net" });
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
		const markup = renderToStaticMarkup(<TrackingFields draft={{ ...draft, linearKey: "" }} onChange={noop} scope="machine" machine={null} messages={[]} values={READ} credentials={CREDENTIALS} checks={{}} onCheck={noop} busy={false} />);
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

describe("the sprint source and tracker scope as data", () => {
	const JIRA = { site_url: "https://example.atlassian.net" };
	const tracking = (change: Partial<TrackingDraft>, read: TimberValues = { jira: JIRA }) => valuesWith("tracking", { ...draftsOf(read).tracking, ...change }, read);

	test("a board or sprint JQL is set, changed, and cleared, and never both", () => {
		expect<unknown>(tracking({ sprintSource: "board", board: " 12 " }).jira).toEqual({ ...JIRA, board: 12 });
		// Text typed in the other field is never sent.
		expect<unknown>(tracking({ sprintSource: "jql", sprintJql: "sprint in openSprints()", board: "12" }).jira).toEqual({ ...JIRA, sprint_jql: "sprint in openSprints()" });
		const read: TimberValues = { jira: { ...JIRA, board: 12 } };
		const draft = draftsOf(read).tracking;
		expect(draft).toMatchObject({ sprintSource: "board", board: "12", sprintJql: "" });
		expect<unknown>(valuesWith("tracking", { ...draft, board: "34" }, read).jira).toEqual({ ...JIRA, board: 34 });
		expect<unknown>(valuesWith("tracking", { ...draft, sprintSource: "jql", sprintJql: "project = TIM" }, read).jira).toEqual({ ...JIRA, sprint_jql: "project = TIM" });
		expect<unknown>(valuesWith("tracking", { ...draft, sprintSource: "none" }, read).jira).toEqual(JIRA);
		expect<unknown>(valuesWith("tracking", { ...draft, board: "  " }, read).jira).toEqual(JIRA);
		expect<unknown>(tracking({ sprintSource: "jql", sprintJql: "   " }).jira).toEqual(JIRA);
		expect(draftsOf({ jira: { ...JIRA, sprint_jql: "project = TIM" } }).tracking).toMatchObject({ sprintSource: "jql", sprintJql: "project = TIM", board: "" });
		// A board that is not a number goes to Timber as typed, for Timber to refuse at the field.
		expect<unknown>(tracking({ sprintSource: "board", board: "twelve" }).jira).toEqual({ ...JIRA, board: "twelve" });
		expect<unknown>(tracking({ sprintSource: "board", board: "1.5" }).jira).toEqual({ ...JIRA, board: "1.5" });
		// Zero is a whole number, sent for Timber to refuse; one past what JSON keeps exactly goes as text.
		expect<unknown>(tracking({ sprintSource: "board", board: "0" }).jira).toEqual({ ...JIRA, board: 0 });
		expect<unknown>(tracking({ sprintSource: "board", board: "99999999999999999999" }).jira).toEqual({ ...JIRA, board: "99999999999999999999" });
		// Spaces around a key are left out, as Timber's checks of keys would refuse them.
		expect(tracking({ jiraProject: " TIM ", githubProject: " octo/2 ", linearTeam: " ENG " })).toMatchObject({ jira: { project: "TIM" }, github: { project: "octo/2" }, linear: { team: "ENG" } });
	});

	test("the Jira project, GitHub's project and milestone, and Linear's team are set, changed, and cleared", () => {
		expect<unknown>(tracking({ jiraProject: "TIM" }).jira).toEqual({ ...JIRA, project: "TIM" });
		expect<unknown>(valuesWith("tracking", { ...draftsOf({ jira: { ...JIRA, project: "TIM" } }).tracking, jiraProject: "" }, { jira: { ...JIRA, project: "TIM" } }).jira).toEqual(JIRA);
		expect(tracking({ githubProject: "octo/2", githubMilestone: "v0.3", linearTeam: "ENG" }, {})).toEqual({ github: { project: "octo/2", milestone: "v0.3" }, linear: { team: "ENG" } });
		const set: TimberValues = { github: { project: "octo/2", milestone: "v0.3" }, linear: { team: "ENG" } };
		expect<unknown>(tracking({ githubMilestone: "v0.4" }, set).github).toEqual({ project: "octo/2", milestone: "v0.4" });
		expect<unknown>(tracking({ githubProject: "" }, set).github).toEqual({ milestone: "v0.3" });
		// Every field cleared: the table goes, so the machine's applies again.
		const cleared = tracking({ githubProject: "", githubMilestone: "", linearTeam: "" }, set);
		expect("github" in cleared || "linear" in cleared).toBe(false);
		// A table switched off, or left empty by hand, stays as read while nothing is typed in it.
		for (const read of [{ github: false, linear: false }, { github: {}, linear: {} }] as TimberValues[]) {
			expect(tracking({}, read)).toEqual(read);
			expect(groupChanged("tracking", draftsOf(read).tracking, read)).toBe(false);
		}
		expect<unknown>(tracking({ githubMilestone: "v0.3" }, { github: false }).github).toEqual({ milestone: "v0.3" });
	});

	const MACHINE: TimberValues = { jira: { site_url: "https://machine.atlassian.net", board: 7, project: "OPS" }, github: { milestone: "v1" }, linear: { team: "OPS" } };

	test("a repository shows what it inherits, and its own Jira site starts from the machine's", () => {
		expect(jiraDefault("repository", MACHINE)).toBe("https://machine.atlassian.net, board 7, project OPS");
		const fresh = draftsOf({}).tracking;
		expect(withJiraMode(fresh, "set", "repository", MACHINE)).toMatchObject({ jiraMode: "set", siteUrl: "https://machine.atlassian.net", sprintSource: "board", board: "7", jiraProject: "OPS" });
		expect(withJiraMode(fresh, "set", "machine", null)).toEqual({ ...fresh, jiraMode: "set" });
		expect(withJiraMode({ ...fresh, siteUrl: "https://mine.atlassian.net" }, "set", "repository", MACHINE)).toMatchObject({ siteUrl: "https://mine.atlassian.net", board: "" });
		expect(scopePlaceholder("github", "milestone", fresh, "repository", MACHINE, {})).toBe("v1 (machine default)");
		expect(scopePlaceholder("github", "project", fresh, "repository", MACHINE, {})).toBe("Not set");
		// One GitHub field set here replaces the machine's table, milestone included.
		expect(scopePlaceholder("github", "milestone", { ...fresh, githubProject: "octo/2" }, "repository", MACHINE, {})).toBe("Not set");
		expect(scopePlaceholder("linear", "team", fresh, "repository", MACHINE, {})).toBe("OPS (machine default)");
		expect(scopePlaceholder("linear", "team", fresh, "machine", MACHINE, {})).toBe("Not set");
		// A table of the repository's own, switched off or left empty by hand, shadows the machine's.
		for (const own of [false, {}] as const) {
			const values: TimberValues = { github: own, linear: own };
			expect(scopePlaceholder("github", "milestone", draftsOf(values).tracking, "repository", MACHINE, values)).toBe("Not set");
			expect(scopePlaceholder("linear", "team", draftsOf(values).tracking, "repository", MACHINE, values)).toBe("Not set");
		}
	});

	test("the fields draw only the chosen sprint source, and Timber's messages land on them", () => {
		const draft: TrackingDraft = { ...draftsOf({ jira: { ...JIRA, board: 12 } }).tracking, githubProject: "octo" };
		const markup = renderToStaticMarkup(
			<TrackingFields draft={draft} onChange={noop} scope="repository" machine={MACHINE} messages={["jira.sprint_jql is invalid", "github.project is invalid"]} values={{ jira: { ...JIRA, board: 12 } }} credentials={CREDENTIALS} checks={{}} onCheck={noop} busy={false} />,
		);
		expect(markup).toContain(">Current sprint from</legend>");
		expect(markup).toMatch(/>Board ID<\/label><input[^>]*inputMode="numeric" aria-invalid="true"[^>]*value="12"\/>.*?<span[^>]*class="field-error" role="alert">Timber does not accept this value.<\/span>/);
		expect(markup).not.toContain(">Sprint JQL<");
		expect(markup).toMatch(/>Project<\/label><input[^>]*aria-invalid="true"[^>]*value="octo"/);
		expect(markup).toMatch(/>Team<\/label><input[^>]*placeholder="OPS \(machine default\)"/);
		const inherited = renderToStaticMarkup(
			<TrackingFields draft={draftsOf({}).tracking} onChange={noop} scope="repository" machine={MACHINE} messages={[]} values={{}} credentials={CREDENTIALS} checks={{}} onCheck={noop} busy={false} />,
		);
		expect(inherited).toContain("Use the machine default: https://machine.atlassian.net, board 7, project OPS");
		expect(inherited).not.toContain(">Board ID<");
		expect(inherited).toContain("choose &quot;This site&quot; to set them");
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

	test("a board that is not a number, or a board with JQL, is refused at its field, and nothing is written", async () => {
		const { store } = await startedStore();
		const read = await store.readTimberSettings({ scope: "repository", repository: TIMBER });
		if (read.outcome !== "read") throw new Error("not read");
		const draft = draftsOf(read.settings.values).tracking;
		const request = { scope: "repository" as const, repository: TIMBER, revision: read.settings.revision, editTracked: true };
		const word = await store.saveTimberSettings({ ...request, values: valuesWith("tracking", { ...draft, board: "twelve" }, read.settings.values) });
		expect(word).toMatchObject({ outcome: "invalid", invalidFields: ["jira.board is invalid"] });
		const both = await store.saveTimberSettings({ ...request, values: { ...read.settings.values, jira: { site_url: "https://example.atlassian.net", board: 3, sprint_jql: "x" } } });
		expect(both).toMatchObject({ outcome: "invalid", invalidFields: ["jira.sprint_jql is invalid"] });
		expect(await store.readTimberSettings({ scope: "repository", repository: TIMBER })).toEqual(read);
		// Accepted, a project key and a team come back as Timber keeps them, in capitals.
		const saved = await store.saveTimberSettings({ ...request, values: valuesWith("tracking", { ...draft, jiraProject: "tim", linearTeam: "eng", githubMilestone: "v0.3" }, read.settings.values) });
		expect(saved).toMatchObject({ outcome: "saved" });
		expect(await store.readTimberSettings({ scope: "repository", repository: TIMBER })).toMatchObject({
			settings: { values: { jira: { site_url: "https://example.atlassian.net", board: 14, project: "TIM" }, linear: { team: "ENG" }, github: { milestone: "v0.3" } } },
		});
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
