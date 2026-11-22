import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueLister, listIssues } from "../src/bun/issue-lists";
import { createMockEngine, sampleTimberStatuses } from "../src/mainview/engine/mock";
import { REAL_TIMBER_TIMEOUT_MS, bunStandIn, fingerprint, git, readyAt, realTimber, standIn } from "./support/timber";

setDefaultTimeout(REAL_TIMBER_TIMEOUT_MS);

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "timber-app-issue-lists", name), "utf8");
const SECRET = "lin_api_SuperSecretKey123";

let root: string;
let folder: string;

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-issue-lists-")));
	// The working directory has a space and non-ASCII characters in it.
	folder = join(root, "my repo zażółć");
	mkdirSync(folder);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

const ready = readyAt("0.1.3");

describe("listIssues with a stand-in Timber", () => {
	test("runs timber __app-issues with the list and the tracker, in the repository folder, with standard input closed", async () => {
		const timber = standIn(root, "sprint", { stdout: fixture("sprint-iteration.json") });
		const result = await listIssues(timber.path, folder, "sprint", "github");
		expect(result).toMatchObject({ ok: true, outcome: "found", sprint: { name: "Iteration 1" } });
		const notes = timber.notes()!;
		expect(notes.arguments).toEqual(["__app-issues", "sprint", "--tracker", "github"]);
		expect(realpathSync(notes.cwd)).toBe(folder);
		expect(notes.input).toBe(0);
	});

	test("assigned and open ask for 50", async () => {
		const timber = standIn(root, "assigned", { stdout: fixture("assigned.json") });
		expect(await listIssues(timber.path, folder, "assigned", "github")).toMatchObject({ ok: true, outcome: "found" });
		expect(timber.notes()!.arguments).toEqual(["__app-issues", "assigned", "--tracker", "github", "--limit", "50"]);
	});

	test("a failed list is Timber's reason, read from exit code 1", async () => {
		const timber = standIn(root, "failed", { stdout: fixture("sprint-not-configured.json"), exitCode: 1 });
		expect(await listIssues(timber.path, folder, "sprint", "github")).toMatchObject({ ok: true, outcome: "failed", reason: "not-configured" });
	});

	test("a whole sprint of 500 issues with long titles is read", async () => {
		const record = JSON.parse(fixture("sprint-iteration.json"));
		const one = record.issues[0];
		record.issues = Array.from({ length: 500 }, (_, index) => ({ ...one, key: String(index + 1), url: `https://github.com/Coding-M8s/timber/issues/${index + 1}`, title: "t".repeat(300) }));
		const timber = standIn(root, "big", { stdout: `${JSON.stringify(record)}\n` });
		const result = await listIssues(timber.path, folder, "sprint", "github");
		expect(result.ok && result.outcome === "found" && result.issues.length).toBe(500);
	});

	test("a Timber without the command is unsupported", async () => {
		const timber = standIn(root, "old", { stderr: fixture("unknown-command-0.1.3.stderr"), exitCode: 1 });
		expect(await listIssues(timber.path, folder, "sprint", "github")).toMatchObject({ ok: false, unsupported: true });
	});

	test("a Timber that takes too long is stopped, and that is a failure", async () => {
		const timber = standIn(root, "stuck", { stdout: fixture("assigned.json"), waitMs: 5_000 });
		const started = Date.now();
		const result = await listIssues(timber.path, folder, "assigned", "github", process.env, 300);
		expect(Date.now() - started).toBeLessThan(4_000);
		expect(result).toEqual({ ok: false, unsupported: false, message: `timber __app-issues in ${folder} was stopped before it finished. The app waits 0.3 seconds for it.` });
	});
});

/** A stand-in Timber that answers by its arguments, as `acts` says, and notes the arguments of every run. */
const SCRIPTED = `
const { appendFileSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const acts = JSON.parse(readFileSync(join(folder, "acts.json"), "utf8"));
const given = process.argv.slice(2).join(" ");
appendFileSync(join(folder, "runs.txt"), given + "\\n");
const act = acts[given] ?? { stderr: "no act for " + given, exitCode: 2 };
if (act.stdout) process.stdout.write(act.stdout);
if (act.stderr) process.stderr.write(act.stderr);
process.exitCode = act.exitCode ?? 0;
`;

function scripted(name: string, acts: Record<string, { stdout?: string; stderr?: string; exitCode?: number }>) {
	const here = join(root, name);
	mkdirSync(here, { recursive: true });
	writeFileSync(join(here, "acts.json"), JSON.stringify(acts));
	writeFileSync(join(here, "runs.txt"), "");
	const path = bunStandIn(here, SCRIPTED);
	return { path, runs: () => readFileSync(join(here, "runs.txt"), "utf8").split("\n").filter(line => line !== "") };
}

describe("my issues in the sprint", () => {
	const SPRINT = "__app-issues sprint --tracker github";
	const MY_SPRINT = `${SPRINT} --assigned`;
	const ASSIGNED = "__app-issues assigned --tracker github --limit 50";
	const sprintRecord = (change: (record: any) => void) => {
		const record = JSON.parse(fixture("sprint-iteration.json"));
		change(record);
		return `${JSON.stringify(record)}\n`;
	};

	test("runs sprint --assigned once when Timber has it", async () => {
		const timber = scripted("my-sprint-new", { [MY_SPRINT]: { stdout: sprintRecord(record => { for (const issue of record.issues) issue.assignedToMe = true; }) } });
		const result = await listIssues(timber.path, folder, "my-sprint", "github");
		expect(result).toMatchObject({ ok: true, outcome: "found", sprint: { name: "Iteration 1" } });
		expect(result.ok && result.outcome === "found" && result.partial).toBeFalsy();
		expect(timber.runs()).toEqual([MY_SPRINT]);
	});

	test("a Timber without --assigned reads the sprint and the assigned list, and keeps the sprint's issues assigned to me", async () => {
		const assigned = JSON.parse(fixture("assigned.json"));
		assigned.issues = [{ ...JSON.parse(fixture("sprint-iteration.json")).issues[1] }];
		const timber = scripted("my-sprint-old", {
			[MY_SPRINT]: { stderr: fixture("unknown-option-0.1.4.stderr"), exitCode: 1 },
			[SPRINT]: { stdout: fixture("sprint-iteration.json") },
			[ASSIGNED]: { stdout: `${JSON.stringify(assigned)}\n` },
		});
		const result = await listIssues(timber.path, folder, "my-sprint", "github");
		expect(result).toMatchObject({ ok: true, outcome: "found", partial: true, sprint: { name: "Iteration 1" } });
		expect(result.ok && result.outcome === "found" && result.issues.map(issue => issue.key)).toEqual(["147"]);
		expect(timber.runs()).toEqual([MY_SPRINT, SPRINT, ASSIGNED]);
	});

	test("without --assigned, a sprint that is not set up is said as for sprint, and nothing more is read", async () => {
		const timber = scripted("my-sprint-old-unset", {
			[MY_SPRINT]: { stderr: fixture("unknown-option-0.1.4.stderr"), exitCode: 1 },
			[SPRINT]: { stdout: fixture("sprint-not-configured.json"), exitCode: 1 },
		});
		expect(await listIssues(timber.path, folder, "my-sprint", "github")).toMatchObject({ ok: true, outcome: "failed", reason: "not-configured" });
		expect(timber.runs()).toEqual([MY_SPRINT, SPRINT]);
	});

	test("a Timber without __app-issues is unsupported, and nothing more is read", async () => {
		const timber = scripted("my-sprint-older", { [MY_SPRINT]: { stderr: fixture("unknown-command-0.1.3.stderr"), exitCode: 1 } });
		expect(await listIssues(timber.path, folder, "my-sprint", "github")).toMatchObject({ ok: false, unsupported: true });
		expect(timber.runs()).toEqual([MY_SPRINT]);
	});
});

describe("createIssueLister", () => {
	const listed = (paths: string[]) => async (path: string) => paths.includes(path);

	test("lists a repository from the list with the Timber that was found", async () => {
		const timber = standIn(root, "lister", { stdout: fixture("jira-sign-in-needed.json"), exitCode: 1 });
		const lister = createIssueLister({ timber: async () => ready(timber.path), isListed: listed([folder]) });
		expect(await lister.list({ repository: folder, list: "sprint", tracker: "jira" })).toMatchObject({ ok: true, outcome: "failed", reason: "sign-in-needed" });
	});

	test("a repository that is not in the list is refused, and Timber is not run", async () => {
		const timber = standIn(root, "unlisted", { stdout: fixture("assigned.json") });
		const lister = createIssueLister({ timber: async () => ready(timber.path), isListed: listed([]) });
		expect(await lister.list({ repository: folder, list: "assigned", tracker: "github" })).toEqual({ ok: false, unsupported: false, message: `${folder} is not a repository in the app's list.` });
		expect(timber.notes()).toBeNull();
	});

	test("a request without a repository, a known list, or a known tracker is refused, and Timber is not run", async () => {
		const timber = standIn(root, "shapes", { stdout: fixture("assigned.json") });
		const lister = createIssueLister({ timber: async () => ready(timber.path), isListed: async () => true });
		const requests = [null, "x", {}, { repository: "", list: "open", tracker: "github" }, { repository: folder, list: "search", tracker: "github" }, { repository: folder, list: "open", tracker: "gitlab" }, { repository: folder, list: "open" }];
		for (const request of requests) expect((await lister.list(request as never)).ok).toBe(false);
		expect(timber.notes()).toBeNull();
	});

	test("nothing runs while Timber is not ready", async () => {
		const lister = createIssueLister({ timber: async () => ({ state: "not-found", source: "path", path: null }), isListed: listed([folder]) });
		expect(await lister.list({ repository: folder, list: "open", tracker: "github" })).toEqual({ ok: false, unsupported: false, message: "Timber was not found on PATH." });
	});
});

describe("nothing Timber printed is logged", () => {
	const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
	const spies: ReturnType<typeof spyOn>[] = [];
	afterEach(() => {
		for (const spy of spies.splice(0)) spy.mockRestore();
	});

	test("neither a record nor a diagnostic reaches the console", async () => {
		const good = standIn(root, "quiet-record", { stdout: fixture("assigned.json"), stderr: `warning: ${SECRET}\n` });
		const bad = standIn(root, "quiet-failure", { stderr: `error: ${SECRET}\n`, exitCode: 1 });
		for (const method of methods) spies.push(spyOn(console, method));
		expect((await listIssues(good.path, folder, "assigned", "github")).ok).toBe(true);
		expect(JSON.stringify(await listIssues(bad.path, folder, "assigned", "github"))).toContain(SECRET);
		for (const spy of spies) expect(spy).not.toHaveBeenCalled();
	});
});

describe("the mock engine", () => {
	const list = (engine: ReturnType<typeof createMockEngine>, which: "sprint" | "assigned" | "open", tracker: "github" | "jira" | "linear", repository = "/work/timber") =>
		engine.listIssues({ repository, list: which, tracker });

	test("lists each tracker's sample sprint, and marks issues that have a worktree", async () => {
		const engine = createMockEngine();
		const jira = await list(engine, "sprint", "jira");
		if (!jira.ok || jira.outcome !== "found") throw new Error("not found");
		expect(jira.sprint).toEqual({ name: "TIM Sprint 14", source: "jira-board" });
		expect(jira.issues.find(issue => issue.key === "TIM-88")!.worktree?.branch).toBe("fix/macos-portability");
		const github = await list(engine, "sprint", "github");
		expect(github.ok && github.outcome === "found" && github.issues.find(issue => issue.key === "41")!.worktree?.branch).toBe("feat/github-issue-lookup");
	});

	test("assigned and open hold no closed issues, and Linear without a team is not set up", async () => {
		const engine = createMockEngine();
		for (const which of ["assigned", "open"] as const) {
			const result = await list(engine, which, "jira");
			expect(result.ok && result.outcome === "found" && result.issues.every(issue => issue.status.category !== "closed")).toBe(true);
		}
		expect(await list(engine, "sprint", "linear")).toMatchObject({ ok: true, outcome: "failed", reason: "not-configured" });
	});

	test("answers what a test chose, for one list or all, counts each read, and refuses as the main process does", async () => {
		const engine = createMockEngine();
		engine.setIssueList({ ok: true, outcome: "none" }, "sprint");
		expect(await list(engine, "sprint", "jira")).toEqual({ ok: true, outcome: "none" });
		expect(await list(engine, "open", "jira")).toMatchObject({ ok: true, outcome: "found" });
		engine.setIssueList(null, "sprint");
		expect(engine.issueListReads()).toEqual([{ repository: "/work/timber", list: "sprint", tracker: "jira" }, { repository: "/work/timber", list: "open", tracker: "jira" }]);
		expect(await list(engine, "open", "jira", "/work/nowhere")).toEqual({ ok: false, unsupported: false, message: "/work/nowhere is not a repository in the app's list." });
		const missing = createMockEngine(undefined, sampleTimberStatuses["not-found"]);
		expect(await list(missing, "open", "github")).toEqual({ ok: false, unsupported: false, message: "Timber was not found on PATH." });
	});
});

/** Whether this Timber has `__app-issues`. Run the tests with TIMBER_APP_TIMBER_PATH naming a Timber that has it. */
function canListIssues(timber: string | null): boolean {
	if (timber === null) return false;
	const probe = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-probe-")));
	try {
		const result = Bun.spawnSync([timber, "__app-issues", "sprint", "--tracker", "linear"], { cwd: probe, stdin: "ignore", stdout: "pipe", stderr: "pipe", timeout: 10_000 });
		return result.stdout.toString().startsWith("{");
	} finally {
		rmSync(probe, { recursive: true, force: true });
	}
}

describe.skipIf(!canListIssues(realTimber))("with a real Timber that has __app-issues, on a real repository", () => {
	let work: string;
	let repository: string;
	let environment: Record<string, string>;

	beforeAll(() => {
		work = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-issue-lists-real-")));
		repository = join(work, "sample repo");
		mkdirSync(repository);
		git(repository, "init", "-q", "-b", "main");
		writeFileSync(join(repository, "README.md"), "sample\n");
		git(repository, "add", "README.md");
		git(repository, "commit", "-q", "-m", "init");
		git(repository, "worktree", "add", "-q", "-b", "feat/one", join(work, "one"));
		// Only what Timber needs, so nothing of the person's own settings or logins is read. With nothing set up, Timber contacts nothing.
		environment = { PATH: process.env.PATH ?? "", HOME: join(work, "home"), XDG_CONFIG_HOME: join(work, "config"), XDG_STATE_HOME: join(work, "state"), XDG_DATA_HOME: join(work, "data") };
	});

	afterAll(() => {
		rmSync(work, { recursive: true, force: true });
	});

	test("a sprint that is not set up is not-configured, Jira without a site is sign-in needed, and nothing changes a file or a ref", async () => {
		const before = [fingerprint(repository), fingerprint(join(work, "one")), git(repository, "for-each-ref")];
		expect(await listIssues(realTimber!, repository, "sprint", "github", environment)).toMatchObject({ ok: true, outcome: "failed", reason: "not-configured" });
		expect(await listIssues(realTimber!, repository, "sprint", "linear", environment)).toMatchObject({ ok: true, outcome: "failed", reason: "not-configured" });
		// With or without --assigned in this Timber, my issues in a sprint that is not set up say so as the sprint does.
		expect(await listIssues(realTimber!, repository, "my-sprint", "github", environment)).toMatchObject({ ok: true, outcome: "failed", reason: "not-configured" });
		expect(await listIssues(realTimber!, repository, "open", "linear", environment)).toMatchObject({ ok: true, outcome: "failed", reason: "not-configured" });
		expect(await listIssues(realTimber!, repository, "sprint", "jira", environment)).toMatchObject({ ok: true, outcome: "failed", reason: "sign-in-needed" });
		expect(await listIssues(realTimber!, repository, "assigned", "github", environment)).toMatchObject({ ok: true, outcome: "failed" });
		expect([fingerprint(repository), fingerprint(join(work, "one")), git(repository, "for-each-ref")]).toEqual(before);
	});
});
