import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import {
	addAgentDraft, agentDraftsOf, agentsDraftModel, describeSessionProblemTitle, editAgentDraft, workflowAgentLabel, menuIndexAfterKey, presetsToAdd, removeAgentDraft,
	sessionMenuChoice, sessionMenuItems,
} from "../src/mainview/agent-format";
import { AgentsSectionView } from "../src/mainview/components/settings/AgentsSection";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { sessionsOf } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { describeSessionChip } from "../src/mainview/terminal-format";
import {
	AGENT_LIMIT, AGENT_PRESETS, agentCommand, agentProblem, describeAgentCommand, findAgent, readAgentSettings, sameAgentSettings, writeAgentSettings,
} from "../src/shared/agent";
import { defaultPreferences, readPreferences } from "../src/shared/preferences";
import { SESSION_NAME_LIMIT, defaultSessionName } from "../src/shared/terminal";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const featureId = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === FEATURE)!.id;

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	store.select(featureId);
	return { engine, store };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);
const start = (store: ReturnType<typeof createAppStore>, agent?: string) =>
	store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24, ...(agent === undefined ? {} : { agent }) });

describe("an agent's command", () => {
	test("is split without a shell into the executable and its arguments, as typed", () => {
		expect(agentCommand({ command: `codex --model "big one" --sandbox=workspace-write` })).toEqual({
			ok: true,
			executable: "codex",
			arguments: ["--model", "big one", "--sandbox=workspace-write"],
		});
		expect(agentCommand({ command: "claude $HOME ~/x; rm -rf /" })).toEqual({ ok: true, executable: "claude", arguments: ["$HOME", "~/x;", "rm", "-rf", "/"] });
		expect(describeAgentCommand({ command: `aider --model "big one"` })).toBe("aider --model 'big one'");
	});

	test("that cannot be read says why", () => {
		expect(agentCommand({ command: "  " })).toEqual({ ok: false, message: "The command is empty." });
		expect(agentCommand({ command: `"" --flag` })).toMatchObject({ ok: false });
		expect(agentCommand({ command: `codex "open` })).toMatchObject({ ok: false, message: expect.stringContaining("never closed") });
		expect(agentCommand({ command: "x".repeat(1001) })).toMatchObject({ ok: false });
		expect(describeAgentCommand({ command: "" })).toBeNull();
	});
});

describe("the agents preference", () => {
	test("starts as Claude Code and Codex, and a saved empty list stays empty", () => {
		expect(defaultPreferences().agents).toEqual([{ name: "Claude Code", command: "claude" }, { name: "Codex", command: "codex" }]);
		expect(readPreferences({}).agents).toEqual(AGENT_PRESETS);
		expect(readPreferences({ agents: [] }).agents).toEqual([]);
	});

	test("is read whole: one entry that cannot be read puts the presets back", () => {
		const custom = [{ name: "Aider", command: "aider --no-auto-commits" }, { name: "Claude Code", command: "claude --continue" }];
		expect(readAgentSettings(custom)).toEqual(custom);
		expect(readAgentSettings(writeAgentSettings(custom))).toEqual(custom);
		for (const bad of [
			"claude",
			{},
			[{ name: "A" }],
			[{ name: "A", command: 7 }],
			[{ name: "", command: "a" }],
			[{ name: " padded ", command: "a" }],
			[{ name: "A", command: "" }],
			[{ name: "A", command: `"open` }],
			[{ name: "A", command: "a" }, { name: "a", command: "b" }],
			[{ name: "Terminal", command: "bash" }],
			Array.from({ length: AGENT_LIMIT + 1 }, (_, index) => ({ name: `Agent ${index}`, command: "a" })),
		]) {
			expect(readAgentSettings(bad)).toBeUndefined();
			expect(readPreferences({ sidebarSide: "right", agents: bad })).toEqual({ ...defaultPreferences(), sidebarSide: "right" });
		}
	});

	test("names an agent exactly, and compares lists in order", () => {
		expect(findAgent(AGENT_PRESETS, "Codex")).toEqual({ name: "Codex", command: "codex" });
		expect(findAgent(AGENT_PRESETS, "codex")).toBeNull();
		expect(sameAgentSettings(AGENT_PRESETS, [...AGENT_PRESETS])).toBe(true);
		expect(sameAgentSettings(AGENT_PRESETS, [...AGENT_PRESETS].reverse())).toBe(false);
	});

	test("refuses a name that is empty, repeated in any case, or the shell's", () => {
		expect(agentProblem({ name: " ", command: "a" }, [])).toBe("Give the agent a name.");
		expect(agentProblem({ name: "codex", command: "a" }, ["Codex"])).toBe('Another agent is already called "codex".');
		expect(agentProblem({ name: "terminal", command: "bash" }, [])).toContain("plain shell");
		expect(agentProblem({ name: "Aider", command: "aider" }, ["Codex"])).toBeNull();
	});
});

describe("the + menu", () => {
	test("offers the shell first, then each agent with its exact command", () => {
		expect(sessionMenuItems([...AGENT_PRESETS, { name: "Aider", command: `aider --model "big one"` }])).toEqual([
			{ agent: null, label: "Terminal", detail: "Your shell" },
			{ agent: "Claude Code", label: "Claude Code", detail: "claude" },
			{ agent: "Codex", label: "Codex", detail: "codex" },
			{ agent: "Aider", label: "Aider", detail: "aider --model 'big one'" },
		]);
	});

	test("the arrows step and wrap, Home and End jump, anything else is not a move", () => {
		expect(menuIndexAfterKey(4, 0, "ArrowDown")).toBe(1);
		expect(menuIndexAfterKey(4, 3, "ArrowDown")).toBe(0);
		expect(menuIndexAfterKey(4, 0, "ArrowUp")).toBe(3);
		expect(menuIndexAfterKey(4, 2, "Home")).toBe(0);
		expect(menuIndexAfterKey(4, 0, "End")).toBe(3);
		expect(menuIndexAfterKey(4, 1, "a")).toBeNull();
		expect(menuIndexAfterKey(0, 0, "ArrowDown")).toBeNull();
	});

	test("each entry starts what it names, and the one after them opens Settings at Agents", () => {
		const items = sessionMenuItems(AGENT_PRESETS);
		expect(sessionMenuChoice(items, 0)).toEqual({ kind: "start", agent: null });
		expect(sessionMenuChoice(items, 1)).toEqual({ kind: "start", agent: "Claude Code" });
		expect(sessionMenuChoice(items, 2)).toEqual({ kind: "start", agent: "Codex" });
		expect(sessionMenuChoice(items, 3)).toEqual({ kind: "set-up" });
		expect(sessionMenuChoice(items, 4)).toBeNull();
		expect(sessionMenuChoice(items, -1)).toBeNull();
		expect(sessionMenuChoice(sessionMenuItems([]), 1)).toEqual({ kind: "set-up" });
	});

	test("is a menu button beside the chips, closed until pressed", async () => {
		const { store } = await startedStore();
		await start(store);
		await settle();
		const markup = render(store);
		expect(markup).toContain('id="session-add" aria-label="New session" aria-haspopup="menu" aria-expanded="false"');
		expect(markup).not.toContain('role="menu"');
	});
});

describe("agent sessions in the store", () => {
	test("each agent starts from its name, in the worktree, with a chip that shows its name", async () => {
		const { store } = await startedStore();
		await start(store, "Claude Code");
		await start(store, "Codex");
		await settle();
		const sessions = sessionsOf(store.getState(), featureId);
		expect(sessions.map(session => [session.kind, session.name, session.path, session.command])).toEqual([
			["agent", "Claude Code", FEATURE, "/usr/local/bin/claude"],
			["agent", "Codex", FEATURE, "/usr/local/bin/codex"],
		]);
		const markup = render(store);
		expect(markup).toContain('<span class="session-name">Claude Code</span>');
		expect(markup).toContain('<span class="session-name">Codex</span>');
		expect(describeSessionChip(sessions[0]!, false)).toBe("Agent, claude");
	});

	test("two agents and a terminal run side by side, and a second of one agent gets a number", async () => {
		const { store } = await startedStore();
		await start(store, "Claude Code");
		await start(store);
		await start(store, "Codex");
		await start(store, "Claude Code");
		await settle();
		expect(sessionsOf(store.getState(), featureId).map(session => session.name)).toEqual(["Claude Code", "Terminal", "Codex", "Claude Code 2"]);
		expect(sessionsOf(store.getState(), featureId).every(session => session.state.kind === "running")).toBe(true);
	});

	test("a custom command with arguments starts as typed", async () => {
		const { store } = await startedStore();
		await store.savePreferences({ agents: [{ name: "Aider", command: `aider --model "big one" --yes` }] });
		await start(store, "Aider");
		await settle();
		expect(sessionsOf(store.getState(), featureId)[0]).toMatchObject({ kind: "agent", name: "Aider", command: "/usr/local/bin/aider --model 'big one' --yes" });
	});

	test("a missing executable shows a clear error with the command in the pane, and leaves the other sessions alone", async () => {
		const { engine, store } = await startedStore();
		await start(store, "Claude Code");
		await start(store);
		await settle();
		const before = store.getState().terminals;
		engine.missingExecutables(["codex"]);
		await start(store, "Codex");
		await settle();
		expect(store.getState().terminals).toEqual(before);
		const problem = store.getState().terminalProblem!;
		expect(problem).toMatchObject({ worktree: featureId, agent: "Codex", command: "codex" });
		expect(problem.message).toContain('"codex" was not found on the PATH');
		expect(describeSessionProblemTitle(problem)).toBe("Codex did not start");
		// A workflow's agent is named by its workflow, and the title starts with a capital. A saved agent's name stays as typed.
		expect(describeSessionProblemTitle({ agent: workflowAgentLabel("review") })).toBe("The review workflow's agent did not start");
		expect(describeSessionProblemTitle({ agent: "aider" })).toBe("aider did not start");
		const markup = render(store);
		expect(markup).toContain('<p class="sidebar-error-title">Codex did not start</p>');
		expect(markup).toContain('<pre class="dialog-command" aria-label="Command that failed">codex</pre>');
		// Starting something else that works puts the note away.
		await start(store);
		expect(store.getState().terminalProblem).toBeNull();
		expect(sessionsOf(store.getState(), featureId)).toHaveLength(3);
	});

	test("a second session of an agent with a long name still fits a chip's name", () => {
		const long = "x".repeat(SESSION_NAME_LIMIT);
		expect(defaultSessionName(long, [])).toBe(long);
		const second = defaultSessionName(long, [long]);
		expect(second).toBe(`${"x".repeat(SESSION_NAME_LIMIT - 2)} 2`);
		expect(defaultSessionName(long, [long, second])).toBe(`${"x".repeat(SESSION_NAME_LIMIT - 2)} 3`);
		expect(defaultSessionName(`${"y".repeat(37)} zz`, [`${"y".repeat(37)} zz`])).toBe(`${"y".repeat(37)} 2`);
	});

	test("a relative path starts nothing, as in the main process", async () => {
		const { store } = await startedStore();
		await store.savePreferences({ agents: [{ name: "Local", command: "./bin/agent --x" }] });
		await start(store, "Local");
		expect(store.getState().terminals).toEqual([]);
		expect(store.getState().terminalProblem).toMatchObject({ agent: "Local", command: "./bin/agent --x" });
		expect(store.getState().terminalProblem?.message).toContain("relative path ./bin/agent");
	});

	test("an agent no longer in Settings starts nothing, not even a shell", async () => {
		const { store } = await startedStore();
		await store.savePreferences({ agents: [] });
		await start(store, "Codex");
		expect(store.getState().terminals).toEqual([]);
		expect(store.getState().terminalProblem?.message).toContain('No agent called "Codex"');
	});

	test("New and Open never start an agent, or any session", async () => {
		const { store } = await startedStore();
		await store.newWorktree({ repository: TIMBER, name: "agents later", base: null });
		await store.openWorktree({ repository: TIMBER, selector: FEATURE });
		await settle();
		expect(store.getState().terminals).toEqual([]);
	});

	test("with no session yet, the pane offers the shell, each agent, and a way to set them up", async () => {
		const { store } = await startedStore();
		const markup = render(store);
		expect(markup).toContain("No session here yet");
		expect(markup).toContain(">Open terminal</button>");
		expect(markup).toContain('title="Start Claude Code: claude">Start Claude Code</button>');
		expect(markup).toContain('title="Start Codex: codex">Start Codex</button>');
		expect(markup).toContain(">Set up agents</button>");
		await store.savePreferences({ agents: [] });
		expect(render(store)).not.toContain("Start Codex");
	});
});

describe("the Agents section of Settings", () => {
	const noop = () => {};
	const view = (drafts: ReturnType<typeof agentDraftsOf>, saved = AGENT_PRESETS) =>
		renderToStaticMarkup(<AgentsSectionView drafts={drafts} saved={saved} save={{ state: "idle" }} onAdd={noop} onEdit={noop} onRemove={noop} onSave={noop} />);

	test("shows each agent's name and command, and the exact command it runs", () => {
		const markup = view(agentDraftsOf([{ name: "Codex", command: `codex --model "big one"` }]));
		expect(markup).toContain('value="Codex"');
		expect(markup).toContain('value="codex --model &quot;big one&quot;"');
		expect(markup).toContain(`<pre class="dialog-command" aria-label="Command of Codex">codex --model &#x27;big one&#x27;</pre>`);
		expect(markup).toContain(">Add Claude Code</button>");
		expect(markup).not.toContain(">Add Codex</button>");
		expect(markup).toContain(">Add another agent</button>");
		expect(markup).toContain("nothing is added to the command");
	});

	test("Save is unavailable until something differs, and while a row cannot be saved", () => {
		const saved = agentDraftsOf(AGENT_PRESETS);
		expect(agentsDraftModel(saved, AGENT_PRESETS).canSave).toBe(false);
		const added = addAgentDraft(saved, { name: "Aider", command: "aider" });
		expect(agentsDraftModel(added, AGENT_PRESETS)).toMatchObject({ canSave: true, agents: [...AGENT_PRESETS, { name: "Aider", command: "aider" }] });
		const blank = addAgentDraft(saved);
		expect(agentsDraftModel(blank, AGENT_PRESETS).canSave).toBe(false);
		expect(agentsDraftModel(blank, AGENT_PRESETS).rows[2]!.problem).toBe("Give the agent a name.");
		// A row just added asks for what it needs, without an alert.
		expect(view(blank)).toContain('<p class="field-hint">Type a name and a command, or remove this row.</p>');
		expect(view(blank)).not.toContain('role="alert"');
		const clash = editAgentDraft(blank, blank[2]!.key, { name: "CODEX", command: "codex2" });
		expect(agentsDraftModel(clash, AGENT_PRESETS).rows[2]!.problem).toBe('Another agent is already called "CODEX".');
		expect(view(clash)).toContain('<p class="field-error" role="alert">Another agent is already called &quot;CODEX&quot;.</p>');
		const removed = removeAgentDraft(saved, saved[0]!.key);
		expect(agentsDraftModel(removed, AGENT_PRESETS)).toMatchObject({ canSave: true, agents: [{ name: "Codex", command: "codex" }] });
		expect(agentsDraftModel([], AGENT_PRESETS)).toMatchObject({ canSave: true, agents: [] });
		expect(view([])).toContain("No agents. The + menu offers only Terminal.");
	});

	test("names are cleaned up on save, and the presets missing by name are offered", () => {
		const drafts = addAgentDraft([]);
		const typed = editAgentDraft(drafts, drafts[0]!.key, { name: "  my   agent ", command: "  agent --x " });
		expect(agentsDraftModel(typed, []).agents).toEqual([{ name: "my agent", command: "agent --x" }]);
		expect(presetsToAdd(agentDraftsOf([{ name: "claude code", command: "other" }])).map(preset => preset.name)).toEqual(["Codex"]);
		// Compared as the name will be saved, cleaned up.
		expect(presetsToAdd(agentDraftsOf([{ name: " Claude  Code ", command: "other" }])).map(preset => preset.name)).toEqual(["Codex"]);
	});

	test("saves only the agents, and the menu follows what was saved", async () => {
		const { store } = await startedStore();
		await store.savePreferences({ agents: [{ name: "Aider", command: "aider" }] });
		expect(store.getState().preferences.agents).toEqual([{ name: "Aider", command: "aider" }]);
		expect(store.getState().preferences.sidebarSide).toBe("left");
		const markup = render(store);
		expect(markup).toContain(">Start Aider</button>");
		expect(markup).not.toContain(">Start Codex</button>");
		const refused = await store.savePreferences({ agents: [{ name: "A", command: "a" }, { name: "a", command: "b" }] });
		expect(refused.outcome).toBe("failed");
		expect(store.getState().preferences.agents).toEqual([{ name: "Aider", command: "aider" }]);
	});

	test("opens from the pane at its own section", async () => {
		const { store } = await startedStore();
		store.openDialog({ kind: "settings", section: "agents" });
		const markup = render(store);
		expect(markup).toMatch(/class="settings-nav-item selected" aria-current="page"[^>]*>Agents</);
	});
});
