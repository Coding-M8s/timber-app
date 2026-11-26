import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createArenaCommands } from "../src/bun/arenas";
import type { ArenaGroup, NewArenaRequest } from "../src/shared/arenas";
import { windows } from "./support/runtime";
import { bunStandIn, fingerprint, git, gitIdentity, isolatedEnvironment, makeRepository, readyAt, realTimber, recordedArena } from "./support/timber";

// Creating an arena makes worktrees and runs setup, so the real Timber takes longer than one command.
setDefaultTimeout(windows ? 120_000 : 30_000);

const ready = readyAt("0.1.3");
const TASK = "PRIVATE_TASK_SENTINEL: fix the login\n' $(touch NEVER) \"quoted\"";

let root: string;
let folder: string;

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-arenas-")));
	folder = join(root, "my repo zażółć");
	mkdirSync(folder);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

/**
 * A stand-in Timber for arenas. `__app-arena list` prints the list record and
 * `__app-arena launch` the launch record; a command with `--result-file`
 * writes the result. Every run is noted, with the task file's text and its
 * permission bits, and the permission bits of the folder that holds it.
 */
const ARENA_STAND_IN = `
const { appendFileSync, readFileSync, statSync, writeFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const plan = JSON.parse(readFileSync(join(folder, "plan.json"), "utf8"));
const given = process.argv.slice(2);
const at = (flag) => { const index = given.indexOf(flag); return index === -1 ? null : given[index + 1] ?? null; };
const taskFile = at("--prompt-file");
let task = null, taskMode = null, taskFolderMode = null;
if (taskFile !== null) {
	task = readFileSync(taskFile, "utf8");
	taskMode = statSync(taskFile).mode & 0o777;
	taskFolderMode = statSync(dirname(taskFile)).mode & 0o777;
}
appendFileSync(join(folder, "runs.jsonl"), JSON.stringify({ arguments: given, cwd: process.cwd(), taskFile, task, taskMode, taskFolderMode }) + "\\n");
const step = given[0] === "__app-arena" ? plan[given[1]] : plan[given[1]];
const resultFile = at("--result-file");
if (step.result && resultFile !== null) writeFileSync(resultFile, step.result, { flag: "wx", mode: 0o600 });
if (step.stdout) writeFileSync(1, step.stdout);
if (step.stderr) writeFileSync(2, step.stderr);
process.exit(step.exitCode ?? 0);
`;

interface Step { stdout?: string; stderr?: string; result?: string; exitCode?: number }
type Plan = Partial<Record<"list" | "launch" | "new" | "pick" | "tools", Step>>;
interface Run { arguments: string[]; cwd: string; taskFile: string | null; task: string | null; taskMode: number | null; taskFolderMode: number | null }

function arenaStandIn(name: string, plan: Plan): { path: string; runs: () => Run[] } {
	const here = join(root, name);
	mkdirSync(here, { recursive: true });
	writeFileSync(join(here, "plan.json"), JSON.stringify(plan));
	const path = bunStandIn(here, ARENA_STAND_IN);
	const log = join(here, "runs.jsonl");
	return { path, runs: () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(line => JSON.parse(line) as Run) : [] };
}

const listed = (path: string) => Promise.resolve(path === folder);
const groups: ArenaGroup[] = [{ kind: "preset", preset: "stub", runs: 1 }, { kind: "tool", tool: "manual", model: null, effort: null, runs: 1 }];
const request = (change: Partial<NewArenaRequest> = {}): NewArenaRequest => ({ repository: folder, name: "demo", task: TASK, groups, base: null, ...change });

describe("ArenaCommands, with a stand-in Timber", () => {
	test("list runs timber __app-arena list in the repository and reads the record", async () => {
		const timber = arenaStandIn("list", { list: { stdout: recordedArena.list } });
		const commands = createArenaCommands({ timber: async () => ready(timber.path), isListed: listed, endSessionsIn: async () => [] });
		const list = await commands.list(folder);
		expect(list.state).toBe("listed");
		expect(timber.runs()).toEqual([expect.objectContaining({ arguments: ["__app-arena", "list"], cwd: folder })]);
	});

	test("a Timber without __app-arena is unsupported", async () => {
		const timber = arenaStandIn("unsupported", { list: { stderr: recordedArena.unknownCommand, exitCode: 1 } });
		const commands = createArenaCommands({ timber: async () => ready(timber.path), isListed: listed, endSessionsIn: async () => [] });
		expect(await commands.list(folder)).toEqual({ state: "unsupported" });
	});

	test("tools runs timber __app-arena tools in the repository and reads what it lists", async () => {
		const timber = arenaStandIn("tools", { tools: { stdout: recordedArena.tools } });
		const commands = createArenaCommands({ timber: async () => ready(timber.path), isListed: listed, endSessionsIn: async () => [] });
		const tools = await commands.tools(folder);
		expect(tools.state === "listed" && tools.tools.map(tool => tool.tool)).toEqual(["codex", "claude", "cursor", "gemini", "grok", "opencode", "copilot", "qwen", "amp", "pi"]);
		expect(timber.runs()).toEqual([expect.objectContaining({ arguments: ["__app-arena", "tools"], cwd: folder })]);
	});

	test("a Timber without the tools action is older, and tools asks only for a listed repository with Timber ready", async () => {
		const timber = arenaStandIn("tools-older", { tools: { stderr: recordedArena.toolsOlder, exitCode: 1 } });
		const commands = createArenaCommands({ timber: async () => ready(timber.path), isListed: listed, endSessionsIn: async () => [] });
		expect(await commands.tools(folder)).toEqual({ state: "older" });
		expect((await commands.tools(join(root, "elsewhere"))).state).toBe("failed");
		expect((await commands.tools("")).state).toBe("failed");
		const missing = createArenaCommands({ timber: async () => ({ state: "not-found", source: "path", path: null }), isListed: listed, endSessionsIn: async () => [] });
		expect((await missing.tools(folder)).state).toBe("failed");
		expect(timber.runs()).toHaveLength(1);
	});

	test("only a repository in the app's list, and only while Timber is ready", async () => {
		const timber = arenaStandIn("guard", { list: { stdout: recordedArena.list } });
		const commands = createArenaCommands({ timber: async () => ready(timber.path), isListed: listed, endSessionsIn: async () => [] });
		expect(await commands.list(join(root, "elsewhere"))).toEqual({ state: "failed", message: `${join(root, "elsewhere")} is not a repository in the app's list.` });
		const notFound = createArenaCommands({ timber: async () => ({ state: "not-found", source: "path", path: null }), isListed: listed, endSessionsIn: async () => [] });
		expect((await notFound.list(folder)).state).toBe("failed");
		expect(timber.runs()).toEqual([]);
	});

	// Skipped on Windows: these check POSIX permission bits of the private task file.
	test.skipIf(windows)("create passes the task in a private file, never as an argument, and the file is gone afterwards", async () => {
		const scratch = join(root, "scratch-create");
		mkdirSync(scratch);
		const timber = arenaStandIn("create", { new: { result: recordedArena.newSucceeded } });
		const commands = createArenaCommands({ timber: async () => ready(timber.path), isListed: listed, endSessionsIn: async () => [], temporaryRoot: scratch });
		const result = await commands.create(request({ base: "main" }));
		expect(result).toMatchObject({ outcome: "created", arena: { name: "demo" } });
		const [run] = timber.runs();
		expect(run!.cwd).toBe(folder);
		expect(run!.task).toBe(TASK);
		expect(run!.taskMode).toBe(0o600);
		expect(run!.taskFolderMode).toBe(0o700);
		expect(run!.arguments.join("\n")).not.toContain("PRIVATE_TASK_SENTINEL");
		expect(run!.arguments).toEqual([
			"arena", "new", "--preset=stub", "--runs=1", "--tool=manual", "--runs=1", "--base=main",
			"--prompt-file", run!.taskFile!, "--no-editor", "--no-agent", "--result-file", expect.any(String), "--", "demo",
		]);
		expect(existsSync(run!.taskFile!)).toBe(false);
	});

	test("a failed create shows the command with the task file's placeholder, never the task", async () => {
		const timber = arenaStandIn("create-failed", { new: { result: recordedArena.newExists, stderr: "error: Arena already exists\n", exitCode: 1 } });
		const commands = createArenaCommands({ timber: async () => ready(timber.path), isListed: listed, endSessionsIn: async () => [] });
		const result = await commands.create(request());
		if (result.outcome !== "failed") throw new Error(result.outcome);
		expect(result.failure.command).toBe("timber arena new --preset=stub --runs=1 --tool=manual --runs=1 --prompt-file <task file> --no-editor --no-agent --result-file <temporary file> -- demo");
		expect(JSON.stringify(result)).not.toContain("PRIVATE_TASK_SENTINEL");
	});

	test("create refuses a request Timber could not take, before running anything", async () => {
		const timber = arenaStandIn("create-refused", { new: { result: recordedArena.newSucceeded } });
		const commands = createArenaCommands({ timber: async () => ready(timber.path), isListed: listed, endSessionsIn: async () => [] });
		expect(await commands.create(request({ task: " " }))).toMatchObject({ outcome: "failed", ran: false, failure: { diagnostic: "Write the task the attempts work on. Nothing was run." } });
		expect(await commands.create(request({ groups: [{ kind: "tool", tool: "codex", model: null, effort: null, runs: 1 }] }))).toMatchObject({ outcome: "failed", ran: false });
		expect(await commands.create({ repository: folder } as NewArenaRequest)).toMatchObject({ outcome: "failed", ran: false });
		expect(timber.runs()).toEqual([]);
	});

	test("pick reads the list afresh and ends the app's sessions in the other attempts only, before Timber runs", async () => {
		const timber = arenaStandIn("pick-ends", { list: { stdout: recordedArena.list }, pick: { result: recordedArena.pickSucceeded } });
		const order: string[] = [];
		const commands = createArenaCommands({
			timber: async () => ready(timber.path), isListed: listed,
			endSessionsIn: async paths => {
				order.push(`end ${paths.join(" ")}`, `runs before: ${timber.runs().map(run => run.arguments[0]).join(" ")}`);
				return [];
			},
		});
		const result = await commands.pick({ repository: folder, arena: "demo", winner: "manual-1" });
		expect(result).toMatchObject({ outcome: "picked" });
		// The winner's folder is never asked about, so its sessions keep running.
		expect(order).toEqual(["end /work/sample-worktrees/arena-demo-stub-1", "runs before: __app-arena"]);
		expect(timber.runs().map(run => run.arguments[0])).toEqual(["__app-arena", "arena"]);
	});

	test("a session that does not end stops the pick, which never runs", async () => {
		const timber = arenaStandIn("pick-stuck", { list: { stdout: recordedArena.list }, pick: { result: recordedArena.pickSucceeded } });
		const commands = createArenaCommands({ timber: async () => ready(timber.path), isListed: listed, endSessionsIn: async () => ["stub-1"] });
		const result = await commands.pick({ repository: folder, arena: "demo", winner: "manual-1" });
		expect(result).toMatchObject({ outcome: "failed", ran: false, pick: null, failure: { diagnostic: "These sessions in the other attempts did not end: stub-1. Close them, then keep manual-1 again. Nothing was run." } });
		expect(timber.runs().map(run => run.arguments[0])).toEqual(["__app-arena"]);
	});

	test("an unknown winner ends no session", async () => {
		const timber = arenaStandIn("pick-unknown-winner", { list: { stdout: recordedArena.list }, pick: { result: recordedArena.pickSucceeded } });
		let ended = 0;
		const commands = createArenaCommands({ timber: async () => ready(timber.path), isListed: listed, endSessionsIn: async () => (ended++, []) });
		expect(await commands.pick({ repository: folder, arena: "demo", winner: "codex-9" })).toMatchObject({ outcome: "failed", ran: false, failure: { diagnostic: "Timber lists no attempt codex-9 in arena demo. Nothing was run." } });
		expect(ended).toBe(0);
	});

	test("pick runs with a result file and reads what it did to each attempt", async () => {
		const timber = arenaStandIn("pick", { list: { stdout: recordedArena.list }, pick: { result: recordedArena.pickSucceeded } });
		const commands = createArenaCommands({ timber: async () => ready(timber.path), isListed: listed, endSessionsIn: async () => [] });
		const result = await commands.pick({ repository: folder, arena: "demo", winner: "manual-1" });
		expect(result).toMatchObject({ outcome: "picked", pick: { winner: "manual-1" } });
		const pick = timber.runs()[1]!;
		expect(pick.arguments).toEqual(["arena", "pick", "demo", "--winner", "manual-1", "--result-file", expect.any(String)]);
	});

	test("pick refuses an arena Timber does not list, and names that look like options", async () => {
		const timber = arenaStandIn("pick-unknown", { list: { stdout: recordedArena.list }, pick: { result: recordedArena.pickSucceeded } });
		const commands = createArenaCommands({ timber: async () => ready(timber.path), isListed: listed, endSessionsIn: async () => [] });
		expect(await commands.pick({ repository: folder, arena: "nothing", winner: "manual-1" })).toMatchObject({ outcome: "failed", ran: false, failure: { diagnostic: "Timber lists no arena called nothing. Nothing was run." } });
		expect(await commands.pick({ repository: folder, arena: "demo", winner: "--keep-ignored" })).toMatchObject({ outcome: "failed", ran: false });
		expect(timber.runs().filter(run => run.arguments[0] === "arena")).toEqual([]);
	});

	test("launch asks Timber in the attempt's worktree and reads the command it gives", async () => {
		const worktree = join(root, "attempt");
		mkdirSync(worktree);
		const timber = arenaStandIn("launch", { launch: { stdout: recordedArena.launchReady } });
		const commands = createArenaCommands({ timber: async () => ready(timber.path), isListed: listed, endSessionsIn: async () => [] });
		const launch = await commands.launch({ repository: folder, worktree, arena: "demo", attempt: "stub-1" });
		expect(launch).toMatchObject({ outcome: "ready", argv: ["/work/stub-agent", "--go"] });
		expect(timber.runs()[0]).toMatchObject({ arguments: ["__app-arena", "launch", "demo", "--attempt", "stub-1"], cwd: worktree });
	});
});

/** Whether the Timber found has arenas for apps: the installed release may not, and then these are skipped. */
function hasArenas(executable: string | null): boolean {
	if (executable === null) return false;
	const probe = Bun.spawnSync([executable, "__app-arena", "list"], { cwd: tmpdir(), stdin: "ignore", stdout: "pipe", stderr: "pipe" });
	return probe.stdout.toString().trim().startsWith("{");
}
const arenaTimber = hasArenas(realTimber) ? realTimber : null;

// Skipped on Windows: the stub agent is a shell script.
describe.skipIf(arenaTimber === null || windows)("ArenaCommands, with the real Timber in a real repository", () => {
	let base: string;
	let repository: string;
	let environment: Record<string, string | undefined>;

	beforeAll(() => {
		base = join(root, "real");
		mkdirSync(base);
		environment = { ...isolatedEnvironment(base), ...gitIdentity };
		const agent = join(base, "stub-agent");
		writeFileSync(agent, "#!/bin/sh\nexit 0\n");
		chmodSync(agent, 0o755);
		repository = makeRepository(base, "sample", {
			"tracked.txt": "one\n",
			".timber.toml": `[arena.agents.stub]\ntool = "wrapper"\ncommand = "${agent}"\nargs = ["--go"]\n`,
		});
	});

	const commandsFor = (stuck: string[] = []) => createArenaCommands({
		timber: async () => ready(arenaTimber!), isListed: path => Promise.resolve(path === repository), endSessionsIn: async () => stuck, environment,
	});

	test("create, then list, launch, and inspect, which change no file or ref; then pick", async () => {
		const commands = commandsFor();
		expect(await commands.list(repository)).toEqual({ state: "listed", arenas: [] });
		expect(await commands.presets(repository)).toEqual({ ok: true, presets: [{ name: "stub", tool: "wrapper" }] });
		// The released 0.2.0 has no tools action, and a newer Timber lists at least the three every Timber runs.
		const tools = await commands.tools(repository);
		if (tools.state === "failed") throw new Error(tools.message);
		if (tools.state === "listed") expect(tools.tools.map(tool => tool.tool)).toEqual(expect.arrayContaining(["codex", "claude", "cursor"]));

		const created = await commands.create({ repository, name: "demo", task: TASK, groups, base: null });
		if (created.outcome !== "created") throw new Error(JSON.stringify(created));
		expect(created.arena.attempts.map(attempt => [attempt.label, attempt.stage])).toEqual([["stub-1", "ready"], ["manual-1", "ready"]]);
		// Timber keeps the task in its own private snapshot, byte for byte.
		const launchEnvironment = await commands.launch({ repository, worktree: created.arena.attempts[0]!.path, arena: "demo", attempt: "stub-1" });
		if (launchEnvironment.outcome !== "ready") throw new Error(JSON.stringify(launchEnvironment));
		expect(readFileSync(launchEnvironment.environment.TIMBER_TASK_FILE!, "utf8")).toBe(TASK);
		expect(existsSync(join(repository, "NEVER"))).toBe(false);

		// Work in one attempt: a commit, an edit, and a new file.
		const stub = created.arena.attempts[0]!.path;
		writeFileSync(join(stub, "tracked.txt"), "one\ntwo\n");
		git(stub, "commit", "-am", "Work");
		writeFileSync(join(stub, "tracked.txt"), "one\ntwo\nthree\n");
		writeFileSync(join(stub, "new.txt"), "new\n");

		const before = fingerprint(base);
		const list = await commands.list(repository);
		expect(list.state === "listed" && list.arenas.map(arena => arena.name)).toEqual(["demo"]);
		expect(JSON.stringify(list)).not.toContain("PRIVATE_TASK_SENTINEL");
		expect(await commands.launch({ repository, worktree: created.arena.attempts[1]!.path, arena: "demo", attempt: "manual-1" })).toEqual({ outcome: "no-agent" });
		const launch = await commands.launch({ repository, worktree: stub, arena: "demo", attempt: "stub-1" });
		expect(launch).toMatchObject({ outcome: "ready", cwd: stub, argv: [join(base, "stub-agent"), "--go"] });
		const inspection = await commands.inspect({ repository, arena: "demo" });
		if (inspection.state !== "inspected") throw new Error(JSON.stringify(inspection));
		expect(inspection.attempts.find(attempt => attempt.label === "stub-1")!.comparison).toEqual({
			commits: 1, committed: { files: 1, insertions: 1, deletions: 0 }, uncommitted: { files: 1, insertions: 1, deletions: 0 }, untracked: 1, ignored: 0,
		});
		expect(fingerprint(base)).toBe(before);

		// When a session in another attempt does not end, nothing is picked and nothing changes.
		expect(await commandsFor(["Agent stub-1"]).pick({ repository, arena: "demo", winner: "manual-1" })).toMatchObject({ outcome: "failed", ran: false });
		expect(fingerprint(base)).toBe(before);

		const picked = await commands.pick({ repository, arena: "demo", winner: "manual-1" });
		if (picked.outcome !== "picked") throw new Error(JSON.stringify(picked));
		expect(picked.pick.attempts).toEqual([
			{ label: "stub-1", outcome: "archived", archiveRef: "refs/timber/arena/demo/stub-1", reason: null },
			{ label: "manual-1", outcome: "winner", archiveRef: null, reason: null },
		]);
		expect(existsSync(stub)).toBe(false);
		const after = await commands.list(repository);
		expect(after.state === "listed" && after.arenas[0]!.outcome === "read" && after.arenas[0]!.winner).toBe("manual-1");
	});
});
