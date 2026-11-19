import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueReader, readIssue } from "../src/bun/issues";
import { createMockEngine, sampleRepositories, sampleStatesRepository, sampleTimberStatuses } from "../src/mainview/engine/mock";
import type { TimberStatus } from "../src/shared/model";
import { readTimberListing } from "../src/shared/timber-ls";
import { fingerprint, git, realTimber } from "./support/timber";

const windows = process.platform === "win32";
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "timber-app-issue", name), "utf8");
const SECRET = "lin_api_SuperSecretKey123";
const FOUND = "/work/sample-worktrees/feat-found";

let root: string;
let folder: string;

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-issues-")));
	// The working directory has a space and non-ASCII characters in it.
	folder = join(root, "my repo zażółć");
	mkdirSync(folder);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

/** What a stand-in Timber does: print, wait, and exit as told, after reading standard input to its end. */
interface Act {
	stdout?: string;
	stderr?: string;
	exitCode?: number;
	waitMs?: number;
}

const STAND_IN = `
const { readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");
const act = JSON.parse(readFileSync(join(__dirname, "act.json"), "utf8"));
// Read standard input to its end. With input left open, this would never return.
const input = readFileSync(0);
writeFileSync(join(__dirname, "notes.json"), JSON.stringify({ arguments: process.argv.slice(2), cwd: process.cwd(), input: input.length }));
setTimeout(() => {
	if (act.stdout) writeFileSync(1, act.stdout);
	if (act.stderr) writeFileSync(2, act.stderr);
	process.exit(act.exitCode ?? 0);
}, act.waitMs ?? 0);
`;

function standIn(name: string, act: Act): { path: string; notes: () => { arguments: string[]; cwd: string; input: number } | null } {
	const here = join(root, name);
	mkdirSync(here, { recursive: true });
	writeFileSync(join(here, "act.json"), JSON.stringify(act));
	writeFileSync(join(here, "stand-in.cjs"), STAND_IN);
	const path = join(here, windows ? "timber.cmd" : "timber");
	writeFileSync(path, windows
		? `@echo off\r\n"${process.execPath}" "%~dp0stand-in.cjs" %*\r\nexit /b %errorlevel%\r\n`
		: `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/stand-in.cjs" "$@"\n`);
	if (!windows) chmodSync(path, 0o755);
	const notes = join(here, "notes.json");
	return { path, notes: () => (existsSync(notes) ? JSON.parse(readFileSync(notes, "utf8")) : null) };
}

const ready = (path: string): TimberStatus => ({ state: "ready", path, version: "0.1.2" });

describe("readIssue with a stand-in Timber", () => {
	test("runs timber __app-issue with the worktree after --, in the repository folder, with standard input closed", async () => {
		const timber = standIn("found", { stdout: fixture("found.json") });
		const lookup = await readIssue(timber.path, folder, FOUND);
		expect(lookup).toMatchObject({ ok: true, outcome: "found", issue: { key: "153", status: { name: "Closed" } } });
		const notes = timber.notes()!;
		expect(notes.arguments).toEqual(["__app-issue", "--", FOUND]);
		expect(realpathSync(notes.cwd)).toBe(folder);
		expect(notes.input).toBe(0);
	});

	test("a path that looks like an option is passed as one argument after --, never read as an option", async () => {
		const timber = standIn("dash", { stdout: fixture("no-match.json"), exitCode: 1 });
		await readIssue(timber.path, folder, "--help; rm -rf /");
		expect(timber.notes()!.arguments).toEqual(["__app-issue", "--", "--help; rm -rf /"]);
	});

	test("a failure is read from the record Timber prints with exit code 1", async () => {
		const lookup = await readIssue(standIn("offline", { stdout: fixture("offline.json"), exitCode: 1 }).path, folder, "/work/sample-worktrees/feat-github");
		expect(lookup).toEqual({ ok: true, outcome: "failed", reason: "offline", diagnostic: "GitHub could not be reached; check connectivity and try again." });
	});

	test("a Timber without the command passes on what it said", async () => {
		const timber = standIn("old", { stderr: fixture("unknown-command-0.1.2.stderr"), exitCode: 1 });
		expect(await readIssue(timber.path, folder, FOUND)).toEqual({ ok: false, message: "timber __app-issue exited with code 1: unknown command '__app-issue'" });
	});

	test("a Timber that takes too long is stopped, and that is a failure", async () => {
		const timber = standIn("stuck", { stdout: fixture("found.json"), waitMs: 5_000 });
		const started = Date.now();
		const lookup = await readIssue(timber.path, folder, FOUND, process.env, 300);
		expect(Date.now() - started).toBeLessThan(4_000);
		expect(lookup).toEqual({ ok: false, message: `timber __app-issue for ${FOUND} was stopped before it finished. The app waits 0.3 seconds for it.` });
	});

	test("an executable that cannot be started is a failure", async () => {
		const lookup = await readIssue(join(root, "no such timber"), folder, FOUND);
		expect(!lookup.ok && lookup.message).toStartWith("Could not run timber __app-issue for ");
	});
});

describe("createIssueReader", () => {
	const listed = (paths: string[]) => async (path: string) => paths.includes(path);

	test("reads a worktree of a repository from the list with the Timber that was found", async () => {
		const timber = standIn("reader", { stdout: fixture("jira-sign-in-needed.json"), exitCode: 1 });
		const reader = createIssueReader({ timber: async () => ready(timber.path), isListed: listed([folder]) });
		expect(await reader.read({ repository: folder, worktree: "/work/sample-worktrees/feat-jira" })).toMatchObject({ ok: true, outcome: "failed", reason: "sign-in-needed" });
	});

	test("a repository that is not in the list is refused, and Timber is not run", async () => {
		const timber = standIn("unlisted", { stdout: fixture("found.json") });
		const reader = createIssueReader({ timber: async () => ready(timber.path), isListed: listed([]) });
		expect(await reader.read({ repository: folder, worktree: FOUND })).toEqual({ ok: false, message: `${folder} is not a repository in the app's list.` });
		expect(timber.notes()).toBeNull();
	});

	test("a request without a repository or a full worktree path is refused, and Timber is not run", async () => {
		const timber = standIn("shapes", { stdout: fixture("found.json") });
		const reader = createIssueReader({ timber: async () => ready(timber.path), isListed: async () => true });
		for (const request of [null, "x", {}, { repository: "", worktree: FOUND }, { repository: folder }, { repository: folder, worktree: "feat/found" }, { repository: folder, worktree: 3 }]) {
			expect((await reader.read(request as never)).ok).toBe(false);
		}
		expect(timber.notes()).toBeNull();
	});

	test("nothing runs while Timber is not ready", async () => {
		const reader = createIssueReader({ timber: async () => ({ state: "not-found", override: null }), isListed: listed([folder]) });
		expect(await reader.read({ repository: folder, worktree: FOUND })).toEqual({ ok: false, message: "Timber was not found on PATH." });
	});

	test("a check that throws is a failure, not a crash", async () => {
		const reader = createIssueReader({ timber: async () => ready("/nowhere"), isListed: async () => { throw new Error("list unreadable"); } });
		expect(await reader.read({ repository: folder, worktree: FOUND })).toEqual({ ok: false, message: `Could not read the issue of ${FOUND}: list unreadable.` });
	});
});

describe("nothing Timber printed is logged", () => {
	const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
	const spies: ReturnType<typeof spyOn>[] = [];
	afterEach(() => {
		for (const spy of spies.splice(0)) spy.mockRestore();
	});

	test("neither a record nor a diagnostic reaches the console", async () => {
		const good = standIn("quiet-record", { stdout: fixture("found.json"), stderr: `warning: ${SECRET}\n` });
		const bad = standIn("quiet-failure", { stderr: `error: ${SECRET}\n`, exitCode: 1 });
		for (const method of methods) spies.push(spyOn(console, method));
		const reader = createIssueReader({ timber: async () => ready(good.path), isListed: async () => true });
		expect((await reader.read({ repository: folder, worktree: FOUND })).ok).toBe(true);
		expect(JSON.stringify(await readIssue(bad.path, folder, FOUND))).toContain(SECRET);
		for (const spy of spies) expect(spy).not.toHaveBeenCalled();
	});
});

describe("the mock engine", () => {
	test("answers each sample worktree's link: found, failed, or none, only while Timber is ready", async () => {
		const engine = createMockEngine([...sampleRepositories, sampleStatesRepository]);
		const read = (repository: string, worktree: string) => engine.readIssue({ repository, worktree });
		expect(await read("/work/timber", "/work/timber-worktrees/fix-macos-portability")).toMatchObject({ ok: true, outcome: "found", issue: { key: "TIM-88", status: { name: "In Review", category: "in-progress" } } });
		expect(await read("/work/timber", "/work/timber")).toEqual({ ok: true, outcome: "none" });
		expect(await read("/work/billing", "/work/billing-worktrees/feat-invoices")).toMatchObject({ ok: true, outcome: "failed", reason: "offline" });
		expect(await read("/work/billing", "/work/billing-worktrees/fix-unreadable")).toMatchObject({ ok: true, outcome: "failed", reason: "failed" });
		expect(await read("/work/timber", "/work/elsewhere")).toMatchObject({ ok: true, outcome: "failed", reason: "failed" });
		expect(await read("/work/nowhere", "/work/nowhere")).toEqual({ ok: false, message: "/work/nowhere is not a repository in the app's list." });
		expect(engine.issueReads("/work/timber-worktrees/fix-macos-portability")).toBe(1);
		const missing = createMockEngine(sampleRepositories, sampleTimberStatuses["not-found"]);
		expect(await missing.readIssue({ repository: "/work/timber", worktree: "/work/timber" })).toEqual({ ok: false, message: "Timber was not found on PATH." });
	});

	test("answers what a test chose, and the sample again after null", async () => {
		const engine = createMockEngine();
		const request = { repository: "/work/timber", worktree: "/work/timber-worktrees/fix-macos-portability" };
		engine.setIssue(request.worktree, { ok: false, message: "chosen" });
		expect(await engine.readIssue(request)).toEqual({ ok: false, message: "chosen" });
		engine.setIssue(request.worktree, null);
		expect((await engine.readIssue(request)).ok).toBe(true);
	});
});

/** Whether this Timber has `__app-issue`. Run the tests with TIMBER_APP_TIMBER_PATH naming a Timber that has it. */
function canReadIssues(timber: string | null): boolean {
	if (timber === null) return false;
	const probe = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-probe-")));
	try {
		const result = Bun.spawnSync([timber, "__app-issue", "--", probe], { cwd: probe, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 10_000 });
		return result.stdout.toString().startsWith("{");
	} finally {
		rmSync(probe, { recursive: true, force: true });
	}
}

describe.skipIf(!canReadIssues(realTimber))("with a real Timber that has __app-issue, on a real repository", () => {
	let work: string;
	let repository: string;
	let trees: string;
	let environment: Record<string, string>;
	const tree = (name: string) => join(trees, name);

	beforeAll(() => {
		work = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-issues-real-")));
		repository = join(work, "sample repo");
		trees = join(work, "sample-worktrees");
		mkdirSync(repository);
		git(repository, "init", "-q", "-b", "main");
		writeFileSync(join(repository, "README.md"), "sample\n");
		git(repository, "add", "README.md");
		git(repository, "commit", "-q", "-m", "init");
		git(repository, "worktree", "add", "-q", "-b", "plain", tree("plain"));
		git(repository, "worktree", "add", "-q", "-b", "feat/jira", tree("feat-jira"));
		// Saving a link takes a tracker lookup, so the link is written as Timber saves it (src/git/issue-link.ts in Timber).
		const gitDir = realpathSync(git(tree("feat-jira"), "rev-parse", "--absolute-git-dir").trim());
		const commonGitDir = realpathSync(git(repository, "rev-parse", "--path-format=absolute", "--git-common-dir").trim());
		mkdirSync(join(gitDir, "timber"), { mode: 0o700 });
		writeFileSync(join(gitDir, "timber", "issue.json"), `${JSON.stringify({ version: 1, tracker: "jira", key: "PROJ-123", url: "https://example.atlassian.net/browse/PROJ-123", worktreePath: tree("feat-jira"), commonGitDir, worktreeGitDir: gitDir })}\n`, { mode: 0o600 });
		// Only what Timber needs, so nothing of the person's own settings or logins is read. With no Jira site, Timber contacts nothing.
		environment = { PATH: process.env.PATH ?? "", HOME: join(work, "home"), XDG_CONFIG_HOME: join(work, "config"), XDG_STATE_HOME: join(work, "state"), XDG_DATA_HOME: join(work, "data") };
	});

	afterAll(() => {
		rmSync(work, { recursive: true, force: true });
	});

	test("ls --json reports the link, and __app-issue reads none or sign-in needed, changing nothing", async () => {
		const before = [fingerprint(repository), fingerprint(tree("plain")), fingerprint(tree("feat-jira"))];
		const listed = Bun.spawnSync([realTimber!, "ls", "--json"], { cwd: repository, env: environment, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
		const listing = readTimberListing(listed.stdout.toString(), listed.exitCode);
		expect(listing.ok && listing.worktrees.map(worktree => [worktree.branch, worktree.issue])).toEqual([
			["main", { kind: "none" }],
			["feat/jira", { kind: "linked", tracker: "jira", key: "PROJ-123", url: "https://example.atlassian.net/browse/PROJ-123" }],
			["plain", { kind: "none" }],
		]);
		expect(await readIssue(realTimber!, repository, tree("plain"), environment)).toEqual({ ok: true, outcome: "none" });
		expect(await readIssue(realTimber!, repository, tree("feat-jira"), environment)).toMatchObject({ ok: true, outcome: "failed", reason: "sign-in-needed" });
		expect([fingerprint(repository), fingerprint(tree("plain")), fingerprint(tree("feat-jira"))]).toEqual(before);
	});
});
