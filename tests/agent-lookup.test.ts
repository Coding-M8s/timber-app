import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { locateAgent } from "../src/bun/find-executable";
import { agentLookupLine } from "../src/mainview/agent-format";
import { DEFAULT_AGENTS } from "../src/shared/agent";
import { type AgentLocation, agentFound, agentMark, agentsLocated, describeAgentLookup, lookupOf } from "../src/shared/agent-lookup";

const posix = process.platform !== "win32";

describe.skipIf(!posix)("looking for an agent's executable", () => {
	let root: string;
	let bin: string;

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-agent-lookup-")));
		bin = join(root, "agent bin");
		mkdirSync(bin);
		for (const name of ["fake-claude", "fake-codex.cmd"]) {
			writeFileSync(join(bin, name), "#!/bin/sh\necho ran > \"$(dirname \"$0\")/ran\"\n");
			chmodSync(join(bin, name), 0o755);
		}
		writeFileSync(join(bin, "not-executable"), "#!/bin/sh\n");
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("finds a name on the PATH, or a full path, and runs nothing", () => {
		const path = `${join(root, "empty")}:${bin}`;
		expect(locateAgent({ name: "Claude Code", command: "fake-claude --model big" }, path, false)).toEqual({ state: "found", path: join(bin, "fake-claude") });
		expect(locateAgent({ name: "Full", command: `"${join(bin, "fake-claude")}"` }, "", false)).toEqual({ state: "found", path: join(bin, "fake-claude") });
		expect(readdirSync(bin)).not.toContain("ran");
	});

	test("a name not on the PATH, a full path with nothing there, or a file that is not executable is not found", () => {
		expect(locateAgent({ name: "Codex", command: "codex" }, bin, false)).toEqual({ state: "not-found" });
		expect(locateAgent({ name: "Gone", command: join(root, "nowhere", "agent") }, bin, false)).toEqual({ state: "not-found" });
		expect(locateAgent({ name: "Plain", command: "not-executable" }, bin, false)).toEqual({ state: "not-found" });
	});

	test("a relative path cannot start, wherever it points", () => {
		expect(locateAgent({ name: "Relative", command: `"./agent bin/fake-claude"` }, bin, false)).toEqual({
			state: "unusable", message: "Starts with the relative path ./agent bin/fake-claude, which the app does not start. Use a command found on the PATH, or a full path.",
		});
	});

	test("on Windows a batch file is found but cannot start, as its session refuses it", () => {
		const file = join(bin, "fake-codex.cmd");
		expect(locateAgent({ name: "Codex", command: `"${file}"` }, "", true)).toEqual({
			state: "unusable", message: `Found ${file}, a batch file, which the app does not start. Use Codex's own .exe, as a full path if needed.`,
		});
		expect(locateAgent({ name: "Codex", command: `"${file}"` }, "", false)).toEqual({ state: "found", path: file });
	});
});

describe("what the app says about an agent's executable", () => {
	const found: AgentLocation = { name: "Claude Code", command: "claude", lookup: { state: "found", path: "/usr/local/bin/claude" } };
	const missing: AgentLocation = { name: "Codex", command: "codex", lookup: { state: "not-found" } };

	test("matches an agent by its name and its command as looked for", () => {
		expect(lookupOf([found, missing], DEFAULT_AGENTS[0]!)).toEqual(found.lookup);
		expect(lookupOf([found], { name: "Claude Code", command: "claude --new" })).toBeNull();
		expect(lookupOf(null, DEFAULT_AGENTS[0]!)).toBeNull();
		expect(agentFound([found, missing], DEFAULT_AGENTS[0]!)).toBe(true);
		expect(agentFound([found, missing], DEFAULT_AGENTS[1]!)).toBe(false);
		expect(agentsLocated([found, missing], DEFAULT_AGENTS)).toBe(true);
		expect(agentsLocated([found], DEFAULT_AGENTS)).toBe(false);
		expect(agentsLocated(null, [])).toBe(true);
	});

	test("says where it was found, or that it was not, in Settings and the Agent field", () => {
		expect(describeAgentLookup("claude", found.lookup)).toBe("Found at /usr/local/bin/claude");
		expect(describeAgentLookup("codex", missing.lookup)).toBe("Not found on PATH");
		expect(describeAgentLookup("/opt/agent", missing.lookup)).toBe("No executable file at /opt/agent");
		expect(describeAgentLookup("C:\\Tools\\agent.exe", missing.lookup)).toBe("No executable file at C:\\Tools\\agent.exe");
		expect(describeAgentLookup("./agent", { state: "unusable", message: "Starts with the relative path ./agent." })).toBe("Starts with the relative path ./agent.");
		expect(agentMark(found.lookup)).toBeNull();
		expect(agentMark(null)).toBeNull();
		expect(agentMark(missing.lookup)).toBe("not found");
		expect(agentMark({ state: "unusable", message: "" })).toBe("cannot start");
	});

	test("a row of the Agents section says so for a saved agent, and asks for a save first for one that changed", () => {
		const saved = DEFAULT_AGENTS;
		expect(agentLookupLine(saved[0]!, saved, [found, missing])).toEqual({ text: "Found at /usr/local/bin/claude", missing: false });
		expect(agentLookupLine(saved[1]!, saved, [found, missing])).toEqual({ text: "Not found on PATH", missing: true });
		expect(agentLookupLine({ name: "Codex", command: "codex --model big" }, saved, [found, missing])).toEqual({ text: "Save to check whether it is installed.", missing: false });
		expect(agentLookupLine(saved[0]!, saved, null)).toBeNull();
	});
});
