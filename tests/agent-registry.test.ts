import { describe, expect, test } from "bun:test";
import { AGENT_PRESETS } from "../src/shared/agent";
import { AGENTS, agentByExecutable, agentById, executableName } from "../src/shared/agent-registry";
import { agentProgram } from "../src/shared/agent-resume";
import { agentBrand } from "../src/shared/session-status";
import { AGENT_PRESETS as TIMBER_AGENT_PRESETS } from "../src/mainview/timber-settings-format";

const idOf = (executable: string) => agentByExecutable(executable)?.id ?? null;

describe("the agent registry", () => {
	test("finds an agent by its executable's bare name", () => {
		expect(idOf("claude")).toBe("claude");
		expect(idOf("codex")).toBe("codex");
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
		const executables = AGENTS.flatMap(agent => agent.executables);
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

	test("Claude Code and Codex are its rows, in that order", () => {
		expect(AGENTS.map(agent => [agent.id, agent.name, agent.label, agent.command])).toEqual([
			["claude", "Claude Code", "Claude", "claude"],
			["codex", "Codex", "Codex", "codex"],
		]);
	});

	test("both preset lists are its rows", () => {
		expect(AGENT_PRESETS).toEqual(AGENTS.map(agent => ({ name: agent.name, command: agent.command })));
		expect(TIMBER_AGENT_PRESETS).toEqual(AGENTS.map(agent => ({ label: agent.label, command: agent.command, args: [] })));
	});

	test("an agent session's program and mark come from the same lookup", () => {
		const session = (shell: string) => ({ kind: "agent" as const, shell, status: null });
		expect(agentProgram("C:\\tools\\claude.exe")).toBe("claude");
		expect(agentBrand(session("C:\\tools\\claude.exe"))).toBe("claude");
		expect(agentBrand(session("C:\\tools\\CODEX.EXE"))).toBe("codex");
		expect(agentBrand(session("/usr/bin/aider"))).toBeNull();
	});
});
