import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWebLink } from "../src/bun/open-link";
import { processTreeKillCommand, sessionMembers, sessionOfStat } from "../src/bun/process-session";
import { type TerminalDependencies, type TerminalSessions, createTerminalSessions } from "../src/bun/terminals";
import type { Repository } from "../src/shared/model";
import { describeSearchPath } from "../src/shared/search-path";
import { PROBE_ANSWER } from "../src/shared/program-status";
import { type SessionNaming, type TerminalChange, type TerminalOutput, TERMINAL_UNSUPPORTED_REASON } from "../src/shared/terminal";
import { until } from "./support/runtime";
import { git } from "./support/timber";

const posix = process.platform !== "win32";
const linux = process.platform === "linux";

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

describe("reading a process's session", () => {
	test("the session is the fourth field after the name, which may hold spaces and parentheses", () => {
		expect(sessionOfStat("1234 (bash) S 1200 1234 1234 34816 1234 4194560")).toBe(1234);
		expect(sessionOfStat("99 (my (odd) name) R 1 98 77 0")).toBe(77);
		expect(sessionOfStat("garbage")).toBeNull();
		expect(sessionOfStat("1 (x) S 0 0 0")).toBeNull();
	});
});

describe("terminal sessions where Bun has no pseudo terminal", () => {
	test("nothing starts, and the answer says why", async () => {
		let asked = false;
		const sessions = createTerminalSessions({
			findRepository: async () => {
				asked = true;
				return null;
			},
			onOutput: () => {},
			onChange: () => {},
			platform: "win32",
			startTerminal: null,
		});
		const result = await sessions.open({ repository: "C:\\work\\repo", worktree: "C:\\work\\repo", cols: 80, rows: 24 });
		expect(result).toEqual({ outcome: "unsupported", message: TERMINAL_UNSUPPORTED_REASON });
		expect(asked).toBe(false);
		expect(sessions.list()).toEqual([]);
	});
});

describe("ending a process tree on Windows", () => {
	test("is taskkill from the system folder, by process id, with its children, forced", () => {
		expect(processTreeKillCommand(4242, { SystemRoot: "D:\\Win" })).toEqual(["D:\\Win\\System32\\taskkill.exe", "/PID", "4242", "/T", "/F"]);
		expect(processTreeKillCommand(7, {})[0]).toBe("C:\\Windows\\System32\\taskkill.exe");
	});
});

// These run a POSIX shell. Windows has its own set below.
describe.skipIf(!posix)("terminal sessions in a real temporary repository", () => {
	let root: string;
	let repository: string;
	let worktree: string;
	let unlisted: string;
	let sessions: TerminalSessions;
	let outputs: TerminalOutput[];
	let changes: TerminalChange[];

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-terminal-")));
		repository = join(root, "my repo");
		worktree = join(root, "my repo-worktrees", "feat login");
		unlisted = join(root, "elsewhere");
		mkdirSync(repository, { recursive: true });
		mkdirSync(unlisted);
		git(repository, "init", "-q", "-b", "main");
		writeFileSync(join(repository, "README.md"), "hello\n");
		git(repository, "add", "README.md");
		git(repository, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-q", "-m", "first");
		git(repository, "worktree", "add", "-q", "-b", "feat/login", worktree);
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	/** The repository as the app's list would answer: the primary checkout and the linked worktree. */
	const listed = (): Repository => ({
		path: repository, name: "my repo", available: true, failure: null,
		setup: "repository",
		worktrees: [repository, worktree].map((path, index) => ({
			id: `id:${path}`, path, canonicalPath: path, branch: index === 0 ? "main" : "feat/login", head: null, primary: index === 0, detached: false,
			locked: false, prunable: false, pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null,
		})),
	});

	function start(overrides: Partial<TerminalDependencies> = {}): TerminalSessions {
		outputs = [];
		changes = [];
		sessions = createTerminalSessions({
			findRepository: async path => path === repository ? listed() : null,
			onOutput: output => outputs.push(output),
			onChange: change => changes.push(change),
			// A plain shell with no startup files, so what it prints is known.
			environment: { PATH: process.env.PATH, HOME: root, SHELL: "/bin/sh", PS1: "$ ", LANG: "C.UTF-8" },
			closeMilliseconds: 500,
			...overrides,
		});
		return sessions;
	}

	afterEach(() => {
		sessions?.killAll();
	});

	const printed = (id: string) => outputs.filter(output => output.id === id).map(output => output.data).join("");

	async function opened(path = worktree, size = { cols: 80, rows: 24 }) {
		const result = await sessions.open({ repository, worktree: path, ...size });
		if (result.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(result)}`);
		return result;
	}

	async function run(id: string, line: string, expected: string | RegExp) {
		sessions.write(id, `${line}\r`);
		const matches = () => typeof expected === "string" ? printed(id).includes(expected) : expected.test(printed(id));
		const seen = await until(matches);
		if (!seen) throw new Error(`Did not see ${expected} after ${line}. Printed: ${JSON.stringify(printed(id))}`);
	}

	describe("the Program Status Protocol (OSC 7501)", () => {
		const statusOf = (id: string) => changes.filter(change => change.id === id).at(-1)?.session?.status ?? null;

		test("the probe is answered on the session's input, with exactly the states and kinds the app handles", async () => {
			start();
			const { session } = await opened();
			const length = Buffer.byteLength(PROBE_ANSWER);
			// Without canonical mode the answer, which has no line end, reaches the program at once.
			await run(
				session.id,
				`stty -icanon -echo; printf '\\033]7501;?\\033\\\\'; answer=$(dd bs=1 count=${length} 2>/dev/null | od -An -tx1 | tr -d ' \\n'); stty icanon echo; echo "got:$answer:end"`,
				/got:[0-9a-f]+:end/,
			);
			expect(printed(session.id)).toContain(`got:${Buffer.from(PROBE_ANSWER).toString("hex")}:end`);
		});

		test("reports set the session's status, a new prompt ends working, and done stays through the exit", async () => {
			start();
			const { session } = await opened();
			await run(session.id, "printf '\\033]7501;state=working:progress=5\\007'; echo sent1", "sent1\r\n");
			expect(await until(() => statusOf(session.id)?.state === "working")).toBe(true);
			expect(statusOf(session.id)).toMatchObject({ state: "working", progress: 5 });
			// What the program printed goes on to the window as it was.
			expect(printed(session.id)).toContain("\x1b]7501;state=working:progress=5\x07");
			await run(session.id, "printf '\\033]133;A\\007'; echo sent2", "sent2\r\n");
			expect(await until(() => statusOf(session.id) === null)).toBe(true);
			await run(session.id, "printf '\\033]7501;state=done\\033\\\\'; echo sent3", "sent3\r\n");
			expect(await until(() => statusOf(session.id)?.state === "done")).toBe(true);
			sessions.write(session.id, "exit 4\r");
			expect(await until(() => changes.at(-1)?.session?.state.kind === "exited")).toBe(true);
			expect(changes.at(-1)!.session).toMatchObject({ state: { kind: "exited", exitCode: 4 }, status: { state: "done" } });
		});

		test("working ends with the process, in the same change that says it exited", async () => {
			start();
			const { session } = await opened();
			sessions.write(session.id, "printf '\\033]7501;state=blocked:kind=permission\\007'; exit 0\r");
			expect(await until(() => changes.at(-1)?.session?.state.kind === "exited")).toBe(true);
			expect(changes.at(-1)!.session!.status).toBeNull();
			expect(changes.filter(change => change.session?.state.kind === "exited")).toHaveLength(1);
		});

		test("a report that breaks the rules changes nothing", async () => {
			start();
			const { session } = await opened();
			await run(session.id, "printf '\\033]7501;state=idle\\007'; echo sent1", "sent1\r\n");
			expect(await until(() => statusOf(session.id)?.state === "idle")).toBe(true);
			// "line\nbreak" in base64: a control character in msg drops the whole report.
			await run(session.id, "printf '\\033]7501;state=error:msg=bGluZQpicmVhaw==\\007'; echo sent2", "sent2\r\n");
			await Bun.sleep(50);
			expect(statusOf(session.id)?.state).toBe("idle");
		});
	});

	test("a terminal opens in the worktree's folder, with the shell, and says so", async () => {
		start();
		const { session } = await opened();
		expect(session).toMatchObject({ kind: "terminal", name: "Terminal", repository, worktree: `id:${worktree}`, path: worktree, shell: "/bin/sh", state: { kind: "running" } });
		expect(changes).toEqual([{ id: session.id, session }]);
		await run(session.id, "pwd", `${worktree}\r\n`);
		await run(session.id, "echo $TERM", "xterm-256color");
		expect(sessions.liveCount()).toBe(1);
	});

	test("a worktree can have several sessions, each with its own name, even when they start at once", async () => {
		start();
		const [first, second] = await Promise.all([opened(), opened()]);
		const third = await opened();
		const ids = [first, second, third].map(result => result.session.id);
		expect(new Set(ids).size).toBe(3);
		expect([first, second, third].map(result => result.session.name).sort()).toEqual(["Terminal", "Terminal 2", "Terminal 3"]);
		const primary = await opened(repository);
		// Names count per worktree.
		expect(primary.session.name).toBe("Terminal");
		expect(sessions.list().map(session => session.id)).toEqual([...ids, primary.session.id]);
		expect(sessions.liveCount()).toBe(4);
	});

	test("three sessions in one worktree each keep their own output, and closing one leaves the others running", async () => {
		start();
		const one = (await opened()).session;
		const two = (await opened()).session;
		const three = (await opened()).session;
		await run(one.id, "echo first-$((40+1))", "first-41");
		await run(two.id, "echo second-$((40+2))", "second-42");
		await run(three.id, "echo third-$((40+3))", "third-43");
		const read = (id: string) => sessions.read(id)!.data;
		expect(read(one.id)).toContain("first-41");
		expect(read(one.id)).not.toContain("second-42");
		expect(read(two.id)).toContain("second-42");
		expect(read(two.id)).not.toContain("third-43");
		expect(read(three.id)).not.toContain("first-41");

		await sessions.close(two.id);
		expect(sessions.read(two.id)).toBeNull();
		expect(sessions.list().map(session => [session.id, session.state.kind])).toEqual([[one.id, "running"], [three.id, "running"]]);
		await run(one.id, "echo still-$((1+1))", "still-2");
		await run(three.id, "echo still-$((2+1))", "still-3");
		expect(read(one.id)).toContain("first-41");
		expect(sessions.liveCount()).toBe(2);
		// A new session takes the first free name again.
		expect((await opened()).session.name).toBe("Terminal 2");
	});

	test("a session can be renamed in place, cleaned up, and an empty name changes nothing", async () => {
		start();
		const one = (await opened()).session;
		const two = (await opened()).session;
		changes.length = 0;
		expect(sessions.rename(one.id, "  dev\tserver\n ")).toMatchObject({ id: one.id, name: "dev server" });
		expect(changes).toEqual([{ id: one.id, session: { ...one, name: "dev server" } }]);
		expect(sessions.rename(one.id, " \n ")).toBeNull();
		expect(sessions.rename("no-such-session", "x")).toBeNull();
		expect(sessions.rename(one.id, 42 as unknown as string)).toBeNull();
		expect(sessions.rename(two.id, "x".repeat(100))!.name).toBe("x".repeat(40));
		// Renaming keeps the order, and the name survives the shell ending.
		expect(sessions.list().map(session => [session.id, session.name])).toEqual([[one.id, "dev server"], [two.id, "x".repeat(40)]]);
		sessions.write(one.id, "exit 3\r");
		expect(await until(() => sessions.list()[0]!.state.kind === "exited")).toBe(true);
		expect(sessions.list()[0]).toMatchObject({ name: "dev server", state: { kind: "exited", exitCode: 3 } });
		expect(sessions.rename(one.id, "done")!.name).toBe("done");
	});

	test("only a worktree Timber lists, in a listed repository, gets a terminal", async () => {
		start();
		const elsewhere = await sessions.open({ repository, worktree: unlisted, cols: 80, rows: 24 });
		expect(elsewhere.outcome).toBe("not-listed");
		const unknown = await sessions.open({ repository: unlisted, worktree: unlisted, cols: 80, rows: 24 });
		expect(unknown.outcome).toBe("not-listed");
		const relative = await sessions.open({ repository, worktree: "feat login", cols: 80, rows: 24 });
		expect(relative.outcome).toBe("not-listed");
		expect(sessions.list()).toEqual([]);
		expect(changes).toEqual([]);
	});

	test("input reaches an interactive program, and resizing reaches the terminal", async () => {
		start();
		const { session } = await opened(worktree, { cols: 100, rows: 30 });
		await run(session.id, "stty size", "30 100");
		sessions.resize(session.id, 132, 40);
		await run(session.id, "stty size", "40 132");
		// Sizes that make no sense are kept within limits, never passed on.
		sessions.resize(session.id, -5, 1e9);
		await run(session.id, "stty size", "500 1");
		sessions.write(session.id, "read answer; echo \"got:$answer\"\r");
		await Bun.sleep(100);
		await run(session.id, "hello there", "got:hello there");
	});

	test("a full-screen program switches screens and reads single keys", async () => {
		start();
		const { session } = await opened();
		// As vim and less do: the alternate screen, raw keys, and back.
		const script = "printf '\\033[?1049h'; stty raw -echo; key=$(dd bs=1 count=1 2>/dev/null); stty sane; printf '\\033[?1049l'; echo \"key:$key\"";
		sessions.write(session.id, `${script}\r`);
		expect(await until(() => printed(session.id).includes("\x1b[?1049h"))).toBe(true);
		await Bun.sleep(100);
		sessions.write(session.id, "q");
		expect(await until(() => printed(session.id).includes("key:q"))).toBe(true);
	});

	test("output comes in numbered parts, and a snapshot holds them up to its number", async () => {
		start();
		const { session } = await opened();
		await run(session.id, "echo one; echo two", "two\r\n");
		const seqs = outputs.filter(output => output.id === session.id).map(output => output.seq);
		expect(seqs).toEqual(seqs.map((_, index) => index + 1));
		const snapshot = sessions.read(session.id)!;
		expect(snapshot.seq).toBe(seqs.at(-1)!);
		expect(snapshot.data).toBe(printed(session.id));
		expect(sessions.read("no-such-session")).toBeNull();
	});

	test("a shell that exits stays, with its exit code, until it is closed", async () => {
		start();
		const { session } = await opened();
		sessions.write(session.id, "exit 3\r");
		expect(await until(() => changes.some(change => change.session?.state.kind === "exited"))).toBe(true);
		const ended = changes.at(-1)!;
		expect(ended.session?.state).toEqual({ kind: "exited", exitCode: 3, signal: null });
		expect(sessions.list()[0]!.state).toEqual({ kind: "exited", exitCode: 3, signal: null });
		expect(sessions.liveCount()).toBe(0);
		// Typing into it does nothing, and does not throw.
		sessions.write(session.id, "echo nothing\r");
		await sessions.close(session.id);
		expect(sessions.list()).toEqual([]);
		expect(changes.at(-1)).toEqual({ id: session.id, session: null });
	});

	test.skipIf(!linux)("closing a session ends everything it started, even what ignores a hang-up, and leaves the repository as it was", async () => {
		start();
		const status = git(worktree, "status", "--porcelain");
		const refs = git(repository, "for-each-ref");
		const { session } = await opened();
		// The shell leads its own session, so its pid is the session id.
		await run(session.id, "echo leader:$$", /leader:\d+/);
		const leader = Number(/leader:(\d+)/.exec(printed(session.id))![1]);
		await run(session.id, "sleep 300 & echo started", "started\r\n");
		// In front, a program that ignores SIGHUP, as some do. The ":" after
		// the sleep keeps a sh that is bash (Arch) from replacing itself with
		// the sleep, which would leave three processes where four are counted.
		sessions.write(session.id, "sh -c 'trap \"\" HUP; sleep 301; :'\r");
		let members: number[] = [];
		expect(await until(() => (members = sessionMembers(leader) ?? []).length >= 4)).toBe(true);
		await sessions.close(session.id);
		expect(await until(() => members.every(pid => !alive(pid)))).toBe(true);
		expect(sessions.list()).toEqual([]);
		expect(sessions.liveCount()).toBe(0);
		expect(changes.at(-1)).toEqual({ id: session.id, session: null });
		expect(git(worktree, "status", "--porcelain")).toBe(status);
		expect(git(repository, "for-each-ref")).toBe(refs);
	});

	test.skipIf(!linux)("closing everything at once, for quitting, leaves nothing running", async () => {
		start();
		const one = await opened();
		const two = await opened(repository);
		await run(one.session.id, "echo leader:$$", /leader:\d+/);
		await run(two.session.id, "echo leader:$$", /leader:\d+/);
		await run(one.session.id, "sleep 302 & echo bg", "bg\r\n");
		const leaders = [one, two].map(({ session }) => Number(/leader:(\d+)/.exec(printed(session.id))![1]));
		const members = leaders.flatMap(leader => sessionMembers(leader) ?? []);
		expect(members.length).toBeGreaterThanOrEqual(3);
		sessions.killAll();
		expect(await until(() => members.every(pid => !alive(pid)))).toBe(true);
		expect(sessions.list()).toEqual([]);
	});

	test.skipIf(!linux)("closing gives everything in the session time to clean up after the hang-up, then kills the rest", async () => {
		start({ closeMilliseconds: 2000 });
		const { session } = await opened();
		const cleaned = join(root, "cleaned");
		// A program that needs a moment after SIGHUP, as a dev server that writes its state does.
		await run(session.id, `sh -c 'trap "sleep 0.3; echo done > \\"${cleaned}\\"; exit 0" HUP; while :; do sleep 1; done' & echo cleaner`, "cleaner\r\n");
		await Bun.sleep(200);
		const started = Date.now();
		await sessions.close(session.id);
		expect(await Bun.file(cleaned).exists()).toBe(true);
		expect(Date.now() - started).toBeLessThan(2000);
		rmSync(cleaned);
	});

	test.skipIf(!linux)("after the shell ended by itself, a program started with nohup goes on until the session is dismissed", async () => {
		start();
		const { session } = await opened();
		await run(session.id, "nohup sleep 303 >/dev/null 2>&1 & echo pid:$!", /pid:\d+/);
		const pid = Number(/pid:(\d+)/.exec(printed(session.id))![1]);
		sessions.write(session.id, "exit\r");
		expect(await until(() => sessions.list()[0]?.state.kind === "exited")).toBe(true);
		await Bun.sleep(300);
		expect(alive(pid)).toBe(true);
		await sessions.close(session.id);
		expect(await until(() => !alive(pid))).toBe(true);
	});

	test("a window that catches up while output is still being gathered gets all of it in the fresh start", async () => {
		start({ undrawnLimit: 1, flushMilliseconds: 1000 });
		const { session } = await opened();
		// The prompt alone goes past the limit, so output is held from here on.
		expect(await until(() => outputs.length > 0)).toBe(true);
		await Bun.sleep(1100);
		sessions.write(session.id, "echo kept-$((2+3))\r");
		// The answer sits in the part being gathered when the window says it caught up.
		await Bun.sleep(200);
		sessions.drawn(session.id, outputs.at(-1)!.seq);
		const reset = outputs.at(-1)!;
		expect(reset.reset).toBe(true);
		expect(reset.data).toContain("kept-5");
		expect(reset.seq).toBe(sessions.read(session.id)!.seq);
		// Every part before the reset has a lower number, so a reader never drops it.
		expect(outputs.slice(0, -1).every(output => output.seq < reset.seq)).toBe(true);
	});

	test("a window that falls behind stops getting parts, then gets what is kept in one part", async () => {
		start({ undrawnLimit: 2000 });
		const { session } = await opened();
		sessions.drawn(session.id, outputs.at(-1)?.seq ?? 0);
		const before = outputs.length;
		await run(session.id, "i=0; while [ $i -lt 6000 ]; do echo line-$i-xxxxxxxxxxxxxxxxxxxx; i=$((i+1)); done; echo done-$((6*7))", /line-\d+-x/);
		// Give the loop time to finish while the window draws nothing.
		await Bun.sleep(500);
		const sent = outputs.slice(before);
		const sentSize = sent.reduce((total, output) => total + output.data.length, 0);
		expect(sentSize).toBeLessThan(2000 + 64 * 1024);
		expect(sent.some(output => output.data.includes("done-42"))).toBe(false);
		// The window catches up: one part, marked to start afresh, that holds the end.
		sessions.drawn(session.id, sent.at(-1)!.seq);
		const reset = outputs.at(-1)!;
		expect(reset.reset).toBe(true);
		expect(reset.data).toContain("done-42");
		expect(reset.seq).toBe(sessions.read(session.id)!.seq);
	});

	describe("agent sessions", () => {
		/** A folder of pretend agents, put on the PATH of the sessions, each printing its arguments and folder, then echoing lines. */
		function agentsBin(): string {
			const bin = join(root, "agent bin");
			mkdirSync(bin, { recursive: true });
			for (const name of ["fake-claude", "fake-codex"]) {
				const script = join(bin, name);
				writeFileSync(script, `#!/bin/sh\nprintf '${name} in %s args' "$(pwd)"\nfor arg in "$@"; do printf ' [%s]' "$arg"; done\necho\nwhile read line; do echo "${name} got $line"; done\n`);
				chmodSync(script, 0o755);
			}
			return bin;
		}

		const AGENTS = [
			{ name: "Claude Code", command: "fake-claude" },
			{ name: "Codex", command: `fake-codex --model "big one" --sandbox=workspace-write` },
			{ name: "Missing", command: "no-such-agent --flag" },
		];

		function startWithAgents(overrides: Partial<TerminalDependencies> = {}): TerminalSessions {
			const bin = agentsBin();
			return start({
				environment: { PATH: `${bin}:${process.env.PATH}`, HOME: root, SHELL: "/bin/sh", PS1: "$ ", LANG: "C.UTF-8" },
				agents: async () => AGENTS,
				...overrides,
			});
		}

		async function openedAgent(agent: string, path = worktree) {
			const result = await sessions.open({ repository, worktree: path, cols: 80, rows: 24, agent });
			if (result.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(result)}`);
			return result.session;
		}

		const seen = async (id: string, text: string) => {
			const found = await until(() => printed(id).includes(text));
			if (!found) throw new Error(`Did not see ${text}. Printed: ${JSON.stringify(printed(id))}`);
		};

		test("as Settings says, new sessions are named after the branch or its issue key, once, and a detached HEAD falls back", async () => {
			let naming: SessionNaming = "branch";
			let branch: string | null = "feat/login";
			startWithAgents({
				sessionNaming: async () => naming,
				findRepository: async path => {
					if (path !== repository) return null;
					const repo = listed();
					return { ...repo, worktrees: repo.worktrees.map(listedWorktree => listedWorktree.path === worktree ? { ...listedWorktree, branch, detached: branch === null } : listedWorktree) };
				},
			});
			const [one, two] = await Promise.all([opened(), opened()]);
			expect([one.session.name, two.session.name].sort()).toEqual(["feat/login", "feat/login 2"]);
			expect((await openedAgent("Codex")).name).toBe("Codex: feat/login");
			expect((await openedAgent("Codex")).name).toBe("Codex: feat/login 2");
			// The primary checkout is on main.
			expect((await opened(repository)).session.name).toBe("main");

			naming = "issue";
			branch = "gh-122-option-to-name-tab";
			expect((await opened()).session.name).toBe("GH-122");
			expect((await openedAgent("Claude Code")).name).toBe("Claude Code: GH-122");

			branch = null;
			expect((await opened()).session.name).toBe("Terminal");
			expect((await openedAgent("Codex")).name).toBe("Codex");

			// Sessions already open keep the names they got.
			expect(sessions.list().slice(0, 4).map(session => session.name).sort()).toEqual(["Codex: feat/login", "Codex: feat/login 2", "feat/login", "feat/login 2"]);
		});

		test("a naming that cannot be read names sessions as always", async () => {
			startWithAgents({ sessionNaming: async () => { throw new Error("unreadable"); } });
			expect((await opened()).session.name).toBe("Terminal");
			expect((await openedAgent("Codex")).name).toBe("Codex");
		});

		test("an agent starts its command in the worktree's folder, named after the agent, with the executable as found", async () => {
			startWithAgents();
			const session = await openedAgent("Claude Code");
			const executable = join(root, "agent bin", "fake-claude");
			expect(session).toMatchObject({ kind: "agent", name: "Claude Code", path: worktree, shell: executable, state: { kind: "running" } });
			expect(session.command).toBe(`'${executable}'`);
			await seen(session.id, `fake-claude in ${worktree} args\r\n`);
			sessions.write(session.id, "hello\r");
			await seen(session.id, "fake-claude got hello");
		});

		test("nothing is added to an agent's command, and no agent config file is written", async () => {
			startWithAgents();
			const before = readdirSync(root).sort();
			const session = await openedAgent("Claude Code");
			await seen(session.id, `fake-claude in ${worktree} args\r\n`);
			// The status comes from what the agent writes to its terminal, so its command line and its home stay as they were.
			expect(session.command).toBe(`'${join(root, "agent bin", "fake-claude")}'`);
			expect(readdirSync(root).sort()).toEqual(before);
		});

		test("a custom command with arguments gets each argument as it was typed, with no shell", async () => {
			startWithAgents();
			const session = await openedAgent("Codex");
			await seen(session.id, "args [--model] [big one] [--sandbox=workspace-write]");
			expect(session.command).toBe(`'${join(root, "agent bin", "fake-codex")}' --model 'big one' --sandbox=workspace-write`);
		});

		test("two different agents and a terminal run in one worktree at the same time, each with its own output", async () => {
			startWithAgents();
			const claude = await openedAgent("Claude Code");
			const codex = await openedAgent("Codex");
			const terminal = (await opened()).session;
			const again = await openedAgent("Codex");
			expect([claude.name, codex.name, terminal.name, again.name]).toEqual(["Claude Code", "Codex", "Terminal", "Codex 2"]);
			sessions.write(claude.id, "one\r");
			sessions.write(codex.id, "two\r");
			await seen(claude.id, "fake-claude got one");
			await seen(codex.id, "fake-codex got two");
			expect(printed(claude.id)).not.toContain("got two");
			expect(printed(codex.id)).not.toContain("got one");
			expect(sessions.liveCount()).toBe(4);
		});

		test("a missing executable starts nothing, names the command and the PATH, and leaves the other sessions alone", async () => {
			startWithAgents();
			const claude = await openedAgent("Claude Code");
			const terminal = (await opened()).session;
			const before = sessions.list();
			const changesBefore = changes.length;
			const result = await sessions.open({ repository, worktree, cols: 80, rows: 24, agent: "Missing" });
			expect(result).toEqual({
				outcome: "not-found",
				command: "no-such-agent --flag",
				executable: "no-such-agent",
				message: `Could not start Missing. "no-such-agent" was not found on the PATH the app was started with: ${describeSearchPath(`${join(root, "agent bin")}:${process.env.PATH}`, ":")}. A change to PATH needs a restart of the app, or use the full path in Settings, Agents.`,
			});
			expect(sessions.list()).toEqual(before);
			expect(changes.length).toBe(changesBefore);
			expect(sessions.liveCount()).toBe(2);
			sessions.write(claude.id, "still\r");
			await seen(claude.id, "fake-claude got still");
			await run(terminal.id, "echo alive-$((1+1))", "alive-2");
		});

		test("a full path that is not there, or a relative path, starts nothing", async () => {
			startWithAgents({ agents: async () => [{ name: "Gone", command: join(root, "nowhere", "agent") }, { name: "Relative", command: "./bin/agent" }] });
			const gone = await sessions.open({ repository, worktree, cols: 80, rows: 24, agent: "Gone" });
			expect(gone).toMatchObject({ outcome: "not-found", message: `Could not start Gone. There is no executable file at ${join(root, "nowhere", "agent")}.` });
			const relative = await sessions.open({ repository, worktree, cols: 80, rows: 24, agent: "Relative" });
			expect(relative).toMatchObject({ outcome: "failed", command: "./bin/agent" });
			expect(relative.outcome === "failed" && relative.message).toContain("relative path ./bin/agent");
			expect(sessions.list()).toEqual([]);
		});

		test("an agent that is not in the saved settings starts nothing, not even a shell", async () => {
			startWithAgents();
			const result = await sessions.open({ repository, worktree, cols: 80, rows: 24, agent: "Aider" });
			expect(result).toEqual({ outcome: "not-configured", message: 'No agent called "Aider" is set in Settings, Agents. Nothing was started.' });
			// Names are matched exactly, as saved.
			expect((await sessions.open({ repository, worktree, cols: 80, rows: 24, agent: "codex" })).outcome).toBe("not-configured");
			expect(sessions.list()).toEqual([]);
			expect(changes).toEqual([]);
		});

		test("an agent goes only where a terminal may go", async () => {
			startWithAgents();
			const result = await sessions.open({ repository, worktree: unlisted, cols: 80, rows: 24, agent: "Claude Code" });
			expect(result.outcome).toBe("not-listed");
			expect(result.outcome === "not-listed" && result.message).toContain("Claude Code was not started.");
			expect(sessions.list()).toEqual([]);
		});

		test("closing an agent session ends the agent, and an agent that exits stays with its exit code", async () => {
			startWithAgents();
			const claude = await openedAgent("Claude Code");
			await seen(claude.id, "fake-claude in");
			expect(running("fake-claude")).toBe(true);
			await sessions.close(claude.id);
			expect(sessions.list()).toEqual([]);
			expect(running("fake-claude")).toBe(false);
			const codex = await openedAgent("Codex");
			await seen(codex.id, "fake-codex in");
			// End of input ends the pretend agent's loop, and the script with it.
			sessions.write(codex.id, "\x04");
			expect(await until(() => sessions.list().find(session => session.id === codex.id)?.state.kind === "exited")).toBe(true);
			expect(sessions.list()[0]!.state).toEqual({ kind: "exited", exitCode: 0, signal: null });
		});

		/** Whether a pretend agent of this temporary folder still runs. */
		function running(name: string): boolean {
			return Bun.spawnSync(["pgrep", "-f", join(root, "agent bin", name)], { stdout: "pipe" }).exitCode === 0;
		}
	});
});

describe.skipIf(!posix)("opening a link from a terminal", () => {
	let bin: string;
	let record: string;

	beforeAll(() => {
		bin = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-opener-")));
		record = join(bin, "calls");
		// A stand-in opener that writes each argument on a line of its own.
		for (const name of ["xdg-open", "open"]) {
			writeFileSync(join(bin, name), `#!/bin/sh\nfor argument in "$@"; do printf '%s\\n' "$argument"; done > "${record}.tmp"\nmv "${record}.tmp" "${record}"\n`);
			chmodSync(join(bin, name), 0o755);
		}
	});

	afterAll(() => {
		rmSync(bin, { recursive: true, force: true });
	});

	async function opened(url: string, platform: NodeJS.Platform): Promise<string[] | null> {
		rmSync(record, { force: true });
		const started = openWebLink(url, platform, bin);
		if (!started) return null;
		expect(await until(() => existsSync(record))).toBe(true);
		return readFileSync(record, "utf8").split("\n").slice(0, -1);
	}

	test("the opener gets the link as one argument, never read by a shell", async () => {
		// Were a shell to read it, this would run `touch` in the folder the opener runs in.
		expect(await opened("http://x/$(touch${IFS}pwned)`touch${IFS}pwned`", "linux")).toEqual(["http://x/$(touch$%7BIFS%7Dpwned)%60touch$%7BIFS%7Dpwned%60"]);
		expect(existsSync("pwned")).toBe(false);
		expect(await opened("https://example.com/a?b=c", "darwin")).toEqual(["https://example.com/a?b=c"]);
	});

	test("anything that is not a plain web link, and any other system, opens nothing", async () => {
		expect(await opened(" http://x/", "linux")).toBeNull();
		expect(await opened("file:///etc/passwd", "linux")).toBeNull();
		expect(await opened("https://example.com/", "win32")).toBeNull();
		expect(openWebLink("https://example.com/", "linux", "")).toBe(false);
	});
});
