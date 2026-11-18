import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TerminalSessions, createTerminalSessions } from "../src/bun/terminals";
import type { Repository, TimberStatus } from "../src/shared/model";
import { ontoFromText, rebaseArguments, rebaseBases } from "../src/shared/rebase-command";
import { type OpenTerminalRequest, type TerminalChange, type TerminalOutput, TIMBER_REBASE_SESSION_NAME } from "../src/shared/terminal";
import { describeCommandLine } from "../src/shared/command-line";

const posix = process.platform !== "win32";

async function until(check: () => boolean, milliseconds = 5000): Promise<boolean> {
	const end = Date.now() + milliseconds;
	while (Date.now() < end) {
		if (check()) return true;
		await Bun.sleep(20);
	}
	return check();
}

const gitEnvironment = {
	...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid",
};

function git(cwd: string, ...args: string[]): string {
	const run = Bun.spawnSync(["git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], { cwd, stdout: "pipe", stderr: "pipe", env: gitEnvironment });
	if (run.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${run.stderr.toString()}`);
	return run.stdout.toString();
}

describe("the rebase command", () => {
	test("the base comes first, then --, then the registered path as one argument", () => {
		expect(rebaseArguments({ worktree: "/work/my repo/feat", onto: "origin/main" })).toEqual(["rebase", "--base", "origin/main", "--", "/work/my repo/feat"]);
		expect(rebaseArguments({ worktree: "/work/-odd", onto: null })).toEqual(["rebase", "--", "/work/-odd"]);
		expect(rebaseArguments({ worktree: "/w", onto: "--help" })).toEqual(["rebase", "--base", "--help", "--", "/w"]);
	});

	test("typed text loses only the spaces around it, and nothing typed means the saved base", () => {
		expect(ontoFromText("  origin/main ")).toBe("origin/main");
		expect(ontoFromText("   ")).toBeNull();
		expect(ontoFromText("")).toBeNull();
		expect(ontoFromText("refs/heads/a b")).toBe("refs/heads/a b");
	});

	test("a local branch is offered by its full ref, because Timber reads a plain name as a remote branch", () => {
		expect(rebaseBases([{ selector: "main", kind: "local" }, { selector: "origin/main", kind: "remote" }])).toEqual([
			{ selector: "refs/heads/main", kind: "local" },
			{ selector: "origin/main", kind: "remote" },
		]);
	});
});

// Pseudo terminals exist on Linux and macOS only.
describe.skipIf(!posix)("rebasing in a terminal session", () => {
	let root: string;
	let repository: string;
	let worktree: string;
	let standIn: string;
	let record: string;
	let sessions: TerminalSessions;
	let outputs: TerminalOutput[];
	let changes: TerminalChange[];

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-rebase-")));
		repository = join(root, "my repo");
		worktree = join(root, "my repo-worktrees", "feat login");
		mkdirSync(repository, { recursive: true });
		git(repository, "init", "-q", "-b", "main");
		writeFileSync(join(repository, "README.md"), "hello\n");
		git(repository, "add", "README.md");
		git(repository, "commit", "-q", "-m", "first");
		git(repository, "worktree", "add", "-q", "-b", "feat/login", worktree);
		// A stand-in Timber in a folder with a space: it records its folder and each argument on a line of its own, prints, and exits with 3.
		const bin = join(root, "stand in");
		mkdirSync(bin);
		standIn = join(bin, "timber");
		record = join(root, "record.txt");
		writeFileSync(standIn, `#!/bin/sh\npwd > "${record}"\nfor a in "$@"; do printf '%s\\n' "$a" >> "${record}"; done\necho "stand-in timber printed this"\nexit 3\n`);
		chmodSync(standIn, 0o755);
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	afterEach(() => {
		sessions?.killAll();
		rmSync(record, { force: true });
	});

	const listed = (): Repository => ({
		path: repository, name: "my repo", available: true, failure: null,
		setup: "repository",
		worktrees: [repository, worktree].map((path, index) => ({
			id: `id:${path}`, path, canonicalPath: path, branch: index === 0 ? "main" : "feat/login", head: null, primary: index === 0, detached: false,
			locked: false, prunable: false, pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, sync: null,
		})),
	});

	function setUp(status: TimberStatus) {
		outputs = [];
		changes = [];
		sessions = createTerminalSessions({
			findRepository: async path => path === repository ? listed() : null,
			onOutput: output => outputs.push(output),
			onChange: change => changes.push(change),
			timber: async () => status,
			environment: { ...gitEnvironment, HOME: root, SHELL: "/bin/sh", PS1: "$ ", LANG: "C.UTF-8" },
			closeMilliseconds: 500,
		});
		// The rebase is a Timber session, asked for as the interface asks for one.
		return { start: (request: Omit<OpenTerminalRequest, "timberRebase"> & { onto: string | null }) => {
			const { onto, ...rest } = request;
			return sessions.open({ ...rest, timberRebase: { onto } });
		} };
	}

	const ready = (path: string): TimberStatus => ({ state: "ready", path, version: "0.1.1" });
	const printed = (id: string) => outputs.filter(output => output.id === id).map(output => output.data).join("");
	const exited = (id: string) => changes.find(change => change.id === id && change.session?.state.kind === "exited")?.session ?? null;

	test("the command shown is the command that runs, in the worktree's folder, and its exit is all that is reported", async () => {
		const rebase = setUp(ready(standIn));
		const result = await rebase.start({ repository, worktree, onto: "refs/heads/main", cols: 80, rows: 24 });
		if (result.outcome !== "opened") throw new Error(JSON.stringify(result));
		const { session } = result;
		expect(session).toMatchObject({ kind: "timber", name: TIMBER_REBASE_SESSION_NAME, repository, worktree: `id:${worktree}`, path: worktree, shell: standIn, state: { kind: "running" } });
		expect(session.command).toBe(describeCommandLine([standIn, "rebase", "--base", "refs/heads/main", "--", worktree]));
		expect(await until(() => exited(session.id) !== null)).toBe(true);
		expect(exited(session.id)!.state).toEqual({ kind: "exited", exitCode: 3, signal: null });
		expect(printed(session.id)).toContain("stand-in timber printed this");
		expect(readFileSync(record, "utf8")).toBe(`${worktree}\nrebase\n--base\nrefs/heads/main\n--\n${worktree}\n`);
	});

	test("with no base the saved one is used: no --base is passed", async () => {
		const rebase = setUp(ready(standIn));
		const result = await rebase.start({ repository, worktree, onto: null, cols: 80, rows: 24 });
		expect(result.outcome).toBe("opened");
		expect(await until(() => existsSync(record) && readFileSync(record, "utf8").endsWith(`${worktree}\n`) && readFileSync(record, "utf8").split("\n").length > 3)).toBe(true);
		expect(readFileSync(record, "utf8")).toBe(`${worktree}\nrebase\n--\n${worktree}\n`);
	});

	test("a worktree that has a terminal gets the rebase in a session beside it", async () => {
		const rebase = setUp(ready(standIn));
		const shell = await sessions.open({ repository, worktree, cols: 80, rows: 24 });
		expect(shell.outcome).toBe("opened");
		const result = await rebase.start({ repository, worktree, onto: null, cols: 80, rows: 24 });
		expect(result.outcome).toBe("opened");
		expect(sessions.list().map(session => session.kind).sort()).toEqual(["terminal", "timber"]);
	});

	test("nothing runs while Timber is not ready, for a worktree Timber does not list, or for a request of the wrong shape", async () => {
		let rebase = setUp({ state: "not-found", override: null });
		expect((await rebase.start({ repository, worktree, onto: null, cols: 80, rows: 24 })).outcome).toBe("not-configured");
		rebase = setUp(ready(standIn));
		const unlisted = await rebase.start({ repository, worktree: join(root, "elsewhere"), onto: null, cols: 80, rows: 24 });
		expect(unlisted.outcome).toBe("not-listed");
		expect((await rebase.start({ repository: join(root, "other"), worktree, onto: null, cols: 80, rows: 24 })).outcome).toBe("not-listed");
		const wrong = { repository, worktree, onto: 7, cols: 80, rows: 24 } as unknown as Parameters<typeof rebase.start>[0];
		expect((await rebase.start(wrong)).outcome).toBe("failed");
		expect((await rebase.start({ repository, worktree, onto: "", cols: 80, rows: 24 })).outcome).toBe("failed");
		expect((await sessions.open({ repository, worktree, cols: 80, rows: 24, timberRebase: { onto: null }, timberSetup: "repository" })).outcome).toBe("failed");
		await Bun.sleep(100);
		expect(existsSync(record)).toBe(false);
		expect(sessions.list()).toEqual([]);
	});

	test("on Windows nothing starts", async () => {
		const windows = createTerminalSessions({ findRepository: async () => listed(), onOutput: () => {}, onChange: () => {}, timber: async () => ready(standIn), platform: "win32" });
		const result = await windows.open({ repository, worktree, cols: 80, rows: 24, timberRebase: { onto: null } });
		expect(result.outcome).toBe("unsupported");
	});

	const installed = Bun.which("timber");
	test.skipIf(installed === null)("the installed Timber rebases the worktree onto a local base, in the session", async () => {
		writeFileSync(join(worktree, "feat.txt"), "feat\n");
		git(worktree, "add", "feat.txt");
		git(worktree, "commit", "-q", "-m", "on feat");
		writeFileSync(join(repository, "main.txt"), "main\n");
		git(repository, "add", "main.txt");
		git(repository, "commit", "-q", "-m", "on main");
		const main = git(repository, "rev-parse", "main").trim();
		const rebase = setUp(ready(installed!));
		const result = await rebase.start({ repository, worktree, onto: "refs/heads/main", cols: 100, rows: 30 });
		if (result.outcome !== "opened") throw new Error(JSON.stringify(result));
		expect(await until(() => exited(result.session.id) !== null, 15000)).toBe(true);
		expect({ state: exited(result.session.id)!.state, printed: printed(result.session.id) }).toMatchObject({ state: { kind: "exited", exitCode: 0, signal: null } });
		expect(git(worktree, "merge-base", "HEAD", "main").trim()).toBe(main);
		expect(git(worktree, "status", "--porcelain")).toBe("");
		expect(printed(result.session.id)).toContain("feat/login");
	}, 20000);
});
