import { describe, expect, test } from "bun:test";
import { readRebaseResult, rebaseResultArguments, shortBase } from "../src/shared/timber-rebase";
import { RESULT_FILE_PLACEHOLDER, type TimberRun, describeTimberCommand, readTimberResult } from "../src/shared/timber-result";
import { recordedRebase } from "./support/timber";

const WORKTREE = "/work/sample-worktrees/feat";
const COMMAND = "timber rebase --base refs/heads/main --result-file <temporary file> -- /work/sample-worktrees/feat";
const OUTPUT = { text: "error: printed by timber\n", truncated: false };

/** One run as the main process reads it: the result file's text and the exit code the process really had. */
function runOf(text: string | null, exitCode: number | null): TimberRun {
	return { command: COMMAND, result: readTimberResult("rebase", text, exitCode), output: OUTPUT };
}

/** A recorded record with some fields replaced, and some of its rebase object replaced. */
function changed(text: string, change: Record<string, unknown>, rebase: Record<string, unknown> = {}): string {
	const record = JSON.parse(text);
	return JSON.stringify({ ...record, ...change, rebase: { ...record.rebase, ...rebase } });
}

const read = (text: string | null, exitCode: number | null, worktree = WORKTREE) => readRebaseResult(runOf(text, exitCode), worktree);

/** Every failure that is not a usable answer says the same thing in Timber's voice, with what Timber printed. */
function expectUnknown(result: ReturnType<typeof read>, detail: string) {
	expect(result).toMatchObject({ outcome: "failed", ran: true, failure: { command: COMMAND, output: OUTPUT } });
	if (result.outcome !== "failed") return;
	expect(result.failure.diagnostic).toContain("and left a result this app cannot read");
	expect(result.failure.diagnostic).toContain(detail);
	expect(result.failure.diagnostic).toContain("so what it did is unknown");
}

describe("rebaseResultArguments", () => {
	test("puts the result file before the worktree, which stays after `--`", () => {
		expect(rebaseResultArguments({ worktree: "/work/w", onto: null }, "/tmp/r.json")).toEqual(["rebase", "--result-file", "/tmp/r.json", "--", "/work/w"]);
		expect(rebaseResultArguments({ worktree: "/work/w", onto: "refs/heads/main" }, "/tmp/r.json")).toEqual(["rebase", "--base", "refs/heads/main", "--result-file", "/tmp/r.json", "--", "/work/w"]);
	});

	test("text that starts with a dash is never read as an option", () => {
		const given = rebaseResultArguments({ worktree: "--weird", onto: "--onto" }, "/tmp/r.json");
		expect(given.indexOf("--")).toBe(given.length - 2);
		expect(given.at(-1)).toBe("--weird");
		expect(given.slice(0, given.indexOf("--"))).toContain("--onto");
	});

	test("the shown command is the same arguments with the placeholder", () => {
		expect(describeTimberCommand(rebaseResultArguments({ worktree: WORKTREE, onto: "refs/heads/main" }, RESULT_FILE_PLACEHOLDER))).toBe(COMMAND);
	});
});

describe("shortBase", () => {
	test("drops the ref prefix a person does not say", () => {
		expect(shortBase("refs/remotes/origin/main")).toBe("origin/main");
		expect(shortBase("refs/heads/release/1.0")).toBe("release/1.0");
		expect(shortBase("something")).toBe("something");
		expect(shortBase(null)).toBe("its saved base");
	});

	test("a commit base, which Timber reports by its full hash, is its first seven characters", () => {
		expect(shortBase("9f8e7d6c5b4a39281706f5e4d3c2b1a098765432")).toBe("9f8e7d6");
		expect(shortBase("9f8e7d6c5b4a39281706f5e4d3c2b1a0987654329f8e7d6c5b4a39281706f5e4")).toBe("9f8e7d6");
		// A branch whose name looks like a hash is still a ref.
		expect(shortBase("refs/heads/9f8e7d6c5b4a39281706f5e4d3c2b1a098765432")).toBe("9f8e7d6c5b4a39281706f5e4d3c2b1a098765432");
	});
});

describe("readRebaseResult, with records Timber 0.1.2 wrote", () => {
	test("rebased: the base it landed on and the commit it rewrote from", () => {
		expect(read(recordedRebase.rebased, 0)).toEqual({
			outcome: "rebased",
			base: "refs/heads/main",
			baseCommit: JSON.parse(recordedRebase.rebased).rebase.baseCommit,
			originalTip: JSON.parse(recordedRebase.rebased).rebase.originalTip,
			baseSaved: true,
		});
	});

	test("up to date: nothing was rewritten, and the record has no conflicts", () => {
		const result = read(recordedRebase.upToDate, 0);
		expect(result).toEqual({ outcome: "up-to-date", base: "refs/heads/main", baseCommit: JSON.parse(recordedRebase.upToDate).rebase.baseCommit, baseSaved: true });
	});

	test("conflicts: every conflicted path, in the order Timber lists them, and Timber's diagnostic and output", () => {
		const result = read(recordedRebase.conflicts, 1);
		expect(result).toMatchObject({
			outcome: "conflicts",
			base: "refs/heads/main",
			baseSaved: true,
			conflicts: ["a.txt", "my file.txt"],
			failure: {
				command: COMMAND,
				diagnostic: "Rebase paused with conflicts; resolve and stage them, then continue or abort with Git in the worktree.",
				output: OUTPUT,
			},
		});
		if (result.outcome === "conflicts") expect(result.originalTip).toBe(JSON.parse(recordedRebase.conflicts).rebase.originalTip);
	});

	test("refused: Timber's reason, with no base and nothing saved", () => {
		expect(read(recordedRebase.refused, 1)).toEqual({
			outcome: "refused",
			failure: {
				command: COMMAND,
				diagnostic: "Rebase requires a clean index/worktree with no staged, unstaged, unmerged or untracked files; preserve them first.",
				output: OUTPUT,
			},
		});
	});

	test("failed, from a rejecting hook: it ran, and the base was known but not saved", () => {
		expect(read(recordedRebase.failedHook, 1)).toEqual({
			outcome: "failed",
			ran: true,
			failure: { command: COMMAND, diagnostic: "Git rebase failed or was interrupted; inspect the worktree with Git before retrying.", output: OUTPUT },
		});
	});

	test("failed, from a base that could not be fetched: Timber's diagnostic", () => {
		expect(read(recordedRebase.failedFetch, 1)).toMatchObject({
			outcome: "failed",
			ran: true,
			failure: { diagnostic: "Could not discover the live remote base; check authentication/network access. Rebase was not started." },
		});
	});

	test("each recorded outcome is distinct", () => {
		const outcomes = [
			read(recordedRebase.rebased, 0), read(recordedRebase.upToDate, 0), read(recordedRebase.conflicts, 1),
			read(recordedRebase.refused, 1), read(recordedRebase.failedHook, 1),
		].map(result => result.outcome);
		expect(outcomes).toEqual(["rebased", "up-to-date", "conflicts", "refused", "failed"]);
	});
});

describe("readRebaseResult, with a record that cannot be used", () => {
	test("no file is a failed run whose effect is unknown", () => {
		const result = read(null, 1);
		expect(result).toMatchObject({ outcome: "failed", ran: true, failure: { command: COMMAND, output: OUTPUT } });
		if (result.outcome === "failed") expect(result.failure.diagnostic).toContain("left no result, so what it did is unknown");
	});

	test("a process that was stopped by a signal leaves no result either", () => {
		const result = read(null, null);
		if (result.outcome === "failed") expect(result.failure.diagnostic).toContain("did not exit by itself");
		expect(result.outcome).toBe("failed");
	});

	test("a record with no rebase object", () => {
		const record = JSON.parse(recordedRebase.rebased);
		delete record.rebase;
		expectUnknown(read(JSON.stringify(record), 0), "it has no rebase object");
	});

	test("a result Timber could not say it knew", () => {
		expectUnknown(read(changed(recordedRebase.rebased, {}, { result: "merged" }), 0), "its rebase result is not one this app knows");
	});

	test("fields of the wrong type", () => {
		expectUnknown(read(changed(recordedRebase.rebased, {}, { base: 5 }), 0), "not text");
		expectUnknown(read(changed(recordedRebase.rebased, {}, { conflicts: "a.txt" }), 0), "not a list of paths");
		expectUnknown(read(changed(recordedRebase.rebased, {}, { conflicts: [1] }), 0), "not a list of paths");
		expectUnknown(read(changed(recordedRebase.rebased, {}, { baseSaved: "yes" }), 0), "whether the base was saved");
	});

	test("a rebased result with a failed outcome, and a failed result with a succeeded one", () => {
		expectUnknown(read(changed(recordedRebase.rebased, { outcome: "failed", exitCode: 1, diagnostic: "No." }), 1), `its result "rebased" does not go with its outcome "failed"`);
		expectUnknown(read(changed(recordedRebase.refused, { outcome: "succeeded", exitCode: 0, diagnostic: null }), 0), `its result "refused" does not go with its outcome "succeeded"`);
		expectUnknown(read(changed(recordedRebase.conflicts, { outcome: "succeeded", exitCode: 0, diagnostic: null }), 0), `its result "conflicts" does not go with its outcome`);
	});

	test("conflicts with no file listed", () => {
		expectUnknown(read(changed(recordedRebase.conflicts, {}, { conflicts: [] }), 1), "lists no file");
	});

	test("conflicted files on a result that is not conflicts", () => {
		expectUnknown(read(changed(recordedRebase.rebased, {}, { conflicts: ["a.txt"] }), 0), `lists conflicted files for a result of "rebased"`);
		expectUnknown(read(changed(recordedRebase.refused, {}, { conflicts: ["a.txt"] }), 1), `lists conflicted files for a result of "refused"`);
	});

	test("a cancelled record, which a rebase never writes", () => {
		expectUnknown(read(changed(recordedRebase.refused, { outcome: "cancelled", exitCode: 0, diagnostic: null }), 0), "cancelled");
	});

	test("a record about another worktree is not used", () => {
		const result = read(recordedRebase.rebased, 0, "/work/sample-worktrees/other");
		expect(result).toMatchObject({ outcome: "failed", ran: true });
		if (result.outcome === "failed") {
			expect(result.failure.diagnostic).toContain("/work/sample-worktrees/feat, not for /work/sample-worktrees/other");
			expect(result.failure.diagnostic).toContain("what the rebase did is unknown");
		}
	});

	test("a record that names no worktree is used as it is", () => {
		expect(read(changed(recordedRebase.refused, { worktree: null }), 1).outcome).toBe("refused");
	});

	test("an exit code that is not the process's is no result", () => {
		const result = read(recordedRebase.rebased, 1);
		expect(result).toMatchObject({ outcome: "failed", ran: true });
		if (result.outcome === "failed") expect(result.failure.diagnostic).toContain("but its result says exit code 0");
	});

	test("a record for another command", () => {
		expect(read(changed(recordedRebase.rebased, { command: "new" }), 0)).toMatchObject({ outcome: "failed", ran: true });
	});
});
