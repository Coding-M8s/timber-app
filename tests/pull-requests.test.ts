import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPullRequestReader, readPullRequests } from "../src/bun/pull-requests";
import { createMockEngine, sampleRepositories, sampleTimberStatuses } from "../src/mainview/engine/mock";
import { REAL_TIMBER_TIMEOUT_MS, fingerprint, git, readyAt, realTimber, standIn } from "./support/timber";

setDefaultTimeout(REAL_TIMBER_TIMEOUT_MS);

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "timber-app-pr", name), "utf8");
const SECRET = "ghp_SuperSecretToken123";

let root: string;
let folder: string;

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-pull-requests-")));
	// The working directory has a space and non-ASCII characters in it.
	folder = join(root, "my repo zażółć");
	mkdirSync(folder);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

const ready = readyAt("0.1.2");

describe("readPullRequests with a stand-in Timber", () => {
	test("runs timber __app-pr in the repository folder, with standard input closed, and reads the record", async () => {
		const timber = standIn(root, "found", { stdout: fixture("found.json") });
		const list = await readPullRequests(timber.path, folder);
		expect(list.ok && list.worktrees.map(entry => entry.outcome)).toEqual(["none", "found", "found", "found", "found", "found", "none"]);
		const notes = timber.notes()!;
		expect(notes.arguments).toEqual(["__app-pr"]);
		expect(realpathSync(notes.cwd)).toBe(folder);
		expect(notes.input).toBe(0);
	});

	test("a lookup that failed is read from the record Timber prints with exit code 1", async () => {
		const list = await readPullRequests(standIn(root, "offline", { stdout: fixture("offline.json"), exitCode: 1 }).path, folder);
		expect(list.ok && list.worktrees[0]).toEqual({ path: "/work/sample", branch: "main", outcome: "failed", reason: "offline", diagnostic: "Cannot reach GitHub; check connectivity and try again." });
	});

	test("a Timber without the command passes on what it said", async () => {
		const timber = standIn(root, "old", { stderr: fixture("unknown-command-0.1.2.stderr"), exitCode: 1 });
		expect(await readPullRequests(timber.path, folder)).toEqual({ ok: false, message: "timber __app-pr exited with code 1: unknown command '__app-pr'" });
	});

	test("a Timber that takes too long is stopped, and that is a failure", async () => {
		const timber = standIn(root, "stuck", { stdout: fixture("found.json"), waitMs: 5_000 });
		const started = Date.now();
		const list = await readPullRequests(timber.path, folder, process.env, 300);
		expect(Date.now() - started).toBeLessThan(4_000);
		expect(list).toEqual({ ok: false, message: `timber __app-pr in ${folder} was stopped before it finished. The app waits 0.3 seconds for it.` });
	});

	test("an executable that cannot be started is a failure", async () => {
		const list = await readPullRequests(join(root, "no such timber"), folder);
		expect(list.ok).toBe(false);
		expect(!list.ok && list.message).toStartWith("Could not run timber __app-pr in ");
	});
});

describe("createPullRequestReader", () => {
	const listed = (paths: string[]) => async (path: string) => paths.includes(path);

	test("reads a repository from the list with the Timber that was found", async () => {
		const timber = standIn(root, "reader", { stdout: fixture("not-github.json"), exitCode: 1 });
		const reader = createPullRequestReader({ timber: async () => ready(timber.path), isListed: listed([folder]) });
		const list = await reader.read(folder);
		expect(list.ok && list.worktrees.map(entry => entry.outcome === "failed" ? entry.reason : entry.outcome)).toEqual(["not-github", "not-github", "none"]);
	});

	test("a repository that is not in the list is refused, and Timber is not run", async () => {
		const timber = standIn(root, "unlisted", { stdout: fixture("found.json") });
		const reader = createPullRequestReader({ timber: async () => ready(timber.path), isListed: listed([]) });
		expect(await reader.read(folder)).toEqual({ ok: false, message: `${folder} is not a repository in the app's list.` });
		expect(timber.notes()).toBeNull();
	});

	test("nothing runs while Timber is not ready", async () => {
		const reader = createPullRequestReader({ timber: async () => ({ state: "not-found", override: null }), isListed: listed([folder]) });
		expect(await reader.read(folder)).toEqual({ ok: false, message: "Timber was not found on PATH." });
	});

	test("a request without a repository is refused", async () => {
		const reader = createPullRequestReader({ timber: async () => ready("/nowhere"), isListed: async () => true });
		for (const repository of ["", undefined, 3]) expect((await reader.read(repository as string)).ok).toBe(false);
	});

	test("a check that throws is a failure, not a crash", async () => {
		const reader = createPullRequestReader({ timber: async () => ready("/nowhere"), isListed: async () => { throw new Error("list unreadable"); } });
		expect(await reader.read(folder)).toEqual({ ok: false, message: `Could not read the pull requests of ${folder}: list unreadable.` });
	});
});

describe("nothing Timber printed is logged", () => {
	const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
	const spies: ReturnType<typeof spyOn>[] = [];
	afterEach(() => {
		for (const spy of spies.splice(0)) spy.mockRestore();
	});

	test("neither a record nor a diagnostic reaches the console", async () => {
		const good = standIn(root, "quiet-record", { stdout: fixture("found.json"), stderr: `warning: ${SECRET}\n` });
		const bad = standIn(root, "quiet-failure", { stderr: `error: ${SECRET}\n`, exitCode: 1 });
		for (const method of methods) spies.push(spyOn(console, method));
		const reader = createPullRequestReader({ timber: async () => ready(good.path), isListed: async () => true });
		expect((await reader.read(folder)).ok).toBe(true);
		expect(JSON.stringify(await readPullRequests(bad.path, folder))).toContain(SECRET);
		for (const spy of spies) expect(spy).not.toHaveBeenCalled();
	});
});

describe("the mock engine", () => {
	test("answers sample pull requests for a listed repository, only while Timber is ready", async () => {
		const engine = createMockEngine();
		const list = await engine.readPullRequests("/work/timber");
		expect(list.ok && list.worktrees.map(entry => entry.outcome === "found" ? entry.pullRequest.number : entry.outcome)).toEqual(["none", 42, 38, "none"]);
		expect(await engine.readPullRequests("/work/elsewhere")).toEqual({ ok: false, message: "/work/elsewhere is not a repository in the app's list." });
		expect(engine.pullRequestReads("/work/timber")).toBe(1);
		const missing = createMockEngine(sampleRepositories, sampleTimberStatuses["not-found"]);
		expect(await missing.readPullRequests("/work/timber")).toEqual({ ok: false, message: "Timber was not found on PATH." });
	});

	test("answers what a test chose, and the sample again after null", async () => {
		const engine = createMockEngine();
		engine.setPullRequests("/work/timber", { ok: false, message: "chosen" });
		expect(await engine.readPullRequests("/work/timber")).toEqual({ ok: false, message: "chosen" });
		engine.setPullRequests("/work/timber", null);
		expect((await engine.readPullRequests("/work/timber")).ok).toBe(true);
	});
});

/** Whether this Timber has `__app-pr`. Run the tests with TIMBER_APP_TIMBER_PATH naming a Timber that has it. */
function canReadPullRequests(timber: string | null): boolean {
	if (timber === null) return false;
	const probe = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-probe-")));
	try {
		const result = Bun.spawnSync([timber, "__app-pr"], { cwd: probe, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 10_000 });
		return result.stdout.toString().startsWith("{");
	} finally {
		rmSync(probe, { recursive: true, force: true });
	}
}

describe.skipIf(!canReadPullRequests(realTimber))("with a real Timber that has __app-pr, on a real repository", () => {
	let work: string;
	let repository: string;
	let environment: Record<string, string>;

	beforeAll(() => {
		work = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-pull-requests-real-")));
		repository = join(work, "sample repo");
		mkdirSync(repository);
		git(repository, "init", "-q", "-b", "main");
		writeFileSync(join(repository, "README.md"), "sample\n");
		git(repository, "add", "README.md");
		git(repository, "commit", "-q", "-m", "init");
		// Not on github.com, so Timber reads no login and contacts nothing.
		git(repository, "remote", "add", "origin", "https://gitlab.example.invalid/sample.git");
		git(repository, "worktree", "add", "-q", "-b", "feat/login", join(work, "sample-worktrees", "feat-login"));
		git(repository, "worktree", "add", "-q", "--detach", join(work, "sample-worktrees", "review"));
		// Only what Timber needs, so nothing of the person's own settings or logins is read.
		environment = { PATH: process.env.PATH ?? "", HOME: join(work, "home"), XDG_CONFIG_HOME: join(work, "config"), XDG_STATE_HOME: join(work, "state"), XDG_DATA_HOME: join(work, "data") };
	});

	afterAll(() => {
		rmSync(work, { recursive: true, force: true });
	});

	test("a repository off GitHub is not-github for every branch, none for a detached HEAD, and reading changes nothing", async () => {
		const worktrees = join(work, "sample-worktrees");
		const before = [fingerprint(repository), fingerprint(join(worktrees, "feat-login")), fingerprint(join(worktrees, "review"))];
		const list = await readPullRequests(realTimber!, repository, environment);
		expect([fingerprint(repository), fingerprint(join(worktrees, "feat-login")), fingerprint(join(worktrees, "review"))]).toEqual(before);
		expect(list.ok && list.worktrees.map(entry => [entry.path, entry.branch, entry.outcome === "failed" ? entry.reason : entry.outcome])).toEqual([
			[repository, "main", "not-github"],
			[join(worktrees, "feat-login"), "feat/login", "not-github"],
			[join(worktrees, "review"), null, "none"],
		]);
	});

	test("a folder outside any repository is a failure with Timber's diagnostic", async () => {
		const outside = join(work, "outside");
		mkdirSync(outside);
		expect(await readPullRequests(realTimber!, outside, environment)).toEqual({ ok: false, message: `timber __app-pr could not read the repository: Not a Git repository: ${outside}` });
	});
});
