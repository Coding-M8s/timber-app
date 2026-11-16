import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWebLink } from "../src/bun/open-link";
import { sessionMembers, sessionOfStat } from "../src/bun/process-session";
import { type TerminalDependencies, type TerminalSessions, createTerminalSessions } from "../src/bun/terminals";
import type { Repository } from "../src/shared/model";
import type { TerminalChange, TerminalOutput } from "../src/shared/terminal";

const posix = process.platform !== "win32";
const linux = process.platform === "linux";

async function until(check: () => boolean, milliseconds = 5000): Promise<boolean> {
	const end = Date.now() + milliseconds;
	while (Date.now() < end) {
		if (check()) return true;
		await Bun.sleep(20);
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

function git(cwd: string, ...args: string[]): string {
	const run = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" } });
	if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
	return run.stdout.toString();
}

describe("reading a process's session", () => {
	test("the session is the fourth field after the name, which may hold spaces and parentheses", () => {
		expect(sessionOfStat("1234 (bash) S 1200 1234 1234 34816 1234 4194560")).toBe(1234);
		expect(sessionOfStat("99 (my (odd) name) R 1 98 77 0")).toBe(77);
		expect(sessionOfStat("garbage")).toBeNull();
		expect(sessionOfStat("1 (x) S 0 0 0")).toBeNull();
	});
});

describe("terminal sessions on Windows", () => {
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
		});
		const result = await sessions.open({ repository: "C:\\work\\repo", worktree: "C:\\work\\repo", cols: 80, rows: 24 });
		expect(result.outcome).toBe("unsupported");
		expect(asked).toBe(false);
		expect(sessions.list()).toEqual([]);
	});
});

// Pseudo terminals exist on Linux and macOS only.
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
		worktrees: [repository, worktree].map((path, index) => ({
			id: `id:${path}`, path, canonicalPath: path, branch: index === 0 ? "main" : "feat/login", head: null, primary: index === 0, detached: false,
			locked: false, prunable: false, pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, sync: null,
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
		// In front, a program that ignores SIGHUP, as some do.
		sessions.write(session.id, "sh -c 'trap \"\" HUP; sleep 301'\r");
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
