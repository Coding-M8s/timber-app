import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runTimberWithResultFile } from "../src/bun/timber-run";
import { OUTPUT_LIMIT_BYTES } from "../src/shared/captured-output";
import { type StandInRun, git, realTimber, recordedResult, standInResultTimber } from "./support/timber";

let root: string;
let repository: string;
let temporary: string;
let count = 0;

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-run-")));
	// The working directory has a space and non-ASCII characters in it.
	repository = join(root, "my repo zażółć");
	mkdirSync(repository);
	writeFileSync(join(repository, "tracked.txt"), "one\n");
	temporary = join(root, "temporary");
	mkdirSync(temporary);
});

afterEach(() => {
	// Whatever happened, no result file and no folder for one is left behind, and nothing was put in the repository.
	expect(readdirSync(temporary)).toEqual([]);
	expect(readdirSync(repository)).toEqual(["tracked.txt"]);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

const newArguments = (resultFile: string) => ["new", "feat/login", "--result-file", resultFile, "--no-editor", "--no-agent"];

/** Run `timber new` against a stand-in that acts out `run`. */
async function runNew(run: StandInRun) {
	const timber = standInResultTimber(root, `stand-in-${++count}`, run);
	const outcome = await runTimberWithResultFile({ executable: timber.path, command: "new", arguments: newArguments, folder: repository, temporaryRoot: temporary });
	return { ...outcome, notes: timber.notes() };
}

describe("runTimberWithResultFile", () => {
	test("success: reads the record, and hands Timber a fresh file outside the repository", async () => {
		const { command, result, output, notes } = await runNew({ result: recordedResult.succeeded, stdout: "Created feat/login at /work/sample-worktrees/feat-login\n" });
		expect(result).toMatchObject({ outcome: "succeeded", record: { materialized: true, worktree: { branch: "feat/login", path: "/work/sample-worktrees/feat-login" } } });
		expect(output).toEqual({ text: "Created feat/login at /work/sample-worktrees/feat-login\n", truncated: false });
		expect(command).toBe("timber new feat/login --result-file <temporary file> --no-editor --no-agent");

		expect(realpathSync(notes.cwd)).toBe(repository);
		const resultFile = notes.resultFile!;
		expect(notes.arguments).toEqual(newArguments(resultFile));
		expect(notes.resultFileExisted).toBe(false);
		expect(dirname(dirname(resultFile))).toBe(temporary);
		expect(resultFile.startsWith(repository)).toBe(false);
		expect(existsSync(resultFile)).toBe(false);
		expect(existsSync(dirname(resultFile))).toBe(false);
	});

	test.skipIf(process.platform === "win32")("the folder holding the result file is open to this user only", async () => {
		const { notes } = await runNew({ result: recordedResult.succeeded });
		expect(notes.folderMode).toBe(0o700);
	});

	test("every run gets its own file, so a retry never meets an old one", async () => {
		const timber = standInResultTimber(root, "twice", { result: recordedResult.succeeded });
		const request = { executable: timber.path, command: "new" as const, arguments: newArguments, folder: repository, temporaryRoot: temporary };
		await runTimberWithResultFile(request);
		const first = timber.notes().resultFile;
		await runTimberWithResultFile(request);
		expect(timber.notes().resultFile).not.toBe(first);
		expect(timber.notes().resultFileExisted).toBe(false);
	});

	test("failure: reports Timber's diagnostic and keeps what it printed", async () => {
		const stderr = "error: Branch feat/login is already checked out at /work/sample-worktrees/feat-login. Use timber open instead.\n";
		const { result, output } = await runNew({ result: recordedResult.failed, stderr, exitCode: 1 });
		expect(result).toMatchObject({
			outcome: "failed",
			diagnostic: "Branch feat/login is already checked out at /work/sample-worktrees/feat-login. Use timber open instead.",
			record: { materialized: false, worktree: null },
		});
		expect(output).toEqual({ text: stderr, truncated: false });
	});

	test("cancelled: reported as cancelled, not as a success or a failure", async () => {
		const cancelled = JSON.stringify({ ...JSON.parse(recordedResult.failed), outcome: "cancelled", exitCode: 0, diagnostic: null });
		const { result } = await runNew({ result: cancelled });
		expect(result).toMatchObject({ outcome: "cancelled", record: { worktree: null, materialized: false } });
	});

	test("a missing result file is a failure even when the output looks successful", async () => {
		const { result, output } = await runNew({ result: null, stdout: "Created feat/login at /work/sample-worktrees/feat-login\n" });
		expect(result).toEqual({
			outcome: "failed",
			diagnostic: "timber new exited with code 0 and left no result, so what it did is unknown. The details below show what it printed.",
			record: null,
		});
		expect(output.text).toContain("Created feat/login");
	});

	test("an empty result file is a failure even when the process exits with 0", async () => {
		const { result } = await runNew({ result: "", stdout: "Created feat/login\n" });
		expect(result).toMatchObject({ outcome: "failed", record: null });
		expect(result.outcome === "failed" && result.diagnostic).toContain("left an empty result");
	});

	test("a malformed result file is a failure even when the process exits with 0", async () => {
		const { result } = await runNew({ result: recordedResult.succeeded.slice(0, 300), stdout: "Created feat/login\n" });
		expect(result).toMatchObject({ outcome: "failed", record: null });
		expect(result.outcome === "failed" && result.diagnostic).toContain("it is not valid JSON");
	});

	test("a good record with another exit code is a failure", async () => {
		const { result } = await runNew({ result: recordedResult.succeeded, exitCode: 3 });
		expect(result).toMatchObject({ outcome: "failed", record: null });
		expect(result.outcome === "failed" && result.diagnostic).toContain("exited with code 3, but its result says exit code 0");
	});

	test("a failure before Timber wrote anything shows what it printed", async () => {
		const stderr = "error: --result-file requires explicit --no-editor and --no-agent. Setup hooks still run.\n";
		const { result, output } = await runNew({ result: null, stderr, exitCode: 1 });
		expect(result.outcome === "failed" && result.diagnostic).toContain("exited with code 1 and left no result");
		expect(output.text).toBe(stderr);
	});

	test.skipIf(process.platform === "win32")("a process that was killed is a failure even with a complete record", async () => {
		const { result } = await runNew({ result: recordedResult.succeeded, kill: true });
		expect(result).toMatchObject({ outcome: "failed", record: null });
		expect(result.outcome === "failed" && result.diagnostic).toContain("did not exit by itself");
	});

	test("standard output and standard error are both kept, limited in size", async () => {
		const noise = `${"x".repeat(99)}\n`.repeat(2000);
		const { result, output } = await runNew({ result: recordedResult.failed, stdout: noise, stderr: "error: the last words\n", exitCode: 1 });
		expect(result.outcome).toBe("failed");
		expect(output.truncated).toBe(true);
		expect(new TextEncoder().encode(output.text).length).toBeLessThanOrEqual(OUTPUT_LIMIT_BYTES);
		expect(output.text).toContain("error: the last words\n");
	});

	test("what the command printed is never logged", async () => {
		const spies = (["log", "info", "warn", "error", "debug"] as const).map(method => spyOn(console, method).mockImplementation(() => {}));
		try {
			await runNew({ result: recordedResult.failed, stdout: "TOKEN=private-value\n", stderr: "also private\n", exitCode: 1 });
			await runNew({ result: null, stdout: "TOKEN=private-value\n" });
			for (const spy of spies) expect(spy).not.toHaveBeenCalled();
		} finally {
			for (const spy of spies) spy.mockRestore();
		}
	});

	test("an executable that is not there is a failure, and nothing is left behind", async () => {
		const run = await runTimberWithResultFile({ executable: join(root, "no-such", "timber"), command: "new", arguments: newArguments, folder: repository, temporaryRoot: temporary });
		expect(run.result).toMatchObject({ outcome: "failed", record: null });
		expect(run.result.outcome === "failed" && run.result.diagnostic).toContain("Could not run timber new");
		expect(run.output).toEqual({ text: "", truncated: false });
	});

	test("a temporary folder inside the repository is refused before anything runs", async () => {
		const inside = join(root, "holds a repository");
		mkdirSync(join(inside, "tmp"), { recursive: true });
		const timber = standInResultTimber(root, "never-run", { result: recordedResult.succeeded });
		const run = await runTimberWithResultFile({ executable: timber.path, command: "new", arguments: newArguments, folder: inside, temporaryRoot: join(inside, "tmp") });
		expect(run.result).toMatchObject({ outcome: "failed", record: null });
		expect(run.result.outcome === "failed" && run.result.diagnostic).toContain("must stay outside the repository. Nothing was run.");
		expect(() => timber.notes()).toThrow();
		expect(readdirSync(join(inside, "tmp"))).toEqual([]);
	});

	test("a temporary folder that cannot be made is a failure", async () => {
		const timber = standInResultTimber(root, "no-temporary", { result: recordedResult.succeeded });
		const run = await runTimberWithResultFile({ executable: timber.path, command: "new", arguments: newArguments, folder: repository, temporaryRoot: join(root, "no-such-folder") });
		expect(run.result.outcome === "failed" && run.result.diagnostic).toContain("Could not make a temporary folder");
		expect(() => timber.notes()).toThrow();
	});
});

describe.skipIf(realTimber === null)("with the installed Timber, on a real repository", () => {
	let work: string;
	let primary: string;
	let scratch: string;
	let environment: Record<string, string | undefined>;

	beforeAll(() => {
		work = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-run-real-")));
		primary = join(work, "my sample");
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
	});

	afterAll(() => {
		rmSync(work, { recursive: true, force: true });
	});

	const create = (name: string) => runTimberWithResultFile({
		executable: realTimber!,
		command: "new",
		arguments: resultFile => ["new", name, "--result-file", resultFile, "--no-editor", "--no-agent"],
		folder: primary,
		environment,
		temporaryRoot: scratch,
	});

	test("timber new creates the worktree and the record says so", async () => {
		const run = await create("feat/zażółć login");
		expect(run.result.outcome).toBe("succeeded");
		const worktree = run.result.record!.worktree!;
		expect(run.result.record).toMatchObject({ materialized: true, repository: { primaryWorktreeRoot: primary } });
		expect(git(primary, "worktree", "list", "--porcelain")).toContain(`worktree ${worktree.path}\n`);
		expect(git(worktree.path, "branch", "--show-current").trim()).toBe(worktree.branch!);
		expect(run.command).toBe("timber new 'feat/zażółć login' --result-file <temporary file> --no-editor --no-agent");
		expect(readdirSync(scratch)).toEqual([]);
		expect(git(primary, "status", "--porcelain")).toBe("");
	});

	test("the same command again fails with Timber's diagnostic and its output", async () => {
		const run = await create("feat/zażółć login");
		expect(run.result).toMatchObject({ outcome: "failed", record: { materialized: false, worktree: null } });
		expect(run.result.outcome === "failed" && run.result.diagnostic).toContain("is already checked out");
		expect(run.output.text).toContain("is already checked out");
		expect(readdirSync(scratch)).toEqual([]);
	});

	test("arguments Timber refuses leave no result, which is a failure with what it printed", async () => {
		const run = await runTimberWithResultFile({
			executable: realTimber!,
			command: "new",
			arguments: resultFile => ["new", "feat/other", "--result-file", resultFile],
			folder: primary,
			environment,
			temporaryRoot: scratch,
		});
		expect(run.result).toMatchObject({ outcome: "failed", record: null });
		expect(run.result.outcome === "failed" && run.result.diagnostic).toContain("exited with code 1 and left no result");
		expect(run.output.text).toContain("--result-file requires explicit --no-editor and --no-agent");
		expect(git(primary, "branch", "--list", "feat/other")).toBe("");
		expect(readdirSync(scratch)).toEqual([]);
	});
});
