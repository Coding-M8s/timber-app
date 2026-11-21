import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueSearcher, searchIssues } from "../src/bun/issue-search";
import { createMockEngine, sampleTimberStatuses } from "../src/mainview/engine/mock";
import { REAL_TIMBER_TIMEOUT_MS, fingerprint, git, readyAt, realTimber, standIn } from "./support/timber";

setDefaultTimeout(REAL_TIMBER_TIMEOUT_MS);

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "timber-app-issues", name), "utf8");
const SECRET = "lin_api_SuperSecretKey123";

let root: string;
let folder: string;

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-issue-search-")));
	// The working directory has a space and non-ASCII characters in it.
	folder = join(root, "my repo zażółć");
	mkdirSync(folder);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

const ready = readyAt("0.1.3");

describe("searchIssues with a stand-in Timber", () => {
	test("runs timber __app-issues search with the tracker, a limit, and the text after --, in the repository folder, with standard input closed", async () => {
		const timber = standIn(root, "found", { stdout: fixture("found.json") });
		const result = await searchIssues(timber.path, folder, "github", "16");
		expect(result).toMatchObject({ ok: true, outcome: "found" });
		const notes = timber.notes()!;
		expect(notes.arguments).toEqual(["__app-issues", "search", "--tracker", "github", "--limit", "10", "--", "16"]);
		expect(realpathSync(notes.cwd)).toBe(folder);
		expect(notes.input).toBe(0);
	});

	test("text that looks like an option or a shell command is one argument after --", async () => {
		const timber = standIn(root, "dash", { stdout: fixture("no-matches.json") });
		await searchIssues(timber.path, folder, "github", "--help; rm -rf / $(id)");
		expect(timber.notes()!.arguments.slice(-2)).toEqual(["--", "--help; rm -rf / $(id)"]);
	});

	test("a Timber without the command is unsupported", async () => {
		const timber = standIn(root, "old", { stderr: fixture("unknown-command-0.1.3.stderr"), exitCode: 1 });
		expect(await searchIssues(timber.path, folder, "github", "login")).toMatchObject({ ok: false, unsupported: true });
	});

	test("a Timber that takes too long is stopped, and that is a failure", async () => {
		const timber = standIn(root, "stuck", { stdout: fixture("found.json"), waitMs: 5_000 });
		const started = Date.now();
		const result = await searchIssues(timber.path, folder, "github", "16", process.env, 300);
		expect(Date.now() - started).toBeLessThan(4_000);
		expect(result).toEqual({ ok: false, unsupported: false, message: `timber __app-issues in ${folder} was stopped before it finished. The app waits 0.3 seconds for it.` });
	});
});

describe("createIssueSearcher", () => {
	const listed = (paths: string[]) => async (path: string) => paths.includes(path);

	test("searches a repository from the list with the Timber that was found", async () => {
		const timber = standIn(root, "searcher", { stdout: fixture("jira-sign-in-needed.json"), exitCode: 1 });
		const searcher = createIssueSearcher({ timber: async () => ready(timber.path), isListed: listed([folder]) });
		expect(await searcher.search({ repository: folder, tracker: "jira", text: "ENG-4" })).toMatchObject({ ok: true, outcome: "failed", reason: "sign-in-needed" });
	});

	test("a repository that is not in the list is refused, and Timber is not run", async () => {
		const timber = standIn(root, "unlisted", { stdout: fixture("found.json") });
		const searcher = createIssueSearcher({ timber: async () => ready(timber.path), isListed: listed([]) });
		expect(await searcher.search({ repository: folder, tracker: "github", text: "16" })).toEqual({ ok: false, unsupported: false, message: `${folder} is not a repository in the app's list.` });
		expect(timber.notes()).toBeNull();
	});

	test("a request without a repository, a known tracker, or text of 1 to 200 characters is refused, and Timber is not run", async () => {
		const timber = standIn(root, "shapes", { stdout: fixture("found.json") });
		const searcher = createIssueSearcher({ timber: async () => ready(timber.path), isListed: async () => true });
		const requests = [null, "x", {}, { repository: "", tracker: "github", text: "a" }, { repository: folder, tracker: "gitlab", text: "a" }, { repository: folder, tracker: "github", text: "  " }, { repository: folder, tracker: "github", text: "a".repeat(201) }, { repository: folder, tracker: "github" }];
		for (const request of requests) expect((await searcher.search(request as never)).ok).toBe(false);
		expect(timber.notes()).toBeNull();
	});

	test("nothing runs while Timber is not ready", async () => {
		const searcher = createIssueSearcher({ timber: async () => ({ state: "not-found", source: "path", path: null }), isListed: listed([folder]) });
		expect(await searcher.search({ repository: folder, tracker: "github", text: "16" })).toEqual({ ok: false, unsupported: false, message: "Timber was not found on PATH." });
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
		expect((await searchIssues(good.path, folder, "github", "16")).ok).toBe(true);
		expect(JSON.stringify(await searchIssues(bad.path, folder, "github", "16"))).toContain(SECRET);
		for (const spy of spies) expect(spy).not.toHaveBeenCalled();
	});
});

describe("the mock engine", () => {
	const search = (engine: ReturnType<typeof createMockEngine>, tracker: "github" | "jira" | "linear", text: string, repository = "/work/timber") =>
		engine.searchIssues({ repository, tracker, text });

	test("matches key prefixes and title words, and marks issues that have a worktree", async () => {
		const engine = createMockEngine();
		const byKey = await search(engine, "jira", "TIM-8");
		expect(byKey.ok && byKey.outcome === "found" && byKey.issues.map(issue => issue.key)).toEqual(["TIM-8", "TIM-80", "TIM-88"]);
		const byWords = await search(engine, "github", "issue look");
		expect(byWords.ok && byWords.outcome === "found" && byWords.issues.map(issue => [issue.key, issue.worktree?.branch ?? null])).toEqual([["41", "feat/github-issue-lookup"]]);
		expect(await search(engine, "github", "zzz")).toEqual({ ok: true, outcome: "found", issues: [], truncated: false });
	});

	test("answers what a test chose, counts each search, and refuses as the main process does", async () => {
		const engine = createMockEngine();
		engine.setIssueSearch({ ok: true, outcome: "failed", reason: "offline", diagnostic: "Jira could not be reached." });
		expect(await search(engine, "jira", "ENG")).toMatchObject({ ok: true, outcome: "failed", reason: "offline" });
		engine.setIssueSearch(null);
		expect(engine.issueSearches()).toEqual([{ repository: "/work/timber", tracker: "jira", text: "ENG" }]);
		expect(await search(engine, "jira", "ENG", "/work/nowhere")).toEqual({ ok: false, unsupported: false, message: "/work/nowhere is not a repository in the app's list." });
		const missing = createMockEngine(undefined, sampleTimberStatuses["not-found"]);
		expect(await search(missing, "github", "1")).toEqual({ ok: false, unsupported: false, message: "Timber was not found on PATH." });
	});
});

/** Whether this Timber has `__app-issues`. Run the tests with TIMBER_APP_TIMBER_PATH naming a Timber that has it. */
function canSearchIssues(timber: string | null): boolean {
	if (timber === null) return false;
	const probe = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-probe-")));
	try {
		const result = Bun.spawnSync([timber, "__app-issues", "search", "--tracker", "jira", "--", "x"], { cwd: probe, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 10_000 });
		return result.stdout.toString().startsWith("{");
	} finally {
		rmSync(probe, { recursive: true, force: true });
	}
}

describe.skipIf(!canSearchIssues(realTimber))("with a real Timber that has __app-issues, on a real repository", () => {
	let work: string;
	let repository: string;
	let environment: Record<string, string>;

	beforeAll(() => {
		work = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-issue-search-real-")));
		repository = join(work, "sample repo");
		mkdirSync(repository);
		git(repository, "init", "-q", "-b", "main");
		writeFileSync(join(repository, "README.md"), "sample\n");
		git(repository, "add", "README.md");
		git(repository, "commit", "-q", "-m", "init");
		git(repository, "worktree", "add", "-q", "-b", "feat/one", join(work, "one"));
		// Only what Timber needs, so nothing of the person's own settings or logins is read. With no Jira site and no GitHub remote, Timber contacts nothing.
		environment = { PATH: process.env.PATH ?? "", HOME: join(work, "home"), XDG_CONFIG_HOME: join(work, "config"), XDG_STATE_HOME: join(work, "state"), XDG_DATA_HOME: join(work, "data") };
	});

	afterAll(() => {
		rmSync(work, { recursive: true, force: true });
	});

	test("Jira without a site is sign-in needed, GitHub without a GitHub remote fails, and neither changes a file or a ref", async () => {
		const before = [fingerprint(repository), fingerprint(join(work, "one")), git(repository, "for-each-ref")];
		expect(await searchIssues(realTimber!, repository, "jira", "ENG-4", environment)).toMatchObject({ ok: true, outcome: "failed", reason: "sign-in-needed" });
		expect(await searchIssues(realTimber!, repository, "github", "login", environment)).toMatchObject({ ok: true, outcome: "failed" });
		expect([fingerprint(repository), fingerprint(join(work, "one")), git(repository, "for-each-ref")]).toEqual(before);
	});
});
