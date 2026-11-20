import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type TerminalSessions, createTerminalSessions } from "../src/bun/terminals";
import type { Repository, TimberStatus } from "../src/shared/model";
import { type OpenTerminalRequest, type TerminalChange, type TerminalOutput, WORKTREE_SETUP_SESSION_NAME } from "../src/shared/terminal";
import { describeCommandLine } from "../src/shared/command-line";
import { until } from "./support/runtime";
import { REAL_TIMBER_TIMEOUT_MS, git, readyAt, realTimber } from "./support/timber";

setDefaultTimeout(REAL_TIMBER_TIMEOUT_MS);

const posix = process.platform !== "win32";

const gitEnvironment = {
	...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid",
};

// Pseudo terminals exist on Linux and macOS only.
describe.skipIf(!posix)("a worktree's setup in a terminal session", () => {
	let root: string;
	let repository: string;
	let worktree: string;
	let standIn: string;
	let record: string;
	let sessions: TerminalSessions;
	let outputs: TerminalOutput[];
	let changes: TerminalChange[];

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-setup-session-")));
		repository = join(root, "my repo");
		// A path that starts with a dash after its folder, so it must stay one argument after --.
		worktree = join(root, "my repo-worktrees", "-feat login");
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
		writeFileSync(standIn, `#!/bin/sh\npwd > "${record}"\nfor a in "$@"; do printf '%s\\n' "$a" >> "${record}"; done\necho "stand-in setup printed this"\nexit 3\n`);
		chmodSync(standIn, 0o755);
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	afterEach(() => {
		sessions?.killAll();
		rmSync(record, { force: true });
		rmSync(join(repository, ".timber.toml"), { force: true });
	});

	const listed = (): Repository => ({
		path: repository, name: "my repo", available: true, failure: null,
		setup: "repository",
		worktrees: [repository, worktree].map((path, index) => ({
			id: `id:${path}`, path, canonicalPath: path, branch: index === 0 ? "main" : "feat/login", head: null, primary: index === 0, detached: false,
			locked: false, prunable: false, pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null,
		})),
	});

	function setUp(status: TimberStatus, home = root) {
		outputs = [];
		changes = [];
		sessions = createTerminalSessions({
			findRepository: async path => path === repository ? listed() : null,
			onOutput: output => outputs.push(output),
			onChange: change => changes.push(change),
			timber: async () => status,
			environment: { ...gitEnvironment, HOME: home, XDG_CONFIG_HOME: join(home, ".config"), SHELL: "/bin/sh", PS1: "$ ", LANG: "C.UTF-8" },
			closeMilliseconds: 500,
		});
		return (request: Omit<OpenTerminalRequest, "timberWorktreeSetup">, workflow?: string) =>
			sessions.open({ ...request, timberWorktreeSetup: workflow === undefined ? {} : { workflow } });
	}

	const ready = readyAt("0.1.3");
	const printed = (id: string) => outputs.filter(output => output.id === id).map(output => output.data).join("");
	const exited = (id: string) => changes.find(change => change.id === id && change.session?.state.kind === "exited")?.session ?? null;

	test("the command shown is the command that runs, in the worktree's folder, with its exact path after --", async () => {
		const start = setUp(ready(standIn));
		const result = await start({ repository, worktree, cols: 80, rows: 24 });
		if (result.outcome !== "opened") throw new Error(JSON.stringify(result));
		const { session } = result;
		expect(session).toMatchObject({ kind: "timber", name: WORKTREE_SETUP_SESSION_NAME, repository, worktree: `id:${worktree}`, path: worktree, shell: standIn, state: { kind: "running" } });
		expect(session.command).toBe(describeCommandLine([standIn, "open", "--setup", "--no-editor", "--no-agent", "--", worktree]));
		expect(await until(() => exited(session.id) !== null)).toBe(true);
		expect(exited(session.id)!.state).toEqual({ kind: "exited", exitCode: 3, signal: null });
		expect(printed(session.id)).toContain("stand-in setup printed this");
		expect(readFileSync(record, "utf8")).toBe(`${worktree}\nopen\n--setup\n--no-editor\n--no-agent\n--\n${worktree}\n`);
	});

	test("a workflow goes in as the value of --workflow, before the --, as Timber does not remember it", async () => {
		const start = setUp(ready(standIn));
		const result = await start({ repository, worktree, cols: 80, rows: 24 }, "review");
		if (result.outcome !== "opened") throw new Error(JSON.stringify(result));
		expect(result.session.command).toBe(describeCommandLine([standIn, "open", "--setup", "--workflow", "review", "--no-editor", "--no-agent", "--", worktree]));
		expect(await until(() => exited(result.session.id) !== null)).toBe(true);
		expect(readFileSync(record, "utf8")).toBe(`${worktree}\nopen\n--setup\n--workflow\nreview\n--no-editor\n--no-agent\n--\n${worktree}\n`);
	});

	test("starts beside the worktree's other sessions, so an agent can run while setup does", async () => {
		const start = setUp(ready(standIn));
		expect((await sessions.open({ repository, worktree, cols: 80, rows: 24 })).outcome).toBe("opened");
		expect((await start({ repository, worktree, cols: 80, rows: 24 })).outcome).toBe("opened");
		expect(sessions.list().map(session => session.kind).sort()).toEqual(["terminal", "timber"]);
	});

	test("nothing runs while Timber is not ready, for a worktree Timber does not list, or for a request of the wrong shape", async () => {
		let start = setUp({ state: "not-found", override: null });
		expect((await start({ repository, worktree, cols: 80, rows: 24 })).outcome).toBe("not-configured");
		start = setUp(ready(standIn));
		expect((await start({ repository, worktree: join(root, "elsewhere"), cols: 80, rows: 24 })).outcome).toBe("not-listed");
		const wrong = [
			{ timberWorktreeSetup: "yes" },
			{ timberWorktreeSetup: true },
			{ timberWorktreeSetup: null },
			// A workflow is only ever a workflow name, so it can never read as an option.
			{ timberWorktreeSetup: { workflow: "--setup" } },
			{ timberWorktreeSetup: { workflow: "Review" } },
			{ timberWorktreeSetup: { workflow: 7 } },
			{ timberWorktreeSetup: {}, agent: "Claude Code" },
		];
		for (const extra of wrong) {
			const result = await sessions.open({ repository, worktree, cols: 80, rows: 24, ...extra } as unknown as OpenTerminalRequest);
			// An agent that is not saved is refused as not configured; anything else as unreadable.
			expect(["failed", "not-configured"]).toContain(result.outcome);
		}
		await Bun.sleep(100);
		expect(existsSync(record)).toBe(false);
		expect(sessions.list()).toEqual([]);
	});

	test.skipIf(realTimber === null)("the installed Timber runs the setup scripts in the worktree, in the session, and the exit shows how they went", async () => {
		const home = join(root, "home");
		mkdirSync(home, { recursive: true });
		writeFileSync(join(repository, ".timber.toml"), '[hooks]\npost_create = ["echo setting up; pwd > setup-ran"]\n');
		const start = setUp(ready(realTimber!), home);
		const result = await start({ repository, worktree, cols: 100, rows: 30 });
		if (result.outcome !== "opened") throw new Error(JSON.stringify(result));
		expect(await until(() => exited(result.session.id) !== null, 15000)).toBe(true);
		expect(exited(result.session.id)!.state).toEqual({ kind: "exited", exitCode: 0, signal: null });
		expect(printed(result.session.id)).toContain("setting up");
		expect(readFileSync(join(worktree, "setup-ran"), "utf8")).toBe(`${worktree}\n`);
		rmSync(join(worktree, "setup-ran"));

		// A script that fails ends the session with Timber's exit code, and the worktree stays.
		writeFileSync(join(repository, ".timber.toml"), '[hooks]\npost_create = ["exit 7"]\n');
		const failing = await start({ repository, worktree, cols: 100, rows: 30 });
		if (failing.outcome !== "opened") throw new Error(JSON.stringify(failing));
		expect(await until(() => exited(failing.session.id) !== null, 15000)).toBe(true);
		expect(exited(failing.session.id)!.state).toMatchObject({ kind: "exited", exitCode: 1 });
		expect(printed(failing.session.id)).toContain("post_create step 1 failed");
		expect(existsSync(worktree)).toBe(true);
	}, 30000);
});
