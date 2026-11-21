import { describe, expect, test } from "bun:test";
import { type TimberListing, readTimberListing } from "../src/shared/timber-ls";
import { recorded } from "./support/timber";

/** The recorded success with some fields of the record replaced. */
function altered(change: (record: Record<string, any>) => void): string {
	const record = JSON.parse(recorded.succeeded);
	change(record);
	return JSON.stringify(record);
}

function listed(listing: TimberListing) {
	if (!listing.ok) throw new Error(`Expected a list, got: ${listing.message}`);
	return listing;
}

function messageOf(listing: TimberListing): string {
	if (listing.ok) throw new Error("Expected a failure, got a list");
	return listing.message;
}

describe("a recorded successful listing", () => {
	const listing = listed(readTimberListing(recorded.succeeded, 0));
	const byBranch = (branch: string | null) => listing.worktrees.find(worktree => worktree.branch === branch)!;

	test("names the repository by its common Git directory and primary checkout", () => {
		expect(listing.repository).toEqual({ commonGitDir: "/work/sample/.git", primaryWorktreeRoot: "/work/sample" });
	});

	test("keeps every worktree, in Timber's order", () => {
		expect(listing.worktrees.map(worktree => worktree.path)).toEqual([
			"/work/sample",
			"/work/sample-worktrees/detached",
			"/work/sample-worktrees/feat-x",
			"/work/sample-worktrees/gone",
			"/work/sample-worktrees/kept",
			"/work/sample-worktrees/swapped",
			"/work/sample-worktrees/zażółć gęślą jaźń",
		]);
	});

	test("maps the primary checkout", () => {
		expect(byBranch("main")).toEqual({
			path: "/work/sample",
			canonicalPath: "/work/sample",
			branch: "main",
			head: "c42c7d84343eb4d8ac9bff5dfeb489b57da8196f",
			primary: true,
			detached: false,
			locked: false,
			prunable: false,
			pathExists: true,
			changes: { kind: "known", modified: [], untracked: [] },
			base: null,
			issue: null,
		});
		expect(listing.worktrees.filter(worktree => worktree.primary).length).toBe(1);
	});

	test("maps known status with its modified and untracked paths, and leaves ignored files out", () => {
		expect(byBranch("feat/x").changes).toEqual({ kind: "known", modified: ["tracked.txt"], untracked: ["new file.txt"] });
	});

	test("maps a detached HEAD", () => {
		expect(byBranch(null)).toMatchObject({ path: "/work/sample-worktrees/detached", detached: true, branch: null, head: "c42c7d84343eb4d8ac9bff5dfeb489b57da8196f" });
		expect(listing.worktrees.filter(worktree => worktree.detached).length).toBe(1);
	});

	test("maps a missing folder: still listed, status unknown, no canonical path", () => {
		expect(byBranch("gone")).toMatchObject({
			path: "/work/sample-worktrees/gone",
			canonicalPath: null,
			pathExists: false,
			prunable: true,
			locked: false,
			changes: { kind: "unknown", reason: "Worktree path is missing" },
		});
	});

	test("maps unknown status on a folder that exists", () => {
		expect(byBranch("swapped")).toMatchObject({
			canonicalPath: null,
			pathExists: true,
			prunable: true,
			changes: { kind: "unknown", reason: "Path no longer identifies this Git worktree" },
		});
	});

	test("maps a locked worktree", () => {
		expect(byBranch("kept")).toMatchObject({ locked: true, prunable: false, pathExists: true });
	});

	test("keeps spaces and non-ASCII characters in paths, branches, and file names", () => {
		expect(byBranch("zażółć/gęślą")).toMatchObject({
			path: "/work/sample-worktrees/zażółć gęślą jaźń",
			canonicalPath: "/work/sample-worktrees/zażółć gęślą jaźń",
			changes: { kind: "known", modified: [], untracked: ["日本語 メモ.txt"] },
		});
	});

	test("decodes escaped characters in a path to the literal characters", () => {
		const text = recorded.succeeded.replaceAll("/work/sample-worktrees/feat-x", "/work/tab\\there/line\\nbreak/\\u00e9");
		const paths = listed(readTimberListing(text, 0)).worktrees.map(worktree => worktree.path);
		expect(paths).toContain("/work/tab\there/line\nbreak/é");
	});

	test("ignores fields that a later Timber adds within version 1", () => {
		const text = altered(record => {
			record.later = { anything: true };
			for (const worktree of record.worktrees) worktree.later = { kind: "anything" };
		});
		expect(listed(readTimberListing(text, 0)).worktrees).toEqual(listing.worktrees);
	});

	test("accepts an empty list", () => {
		expect(listed(readTimberListing(altered(record => { record.worktrees = []; }), 0)).worktrees).toEqual([]);
	});
});

describe("a failed listing is an error, never a list", () => {
	test("a recorded failure gives Timber's diagnostic", () => {
		expect(readTimberListing(recorded.failed, 1)).toEqual({ ok: false, message: "Not a Git repository: /work/plain" });
	});

	test("a failure keeps its diagnostic even when it carries worktrees", () => {
		const text = altered(record => Object.assign(record, { outcome: "failed", exitCode: 1, diagnostic: "Could not read configuration." }));
		expect(readTimberListing(text, 1)).toEqual({ ok: false, message: "Could not read configuration." });
	});

	test("an unsupported schema version", () => {
		const message = messageOf(readTimberListing(altered(record => { record.schemaVersion = 2; }), 0));
		expect(message).toContain("schema version 2");
		expect(message).toContain("reads version 1 only");
		expect(messageOf(readTimberListing(altered(record => { delete record.schemaVersion; }), 0))).toContain("schema version none");
		expect(messageOf(readTimberListing(altered(record => { record.schemaVersion = "1"; }), 0))).toContain("schema version 1,");
	});

	test("malformed JSON", () => {
		const cut = recorded.succeeded.slice(0, recorded.succeeded.length / 2);
		expect(messageOf(readTimberListing(cut, 0))).toContain("the output is not valid JSON");
		expect(messageOf(readTimberListing("", 0))).toContain("it printed nothing");
		expect(messageOf(readTimberListing(`warning: something\n${recorded.succeeded}`, 0))).toContain("not valid JSON");
		expect(messageOf(readTimberListing("[]", 0))).toContain("not a JSON object");
		expect(messageOf(readTimberListing("null", 0))).toContain("not a JSON object");
	});

	test("an exit code that does not match the record", () => {
		expect(messageOf(readTimberListing(recorded.succeeded, 1)))
			.toBe("timber ls --json exited with code 1, but its record says exit code 0. The list was not used.");
		expect(messageOf(readTimberListing(recorded.failed, 0))).toContain("exited with code 0, but its record says exit code 1");
		expect(messageOf(readTimberListing(recorded.succeeded, null))).toContain("did not exit by itself");
	});

	test("an outcome that does not go with its exit code", () => {
		expect(messageOf(readTimberListing(altered(record => { record.outcome = "failed"; }), 0))).toContain("does not go with exit code 0");
		expect(messageOf(readTimberListing(altered(record => { record.exitCode = 3; }), 3))).toContain("does not go with exit code 3");
	});

	test("a record for another command, a cancelled one, or one with missing parts", () => {
		expect(messageOf(readTimberListing(altered(record => { record.command = "new"; }), 0))).toContain("not a record for ls");
		expect(messageOf(readTimberListing(altered(record => { record.outcome = "cancelled"; }), 0))).toContain("was cancelled");
		expect(messageOf(readTimberListing(altered(record => { record.outcome = "done"; }), 0))).toContain("outcome");
		expect(messageOf(readTimberListing(altered(record => { delete record.worktrees; }), 0))).toContain("no list of worktrees");
		expect(messageOf(readTimberListing(altered(record => { record.repository = null; }), 0))).toContain("which repository");
		expect(messageOf(readTimberListing(altered(record => { delete record.exitCode; }), 0))).toContain("no exit code");
	});

	test("one unreadable worktree fails the whole list", () => {
		const breaks: ((worktree: Record<string, any>) => void)[] = [
			worktree => { delete worktree.path; },
			worktree => { worktree.isPrimary = "yes"; },
			worktree => { worktree.status = { kind: "known", modified: [1], untracked: [] }; },
			worktree => { worktree.status = { kind: "dirty" }; },
			worktree => { worktree.locked = true; },
			worktree => { delete worktree.canonicalPath; },
			worktree => { delete worktree.pathExists; },
		];
		for (const damage of breaks) {
			const text = altered(record => damage(record.worktrees[4]));
			expect(messageOf(readTimberListing(text, 0))).toContain("worktree 5 of 7 is not a worktree record");
		}
	});
});

describe("the saved base", () => {
	const bases = (text: string) => Object.fromEntries(listed(readTimberListing(text, 0)).worktrees.map(worktree => [worktree.branch, worktree.base]));
	const withBase = (base: unknown) => altered(record => {
		record.worktrees[1].base = base;
	});

	test("a recorded listing of Timber 0.1.2 gives every worktree its base: assigned, unassigned, or invalid with the reason", () => {
		expect(bases(recorded.withBases)).toEqual({
			"main": { kind: "unassigned" },
			"feat/based": { kind: "assigned", ref: "refs/remotes/origin/main" },
			"feat/local": { kind: "assigned", ref: "refs/heads/main" },
			"feat/broken": { kind: "invalid", reason: "malformed" },
			"plain": { kind: "unassigned" },
			"gone": { kind: "invalid", reason: "stale" },
			"swapped": { kind: "invalid", reason: "stale" },
		});
	});

	test("invalid metadata never hides the worktree's row", () => {
		expect(listed(readTimberListing(recorded.withBases, 0)).worktrees.length).toBe(7);
	});

	test("a record from a Timber before the field has no base at all, and the list is still read", () => {
		expect(recorded.succeeded).not.toContain('"base"');
		const listing = listed(readTimberListing(recorded.succeeded, 0));
		expect(listing.worktrees.length).toBe(7);
		expect(listing.worktrees.every(worktree => worktree.base === null)).toBe(true);
	});

	test("every reason for invalid metadata is kept", () => {
		for (const reason of ["malformed", "stale", "unreadable"] as const) {
			expect(listed(readTimberListing(withBase({ kind: "invalid", reason }), 0)).worktrees[1]!.base).toEqual({ kind: "invalid", reason });
		}
	});

	test("the ref is kept exactly as saved", () => {
		expect(listed(readTimberListing(withBase({ kind: "assigned", ref: "refs/remotes/fork/feat/zażółć x" }), 0)).worktrees[1]!.base)
			.toEqual({ kind: "assigned", ref: "refs/remotes/fork/feat/zażółć x" });
	});

	test("a commit base is kept by its full hash, SHA-1 or SHA-256", () => {
		for (const commit of ["9f8e7d6c5b4a39281706f5e4d3c2b1a098765432", "9f8e7d6c5b4a39281706f5e4d3c2b1a0987654329f8e7d6c5b4a39281706f5e4"]) {
			expect(listed(readTimberListing(withBase({ kind: "commit", commit }), 0)).worktrees[1]!.base).toEqual({ kind: "commit", commit });
		}
	});

	test("a base field the contract does not describe refuses the list, so no base is ever guessed", () => {
		const commitBases = [
			{ kind: "commit" }, { kind: "commit", commit: "" }, { kind: "commit", commit: 7 }, { kind: "commit", commit: "9f8e7d6" },
			{ kind: "commit", commit: "9F8E7D6C5B4A39281706F5E4D3C2B1A098765432" }, { kind: "commit", commit: "9f8e7d6c5b4a39281706f5e4d3c2b1a0987654320" }, { kind: "commit", commit: "9f8e7d6c5b4a39281706f5e4d3c2b1a0987654329f8e7d6c5b4a39281706f5e" },
			{ kind: "commit", commit: "refs/heads/main" }, { kind: "commit", ref: "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432" },
		];
		for (const base of [null, "origin/main", [], {}, { kind: "assigned" }, { kind: "assigned", ref: "" }, { kind: "assigned", ref: 7 }, { kind: "invalid" }, { kind: "invalid", reason: "odd" }, { kind: "inferred", ref: "refs/heads/main" }, ...commitBases]) {
			expect(messageOf(readTimberListing(withBase(base), 0))).toContain("worktree 2 of 7 is not a worktree record");
		}
	});
});

describe("the saved issue link", () => {
	const issues = (text: string) => Object.fromEntries(listed(readTimberListing(text, 0)).worktrees.map(worktree => [worktree.branch, worktree.issue]));
	const withIssue = (issue: unknown) => altered(record => {
		record.worktrees[1].issue = issue;
	});

	test("a recorded listing gives every worktree its issue: linked, none, or invalid with the reason", () => {
		expect(issues(recorded.withIssues)).toEqual({
			"main": { kind: "none" },
			"plain": { kind: "none" },
			"feat/jira": { kind: "linked", tracker: "jira", key: "PROJ-123", url: "https://example.atlassian.net/browse/PROJ-123" },
			"feat/github": { kind: "linked", tracker: "github", key: "153", url: "https://github.com/example/sample/issues/153" },
			"feat/linear": { kind: "linked", tracker: "linear", key: "ENG-12", url: "https://linear.app/example/issue/ENG-12/add-sign-in" },
			"feat/broken": { kind: "invalid", reason: "malformed" },
		});
	});

	test("a record from a Timber before the field has no issue at all, and the list is still read", () => {
		expect(recorded.withBases).not.toContain('"issue"');
		const listing = listed(readTimberListing(recorded.withBases, 0));
		expect(listing.worktrees.length).toBe(7);
		expect(listing.worktrees.every(worktree => worktree.issue === null)).toBe(true);
	});

	test("every reason for invalid metadata is kept", () => {
		for (const reason of ["malformed", "stale", "unreadable"] as const) {
			expect(listed(readTimberListing(withIssue({ kind: "invalid", reason }), 0)).worktrees[1]!.issue).toEqual({ kind: "invalid", reason });
		}
	});

	test("an issue field the contract does not describe refuses the list, so no issue is ever guessed", () => {
		const url = "https://example.atlassian.net/browse/PROJ-1";
		for (const issue of [
			null, "jira:PROJ-1", [], {}, { kind: "linked" },
			{ kind: "linked", tracker: "asana", key: "PROJ-1", url },
			{ kind: "linked", tracker: "jira", key: "", url },
			{ kind: "linked", tracker: "jira", key: 1, url },
			{ kind: "linked", tracker: "jira", key: "PROJ-1", url: "http://example.atlassian.net/browse/PROJ-1" },
			{ kind: "linked", tracker: "jira", key: "PROJ-1", url: "not a link" },
			{ kind: "linked", tracker: "jira", key: "PROJ-1" },
			{ kind: "invalid" }, { kind: "invalid", reason: "odd" }, { kind: "guessed" },
		]) {
			expect(messageOf(readTimberListing(withIssue(issue), 0))).toContain("worktree 2 of 7 is not a worktree record");
		}
	});
});
