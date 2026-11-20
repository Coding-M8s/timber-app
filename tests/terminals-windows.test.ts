import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type TerminalDependencies, type TerminalSessions, createTerminalSessions } from "../src/bun/terminals";
import { startBunTerminal } from "../src/bun/pseudo-terminal";
import type { Repository } from "../src/shared/model";
import { PROBE_ANSWER } from "../src/shared/program-status";
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

/**
 * Every process's parent, read once with Windows PowerShell, which takes about
 * a second. `childrenOf` then lists the processes whose parent is `pid`.
 */
async function processTable(): Promise<{ childrenOf(pid: number): number[] }> {
	const powershell = join(SYSTEM32, "WindowsPowerShell", "v1.0", "powershell.exe");
	const run = Bun.spawn([powershell, "-NoLogo", "-NoProfile", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId)\" }"], { stdout: "pipe", stderr: "ignore" });
	const text = await new Response(run.stdout).text();
	await run.exited;
	const rows = text.split(/\r?\n/).map(line => line.trim().split(/\s+/).map(Number)).filter(row => row.length === 2);
	return { childrenOf: pid => rows.filter(row => row[1] === pid).map(row => row[0]!) };
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
			// With node-pty the pseudo console's OpenConsole.exe is the test's child too, with no children.
			const table = await processTable();
			const shells = table.childrenOf(process.pid).filter(pid => table.childrenOf(pid).length > 0);
			expect(shells.length).toBe(1);
			const children = table.childrenOf(shells[0]!);
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
		// Windows paths ignore case, and where.exe prints the folder as the file system spells it.
		const where = join(SYSTEM32, "where.exe").toLowerCase();
		expect(await until(() => printed(session.id).toLowerCase().includes(where))).toBe(true);
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

	/**
	 * A program in raw mode, as an agent reads its input. It probes, and with
	 * `attributes` sends primary device attributes (`CSI c`) right after, as
	 * Claude Code does, taking the reply to that as the end of the answers.
	 * It prints what it read and reports `done`.
	 */
	function writeProber(attributes: boolean): string {
		const prober = join(root, attributes ? "prober-da1.ts" : "prober.ts");
		const until = attributes ? "/\\x1b\\[\\?[0-9;]*c/" : "/\\x1b\\\\/";
		writeFileSync(prober, [
			"process.stdin.setRawMode(true);",
			"let read = '';",
			"const end = (text) => { process.stdout.write(`got:${Buffer.from(text).toString('hex')}:end\\r\\n`); process.stdout.write('\\x1b]7501;state=done\\x1b\\\\'); setTimeout(() => process.exit(0), 200); };",
			"const timer = setTimeout(() => end(read), 5000);",
			`process.stdin.on('data', bytes => { read += bytes.toString(); const last = ${until}.exec(read); if (last) { clearTimeout(timer); process.stdin.pause(); end(read.slice(0, last.index + last[0].length)); } });`,
			`process.stdout.write('\\x1b]7501;?\\x1b\\\\${attributes ? "\\x1b[c" : ""}');`,
		].join("\n"));
		return prober;
	}

	const proberEnvironment = () => ({ ...cmdEnvironment(), PATH: `${dirname(process.execPath)};${SYSTEM32}` });
	const statusDone = (id: string) => until(() => changes.some(change => change.id === id && change.session?.status?.state === "done"));
	const hex = (text: string) => Buffer.from(text).toString("hex");

	test("a program that probes and then asks for device attributes gets the probe's answer first, so its report sets the status", async () => {
		start({ agents: async () => [{ name: "Prober", command: `bun '${writeProber(true)}'` }], environment: proberEnvironment() });
		const session = await opened({ agent: "Prober" });
		// The program's query reaches the session's output, where the window answers it, after the app answered the probe.
		await seen(session.id, "\x1b[c");
		sessions.write(session.id, "\x1b[?1;2c");
		await seen(session.id, /got:[0-9a-f]*:end/);
		expect(printed(session.id)).toContain(`got:${hex(PROBE_ANSWER + "\x1b[?1;2c")}:end`);
		expect(await statusDone(session.id)).toBe(true);
	});

	test("on Windows' own ConPTY, through Bun.Terminal, a program that probes reads the answer, sent as typed keys", async () => {
		start({ agents: async () => [{ name: "Prober", command: `bun '${writeProber(false)}'` }], environment: proberEnvironment(), startTerminal: startBunTerminal });
		const session = await opened({ agent: "Prober" });
		await seen(session.id, /got:[0-9a-f]*:end/);
		expect(printed(session.id)).toContain(`got:${hex(PROBE_ANSWER)}:end`);
		expect(await statusDone(session.id)).toBe(true);
	});

	test("the pseudo console's own startup query is answered by the app and never shown, so a program starts at once", async () => {
		start({ agents: async () => [{ name: "Where", command: "where.exe where.exe" }] });
		const started = Date.now();
		const session = await opened({ agent: "Where" });
		const where = join(SYSTEM32, "where.exe").toLowerCase();
		expect(await until(() => printed(session.id).toLowerCase().includes(where))).toBe(true);
		// Unanswered, ConPTY holds the program back for 3 seconds.
		expect(Date.now() - started).toBeLessThan(2000);
		expect(printed(session.id)).not.toContain("\x1b[c");
	});

	test("with the real environment the shell is PowerShell", async () => {
		start({ environment: process.env });
		const session = await opened();
		expect(session.shell).toMatch(/\\(pwsh|powershell)\.exe$/i);
		await sessions.close(session.id);
	});

	test("a Program Status report printed in PowerShell passes ConPTY and sets the session's status", async () => {
		start({ environment: process.env });
		const session = await opened();
		const status = () => sessions.list().find(listed => listed.id === session.id)?.status ?? null;
		sessions.write(session.id, `Write-Host -NoNewline "$([char]27)]7501;state=working$([char]27)\\"; Write-Host sent1\r`);
		await seen(session.id, "sent1");
		expect(await until(() => status()?.state === "working")).toBe(true);
		sessions.write(session.id, `Write-Host -NoNewline "$([char]27)]7501;state=done$([char]7)"; Write-Host sent2\r`);
		await seen(session.id, "sent2");
		expect(await until(() => status()?.state === "done")).toBe(true);
		await sessions.close(session.id);
	}, 20_000);
});
