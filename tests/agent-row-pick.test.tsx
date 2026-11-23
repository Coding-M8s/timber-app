import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { addAgentDraft, agentDraftsOf, agentsDraftModel, editAgentDraft } from "../src/mainview/agent-format";
import { AgentsSectionView } from "../src/mainview/components/settings/AgentsSection";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import {
	type AgentSetting, DEFAULT_AGENTS, agentProblem, configFolderProblem, expandConfigFolder, readAgentSettings, rowAgent, sameAgentSettings, writeAgentSettings,
} from "../src/shared/agent";
import { agentProgram, agentStartArguments, resumableAgent } from "../src/shared/agent-resume";
import { readPreferences } from "../src/shared/preferences";
import { agentBrand } from "../src/shared/session-status";

/*
 * A row's Agent and Config folder in Settings, Agents (issue 367). The
 * example throughout is a wrapper many people keep for a second Claude
 * account: `claude-personal`, which runs
 * `CLAUDE_CONFIG_DIR="$HOME/.claude-personal" exec claude "$@"`.
 */

const ID = "01a17995-a303-7160-8d6d-d7587e0d5d50";
const personal: AgentSetting = { name: "Claude Personal", command: "claude-personal", agent: "claude", configFolder: "~/.claude-personal" };

describe("a row's agent and config folder in the settings file", () => {
	test("older settings without them load as they are, and are written back the same", () => {
		const old = [{ name: "Claude Code", command: "claude" }, { name: "Aider", command: "aider" }];
		expect(readAgentSettings(old)).toEqual(old);
		expect(writeAgentSettings(readAgentSettings(old)!)).toEqual(old);
		expect(readPreferences({ agents: old }).agents).toEqual(old);
	});

	test("both fields are read and written", () => {
		expect(readAgentSettings([personal])).toEqual([personal]);
		expect(writeAgentSettings([personal])).toEqual([personal]);
		expect(readAgentSettings([{ name: "Codex Work", command: "codex", configFolder: "/srv/codex-work" }])).toEqual([{ name: "Codex Work", command: "codex", configFolder: "/srv/codex-work" }]);
		expect(readAgentSettings([{ name: "Wrapped", command: "my-agent", agent: "codex" }])).toEqual([{ name: "Wrapped", command: "my-agent", agent: "codex" }]);
	});

	test("an empty folder is the default, and an agent this version does not know is detected", () => {
		expect(readAgentSettings([{ name: "A", command: "claude", configFolder: "" }])).toEqual([{ name: "A", command: "claude" }]);
		expect(readAgentSettings([{ name: "A", command: "claude", configFolder: " ~/.claude-personal " }])).toEqual([{ name: "A", command: "claude", configFolder: "~/.claude-personal" }]);
		expect(readAgentSettings([{ name: "A", command: "claude", agent: "from-a-newer-version" }])).toEqual([{ name: "A", command: "claude" }]);
	});

	test("a folder that is not a full path or ~/, or a field of the wrong type, makes the list unreadable", () => {
		for (const bad of [
			[{ name: "A", command: "claude", configFolder: "claude-spare" }],
			[{ name: "A", command: "claude", configFolder: "~" }],
			[{ name: "A", command: "claude", configFolder: 7 }],
			[{ name: "A", command: "claude", agent: 7 }],
		]) {
			expect(readAgentSettings(bad)).toBeUndefined();
			expect(readPreferences({ agents: bad }).agents).toEqual(DEFAULT_AGENTS);
		}
	});

	test("lists differ by either field", () => {
		expect(sameAgentSettings([personal], [{ ...personal }])).toBe(true);
		expect(sameAgentSettings([personal], [{ ...personal, agent: "codex" }])).toBe(false);
		expect(sameAgentSettings([personal], [{ ...personal, configFolder: "~/.other" }])).toBe(false);
		expect(sameAgentSettings([{ name: "A", command: "a" }], [{ name: "A", command: "a", configFolder: "" }])).toBe(true);
	});

	test("a folder is a full path on any platform or starts with ~/, which is the home folder", () => {
		for (const good of ["~/.claude-personal", "/srv/claude", "C:\\Users\\me\\.claude", "\\\\server\\share", ""]) expect(configFolderProblem(good)).toBeNull();
		for (const bad of ["claude-spare", "./x", "~", "~other/x", "$HOME/.claude"]) expect(configFolderProblem(bad)).toBe("The config folder must be a full path or start with ~/.");
		expect(agentProblem({ name: "Claude Spare", command: "claude", configFolder: "claude-spare" }, [])).toBe("The config folder must be a full path or start with ~/.");
		expect(expandConfigFolder("~/.claude-personal", "/home/a")).toBe("/home/a/.claude-personal");
		expect(expandConfigFolder("~/x", "/home/a/")).toBe("/home/a/x");
		expect(expandConfigFolder("/srv/claude", "/home/a")).toBe("/srv/claude");
		expect(expandConfigFolder("relative", "/home/a")).toBeNull();
		expect(expandConfigFolder(undefined, "/home/a")).toBeNull();
	});
});

describe("the agent picked for a row", () => {
	test("takes the place of the lookup by the executable's name", () => {
		expect(rowAgent({}, "claude-personal")).toBeNull();
		expect(rowAgent({ agent: "claude" }, "claude-personal")?.id).toBe("claude");
		expect(rowAgent({ agent: "codex" }, "claude")?.id).toBe("codex");
		expect(rowAgent({}, "/usr/bin/claude")?.id).toBe("claude");
		// A shared name needs no file to follow once its agent is picked.
		expect(agentProgram("agent", null, "cursor")).toBe("cursor");
		expect(agentProgram("agent", null)).toBeNull();
		expect(agentProgram("claude-personal", null, "claude")).toBe("claude");
	});

	test("a wrapper picked as Claude Code gets the words for a fresh and a resumed conversation", () => {
		expect(resumableAgent("claude-personal", [])).toBeNull();
		expect(resumableAgent("/home/a/.local/bin/claude-personal", ["--model", "opus"], null, "claude")).toBe("claude");
		expect(agentStartArguments("claude", ["--model", "opus"], { fresh: ID })).toEqual(["--session-id", ID, "--model", "opus"]);
		expect(agentStartArguments("claude", ["--model", "opus"], { resume: ID })).toEqual(["--resume", ID, "--model", "opus"]);
	});

	test("its arguments still start it as typed when they pick a conversation", () => {
		for (const args of [["--continue"], ["-cp"], ["mcp", "list"], ["--", "fix it"]]) expect(resumableAgent("claude-personal", args, null, "claude")).toBeNull();
		expect(resumableAgent("codex-work", ["exec", "hi"], null, "codex")).toBeNull();
		// An agent with no way back starts as typed whatever it is called.
		expect(resumableAgent("my-gemini", [], null, "gemini")).toBeNull();
	});

	test("gives the chip and row its mark, over the executable's name, also once it ends into a shell", () => {
		expect(agentBrand({ kind: "agent", shell: "/home/a/.local/bin/claude-personal", status: null, program: "claude" })).toBe("claude");
		expect(agentBrand({ kind: "agent", shell: "/usr/bin/claude", status: null, program: "codex" })).toBe("codex");
		expect(agentBrand({ kind: "agent", shell: "/home/a/.local/bin/claude-personal", status: null })).toBeNull();
		const ended = { name: "Claude Personal", agent: "Claude Personal", program: "claude" as const, resumable: "claude" as const, conversation: ID, command: "claude-personal", exitCode: 0, signal: null, resume: null };
		expect(agentBrand({ kind: "terminal", shell: "/bin/bash", status: null, endedAgent: ended })).toBe("claude");
	});
});

describe("the Agent and Config folder fields of Settings, Agents", () => {
	const noop = () => {};
	const view = (drafts: ReturnType<typeof agentDraftsOf>, saved: readonly AgentSetting[] = []) =>
		renderToStaticMarkup(<AgentsSectionView drafts={drafts} saved={saved} locations={null} save={{ state: "idle" }} onAdd={noop} onEdit={noop} onRemove={noop} onSave={noop} />);
	// The rows of the approved mock.
	const rows: AgentSetting[] = [
		{ name: "Claude Work", command: "claude-work", agent: "claude", configFolder: "~/.claude-work" },
		{ name: "Claude Code", command: "claude" },
		{ name: "Codex", command: "codex" },
		{ name: "Team agent", command: "team-agent --fast" },
	];
	const rowMarkup = (markup: string, name: string) => {
		const start = markup.indexOf(`value="${name}"`);
		const end = markup.indexOf("</li>", start);
		return markup.slice(start, end);
	};

	test("each row offers Detect, naming what it detected, then every agent of the registry", () => {
		const markup = view(agentDraftsOf(rows), rows);
		expect(rowMarkup(markup, "Claude Code")).toContain('<option value="" selected="">Detect from command (Claude Code)</option>');
		expect(rowMarkup(markup, "Codex")).toContain("Detect from command (Codex)</option>");
		expect(rowMarkup(markup, "Team agent")).toContain("Detect from command (not recognized)</option>");
		expect(rowMarkup(markup, "Claude Work")).toContain('<option value="claude" selected="">Claude Code</option>');
		for (const name of ["Claude Code", "Codex", "Cursor CLI", "Gemini CLI", "Grok Build", "OpenCode", "GitHub Copilot CLI"]) expect(rowMarkup(markup, "Team agent")).toContain(`>${name}</option>`);
		expect(markup).toContain("Agent says which agent the command runs, for its mark and for going back to its conversation after a restart; Detect goes by the executable&#x27;s name.");
		expect(markup).toContain("Config folder is where that agent keeps its conversations.");
	});

	test("Config folder names its variable and default, and shows only for an agent that keeps its conversations in a folder", () => {
		const markup = view(agentDraftsOf(rows), rows);
		expect(rowMarkup(markup, "Claude Work")).toContain('Config folder <span class="mono">CLAUDE_CONFIG_DIR</span>');
		expect(rowMarkup(markup, "Claude Work")).toContain('value="~/.claude-work"');
		expect(rowMarkup(markup, "Claude Work")).toContain("Starts with CLAUDE_CONFIG_DIR set to this folder, and goes back to its conversation from there after a restart.");
		expect(rowMarkup(markup, "Claude Code")).toContain('placeholder="Default: ~/.claude"');
		expect(rowMarkup(markup, "Claude Code")).not.toContain("Starts with");
		expect(rowMarkup(markup, "Codex")).toContain('Config folder <span class="mono">CODEX_HOME</span>');
		expect(rowMarkup(markup, "Codex")).toContain('placeholder="Default: ~/.codex"');
		expect(rowMarkup(markup, "Team agent")).not.toContain("Config folder");
		expect(rowMarkup(markup, "Team agent")).toContain("Not recognized from its command, so it starts fresh after a restart. Pick its agent to go back to its conversation.");
		const grokAndCursor = view(agentDraftsOf([{ name: "Grok Build", command: "grok" }, { name: "Cursor CLI", command: "cursor-agent" }]));
		expect(rowMarkup(grokAndCursor, "Grok Build")).toContain('Config folder <span class="mono">GROK_HOME</span>');
		expect(rowMarkup(grokAndCursor, "Grok Build")).toContain('placeholder="Default: ~/.grok"');
		expect(rowMarkup(grokAndCursor, "Cursor CLI")).toContain('Config folder <span class="mono">CURSOR_CONFIG_DIR</span>');
		expect(rowMarkup(grokAndCursor, "Cursor CLI")).toContain('placeholder="Default: ~/.cursor"');
		const gemini = view(agentDraftsOf([{ name: "Gemini CLI", command: "gemini" }]));
		expect(gemini).not.toContain("Config folder <span");
		expect(gemini).not.toContain("Not recognized");
	});

	test("a command that starts as typed gets the folder, and is not promised its conversation", () => {
		const markup = view(agentDraftsOf([{ name: "Pinned", command: "claude --continue", configFolder: "~/.claude-personal" }]));
		expect(markup).toContain('<p class="field-hint">Starts with CLAUDE_CONFIG_DIR set to this folder.</p>');
		expect(markup).not.toContain("goes back to its conversation from there");
	});

	test("a shared name such as agent is not called unrecognized: the main process tells it by the file it leads to", () => {
		const markup = view(agentDraftsOf([{ name: "Agent", command: "agent" }]));
		expect(markup).toContain("Detect from command (known once it starts)</option>");
		expect(markup).not.toContain("Not recognized");
	});

	test("a folder that is not a full path or ~/ is refused under the row", () => {
		const spare = agentDraftsOf([{ name: "Claude Spare", command: "claude", agent: "claude", configFolder: "claude-spare" }]);
		expect(agentsDraftModel(spare, []).canSave).toBe(false);
		const markup = view(spare);
		expect(markup).toContain('<p class="field-error" role="alert">The config folder must be a full path or start with ~/.</p>');
		expect(markup).toMatch(/aria-invalid="true" value="claude-spare"/);
	});

	test("picking an agent shows the folder, and a folder for an agent that keeps none is dropped on save", () => {
		const drafts = addAgentDraft([], { name: "Claude Personal", command: "claude-personal" });
		const key = drafts[0]!.key;
		expect(agentsDraftModel(drafts, []).rows[0]!.folder).toBeNull();
		const picked = editAgentDraft(drafts, key, { agent: "claude", configFolder: " ~/.claude-personal " });
		expect(agentsDraftModel(picked, []).rows[0]!.folder).toEqual({ variable: "CLAUDE_CONFIG_DIR", placeholder: "Default: ~/.claude" });
		expect(agentsDraftModel(picked, []).agents).toEqual([personal]);
		const switched = editAgentDraft(picked, key, { agent: "gemini" });
		expect(agentsDraftModel(switched, []).agents).toEqual([{ name: "Claude Personal", command: "claude-personal", agent: "gemini" }]);
		const detected = editAgentDraft(picked, key, { agent: "" });
		expect(agentsDraftModel(detected, []).agents).toEqual([{ name: "Claude Personal", command: "claude-personal" }]);
	});

	test("Save follows the new fields", () => {
		const drafts = agentDraftsOf([personal]);
		expect(agentsDraftModel(drafts, [personal]).canSave).toBe(false);
		expect(agentsDraftModel(editAgentDraft(drafts, drafts[0]!.key, { configFolder: "~/.claude-other" }), [personal]).canSave).toBe(true);
	});
});

describe("in the mock engine", () => {
	test("a wrapper picked as Claude Code starts with an id and its mark, and a detected one as typed", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine, () => () => {});
		store.start();
		for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
		await store.savePreferences({ agents: [personal, { name: "Plain Wrapper", command: "claude-personal" }] });
		expect(store.getState().preferences.agents).toEqual([personal, { name: "Plain Wrapper", command: "claude-personal" }]);
		const repository = sampleRepositories[0]!;
		const worktree = repository.worktrees[0]!.path;
		const picked = await engine.openTerminal({ repository: repository.path, worktree, cols: 80, rows: 24, agent: "Claude Personal" });
		const plain = await engine.openTerminal({ repository: repository.path, worktree, cols: 80, rows: 24, agent: "Plain Wrapper" });
		if (picked.outcome !== "opened" || plain.outcome !== "opened") throw new Error("Not opened");
		expect(picked.session.program).toBe("claude");
		expect(picked.session.command).toContain("--session-id");
		expect(agentBrand(picked.session)).toBe("claude");
		expect(plain.session.program).toBeUndefined();
		expect(plain.session.command).not.toContain("--session-id");
	});
});
