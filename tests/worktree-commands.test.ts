import { afterAll, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createWorktreeCommands } from "../src/bun/worktree-commands";
import type { TimberStatus } from "../src/shared/model";
import { newWorktreeArguments, openWorktreeArguments } from "../src/shared/worktree-commands";
import { type StandInRun, git, realTimber, recordedResult, standInResultTimber } from "./support/timber";

const ready = (path: string): TimberStatus => ({ state: "ready", path, version: "0.1.1" });

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
		const request = { repository, selector: "/work/sample-worktrees/feat-login", setup: true };
		const opened = JSON.stringify({ ...JSON.parse(recordedResult.succeeded), command: "open", materialized: false });
		const { commands, timber } = commandsOn({ result: opened });
		expect(await commands.open(request)).toMatchObject({ outcome: "succeeded", created: false, worktree: { path: request.selector } });
		const notes = timber.notes();
		expect(notes.arguments).toEqual(openWorktreeArguments(request, notes.resultFile!));
		expect(realpathSync(notes.cwd)).toBe(repository);
	});

	test("a record for another command is not a result", async () => {
		const { commands } = commandsOn({ result: recordedResult.succeeded });
		expect(await commands.open({ repository, selector: "feat/login", setup: false })).toMatchObject({ outcome: "failed", worktree: null, created: false });
	});

	test("exit code 0 without a result is a failure with what was printed", async () => {
		const { commands } = commandsOn({ result: null, stdout: "Created feat/login\n" });
		const result = await commands.create({ repository, name: "feat/login", base: null });
		expect(result).toMatchObject({
			outcome: "failed",
			worktree: null,
			created: false,
			failure: { command: "timber new --result-file <temporary file> --no-editor --no-agent -- feat/login", output: { text: "Created feat/login\n" } },
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
			await commands.open({ repository, selector: "feat/login", setup: true }),
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
			isListed: async () => {
				throw new Error("settings are unreadable");
			},
		});
		const result = await commands.create({ repository, name: "feat/login", base: null });
		expect(result.outcome === "failed" && result.failure.diagnostic).toBe("Could not start timber new: settings are unreadable. Nothing was run.");
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
			isListed: async path => {
				const turn = `${path === repository ? "same" : "other"}-${++asked}`;
				order.push(`start ${turn}`);
				if (asked === 1) await held;
				order.push(`end ${turn}`);
				return true;
			},
		});
		const first = commands.create({ repository, name: "one", base: null });
		const second = commands.open({ repository, selector: "two", setup: false });
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
			await commandsOn({ result: null, stdout: "TOKEN=private-value\n" }).commands.open({ repository, selector: "x", setup: true });
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
				command: "timber new --base shared --result-file <temporary file> --no-editor --no-agent -- feat/ambiguous",
				diagnostic: "Base branch shared is missing or ambiguous. Select an exact branch.",
			},
		});
		expect(git(primary, "worktree", "list", "--porcelain") + git(primary, "for-each-ref")).toBe(before);
	});

	test.skipIf(process.platform === "win32")("a setup script that fails after creation gives created plus failed, and Open with setup runs it again", async () => {
		const primary = makeRepository();
		const commands = commandsFor(primary);
		const config = join(primary, ".timber.toml");
		writeFileSync(config, '[hooks]\npost_create = ["echo from the hook; echo outcome succeeded >&2; echo ran >> ../hook-runs; exit 7"]\n');

		const result = await commands.create({ repository: primary, name: "feat/needs-setup", base: null });
		expect(result).toMatchObject({ outcome: "failed", created: true, worktree: { branch: "feat/needs-setup" } });
		if (result.outcome !== "failed" || !result.worktree) throw new Error("unreachable");
		expect(result.failure.diagnostic).toContain("Setup post_create step 1 failed (exit code 7)");
		// The hook's output is kept for the details area, whatever it says.
		expect(result.failure.output?.text).toContain("from the hook\n");
		expect(result.failure.output?.text).toContain("outcome succeeded\n");
		// The worktree is there, so the list shows it.
		expect(listed(primary).map(worktree => worktree.branch)).toEqual(["feat/needs-setup"]);
		// The script ran in the new worktree.
		expect(existsSync(join(result.worktree.path, "..", "hook-runs"))).toBe(true);

		// Still failing: the worktree is reported again, and nothing new was created.
		const setup = { repository: primary, selector: result.worktree.path, setup: true };
		const again = await commands.open(setup);
		expect(again).toMatchObject({ outcome: "failed", created: false, worktree: { id: result.worktree.id, path: result.worktree.path } });
		expect(again.outcome === "failed" && again.failure.command).toBe(`timber open --setup --result-file <temporary file> --no-editor --no-agent -- '${result.worktree.path}'`);

		// Once the script works, the same command finishes setup in the same worktree.
		writeFileSync(config, '[hooks]\npost_create = ["echo fixed > setup-done"]\n');
		expect(await commands.open(setup)).toEqual({ outcome: "succeeded", worktree: result.worktree, created: false });
		expect(existsSync(join(result.worktree.path, "setup-done"))).toBe(true);
		expect(listed(primary).length).toBe(1);
		expect(readdirSync(scratch)).toEqual([]);
	});

	test.skipIf(process.platform === "win32")("an editor configured in Timber does not start", async () => {
		const primary = makeRepository();
		const marker = join(primary, "..", "editor-started");
		writeFileSync(join(primary, ".timber.toml"), `[editor]\ncommand = "touch"\nargs = [${JSON.stringify(marker)}]\nenabled = true\n`);

		const result = await commandsFor(primary).create({ repository: primary, name: "feat/quiet", base: null });
		expect(result.outcome).toBe("succeeded");
		expect(existsSync(marker)).toBe(false);

		// The same configuration does start the editor for a plain command, so the check above means something.
		expect(inTerminal(primary, "new", "feat/loud").exitCode).toBe(0);
		expect(existsSync(marker)).toBe(true);
	});
});
