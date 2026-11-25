import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createSavedPreferences } from "../src/bun/preferences";
import { createRepositoryList } from "../src/bun/repository-list";
import type { RepositoryReader } from "../src/bun/repository-reader";
import { createSettingsHolder } from "../src/bun/settings";
import { App } from "../src/mainview/App";
import { GONE_PICK, agentDraftsOf, agentsDraftModel, editAgentDraft, removeAgentDraft, repositoryDefaultChange, repositoryDefaultRows } from "../src/mainview/agent-format";
import { describeNewAgentChoice, describePromptCopiedNoAgentFound, noNewPromptAgent } from "../src/mainview/chop-format";
import { chopsPanelModel } from "../src/mainview/chops-panel-format";
import { ApproveChopDialog } from "../src/mainview/components/ApproveChopDialog";
import { AgentsSectionView } from "../src/mainview/components/settings/AgentsSection";
import { agentPickHint, chosenAgent, plannedAgent } from "../src/mainview/components/worktree-modes/agent-choice";
import { createWorktreeDialogController } from "../src/mainview/components/worktree-modes/dialog-controller";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { handoffNoAgent, handoffSession } from "../src/mainview/handoff-format";
import { describeNewReviewAgent, noNewReviewAgent, noNewReviewChoice, noReviewAgent } from "../src/mainview/review-format";
import { describeRunChopRow, runChopModel } from "../src/mainview/run-chop-format";
import { StoreProvider } from "../src/mainview/store/react";
import { repositoryPick, sessionsOf } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { createSubmission } from "../src/mainview/store/submission";
import { type AgentSetting, DEFAULT_AGENTS } from "../src/shared/agent";
import { type AgentLocation, type AgentLookup, type MissingPick, defaultAgent, defaultAgentKnown, defaultAgentName, describeMissingPick, whyNoDefaultAgent } from "../src/shared/agent-lookup";
import { type PersonalChop, noPromptAgent } from "../src/shared/chops";
import type { WorktreeHandoff } from "../src/shared/handoff";
import { pickOf, readRepositoryAgentChange, repositoryAgentsOf, withRepositoryAgents } from "../src/shared/repository-agents";
import { parseSettings, serializeSettings } from "../src/shared/settings";
import { git, makeRepository } from "./support/timber";

/** A repository's default agent, as it is picked in Settings, saved, and followed wherever no agent was named. */

const [CLAUDE, CODEX] = DEFAULT_AGENTS as [AgentSetting, AgentSetting];
const TIMBER = "/work/timber";
const OTHER = sampleRepositories[1]!.path;
const FEATURE = sampleRepositories[0]!.worktrees[1]!;
const SIZE = { cols: 80, rows: 24 };
const NOT_FOUND: MissingPick = { name: "Codex", state: "not-found" };

function located(states: Record<string, AgentLookup["state"] | "unknown"> = {}): AgentLocation[] {
	return DEFAULT_AGENTS.flatMap(({ name, command }) => {
		const state = states[name] ?? "found";
		if (state === "unknown") return [];
		return [{ name, command, lookup: state === "not-found" ? { state } : state === "unusable" ? { state, message: "A batch file." } : { state, path: `/bin/${command}` } }];
	});
}

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};

async function startedStore(pick: string | null = "Codex") {
	const engine = createMockEngine();
	if (pick !== null) expect(await engine.savePreferences({}, { [TIMBER]: pick })).toMatchObject({ outcome: "saved" });
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	store.select(FEATURE.id);
	return { engine, store };
}

describe("the default agent", () => {
	test("with a pick, is that agent when it was found, whatever is known of the others", () => {
		expect(defaultAgent(DEFAULT_AGENTS, located(), "Codex")).toEqual(CODEX);
		expect(defaultAgent(DEFAULT_AGENTS, located({ "Claude Code": "unknown" }), "Codex")).toEqual(CODEX);
		expect(defaultAgent(DEFAULT_AGENTS, located({ "Claude Code": "not-found" }), "Codex")).toEqual(CODEX);
	});

	test("with a pick that cannot start, is none, and says which is missing", () => {
		expect(defaultAgent(DEFAULT_AGENTS, located({ Codex: "not-found" }), "Codex")).toBeNull();
		expect(whyNoDefaultAgent(DEFAULT_AGENTS, located({ Codex: "not-found" }), "Codex")).toEqual(NOT_FOUND);
		expect(defaultAgent(DEFAULT_AGENTS, located({ Codex: "unusable" }), "Codex")).toBeNull();
		expect(whyNoDefaultAgent(DEFAULT_AGENTS, located({ Codex: "unusable" }), "Codex")).toEqual({ name: "Codex", state: "unusable" });
		expect(defaultAgent(DEFAULT_AGENTS, located(), "Aider")).toBeNull();
		expect(whyNoDefaultAgent(DEFAULT_AGENTS, located(), "Aider")).toEqual({ name: "Aider", state: "not-saved" });
		expect(describeMissingPick(NOT_FOUND)).toBe("Codex, this repository's default agent, was not found");
		expect(describeMissingPick({ name: "Codex", state: "unusable" })).toBe("Codex, this repository's default agent, cannot start");
		expect(describeMissingPick({ name: "Aider", state: "not-saved" })).toBe("Aider, this repository's default agent, is not saved in Settings, Agents");
	});

	test("while the pick's own look has not answered, is none, and not known", () => {
		for (const locations of [null, located({ Codex: "unknown" })]) {
			expect(defaultAgent(DEFAULT_AGENTS, locations, "Codex")).toBeNull();
			expect(whyNoDefaultAgent(DEFAULT_AGENTS, locations, "Codex")).toBe("not-known");
			expect(defaultAgentKnown(DEFAULT_AGENTS, locations, "Codex")).toBe(false);
			expect(defaultAgentName(DEFAULT_AGENTS, locations, "Codex")).toBe("Codex");
		}
	});

	test("with no pick, is the first saved agent found, as before", () => {
		expect(defaultAgent(DEFAULT_AGENTS, located(), null)).toEqual(CLAUDE);
		expect(defaultAgent(DEFAULT_AGENTS, located({ "Claude Code": "not-found" }), null)).toEqual(CODEX);
		expect(defaultAgent(DEFAULT_AGENTS, located({ Codex: "unknown" }), null)).toBeNull();
		expect(whyNoDefaultAgent(DEFAULT_AGENTS, located({ "Claude Code": "not-found", Codex: "unusable" }), null)).toBe("none-found");
		expect(whyNoDefaultAgent(DEFAULT_AGENTS, null, null)).toBe("not-known");
		expect(whyNoDefaultAgent([], [], null)).toBe("none-saved");
	});

	test("while the picks were not read, is none", () => {
		expect(defaultAgent(DEFAULT_AGENTS, located(), undefined)).toBeNull();
		expect(whyNoDefaultAgent(DEFAULT_AGENTS, located(), undefined)).toBe("not-known");
		expect(repositoryPick({ repositoryAgents: null }, TIMBER)).toBeUndefined();
		expect(repositoryPick({ repositoryAgents: {} }, TIMBER)).toBeNull();
	});
});

describe("saving picks", () => {
	const entries = [{ path: "/a", agent: "Codex" }, { path: "/b" }, { path: "/c", agent: "Aider" }];

	test("sets, clears, and skips a path that is not listed", () => {
		expect(withRepositoryAgents(entries, { "/a": null, "/b": "Claude Code", "/gone": "Codex" }, DEFAULT_AGENTS, DEFAULT_AGENTS)).toEqual({
			ok: true, changed: true, entries: [{ path: "/a" }, { path: "/b", agent: "Claude Code" }, { path: "/c", agent: "Aider" }],
		});
		expect(withRepositoryAgents(entries, {}, DEFAULT_AGENTS, DEFAULT_AGENTS)).toEqual({ ok: true, changed: false, entries });
	});

	test("refuses a name that is not saved", () => {
		expect(withRepositoryAgents(entries, { "/b": "Nobody" }, DEFAULT_AGENTS, DEFAULT_AGENTS)).toMatchObject({ ok: false, message: expect.stringContaining("Nobody") });
	});

	test("clears the picks of an agent that goes, and no other; a rename keeps them", () => {
		expect(withRepositoryAgents(entries, {}, DEFAULT_AGENTS, [CLAUDE])).toEqual({ ok: true, changed: true, entries: [{ path: "/a" }, { path: "/b" }, { path: "/c", agent: "Aider" }] });
		const renamed = [CLAUDE, { ...CODEX, name: "My Codex" }];
		expect(withRepositoryAgents(entries, { "/a": "My Codex" }, DEFAULT_AGENTS, renamed)).toMatchObject({ ok: true, entries: [{ path: "/a", agent: "My Codex" }, { path: "/b" }, { path: "/c", agent: "Aider" }] });
	});

	test("reads only names and nulls from outside", () => {
		expect(readRepositoryAgentChange({ "/a": "Codex", "/b": null })).toEqual({ "/a": "Codex", "/b": null });
		for (const value of [null, [], "x", { "/a": "" }, { "/a": 3 }, { "/a": " Codex" }, { "": "Codex" }]) expect(readRepositoryAgentChange(value)).toBeUndefined();
		expect(pickOf(repositoryAgentsOf(entries), "/a")).toBe("Codex");
		expect(pickOf({}, "toString")).toBeNull();
	});

	test("the settings file keeps a pick, drops one that is no name, and stays as it was without one", () => {
		const one = { path: "/a", commonDir: "/a/.git" };
		const text = serializeSettings({ repositories: [{ ...one, agent: "Codex" }] });
		expect(parseSettings(text)).toEqual({ repositories: [{ ...one, agent: "Codex" }] });
		expect(serializeSettings({ repositories: [one] })).not.toContain("agent");
		for (const agent of [3, "", " Codex", null]) expect(parseSettings(JSON.stringify({ version: 1, repositories: [{ ...one, agent }] }))).toEqual({ repositories: [one] });
		// A name no agent has is kept: it starts nothing, rather than another agent.
		expect(parseSettings(JSON.stringify({ version: 1, repositories: [{ ...one, agent: "Aider" }] }))?.repositories[0]?.agent).toBe("Aider");
	});
});

describe("the picks in the main process", () => {
	let root: string;
	let settingsFile: string;
	let first: string;
	let second: string;
	let cases = 0;
	const reader: RepositoryReader = {
		find: async folder => ({ outcome: "read", repository: { path: folder, name: basename(folder), available: true, failure: null, setup: "unknown", fallbackBase: null, worktrees: [] } }),
		reload: async path => ({ path, name: basename(path), available: true, failure: null, setup: "unknown", fallbackBase: null, worktrees: [] }),
	};
	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-repository-agents-")));
		makeRepository(root, "first");
		makeRepository(root, "second");
		first = join(root, "first");
		second = join(root, "second");
	});
	beforeEach(() => {
		settingsFile = join(root, `config-${cases++}`, "settings.json");
		mkdirSync(dirname(settingsFile), { recursive: true });
		// As written before repositories could name an agent, with a group.
		writeFileSync(settingsFile, JSON.stringify({ version: 1, groups: [{ id: "g", name: "Work" }], repositories: [{ path: first, commonDir: join(first, ".git"), group: "g" }, { path: second, commonDir: join(second, ".git") }] }));
	});
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	function appOn(environment: Record<string, string | undefined> = {}) {
		const settings = createSettingsHolder(settingsFile, () => {});
		return {
			preferences: createSavedPreferences(settings, environment),
			list: createRepositoryList({ settingsFile, settings, pickFolder: async () => null, reader, environment, warn: () => {} }),
		};
	}
	const onDisk = () => JSON.parse(readFileSync(settingsFile, "utf8"));

	test("a file from before has none; a pick alone is written and survives a restart, and clearing it takes it out", async () => {
		expect(await appOn().list.listAgents()).toEqual({});
		// The preferences do not change, and the pick is written all the same.
		await appOn().preferences.save({ sidebarSide: "left" });
		expect(await appOn().preferences.save({}, { [first]: "Codex" })).toMatchObject({ outcome: "saved", repositoryAgents: { [first]: "Codex" } });
		expect(await appOn().list.listAgents()).toEqual({ [first]: "Codex" });
		expect(await appOn().list.agentOf(first)).toBe("Codex");
		expect(await appOn().list.agentOf(second)).toBeNull();
		expect(onDisk().repositories[0]).toEqual({ path: first, commonDir: join(first, ".git"), group: "g", agent: "Codex" });
		expect(await appOn().preferences.save({}, { [first]: null })).toMatchObject({ outcome: "saved", repositoryAgents: {} });
		expect(onDisk().repositories[0]).toEqual({ path: first, commonDir: join(first, ".git"), group: "g" });
		expect(git(first, "status", "--porcelain")).toBe("");
	});

	test("moving the repository keeps it, and removing the repository drops it, so adding it again starts with none", async () => {
		const { preferences, list } = appOn();
		await preferences.save({}, { [first]: "Codex" });
		await list.place(first, null);
		await list.reorder([second, first]);
		expect(await list.listAgents()).toEqual({ [first]: "Codex" });
		await list.remove(first);
		expect(await list.listAgents()).toEqual({});
		await list.addFolder(first);
		expect(await appOn().list.listAgents()).toEqual({});
	});

	test("a rename follows in the same save, a removed agent clears it, and a save of other settings answers no picks", async () => {
		const { preferences, list } = appOn();
		await preferences.save({}, { [first]: "Codex", [second]: "Claude Code" });
		await preferences.save({ agents: [CLAUDE, { ...CODEX, name: "My Codex" }] }, { [first]: "My Codex" });
		expect(await list.listAgents()).toEqual({ [first]: "My Codex", [second]: "Claude Code" });
		expect(await preferences.save({ agents: [CLAUDE] })).toMatchObject({ outcome: "saved", repositoryAgents: { [second]: "Claude Code" } });
		expect(await appOn().list.listAgents()).toEqual({ [second]: "Claude Code" });
		expect(await preferences.save({ sidebarSide: "right" })).not.toHaveProperty("repositoryAgents");
	});

	test("a pick that cannot be saved saves nothing, not the agents either", async () => {
		const { preferences } = appOn();
		await preferences.save({}, { [first]: "Codex" });
		const before = readFileSync(settingsFile, "utf8");
		expect(await preferences.save({ agents: [CLAUDE] }, { [second]: "Nobody" })).toMatchObject({ outcome: "failed" });
		expect(await preferences.save({ agents: [CLAUDE] }, { [second]: 3 } as never)).toMatchObject({ outcome: "failed" });
		expect(readFileSync(settingsFile, "utf8")).toBe(before);
	});

	test("a repository removed while Settings was open is never written back", async () => {
		const { preferences, list } = appOn();
		await list.remove(second);
		expect(await preferences.save({}, { [second]: "Codex" })).toMatchObject({ outcome: "saved", repositoryAgents: {} });
		expect(onDisk().repositories).toHaveLength(1);
	});

	test("under the development override there are none, and the saved ones stay as they are", async () => {
		await appOn().preferences.save({}, { [first]: "Codex" });
		const { preferences, list } = appOn({ TIMBER_APP_REPOS: first });
		expect(await list.listAgents()).toEqual({});
		expect(await list.agentOf(first)).toBeNull();
		expect(await preferences.save({}, { [first]: "Claude Code" })).toMatchObject({ outcome: "failed", message: expect.stringContaining("TIMBER_APP_REPOS") });
		expect(await preferences.save({ agents: [CLAUDE] })).toMatchObject({ outcome: "saved", repositoryAgents: {} });
		expect(onDisk().repositories[0].agent).toBe("Codex");
	});
});

describe("Settings, Agents: Default agent by repository", () => {
	const repositories = [{ path: "/a", name: "app" }, { path: "/b", name: "api" }];
	const drafts = agentDraftsOf(DEFAULT_AGENTS);
	const rowsFor = (edited: typeof drafts, picked: Record<string, string> = {}, picks: Record<string, string> = { "/a": "Codex" }) =>
		repositoryDefaultRows(repositories, picks, drafts, edited, agentsDraftModel(edited, DEFAULT_AGENTS).agents, picked);

	test("a saved pick is held by its row: a rename follows and a removal clears", () => {
		expect(rowsFor(drafts)).toEqual([{ path: "/a", name: "app", key: drafts[1]!.key, agent: "Codex" }, { path: "/b", name: "api", key: "", agent: null }]);
		expect(repositoryDefaultChange(rowsFor(drafts), { "/a": "Codex" })).toEqual({});
		expect(repositoryDefaultChange(rowsFor(editAgentDraft(drafts, drafts[1]!.key, { name: "My Codex" })), { "/a": "Codex" })).toEqual({ "/a": "My Codex" });
		expect(repositoryDefaultChange(rowsFor(removeAgentDraft(drafts, drafts[1]!.key)), { "/a": "Codex" })).toEqual({ "/a": null });
		expect(repositoryDefaultChange(rowsFor(drafts, { "/a": "", "/b": drafts[0]!.key }), { "/a": "Codex" })).toEqual({ "/a": null, "/b": "Claude Code" });
	});

	test("a pick no agent is saved under stays until another is chosen", () => {
		expect(rowsFor(drafts, {}, { "/a": "Aider" })[0]).toEqual({ path: "/a", name: "app", key: GONE_PICK, agent: "Aider" });
		expect(repositoryDefaultChange(rowsFor(drafts, {}, { "/a": "Aider" }), { "/a": "Aider" })).toEqual({});
		expect(repositoryDefaultChange(rowsFor(drafts, { "/a": "" }, { "/a": "Aider" }), { "/a": "Aider" })).toEqual({ "/a": null });
	});

	test("draws each repository with First agent found and the saved agents", () => {
		const noop = () => {};
		const draw = (rows: ReturnType<typeof rowsFor>) => renderToStaticMarkup(
			<AgentsSectionView drafts={drafts} saved={DEFAULT_AGENTS} locations={null} save={{ state: "idle" }} onAdd={noop} onEdit={noop} onRemove={noop} onSave={noop} repositoryDefaults={{ rows, changed: true, onChange: noop }} />,
		);
		const markup = draw(rowsFor(drafts, {}, { "/a": "Aider" }));
		expect(markup).toContain("Default agent by repository");
		expect(markup).toContain("First agent found");
		expect(markup).toContain(`<option value="${drafts[1]!.key}">Codex</option>`);
		expect(markup).toContain("Aider (not saved)");
		expect(markup).toContain('aria-disabled="false"');
		expect(draw([])).toContain("No repositories are in the app yet.");
	});

	test("the store and the mock save, rename, clear, and drop it with its repository", async () => {
		const { engine, store } = await startedStore(null);
		expect(repositoryPick(store.getState(), TIMBER)).toBeNull();
		expect(await store.savePreferences({}, { [TIMBER]: "Codex", [OTHER]: "Codex" })).toMatchObject({ outcome: "saved" });
		expect(repositoryPick(store.getState(), TIMBER)).toBe("Codex");
		// As after a restart: another window reads what the engine kept.
		const again = createAppStore(engine, () => () => {});
		again.start();
		await settle();
		expect(repositoryPick(again.getState(), TIMBER)).toBe("Codex");
		await store.savePreferences({ agents: [CLAUDE, { ...CODEX, name: "My Codex" }] }, { [TIMBER]: "My Codex", [OTHER]: "My Codex" });
		expect(store.getState().repositoryAgents).toEqual({ [TIMBER]: "My Codex", [OTHER]: "My Codex" });
		await store.removeRepository(OTHER);
		expect(store.getState().repositoryAgents).toEqual({ [TIMBER]: "My Codex" });
		expect(await engine.listRepositoryAgents()).toEqual({ [TIMBER]: "My Codex" });
		await store.savePreferences({ agents: [CLAUDE] });
		expect(store.getState().repositoryAgents).toEqual({});
		expect(await store.savePreferences({}, { [TIMBER]: "Nobody" })).toMatchObject({ outcome: "failed" });
	});

	test("a read asked for before a save answered does not undo it, and one that fails keeps what was known", async () => {
		const { engine, store } = await startedStore();
		const list = engine.listRepositoryAgents;
		let answer: (picks: Record<string, string>) => void = () => {};
		engine.listRepositoryAgents = () => new Promise(resolve => {
			answer = resolve;
		});
		const reading = store.refresh();
		await settle();
		await store.savePreferences({}, { [TIMBER]: "Claude Code" });
		answer({ [TIMBER]: "Codex" });
		await reading;
		expect(repositoryPick(store.getState(), TIMBER)).toBe("Claude Code");
		engine.listRepositoryAgents = () => Promise.reject(new Error("gone"));
		await store.refresh();
		expect(repositoryPick(store.getState(), TIMBER)).toBe("Claude Code");
		engine.listRepositoryAgents = list;
	});
});

describe("the New worktree and Start work dialogs with a pick", () => {
	const planned = (agent: AgentSetting | null) => ({ source: "pick" as const, agent, workflow: null, unread: false });

	test("pre-select it, and the hint names it as the repository's default", () => {
		expect(chosenAgent(DEFAULT_AGENTS, undefined, located(), "Codex")).toEqual(CODEX);
		// A picked name that is no longer saved goes back to the repository's default, not the first found.
		expect(chosenAgent(DEFAULT_AGENTS, "Removed", located(), "Codex")).toEqual(CODEX);
		expect(chosenAgent(DEFAULT_AGENTS, "Claude Code", located(), "Codex")).toEqual(CLAUDE);
		expect(plannedAgent(DEFAULT_AGENTS, located(), undefined, undefined, null, "Codex")).toEqual(planned(CODEX));
		expect(agentPickHint(DEFAULT_AGENTS, located(), planned(CODEX), "Codex")).toBe("This repository's default agent. Starts in the worktree once this dialog has created it, never in one that was already there.");
		expect(agentPickHint(DEFAULT_AGENTS, located(), planned(CLAUDE), "Codex")).not.toContain("default");
		expect(agentPickHint(DEFAULT_AGENTS, located(), planned(null), "Codex")).toBe("No agent starts. Start one later from the worktree.");
	});

	test("pick nothing when it cannot start, and name it", () => {
		const missing = located({ Codex: "not-found" });
		expect(chosenAgent(DEFAULT_AGENTS, undefined, missing, "Codex")).toBeNull();
		expect(agentPickHint(DEFAULT_AGENTS, missing, planned(null), "Codex")).toBe("Codex, this repository's default agent, was not found on the PATH the app was started with, so none is picked. Install it, or give its full path in Settings, Agents. A change to PATH needs a restart of the app.");
		expect(agentPickHint(DEFAULT_AGENTS, located({ Codex: "unusable" }), planned(null), "Codex")).toBe("Codex, this repository's default agent, cannot start, so none is picked. Settings, Agents says why.");
		expect(agentPickHint(DEFAULT_AGENTS, located(), planned(null), "Aider")).toBe("Aider, this repository's default agent, is not saved in Settings, Agents, so none is picked. Choose another there.");
		const full = { name: "Codex", command: "/opt/codex" };
		expect(agentPickHint([CLAUDE, full], [...located({ Codex: "unknown" }), { ...full, lookup: { state: "not-found" } }], planned(null), "Codex")).toContain("was not found at /opt/codex, so none is picked.");
	});

	test("the dialog holds it once its own look answered, though another agent is not known", async () => {
		const { engine, store } = await startedStore();
		const locate = engine.locateAgents;
		engine.locateAgents = async () => (await locate()).filter(location => location.name === "Codex");
		const controller = createWorktreeDialogController(store, TIMBER, createSubmission(() => {}));
		await controller.locateAgents();
		expect(controller.getState().pick).toBe("Codex");
		expect(controller.plan(null)).toEqual(planned(CODEX));
		// Another repository keeps the first agent found, not known yet here.
		expect(createWorktreeDialogController(store, OTHER, createSubmission(() => {})).plan(null)).toEqual(planned(null));
	});

	test("while the picks were never read, nothing is picked, and Settings saves no agents", async () => {
		expect(plannedAgent(DEFAULT_AGENTS, located(), undefined, undefined, null, undefined)).toEqual(planned(null));
		const engine = createMockEngine();
		engine.listRepositoryAgents = () => Promise.reject(new Error("gone"));
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		const controller = createWorktreeDialogController(store, TIMBER, createSubmission(() => {}));
		await controller.locateAgents();
		expect(controller.getState().pick).toBeUndefined();
		expect(controller.plan(null)).toEqual(planned(null));
		store.openDialog({ kind: "settings", section: "agents" });
		expect(renderToStaticMarkup(<App store={store} />)).toContain("so the agents cannot be saved");
	});

	test("the drawn dialogs say so, and a missing one starts nothing", async () => {
		const { engine, store } = await startedStore();
		store.openDialog({ kind: "new-worktree", repository: TIMBER });
		expect(renderToStaticMarkup(<App store={store} />)).toContain("This repository&#x27;s default agent.");
		const found = await engine.listIssues({ repository: TIMBER, list: "sprint", tracker: "jira" });
		if (!found.ok || found.outcome !== "found") throw new Error("no issues");
		store.openDialog({ kind: "start-work", repository: TIMBER, issue: found.issues.find(issue => issue.worktree === null)! });
		const startWork = renderToStaticMarkup(<App store={store} />);
		expect(startWork).toContain("Start work on");
		expect(startWork).toContain("This repository&#x27;s default agent.");
		engine.missingExecutables(["codex"]);
		await store.locateAgents();
		expect(renderToStaticMarkup(<App store={store} />)).toContain("Codex, this repository&#x27;s default agent, was not found");
		const controller = createWorktreeDialogController(store, TIMBER, createSubmission(() => {}));
		await controller.locateAgents();
		expect(controller.getState().pick).toBeNull();
	});
});

describe("the timber new handoff with a pick", () => {
	const handoff: WorktreeHandoff = { repository: TIMBER, worktree: FEATURE.path, agent: true };

	test("starts it, or a terminal with a toast that names it", () => {
		expect(handoffSession(handoff, DEFAULT_AGENTS, located(), "Codex")).toEqual({ kind: "agent", agent: CODEX });
		expect(handoffSession(handoff, DEFAULT_AGENTS, located({ Codex: "not-found" }), "Codex")).toEqual({ kind: "terminal", toast: handoffNoAgent(NOT_FOUND) });
		expect(handoffNoAgent(NOT_FOUND)).toBe("timber new asked for an agent, but Codex, this repository's default agent, was not found, so a terminal opened instead. Settings, Agents says why.");
		expect(handoffSession(handoff, DEFAULT_AGENTS, located(), undefined)).toEqual({ kind: "terminal", toast: handoffNoAgent("not-known") });
	});

	test("in the window", async () => {
		const engine = createMockEngine();
		await engine.savePreferences({}, { [TIMBER]: "Codex" });
		let handOff: (handoff: WorktreeHandoff) => void = () => {};
		engine.onWorktreeHandedOff = listener => {
			handOff = listener;
			return () => {};
		};
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		handOff(handoff);
		await settle();
		expect(sessionsOf(store.getState(), FEATURE.id).map(session => session.name)).toEqual(["Codex"]);
		engine.missingExecutables(["codex"]);
		handOff(handoff);
		await settle();
		expect(sessionsOf(store.getState(), FEATURE.id).filter(session => session.kind === "agent")).toHaveLength(1);
		expect(store.getState().toasts.map(toast => toast.text)).toContain(handoffNoAgent(NOT_FOUND));
	});
});

describe("a review with a pick", () => {
	test("starts it, offers it, and names it when it is missing", async () => {
		const { engine, store } = await startedStore();
		store.openDialog({ kind: "send-review", worktree: FEATURE.id });
		expect(renderToStaticMarkup(<App store={store} />)).toContain(describeNewReviewAgent("Codex"));
		expect(await store.startReviewAgent(FEATURE.id, "Review", SIZE)).toBeNull();
		await settle();
		expect(sessionsOf(store.getState(), FEATURE.id).map(session => session.name)).toEqual(["Codex"]);
		engine.missingExecutables(["codex"]);
		expect(await store.startReviewAgent(FEATURE.id, "Review", SIZE)).toBe(noNewReviewAgent(NOT_FOUND));
		expect(noNewReviewAgent(NOT_FOUND)).toBe("Codex, this repository's default agent, was not found. Copy the review instead.");
		// Beside the agent that runs, the dialog says why it offers no new one.
		store.openDialog({ kind: "send-review", worktree: FEATURE.id });
		const escaped = (text: string) => text.replaceAll("'", "&#x27;");
		expect(renderToStaticMarkup(<App store={store} />)).toContain(escaped(noNewReviewChoice(NOT_FOUND)));
		await store.closeTerminal(sessionsOf(store.getState(), FEATURE.id)[0]!.id);
		await settle();
		expect(renderToStaticMarkup(<App store={store} />)).toContain(escaped(noReviewAgent(NOT_FOUND)));
	});
});

describe("a prompt chop that names no agent, with a pick", () => {
	const ASK: PersonalChop = { name: "Ask", kind: "prompt", text: "Write tests", description: "", agent: null, repository: null, sound: null };
	async function promptStore() {
		const started = await startedStore();
		await started.store.savePreferences({ chops: [ASK] });
		await started.store.readChops(TIMBER);
		return started;
	}

	test("starts it, and the search and the panel name it, also while not known", async () => {
		const { engine, store } = await promptStore();
		expect(runChopModel(store.getState(), "Ask", "prompt").rows[0]).toMatchObject({ action: "send", target: "to a new Codex" });
		expect(chopsPanelModel(store.getState(), "prompt", "").footer).toContain("the one the chop names, or Codex.");
		engine.locateAgents = () => Promise.reject(new Error("gone"));
		await store.savePreferences({ agents: [CLAUDE, { ...CODEX, command: "codex --fast" }] });
		expect(runChopModel(store.getState(), "Ask", "prompt").rows[0]).toMatchObject({ action: "send", target: "to a new Codex" });
		expect(chopsPanelModel(store.getState(), "prompt", "").footer).toContain("the one the chop names, or Codex.");
		await store.runChop(TIMBER, FEATURE.id, "Ask", SIZE);
		await settle();
		expect(sessionsOf(store.getState(), FEATURE.id).map(session => session.name)).toEqual(["Codex"]);
	});

	test("is copied when it is missing, and every text names it; the mock engine refuses it too", async () => {
		const { engine, store } = await promptStore();
		engine.missingExecutables(["codex"]);
		await store.locateAgents();
		const model = runChopModel(store.getState(), "Ask", "prompt");
		expect(model.rows[0]).toMatchObject({ action: "copy", target: "copied: Codex was not found" });
		expect(describeRunChopRow(model.rows[0], model.worktree)).toBe("Enter copies Ask: Codex, this repository's default agent, was not found.");
		expect(chopsPanelModel(store.getState(), "prompt", "").footer).toContain("Codex, this repository's default agent, was not found, so a prompt that names none is copied");
		await store.runChop(TIMBER, FEATURE.id, "Ask", SIZE);
		await settle();
		expect(store.getState().terminals).toEqual([]);
		expect(await engine.readClipboard()).toBe("Write tests");
		expect(store.getState().toasts.map(toast => toast.text)).toContain(describePromptCopiedNoAgentFound("Ask", NOT_FOUND));
		expect(await engine.runChop({ repository: TIMBER, worktree: FEATURE.path, chop: "Ask", ...SIZE })).toEqual({ outcome: "not-configured", message: noPromptAgent(ASK, NOT_FOUND) });
		expect(store.getState().terminals).toEqual([]);
	});

	test("the Send prompt dialog offers it, or says why not; the Approve chop dialog names it", async () => {
		const { engine, store } = await promptStore();
		store.openDialog({ kind: "send-prompt", repository: TIMBER, worktree: FEATURE.id, chop: "Ask" });
		expect(renderToStaticMarkup(<App store={store} />)).toContain(describeNewAgentChoice("Codex"));
		engine.missingExecutables(["codex"]);
		await store.locateAgents();
		expect(renderToStaticMarkup(<App store={store} />)).toContain(noNewPromptAgent(null, NOT_FOUND).replaceAll("'", "&#x27;"));
		engine.missingExecutables([]);
		await store.locateAgents();
		const chop = { name: "Ask", kind: "prompt" as const, text: "Write tests", description: "", agent: null, source: "repository-file" as const, sound: null };
		const markup = renderToStaticMarkup(<StoreProvider store={store}><ApproveChopDialog request={{ repository: TIMBER, worktree: FEATURE.id, chop, path: "/r/.timber/chops.json" }} /></StoreProvider>);
		expect(markup).toContain("a new Codex");
	});
});
