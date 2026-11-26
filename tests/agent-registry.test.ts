import { describe, expect, test } from "bun:test";
import { AGENT_PRESETS, DEFAULT_AGENTS } from "../src/shared/agent";
import { AGENTS, agentByExecutable, agentById, executableName } from "../src/shared/agent-registry";
import { agentProgram, resumableAgent } from "../src/shared/agent-resume";
import { agentBrand } from "../src/shared/session-status";
import { AGENT_PRESETS as TIMBER_AGENT_PRESETS } from "../src/mainview/timber-settings-format";

const idOf = (executable: string) => agentByExecutable(executable)?.id ?? null;

describe("the agent registry", () => {
	test("finds an agent by its executable's bare name", () => {
		expect(idOf("claude")).toBe("claude");
		expect(idOf("codex")).toBe("codex");
		expect(idOf("cursor-agent")).toBe("cursor");
		expect(idOf("gemini")).toBe("gemini");
		expect(idOf("grok")).toBe("grok");
		expect(idOf("opencode")).toBe("opencode");
		expect(idOf("copilot")).toBe("copilot");
	});

	test("finds every agent by each of its executables, as a full path and as a Windows .exe", () => {
		for (const agent of AGENTS) {
			for (const executable of agent.executables) {
				expect(idOf(`/home/me/.local/bin/${executable}`)).toBe(agent.id);
				expect(idOf(`C:\\Tools\\${executable.toUpperCase()}.EXE`)).toBe(agent.id);
			}
		}
	});

	test("a name other programs install too is an agent only by the file it leads to", () => {
		// As Cursor's installer links it, and as Grok Build's does on the same machine.
		const cursor = "/home/me/.local/share/cursor-agent/versions/2026.11.19-f005e9d/cursor-agent";
		const grok = "/home/me/.grok/downloads/grok-1.0.92-linux-x86_64";
		expect(agentByExecutable("/home/me/.local/bin/agent", cursor)?.id).toBe("cursor");
		expect(agentByExecutable("agent", cursor)?.id).toBe("cursor");
		expect(agentByExecutable("C:\\Users\\me\\bin\\agent.exe", "C:\\Users\\me\\cursor-agent\\cursor-agent.exe")?.id).toBe("cursor");
		expect(agentByExecutable("/home/me/.grok/bin/agent", grok)).toBeNull();
		expect(agentByExecutable("/home/me/.local/bin/agent", "/home/me/.local/bin/agent")).toBeNull();
		expect(agentByExecutable("/home/me/.local/bin/agent", null)).toBeNull();
		expect(idOf("agent")).toBeNull();
		// The file it leads to never makes another name an agent.
		expect(agentByExecutable("/usr/bin/tool", cursor)).toBeNull();
		expect(agentProgram("agent", cursor)).toBe("cursor");
		expect(agentProgram("agent", grok)).toBeNull();
		// Cursor goes back to its chats; the same name leading to Grok Build is no agent.
		expect(resumableAgent("agent", [], cursor)).toBe("cursor");
		expect(resumableAgent("agent", [], grok)).toBeNull();
	});

	test("finds an agent by the last part of a full path, on either separator", () => {
		expect(idOf("/home/me/.local/bin/claude")).toBe("claude");
		expect(idOf("/usr/local/bin/codex")).toBe("codex");
		expect(idOf("C:\\Users\\me\\bin\\codex")).toBe("codex");
	});

	test("cuts a Windows .exe in any case, as Windows reads it", () => {
		expect(idOf("C:\\Program Files\\Claude\\claude.exe")).toBe("claude");
		expect(idOf("C:\\tools\\CODEX.EXE")).toBe("codex");
		expect(idOf("CLAUDE.EXE")).toBe("claude");
		expect(executableName("C:\\tools\\Codex.Exe")).toBe("codex");
	});

	test("anything else is no agent of the registry", () => {
		for (const executable of ["", "aider", "Claude", "/usr/bin/Codex", "claude.sh", "claude-wrapper", "mycodex", "/opt/claude/", "claude.exe.bak", "/bin/sh"]) {
			expect(idOf(executable)).toBeNull();
		}
	});

	test("ids and executables are unique, and executables are bare lower case names", () => {
		const ids = AGENTS.map(agent => agent.id);
		expect(new Set(ids).size).toBe(ids.length);
		const executables = AGENTS.flatMap(agent => [...agent.executables, ...agent.sharedExecutables]);
		expect(new Set(executables).size).toBe(executables.length);
		for (const executable of executables) {
			expect(executable).toBe(executable.toLowerCase());
			expect(executable).not.toMatch(/[\\/]|\.exe$/);
			expect(executableName(executable)).toBe(executable);
		}
		for (const agent of AGENTS) {
			expect(agentById(agent.id)).toBe(agent);
			if (agent.status.app !== null) expect(agent.status.app).toBe(agent.status.app.toLowerCase());
		}
	});

	test("each agent Timber runs in an arena names its Timber tool, once, and that tool starts the agent's own executable", () => {
		expect(AGENTS.map(agent => [agent.id, agent.arenaTool])).toEqual([
			["claude", "claude"], ["codex", "codex"], ["cursor", "cursor"], ["gemini", "gemini"], ["grok", "grok"], ["opencode", "opencode"], ["copilot", "copilot"],
		]);
		const tools = AGENTS.flatMap(agent => agent.arenaTool === null ? [] : [agent.arenaTool]);
		expect(new Set(tools).size).toBe(tools.length);
		expect(tools).not.toContain("manual");
		expect(tools).not.toContain("wrapper");
		// The executables Timber's own table starts (`timber __app-arena tools`), each the agent's: Cursor's is cursor-agent, never the shared `agent`.
		const timberExecutables: Record<string, string> = { codex: "codex", claude: "claude", cursor: "cursor-agent", gemini: "gemini", grok: "grok", opencode: "opencode", copilot: "copilot" };
		for (const agent of AGENTS) if (agent.arenaTool !== null) expect(idOf(timberExecutables[agent.arenaTool]!)).toBe(agent.id);
	});

	test("its rows, in order, with Claude Code and Codex the default ones", () => {
		expect(AGENTS.map(agent => [agent.id, agent.name, agent.label, agent.command, agent.executables, agent.sharedExecutables, agent.default])).toEqual([
			["claude", "Claude Code", "Claude", "claude", ["claude"], [], true],
			["codex", "Codex", "Codex", "codex", ["codex"], [], true],
			["cursor", "Cursor CLI", "Cursor", "cursor-agent", ["cursor-agent"], ["agent"], false],
			["gemini", "Gemini CLI", "Gemini", "gemini", ["gemini"], [], false],
			["grok", "Grok Build", "Grok", "grok", ["grok"], [], false],
			["opencode", "OpenCode", "OpenCode", "opencode", ["opencode"], [], false],
			["copilot", "GitHub Copilot CLI", "Copilot", "copilot", ["copilot"], [], false],
		]);
	});

	test("both preset lists are its rows, and the list before anything was saved is the default ones", () => {
		expect(AGENT_PRESETS).toEqual(AGENTS.map(agent => ({ name: agent.name, command: agent.command })));
		expect(TIMBER_AGENT_PRESETS).toEqual(AGENTS.map(agent => ({ label: agent.label, command: agent.command, args: [] })));
		expect(TIMBER_AGENT_PRESETS.map(preset => preset.label)).toEqual(["Claude", "Codex", "Cursor", "Gemini", "Grok", "OpenCode", "Copilot"]);
		expect(DEFAULT_AGENTS).toEqual([{ name: "Claude Code", command: "claude" }, { name: "Codex", command: "codex" }]);
	});

	test("each preset command is its agent's own executable, so a preset gets its mark", () => {
		for (const agent of AGENTS) expect(agentByExecutable(agent.command)?.id).toBe(agent.id);
	});

	test("each mark says where and when it was taken, and has shapes to draw", () => {
		for (const agent of AGENTS) {
			expect(agent.mark.source).toMatch(/https:\/\/\S+.*taken on \d{4}-\d{2}-\d{2}\./);
			expect(agent.mark.paths.length).toBeGreaterThan(0);
			for (const path of agent.mark.paths) expect(path.d).toMatch(/^M[\d.\s,-]/);
			expect(agent.mark.viewBox.split(" ")).toHaveLength(4);
		}
	});

	test("an agent session's program and mark come from the same lookup", () => {
		const session = (shell: string) => ({ kind: "agent" as const, shell, status: null });
		expect(agentProgram("C:\\tools\\claude.exe")).toBe("claude");
		expect(agentBrand(session("C:\\tools\\claude.exe"))).toBe("claude");
		expect(agentBrand(session("C:\\tools\\CODEX.EXE"))).toBe("codex");
		expect(agentBrand(session("/usr/bin/aider"))).toBeNull();
		for (const agent of AGENTS) for (const executable of agent.executables) expect(agentBrand(session(`/usr/bin/${executable}`))).toBe(agent.id);
	});

	test("an agent session's mark follows the program the main process gave it, which a bare shared name cannot", () => {
		expect(agentBrand({ kind: "agent", shell: "/home/me/.local/bin/agent", status: null })).toBeNull();
		expect(agentBrand({ kind: "agent", shell: "/home/me/.local/bin/agent", status: null, program: "cursor" })).toBe("cursor");
		// Only an agent session runs its program: a shell does not take one.
		expect(agentBrand({ kind: "terminal", shell: "/bin/bash", status: null, program: "cursor" })).toBeNull();
		// A reported app still counts in the registry's order, as before.
		expect(agentBrand({ kind: "agent", shell: "/usr/bin/codex", status: { state: "working", kind: null, progress: null, app: "claude-code", title: null, message: null }, program: "codex" })).toBe("claude");
	});

	test("Grok Build's reports name it grok, which gives its mark to a session the bare shared name could not", () => {
		const grok = { state: "working" as const, kind: null, progress: null, app: "grok", title: null, message: null };
		// Grok Build installs a bare `agent` too, which alone gives no mark.
		expect(agentBrand({ kind: "agent", shell: "/home/me/.grok/bin/agent", status: null })).toBeNull();
		expect(agentBrand({ kind: "agent", shell: "/home/me/.grok/bin/agent", status: grok })).toBe("grok");
		expect(agentBrand({ kind: "terminal", shell: "/bin/bash", status: grok })).toBe("grok");
	});

	test("GitHub Copilot CLI's reports name it copilot, which gives its mark in a shell and under a wrapper, and no other agent's", () => {
		const copilot = { state: "working" as const, kind: null, progress: null, app: "copilot", title: null, message: null };
		expect(agentById("copilot").status).toEqual({ source: "osc-7501", app: "copilot", reports: ["working", "blocked", "done"] });
		expect(agentBrand({ kind: "terminal", shell: "/bin/bash", status: copilot })).toBe("copilot");
		expect(agentBrand({ kind: "agent", shell: "/home/me/bin/copilot-work", status: null })).toBeNull();
		expect(agentBrand({ kind: "agent", shell: "/home/me/bin/copilot-work", status: copilot })).toBe("copilot");
	});
});
