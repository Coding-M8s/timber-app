import { describe, expect, test } from "bun:test";
import {
	type ArenaGroup, arenaInspectArguments, arenaLaunchArguments, arenaNewArguments, arenaPickArguments, attemptAt, isArenaName, isAttemptLabel, newArenaProblem,
	offeredArenaTools, readArenaInspection, readArenaLaunch, readArenaList, readArenaPresets, readArenaTools, readNewArenaResult, readPickArenaResult,
} from "../src/shared/arenas";
import { RESULT_FILE_PLACEHOLDER, TASK_FILE_PLACEHOLDER, type TimberRun, describeTimberCommand, readTimberResult } from "../src/shared/timber-result";
import { recordedArena } from "./support/timber";

const output = { text: "printed", truncated: false };
function runOf(command: "arena-new" | "arena-pick", text: string | null, exitCode: number | null): TimberRun {
	return { command: `timber ${command}`, result: readTimberResult(command, text, exitCode), output };
}
const edit = (text: string, change: (record: Record<string, any>) => void) => {
	const record = JSON.parse(text);
	change(record);
	return JSON.stringify(record);
};
const exitOf = (text: string) => JSON.parse(text).exitCode as number;

describe("readArenaList", () => {
	test("reads every arena and attempt exactly as Timber recorded them", () => {
		const list = readArenaList(recordedArena.list, "", 0);
		if (list.state !== "listed") throw new Error(JSON.stringify(list));
		expect(list.arenas.map(arena => arena.name)).toEqual(["abc-12", "demo"]);
		const demo = list.arenas[1]!;
		if (demo.outcome !== "read") throw new Error("demo was not read");
		expect(demo.base.ref).toBe("refs/heads/main");
		expect(demo.base.commit).toMatch(/^[0-9a-f]{40}$/);
		expect(demo.ticket).toBeNull();
		expect(demo.active).toBe(false);
		expect(demo.winner).toBeNull();
		expect(demo.attempts).toEqual([
			{ label: "manual-1", tool: "manual", preset: "manual", model: null, effort: null, branch: "arena/demo/manual-1", path: "/work/sample-worktrees/arena-demo-manual-1", state: "prepared", stage: "ready", git: "ok", archive: null },
			{ label: "stub-1", tool: "wrapper", preset: "stub", model: null, effort: null, branch: "arena/demo/stub-1", path: "/work/sample-worktrees/arena-demo-stub-1", state: "prepared", stage: "ready", git: "ok", archive: null },
		]);
		const ticket = list.arenas[0]!;
		expect(ticket.outcome === "read" && ticket.ticket).toBe("ABC-12");
	});

	test("after a pick: the winner, and the archived attempt missing with its ref", () => {
		const list = readArenaList(recordedArena.listAfterPick, "", 0);
		if (list.state !== "listed") throw new Error(list.state);
		const demo = list.arenas.find(arena => arena.name === "demo")!;
		if (demo.outcome !== "read") throw new Error("demo was not read");
		expect(demo.winner).toBe("manual-1");
		expect(demo.attempts.map(attempt => [attempt.label, attempt.state, attempt.git])).toEqual([["manual-1", "picked", "ok"], ["stub-1", "archived", "missing"]]);
		expect(demo.attempts[1]!.archive).toMatchObject({ ref: "refs/timber/arena/demo/stub-1", present: true });
	});

	test("a damaged arena is a failed entry beside the others, though Timber exits 1", () => {
		const list = readArenaList(recordedArena.listDamaged, "", 1);
		if (list.state !== "listed") throw new Error(JSON.stringify(list));
		expect(list.arenas.map(arena => [arena.name, arena.outcome])).toEqual([["abc-12", "read"], ["demo", "read"], ["kept", "failed"]]);
		const kept = list.arenas[2]!;
		expect(kept.outcome === "failed" && kept.diagnostic).toBeTruthy();
	});

	test("a diagnostic is a failure with Timber's words, never an empty list", () => {
		const list = readArenaList(recordedArena.listOutside, "", 1);
		expect(list.state).toBe("failed");
		if (list.state === "failed") expect(list.message).toStartWith("timber __app-arena list could not read the arenas: Not a Git repository");
	});

	test("a Timber without __app-arena is unsupported, and nothing else is", () => {
		expect(readArenaList("", recordedArena.unknownCommand, 1)).toEqual({ state: "unsupported" });
		expect(readArenaList("", "error: something else\n", 1).state).toBe("failed");
		expect(readArenaList("", recordedArena.unknownCommand, 2).state).toBe("failed");
		expect(readArenaList("{}", recordedArena.unknownCommand, 1).state).toBe("failed");
	});

	test("anything not whole is a failure: another version, a bad attempt, or exit 1 with nothing failed", () => {
		expect(readArenaList(edit(recordedArena.list, record => { record.schemaVersion = 2; }), "", 0)).toMatchObject({ state: "failed", message: expect.stringContaining("schema version 2") });
		expect(readArenaList(edit(recordedArena.list, record => { record.arenas[0].attempts[0].git = "maybe"; }), "", 0)).toMatchObject({ state: "failed" });
		expect(readArenaList(edit(recordedArena.list, record => { record.arenas[0].attempts[0].label = "--winner"; }), "", 0)).toMatchObject({ state: "failed" });
		expect(readArenaList(recordedArena.list, "", 1).state).toBe("failed");
		expect(readArenaList("not json", "error: boom\n", 1)).toEqual({ state: "failed", message: "timber __app-arena list exited with code 1: boom" });
		expect(readArenaList(recordedArena.list, "", null).state).toBe("failed");
	});

	test("unknown fields are ignored", () => {
		const list = readArenaList(edit(recordedArena.list, record => { record.extra = 1; record.arenas[0].extra = { a: 1 }; record.arenas[0].attempts[0].more = true; }), "", 0);
		expect(list.state).toBe("listed");
	});
});

describe("attemptAt", () => {
	test("matches a worktree to an attempt by its path, only while Git has it as Timber made it", () => {
		const list = readArenaList(recordedArena.listAfterPick, "", 0);
		expect(attemptAt(list, "/work/sample-worktrees/arena-demo-manual-1")).toMatchObject({ arena: "demo", attempt: { label: "manual-1" } });
		// Removed by pick: its folder is not an attempt anymore, whatever is there now.
		expect(attemptAt(list, "/work/sample-worktrees/arena-demo-stub-1")).toBeNull();
		expect(attemptAt(list, "/work/sample")).toBeNull();
		expect(attemptAt({ state: "unsupported" }, "/work/sample-worktrees/arena-demo-manual-1")).toBeNull();
		const stale = readArenaList(edit(recordedArena.list, record => { record.arenas[1].attempts[0].git = "stale"; }), "", 0);
		expect(attemptAt(stale, "/work/sample-worktrees/arena-demo-manual-1")).toBeNull();
	});
});

describe("readArenaLaunch", () => {
	test("reads the program, folder, and environment Timber gives, for the attempt asked about", () => {
		const launch = readArenaLaunch(recordedArena.launchReady, "", 0, "demo", "stub-1");
		if (launch.outcome !== "ready") throw new Error(JSON.stringify(launch));
		expect(launch.argv).toEqual(["/work/stub-agent", "--go"]);
		expect(launch.cwd).toBe("/work/sample-worktrees/arena-demo-stub-1");
		expect(launch.environment).toMatchObject({ TIMBER_TASK_FILE: "/work/sample/.git/timber/arenas/demo/task.txt", TIMBER_ARENA: "demo", TIMBER_ATTEMPT: "stub-1", TIMBER_BRANCH: "arena/demo/stub-1" });
		expect(launch.unset).toEqual(["TIMBER_TASK_ID", "TIMBER_WORKFLOW"]);
	});

	test("a manual attempt has no agent, and an unknown label is Timber's failure", () => {
		expect(readArenaLaunch(recordedArena.launchNoAgent, "", 0, "demo", "manual-1")).toEqual({ outcome: "no-agent" });
		const failed = readArenaLaunch(recordedArena.launchFailed, "", 1, "demo", "nope-9");
		expect(failed).toEqual({ outcome: "failed", message: "No attempt \"nope-9\" in arena demo; use an exact label from __app-arena list. Nothing was started." });
	});

	test("a record about another attempt, or that does not go with its exit, is not used", () => {
		expect(readArenaLaunch(recordedArena.launchReady, "", 0, "demo", "manual-1").outcome).toBe("failed");
		expect(readArenaLaunch(recordedArena.launchReady, "", 1, "demo", "stub-1").outcome).toBe("failed");
		expect(readArenaLaunch(edit(recordedArena.launchReady, record => { record.launch.argv = []; }), "", 0, "demo", "stub-1").outcome).toBe("failed");
		expect(readArenaLaunch(edit(recordedArena.launchReady, record => { record.launch.environment.X = 1; }), "", 0, "demo", "stub-1").outcome).toBe("failed");
		expect(readArenaLaunch("", recordedArena.unknownCommand, 1, "demo", "stub-1")).toMatchObject({ outcome: "failed", message: expect.stringContaining("newer Timber") });
	});
});

describe("readArenaInspection", () => {
	test("reads each attempt's commits, committed and uncommitted changes, and untracked files apart", () => {
		const inspection = readArenaInspection(recordedArena.inspect, "", 0, "demo");
		if (inspection.state !== "inspected") throw new Error(JSON.stringify(inspection));
		expect(inspection.winner).toBeNull();
		expect(inspection.base?.ref).toBe("refs/heads/main");
		const stub = inspection.attempts.find(attempt => attempt.label === "stub-1")!;
		expect(stub.comparison).toEqual({ commits: 1, committed: { files: 1, insertions: 1, deletions: 0 }, uncommitted: { files: 1, insertions: 1, deletions: 0 }, untracked: 1, ignored: 0 });
		expect(stub.removed).toBe(false);
		expect(inspection.attempts.find(attempt => attempt.label === "manual-1")!.comparison?.commits).toBe(0);
	});

	test("an arena Timber cannot read is a failure with its diagnostic", () => {
		const inspection = readArenaInspection(recordedArena.inspectFailed, "", 1, "nothing");
		expect(inspection).toMatchObject({ state: "failed", message: expect.stringContaining("could not compare the attempts") });
	});

	test("a record about another arena, or a diagnostic with exit 0, is not used", () => {
		expect(readArenaInspection(recordedArena.inspect, "", 0, "other").state).toBe("failed");
		expect(readArenaInspection(recordedArena.inspectFailed, "", 0, "nothing").state).toBe("failed");
		expect(readArenaInspection(edit(recordedArena.inspect, record => { record.attempts[0].comparison.untracked = -1; }), "", 0, "demo").state).toBe("failed");
		expect(readArenaInspection("", "error: unknown option '--json'\n", 1, "demo")).toEqual({ state: "unsupported" });
	});
});

describe("arena commands", () => {
	const groups: ArenaGroup[] = [
		{ kind: "tool", tool: "codex", model: "gpt-5.1-codex", effort: "high", runs: 2 },
		{ kind: "preset", preset: "stub", runs: 1 },
		{ kind: "tool", tool: "manual", model: null, effort: null, runs: 1 },
	];

	test("arena new puts each group's flags after it, joins typed values with =, and passes the task as a file", () => {
		const args = arenaNewArguments({ name: "ABC-12", groups, base: "origin/main" }, TASK_FILE_PLACEHOLDER, RESULT_FILE_PLACEHOLDER);
		expect(describeTimberCommand(args)).toBe(
			"timber arena new --tool=codex --model=gpt-5.1-codex --effort=high --runs=2 --preset=stub --runs=1 --tool=manual --runs=1 --base=origin/main "
			+ "--prompt-file <task file> --no-editor --no-agent --result-file <temporary file> -- ABC-12",
		);
	});

	test("a typed value that looks like an option stays a value", () => {
		const args = arenaNewArguments({ name: "--help", groups: [{ kind: "tool", tool: "claude", model: "--dangerous", effort: null, runs: 2 }], base: null }, "/tmp/t", "/tmp/r");
		expect(args).toContain("--model=--dangerous");
		expect(args.slice(-2)).toEqual(["--", "--help"]);
	});

	test("launch, inspect, and pick name the arena and attempt as Timber does", () => {
		expect(arenaLaunchArguments("demo", "stub-1")).toEqual(["__app-arena", "launch", "demo", "--attempt", "stub-1"]);
		expect(arenaInspectArguments("demo")).toEqual(["arena", "pick", "demo", "--inspect", "--json"]);
		expect(describeTimberCommand(arenaPickArguments({ arena: "demo", winner: "manual-1" }, RESULT_FILE_PLACEHOLDER))).toBe("timber arena pick demo --winner manual-1 --result-file <temporary file>");
	});

	test("names and labels are Timber's form only", () => {
		expect(isArenaName("demo")).toBe(true);
		expect(isArenaName("-x")).toBe(false);
		expect(isArenaName("Demo")).toBe(false);
		expect(isAttemptLabel("codex-2")).toBe(true);
		expect(isAttemptLabel("--winner")).toBe(false);
	});

	test("newArenaProblem says what is missing, and allows a request Timber can take", () => {
		const request = { name: "demo", task: "Do it", groups, base: null };
		expect(newArenaProblem(request)).toBeNull();
		expect(newArenaProblem({ ...request, name: " " })).toBe("Give the arena a name or a ticket key.");
		expect(newArenaProblem({ ...request, task: "\n" })).toBe("Write the task the attempts work on.");
		expect(newArenaProblem({ ...request, groups: [{ kind: "preset", preset: "stub", runs: 1 }] })).toBe("An arena has at least 2 attempts.");
		expect(newArenaProblem({ ...request, groups: [{ kind: "tool", tool: "manual", model: "x", effort: null, runs: 2 }] })).toBe("Manual attempts have no model or effort.");
		expect(newArenaProblem({ ...request, groups: [{ kind: "preset", preset: "stub", runs: 9 }] })).toBe("Each group runs from 1 to 8 times.");
		expect(newArenaProblem({ ...request, base: "main\nx" })).toBe("The base is one line of text, such as main.");
		// The shape only: which tools the Timber found runs, and which take an effort, is Timber's to say.
		for (const tool of ["codex", "claude", "cursor", "gemini", "grok", "opencode", "copilot"]) {
			expect(newArenaProblem({ ...request, groups: [{ kind: "tool", tool, model: "m", effort: "high", runs: 2 }] })).toBeNull();
		}
		expect(newArenaProblem({ ...request, groups: [{ kind: "tool", tool: "wrapper", model: null, effort: null, runs: 2 }] })).toBe("Choose a coding tool Timber runs, or manual.");
		expect(newArenaProblem({ ...request, groups: [{ kind: "tool", tool: "--model=x", model: null, effort: null, runs: 2 }] })).toBe("Choose a coding tool Timber runs, or manual.");
	});

	test("arena new passes a new tool and its model as for any other tool", () => {
		const args = arenaNewArguments({ name: "demo", base: null, groups: [
			{ kind: "tool", tool: "gemini", model: "gemini-3-pro", effort: null, runs: 1 },
			{ kind: "tool", tool: "copilot", model: null, effort: null, runs: 1 },
		] }, "/t", "/r");
		expect(args.slice(0, 7)).toEqual(["arena", "new", "--tool=gemini", "--model=gemini-3-pro", "--runs=1", "--tool=copilot", "--runs=1"]);
	});
});

describe("readNewArenaResult", () => {
	test("a created arena with every attempt ready", () => {
		const result = readNewArenaResult(runOf("arena-new", recordedArena.newSucceeded, 0));
		if (result.outcome !== "created") throw new Error(JSON.stringify(result));
		expect(result.arena.name).toBe("demo");
		expect(result.arena.failure).toBeNull();
		expect(result.arena.attempts.map(attempt => [attempt.label, attempt.tool, attempt.created, attempt.stage])).toEqual([["manual-1", "manual", true, "ready"], ["stub-1", "wrapper", true, "ready"]]);
	});

	test("a ticket key becomes Timber's own arena name", () => {
		const result = readNewArenaResult(runOf("arena-new", recordedArena.newTicket, 0));
		expect(result.outcome === "created" && result.arena.name).toBe("abc-12");
	});

	test("a name that exists reserves nothing: a failure with Timber's diagnostic and no arena", () => {
		const result = readNewArenaResult(runOf("arena-new", recordedArena.newExists, 1));
		expect(result).toMatchObject({ outcome: "failed", ran: true, arena: null, failure: { diagnostic: "Arena already exists; inspect its retained state or choose another name." } });
	});

	test("setup that failed keeps what was reserved, and where it stopped", () => {
		const result = readNewArenaResult(runOf("arena-new", recordedArena.newSetupFailed, 1));
		if (result.outcome !== "failed" || result.arena === null) throw new Error(JSON.stringify(result));
		expect(result.arena.name).toBe("broken");
		expect(result.arena.failure).toEqual({ stage: "setup", attempt: "manual-1" });
		expect(result.arena.attempts[0]).toMatchObject({ label: "manual-1", created: true, stage: "failed", failedStage: "setup" });
	});

	test("no result, or a success that names no arena, is unknown", () => {
		expect(readNewArenaResult(runOf("arena-new", null, 1))).toMatchObject({ outcome: "failed", arena: null });
		const noArena = edit(recordedArena.newSucceeded, record => { delete record.arenaNew; });
		expect(readNewArenaResult(runOf("arena-new", noArena, 0))).toMatchObject({ outcome: "failed", failure: { diagnostic: expect.stringContaining("names no arena") } });
		expect(exitOf(recordedArena.newSetupFailed)).toBe(1);
	});
});

describe("readPickArenaResult", () => {
	test("picked: the winner, and each other attempt removed or archived with its ref", () => {
		const result = readPickArenaResult(runOf("arena-pick", recordedArena.pickSucceeded, 0), { arena: "demo", winner: "manual-1" });
		if (result.outcome !== "picked") throw new Error(JSON.stringify(result));
		expect(result.pick.attempts).toEqual([
			{ label: "manual-1", outcome: "winner", archiveRef: null, reason: null },
			{ label: "stub-1", outcome: "archived", archiveRef: "refs/timber/arena/demo/stub-1", reason: null },
		]);
	});

	test("a kept attempt makes the pick a failure that still reports every attempt, with Timber's reason", () => {
		const result = readPickArenaResult(runOf("arena-pick", recordedArena.pickKept, 1), { arena: "kept", winner: "manual-1" });
		if (result.outcome !== "failed" || result.pick === null) throw new Error(JSON.stringify(result));
		expect(result.pick.attempts[1]).toMatchObject({ label: "manual-2", outcome: "kept", reason: expect.stringContaining("identity is missing") });
	});

	test("a record about another arena or winner is not used", () => {
		expect(readPickArenaResult(runOf("arena-pick", recordedArena.pickSucceeded, 0), { arena: "demo", winner: "stub-1" })).toMatchObject({ outcome: "failed", pick: null });
		expect(readPickArenaResult(runOf("arena-pick", recordedArena.pickSucceeded, 0), { arena: "other", winner: "manual-1" })).toMatchObject({ outcome: "failed", pick: null });
	});
});

describe("readArenaPresets", () => {
	test("keeps each preset's name and tool, never its command or arguments", () => {
		const list = readArenaPresets(recordedArena.appConfig, "", 0);
		expect(list).toEqual({ ok: true, presets: [{ name: "stub", tool: "wrapper" }] });
		expect(JSON.stringify(list)).not.toContain("stub-agent");
	});

	test("no arena settings is no presets; anything unreadable is a failure", () => {
		expect(readArenaPresets(edit(recordedArena.appConfig, record => { delete record.effective.arena; }), "", 0)).toEqual({ ok: true, presets: [] });
		expect(readArenaPresets(edit(recordedArena.appConfig, record => { record.effective.arena.agents.stub = 1; }), "", 0).ok).toBe(false);
		expect(readArenaPresets("", "error: boom", 1)).toEqual({ ok: false, message: "timber __app-config read --scope repository exited with code 1: boom" });
	});
});

describe("readArenaTools", () => {
	test("reads every tool Timber's main branch lists, with its effort and whether it stays open", () => {
		const list = readArenaTools(recordedArena.tools, "", 0);
		if (list.state !== "listed") throw new Error(JSON.stringify(list));
		expect(list.tools.map(tool => tool.tool)).toEqual(["codex", "claude", "cursor", "gemini", "grok", "opencode", "copilot", "qwen", "amp", "pi"]);
		expect(list.tools.find(tool => tool.tool === "gemini")).toEqual({ tool: "gemini", effort: false, interactive: true });
		expect(list.tools.find(tool => tool.tool === "codex")).toEqual({ tool: "codex", effort: true, interactive: true });
		expect(list.tools.find(tool => tool.tool === "amp")?.interactive).toBe(false);
		// The label and executable are Timber's; the app names a tool by its registry agent.
		expect(JSON.stringify(list)).not.toContain("Gemini CLI");
	});

	test("a record without interactive, as Timber's first contract had it, stays open", () => {
		const list = readArenaTools(edit(recordedArena.tools, record => { for (const tool of record.tools) delete tool.interactive; }), "", 0);
		expect(list.state === "listed" && list.tools.every(tool => tool.interactive)).toBe(true);
	});

	test("the released 0.2.0, which has no tools action, is an older Timber, read by its exit and empty output only", () => {
		expect(recordedArena.toolsOlder).toContain("Unknown __app-arena action");
		expect(readArenaTools("", recordedArena.toolsOlder, 1)).toEqual({ state: "older" });
		expect(readArenaTools("", "", 2)).toEqual({ state: "older" });
	});

	test("a stopped run, output with a failure, another version, or a tool it cannot read is a failure", () => {
		expect(readArenaTools("", "", null)).toEqual({ state: "failed", message: "timber __app-arena tools did not exit by itself without saying why." });
		expect(readArenaTools("{}", "error: boom", 1)).toEqual({ state: "failed", message: "timber __app-arena tools exited with code 1: boom" });
		expect(readArenaTools(edit(recordedArena.tools, record => { record.schemaVersion = 2; }), "", 0)).toMatchObject({ state: "failed", message: expect.stringContaining("schema version 2") });
		expect(readArenaTools(edit(recordedArena.tools, record => { record.tools[0].effort = "yes"; }), "", 0)).toMatchObject({ state: "failed", message: expect.stringContaining("a tool in it cannot be read") });
		expect(readArenaTools(edit(recordedArena.tools, record => { record.tools[0].interactive = 1; }), "", 0).state).toBe("failed");
		expect(readArenaTools(edit(recordedArena.tools, record => { delete record.tools; }), "", 0).state).toBe("failed");
		expect(readArenaTools("not json", "", 0).state).toBe("failed");
		expect(readArenaTools(edit(recordedArena.tools, record => { record.tools.push(record.tools[3]); }), "", 0)).toMatchObject({ state: "failed", message: expect.stringContaining("it lists a tool twice") });
	});
});

describe("offeredArenaTools", () => {
	const listed = readArenaTools(recordedArena.tools, "", 0);

	test("offers the registry's agents Timber lists, in Timber's order, by their names; none it has no row for, and none that ends after its task", () => {
		expect(offeredArenaTools(listed)).toEqual([
			{ tool: "codex", agent: "codex", name: "Codex", effort: true },
			{ tool: "claude", agent: "claude", name: "Claude Code", effort: true },
			{ tool: "cursor", agent: "cursor", name: "Cursor CLI", effort: true },
			{ tool: "gemini", agent: "gemini", name: "Gemini CLI", effort: false },
			{ tool: "grok", agent: "grok", name: "Grok Build", effort: false },
			{ tool: "opencode", agent: "opencode", name: "OpenCode", effort: false },
			{ tool: "copilot", agent: "copilot", name: "GitHub Copilot CLI", effort: false },
		]);
		// A registry agent that Timber lists but that would end after its task is not offered either.
		const closing = { state: "listed" as const, tools: [{ tool: "codex", effort: true, interactive: true }, { tool: "grok", effort: false, interactive: false }] };
		expect(offeredArenaTools(closing).map(tool => tool.tool)).toEqual(["codex"]);
	});

	test("a tool the Timber found does not list is not offered", () => {
		const some = { state: "listed" as const, tools: [{ tool: "grok", effort: false, interactive: true }, { tool: "claude", effort: true, interactive: true }] };
		expect(offeredArenaTools(some).map(tool => tool.tool)).toEqual(["grok", "claude"]);
		expect(offeredArenaTools({ state: "listed", tools: [] })).toEqual([]);
	});

	test("an older Timber, or a list that could not be read, offers codex, claude, and cursor only", () => {
		const older = offeredArenaTools({ state: "older" });
		expect(older.map(tool => [tool.tool, tool.effort])).toEqual([["codex", true], ["claude", true], ["cursor", true]]);
		expect(offeredArenaTools({ state: "failed", message: "boom" })).toEqual(older);
	});
});

test("no recorded arena record holds the task text", () => {
	for (const text of Object.values(recordedArena)) expect(text).not.toContain("PRIVATE_TASK_SENTINEL");
});
