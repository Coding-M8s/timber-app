import { describe, expect, test } from "bun:test";
import { worktreeId } from "../src/shared/model";
import { RESULT_FILE_PLACEHOLDER, type ResultCommand, type TimberRun, describeTimberCommand, readTimberResult } from "../src/shared/timber-result";
import { newWorktreeArguments, openWorktreeArguments, worktreeCommandResult } from "../src/shared/worktree-commands";
import { recordedResult } from "./support/timber";

const REPOSITORY = "/work/sample";

describe("newWorktreeArguments", () => {
	test("options first, then --, then the name as one argument", () => {
		expect(newWorktreeArguments({ repository: REPOSITORY, name: "Fix login bug", base: null }, "/tmp/r.json"))
			.toEqual(["new", "--result-file", "/tmp/r.json", "--no-editor", "--no-agent", "--", "Fix login bug"]);
	});

	test("a base goes in as the value of --base", () => {
		expect(newWorktreeArguments({ repository: REPOSITORY, name: "feat/login", base: "origin/develop" }, "/tmp/r.json"))
			.toEqual(["new", "--base", "origin/develop", "--result-file", "/tmp/r.json", "--no-editor", "--no-agent", "--", "feat/login"]);
	});

	test("a workflow goes in as the value of --workflow, among the options before --", () => {
		expect(newWorktreeArguments({ repository: REPOSITORY, name: "feat/login", base: "develop", workflow: "review" }, "/tmp/r.json"))
			.toEqual(["new", "--base", "develop", "--workflow", "review", "--result-file", "/tmp/r.json", "--no-editor", "--no-agent", "--", "feat/login"]);
		expect(openWorktreeArguments({ repository: REPOSITORY, selector: "/work/w", setup: true, workflow: "review" }, "/tmp/r.json"))
			.toEqual(["open", "--setup", "--workflow", "review", "--result-file", "/tmp/r.json", "--no-editor", "--no-agent", "--", "/work/w"]);
		// None leaves the flag out.
		expect(newWorktreeArguments({ repository: REPOSITORY, name: "x", base: null }, "/tmp/r.json")).not.toContain("--workflow");
		expect(openWorktreeArguments({ repository: REPOSITORY, selector: "x", setup: false }, "/tmp/r.json")).not.toContain("--workflow");
	});

	test("text that looks like an option stays the name, after --", () => {
		const given = newWorktreeArguments({ repository: REPOSITORY, name: "--editor", base: null }, "/tmp/r.json");
		expect(given.at(-2)).toBe("--");
		expect(given.at(-1)).toBe("--editor");
		expect(given.filter(argument => argument === "--editor").length).toBe(1);
	});

	test("the launchers are always switched off", () => {
		for (const base of [null, "main"]) {
			const given = newWorktreeArguments({ repository: REPOSITORY, name: "x", base }, "/tmp/r.json");
			expect(given.slice(0, given.indexOf("--"))).toContain("--no-editor");
			expect(given.slice(0, given.indexOf("--"))).toContain("--no-agent");
		}
	});

	test("the command shown differs from the command run only in the result file", () => {
		const request = { repository: REPOSITORY, name: "Fix login bug", base: "develop" };
		expect(describeTimberCommand(newWorktreeArguments(request, RESULT_FILE_PLACEHOLDER)))
			.toBe("timber new --base develop --result-file <temporary file> --no-editor --no-agent -- 'Fix login bug'");
		expect(newWorktreeArguments(request, "/tmp/r.json").map(argument => argument === "/tmp/r.json" ? RESULT_FILE_PLACEHOLDER : argument))
			.toEqual(newWorktreeArguments(request, RESULT_FILE_PLACEHOLDER));
	});
});

describe("openWorktreeArguments", () => {
	test("the selector is one argument after --, with --setup only when asked", () => {
		const path = "/work/sample-worktrees/my feature";
		expect(openWorktreeArguments({ repository: REPOSITORY, selector: path, setup: true }, "/tmp/r.json"))
			.toEqual(["open", "--setup", "--result-file", "/tmp/r.json", "--no-editor", "--no-agent", "--", path]);
		expect(openWorktreeArguments({ repository: REPOSITORY, selector: "--setup", setup: false }, "/tmp/r.json"))
			.toEqual(["open", "--result-file", "/tmp/r.json", "--no-editor", "--no-agent", "--", "--setup"]);
	});

	test("is shown as it runs", () => {
		expect(describeTimberCommand(openWorktreeArguments({ repository: REPOSITORY, selector: "/work/sample-worktrees/my feature", setup: true }, RESULT_FILE_PLACEHOLDER)))
			.toBe("timber open --setup --result-file <temporary file> --no-editor --no-agent -- '/work/sample-worktrees/my feature'");
	});
});

describe("worktreeCommandResult", () => {
	const output = { text: "TOKEN=private\n", truncated: false };
	const run = (command: ResultCommand, text: string | null, exitCode: number | null): TimberRun =>
		({ command: `timber ${command} shown`, result: readTimberResult(command, text, exitCode), output });
	const altered = (fields: object) => JSON.stringify({ ...JSON.parse(recordedResult.succeeded), ...fields });
	const reported = {
		id: worktreeId("/work/sample/.git", { path: "/work/sample-worktrees/feat-login", canonicalPath: "/work/sample-worktrees/feat-login" }),
		path: "/work/sample-worktrees/feat-login",
		branch: "feat/login",
	};

	test("a succeeded record with exit code 0 is a success that names the worktree as the list does", () => {
		expect(worktreeCommandResult(run("new", recordedResult.succeeded, 0))).toEqual({ outcome: "succeeded", worktree: reported, created: true });
	});

	test("opening a worktree that existed is a success that created nothing", () => {
		expect(worktreeCommandResult(run("open", altered({ command: "open", materialized: false }), 0)))
			.toEqual({ outcome: "succeeded", worktree: reported, created: false });
	});

	test("a succeeded record with another exit code is a failure", () => {
		const result = worktreeCommandResult(run("new", recordedResult.succeeded, 1));
		expect(result).toMatchObject({ outcome: "failed", worktree: null, created: false });
	});

	test("exit code 0 without a result is a failure, whatever was printed", () => {
		const result = worktreeCommandResult(run("new", null, 0));
		expect(result).toMatchObject({ outcome: "failed", worktree: null, created: false, failure: { command: "timber new shown", output } });
		expect(result.outcome === "failed" && result.failure.diagnostic).toContain("what it did is unknown");
	});

	test("a failure before creation carries Timber's diagnostic and no worktree", () => {
		expect(worktreeCommandResult(run("new", recordedResult.failed, 1))).toEqual({
			outcome: "failed",
			failure: {
				command: "timber new shown",
				diagnostic: "Branch feat/login is already checked out at /work/sample-worktrees/feat-login. Use timber open instead.",
				output,
			},
			worktree: null,
			created: false,
		});
	});

	test("a failed record with materialized true is created, with the worktree to run setup in", () => {
		const text = altered({ outcome: "failed", exitCode: 1, diagnostic: "Setup post_create step 1 failed (exit code 7)." });
		expect(worktreeCommandResult(run("new", text, 1))).toEqual({
			outcome: "failed",
			failure: { command: "timber new shown", diagnostic: "Setup post_create step 1 failed (exit code 7).", output },
			worktree: reported,
			created: true,
		});
	});

	test("setup that fails in a worktree that existed is a failure that created nothing", () => {
		const text = altered({ command: "open", outcome: "failed", exitCode: 1, materialized: false, diagnostic: "Setup post_create step 1 failed (exit code 7)." });
		expect(worktreeCommandResult(run("open", text, 1))).toMatchObject({ outcome: "failed", worktree: reported, created: false });
	});

	test("a succeeded record without a worktree cannot be used, so it is a failure", () => {
		const result = worktreeCommandResult(run("new", altered({ worktree: null }), 0));
		expect(result).toMatchObject({ outcome: "failed", worktree: null, failure: { command: "timber new shown", output } });
		expect(result.outcome === "failed" && result.failure.diagnostic).toContain("what happened is unknown");
	});

	test("a succeeded record that does not say which repository is a failure too", () => {
		expect(worktreeCommandResult(run("new", altered({ repository: null }), 0))).toMatchObject({ outcome: "failed", worktree: null });
	});

	test("cancelled stays cancelled", () => {
		const text = JSON.stringify({ ...JSON.parse(recordedResult.failed), outcome: "cancelled", exitCode: 0, diagnostic: null });
		expect(worktreeCommandResult(run("new", text, 0))).toEqual({ outcome: "cancelled" });
	});

	test("a missing or replaced folder is named by its registered path, as in the list", () => {
		const record = JSON.parse(recordedResult.succeeded);
		const text = JSON.stringify({ ...record, worktree: { ...record.worktree, canonicalPath: null } });
		const result = worktreeCommandResult(run("new", text, 0));
		expect(result.outcome === "succeeded" && result.worktree.id)
			.toBe(worktreeId("/work/sample/.git", { path: "/work/sample-worktrees/feat-login", canonicalPath: null }));
	});
});
