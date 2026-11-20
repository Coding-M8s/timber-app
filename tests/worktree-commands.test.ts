import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { readBranches } from "../src/bun/git-engine";
import { listWorktrees } from "../src/bun/timber-ls";
import { createWorktreeCommands } from "../src/bun/worktree-commands";
import { type NewWorktreeRequest, type OpenWorktreeRequest, type TimberStatus, worktreeId } from "../src/shared/model";
import { newWorktreeArguments, openWorktreeArguments, worktreeSetupArguments } from "../src/shared/worktree-commands";
import { type StandInRun, git, realTimber, recordedResult, standInResultTimber } from "./support/timber";

const ready = (path: string): TimberStatus => ({ state: "ready", path, version: "0.1.1" });

/** How long to watch for a detached editor that should not start. */
const editorStartWait = 500;

/** Poll until `done` holds or the time runs out, and say whether it held. */
async function eventually(done: () => boolean, milliseconds = 5000): Promise<boolean> {
	const end = Date.now() + milliseconds;
	while (!done()) {
		if (Date.now() >= end) return false;
		await Bun.sleep(20);
	}
	return true;
}

describe("createWorktreeCommands, with a stand-in Timber", () => {
	let root: string;
	let repository: string;
	let temporary: string;
	let count = 0;

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-commands-")));
		repository = join(root, "my repo zażółć");
		mkdirSync(repository);
		temporary = join(root, "temporary");
		mkdirSync(temporary);
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	function commandsOn(run: StandInRun, options: { listed?: boolean; status?: TimberStatus } = {}) {
		const timber = standInResultTimber(root, `stand-in-${++count}`, run);
		const commands = createWorktreeCommands({
			timber: async () => options.status ?? ready(timber.path),
			findRepository: async () => null,
			isListed: async path => (options.listed ?? true) && path === repository,
			temporaryRoot: temporary,
		});
		return { commands, timber };
	}

	test("new: runs exactly the arguments the interface shows, in the repository", async () => {
		const request = { repository, name: "--weird name", base: "origin/develop" };
		const { commands, timber } = commandsOn({ result: recordedResult.succeeded });
		const result = await commands.create(request);
		expect(result).toMatchObject({ outcome: "succeeded", created: true, worktree: { path: "/work/sample-worktrees/feat-login", branch: "feat/login" } });
		const notes = timber.notes();
		expect(notes.arguments).toEqual(newWorktreeArguments(request, notes.resultFile!));
		expect(realpathSync(notes.cwd)).toBe(repository);
		expect(readdirSync(temporary)).toEqual([]);
	});

	test("open: runs exactly the arguments the interface shows, in the repository", async () => {
		const request = { repository, selector: "/work/sample-worktrees/feat-login" };
		const opened = JSON.stringify({ ...JSON.parse(recordedResult.succeeded), command: "open", materialized: false });
		const { commands, timber } = commandsOn({ result: opened });
		expect(await commands.open(request)).toMatchObject({ outcome: "succeeded", created: false, worktree: { path: request.selector } });
		const notes = timber.notes();
		expect(notes.arguments).toEqual(openWorktreeArguments(request, notes.resultFile!));
		expect(realpathSync(notes.cwd)).toBe(repository);
	});

	test("a record for another command is not a result", async () => {
		const { commands } = commandsOn({ result: recordedResult.succeeded });
		expect(await commands.open({ repository, selector: "feat/login" })).toMatchObject({ outcome: "failed", worktree: null, created: false });
	});

	test("exit code 0 without a result is a failure with what was printed", async () => {
		const { commands } = commandsOn({ result: null, stdout: "Created feat/login\n" });
		const result = await commands.create({ repository, name: "feat/login", base: null });
		expect(result).toMatchObject({
			outcome: "failed",
			worktree: null,
			created: false,
			failure: { command: "timber new --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/login", output: { text: "Created feat/login\n" } },
		});
	});

	test("a failure after creation says created, with the worktree and the hook's output untouched", async () => {
		const record = JSON.stringify({ ...JSON.parse(recordedResult.succeeded), outcome: "failed", exitCode: 1, diagnostic: "Setup post_create step 1 failed (exit code 7)." });
		const printed = '{"outcome":"succeeded"}\nCreated something else entirely\n';
		const { commands } = commandsOn({ result: record, stdout: printed, exitCode: 1 });
		const result = await commands.create({ repository, name: "feat/login", base: null });
		expect(result).toMatchObject({
			outcome: "failed",
			created: true,
			worktree: { path: "/work/sample-worktrees/feat-login", branch: "feat/login" },
			failure: { diagnostic: "Setup post_create step 1 failed (exit code 7).", output: { text: printed, truncated: false } },
		});
	});

	test("refuses a repository that is not in the list, and runs nothing", async () => {
		const { commands, timber } = commandsOn({ result: recordedResult.succeeded }, { listed: false });
		for (const result of [
			await commands.create({ repository, name: "feat/login", base: null }),
			await commands.open({ repository, selector: "feat/login" }),
			await commandsOn({ result: recordedResult.succeeded }).commands.create({ repository: root, name: "feat/login", base: null }),
		]) {
			expect(result).toMatchObject({ outcome: "failed", worktree: null, created: false, failure: { command: null, output: null } });
			expect(result.outcome === "failed" && result.failure.diagnostic).toContain("is not a repository in the app's list. Nothing was run.");
		}
		expect(() => timber.notes()).toThrow();
	});

	test("runs nothing while Timber is not ready", async () => {
		for (const status of [{ state: "not-found", override: null }, { state: "too-old", path: "/usr/bin/timber", found: "0.1.0", required: "0.1.1" }] as const) {
			const { commands, timber } = commandsOn({ result: recordedResult.succeeded }, { status });
			const result = await commands.create({ repository, name: "feat/login", base: null });
			expect(result).toMatchObject({ outcome: "failed", worktree: null, created: false, failure: { command: null, output: null } });
			expect(result.outcome === "failed" && result.failure.diagnostic).toContain("Nothing was run.");
			expect(() => timber.notes()).toThrow();
		}
	});

	test("a list that cannot be read is a failure, not an exception", async () => {
		const commands = createWorktreeCommands({
			timber: async () => ready("/nowhere/timber"),
			findRepository: async () => null,
			isListed: async () => {
				throw new Error("settings are unreadable");
			},
		});
		const result = await commands.create({ repository, name: "feat/login", base: null });
		expect(result.outcome === "failed" && result.failure.diagnostic).toBe("Could not start timber new: settings are unreadable. Nothing was run.");
	});

	test("a request that is not complete is refused before anything runs, whatever came over the bridge", async () => {
		const { commands, timber } = commandsOn({ result: recordedResult.succeeded });
		const incomplete = [
			await commands.open({ repository, selector: 7 } as unknown as OpenWorktreeRequest),
			await commands.open({ repository } as unknown as OpenWorktreeRequest),
			await commands.open({ selector: "feat/login" } as unknown as OpenWorktreeRequest),
			await commands.create({ repository, name: ["--base", "x"], base: null } as unknown as NewWorktreeRequest),
			await commands.create({ repository, name: "feat/login" } as unknown as NewWorktreeRequest),
		];
		for (const [index, result] of incomplete.entries()) {
			const command = index < 3 ? "open" : "new";
			expect(result).toEqual({
				outcome: "failed",
				failure: { command: null, diagnostic: `The request for timber ${command} is not complete. Nothing was run.`, output: null },
				worktree: null,
				created: false,
				setupSkipped: false,
			});
		}
		expect(() => timber.notes()).toThrow();
	});

	test("a workflow that is not a workflow name is refused before anything runs, and a name runs as shown", async () => {
		const { commands, timber } = commandsOn({ result: recordedResult.succeeded });
		for (const workflow of ["--setup", "", "Review", "a b", 7, null, ["review"]]) {
			const results = [
				await commands.create({ repository, name: "feat/login", base: null, workflow } as unknown as NewWorktreeRequest),
				await commands.open({ repository, selector: "feat/login", workflow } as unknown as OpenWorktreeRequest),
			];
			for (const result of results) expect(result.outcome === "failed" && result.failure.diagnostic).toMatch(/^The request for timber (new|open) is not complete\. Nothing was run\.$/);
		}
		expect(() => timber.notes()).toThrow();

		const request = { repository, name: "feat/login", base: null, workflow: "review" };
		await commands.create(request);
		const notes = timber.notes();
		expect(notes.arguments).toEqual(newWorktreeArguments(request, notes.resultFile!));
		expect(notes.arguments.slice(0, 3)).toEqual(["new", "--workflow", "review"]);
	});

	test("a selector that looks like an option, or has spaces around it, reaches Timber as one argument after the --", async () => {
		const opened = JSON.stringify({ ...JSON.parse(recordedResult.succeeded), command: "open", materialized: false });
		for (const selector of ["--setup", " feat/login ", "-"]) {
			const { commands, timber } = commandsOn({ result: opened });
			await commands.open({ repository, selector });
			expect(timber.notes().arguments.slice(-2)).toEqual(["--", selector]);
		}
	});

	test("commands in one repository run one after another, and other repositories do not wait", async () => {
		const order: string[] = [];
		let release!: () => void;
		const held = new Promise<void>(resolve => {
			release = resolve;
		});
		let asked = 0;
		const commands = createWorktreeCommands({
			timber: async () => ({ state: "not-found", override: null }),
			findRepository: async () => null,
			isListed: async path => {
				const turn = `${path === repository ? "same" : "other"}-${++asked}`;
				order.push(`start ${turn}`);
				if (asked === 1) await held;
				order.push(`end ${turn}`);
				return true;
			},
		});
		const first = commands.create({ repository, name: "one", base: null });
		const second = commands.open({ repository, selector: "two" });
		const elsewhere = commands.create({ repository: root, name: "three", base: null });
		await elsewhere;
		expect(order).toEqual(["start same-1", "start other-2", "end other-2"]);
		release();
		await Promise.all([first, second]);
		expect(order).toEqual(["start same-1", "start other-2", "end other-2", "end same-1", "start same-3", "end same-3"]);
	});

	test("what the command printed, and the result, are never logged", async () => {
		const spies = (["log", "info", "warn", "error", "debug"] as const).map(method => spyOn(console, method).mockImplementation(() => {}));
		try {
			await commandsOn({ result: recordedResult.failed, stdout: "TOKEN=private-value\n", stderr: "also private\n", exitCode: 1 }).commands.create({ repository, name: "x", base: null });
			await commandsOn({ result: null, stdout: "TOKEN=private-value\n" }).commands.open({ repository, selector: "x" });
			await commandsOn({ result: recordedResult.succeeded }, { listed: false }).commands.create({ repository, name: "x", base: null });
			for (const spy of spies) expect(spy).not.toHaveBeenCalled();
		} finally {
			for (const spy of spies) spy.mockRestore();
		}
	});
});

describe.skipIf(realTimber === null)("createWorktreeCommands, with the installed Timber on real repositories", () => {
	let work: string;
	let scratch: string;
	let environment: Record<string, string | undefined>;
	let made = 0;

	beforeAll(() => {
		work = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-commands-real-")));
		scratch = join(work, "temporary");
		mkdirSync(scratch);
		// A home of its own, so Timber's first-use marker and any user configuration stay out of this.
		const home = join(work, "home");
		mkdirSync(home);
		environment = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(home, ".local", "state"), GIT_CONFIG_GLOBAL: "", GIT_CONFIG_NOSYSTEM: "1" };
	});

	afterAll(() => {
		rmSync(work, { recursive: true, force: true });
	});

	/** A fresh repository in a folder of its own, with a `develop` branch one commit ahead of `main`. */
	function makeRepository(): string {
		const folder = join(work, `case-${++made}`);
		mkdirSync(folder);
		const primary = join(folder, "my sample");
		git(folder, "init", "--initial-branch=main", primary);
		writeFileSync(join(primary, "tracked.txt"), "one\n");
		git(primary, "add", "tracked.txt");
		git(primary, "commit", "-m", "Initial commit");
		git(primary, "switch", "-c", "develop");
		writeFileSync(join(primary, "tracked.txt"), "two\n");
		git(primary, "commit", "-am", "On develop");
		git(primary, "switch", "main");
		return primary;
	}

	const commandsFor = (...listed: string[]) => createWorktreeCommands({
		timber: async () => ready(realTimber!),
		findRepository: async () => null,
		isListed: async path => listed.includes(path),
		environment,
		temporaryRoot: scratch,
	});

	/** Run Timber as a terminal would: the same executable and environment, with arguments written out here. */
	function inTerminal(folder: string, ...timberArguments: string[]): { exitCode: number; output: string } {
		const result = Bun.spawnSync([realTimber!, ...timberArguments], { cwd: folder, env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
		return { exitCode: result.exitCode, output: result.stdout.toString() + result.stderr.toString() };
	}

	/** The linked worktrees Timber lists, by folder relative to the repository, with what makes them the same worktree elsewhere. */
	function listed(primary: string) {
		const { output } = inTerminal(primary, "ls", "--json");
		const record = JSON.parse(output) as { worktrees: { path: string; branch: string | null; isPrimary: boolean }[] };
		return record.worktrees.filter(worktree => !worktree.isPrimary).map(worktree => ({
			folder: relative(primary, worktree.path),
			branch: worktree.branch,
			startsAtDevelop: git(worktree.path, "rev-parse", "HEAD") === git(primary, "rev-parse", "develop"),
		}));
	}

	test("creates the same worktree and branch as the same command in a terminal", async () => {
		const byApp = makeRepository();
		const byHand = makeRepository();
		const name = "Fix the zażółć login";

		const result = await commandsFor(byApp).create({ repository: byApp, name, base: "develop" });
		// The command as the ticket writes it, typed out.
		const typed = inTerminal(byHand, "new", name, "--base", "develop", "--result-file", join(scratch, "by-hand.json"), "--no-editor", "--no-agent");
		rmSync(join(scratch, "by-hand.json"));
		expect(typed.exitCode).toBe(0);

		expect(result.outcome).toBe("succeeded");
		expect(listed(byApp)).toEqual(listed(byHand));
		expect(listed(byApp).length).toBe(1);
		expect(listed(byApp)[0]!.startsAtDevelop).toBe(true);
		if (result.outcome !== "succeeded") throw new Error("unreachable");
		expect(result.created).toBe(true);
		expect(relative(byApp, result.worktree.path)).toBe(listed(byApp)[0]!.folder);
		expect(result.worktree.branch).toBe(listed(byApp)[0]!.branch);
		expect(git(result.worktree.path, "branch", "--show-current").trim()).toBe(result.worktree.branch!);
		expect(readdirSync(scratch)).toEqual([]);
		expect(git(byApp, "status", "--porcelain")).toBe("");
	});

	test("refuses a repository that is not in the list, and creates nothing there", async () => {
		const primary = makeRepository();
		const before = git(primary, "worktree", "list", "--porcelain") + git(primary, "for-each-ref");
		const result = await commandsFor(makeRepository()).create({ repository: primary, name: "feat/unlisted", base: null });
		expect(result).toMatchObject({ outcome: "failed", worktree: null, created: false, failure: { command: null } });
		expect(git(primary, "worktree", "list", "--porcelain") + git(primary, "for-each-ref")).toBe(before);
	});

	test("a base that is ambiguous fails before creation with Timber's own guidance", async () => {
		const primary = makeRepository();
		for (const remote of ["one", "two"]) {
			const bare = join(primary, "..", `${remote}.git`);
			git(work, "init", "--bare", bare);
			git(primary, "remote", "add", remote, bare);
			git(primary, "push", remote, "main:shared");
		}
		git(primary, "fetch", "--all");
		const before = git(primary, "worktree", "list", "--porcelain") + git(primary, "for-each-ref");

		const result = await commandsFor(primary).create({ repository: primary, name: "feat/ambiguous", base: "shared" });
		expect(result).toMatchObject({
			outcome: "failed",
			worktree: null,
			created: false,
			failure: {
				command: "timber new --base shared --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/ambiguous",
				diagnostic: "Base branch shared is missing or ambiguous. Select an exact branch.",
			},
		});
		expect(git(primary, "worktree", "list", "--porcelain") + git(primary, "for-each-ref")).toBe(before);
	});

	test.skipIf(process.platform === "win32")("setup scripts never run during timber new, and Timber says it left them for the app", async () => {
		const primary = makeRepository();
		const commands = commandsFor(primary);
		writeFileSync(join(primary, ".timber.toml"), '[hooks]\npost_create = ["echo ran >> ../hook-runs; exit 7"]\n');

		const result = await commands.create({ repository: primary, name: "feat/needs-setup", base: null });
		expect(result).toMatchObject({ outcome: "succeeded", created: true, setupSkipped: true, worktree: { branch: "feat/needs-setup" } });
		if (result.outcome !== "succeeded") throw new Error("unreachable");
		// The worktree is there, so the list shows it, and the script did not run: the setup session runs it.
		expect(listed(primary).map(worktree => worktree.branch)).toEqual(["feat/needs-setup"]);
		expect(existsSync(join(result.worktree.path, "..", "hook-runs"))).toBe(false);
		expect(readdirSync(scratch)).toEqual([]);
	});

	test.skipIf(process.platform === "win32")("a workflow's post_create scripts wait for the setup session too, which runs them after the ordinary ones", async () => {
		const primary = makeRepository();
		const commands = commandsFor(primary);
		const log = join(primary, "..", "setup-order");
		const config = (workflowScript: string) => writeFileSync(join(primary, ".timber.toml"), [
			"[workflows.review]",
			'description = "Review a branch"',
			`post_create = [${JSON.stringify(workflowScript)}]`,
			"",
		].join("\n"));

		// Only the workflow has a setup script, and Timber still says it left setup for the app.
		config(`echo workflow >> ${JSON.stringify(log)}`);
		const picked = await commands.create({ repository: primary, name: "feat/review", base: null, workflow: "review" });
		expect(picked).toMatchObject({ outcome: "succeeded", created: true, setupSkipped: true, worktree: { branch: "feat/review" } });
		if (picked.outcome !== "succeeded") throw new Error("unreachable");
		expect(existsSync(log)).toBe(false);

		// The setup session's command, with the workflow passed again, runs the ordinary scripts and then the workflow's, and creates nothing.
		writeFileSync(join(primary, ".timber.toml"), [
			"[hooks]",
			`post_create = [${JSON.stringify(`echo ordinary >> ${JSON.stringify(log)}`)}]`,
			"[workflows.review]",
			'description = "Review a branch"',
			`post_create = [${JSON.stringify(`echo workflow >> ${JSON.stringify(log)}`)}]`,
			"",
		].join("\n"));
		const worktrees = git(primary, "worktree", "list", "--porcelain");
		expect(inTerminal(picked.worktree.path, ...worktreeSetupArguments(picked.worktree.path, "review")).exitCode).toBe(0);
		expect(readFileSync(log, "utf8")).toBe("ordinary\nworkflow\n");

		// Without the workflow, Timber runs only the ordinary scripts: it does not remember the workflow.
		rmSync(log);
		expect(inTerminal(picked.worktree.path, ...worktreeSetupArguments(picked.worktree.path)).exitCode).toBe(0);
		expect(readFileSync(log, "utf8")).toBe("ordinary\n");
		expect(git(primary, "worktree", "list", "--porcelain")).toBe(worktrees);
		expect(readdirSync(scratch)).toEqual([]);
	});

	test("a workflow that is not in the settings fails with Timber's message and creates nothing", async () => {
		const primary = makeRepository();
		writeFileSync(join(primary, ".timber.toml"), '[workflows.review]\ndescription = "Review a branch"\n');
		const before = git(primary, "worktree", "list", "--porcelain") + git(primary, "for-each-ref");
		// As if the workflow was listed, then taken out of the settings before the person pressed Create.
		writeFileSync(join(primary, ".timber.toml"), "");
		const result = await commandsFor(primary).create({ repository: primary, name: "feat/removed", base: null, workflow: "review" });
		expect(result).toMatchObject({
			outcome: "failed",
			worktree: null,
			created: false,
			failure: {
				command: "timber new --workflow review --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/removed",
				diagnostic: "Unknown workflow. Restore its definition or assign another configured workflow with --workflow <name>.",
			},
		});
		expect(git(primary, "worktree", "list", "--porcelain") + git(primary, "for-each-ref")).toBe(before);
		expect(readdirSync(scratch)).toEqual([]);
	});

	test("without setup scripts Timber leaves none for the app", async () => {
		const primary = makeRepository();
		const result = await commandsFor(primary).create({ repository: primary, name: "feat/no-hooks", base: null });
		expect(result).toMatchObject({ outcome: "succeeded", created: true, setupSkipped: false });
	});

	test.skipIf(process.platform === "win32")("an editor configured in Timber does not start", async () => {
		const primary = makeRepository();
		const marker = join(primary, "..", "editor-started");
		writeFileSync(join(primary, ".timber.toml"), `[editor]\ncommand = "touch"\nargs = [${JSON.stringify(marker)}]\nenabled = true\n`);

		const result = await commandsFor(primary).create({ repository: primary, name: "feat/quiet", base: null });
		expect(result.outcome).toBe("succeeded");
		// Timber starts an editor detached and returns once it has spawned, so give a late start time to show.
		await Bun.sleep(editorStartWait);
		expect(existsSync(marker)).toBe(false);

		// The same configuration does start the editor for a plain command, so the check above means something.
		expect(inTerminal(primary, "new", "feat/loud").exitCode).toBe(0);
		expect(await eventually(() => existsSync(marker))).toBe(true);
	});
});

describe.skipIf(realTimber === null)("timber open, with the installed Timber on a real repository", () => {
	let work: string;
	let primary: string;
	let outside: string;
	let scratch: string;
	let environment: Record<string, string | undefined>;
	let commands: ReturnType<typeof createWorktreeCommands>;

	/** Hooks are configured the way a person does it: `.timber.toml` in the primary checkout. */
	const setupHook = (script: string) => writeFileSync(join(primary, ".timber.toml"), `[hooks]\npost_create = [${JSON.stringify(script)}]\n`);
	const noHooks = () => rmSync(join(primary, ".timber.toml"), { force: true });

	/** Everything a command could change: refs, registered worktrees, and the files of the primary checkout. */
	const fingerprint = () => [
		git(primary, "for-each-ref"),
		git(primary, "worktree", "list", "--porcelain"),
		git(primary, "status", "--porcelain"),
		readdirSync(work).sort().join("\n"),
		existsSync(join(work, "my sample-worktrees")) ? readdirSync(join(work, "my sample-worktrees")).sort().join("\n") : "",
	].join("\n--\n");

	const open = (selector: string, repository = primary) => commands.open({ repository, selector });

	/** The identity `timber ls --json` gives the worktree at `path` right now. */
	async function listedId(path: string): Promise<string | undefined> {
		const listing = await listWorktrees(realTimber!, primary, environment);
		if (!listing.ok) throw new Error(listing.message);
		const listed = listing.worktrees.find(worktree => worktree.path === path);
		return listed && worktreeId(listing.repository.commonGitDir, listed);
	}

	beforeAll(() => {
		work = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-open-real-")));
		primary = join(work, "my sample");
		outside = join(work, "not listed");
		scratch = join(work, "temporary");
		mkdirSync(scratch);
		// A home of its own, so Timber's first-use marker and any user configuration stay out of this.
		const home = join(work, "home");
		mkdirSync(home);
		environment = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(home, ".local", "state"), GIT_CONFIG_GLOBAL: "", GIT_CONFIG_NOSYSTEM: "1" };

		git(work, "init", "--initial-branch=main", primary);
		writeFileSync(join(primary, "tracked.txt"), "one\n");
		git(primary, "add", "tracked.txt");
		git(primary, "commit", "-m", "Initial commit");
		for (const remote of ["origin", "fork"]) {
			git(work, "init", "--bare", join(work, `${remote}.git`));
			git(primary, "remote", "add", remote, join(work, `${remote}.git`));
		}
		git(primary, "push", "--set-upstream", "origin", "main");
		// Local branches without a worktree, one branch that only origin has, and one that both remotes have.
		for (const branch of ["feat/zażółć-login", "feat/reopened", "feat/with-setup"]) git(primary, "branch", branch, "main");
		git(primary, "push", "origin", "main:feat/remote-only", "main:twice");
		git(primary, "push", "fork", "main:twice");
		git(primary, "fetch", "--all");

		git(work, "init", "--initial-branch=main", outside);
		git(outside, "commit", "--allow-empty", "-m", "Initial commit");
		git(outside, "branch", "feat/elsewhere");

		commands = createWorktreeCommands({
			timber: async () => ready(realTimber!),
			findRepository: async () => null,
			isListed: async path => path === primary,
			environment,
			temporaryRoot: scratch,
		});
	});

	afterEach(() => {
		noHooks();
		expect(readdirSync(scratch)).toEqual([]);
	});

	afterAll(() => {
		rmSync(work, { recursive: true, force: true });
	});

	test("a branch with no worktree gets one, with the identity the list gives it", async () => {
		const result = await open("feat/zażółć-login");
		expect(result).toMatchObject({ outcome: "succeeded", created: true, worktree: { branch: "feat/zażółć-login" } });
		if (result.outcome !== "succeeded") return;
		expect(git(primary, "worktree", "list", "--porcelain")).toContain(`worktree ${result.worktree.path}\n`);
		expect(git(result.worktree.path, "branch", "--show-current").trim()).toBe("feat/zażółć-login");
		expect(result.worktree.id).toBe((await listedId(result.worktree.path))!);
	});

	test("a branch that already has a worktree returns it with created false, and nothing new exists", async () => {
		const first = await open("feat/reopened");
		expect(first).toMatchObject({ outcome: "succeeded", created: true });
		const before = fingerprint();
		const again = await open("feat/reopened");
		expect(again).toMatchObject({ outcome: "succeeded", created: false });
		expect(again.outcome === "succeeded" && again.worktree).toEqual(first.outcome === "succeeded" && first.worktree);
		expect(fingerprint()).toBe(before);
	});

	test("a remote-tracking branch from the list opens under the name the list gives it", async () => {
		const offered = await readBranches(primary);
		expect(offered).toContainEqual({ selector: "origin/feat/remote-only", kind: "remote" });
		const result = await open("origin/feat/remote-only");
		expect(result).toMatchObject({ outcome: "succeeded", created: true, worktree: { branch: "feat/remote-only" } });
		if (result.outcome !== "succeeded") return;
		expect(git(result.worktree.path, "rev-parse", "--abbrev-ref", "@{upstream}").trim()).toBe("origin/feat/remote-only");
	});

	test("setup scripts never run during timber open: Timber says it left them only when it created the worktree", async () => {
		setupHook("echo TOKEN=private-value >> setup.log; exit 7");
		const spies = (["log", "info", "warn", "error", "debug"] as const).map(method => spyOn(console, method).mockImplementation(() => {}));
		try {
			const created = await open("feat/with-setup");
			expect(created).toMatchObject({ outcome: "succeeded", created: true, setupSkipped: true });
			if (created.outcome !== "succeeded") return;
			expect(existsSync(join(created.worktree.path, "setup.log"))).toBe(false);

			// Opening it again, by its exact path, creates nothing and leaves nothing to set up.
			const before = fingerprint();
			expect(await open(created.worktree.path)).toEqual({ outcome: "succeeded", worktree: created.worktree, created: false, setupSkipped: false });
			expect(existsSync(join(created.worktree.path, "setup.log"))).toBe(false);
			expect(fingerprint()).toBe(before);
			for (const spy of spies) expect(spy).not.toHaveBeenCalled();
		} finally {
			for (const spy of spies) spy.mockRestore();
		}
	});

	test("an unknown selector fails with Timber's guidance and changes nothing", async () => {
		const before = fingerprint();
		const result = await open("no/such-branch");
		expect(result).toMatchObject({ outcome: "failed", worktree: null, created: false });
		expect(result.outcome === "failed" && result.failure.diagnostic).toBe('No existing branch or worktree matches "no/such-branch". Check the exact branch or absolute worktree path.');
		expect(result.outcome === "failed" && result.failure.command).toBe("timber open --no-setup --result-file <temporary file> --no-editor --no-agent -- no/such-branch");
		expect(fingerprint()).toBe(before);
	});

	test("an ambiguous selector fails with Timber's list of exact names and changes nothing", async () => {
		const before = fingerprint();
		const result = await open("twice");
		expect(result).toMatchObject({ outcome: "failed", worktree: null, created: false });
		const diagnostic = result.outcome === "failed" ? result.failure.diagnostic : "";
		expect(diagnostic).toContain('Input "twice" matches 2 targets.');
		expect(diagnostic).toContain("fork/twice");
		expect(diagnostic).toContain("origin/twice");
		expect(fingerprint()).toBe(before);
	});

	test("text that looks like an option is a selector to Timber, not an option", async () => {
		const before = fingerprint();
		for (const selector of ["--help", "--setup", "-w"]) {
			const result = await open(selector);
			expect(result.outcome === "failed" && result.failure.diagnostic).toBe(`No existing branch or worktree matches "${selector}". Check the exact branch or absolute worktree path.`);
		}
		expect(fingerprint()).toBe(before);
	});

	test("a repository that is not in the list is refused before Timber runs, and stays as it was", async () => {
		const state = () => [git(outside, "for-each-ref"), git(outside, "worktree", "list", "--porcelain"), readdirSync(work).sort().join("\n")].join("\n--\n");
		const before = state();
		const result = await open("feat/elsewhere", outside);
		expect(result).toMatchObject({ outcome: "failed", failure: { command: null, diagnostic: `${outside} is not a repository in the app's list. Nothing was run.` }, worktree: null });
		expect(state()).toBe(before);
	});
});
