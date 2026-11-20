import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRepositoryList } from "../src/bun/repository-list";
import { createRepositoryReader } from "../src/bun/repository-reader";
import { createWorktreeCommands } from "../src/bun/worktree-commands";
import type { Repository, TimberStatus } from "../src/shared/model";
import { rebaseResultArguments } from "../src/shared/timber-rebase";
import { satisfiesTimberVersion } from "../src/shared/timber-version";
import { type StandInRun, fingerprint, git, gitIdentity, isolatedEnvironment, makeRepository, readyAt, realTimber, recordedRebase, standInResultTimber } from "./support/timber";

const ready = readyAt("0.1.2");

describe("WorktreeCommands.rebase, with a stand-in Timber", () => {
	let root: string;
	let repository: string;
	let worktree: string;
	let temporary: string;
	let count = 0;

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-rebase-")));
		repository = join(root, "my repo");
		worktree = join(root, "my repo-worktrees", "feat");
		temporary = join(root, "temporary");
		for (const folder of [repository, worktree, temporary]) mkdirSync(folder, { recursive: true });
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	/** The recorded record, with the paths of these tests in place of `/work`. */
	const here = (text: string) => text.replaceAll("/work/sample-worktrees/feat", worktree).replaceAll("/work/sample", repository);

	/** The repository as the app's list would answer. */
	const listing = (paths: string[], change: Partial<Repository> = {}): Repository => ({
		path: repository, name: "my repo", available: true, failure: null, setup: "repository",
		worktrees: paths.map(path => ({
			id: path, path, canonicalPath: path, branch: "feat", head: null, primary: false, detached: false, locked: false, prunable: false,
			pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null,
		})),
		...change,
	});

	function commandsOn(run: StandInRun, options: { found?: Repository | null; status?: TimberStatus; listed?: boolean } = {}) {
		const timber = standInResultTimber(root, `stand-in-${++count}`, run);
		const commands = createWorktreeCommands({
			timber: async () => options.status ?? ready(timber.path),
			isListed: async path => (options.listed ?? true) && path === repository,
			findRepository: async () => options.found === undefined ? listing([worktree]) : options.found,
			temporaryRoot: temporary,
		});
		return { commands, timber, ran: () => existsSync(join(dirname(timber.path), "notes.json")) };
	}

	const request = { repository: "", worktree: "", onto: null as string | null };
	const ask = () => ({ ...request, repository, worktree });

	test("runs exactly the arguments the dialog shows, in the repository, and reads the record", async () => {
		const given = { ...ask(), onto: "refs/heads/main" };
		const { commands, timber } = commandsOn({ result: here(recordedRebase.rebased), exitCode: 0 });
		const result = await commands.rebase(given);
		expect(result).toMatchObject({ outcome: "rebased", base: "refs/heads/main", baseSaved: true });
		const notes = timber.notes();
		expect(notes.arguments).toEqual(rebaseResultArguments(given, notes.resultFile!));
		expect(realpathSync(notes.cwd)).toBe(repository);
		expect(readdirSync(temporary)).toEqual([]);
	});

	test("a worktree that is not a full path is not one Timber lists, so nothing runs", async () => {
		const { commands, timber } = commandsOn({ result: null, exitCode: 1 }, { found: listing(["-odd"]) });
		expect(await commands.rebase({ repository, worktree: "-odd", onto: null })).toMatchObject({ outcome: "failed", ran: false });
		expect(existsSync(join(dirname(timber.path), "notes.json"))).toBe(false);
	});

	test("an onto that starts with a dash is one argument after --base", async () => {
		const { commands, timber } = commandsOn({ result: here(recordedRebase.rebased), exitCode: 0 });
		await commands.rebase({ ...ask(), onto: "--weird" });
		const given = timber.notes().arguments;
		expect(given.slice(0, 3)).toEqual(["rebase", "--base", "--weird"]);
		expect(given.slice(-2)).toEqual(["--", worktree]);
	});

	test("conflicts: the files and the details come back, and nothing else is run", async () => {
		const { commands } = commandsOn({ result: here(recordedRebase.conflicts), exitCode: 1, stderr: "error: Rebase paused with conflicts.\n" });
		const result = await commands.rebase({ ...ask(), onto: "refs/heads/main" });
		expect(result).toMatchObject({ outcome: "conflicts", conflicts: ["a.txt", "my file.txt"], failure: { output: { text: "error: Rebase paused with conflicts.\n" } } });
	});

	test("refused and failed come back as Timber's records say", async () => {
		expect((await commandsOn({ result: here(recordedRebase.refused), exitCode: 1 }).commands.rebase(ask())).outcome).toBe("refused");
		expect(await commandsOn({ result: here(recordedRebase.failedHook), exitCode: 1 }).commands.rebase(ask())).toMatchObject({ outcome: "failed", ran: true });
	});

	test("an exit code that is not the record's is a failed run, whatever the record says", async () => {
		const result = await commandsOn({ result: here(recordedRebase.rebased), exitCode: 3 }).commands.rebase(ask());
		expect(result).toMatchObject({ outcome: "failed", ran: true });
	});

	test("no result is a failed run, and the stand-in did run", async () => {
		const on = commandsOn({ result: null, exitCode: 1 });
		expect(await on.commands.rebase(ask())).toMatchObject({ outcome: "failed", ran: true });
		expect(on.ran()).toBe(true);
	});

	/** Every refusal before running: nothing ran, and the message says so. */
	async function expectNotRun(on: ReturnType<typeof commandsOn>, given: unknown, message: RegExp | string) {
		const result = await on.commands.rebase(given as ReturnType<typeof ask>);
		expect(result).toMatchObject({ outcome: "failed", ran: false, failure: { command: null, output: null } });
		if (result.outcome === "failed") {
			expect(result.failure.diagnostic).toMatch(message);
			expect(result.failure.diagnostic.toLowerCase()).toContain("nothing was run");
		}
		expect(on.ran()).toBe(false);
	}

	test("a request that is not complete runs nothing", async () => {
		const on = commandsOn({ result: here(recordedRebase.rebased), exitCode: 0 });
		for (const given of [null, {}, { repository, worktree }, { repository, worktree, onto: "" }, { repository, worktree, onto: 5 }, { repository: 1, worktree, onto: null }, { repository, worktree: 2, onto: null }]) {
			await expectNotRun(on, given, "is not complete");
		}
	});

	test("a repository that is not in the list runs nothing", async () => {
		await expectNotRun(commandsOn({ result: null }, { found: null }), ask(), "is not a repository in this app's list");
	});

	test("a repository Git or Timber cannot read runs nothing", async () => {
		await expectNotRun(commandsOn({ result: null }, { found: listing([worktree], { available: false }) }), ask(), "Git cannot read");
		await expectNotRun(commandsOn({ result: null }, { found: listing([worktree], { failure: "Timber broke" }) }), ask(), /Timber could not list.*Timber broke/);
	});

	test("a worktree the list does not have runs nothing", async () => {
		await expectNotRun(commandsOn({ result: null }, { found: listing([]) }), ask(), "Timber lists no worktree at");
		await expectNotRun(commandsOn({ result: null }), { ...ask(), worktree: `${worktree}/` }, "Timber lists no worktree at");
	});

	test("a worktree whose folder is missing runs nothing", async () => {
		const gone = join(root, "gone");
		await expectNotRun(commandsOn({ result: null }, { found: listing([gone]) }), { ...ask(), worktree: gone }, "is missing");
	});

	test("a Timber that is not ready runs nothing", async () => {
		await expectNotRun(commandsOn({ result: null }, { status: { state: "not-found", override: null } }), ask(), /\.$/);
	});

	test("rebases in one repository run one after another", async () => {
		const order: string[] = [];
		let asked = 0;
		let release!: () => void;
		const held = new Promise<void>(resolve => {
			release = resolve;
		});
		const timber = standInResultTimber(root, `stand-in-${++count}`, { result: here(recordedRebase.rebased), exitCode: 0 });
		const commands = createWorktreeCommands({
			timber: async () => ready(timber.path),
			isListed: async () => true,
			findRepository: async () => {
				const turn = ++asked;
				order.push(`start ${turn}`);
				if (turn === 1) await held;
				order.push(`end ${turn}`);
				return listing([worktree]);
			},
			temporaryRoot: temporary,
		});
		const first = commands.rebase(ask());
		const second = commands.rebase(ask());
		await Bun.sleep(30);
		expect(order).toEqual(["start 1"]);
		release();
		await Promise.all([first, second]);
		expect(order).toEqual(["start 1", "end 1", "start 2", "end 2"]);
	});
});

const recentTimber = realTimber !== null && satisfiesTimberVersion(Bun.spawnSync([realTimber, "--version"]).stdout.toString().trim().split(/\s+/).at(-1) ?? "", "0.1.2");

describe.skipIf(!recentTimber)("WorktreeCommands.rebase, with the installed Timber", () => {
	let work: string;
	let primary: string;
	let feat: string;
	let scratch: string;
	let environment: Record<string, string | undefined>;
	let commands: ReturnType<typeof createWorktreeCommands>;
	let count = 0;

	beforeAll(async () => {
		work = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-rebase-real-")));
		primary = join(work, "my sample");
		scratch = join(work, "temporary");
		mkdirSync(scratch);
		// Git rewrites commits during a rebase, so it needs a committer. With no global config it would guess one from the
		// host name, which fails on a machine whose name has no domain, so the identity is given here as the `git` helper gives it.
		environment = { ...isolatedEnvironment(work), ...gitIdentity };
		makeRepository(work, "my sample", { "shared.txt": "one\n" });

		const timber = async (): Promise<TimberStatus> => ready(realTimber!);
		const list = createRepositoryList({
			settingsFile: join(work, "config", "timber-app", "settings.json"),
			pickFolder: async () => null,
			reader: createRepositoryReader(timber, environment),
			environment: {},
			warn: () => {},
		});
		expect((await list.addFolder(primary)).outcome).toBe("added");
		commands = createWorktreeCommands({ timber, isListed: path => list.includes(path), findRepository: path => list.find(path), environment, temporaryRoot: scratch });
	});

	afterAll(() => {
		rmSync(work, { recursive: true, force: true });
	});

	/** A new linked worktree on its own branch, with one commit that changes shared.txt, and main with another. */
	function conflicting(): string {
		const branch = `feat-${++count}`;
		feat = join(work, "trees", branch);
		git(primary, "worktree", "add", "-b", branch, feat);
		writeFileSync(join(feat, "shared.txt"), `${branch}\n`);
		git(feat, "commit", "-am", "On the branch");
		writeFileSync(join(primary, "shared.txt"), `main ${count}\n`);
		git(primary, "commit", "-am", `Main ${count}`);
		return feat;
	}

	test("conflicts leave Git's paused rebase exactly as it is, and the app runs no Git command", async () => {
		const path = conflicting();
		const result = await commands.rebase({ repository: primary, worktree: path, onto: "refs/heads/main" });
		expect(result).toMatchObject({ outcome: "conflicts", base: "refs/heads/main", conflicts: ["shared.txt"] });

		const gitDir = git(path, "rev-parse", "--absolute-git-dir").trim();
		expect(existsSync(join(gitDir, "rebase-merge"))).toBe(true);
		expect(git(path, "status", "--porcelain")).toContain("UU shared.txt");
		expect(readFileSync(join(path, "shared.txt"), "utf8")).toContain("<<<<<<<");
		// Asking again while it is paused is refused by Timber, which owns that rule, and still leaves the pause in place.
		const again = await commands.rebase({ repository: primary, worktree: path, onto: "refs/heads/main" });
		expect(again.outcome === "refused" || again.outcome === "failed").toBe(true);
		expect(existsSync(join(gitDir, "rebase-merge"))).toBe(true);
		expect(readdirSync(scratch)).toEqual([]);
	});

	test("a refusal changes nothing", async () => {
		const path = conflicting();
		writeFileSync(join(path, "untracked.txt"), "mine\n");
		const before = fingerprint(path) + fingerprint(primary);
		const result = await commands.rebase({ repository: primary, worktree: path, onto: "refs/heads/main" });
		expect(result).toMatchObject({ outcome: "refused", failure: { diagnostic: expect.stringContaining("clean") } });
		expect(fingerprint(path) + fingerprint(primary)).toBe(before);
		expect(readdirSync(scratch)).toEqual([]);
	});

	test("a branch that is behind is rebased, and one that is current is up to date", async () => {
		const branch = `feat-${++count}`;
		const path = join(work, "trees", branch);
		git(primary, "worktree", "add", "-b", branch, path);
		writeFileSync(join(path, "own.txt"), "own\n");
		git(path, "add", "own.txt");
		git(path, "commit", "-m", "Own");
		writeFileSync(join(primary, "other.txt"), "other\n");
		git(primary, "add", "other.txt");
		git(primary, "commit", "-m", "Other");
		const rebased = await commands.rebase({ repository: primary, worktree: path, onto: "refs/heads/main" });
		expect(rebased).toMatchObject({ outcome: "rebased", base: "refs/heads/main", baseSaved: true });
		expect(git(path, "rev-parse", "HEAD~1")).toBe(git(primary, "rev-parse", "main"));
		expect(await commands.rebase({ repository: primary, worktree: path, onto: "refs/heads/main" })).toMatchObject({ outcome: "up-to-date" });
	});
});
