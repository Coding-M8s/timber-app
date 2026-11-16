import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorkflowReader, readWorkflows } from "../src/bun/workflows";
import { createMockEngine, sampleTimberStatuses } from "../src/mainview/engine/mock";
import { sampleWorkflows } from "../src/mainview/engine/mock-workflows";
import type { TimberStatus } from "../src/shared/model";
import type { WorkflowList } from "../src/shared/workflows";
import { fingerprint, git, realTimber, recordedAppConfig } from "./support/timber";

const windows = process.platform === "win32";
const SECRET = "ghp_SuperSecretToken123";

let root: string;
let folder: string;

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-workflows-")));
	// The working directory has a space and non-ASCII characters in it.
	folder = join(root, "my repo zażółć");
	mkdirSync(folder);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

/** What a stand-in Timber does: print, wait, and exit as told, after reading standard input to its end. */
interface Act {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	/** Wait this long before printing, to act out a Timber that is stuck. */
	waitMs?: number;
}

const STAND_IN = `
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const act = JSON.parse(readFileSync(join(__dirname, "act.json"), "utf8"));
// Read standard input to its end. With input left open, this would never return.
const input = readFileSync(0);
writeFileSync(join(__dirname, "notes.json"), JSON.stringify({ arguments: process.argv.slice(2), cwd: process.cwd(), input: input.length }));
setTimeout(() => {
	if (act.stdout) writeFileSync(1, act.stdout);
	if (act.stderr) writeFileSync(2, act.stderr);
	process.exit(act.exitCode ?? 0);
}, act.waitMs ?? 0);
`;

/** A real executable in a new folder, so the tests spawn an actual process, exactly as the app does. */
function standIn(name: string, act: Act): { path: string; notes: () => { arguments: string[]; cwd: string; input: number } | null } {
	const here = join(root, name);
	mkdirSync(here, { recursive: true });
	writeFileSync(join(here, "act.json"), JSON.stringify(act));
	writeFileSync(join(here, "stand-in.cjs"), STAND_IN);
	const path = join(here, windows ? "timber.cmd" : "timber");
	writeFileSync(path, windows
		? `@echo off\r\n"${process.execPath}" "%~dp0stand-in.cjs" %*\r\nexit /b %errorlevel%\r\n`
		: `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/stand-in.cjs" "$@"\n`);
	if (!windows) chmodSync(path, 0o755);
	const notes = join(here, "notes.json");
	return { path, notes: () => (existsSync(notes) ? JSON.parse(readFileSync(notes, "utf8")) : null) };
}

const ready = (path: string): TimberStatus => ({ state: "ready", path, version: "0.1.1" });

describe("readWorkflows with a stand-in Timber", () => {
	test("runs the settings read in the repository folder, with standard input closed, and reads the record", async () => {
		const timber = standIn("merged", { stdout: recordedAppConfig.records.merged });
		const list = await readWorkflows(timber.path, folder);
		expect(list.ok && list.workflows.map(workflow => workflow.name)).toEqual(["triage", "explore", "ship"]);
		const notes = timber.notes()!;
		expect(notes.arguments).toEqual(["__app-config", "read", "--scope", "repository"]);
		expect(realpathSync(notes.cwd)).toBe(folder);
		expect(notes.input).toBe(0);
	});

	test("a failure passes on Timber's diagnostic", async () => {
		const timber = standIn("invalid", { stderr: recordedAppConfig.failures.invalidConfig, exitCode: 1 });
		expect(await readWorkflows(timber.path, folder)).toEqual({
			ok: false,
			message: "timber __app-config read --scope repository exited with code 1: Invalid config /work/sample/.timber.toml: workflows.review.agent is invalid",
		});
	});

	test("a Timber that takes too long is stopped, and that is a failure", async () => {
		const timber = standIn("stuck", { stdout: recordedAppConfig.records.merged, waitMs: 5_000 });
		const started = Date.now();
		const list = await readWorkflows(timber.path, folder, process.env, 300);
		expect(Date.now() - started).toBeLessThan(4_000);
		expect(list).toEqual({ ok: false, message: `timber __app-config read --scope repository in ${folder} was stopped before it finished. The app waits 0.3 seconds for it.` });
	});

	test("output far bigger than a record is not read", async () => {
		const timber = standIn("huge", { stdout: `${recordedAppConfig.records.merged}${" ".repeat(2 * 1024 * 1024)}` });
		const list = await readWorkflows(timber.path, folder);
		expect(list.ok).toBe(false);
		expect(!list.ok && list.message).toContain("printed more than a settings record holds");
	});

	test("arguments come through exactly, control characters included", async () => {
		const record = recordedAppConfig.records.merged.replaceAll('"--full-auto"', '"a\\u007fb\\u0000c"');
		const list = await readWorkflows(standIn("controls", { stdout: record }).path, folder);
		const ship = list.ok ? list.workflows.find(workflow => workflow.name === "ship") : null;
		expect(ship?.agent).toEqual({ kind: "command", command: "codex", args: ["a\u007fb\u0000c"] });
	});

	test("an executable that cannot be started is a failure", async () => {
		const list = await readWorkflows(join(root, "no such timber"), folder);
		expect(list.ok).toBe(false);
		expect(!list.ok && list.message).toStartWith("Could not run timber __app-config read --scope repository in ");
	});
});

describe("createWorkflowReader", () => {
	const listed = (paths: string[]) => async (path: string) => paths.includes(path);

	test("reads a repository from the list with the Timber that was found", async () => {
		const timber = standIn("reader", { stdout: recordedAppConfig.records.inherited });
		const reader = createWorkflowReader({ timber: async () => ready(timber.path), isListed: listed([folder]) });
		const list = await reader.list(folder);
		expect(list.ok && list.workflows.length).toBe(3);
	});

	test("a repository that is not in the list is refused, and Timber is not run", async () => {
		const timber = standIn("unlisted", { stdout: recordedAppConfig.records.inherited });
		const reader = createWorkflowReader({ timber: async () => ready(timber.path), isListed: listed([]) });
		expect(await reader.list(folder)).toEqual({ ok: false, message: `${folder} is not a repository in the app's list.` });
		expect(timber.notes()).toBeNull();
	});

	test("nothing runs while Timber is not ready", async () => {
		const reader = createWorkflowReader({ timber: async () => ({ state: "not-found", override: null }), isListed: listed([folder]) });
		expect(await reader.list(folder)).toEqual({ ok: false, message: "Timber was not found on PATH." });
	});

	test("a request without a repository is refused", async () => {
		const reader = createWorkflowReader({ timber: async () => ({ state: "not-found", override: null }), isListed: async () => true });
		for (const repository of ["", undefined, 3]) {
			expect((await reader.list(repository as string)).ok).toBe(false);
		}
	});

	test("a check that throws is a failure, not a crash", async () => {
		const reader = createWorkflowReader({ timber: async () => ready("/nowhere"), isListed: async () => { throw new Error("list unreadable"); } });
		expect(await reader.list(folder)).toEqual({ ok: false, message: `Could not read the workflows of ${folder}: list unreadable.` });
	});
});

describe("nothing from the record is logged", () => {
	const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
	const spies: ReturnType<typeof spyOn>[] = [];
	afterEach(() => {
		for (const spy of spies.splice(0)) spy.mockRestore();
	});

	test("neither a record with a token in an argument nor a diagnostic reaches the console", async () => {
		const record = recordedAppConfig.records.merged.replaceAll('"--full-auto"', `"--token=${SECRET}"`);
		const good = standIn("secret-record", { stdout: record, stderr: `warning: ${SECRET}\n` });
		const bad = standIn("secret-failure", { stderr: `error: ${SECRET}\n`, exitCode: 1 });
		for (const method of methods) spies.push(spyOn(console, method));
		const reader = createWorkflowReader({ timber: async () => ready(good.path), isListed: async () => true });
		const list = await reader.list(folder);
		expect(JSON.stringify(list)).toContain(SECRET);
		await readWorkflows(bad.path, folder);
		for (const spy of spies) expect(spy).not.toHaveBeenCalled();
	});

	test("nothing reaches the main process's own output either, by any route", () => {
		const record = recordedAppConfig.records.merged.replaceAll('"--full-auto"', `"--token=${SECRET}"`);
		const good = standIn("secret-child-record", { stdout: record, stderr: `warning: ${SECRET}\n` });
		const bad = standIn("secret-child-failure", { stderr: `error: ${SECRET}\n`, exitCode: 1 });
		const script = join(root, "read-in-a-child.ts");
		writeFileSync(script, [
			`import { createWorkflowReader, readWorkflows } from ${JSON.stringify(join(import.meta.dir, "..", "src", "bun", "workflows.ts"))};`,
			`const reader = createWorkflowReader({ timber: async () => ({ state: "ready", path: ${JSON.stringify(good.path)}, version: "0.1.1" }), isListed: async () => true });`,
			`const list = await reader.list(${JSON.stringify(folder)});`,
			`await readWorkflows(${JSON.stringify(bad.path)}, ${JSON.stringify(folder)});`,
			// Proof that the read worked, without printing what it read.
			"process.exit(list.ok && list.workflows.length === 3 ? 0 : 3);",
		].join("\n"));
		const child = Bun.spawnSync([process.execPath, script], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
		expect(child.exitCode).toBe(0);
		expect(child.stdout.toString()).not.toContain(SECRET);
		expect(child.stderr.toString()).not.toContain(SECRET);
	});
});

/**
 * Whether this Timber has `__app-config`. No release has it yet, so the
 * Timber that the tests find may not: run them with TIMBER_APP_TIMBER_PATH
 * naming a build of Timber's main branch.
 */
function canReadSettings(timber: string | null): boolean {
	if (timber === null) return false;
	const probe = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-probe-")));
	try {
		const result = Bun.spawnSync([timber, "__app-config", "read", "--scope", "global"], {
			cwd: probe, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 10_000,
			env: { PATH: process.env.PATH ?? "", HOME: probe, XDG_CONFIG_HOME: join(probe, "config"), XDG_STATE_HOME: join(probe, "state"), XDG_DATA_HOME: join(probe, "data") },
		});
		return result.exitCode === 0 && result.stdout.toString().startsWith("{");
	} finally {
		rmSync(probe, { recursive: true, force: true });
	}
}

describe.skipIf(!canReadSettings(realTimber))("with a real Timber that has __app-config, on a real repository", () => {
	let work: string;
	let repository: string;
	let config: string;
	let environment: Record<string, string>;

	const MACHINE = `
[workflows.review]
description = "Review someone else's branch"
post_create = ["bun install"]

[workflows.review.agent]
command = "claude"
args = ["--permission-mode", "plan"]

[workflows.triage]
description = "Look at a bug report"
agent = false

[workflows.explore]
`;

	beforeAll(() => {
		work = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-workflows-real-")));
		repository = join(work, "sample repo");
		config = join(work, "config");
		mkdirSync(join(config, "timber"), { recursive: true });
		mkdirSync(repository);
		git(repository, "init", "-q", "-b", "main");
		writeFileSync(join(repository, "README.md"), "sample\n");
		git(repository, "add", "README.md");
		git(repository, "commit", "-q", "-m", "init");
		writeFileSync(join(config, "timber", "config.toml"), MACHINE);
		// Only what Timber needs, so nothing of the person's own settings or credentials is read.
		environment = { PATH: process.env.PATH ?? "", HOME: join(work, "home"), XDG_CONFIG_HOME: config, XDG_STATE_HOME: join(work, "state"), XDG_DATA_HOME: join(work, "data") };
	});

	afterAll(() => {
		rmSync(work, { recursive: true, force: true });
	});

	const names = (list: WorkflowList) => (list.ok ? list.workflows.map(workflow => workflow.name) : list.message);

	/**
	 * Read as the app does, and check that reading changed nothing: the
	 * repository and the config folder have the same files, times, refs, and
	 * index, and Timber made no home, state, or data folder of its own.
	 */
	async function readUnchanged(): Promise<WorkflowList> {
		const before = [fingerprint(repository), fingerprint(config)];
		const list = await readWorkflows(realTimber!, repository, environment);
		expect([fingerprint(repository), fingerprint(config)]).toEqual(before);
		for (const made of ["home", "state", "data"]) expect(existsSync(join(work, made))).toBe(false);
		return list;
	}

	test("machine workflows alone, with each kind of agent", async () => {
		rmSync(join(repository, ".timber.toml"), { force: true });
		expect(await readUnchanged()).toEqual({
			ok: true,
			workflows: [
				{ name: "review", description: "Review someone else's branch", agent: { kind: "command", command: "claude", args: ["--permission-mode", "plan"] } },
				{ name: "triage", description: "Look at a bug report", agent: { kind: "none" } },
				{ name: "explore", description: null, agent: { kind: "not-set" } },
			],
		});
	});

	test("both files merged by name, review = false hiding the inherited one, and reading changes nothing", async () => {
		writeFileSync(join(repository, ".timber.toml"), `
[workflows]
review = false

[workflows.ship]
description = "Get a change ready to merge"

[workflows.ship.agent]
command = "codex"
args = ["--full-auto"]

[workflows.explore]
description = "Read the code, change nothing"
`);
		const list = await readUnchanged();
		expect(names(list)).toEqual(["triage", "explore", "ship"]);
		expect(list.ok && list.workflows.find(workflow => workflow.name === "explore")!.description).toBe("Read the code, change nothing");
	});

	test("workflows = false in the repository is an empty list", async () => {
		writeFileSync(join(repository, ".timber.toml"), "workflows = false\n");
		expect(await readUnchanged()).toEqual({ ok: true, workflows: [] });
	});

	test("a malformed .timber.toml is a failure that names the file, not an empty list", async () => {
		writeFileSync(join(repository, ".timber.toml"), `name = "${SECRET}\n[[[`);
		const list = await readUnchanged();
		expect(list.ok).toBe(false);
		expect(!list.ok && list.message).toContain(join(repository, ".timber.toml"));
		expect(!list.ok && list.message).not.toContain(SECRET);
	});
});

describe("the mock engine", () => {
	test("offers sample workflows with a command, none, and no agent set", async () => {
		const engine = createMockEngine();
		const list = await engine.listWorkflows("/work/timber");
		expect(list).toEqual({ ok: true, workflows: sampleWorkflows });
		expect(new Set(sampleWorkflows.map(workflow => workflow.agent.kind))).toEqual(new Set(["command", "none", "not-set"]));
	});

	test("a listed repository without samples has none, and one outside the list is refused", async () => {
		const engine = createMockEngine();
		expect(await engine.listWorkflows("/work/api-server")).toEqual({ ok: true, workflows: [] });
		expect((await engine.listWorkflows("/elsewhere")).ok).toBe(false);
	});

	test("nothing is read while Timber is not ready", async () => {
		const engine = createMockEngine(undefined, sampleTimberStatuses["too-old"]);
		expect((await engine.listWorkflows("/work/timber")).ok).toBe(false);
	});

	test("an answer can be chosen, and handed out as a copy", async () => {
		const engine = createMockEngine();
		engine.setWorkflows("/work/timber", { ok: false, message: "Invalid TOML" });
		expect(await engine.listWorkflows("/work/timber")).toEqual({ ok: false, message: "Invalid TOML" });
		engine.setWorkflows("/work/timber", null);
		const first = await engine.listWorkflows("/work/timber");
		if (first.ok) first.workflows.length = 0;
		expect(await engine.listWorkflows("/work/timber")).toEqual({ ok: true, workflows: sampleWorkflows });
	});
});
