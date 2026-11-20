import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TerminalDependencies, type TerminalSessions, createTerminalSessions } from "../src/bun/terminals";
import type { Repository } from "../src/shared/model";
import type { TerminalChange, TerminalOutput } from "../src/shared/terminal";

/*
 * Terminal sessions on a real ConPTY. Most of these run cmd.exe, found
 * through ComSpec with PowerShell kept off the PATH, so what the shell prints
 * is known and no profile runs.
 */

const windows = process.platform === "win32";
const SYSTEM_ROOT = process.env.SystemRoot ?? "C:\\Windows";
const SYSTEM32 = join(SYSTEM_ROOT, "System32");
const CMD = join(SYSTEM32, "cmd.exe");

async function until(check: () => boolean | Promise<boolean>, milliseconds = 8000): Promise<boolean> {
	const end = Date.now() + milliseconds;
	while (Date.now() < end) {
		if (await check()) return true;
		await Bun.sleep(25);
	}
	return check();
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

/** The ids of the processes whose parent is `pid`, read with Windows PowerShell. */
async function childrenOf(pid: number): Promise<number[]> {
	const powershell = join(SYSTEM32, "WindowsPowerShell", "v1.0", "powershell.exe");
	const run = Bun.spawn([powershell, "-NoLogo", "-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${pid}").ProcessId`], { stdout: "pipe", stderr: "ignore" });
	const text = await new Response(run.stdout).text();
	await run.exited;
	return text.split(/\s+/).filter(Boolean).map(Number);
}

describe.if(windows)("terminal sessions on Windows, on a real ConPTY", () => {
	let root: string;
	let repository: string;
	let worktree: string;
	let bin: string;
	let sessions: TerminalSessions;
	let outputs: TerminalOutput[];
	let changes: TerminalChange[];

	function git(cwd: string, ...args: string[]): void {
		const run = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: join(root, "empty.gitconfig"), GIT_CONFIG_NOSYSTEM: "1" } });
		if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
	}

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-conpty-")));
		writeFileSync(join(root, "empty.gitconfig"), "");
		repository = join(root, "my repo");
		worktree = join(root, "my repo-worktrees", "feat login");
		bin = join(root, "agent bin");
		mkdirSync(repository, { recursive: true });
		mkdirSync(bin);
		writeFileSync(join(bin, "batch-agent.cmd"), "@echo off\r\necho batch agent ran\r\n");
		git(repository, "init", "-q", "-b", "main");
		writeFileSync(join(repository, "README.md"), "hello\n");
		git(repository, "add", "README.md");
		git(repository, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "-m", "first");
		git(repository, "worktree", "add", "-q", "-b", "feat/login", worktree);
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const listed = (): Repository => ({
		path: repository, name: "my repo", available: true, failure: null,
		setup: "repository",
		worktrees: [repository, worktree].map((path, index) => ({
			id: `id:${path}`, path, canonicalPath: path, branch: index === 0 ? "main" : "feat/login", head: null, primary: index === 0, detached: false,
			locked: false, prunable: false, pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null,
		})),
	});

	/** cmd.exe through ComSpec: only the system folder and the agents' folder are on the PATH, so no PowerShell is found. */
	const cmdEnvironment = () => ({ PATH: `${bin};${SYSTEM32}`, PATHEXT: ".COM;.EXE;.BAT;.CMD", SystemRoot: SYSTEM_ROOT, ComSpec: CMD, PROMPT: "$G " });

	function start(overrides: Partial<TerminalDependencies> = {}): TerminalSessions {
		outputs = [];
		changes = [];
		sessions = createTerminalSessions({
			findRepository: async path => path === repository ? listed() : null,
			onOutput: output => outputs.push(output),
			onChange: change => changes.push(change),
			environment: cmdEnvironment(),
			closeMilliseconds: 1000,
			...overrides,
		});
		return sessions;
	}

	afterEach(() => {
		sessions?.killAll();
	});

	const printed = (id: string) => outputs.filter(output => output.id === id).map(output => output.data).join("");

	async function opened(request: { agent?: string } = {}) {
		const result = await sessions.open({ repository, worktree, cols: 80, rows: 24, ...request });
		if (result.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(result)}`);
		return result.session;
	}

	async function seen(id: string, expected: string | RegExp): Promise<void> {
		const matches = () => typeof expected === "string" ? printed(id).includes(expected) : expected.test(printed(id));
		if (!(await until(matches))) throw new Error(`Did not see ${expected}. Printed: ${JSON.stringify(printed(id))}`);
	}

	async function run(id: string, line: string, expected: string | RegExp): Promise<void> {
		sessions.write(id, `${line}\r`);
		await seen(id, expected);
	}

	test("a terminal starts the shell in the worktree's folder, takes typed input, and shows what it prints", async () => {
		start();
		const session = await opened();
		expect(session).toMatchObject({ kind: "terminal", name: "Terminal", shell: CMD, path: worktree, state: { kind: "running" } });
		await seen(session.id, ">");
		await run(session.id, "cd", worktree);
		await run(session.id, "echo hello from %CD%", `hello from ${worktree}`);
	});

	test("a resize reaches the shell", async () => {
		start();
		const session = await opened();
		await seen(session.id, ">");
		sessions.resize(session.id, 123, 41);
		await run(session.id, "mode con", /Columns:\s+123/);
	});

	test("a shell that exits by itself is kept, with how it ended", async () => {
		start();
		const session = await opened();
		await seen(session.id, ">");
		sessions.write(session.id, "exit 3\r");
		const ended = await until(() => changes.some(change => change.id === session.id && change.session?.state.kind === "exited"));
		expect(ended).toBe(true);
		expect(sessions.list()[0]?.state).toEqual({ kind: "exited", exitCode: 3, signal: null });
		expect(sessions.liveCount()).toBe(0);
	});

	for (const how of ["close", "killAll"] as const) {
		test(`${how} ends the shell and what it started`, async () => {
			start();
			const session = await opened();
			await seen(session.id, ">");
			sessions.write(session.id, "ping -n 600 127.0.0.1\r");
			await seen(session.id, "127.0.0.1");
			// The shell is the test's child process that has a child of its own: the ping.
			const shells: number[] = [];
			for (const pid of await childrenOf(process.pid)) if ((await childrenOf(pid)).length > 0) shells.push(pid);
			expect(shells.length).toBe(1);
			const children = await childrenOf(shells[0]!);
			expect(children.length).toBeGreaterThan(0);

			if (how === "close") await sessions.close(session.id);
			else sessions.killAll();

			expect(await until(() => [...shells, ...children].every(pid => !alive(pid)))).toBe(true);
			expect(sessions.list()).toEqual([]);
		});
	}

	test("an agent starts from its own executable, found on the PATH", async () => {
		start({ agents: async () => [{ name: "Where", command: "where.exe where.exe" }] });
		const session = await opened({ agent: "Where" });
		expect(session).toMatchObject({ kind: "agent", name: "Where", shell: join(SYSTEM32, "where.exe") });
		await seen(session.id, join(SYSTEM32, "where.exe"));
	});

	test("an agent whose executable is a batch file is refused, and nothing starts", async () => {
		start({ agents: async () => [{ name: "Batch", command: "batch-agent --flag" }] });
		const result = await sessions.open({ repository, worktree, cols: 80, rows: 24, agent: "Batch" });
		const file = join(bin, "batch-agent.cmd");
		expect(result).toEqual({
			outcome: "failed",
			command: `'${file}' --flag`,
			message: `${file} is a batch file, which Windows runs through cmd.exe, so the app does not start Batch with it. Use Batch's own .exe, as a full path if needed, in Settings, Agents. Nothing was started.`,
		});
		expect(sessions.list()).toEqual([]);
		expect(printed("anything")).toBe("");
	});

	test("with the real environment the shell is PowerShell", async () => {
		start({ environment: process.env });
		const session = await opened();
		expect(session.shell).toMatch(/\\(pwsh|powershell)\.exe$/i);
		await sessions.close(session.id);
	});
});
