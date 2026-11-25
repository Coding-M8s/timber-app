import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TerminalDependencies, type TerminalSessions, createTerminalSessions } from "../src/bun/terminals";
import { describeCommandLine } from "../src/shared/command-line";
import type { Repository } from "../src/shared/model";
import type { OpenTerminalRequest, TerminalChange, TerminalOutput } from "../src/shared/terminal";
import type { WorkflowList } from "../src/shared/workflows";

const posix = process.platform !== "win32";

async function until(check: () => boolean, milliseconds = 5000): Promise<boolean> {
	const end = Date.now() + milliseconds;
	while (Date.now() < end) {
		if (check()) return true;
		await Bun.sleep(20);
	}
	return check();
}

function git(cwd: string, ...args: string[]): string {
	const run = Bun.spawnSync(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], {
		cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
	});
	if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
	return run.stdout.toString();
}

/** A made-up token in a workflow's arguments, which must never be logged. */
const TOKEN = "tok-3f9a1c7e";

// Pseudo terminals exist on Linux and macOS only.
describe.skipIf(!posix)("a workflow's agent in a terminal session", () => {
	let root: string;
	let repository: string;
	let worktree: string;
	let unlisted: string;
	let bin: string;
	let sessions: TerminalSessions;
	let outputs: TerminalOutput[];
	let changes: TerminalChange[];
	let list: WorkflowList;
	let reads: number;

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-workflow-agent-")));
		repository = join(root, "my repo");
		worktree = join(root, "my repo-worktrees", "feat login");
		unlisted = join(root, "elsewhere");
		mkdirSync(repository, { recursive: true });
		mkdirSync(unlisted);
		git(repository, "init", "-q", "-b", "main");
		writeFileSync(join(repository, "README.md"), "hello\n");
		git(repository, "add", "README.md");
		git(repository, "commit", "-q", "-m", "first");
		git(repository, "worktree", "add", "-q", "-b", "feat/login", worktree);
		// Pretend agents in a folder with a space, each printing its folder and arguments, then echoing lines.
		bin = join(root, "agent bin");
		mkdirSync(bin);
		for (const name of ["fake-claude", "fake-codex"]) {
			const script = join(bin, name);
			writeFileSync(script, `#!/bin/sh\nprintf '${name} in %s args' "$(pwd)"\nfor arg in "$@"; do printf ' [%s]' "$arg"; done\necho\nwhile read line; do echo "${name} got $line"; done\n`);
			chmodSync(script, 0o755);
		}
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	afterEach(() => {
		sessions?.killAll();
	});

	const listed = (): Repository => ({
		path: repository, name: "my repo", available: true, failure: null,
		setup: "repository",
		fallbackBase: null,
		worktrees: [repository, worktree].map((path, index) => ({
			id: `id:${path}`, path, canonicalPath: path, branch: index === 0 ? "main" : "feat/login", head: null, primary: index === 0, detached: false,
			locked: false, prunable: false, pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null, baseCounts: null,
		})),
	});

	const review = (command = "fake-claude", args = ["--permission-mode", "plan", "--note", "two words", `--token=${TOKEN}`]): WorkflowList => ({
		ok: true,
		workflows: [
			{ name: "review", description: null, agent: { kind: "command", command, args } },
			{ name: "triage", description: null, agent: { kind: "none" } },
			{ name: "explore", description: null, agent: { kind: "not-set" } },
		],
	});

	function start(overrides: Partial<TerminalDependencies> = {}): TerminalSessions {
		outputs = [];
		changes = [];
		reads = 0;
		list = review();
		sessions = createTerminalSessions({
			findRepository: async path => path === repository ? listed() : null,
			onOutput: output => outputs.push(output),
			onChange: change => changes.push(change),
			environment: { PATH: `${bin}:${process.env.PATH}`, HOME: root, SHELL: "/bin/sh", PS1: "$ ", LANG: "C.UTF-8" },
			agents: async () => [{ name: "Codex", command: "fake-codex" }],
			workflows: async path => {
				reads += 1;
				expect(path).toBe(repository);
				return list;
			},
			closeMilliseconds: 500,
			...overrides,
		});
		return sessions;
	}

	const printed = (id: string) => outputs.filter(output => output.id === id).map(output => output.data).join("");
	const seen = async (id: string, text: string) => {
		const found = await until(() => printed(id).includes(text));
		if (!found) throw new Error(`Did not see ${text}. Printed: ${JSON.stringify(printed(id))}`);
	};

	const request = (workflowAgent: unknown, extra: Record<string, unknown> = {}): OpenTerminalRequest =>
		({ repository, worktree, cols: 80, rows: 24, workflowAgent, ...extra }) as unknown as OpenTerminalRequest;

	test("the workflow's agent starts in the worktree's folder, named after the workflow, with its arguments as Timber reports them", async () => {
		start();
		const result = await sessions.open(request({ workflow: "review" }));
		if (result.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(result)}`);
		const executable = join(bin, "fake-claude");
		expect(result.session).toMatchObject({ kind: "agent", name: "review", path: worktree, shell: executable, state: { kind: "running" } });
		expect(result.session.command).toBe(describeCommandLine([executable, "--permission-mode", "plan", "--note", "two words", `--token=${TOKEN}`]));
		await seen(result.session.id, `fake-claude in ${worktree} args [--permission-mode] [plan] [--note] [two words] [--token=${TOKEN}]`);
		expect(reads).toBe(1);
	});

	test("a workflow's agent that ends by itself goes on as a shell in the worktree, named as a terminal", async () => {
		const quitter = join(bin, "fake-quitter");
		writeFileSync(quitter, "#!/bin/sh\necho quitter-out\nexit 3\n");
		chmodSync(quitter, 0o755);
		start();
		list = review("fake-quitter", []);
		const result = await sessions.open(request({ workflow: "review" }));
		if (result.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(result)}`);
		expect(await until(() => sessions.list()[0]?.kind === "terminal")).toBe(true);
		expect(sessions.list()[0]).toMatchObject({
			id: result.session.id, name: "Terminal", state: { kind: "running" }, path: worktree,
			endedAgent: { name: "review", agent: null, program: null, resumable: null, conversation: null, exitCode: 3 },
		});
		expect(changes.filter(change => change.session?.state.kind === "exited")).toEqual([]);
		expect(printed(result.session.id)).toContain("review exited with code 3. This is now a shell in");
	});

	test("a command or arguments in the request are never used: only names are read", async () => {
		start();
		const result = await sessions.open(request({ workflow: "review", command: "fake-codex", args: ["--evil"] }));
		if (result.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(result)}`);
		expect(result.session.shell).toBe(join(bin, "fake-claude"));
		await seen(result.session.id, "fake-claude in");
		expect(printed(result.session.id)).not.toContain("--evil");
		expect(result.session.command).not.toContain("--evil");
	});

	test("a request for a workflow's agent that cannot be read starts nothing and reads no workflow", async () => {
		start();
		const unreadable: [unknown, Record<string, unknown>][] = [
			["review", {}], [null, {}], [{}, {}], [{ workflow: "--setup" }, {}], [{ workflow: "Review" }, {}], [{ workflow: 7 }, {}],
			[{ workflow: "review" }, { agent: "Codex" }], [{ workflow: "review", agent: 7 }, {}],
			[{ workflow: "review" }, { arenaAttempt: { arena: "login", attempt: "a1" } }],
			[{ workflow: "review" }, { timberWorktreeSetup: {} }],
		];
		for (const [workflowAgent, extra] of unreadable) {
			const result = await sessions.open(request(workflowAgent, extra));
			expect(result).toEqual({ outcome: "failed", message: "The request for a workflow's agent cannot be read. Nothing was started." });
		}
		expect(sessions.list()).toEqual([]);
		expect(changes).toEqual([]);
		expect(reads).toBe(0);
	});

	test("an arena attempt and a workflow's agent in one request start nothing, and neither Timber read runs", async () => {
		let asked = 0;
		start({ arenaLaunch: async () => {
			asked += 1;
			return { outcome: "failed", message: "Not asked." };
		} });
		const result = await sessions.open(request({ workflow: "review" }, { arenaAttempt: { arena: "login", attempt: "a1" } }));
		expect(result).toEqual({ outcome: "failed", message: "The request for a workflow's agent cannot be read. Nothing was started." });
		expect(asked).toBe(0);
		expect(reads).toBe(0);
		expect(sessions.list()).toEqual([]);
	});

	test("a workflow that turns the agent off starts nothing, not even an agent from Settings", async () => {
		start();
		const result = await sessions.open(request({ workflow: "triage" }));
		expect(result.outcome).toBe("not-configured");
		if (result.outcome === "not-configured") expect(result.message).toContain("agent = false");
		expect(sessions.list()).toEqual([]);
	});

	test("a workflow that no longer sets an agent starts nothing, and no agent from Settings starts in its place", async () => {
		start();
		const result = await sessions.open(request({ workflow: "explore" }));
		expect(result).toEqual({ outcome: "not-configured", message: `The explore workflow no longer sets an agent. Nothing was started. Start one from the "+" menu.` });
		expect(sessions.list()).toEqual([]);
	});

	test("a workflow that leaves the agent unset starts the saved agent the request names with it, named after that agent", async () => {
		start();
		const result = await sessions.open(request({ workflow: "explore", agent: "Codex" }));
		if (result.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(result)}`);
		expect(result.session).toMatchObject({ kind: "agent", name: "Codex", shell: join(bin, "fake-codex") });
		await seen(result.session.id, `fake-codex in ${worktree} args`);
		expect(reads).toBe(1);
	});

	test("the saved agent named with a workflow gives way to what Timber reports: a command starts in its place, and agent = false starts nothing", async () => {
		start();
		const set = await sessions.open(request({ workflow: "review", agent: "Codex" }));
		if (set.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(set)}`);
		expect(set.session).toMatchObject({ name: "review", shell: join(bin, "fake-claude") });
		expect(await sessions.open(request({ workflow: "triage", agent: "Codex" }))).toEqual({ outcome: "not-configured", message: "The triage workflow now starts no agent (agent = false). Nothing was started." });
		expect(await sessions.open(request({ workflow: "explore", agent: "Nobody" }))).toEqual({ outcome: "not-configured", message: 'No agent called "Nobody" is set in Settings, Agents. Nothing was started.' });
		expect(sessions.list().map(session => session.name)).toEqual(["review"]);
	});

	test("the saved agent named with a workflow starts when Timber cannot say the workflow sets one: gone, or workflows that cannot be read", async () => {
		start();
		const gone = await sessions.open(request({ workflow: "gone", agent: "Codex" }));
		expect(gone).toMatchObject({ outcome: "opened", session: { name: "Codex", shell: join(bin, "fake-codex") } });
		list = { ok: false, message: "Timber could not be run." };
		const unreadable = await sessions.open(request({ workflow: "review", agent: "Codex" }));
		expect(unreadable).toMatchObject({ outcome: "opened", session: { name: "Codex 2", shell: join(bin, "fake-codex") } });
		expect(reads).toBe(2);
	});

	test("a workflow that is gone, or workflows that cannot be read, start nothing", async () => {
		start();
		list = { ok: true, workflows: [] };
		expect(await sessions.open(request({ workflow: "review" }))).toEqual({
			outcome: "not-configured", message: `Timber lists no workflow called "review" for ${repository} now. Nothing was started.`,
		});
		list = { ok: false, message: "Timber is not ready." };
		expect(await sessions.open(request({ workflow: "review" }))).toEqual({
			outcome: "failed", message: "Could not read the agent of the review workflow: Timber is not ready. Nothing was started.",
		});
		start({ workflows: async () => { throw new Error("broken pipe"); } });
		expect(await sessions.open(request({ workflow: "review" }))).toEqual({
			outcome: "failed", message: "Could not read the agent of the review workflow: broken pipe. Nothing was started.",
		});
		expect(sessions.list()).toEqual([]);
	});

	test("workflows that cannot be read here when none are passed in start nothing", async () => {
		start();
		sessions = createTerminalSessions({
			findRepository: async path => path === repository ? listed() : null,
			onOutput: () => {},
			onChange: () => {},
			environment: { PATH: `${bin}:${process.env.PATH}`, HOME: root, SHELL: "/bin/sh", LANG: "C.UTF-8" },
		});
		const result = await sessions.open(request({ workflow: "review" }));
		expect(result.outcome).toBe("failed");
		expect(sessions.list()).toEqual([]);
	});

	test("a workflow's command changed since it was picked: the one Timber reports now starts", async () => {
		start();
		list = review("fake-codex", ["--fresh"]);
		const result = await sessions.open(request({ workflow: "review" }));
		if (result.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(result)}`);
		expect(result.session.command).toBe(describeCommandLine([join(bin, "fake-codex"), "--fresh"]));
		await seen(result.session.id, "fake-codex in");
	});

	test("the workflow's executable follows the same rules as an agent's", async () => {
		start();
		list = review("./bin/agent", ["--x"]);
		const relative = await sessions.open(request({ workflow: "review" }));
		expect(relative.outcome).toBe("failed");
		if (relative.outcome === "failed") {
			expect(relative.message).toContain("The agent command of the review workflow starts with the relative path ./bin/agent.");
			expect(relative.message).toContain("Timber's settings");
			expect(relative.command).toBe("./bin/agent --x");
		}
		list = review("no-such-agent", ["--flag"]);
		const missing = await sessions.open(request({ workflow: "review" }));
		expect(missing).toMatchObject({ outcome: "not-found", command: "no-such-agent --flag", executable: "no-such-agent" });
		if (missing.outcome === "not-found") expect(missing.message).toContain("Could not start the agent of the review workflow.");
		expect(sessions.list()).toEqual([]);
	});

	test("a worktree Timber does not list gets no workflow agent", async () => {
		start();
		const result = await sessions.open({ ...request({ workflow: "review" }), worktree: unlisted });
		expect(result.outcome).toBe("not-listed");
		if (result.outcome === "not-listed") expect(result.message).toContain("The agent of the review workflow was not started.");
		expect(sessions.list()).toEqual([]);
	});

	test("a workflow's agent is named as other agents are, after the branch when Settings says so, and numbered", async () => {
		start({ sessionNaming: async () => "branch" });
		const one = await sessions.open(request({ workflow: "review" }));
		const two = await sessions.open(request({ workflow: "review" }));
		if (one.outcome !== "opened" || two.outcome !== "opened") throw new Error("Not opened");
		expect([one.session.name, two.session.name]).toEqual(["review: feat/login", "review: feat/login 2"]);
	});

	test("nothing about a workflow's agent is logged, so its arguments never show up in a log", async () => {
		const spies = [spyOn(console, "log"), spyOn(console, "warn"), spyOn(console, "error"), spyOn(console, "info"), spyOn(console, "debug")];
		try {
			start();
			const result = await sessions.open(request({ workflow: "review" }));
			if (result.outcome !== "opened") throw new Error("Not opened");
			await seen(result.session.id, TOKEN);
			list = review("no-such-agent", [`--token=${TOKEN}`]);
			await sessions.open(request({ workflow: "review" }));
			const logged = spies.flatMap(spy => spy.mock.calls).map(call => call.map(String).join(" ")).join("\n");
			expect(logged).not.toContain(TOKEN);
		} finally {
			for (const spy of spies) spy.mockRestore();
		}
	});
});
