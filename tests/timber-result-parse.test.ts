import { describe, expect, test } from "bun:test";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand, failureOf, readTimberResult } from "../src/shared/timber-result";
import { recordedResult } from "./support/timber";

/** The recorded record with some fields replaced. */
const changed = (text: string, change: Record<string, unknown>) => JSON.stringify({ ...JSON.parse(text), ...change });

describe("readTimberResult", () => {
	test("reads the recorded success", () => {
		const result = readTimberResult("new", recordedResult.succeeded, 0);
		expect(result.outcome).toBe("succeeded");
		expect(result.record).toMatchObject({
			materialized: true,
			repository: { commonGitDir: "/work/sample/.git", primaryWorktreeRoot: "/work/sample" },
			worktree: { path: "/work/sample-worktrees/feat-login", branch: "feat/login", primary: false, changes: { kind: "known" } },
		});
		expect(result.record?.fields.command).toBe("new");
	});

	test("reads the recorded failure with Timber's diagnostic", () => {
		const result = readTimberResult("new", recordedResult.failed, 1);
		expect(result).toMatchObject({
			outcome: "failed",
			diagnostic: "Branch feat/login is already checked out at /work/sample-worktrees/feat-login. Use timber open instead.",
			record: { materialized: false, worktree: null },
		});
	});

	test("a failure after the worktree was created keeps the record, so the dialog can say so", () => {
		const text = changed(recordedResult.succeeded, { outcome: "failed", exitCode: 1, diagnostic: "Setup hook failed." });
		expect(readTimberResult("new", text, 1)).toMatchObject({
			outcome: "failed",
			diagnostic: "Setup hook failed.",
			record: { materialized: true, worktree: { branch: "feat/login" } },
		});
	});

	test("reads a cancelled record", () => {
		const text = changed(recordedResult.failed, { outcome: "cancelled", exitCode: 0, diagnostic: null });
		expect(readTimberResult("new", text, 0)).toMatchObject({ outcome: "cancelled", record: { worktree: null, materialized: false } });
	});

	test("a failed rebase may exit with any code but 0", () => {
		const text = changed(recordedResult.failed, { command: "rebase", exitCode: 130, rebase: { result: "failed" } });
		const result = readTimberResult("rebase", text, 130);
		expect(result.outcome).toBe("failed");
		expect(result.record?.fields.rebase).toEqual({ result: "failed" });
	});

	test("no file, an empty file, and a cut file are failures even with exit code 0", () => {
		const missing = readTimberResult("new", null, 0);
		expect(missing).toMatchObject({ outcome: "failed", record: null });
		expect(missing.outcome === "failed" && missing.diagnostic).toBe(
			"timber new exited with code 0 and left no result, so what it did is unknown. The details below show what it printed.",
		);
		for (const empty of ["", "\n", "  "]) {
			const result = readTimberResult("new", empty, 0);
			expect(result.outcome === "failed" && result.diagnostic).toContain("left an empty result");
		}
		const cut = readTimberResult("new", recordedResult.succeeded.slice(0, 200), 0);
		expect(cut.outcome === "failed" && cut.diagnostic).toContain("it is not valid JSON");
		expect(cut.record).toBeNull();
	});

	test("JSON that is not a record is a failure", () => {
		for (const text of ["[]", "null", "\"succeeded\"", "42"]) {
			expect(readTimberResult("new", text, 0)).toMatchObject({ outcome: "failed", record: null });
		}
	});

	test("an exit code that differs from the record is a failure, and the record is not used", () => {
		const result = readTimberResult("new", recordedResult.succeeded, 1);
		expect(result).toEqual({
			outcome: "failed",
			diagnostic: "timber new exited with code 1, but its result says exit code 0. The result was not used, so what it did is unknown.",
			record: null,
		});
		const stopped = readTimberResult("new", recordedResult.succeeded, null);
		expect(stopped.outcome === "failed" && stopped.diagnostic).toContain("did not exit by itself");
	});

	test("an outcome that does not go with its exit code is a failure", () => {
		expect(readTimberResult("new", changed(recordedResult.succeeded, { exitCode: 1 }), 1)).toMatchObject({ outcome: "failed", record: null });
		expect(readTimberResult("new", changed(recordedResult.failed, { exitCode: 0 }), 0)).toMatchObject({ outcome: "failed", record: null });
		expect(readTimberResult("new", changed(recordedResult.failed, { outcome: "cancelled" }), 1)).toMatchObject({ outcome: "failed", record: null });
	});

	test("a record for another command is a failure", () => {
		const result = readTimberResult("open", recordedResult.succeeded, 0);
		expect(result.outcome === "failed" && result.diagnostic).toContain("it is not a record for open");
	});

	test("an unsupported schema version is a failure", () => {
		const result = readTimberResult("new", changed(recordedResult.succeeded, { schemaVersion: 2 }), 0);
		expect(result.outcome === "failed" && result.diagnostic).toContain("schema version 2");
		expect(result.record).toBeNull();
	});

	test("a record with a field of the wrong kind is a failure", () => {
		const worktree = JSON.parse(recordedResult.succeeded).worktree;
		const broken = [
			{ outcome: "done" },
			{ exitCode: "0" },
			{ diagnostic: 5 },
			{ materialized: "yes" },
			{ repository: { commonGitDir: "" } },
			{ worktree: { ...worktree, path: 7 } },
			{ worktree: undefined },
		];
		for (const change of broken) {
			expect(readTimberResult("new", changed(recordedResult.succeeded, change), 0)).toMatchObject({ outcome: "failed", record: null });
		}
	});

	test("fields this app does not know are ignored", () => {
		const worktree = { ...JSON.parse(recordedResult.succeeded).worktree, base: { kind: "assigned", ref: "refs/remotes/origin/main" } };
		expect(readTimberResult("new", changed(recordedResult.succeeded, { worktree, later: true }), 0).outcome).toBe("succeeded");
	});

	test("a failure without a diagnostic still says something", () => {
		const result = readTimberResult("new", changed(recordedResult.failed, { diagnostic: null }), 1);
		expect(result.outcome === "failed" && result.diagnostic).toBe("timber new failed without saying why.");
	});
});

describe("describeTimberCommand", () => {
	test("quotes only what needs it, and leaves the result file placeholder as it is", () => {
		expect(describeTimberCommand(["new", "feat/login", "--result-file", RESULT_FILE_PLACEHOLDER, "--no-editor", "--no-agent"]))
			.toBe("timber new feat/login --result-file <temporary file> --no-editor --no-agent");
		expect(describeTimberCommand(["new", "fix the login page", "--base", "origin/main"])).toBe("timber new 'fix the login page' --base origin/main");
		expect(describeTimberCommand(["open", "--", "/work/it's here/zażółć"])).toBe("timber open -- '/work/it'\\''s here/zażółć'");
		expect(describeTimberCommand(["new", ""])).toBe("timber new ''");
	});
});

describe("failureOf", () => {
	const output = { text: "error: no\n", truncated: false };

	test("a failed run becomes the failure to show", () => {
		const run = { command: "timber new x", result: readTimberResult("new", recordedResult.failed, 1), output };
		expect(failureOf(run)).toEqual({
			command: "timber new x",
			diagnostic: "Branch feat/login is already checked out at /work/sample-worktrees/feat-login. Use timber open instead.",
			output,
		});
	});

	test("a run that worked has none", () => {
		expect(failureOf({ command: "timber new x", result: readTimberResult("new", recordedResult.succeeded, 0), output })).toBeNull();
	});
});
