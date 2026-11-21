import { describe, expect, test } from "bun:test";
import { readSetBaseResult, setBaseResultArguments } from "../src/shared/timber-base";
import { RESULT_FILE_PLACEHOLDER, type TimberRun, describeTimberCommand, readTimberResult } from "../src/shared/timber-result";
import { recordedBase } from "./support/timber";

const WORKTREE = "/work/sample-worktrees/feat";
const COMMAND = "timber base --set origin/main --result-file <temporary file> -- /work/sample-worktrees/feat";
const OUTPUT = { text: "error: printed by timber\n", truncated: false };

/** One run as the main process reads it: the result file's text and the exit code the process really had. */
function runOf(text: string | null, exitCode: number | null): TimberRun {
	return { command: COMMAND, result: readTimberResult("base", text, exitCode), output: OUTPUT };
}

/** A recorded record with some fields replaced, and some of its baseChange object replaced. */
function changed(text: string, change: Record<string, unknown>, baseChange: Record<string, unknown> = {}): string {
	const record = JSON.parse(text);
	return JSON.stringify({ ...record, ...change, baseChange: { ...record.baseChange, ...baseChange } });
}

const read = (text: string | null, exitCode: number | null, worktree = WORKTREE) => readSetBaseResult(runOf(text, exitCode), worktree);

/** Every record that cannot be used says the same thing in Timber's voice, with what Timber printed. */
function expectUnknown(result: ReturnType<typeof read>, detail: string) {
	expect(result).toMatchObject({ outcome: "failed", ran: true, failure: { command: COMMAND, output: OUTPUT } });
	if (result.outcome !== "failed") return;
	expect(result.failure.diagnostic).toContain("timber base exited with code");
	expect(result.failure.diagnostic).toContain(detail);
	expect(result.failure.diagnostic).toContain("so what it did is unknown");
}

describe("setBaseResultArguments", () => {
	test("the base after --set, the result file, then the registered path after --", () => {
		expect(setBaseResultArguments({ worktree: WORKTREE, base: "origin/main" }, "/tmp/result.json"))
			.toEqual(["base", "--set", "origin/main", "--result-file", "/tmp/result.json", "--", WORKTREE]);
	});

	test("a path that starts with a dash stays one argument after --, and the shown command quotes what needs it", () => {
		const shown = describeTimberCommand(setBaseResultArguments({ worktree: "-my tree", base: "refs/heads/main" }, RESULT_FILE_PLACEHOLDER));
		expect(shown).toBe("timber base --set refs/heads/main --result-file <temporary file> -- '-my tree'");
	});
});

describe("readSetBaseResult, with records recorded from Timber 0.1.4", () => {
	test("set from none: the base before and the base read back after", () => {
		expect(read(recordedBase.setFromNone, 0)).toEqual({
			outcome: "set",
			previous: { kind: "unassigned" },
			current: { kind: "assigned", ref: "refs/heads/main" },
		});
	});

	test("set over another base: the remote branch saved as its canonical ref", () => {
		expect(read(recordedBase.setChange, 0)).toEqual({
			outcome: "set",
			previous: { kind: "assigned", ref: "refs/heads/main" },
			current: { kind: "assigned", ref: "refs/remotes/origin/main" },
		});
	});

	test("set over stale metadata: Timber replaces it", () => {
		expect(read(recordedBase.setOverStale, 0)).toEqual({
			outcome: "set",
			previous: { kind: "invalid", reason: "stale" },
			current: { kind: "assigned", ref: "refs/heads/other" },
		});
	});

	test("set to a full commit hash: a commit base", () => {
		expect(read(recordedBase.setCommit, 0)).toEqual({
			outcome: "set",
			previous: { kind: "assigned", ref: "refs/heads/main" },
			current: { kind: "commit", commit: "17c50618a548be6c58229800883ce5e0cc138b29" },
		});
	});

	test("refused, for a local branch that is not there: Timber's reason", () => {
		expect(read(recordedBase.refusedUnknown, 1)).toEqual({
			outcome: "refused",
			failure: { command: COMMAND, diagnostic: "Local base is missing or invalid; choose a replacement with --set refs/heads/<branch>.", output: OUTPUT },
		});
	});

	test("refused, for the worktree's own branch", () => {
		expect(read(recordedBase.refusedOwnBranch, 1)).toMatchObject({
			outcome: "refused",
			failure: { diagnostic: "Cannot use the worktree's own branch as its base; select another branch with --set." },
		});
	});

	test("refused, over saved metadata Timber cannot use", () => {
		expect(read(recordedBase.refusedInvalidMetadata, 1)).toMatchObject({
			outcome: "refused",
			failure: { diagnostic: "Saved base metadata is malformed or unreadable; inspect the worktree's private Git metadata before changing its base." },
		});
	});

	test("failed, for a remote that could not be reached: it ran, with Timber's reason", () => {
		expect(read(recordedBase.failedRemote, 1)).toEqual({
			outcome: "failed",
			ran: true,
			failure: { command: COMMAND, diagnostic: "Could not discover the live remote base; check authentication/network access. The base was not changed.", output: OUTPUT },
		});
	});
});

describe("readSetBaseResult, with a record that cannot be used", () => {
	test("no file is a failed run whose effect is unknown", () => {
		const result = read(null, 1);
		expect(result).toMatchObject({ outcome: "failed", ran: true, failure: { command: COMMAND, output: OUTPUT } });
		if (result.outcome === "failed") expect(result.failure.diagnostic).toContain("left no result, so what it did is unknown");
	});

	test("a record for another command", () => {
		const result = read(changed(recordedBase.setFromNone, { command: "rebase" }), 0);
		expect(result.outcome).toBe("failed");
		if (result.outcome === "failed") expect(result.failure.diagnostic).toContain("it is not a record for base");
	});

	test("a record with no baseChange object", () => {
		const record = JSON.parse(recordedBase.setFromNone);
		delete record.baseChange;
		expectUnknown(read(JSON.stringify(record), 0), "it has no baseChange object");
	});

	test("a record of clearing the base", () => {
		expectUnknown(read(changed(recordedBase.setFromNone, {}, { action: "clear", result: "cleared" }), 0), "it is not a record of setting a base");
	});

	test("a result this app does not know", () => {
		expectUnknown(read(changed(recordedBase.setFromNone, {}, { result: "moved" }), 0), "its base change result is not one this app knows");
	});

	test("a set result with a failed outcome, and a refusal with a succeeded one", () => {
		expectUnknown(read(changed(recordedBase.refusedUnknown, {}, { result: "set" }), 1), `its result "set" does not go with its outcome "failed"`);
		expectUnknown(read(changed(recordedBase.setFromNone, {}, { result: "refused" }), 0), `its result "refused" does not go with its outcome "succeeded"`);
	});

	test("a set result whose base read back is not assigned", () => {
		expectUnknown(read(changed(recordedBase.setFromNone, {}, { current: { kind: "unassigned" } }), 0), "does not report the saved base");
		expectUnknown(read(changed(recordedBase.setFromNone, {}, { current: null }), 0), "does not report the saved base");
		expectUnknown(read(changed(recordedBase.setFromNone, {}, { previous: null }), 0), "does not report the saved base");
	});

	test("a base that is not a saved base, or is missing", () => {
		expectUnknown(read(changed(recordedBase.setFromNone, {}, { current: { kind: "assigned", ref: "" } }), 0), "its previous or current base is not a saved base");
		const record = JSON.parse(recordedBase.setFromNone);
		delete record.baseChange.previous;
		expectUnknown(read(JSON.stringify(record), 0), "its previous or current base is not a saved base");
	});

	test("a record about another worktree is not used", () => {
		const result = read(recordedBase.setFromNone, 0, "/work/sample-worktrees/other");
		expect(result).toMatchObject({ outcome: "failed", ran: true, failure: { command: COMMAND, output: OUTPUT } });
		if (result.outcome === "failed") expect(result.failure.diagnostic).toContain("not for /work/sample-worktrees/other");
	});

	test("a record that says it was cancelled", () => {
		expectUnknown(read(changed(recordedBase.setFromNone, { outcome: "cancelled" }), 0), "it says it was cancelled");
	});
});
