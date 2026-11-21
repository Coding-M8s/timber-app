import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createRepositoryList } from "../src/bun/repository-list";
import { createRepositoryReader } from "../src/bun/repository-reader";
import { createWorktreeCommands } from "../src/bun/worktree-commands";
import type { Repository, TimberStatus } from "../src/shared/model";
import { type CreatePullRequestRequest, prResultArguments } from "../src/shared/timber-pr";
import { satisfiesTimberVersion } from "../src/shared/timber-version";
import { type StandInRun, REAL_TIMBER_TIMEOUT_MS, fingerprint, git, gitIdentity, isolatedEnvironment, makeRepository, readyAt, realTimber, recordedHere, recordedPr, standInResultTimber } from "./support/timber";

setDefaultTimeout(REAL_TIMBER_TIMEOUT_MS);

const ready = readyAt("0.1.3");

describe("WorktreeCommands.pullRequest, with a stand-in Timber", () => {
	let root: string;
	let repository: string;
	let worktree: string;
	let temporary: string;
	let count = 0;

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-pr-")));
		repository = join(root, "my repo");
		worktree = join(root, "my repo-worktrees", "feat");
		temporary = join(root, "temporary");
		for (const folder of [repository, worktree, temporary]) mkdirSync(folder, { recursive: true });
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const here = (text: string) => recordedHere(text, [["/work/sample-worktrees/feat", worktree], ["/work/sample", repository]], { json: true });

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

	const ask = (change: Partial<CreatePullRequestRequest> = {}): CreatePullRequestRequest =>
		({ repository, worktree, title: "Add login", body: "", base: null, draft: false, reviewers: [], ...change });

	test("runs exactly the arguments the form shows, in the repository, and reads the record", async () => {
		const given = ask({ body: "- first\n- second", base: "origin/main", draft: true, title: "-dash first", reviewers: ["alice", "-team", "example/core"] });
		const { commands, timber } = commandsOn({ result: here(recordedPr.created), exitCode: 0 });
		expect(await commands.pullRequest(given)).toEqual({ outcome: "created", number: 7, url: "https://github.com/example/sample/pull/7", base: "main", published: true, reviewers: [] });
		const notes = timber.notes();
		expect(notes.arguments).toEqual(prResultArguments(given, notes.resultFile!));
		expect(realpathSync(notes.cwd)).toBe(repository);
		expect(readdirSync(temporary)).toEqual([]);
	});

	test("exists, refused, and failed come back as Timber's records say", async () => {
		expect(await commandsOn({ result: here(recordedPr.exists), exitCode: 0 }).commands.pullRequest(ask())).toMatchObject({ outcome: "exists", number: 5 });
		expect(await commandsOn({ result: here(recordedPr.refusedNotGithub), exitCode: 1 }).commands.pullRequest(ask())).toMatchObject({ outcome: "refused" });
		expect(await commandsOn({ result: here(recordedPr.failedAfterPush), exitCode: 1 }).commands.pullRequest(ask())).toMatchObject({ outcome: "failed", ran: true, published: true });
	});

	test("no result is a failure whose effect is unknown, and the stand-in did run", async () => {
		const on = commandsOn({ result: null, exitCode: 1, stderr: "error: boom\n" });
		expect(await on.commands.pullRequest(ask())).toMatchObject({ outcome: "failed", ran: true, published: null });
		expect(on.ran()).toBe(true);
	});

	async function expectNotRun(on: ReturnType<typeof commandsOn>, given: unknown, message: string | RegExp) {
		const result = await on.commands.pullRequest(given as CreatePullRequestRequest);
		expect(result).toMatchObject({ outcome: "failed", ran: false, published: false, failure: { command: null, output: null } });
		if (result.outcome === "failed") {
			expect(result.failure.diagnostic).toMatch(message);
			expect(result.failure.diagnostic).toContain("Nothing was run.");
		}
		expect(on.ran()).toBe(false);
	}

	test("a request that is not complete runs nothing", async () => {
		const on = commandsOn({ result: here(recordedPr.created), exitCode: 0 });
		const full = ask();
		for (const given of [null, {}, { ...full, title: undefined }, { ...full, title: 3 }, { ...full, body: null }, { ...full, base: "" }, { ...full, base: 5 }, { ...full, draft: "yes" }, { ...full, worktree: 2 },
			{ ...full, reviewers: undefined }, { ...full, reviewers: "alice" }, { ...full, reviewers: ["alice", 3] }, { ...full, reviewers: [""] }]) {
			await expectNotRun(on, given, "is not complete");
		}
	});

	test("a repository or worktree that is not listed, or a Timber that is not ready, runs nothing", async () => {
		await expectNotRun(commandsOn({ result: null }, { found: null }), ask(), "is not a repository in this app's list");
		await expectNotRun(commandsOn({ result: null }, { found: listing([]) }), ask(), "Timber lists no worktree at");
		await expectNotRun(commandsOn({ result: null }, { found: listing([join(root, "gone")]) }), ask({ worktree: join(root, "gone") }), "is missing");
		await expectNotRun(commandsOn({ result: null }, { status: { state: "not-found", override: null } }), ask(), /\.$/);
	});

	test("runs in the same turn as the other commands of the repository", async () => {
		let release!: () => void;
		const gate = new Promise<void>(resolve => (release = resolve));
		const order: string[] = [];
		const timber = standInResultTimber(root, `stand-in-${++count}`, { result: here(recordedPr.created), exitCode: 0 });
		const commands = createWorktreeCommands({
			timber: async () => ready(timber.path),
			isListed: async () => true,
			findRepository: async () => {
				order.push("look");
				await gate;
				return listing([worktree]);
			},
			temporaryRoot: temporary,
		});
		const first = commands.pullRequest(ask());
		const second = commands.rebase({ repository, worktree, onto: null });
		await Bun.sleep(30);
		expect(order).toEqual(["look"]);
		release();
		await Promise.all([first, second]);
		expect(order).toEqual(["look", "look"]);
	});
});

const recentTimber = realTimber !== null && satisfiesTimberVersion(Bun.spawnSync([realTimber, "--version"]).stdout.toString().trim().split(/\s+/).at(-1) ?? "", "0.1.3");
// The pr record has `reviewers` from the first Timber with `timber pr --reviewer` (Coding-M8s/timber#174), which its help lists.
const reviewerTimber = recentTimber && Bun.spawnSync([realTimber!, "pr", "--help"]).stdout.toString().includes("--reviewer");

describe.skipIf(!recentTimber)("WorktreeCommands.pullRequest and headSubject, with the installed Timber and Git", () => {
	let work: string;
	let primary: string;
	let remote: string;
	let feat: string;
	let scratch: string;
	let commands: ReturnType<typeof createWorktreeCommands>;

	beforeAll(async () => {
		work = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-pr-real-")));
		primary = join(work, "my sample");
		remote = join(work, "remote.git");
		feat = join(work, "trees", "feat");
		scratch = join(work, "temporary");
		mkdirSync(scratch);
		// No login and no user configuration, so nothing here can reach GitHub with the developer's account.
		const environment = { ...isolatedEnvironment(work), GH_TOKEN: "", GITHUB_TOKEN: "", GH_CONFIG_DIR: join(work, "home", "gh"), ...gitIdentity };
		git(work, "init", "--bare", "--initial-branch=main", remote);
		makeRepository(work, "my sample", { "a.txt": "one\n" });
		// A remote on disk, which is not on github.com, so Timber refuses before it reads a login or pushes.
		git(primary, "remote", "add", "origin", remote);
		git(primary, "push", "origin", "main");
		git(primary, "fetch", "origin");
		git(primary, "worktree", "add", "-b", "feat", feat);
		writeFileSync(join(feat, "b.txt"), "two\n");
		git(feat, "add", "b.txt");
		git(feat, "commit", "-m", "Add the login form", "-m", "With a body that is not the subject.");

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

	test("a refusal pushes nothing and changes no file or ref, here or on the remote", async () => {
		const before = fingerprint(feat) + fingerprint(primary) + fingerprint(remote);
		const asked = { repository: primary, worktree: feat, title: "Add the login form", body: "", base: "origin/main", draft: false, reviewers: [] };
		const result = await commands.pullRequest(asked);
		const missingTitle = await commands.pullRequest({ ...asked, title: "" });
		// Before Timber writes `reviewers`, its record is one this app cannot read, so only what changed is checked.
		if (reviewerTimber) {
			expect(result).toMatchObject({ outcome: "refused", failure: { diagnostic: expect.stringContaining("github.com") } });
			expect(missingTitle).toMatchObject({ outcome: "refused", failure: { diagnostic: expect.stringContaining("title") } });
			// A reviewer Timber cannot take, and one that starts with a dash, which stays a value: refused before the login or the push.
			for (const reviewers of [["not/a/team"], ["-alice"]]) {
				expect(await commands.pullRequest({ ...asked, reviewers })).toMatchObject({ outcome: "refused", failure: { diagnostic: expect.stringContaining("--reviewer must be a GitHub user login or org/team") } });
			}
			// A valid reviewer on a remote that is not on github.com: refused as before.
			expect(await commands.pullRequest({ ...asked, reviewers: ["alice", "example/core"] })).toMatchObject({ outcome: "refused" });
		}
		expect(fingerprint(feat) + fingerprint(primary) + fingerprint(remote)).toBe(before);
		expect(git(remote, "for-each-ref", "--format=%(refname)").trim()).toBe("refs/heads/main");
		expect(readdirSync(scratch)).toEqual([]);
	});

	test("the head subject is the last commit's first line, and reading it changes nothing", async () => {
		const before = fingerprint(feat) + fingerprint(primary);
		expect(await commands.headSubject({ repository: primary, worktree: feat })).toBe("Add the login form");
		expect(await commands.headSubject({ repository: primary, worktree: primary })).toBe("Initial commit");
		expect(fingerprint(feat) + fingerprint(primary)).toBe(before);
	});

	test("the head subject is null for a worktree or repository that is not listed", async () => {
		expect(await commands.headSubject({ repository: primary, worktree: join(work, "trees", "other") })).toBeNull();
		expect(await commands.headSubject({ repository: work, worktree: feat })).toBeNull();
		expect(await commands.headSubject({ repository: primary, worktree: "relative" })).toBeNull();
		expect(await commands.headSubject(null as never)).toBeNull();
	});
});
