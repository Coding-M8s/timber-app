import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWebLink } from "../src/bun/open-link";
import { processTreeKillCommand, sessionMembers, sessionOfStat } from "../src/bun/process-session";
import { PART_LIMIT, type TerminalDependencies, type TerminalSessions, createTerminalSessions } from "../src/bun/terminals";
import type { Repository } from "../src/shared/model";
import { describeSearchPath } from "../src/shared/search-path";
import { PROBE_ANSWER } from "../src/shared/program-status";
import { PROMPT_STILL_STARTING } from "../src/shared/agent-prompt";
import { CHOP_NOT_TYPED, type OpenTerminalRequest, PASTE_NOT_READY, type SessionNaming, type TerminalChange, type TerminalOutput, TERMINAL_UNSUPPORTED_REASON, WORKTREE_SETUP_SESSION_NAME, bracketedPaste } from "../src/shared/terminal";

/** A short review as it is pasted. */
const PASTED = "Review notes\n\nsrc/a.ts:2\n> +x\nFix this.";
/** A prompt chop's text, with a line break that must not submit it early. */
const PROMPT = "Write tests for what changed.\nRun them before you stop.";
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
			locked: false, prunable: false, pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null, baseCounts: null,
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

	test("a session waits for the handoff folder and gets it as TIMBER_APP_HANDOFF, never the app's own", async () => {
		let ready = (_path: string) => {};
		const folder = new Promise<string | null>(resolve => (ready = resolve));
		start({ handoffFolder: () => folder, environment: { PATH: process.env.PATH, HOME: root, SHELL: "/bin/sh", PS1: "$ ", LANG: "C.UTF-8", TIMBER_APP_HANDOFF: "/inherited" } });
		const opening = sessions.open({ repository, worktree, cols: 80, rows: 24 });
		await Bun.sleep(20);
		expect(sessions.list()).toEqual([]);
		ready("/run/handoff-now");
		const result = await opening;
		if (result.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(result)}`);
		await run(result.session.id, 'echo "handoff:$TIMBER_APP_HANDOFF:end"', "handoff:/run/handoff-now:end");
	});

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

		test("child records reach the window in one change per part, with long messages cut, and working ones end with the process", async () => {
			start();
			const { session } = await opened();
			const childrenOf = () => changes.filter(change => change.id === session.id).at(-1)?.session?.children ?? [];
			const long = Buffer.from("x".repeat(500)).toString("base64");
			const before = changes.length;
			// Three reports in one part: the root and two children, told as one change.
			await run(session.id, `printf '\\033]7501;state=working\\007\\033]7501;state=working:id=a:msg=${long}\\007\\033]7501;state=done:id=a/b\\007'; echo sent1`, "sent1\r\n");
			expect(await until(() => childrenOf().length === 2)).toBe(true);
			expect(changes.slice(before).filter(change => change.id === session.id)).toHaveLength(1);
			expect(childrenOf().map(child => [child.id, child.state])).toEqual([["a", "working"], ["a/b", "done"]]);
			expect(Array.from(childrenOf()[0]!.message!)).toHaveLength(200);
			// The same child report again is no change at all.
			const told = changes.length;
			await run(session.id, `printf '\\033]7501;state=working:id=a:msg=${long}\\007'; echo sent2`, "sent2\r\n");
			await Bun.sleep(50);
			expect(changes.length).toBe(told);
			sessions.write(session.id, "exit 0\r");
			expect(await until(() => changes.at(-1)?.session?.state.kind === "exited")).toBe(true);
			expect(changes.at(-1)!.session!.children.map(child => child.id)).toEqual(["a/b"]);
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
		// Each running session's shell leads its processes, for reading the ports they hold.
		expect(sessions.leaders().map(leader => [leader.id, leader.name, leader.path])).toEqual(sessions.list().map(session => [session.id, session.name, session.path]));
		expect(sessions.leaders().every(leader => Number.isInteger(leader.pid) && leader.pid > 0)).toBe(true);
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
		start({ undrawnLimit: 1, flushMilliseconds: 500 });
		const { session } = await opened();
		// The prompt alone goes past the limit, so output is held from here on.
		expect(await until(() => outputs.length > 0)).toBe(true);
		await Bun.sleep(600);
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
		// Wait for the loop to finish while the window draws nothing.
		expect(await until(() => sessions.read(session.id)!.data.includes("done-42"))).toBe(true);
		const sent = outputs.slice(before);
		const sizeOf = (parts: typeof sent) => parts.reduce((total, output) => total + output.data.length, 0);
		// Parts go while no more than the limit is undrawn; the part that passes it is the last one sent.
		// A part is sent once it reaches PART_LIMIT, so it holds less than that plus the read that took it
		// there. Bun hands over what the pseudo terminal has in one read: about 25 KiB when measured
		// with a stalled event loop, as on a busy machine, so one more PART_LIMIT bounds it.
		expect(sizeOf(sent.slice(0, -1))).toBeLessThanOrEqual(2000);
		expect(sizeOf(sent)).toBeGreaterThan(2000);
		expect(sizeOf(sent)).toBeLessThan(2000 + 2 * PART_LIMIT);
		expect(sent.some(output => output.data.includes("done-42"))).toBe(false);
		// The window catches up: one part, marked to start afresh, that holds the end.
		sessions.drawn(session.id, sent.at(-1)!.seq);
		const reset = outputs.at(-1)!;
		expect(reset.reset).toBe(true);
		expect(reset.data).toContain("done-42");
		expect(reset.seq).toBe(sessions.read(session.id)!.seq);
	});

	describe("a command chop", () => {
		async function openedChop(name: string, text: string) {
			const result = await sessions.open({ repository, worktree, cols: 80, rows: 24 }, { kind: "command", name, text });
			if (result.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(result)}`);
			return result.session;
		}
		// Gives up before the test's own 5 second timeout, so a failure says what was printed.
		const shows = async (id: string, expected: string) => {
			if (!await until(() => printed(id).includes(expected), 4000)) throw new Error(`Did not see ${expected}. Printed: ${JSON.stringify(printed(id))}`);
		};

		/**
		 * Start sessions in a shell that never asks for bracketed paste: it
		 * prints a prompt and runs each line it reads. `/bin/sh` will not do,
		 * as it is bash on some systems, and bash asks for bracketed paste
		 * even when started as `sh`.
		 */
		function startPlainShell(overrides: Partial<TerminalDependencies> = {}): string {
			const shell = join(root, "plain-shell");
			writeFileSync(shell, `#!/bin/sh\nwhile printf '$ ' && IFS= read -r line; do eval "$line"; done\n`);
			chmodSync(shell, 0o755);
			start({ environment: { PATH: process.env.PATH, HOME: root, SHELL: shell, LANG: "C.UTF-8" }, ...overrides });
			return shell;
		}

		test("runs in a shell named after it, whatever the naming, typed line by line when the shell has no bracketed paste, and the shell stays", async () => {
			const shell = startPlainShell({ chopWaitMilliseconds: 100, sessionNaming: async () => "branch" });
			const session = await openedChop("Two lines", "echo chop-$((40 + 2))\necho second-$((1 + 1))");
			expect(session).toMatchObject({ kind: "terminal", name: "Two lines", path: worktree, shell });
			await shows(session.id, "chop-42");
			await shows(session.id, "second-2");
			// The command ended; the shell is still there, so it can be run again.
			expect(sessions.list().find(listed => listed.id === session.id)?.state).toEqual({ kind: "running" });
			await run(session.id, "echo still-here", "still-here\r\n");
			// A second run of the same chop gets its own name, as sessions do.
			expect((await openedChop("Two lines", "true")).name).toBe("Two lines 2");
		});

		test("goes in whole, as one bracketed paste and Enter, as soon as the shell asks for bracketed paste", async () => {
			const bash = Bun.which("bash");
			if (bash === null || !linux) return;
			// Long enough that only the shell's own request can have typed it in time.
			start({ chopWaitMilliseconds: 60_000, chopQuietMilliseconds: 60_000, environment: { PATH: process.env.PATH, HOME: root, SHELL: bash, PS1: "$ ", LANG: "C.UTF-8", INPUTRC: "/dev/null" } });
			const session = await openedChop("Pasted", "echo one-$((0 + 1)) && \\\necho two-$((1 + 1))");
			await shows(session.id, "one-1");
			await shows(session.id, "two-2");
		});

		test("a shell that prints its prompt without asking for bracketed paste gets the chop once it is quiet, not after the longest wait", async () => {
			startPlainShell({ chopWaitMilliseconds: 60_000, chopQuietMilliseconds: 100 });
			const session = await openedChop("Quick", "echo quick-$((3 + 4))");
			await shows(session.id, "quick-7");
		});

		test("a tab is not typed into a shell without bracketed paste, where it would complete, and the session says why", async () => {
			startPlainShell({ chopWaitMilliseconds: 50 });
			const session = await openedChop("Tabbed", "printf 'a\tb'");
			await shows(session.id, CHOP_NOT_TYPED);
			// Nothing of the chop reached the shell, neither echoed nor run.
			await Bun.sleep(200);
			expect(printed(session.id)).not.toContain("a\tb");
			expect(sessions.list().find(listed => listed.id === session.id)?.state).toEqual({ kind: "running" });
		});

		test("is refused with an agent, or with text a paste must not hold", async () => {
			start();
			expect(await sessions.open({ repository, worktree, cols: 80, rows: 24, agent: "Claude Code" }, { kind: "command", name: "x", text: "true" })).toMatchObject({ outcome: "failed" });
			expect(await sessions.open({ repository, worktree, cols: 80, rows: 24 }, { kind: "command", name: "x", text: "a\x1b[201~b" })).toMatchObject({ outcome: "failed" });
			expect(sessions.list()).toEqual([]);
		});

		test("closing the session before the chop was typed types nothing later", async () => {
			start({ chopWaitMilliseconds: 50 });
			const session = await openedChop("Gone", "echo never");
			await sessions.close(session.id);
			await Bun.sleep(100);
			expect(printed(session.id)).not.toContain("never");
		});
	});

	describe("inserting text into a shell", () => {
		test("one line without bracketed paste goes in as typed, with no Enter", async () => {
			start();
			const { session } = await opened();
			await run(session.id, "echo ready", "ready\r\n");
			expect(sessions.paste(session.id, "echo inserted-$((2 + 2))")).toEqual({ outcome: "pasted" });
			await until(() => printed(session.id).includes("echo inserted-$((2 + 2))"));
			await Bun.sleep(100);
			expect(printed(session.id)).not.toContain("inserted-4");
			await run(session.id, "", "inserted-4");
		});
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
			// Ends at once with code 3.
			const quitter = join(bin, "fake-quitter");
			writeFileSync(quitter, `#!/bin/sh\necho quitter-out\nexit 3\n`);
			chmodSync(quitter, 0o755);
			// Waits for a line, then ends with code 0.
			const leaver = join(bin, "fake-leaver");
			writeFileSync(leaver, `#!/bin/sh\necho leaver ready\nread line\necho "leaver got $line"\nexit 0\n`);
			chmodSync(leaver, 0o755);
			// Named as Claude Code is, so it gets a conversation of the app's choosing. Prints its arguments, waits for a line, then ends.
			const claude = join(bin, "claude");
			writeFileSync(claude, `#!/bin/sh\nprintf 'claude args'\nfor arg in "$@"; do printf ' [%s]' "$arg"; done\necho\nread line\nexit 0\n`);
			chmodSync(claude, 0o755);
			// Leaves a program running with nohup, then ends when it gets a line.
			const nohupper = join(bin, "fake-nohupper");
			writeFileSync(nohupper, `#!/bin/sh\nnohup sleep 304 >/dev/null 2>&1 &\necho "nohupper pid:$!"\nread line\nexit 0\n`);
			chmodSync(nohupper, 0o755);
			// Asks for bracketed paste, as Claude Code and Codex do, then prints the bytes of the first paste it is given, in hex.
			const paster = join(bin, "fake-paster");
			writeFileSync(paster, `#!/bin/sh\nstty raw -echo\nprintf '\\033[?2004hpaster ready\\r\\n'\nhead -c "$1" | od -An -tx1 | tr -d ' \\n'\nprintf ' done\\r\\n'\nsleep 5\n`);
			chmodSync(paster, 0o755);
			// Probes for the Program Status Protocol and reads the answer, waits on the person (blocked), then says it is idle,
			// and prints in hex the first bytes it is given after that.
			const reporter = join(bin, "fake-reporter");
			writeFileSync(reporter, String.raw`#!/bin/sh
stty raw -echo
printf '\033[?2004h\033]7501;?\033\\'
head -c ${PROBE_ANSWER.length} > /dev/null
printf '\033]7501;state=blocked:kind=permission\033\\trust this folder?\r\n'
sleep 0.6
printf '\033]7501;state=idle\033\\reporter ready\r\n'
head -c "$1" | od -An -tx1 | tr -d ' \n'
printf ' done\r\n'
sleep 5
`);
			chmodSync(reporter, 0o755);
			return bin;
		}

		const AGENTS = [
			{ name: "Claude Code", command: "fake-claude" },
			{ name: "Codex", command: `fake-codex --model "big one" --sandbox=workspace-write` },
			{ name: "Missing", command: "no-such-agent --flag" },
			{ name: "Quitter", command: "fake-quitter" },
			{ name: "Leaver", command: "fake-leaver" },
			{ name: "Claude Leaves", command: "claude" },
			{ name: "Nohupper", command: "fake-nohupper" },
			{ name: "Paster", command: `fake-paster ${bracketedPaste(PASTED).length}` },
			// The paste and the Enter after it.
			{ name: "Prompted", command: `fake-paster ${bracketedPaste(PROMPT).length + 1}` },
			{ name: "Reporter", command: `fake-reporter ${bracketedPaste(PROMPT).length + 1}` },
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

		test("each saved agent is looked for as a session looks for it, and nothing starts", async () => {
			startWithAgents({
				agents: async () => [
					AGENTS[0]!, AGENTS[2]!,
					{ name: "Full", command: `"${join(root, "agent bin", "fake-codex")}"` },
					{ name: "Gone", command: join(root, "nowhere", "agent") },
					{ name: "Relative", command: "./bin/agent" },
				],
			});
			const changesBefore = changes.length;
			expect(await sessions.locateAgents()).toEqual([
				{ name: "Claude Code", command: "fake-claude", lookup: { state: "found", path: join(root, "agent bin", "fake-claude") } },
				{ name: "Missing", command: "no-such-agent --flag", lookup: { state: "not-found" } },
				{ name: "Full", command: `"${join(root, "agent bin", "fake-codex")}"`, lookup: { state: "found", path: join(root, "agent bin", "fake-codex") } },
				{ name: "Gone", command: join(root, "nowhere", "agent"), lookup: { state: "not-found" } },
				{ name: "Relative", command: "./bin/agent", lookup: { state: "unusable", message: "Starts with the relative path ./bin/agent, which the app does not start. Use a command found on the PATH, or a full path." } },
			]);
			expect(sessions.list()).toEqual([]);
			expect(changes.length).toBe(changesBefore);
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

		test("closing an agent session ends the agent, and an agent that exits goes on as a shell with its exit code kept", async () => {
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
			expect(await until(() => sessions.list().find(session => session.id === codex.id)?.kind === "terminal")).toBe(true);
			expect(sessions.list()[0]!.state).toEqual({ kind: "running" });
			expect(sessions.list()[0]!.endedAgent).toMatchObject({ exitCode: 0, signal: null });
		});

		describe("pasting a review", () => {
			test("goes as one bracketed paste, line breaks as carriage returns, and nothing else", async () => {
				startWithAgents();
				const paster = await openedAgent("Paster");
				await seen(paster.id, "paster ready");
				expect(sessions.paste(paster.id, PASTED)).toEqual({ outcome: "pasted" });
				await seen(paster.id, " done");
				const hex = Buffer.from(bracketedPaste(PASTED)).toString("hex");
				expect(printed(paster.id)).toContain(`${hex} done`);
				expect(bracketedPaste(PASTED)).toBe("\x1b[200~Review notes\r\rsrc/a.ts:2\r> +x\rFix this.\x1b[201~");
			});

			test("an agent that has not asked for bracketed paste gets nothing, so no line break can send it early", async () => {
				startWithAgents();
				const claude = await openedAgent("Claude Code");
				await seen(claude.id, "fake-claude in");
				expect(sessions.paste(claude.id, PASTED)).toEqual({ outcome: "not-ready", message: PASTE_NOT_READY });
				sessions.write(claude.id, "after\n");
				await seen(claude.id, "fake-claude got after");
				expect(printed(claude.id)).not.toContain("got Review");
			});

			test("text that could end the paste early, a line break a program cannot take, and a session that is gone get nothing", async () => {
				startWithAgents();
				const paster = await openedAgent("Paster");
				await seen(paster.id, "paster ready");
				expect(sessions.paste(paster.id, "a\x1b[201~b").outcome).toBe("refused");
				expect(sessions.paste(paster.id, "  ").outcome).toBe("refused");
				const opened = await sessions.open({ repository, worktree, cols: 80, rows: 24 });
				if (opened.outcome !== "opened") throw new Error("No terminal");
				// The test's shell never asks for bracketed paste: a line break would act as Enter.
				expect(sessions.paste(opened.session.id, PASTED)).toEqual({ outcome: "not-ready", message: PASTE_NOT_READY });
				await sessions.close(paster.id);
				expect(sessions.paste(paster.id, PASTED).outcome).toBe("gone");
				expect(sessions.paste("no-such-session", PASTED).outcome).toBe("gone");
			});
		});

		describe("a prompt chop", () => {
			const prompt = { kind: "prompt" as const, text: PROMPT };
			const sent = `${Buffer.from(`${bracketedPaste(PROMPT)}\r`).toString("hex")} done`;
			const promptOf = (id: string) => sessions.list().find(session => session.id === id)?.prompt;

			async function openedWithPrompt(agent: string) {
				const result = await sessions.open({ repository, worktree, cols: 80, rows: 24, agent }, prompt);
				if (result.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(result)}`);
				return result.session;
			}

			test("an agent that never probes gets it once it asked for bracketed paste and went quiet: one paste, then Enter, never on its command line", async () => {
				startWithAgents({ promptQuietMilliseconds: 100, promptEnterMilliseconds: 20 });
				const plain = await openedAgent("Prompted");
				const session = await openedWithPrompt("Prompted");
				expect(session.prompt).toEqual({ state: "pending" });
				// Started exactly as the agent starts without a prompt.
				expect(session.command).toBe(plain.command);
				expect(session.name).toBe("Prompted 2");
				await seen(session.id, " done");
				expect(printed(session.id)).toContain(sent);
				expect(await until(() => promptOf(session.id)?.state === "sent")).toBe(true);
			});

			test("an agent that probes waits while it is blocked, such as on a trust question, and gets it once it says it is idle", async () => {
				startWithAgents({ promptQuietMilliseconds: 50, promptEnterMilliseconds: 20 });
				const session = await openedWithPrompt("Reporter");
				await seen(session.id, "trust this folder?");
				// Quiet long enough for an agent that never probed, but this one is blocked.
				await Bun.sleep(250);
				expect(printed(session.id)).not.toContain("done");
				expect(promptOf(session.id)).toEqual({ state: "pending" });
				await seen(session.id, " done");
				expect(printed(session.id)).toContain(sent);
				expect(await until(() => promptOf(session.id)?.state === "sent")).toBe(true);
			});

			test("an agent that is never ready gets nothing, and the session says why", async () => {
				startWithAgents({ promptWaitMilliseconds: 300 });
				const session = await openedWithPrompt("Claude Code");
				expect(await until(() => promptOf(session.id)?.state === "not-sent")).toBe(true);
				expect(promptOf(session.id)).toMatchObject({ message: expect.stringContaining("Claude Code was not ready for the prompt") });
				sessions.write(session.id, "after\n");
				await seen(session.id, "fake-claude got after");
				expect(printed(session.id)).not.toContain("Write tests");
			});

			test("an agent that ends first gets nothing, and the session says so", async () => {
				startWithAgents();
				const session = await openedWithPrompt("Claude Code");
				await seen(session.id, "fake-claude in");
				sessions.write(session.id, "\x04");
				expect(await until(() => promptOf(session.id)?.state === "not-sent")).toBe(true);
				expect(promptOf(session.id)).toMatchObject({ message: expect.stringContaining("ended before it was ready") });
			});

			test("never goes to a shell, setup, or a workflow, and never with text a paste must not hold", async () => {
				startWithAgents();
				expect(await sessions.open({ repository, worktree, cols: 80, rows: 24 }, prompt)).toMatchObject({ outcome: "failed" });
				expect(await sessions.open({ repository, worktree, cols: 80, rows: 24, timberWorktreeSetup: {} }, prompt)).toMatchObject({ outcome: "failed" });
				expect(await sessions.open({ repository, worktree, cols: 80, rows: 24, agent: "Codex" }, { kind: "prompt", text: "a\x1b[201~b" })).toMatchObject({ outcome: "failed" });
				expect(sessions.list()).toEqual([]);
			});

			test("goes to a running agent at once, as a paste then Enter; a shell, another worktree, or a session that is gone get nothing", async () => {
				startWithAgents({ promptEnterMilliseconds: 20 });
				const agent = await openedAgent("Prompted");
				await seen(agent.id, "paster ready");
				// Another worktree, or the right folder named under another repository.
				expect(sessions.sendPrompt(agent.id, repository, repository, PROMPT)).toMatchObject({ outcome: "not-agent" });
				expect(sessions.sendPrompt(agent.id, unlisted, worktree, PROMPT)).toMatchObject({ outcome: "not-agent" });
				expect(sessions.sendPrompt(agent.id, repository, worktree, PROMPT)).toEqual({ outcome: "pasted" });
				await seen(agent.id, " done");
				expect(printed(agent.id)).toContain(sent);
				const shell = await opened();
				expect(sessions.sendPrompt(shell.session.id, repository, worktree, PROMPT)).toMatchObject({ outcome: "not-agent" });
				expect(sessions.sendPrompt("no-such-session", repository, worktree, PROMPT).outcome).toBe("gone");
				// An agent that has not asked for bracketed paste gets no text with a line break.
				const claude = await openedAgent("Claude Code");
				await seen(claude.id, "fake-claude in");
				expect(sessions.sendPrompt(claude.id, repository, worktree, PROMPT)).toEqual({ outcome: "not-ready", message: PASTE_NOT_READY });
			});

			test("an agent still waiting for its own prompt takes no other, since it may be on a first-run screen", async () => {
				startWithAgents();
				const session = await openedWithPrompt("Claude Code");
				expect(sessions.sendPrompt(session.id, repository, worktree, "one line")).toEqual({ outcome: "not-ready", message: PROMPT_STILL_STARTING });
				expect(sessions.paste(session.id, "one line")).toEqual({ outcome: "not-ready", message: PROMPT_STILL_STARTING });
			});
		});

		describe("a review for a new agent", () => {
			// The paste, and then "x" typed by the person: an Enter in between would show as 0d.
			const pastedThenX = `${Buffer.from(`${bracketedPaste(PROMPT)}x`).toString("hex")} done`;
			const promptOf = (id: string) => sessions.list().find(session => session.id === id)?.prompt;

			async function openedWithReview(agent: string, review = PROMPT) {
				const result = await sessions.open({ repository, worktree, cols: 80, rows: 24, agent, review });
				if (result.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(result)}`);
				return result.session;
			}

			test("is pasted once the agent is ready, as one paste with no Enter, never on its command line", async () => {
				startWithAgents({ promptQuietMilliseconds: 100, promptEnterMilliseconds: 20 });
				const plain = await openedAgent("Prompted");
				const session = await openedWithReview("Prompted");
				expect(session.prompt).toEqual({ state: "pending", what: "review" });
				expect(session.command).toBe(plain.command);
				expect(await until(() => promptOf(session.id)?.state === "sent")).toBe(true);
				expect(promptOf(session.id)).toEqual({ state: "sent", what: "review" });
				// Well past the pause before a prompt's Enter: still nothing after the paste.
				await Bun.sleep(100);
				expect(printed(session.id)).not.toContain(" done");
				sessions.write(session.id, "x");
				await seen(session.id, " done");
				expect(printed(session.id)).toContain(pastedThenX);
			});

			test("waits while the agent is blocked, such as on a trust question, and is pasted once it is idle", async () => {
				startWithAgents({ promptQuietMilliseconds: 50 });
				const session = await openedWithReview("Reporter");
				await seen(session.id, "trust this folder?");
				await Bun.sleep(250);
				expect(promptOf(session.id)).toEqual({ state: "pending", what: "review" });
				expect(await until(() => promptOf(session.id)?.state === "sent")).toBe(true);
				sessions.write(session.id, "x");
				await seen(session.id, " done");
				expect(printed(session.id)).toContain(pastedThenX);
			});

			test("an agent that is never ready, or ends first, gets nothing, and the session says why in a review's words", async () => {
				startWithAgents({ promptWaitMilliseconds: 300 });
				const late = await openedWithReview("Claude Code");
				expect(await until(() => promptOf(late.id)?.state === "not-sent")).toBe(true);
				expect(promptOf(late.id)).toMatchObject({ what: "review", message: expect.stringContaining("Claude Code was not ready for the review") });
				const ended = await openedWithReview("Codex");
				await seen(ended.id, "fake-codex in");
				sessions.write(ended.id, "\x04");
				expect(await until(() => promptOf(ended.id)?.state === "not-sent")).toBe(true);
				expect(promptOf(ended.id)).toMatchObject({ what: "review", message: expect.stringContaining("ended before it was ready for the review") });
			});

			test("goes to a new agent from Settings only, never with text a paste must not hold", async () => {
				startWithAgents();
				const where = { repository, worktree, cols: 80, rows: 24 };
				const refused: OpenTerminalRequest[] = [
					{ ...where, review: PROMPT },
					{ ...where, review: PROMPT, timberWorktreeSetup: {} },
					{ ...where, review: PROMPT, agent: "Codex", arenaAttempt: { arena: "demo", attempt: "codex-1" } },
					{ ...where, review: PROMPT, workflowAgent: { workflow: "review" } },
					{ ...where, review: PROMPT, agent: "Codex", resume: crypto.randomUUID() },
					{ ...where, review: PROMPT, agent: "Codex", restore: { worktree: "w", index: 0 } },
					{ ...where, review: "a\x1b[201~b", agent: "Codex" },
					{ ...where, review: "x".repeat(100_001), agent: "Codex" },
				];
				for (const request of refused) expect(await sessions.open(request)).toMatchObject({ outcome: "failed" });
				expect(await sessions.open({ ...where, review: PROMPT, agent: "Codex" }, { kind: "prompt", text: PROMPT })).toMatchObject({ outcome: "failed" });
				expect(sessions.list()).toEqual([]);
			});

			test("an agent still waiting to paste its review takes no other paste or prompt", async () => {
				startWithAgents();
				const session = await openedWithReview("Claude Code");
				expect(sessions.paste(session.id, "one line")).toEqual({ outcome: "not-ready", message: PROMPT_STILL_STARTING });
				expect(sessions.sendPrompt(session.id, repository, worktree, "one line")).toEqual({ outcome: "not-ready", message: PROMPT_STILL_STARTING });
			});
		});

		test("an agent named as other programs are too is known by the file it leads to, and still starts as found", async () => {
			// As Cursor's installer and Grok Build's each put an `agent` on the PATH, linked to a file of their own.
			const linked = (folder: string, file: string) => {
				const target = join(root, folder, file);
				mkdirSync(join(root, folder, "bin"), { recursive: true });
				writeFileSync(target, `#!/bin/sh\nprintf '%s ready\\n' "$(basename "$0")"\nread line\n`);
				chmodSync(target, 0o755);
				symlinkSync(target, join(root, folder, "bin", "agent"));
				return join(root, folder, "bin", "agent");
			};
			const cursor = linked("cursor-agent", "cursor-agent");
			const grok = linked("grok", "grok-1.0.92-linux-x86_64");
			startWithAgents({ agents: async () => [{ name: "Cursor CLI", command: cursor }, { name: "Other", command: grok }] });
			const one = await openedAgent("Cursor CLI");
			const other = await openedAgent("Other");
			expect(one).toMatchObject({ kind: "agent", shell: cursor, program: "cursor" });
			expect(other.shell).toBe(grok);
			expect(other.program).toBeUndefined();
			expect(sessions.running().map(session => session.program).sort()).toEqual(["cursor", null]);
			// Started by the name it was found as, which such a program may read.
			await seen(one.id, "agent ready");
		});

		describe("an agent that ends by itself", () => {
			const fallen = (id: string) => until(() => sessions.list().find(session => session.id === id)?.kind === "terminal");
			const changesOf = (id: string) => changes.filter(change => change.id === id);

			test("goes on as a shell in the worktree's folder, in the same session, with what it printed above", async () => {
				startWithAgents();
				const quitter = await openedAgent("Quitter");
				expect(await fallen(quitter.id)).toBe(true);
				const session = sessions.list()[0]!;
				expect(session).toMatchObject({
					id: quitter.id, name: "Quitter", kind: "terminal", path: worktree, shell: "/bin/sh", state: { kind: "running" }, status: null, children: [],
					endedAgent: { name: "Quitter", agent: "Quitter", program: null, resumable: null, conversation: null, exitCode: 3, signal: null },
				});
				expect(session.endedAgent!.command).toContain("fake-quitter");
				expect(session.command).not.toContain("fake-quitter");
				expect(printed(quitter.id)).toContain("quitter-out");
				expect(printed(quitter.id)).toContain(`Quitter exited with code 3. This is now a shell in ${worktree}.`);
				// The shell is the person's, in the worktree's folder.
				await run(quitter.id, "pwd", `${worktree}\r\n`);
				// The person's shell took the session over in one change, and the session never showed as exited.
				expect(changesOf(quitter.id).filter(change => change.session?.state.kind === "exited")).toEqual([]);
				expect(changesOf(quitter.id).filter(change => change.session?.kind === "terminal")).toHaveLength(1);
				expect(sessions.liveCount()).toBe(1);
				expect(sessions.leaders()).toHaveLength(1);
				expect(sessions.read(quitter.id)!.data).toContain("quitter-out");
			});

			test("keeps the conversation of Claude Code, and then is a terminal that restarts as one", async () => {
				const ID = "dddddddd-0000-4000-8000-000000000004";
				startWithAgents({ conversations: { claudeExists: () => false, codexExists: () => false, newId: () => ID } });
				const claude = await openedAgent("Claude Leaves");
				expect(sessions.running()).toMatchObject([{ kind: "agent", agent: "Claude Leaves", resumable: "claude", program: "claude", conversation: ID }]);
				await seen(claude.id, `claude args [--session-id] [${ID}]`);
				sessions.write(claude.id, "bye\n");
				expect(await fallen(claude.id)).toBe(true);
				expect(sessions.list()[0]!.endedAgent).toMatchObject({ name: "Claude Leaves", agent: "Claude Leaves", program: "claude", resumable: "claude", conversation: ID, exitCode: 0 });
				expect(sessions.liveCount()).toBe(1);
				expect(sessions.running()).toMatchObject([{ id: claude.id, kind: "terminal", agent: null, resumable: null, program: null, conversation: null, name: null }]);
			});

			test("never starts a shell when the session is closed meanwhile, by close or by killAll", async () => {
				startWithAgents();
				const closed = await openedAgent("Leaver");
				await seen(closed.id, "leaver ready");
				sessions.write(closed.id, "go\n");
				await sessions.close(closed.id);
				const killed = await openedAgent("Leaver");
				await seen(killed.id, "leaver ready");
				sessions.write(killed.id, "go\n");
				sessions.killAll();
				await Bun.sleep(600);
				expect(sessions.list()).toEqual([]);
				expect(changes.filter(change => change.session?.kind === "terminal")).toEqual([]);
				expect(changesOf(closed.id).at(-1)).toEqual({ id: closed.id, session: null });
			});

			test("stays exited when the shell ends later, with the agent's end kept", async () => {
				startWithAgents();
				const quitter = await openedAgent("Quitter");
				expect(await fallen(quitter.id)).toBe(true);
				sessions.write(quitter.id, "exit 5\r");
				expect(await until(() => sessions.list()[0]?.state.kind === "exited")).toBe(true);
				await Bun.sleep(300);
				expect(sessions.list()).toHaveLength(1);
				expect(sessions.list()[0]).toMatchObject({ kind: "terminal", state: { kind: "exited", exitCode: 5, signal: null }, endedAgent: { exitCode: 3 } });
				expect(sessions.liveCount()).toBe(0);
				expect(sessions.running()).toEqual([]);
			});

			test("drops a prompt it never sent, and nothing it was to be sent reaches the shell", async () => {
				startWithAgents();
				const result = await sessions.open({ repository, worktree, cols: 80, rows: 24, agent: "Quitter" }, { kind: "prompt", text: PROMPT });
				if (result.outcome !== "opened") throw new Error(JSON.stringify(result));
				expect(await fallen(result.session.id)).toBe(true);
				await Bun.sleep(400);
				expect(sessions.list()[0]!.prompt).toMatchObject({ state: "not-sent" });
				expect(printed(result.session.id)).not.toContain("Write tests");
				expect(sessions.list()[0]!.state).toEqual({ kind: "running" });
			});

			test.skipIf(!linux)("leaves nothing behind when closed: what the agent left running ends with the session", async () => {
				startWithAgents();
				const agent = await openedAgent("Nohupper");
				await seen(agent.id, "nohupper pid:");
				const pid = Number(/pid:(\d+)/.exec(printed(agent.id))![1]);
				sessions.write(agent.id, "go\n");
				expect(await fallen(agent.id)).toBe(true);
				await Bun.sleep(300);
				expect(alive(pid)).toBe(true);
				await sessions.close(agent.id);
				expect(await until(() => !alive(pid))).toBe(true);
			});

			test("never happens to a Timber command, which stays exited", async () => {
				const bin = join(root, "setup bin");
				mkdirSync(bin, { recursive: true });
				const timber = join(bin, "timber");
				writeFileSync(timber, "#!/bin/sh\necho setup-out\nexit 2\n");
				chmodSync(timber, 0o755);
				startWithAgents({ timber: async () => ({ state: "ready", source: "path", path: timber, version: "0.1.1" }) });
				const result = await sessions.open({ repository, worktree, cols: 80, rows: 24, timberWorktreeSetup: {} });
				if (result.outcome !== "opened") throw new Error(JSON.stringify(result));
				expect(await until(() => sessions.list()[0]?.state.kind === "exited")).toBe(true);
				await Bun.sleep(300);
				expect(sessions.list()[0]).toMatchObject({ kind: "timber", state: { kind: "exited", exitCode: 2 } });
				expect(sessions.list()[0]!.endedAgent).toBeUndefined();
			});
		});

		/** Whether a pretend agent of this temporary folder still runs. */
		function running(name: string): boolean {
			return Bun.spawnSync(["pgrep", "-f", join(root, "agent bin", name)], { stdout: "pipe" }).exitCode === 0;
		}

		describe("arena attempts", () => {
			const wanted = { arena: "demo", attempt: "codex-1" };
			type Launch = Awaited<ReturnType<NonNullable<TerminalDependencies["arenaLaunch"]>>>;

			function startWithLaunch(launch: Launch) {
				const asked: unknown[] = [];
				startWithAgents({
					environment: { PATH: `${join(root, "agent bin")}:${process.env.PATH}`, HOME: root, SHELL: "/bin/sh", PS1: "$ ", LANG: "C.UTF-8", TIMBER_WORKFLOW: "inherited" },
					arenaLaunch: async request => {
						asked.push(request);
						return launch;
					},
				});
				return asked;
			}

			test("an attempt's agent starts with exactly the program, folder, and environment Timber gives, named after its label", async () => {
				const asked = startWithLaunch({
					outcome: "ready", argv: ["fake-arena-agent", "--task file", "/private/task.txt"], cwd: worktree,
					environment: { TIMBER_ARENA: "demo", TIMBER_ATTEMPT: "codex-1" }, unset: ["TIMBER_WORKFLOW"],
				});
				// This pretend agent also prints what it got from the environment.
				const script = join(root, "agent bin", "fake-arena-agent");
				writeFileSync(script, `#!/bin/sh\nprintf 'fake-arena-agent in %s args' "$(pwd)"\nfor arg in "$@"; do printf ' [%s]' "$arg"; done\necho\necho "arena=$TIMBER_ARENA attempt=$TIMBER_ATTEMPT workflow=\${TIMBER_WORKFLOW-unset}"\nwhile read line; do echo "got $line"; done\n`);
				chmodSync(script, 0o755);
				const result = await sessions.open({ repository, worktree, cols: 80, rows: 24, arenaAttempt: wanted });
				if (result.outcome !== "opened") throw new Error(JSON.stringify(result));
				expect(asked).toEqual([{ repository, worktree, ...wanted }]);
				expect(result.session).toMatchObject({ kind: "agent", name: "codex-1", path: worktree, shell: script });
				await seen(result.session.id, "workflow=unset");
				expect(printed(result.session.id)).toContain(`fake-arena-agent in ${worktree} args [--task file] [/private/task.txt]`);
				expect(printed(result.session.id)).toContain("arena=demo attempt=codex-1 workflow=unset");
			});

			test("a manual attempt, Timber's refusal, or another folder starts nothing", async () => {
				startWithLaunch({ outcome: "no-agent" });
				expect(await sessions.open({ repository, worktree, cols: 80, rows: 24, arenaAttempt: wanted })).toMatchObject({ outcome: "not-configured", message: expect.stringContaining("manual attempt") });
				startWithLaunch({ outcome: "failed", message: "No attempt. Nothing was started." });
				expect(await sessions.open({ repository, worktree, cols: 80, rows: 24, arenaAttempt: wanted })).toEqual({ outcome: "failed", message: "No attempt. Nothing was started." });
				startWithLaunch({ outcome: "ready", argv: ["fake-codex"], cwd: repository, environment: {}, unset: [] });
				expect(await sessions.open({ repository, worktree, cols: 80, rows: 24, arenaAttempt: wanted })).toMatchObject({ outcome: "failed", message: expect.stringContaining(`not ${worktree}`) });
				expect(sessions.list()).toEqual([]);
			});

			test("names that could read as options, or an attempt with another kind of session, are refused before Timber is asked", async () => {
				const asked = startWithLaunch({ outcome: "no-agent" });
				expect((await sessions.open({ repository, worktree, cols: 80, rows: 24, arenaAttempt: { arena: "--x", attempt: "codex-1" } })).outcome).toBe("failed");
				expect((await sessions.open({ repository, worktree, cols: 80, rows: 24, arenaAttempt: wanted, agent: "Codex" })).outcome).toBe("failed");
				expect(asked).toEqual([]);
			});

			test("an attempt goes only where a terminal may go", async () => {
				startWithLaunch({ outcome: "ready", argv: ["fake-codex"], cwd: unlisted, environment: {}, unset: [] });
				const result = await sessions.open({ repository, worktree: unlisted, cols: 80, rows: 24, arenaAttempt: wanted });
				expect(result.outcome === "not-listed" && result.message).toContain("codex-1 was not started.");
			});

			test("an attempt whose agent ends goes on as a shell in its chip, named after its label", async () => {
				startWithLaunch({ outcome: "ready", argv: ["fake-quitter"], cwd: worktree, environment: { TIMBER_ARENA: "demo" }, unset: [] });
				const result = await sessions.open({ repository, worktree, cols: 80, rows: 24, arenaAttempt: wanted });
				if (result.outcome !== "opened") throw new Error(JSON.stringify(result));
				expect(await until(() => sessions.list()[0]?.kind === "terminal")).toBe(true);
				expect(sessions.list()[0]).toMatchObject({ id: result.session.id, name: "codex-1", state: { kind: "running" }, endedAgent: { name: "codex-1", agent: null, exitCode: 3 } });
				expect(printed(result.session.id)).toContain("codex-1 exited with code 3.");
				// The shell does not get the attempt's own environment changes.
				sessions.write(result.session.id, "echo arena=${TIMBER_ARENA-unset}\r");
				expect(await until(() => printed(result.session.id).includes("arena=unset\r\n"))).toBe(true);
			});
		});
	});

	describe("sessions that come back after a restart", () => {
		const NEW = "aaaaaaaa-0000-4000-8000-000000000001";
		const OLD = "bbbbbbbb-0000-4000-8000-000000000002";
		const GONE = "cccccccc-0000-4000-8000-000000000003";
		const NOTE = "The saved conversation was not found, so";

		/** Pretend `claude`, `codex`, and `timber` that print their arguments, then wait as a shell. */
		function resumeBin(): string {
			const bin = join(root, "resume bin");
			mkdirSync(bin, { recursive: true });
			for (const name of ["claude", "codex", "timber"]) {
				writeFileSync(join(bin, name), `#!/bin/sh\necho "ARGS:$*"\nexec /bin/sh\n`);
				chmodSync(join(bin, name), 0o755);
			}
			return bin;
		}

		function startResumable(agents = [{ name: "Claude Code", command: "claude --model opus" }, { name: "Codex", command: "codex" }, { name: "Aider", command: "/bin/sh" }]) {
			const bin = resumeBin();
			const existing = new Set([OLD]);
			const asked: string[] = [];
			start({
				environment: { PATH: `${bin}:${process.env.PATH}`, HOME: root, SHELL: "/bin/sh", PS1: "$ ", LANG: "C.UTF-8" },
				agents: async () => agents,
				timber: async () => ({ state: "ready", source: "path", path: join(bin, "timber"), version: "0.1.1" }),
				conversations: {
					claudeExists: id => (asked.push(`claude:${id}`), existing.has(id)),
					codexExists: id => (asked.push(`codex:${id}`), existing.has(id)),
					newId: () => NEW,
				},
				now: () => 1234,
			});
			return { asked };
		}

		async function openWith(extra: { agent?: string; resume?: string; name?: string; timberWorktreeSetup?: Record<string, never>; restore?: unknown }) {
			const result = await sessions.open({ repository, worktree, cols: 80, rows: 24, ...extra } as OpenTerminalRequest);
			if (result.outcome !== "opened") throw new Error(`Not opened: ${JSON.stringify(result)}`);
			return result.session;
		}

		const shows = async (id: string, text: string) => {
			const found = await until(() => printed(id).includes(text));
			if (!found) throw new Error(`Did not see ${text}. Printed: ${JSON.stringify(printed(id))}`);
		};

		test("a fresh Claude Code gets an id of the app's choosing", async () => {
			startResumable();
			const session = await openWith({ agent: "Claude Code" });
			await shows(session.id, `ARGS:--session-id ${NEW} --model opus`);
			expect(session.command).toBe(`'${join(root, "resume bin", "claude")}' --session-id ${NEW} --model opus`);
			expect(sessions.running()).toEqual([{ id: session.id, worktree: `id:${worktree}`, path: worktree, kind: "agent", agent: "Claude Code", resumable: "claude", program: "claude", conversation: NEW, startedAt: 1234, name: null, restored: null }]);
		});

		test("Claude Code goes back to a conversation that is there", async () => {
			startResumable();
			const session = await openWith({ agent: "Claude Code", resume: OLD });
			await shows(session.id, `ARGS:--resume ${OLD} --model opus`);
			expect(sessions.running()[0]!.conversation).toBe(OLD);
			expect(printed(session.id)).not.toContain("started fresh");
			expect(printed(session.id)).not.toContain("--session-id");
		});

		test("a conversation that is gone starts fresh and says so", async () => {
			startResumable();
			const session = await openWith({ agent: "Claude Code", resume: GONE });
			await shows(session.id, `--session-id ${NEW}`);
			expect(printed(session.id)).toContain("The saved conversation was not found, so Claude Code started fresh.");
			// The note comes first, and is kept for drawing the session again.
			expect(printed(session.id).indexOf(NOTE)).toBeLessThan(printed(session.id).indexOf("ARGS:"));
			expect(sessions.read(session.id)!.data).toContain(NOTE);
			expect(sessions.running()[0]!.conversation).toBe(NEW);
		});

		test("Codex resumes with its subcommand, and starts plain otherwise", async () => {
			const { asked } = startResumable();
			const resumed = await openWith({ agent: "Codex", resume: OLD });
			await shows(resumed.id, `ARGS:resume ${OLD}`);
			const plain = await openWith({ agent: "Codex" });
			await shows(plain.id, "ARGS:\r\n");
			const gone = await openWith({ agent: "Codex", resume: GONE });
			await shows(gone.id, "ARGS:\r\n");
			expect(printed(gone.id)).toContain("The saved conversation was not found, so Codex started fresh.");
			expect(printed(plain.id)).not.toContain(NOTE);
			expect(sessions.running().map(session => session.conversation)).toEqual([OLD, null, null]);
			// Each agent's id is looked for only in that agent's own folder.
			expect(asked).toEqual([`codex:${OLD}`, `codex:${GONE}`]);
		});

		test("an agent the app cannot resume starts as typed, and says so when a conversation was asked for", async () => {
			startResumable();
			const session = await openWith({ agent: "Aider", resume: OLD });
			expect(session.command).toBe("/bin/sh");
			await shows(session.id, "The saved conversation was not found, so Aider started fresh.");
			expect(sessions.running()[0]).toMatchObject({ agent: "Aider", resumable: null, conversation: null });
		});

		test("an id that is not a UUID never reaches the command line", async () => {
			const { asked } = startResumable();
			const session = await openWith({ agent: "Claude Code", resume: "--dangerously-skip-permissions" });
			await shows(session.id, `--session-id ${NEW}`);
			expect(session.command).not.toContain("dangerously");
			expect(printed(session.id)).not.toContain("dangerously");
			expect(printed(session.id)).not.toContain(NOTE);
			expect(asked).toEqual([]);
			const odd = await openWith({ agent: "Codex", resume: 42 as unknown as string });
			await shows(odd.id, "ARGS:\r\n");
		});

		test("a command that already picks a conversation is left alone", async () => {
			startResumable([{ name: "Pinned", command: "claude --continue" }]);
			const session = await openWith({ agent: "Pinned" });
			await shows(session.id, "ARGS:--continue\r\n");
			expect(session.command).not.toContain("--session-id");
			expect(sessions.running()[0]!.conversation).toBeNull();
		});

		test("a saved name comes back, a default one is made again", async () => {
			startResumable();
			const named = await openWith({ name: "dev   server" });
			expect(named.name).toBe("dev server");
			const plain = await openWith({});
			expect(sessions.running().map(session => session.name)).toEqual(["dev server", null]);
			sessions.rename(plain.id, "x");
			expect(sessions.running().map(session => session.name)).toEqual(["dev server", "x"]);
			// A name that is taken in the worktree is numbered as a default is.
			expect((await openWith({ name: "dev server" })).name).toBe("dev server 2");
			// Nothing to clean is no name.
			expect((await openWith({ name: " \n " })).name).toBe("Terminal");
			const setup = await openWith({ timberWorktreeSetup: {}, name: "mine" });
			expect(setup.name).toBe(WORKTREE_SETUP_SESSION_NAME);
		});

		test("only running terminals and agents are listed, in order", async () => {
			startResumable();
			const terminal = await openWith({});
			const agent = await openWith({ agent: "Codex" });
			const setup = await openWith({ timberWorktreeSetup: {} });
			expect(setup.kind).toBe("timber");
			expect(sessions.running().map(session => session.id)).toEqual([terminal.id, agent.id]);
			sessions.write(terminal.id, "exit\r");
			expect(await until(() => sessions.list().find(session => session.id === terminal.id)?.state.kind === "exited")).toBe(true);
			expect(sessions.running().map(session => session.id)).toEqual([agent.id]);
		});

		test("a session opened again knows which saved one it is; a Timber command or a tag that is not one does not", async () => {
			startResumable();
			const tagged = await openWith({ restore: { worktree: "w1", index: 2 } });
			const agent = await openWith({ agent: "Codex", restore: { worktree: "w1", index: 3 } });
			await openWith({ restore: { worktree: "w1", index: -1 } });
			await openWith({ restore: "w1" });
			await openWith({ timberWorktreeSetup: {}, restore: { worktree: "w1", index: 4 } });
			expect(sessions.running().map(session => session.restored)).toEqual([{ worktree: "w1", index: 2 }, { worktree: "w1", index: 3 }, null, null]);
			expect([tagged.kind, agent.kind]).toEqual(["terminal", "agent"]);
		});

		test("when a Codex session ends or closes is kept by worktree, and nothing for another agent", async () => {
			startResumable();
			const claude = await openWith({ agent: "Claude Code" });
			await sessions.close(claude.id);
			expect(sessions.endedCodex().size).toBe(0);
			const first = await openWith({ agent: "Codex" });
			sessions.write(first.id, "exit\r");
			expect(await until(() => sessions.endedCodex().get(`id:${worktree}`) === 1234)).toBe(true);
			const second = await openWith({ agent: "Codex" });
			await sessions.close(second.id);
			expect([...sessions.endedCodex()]).toEqual([[`id:${worktree}`, 1234]]);
		});

		test("a Codex started as typed is not resumed, and still counts when it ends", async () => {
			startResumable([{ name: "Codex fix", command: "codex \"fix it\"" }]);
			const typed = await openWith({ agent: "Codex fix" });
			await shows(typed.id, "ARGS:fix it");
			expect(sessions.running().map(session => [session.resumable, session.program, session.conversation])).toEqual([[null, "codex", null]]);
			await sessions.close(typed.id);
			expect([...sessions.endedCodex()]).toEqual([[`id:${worktree}`, 1234]]);
		});

		test("the shell needs no conversation", async () => {
			const { asked } = startResumable();
			const session = await openWith({ resume: OLD });
			expect(session.kind).toBe("terminal");
			await run(session.id, "echo ready-$((3+4))", "ready-7");
			expect(printed(session.id)).not.toContain(NOTE);
			expect(sessions.running()[0]!.conversation).toBeNull();
			expect(asked).toEqual([]);
		});
	});
});

// Skipped on Windows: the stand-in openers are shell scripts named xdg-open and open, the Linux and macOS openers.
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
