import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { IntegrationsView, TimberFileView } from "../src/mainview/components/settings/TimberSections";
import { createMockEngine, sampleRepositories, sampleUnavailableRepository } from "../src/mainview/engine/mock";
import { MOCK_MACHINE_CONFIG, sampleMachineConfig } from "../src/mainview/engine/mock-timber-config";
import { timberSetupTarget } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { type TimberConfigFile, readTimberConfig } from "../src/shared/timber-config";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const API = "/work/api-server";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const featureId = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === FEATURE)!.id;
const SECRET = "ghp_SuperSecretToken123";

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	store.select(featureId);
	return { engine, store };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

describe("the Timber sections of Settings", () => {
	test("are listed under Timber, after the app's own sections", async () => {
		const { store } = await startedStore();
		store.openDialog({ kind: "settings", section: "machine" });
		const markup = render(store);
		const order = ["Layout", "Editor", "Agents", "Timber", "Machine", "Repository"].map(label => markup.indexOf(`>${label}<`));
		expect(order.every(at => at >= 0)).toBe(true);
		expect([...order].sort((a, b) => a - b)).toEqual(order);
	});

	test("show the exact setup command and where it runs before anything runs", async () => {
		const { store, engine } = await startedStore();
		store.openDialog({ kind: "settings", section: "machine" });
		const markup = render(store);
		expect(markup).toContain(`Runs in ${FEATURE}`);
		expect(markup).toContain('aria-label="Setup command">timber setup --global</pre>');
		// The repository of the selected worktree shows first, and its setup runs in its primary checkout.
		expect(markup).toMatch(/<option value="\/work\/timber" selected="">timber<\/option>/);
		expect(markup).toContain(`Runs in ${TIMBER}</span><pre class="dialog-command" aria-label="Setup command">timber setup</pre>`);
		expect(await engine.listTerminals()).toEqual([]);
	});

	test("say when there is no repository to show or to run setup in", async () => {
		const { store } = await startedStore(createMockEngine([]));
		store.openDialog({ kind: "settings", section: "repository" });
		const markup = render(store);
		expect(markup).toContain("Add a repository to see its settings.");
		expect(markup).toContain("a session needs a worktree. Add a repository first.");
		expect(markup).toMatch(/<button type="button" class="button primary" disabled="" aria-describedby="[^"]+">Run timber setup<\/button>/);
	});
});

describe("one of Timber's files on screen", () => {
	const html = (file: TimberConfigFile, scope: "machine" | "repository", machine: TimberConfigFile | null = null) =>
		renderToStaticMarkup(<TimberFileView file={file} scope={scope} machine={machine} />);

	test("a repository with no .timber.toml shows as not configured and offers setup, with no values", () => {
		const markup = html({ state: "missing", path: "/work/api-server/.timber.toml" }, "repository", sampleMachineConfig);
		expect(markup).toContain("Not configured");
		expect(markup).toContain("This repository has no .timber.toml");
		expect(markup).toContain("Run timber setup");
		expect(markup).not.toContain("timber-setting");
	});

	test("a malformed file shows an error that names each problem, and no values", () => {
		const markup = html({ state: "error", path: "/x", message: "Timber cannot use these settings.", problems: ["editor is invalid"] }, "machine");
		expect(markup).toContain('role="alert"');
		expect(markup).toContain("Timber cannot use these settings.");
		expect(markup).toContain("editor is invalid");
		expect(markup).not.toContain("timber-setting");
	});

	test("values match the file, and what it does not set says where it comes from", () => {
		const file = readTimberConfig("/r/.timber.toml", `base_branch = "develop"\n[hooks]\npost_create = ["make", "make test"]\n`, text => Bun.TOML.parse(text));
		const markup = html(file, "repository", sampleMachineConfig);
		expect(markup).toContain('<dt class="timber-setting-label">Starting branch</dt><dd class="timber-setting-value"><span class="mono">develop</span></dd>');
		expect(markup).toContain('<dt class="timber-setting-label">Setup scripts</dt><dd class="timber-setting-value"><span>2 scripts</span></dd>');
		expect(markup).toContain("<span>claude (starts by itself)</span><span class=\"timber-setting-note\">From the machine defaults</span>");
		expect(markup).toContain("<span>Automatic</span><span class=\"timber-setting-note\">Timber&#x27;s default</span>");
	});

	test("never shows a secret from arguments, scripts, or keys the app does not know", () => {
		const source = `[agent]\ncommand = "claude"\nargs = ["--key", "${SECRET}"]\n[hooks]\npost_create = ["export T=${SECRET}"]\n[private]\ntoken = "${SECRET}"\n`;
		const markup = html(readTimberConfig("/r/.timber.toml", source, text => Bun.TOML.parse(text)), "repository", null);
		expect(markup).toContain("claude, plus 2 arguments");
		expect(markup).toContain("1 script");
		expect(markup).toContain('<span class="mono">private</span>');
		expect(markup).not.toContain(SECRET);
	});

	test("integrations show only whether they are configured", () => {
		const markup = renderToStaticMarkup(<IntegrationsView reading={{
			state: "read",
			value: { github: { state: "configured", source: "github-cli" }, jira: { state: "not-configured" }, linear: { state: "unknown", reason: "Could not tell." } },
		}} />);
		expect(markup).toContain("Configured: signed in with the GitHub CLI");
		expect(markup).toContain("<dt class=\"timber-setting-label\">Jira</dt><dd class=\"timber-setting-value\">Not configured</dd>");
		expect(markup).toContain("Could not tell.");
	});
});

describe("running timber setup", () => {
	test("closes Settings and starts setup in the repository's primary checkout, shown in the workspace", async () => {
		const { store, engine } = await startedStore();
		store.openDialog({ kind: "settings", section: "repository" });
		store.showTab("changes");
		await store.runTimberSetup("repository", API);
		const state = store.getState();
		expect(state.dialog).toBeNull();
		expect(state.tab).toBe("workspace");
		const primary = sampleRepositories[1]!.worktrees.find(worktree => worktree.primary)!;
		expect(state.selection).toEqual({ repository: API, worktree: primary.id });
		const [session] = await engine.listTerminals();
		expect(session).toMatchObject({ kind: "timber", name: "Timber setup", path: primary.path, command: "/home/sam/.local/bin/timber setup" });
		expect(state.shownSessions[primary.id]).toBe(session!.id);
	});

	test("for the machine runs with --global in the selected worktree", async () => {
		const { store, engine } = await startedStore();
		await store.runTimberSetup("machine", null);
		const [session] = await engine.listTerminals();
		expect(session).toMatchObject({ kind: "timber", path: FEATURE, command: "/home/sam/.local/bin/timber setup --global" });
	});

	test("that cannot start says why in the worktree's pane", async () => {
		const { store, engine } = await startedStore();
		engine.failTerminals({ outcome: "unsupported", message: "Not here." });
		await store.runTimberSetup("machine", null);
		expect(store.getState().terminalProblem).toMatchObject({ worktree: featureId, agent: "Timber setup", message: "Not here." });
	});

	test("goes where a session can start, or says why it cannot", () => {
		const repositories = [sampleUnavailableRepository, ...sampleRepositories];
		expect(timberSetupTarget({ repositories, selection: null }, "machine", null)).toMatchObject({ ok: true, repository: TIMBER, worktree: { primary: true } });
		expect(timberSetupTarget({ repositories, selection: null }, "repository", sampleUnavailableRepository.path)).toMatchObject({ ok: false });
		expect(timberSetupTarget({ repositories, selection: null }, "repository", "/nowhere")).toEqual({ ok: false, reason: "Choose a repository first." });
		expect(timberSetupTarget({ repositories: [], selection: null }, "machine", null)).toMatchObject({ ok: false });
	});
});

describe("reading Timber's settings through the store", () => {
	test("answers both files, a repository without a file as missing", async () => {
		const { store } = await startedStore();
		const settings = await store.readTimberSettings(API);
		expect(settings).toEqual({ machine: { ...sampleMachineConfig, path: MOCK_MACHINE_CONFIG }, repository: { state: "missing", path: `${API}/.timber.toml` } });
	});

	test("an engine that does not answer is a reason, never a throw", async () => {
		const engine = createMockEngine();
		engine.readTimberSettings = async () => {
			throw new Error("bridge closed");
		};
		const { store } = await startedStore(engine);
		expect(await store.readTimberSettings(null)).toBe("The app did not hear back: bridge closed");
	});
});
