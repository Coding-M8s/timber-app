import { describe, expect, test } from "bun:test";
import { type ReviewerRequestOutcome, initialPullRequestBase, prResultArguments, pullRequestBaseFromText, pullRequestReviewersFromText, readPrResult } from "../src/shared/timber-pr";
import { RESULT_FILE_PLACEHOLDER, type TimberRun, describeTimberCommand, readTimberResult } from "../src/shared/timber-result";
import { recordedPr } from "./support/timber";

const WORKTREE = "/work/sample-worktrees/feat";
const COMMAND = "timber pr --title 'Add login' --result-file <temporary file> -- /work/sample-worktrees/feat";
const OUTPUT = { text: "error: printed by timber\n", truncated: false };

function runOf(text: string | null, exitCode: number | null): TimberRun {
	return { command: COMMAND, result: readTimberResult("pr", text, exitCode), output: OUTPUT };
}

/** A record with some fields replaced, and some of its pr object replaced. */
function changed(text: string, change: Record<string, unknown>, pr: Record<string, unknown> = {}): string {
	const record = JSON.parse(text);
	return JSON.stringify({ ...record, ...change, pr: { ...record.pr, ...pr } });
}

const read = (text: string | null, exitCode: number | null, worktree = WORKTREE) => readPrResult(runOf(text, exitCode), worktree);

function expectUnknown(result: ReturnType<typeof read>, detail: string) {
	expect(result).toMatchObject({ outcome: "failed", ran: true, published: null, failure: { command: COMMAND, output: OUTPUT } });
	if (result.outcome !== "failed") return;
	expect(result.failure.diagnostic).toContain("left a result this app cannot read");
	expect(result.failure.diagnostic).toContain(detail);
	expect(result.failure.diagnostic).toContain("so what it did is unknown");
}

const base = { worktree: WORKTREE, title: "Add login", body: "", base: null, draft: false, reviewers: [] as string[] };

describe("prResultArguments", () => {
	test("always passes the title, and only the options that were filled in", () => {
		expect(prResultArguments(base, "/tmp/r.json")).toEqual(["pr", "--title", "Add login", "--result-file", "/tmp/r.json", "--", WORKTREE]);
		expect(prResultArguments({ ...base, title: "" }, "/tmp/r.json")).toEqual(["pr", "--title", "", "--result-file", "/tmp/r.json", "--", WORKTREE]);
		expect(prResultArguments({ ...base, body: "Line one\nLine two", base: "origin/main", draft: true }, "/tmp/r.json")).toEqual([
			"pr", "--title", "Add login", "--body", "Line one\nLine two", "--base", "origin/main", "--draft", "--result-file", "/tmp/r.json", "--", WORKTREE,
		]);
	});

	test("values that start with a dash stay values, and the worktree stays after `--`", () => {
		const given = prResultArguments({ worktree: "--weird", title: "-x", body: "- item", base: "--b", draft: false, reviewers: ["-r"] }, "/tmp/r.json");
		expect(given.indexOf("--")).toBe(given.length - 2);
		expect(given.at(-1)).toBe("--weird");
		expect(given[given.indexOf("--title") + 1]).toBe("-x");
		expect(given[given.indexOf("--body") + 1]).toBe("- item");
		expect(given[given.indexOf("--base") + 1]).toBe("--b");
		expect(given[given.indexOf("--reviewer") + 1]).toBe("-r");
	});

	test("each reviewer is its own --reviewer, in the order given, after --draft", () => {
		expect(prResultArguments({ ...base, draft: true, reviewers: ["alice", "example/core", "Bob"] }, "/tmp/r.json")).toEqual([
			"pr", "--title", "Add login", "--draft", "--reviewer", "alice", "--reviewer", "example/core", "--reviewer", "Bob", "--result-file", "/tmp/r.json", "--", WORKTREE,
		]);
		expect(describeTimberCommand(prResultArguments({ ...base, reviewers: ["alice", "example/core"] }, RESULT_FILE_PLACEHOLDER)))
			.toBe(`timber pr --title 'Add login' --reviewer alice --reviewer example/core --result-file <temporary file> -- ${WORKTREE}`);
	});

	test("the shown command is the same arguments with the placeholder", () => {
		expect(describeTimberCommand(prResultArguments(base, RESULT_FILE_PLACEHOLDER))).toBe(COMMAND);
		expect(describeTimberCommand(prResultArguments({ ...base, body: "It's done", base: "origin/main", draft: true }, RESULT_FILE_PLACEHOLDER)))
			.toBe(`timber pr --title 'Add login' --body 'It'\\''s done' --base origin/main --draft --result-file <temporary file> -- ${WORKTREE}`);
	});
});

describe("the Base field", () => {
	test("starts as a saved remote base in the form Timber takes", () => {
		expect(initialPullRequestBase({ kind: "assigned", ref: "refs/remotes/origin/main" })).toBe("origin/main");
		expect(initialPullRequestBase({ kind: "assigned", ref: "refs/remotes/upstream/release/1.0" })).toBe("upstream/release/1.0");
	});

	test("starts empty for a local base, none, invalid metadata, or a Timber that does not say", () => {
		expect(initialPullRequestBase({ kind: "assigned", ref: "refs/heads/main" })).toBe("");
		expect(initialPullRequestBase({ kind: "unassigned" })).toBe("");
		expect(initialPullRequestBase({ kind: "invalid", reason: "malformed" })).toBe("");
		// timber pr --base takes a branch, so a commit base is not offered.
		expect(initialPullRequestBase({ kind: "commit", commit: "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432" })).toBe("");
		expect(initialPullRequestBase(null)).toBe("");
	});

	test("empty or blank text means the saved base, and spaces around it are left off", () => {
		expect(pullRequestBaseFromText("")).toBeNull();
		expect(pullRequestBaseFromText("   ")).toBeNull();
		expect(pullRequestBaseFromText(" origin/main ")).toBe("origin/main");
	});
});

describe("the Reviewers field", () => {
	test("each name between commas or spaces, in the order typed, with empty ones left out", () => {
		expect(pullRequestReviewersFromText("")).toEqual([]);
		expect(pullRequestReviewersFromText(" ,  , ")).toEqual([]);
		expect(pullRequestReviewersFromText("alice, example/core,bob  carol\n")).toEqual(["alice", "example/core", "bob", "carol"]);
	});

	test("checks and merges nothing: that is Timber's", () => {
		expect(pullRequestReviewersFromText("alice, Alice, not/a/team, @x")).toEqual(["alice", "Alice", "not/a/team", "@x"]);
	});
});

describe("readPrResult, with records in Timber's form", () => {
	test("created: the number, the link, the base, and that it was published", () => {
		expect(read(recordedPr.created, 0)).toEqual({ outcome: "created", number: 7, url: "https://github.com/example/sample/pull/7", base: "main", published: true, reviewers: [] });
	});

	test("created with reviewers: each one requested or not, with Timber's reason, and the pull request still created", () => {
		const reviewers: ReviewerRequestOutcome[] = [
			{ name: "alice", kind: "user", result: "requested", diagnostic: null },
			{ name: "example/core", kind: "team", result: "failed", diagnostic: "GitHub could not find the pull request or the team while requesting a reviewer." },
		];
		expect(read(changed(recordedPr.created, {}, { reviewers }), 0)).toEqual({
			outcome: "created", number: 7, url: "https://github.com/example/sample/pull/7", base: "main", published: true, reviewers,
		});
		expect(read(changed(recordedPr.exists, {}, { reviewers }), 0)).toMatchObject({ outcome: "exists", reviewers });
	});

	test("a reviewer's name and reason are made safe to show", () => {
		const result = read(changed(recordedPr.created, {}, { reviewers: [{ name: " al\u001bice ", kind: "user", result: "failed", diagnostic: "Bad\u0007 thing. " }] }), 0);
		expect(result).toMatchObject({ outcome: "created", reviewers: [{ name: "al\uFFFDice", diagnostic: "Bad\uFFFD thing." }] });
	});

	test("exists: the one already open, and nothing created", () => {
		expect(read(recordedPr.exists, 0)).toEqual({ outcome: "exists", number: 5, url: "https://github.com/example/sample/pull/5", base: "main", published: false, reviewers: [] });
	});

	test("refused, as recorded: Timber's diagnostic and what it printed", () => {
		expect(read(recordedPr.refusedNotGithub, 1)).toEqual({
			outcome: "refused",
			failure: { command: COMMAND, diagnostic: "The base remote \"origin\" does not identify one github.com repository; Timber creates pull requests only on github.com.", output: OUTPUT },
		});
		expect(read(recordedPr.refusedNoTitle, 1)).toMatchObject({ outcome: "refused", failure: { diagnostic: "Provide a pull request title with --title <text>." } });
	});

	test("failed says whether this run published the branch", () => {
		expect(read(recordedPr.failedLogin, 1)).toMatchObject({ outcome: "failed", ran: true, published: false, failure: { diagnostic: expect.stringContaining("gh auth login") } });
		expect(read(recordedPr.failedAfterPush, 1)).toMatchObject({ outcome: "failed", ran: true, published: true });
	});
});

describe("readPrResult, with records it cannot use", () => {
	test("no result, or one for another command, is a failure whose effect is unknown", () => {
		expect(read(null, 1)).toMatchObject({ outcome: "failed", ran: true, published: null, failure: { diagnostic: expect.stringContaining("left no result") } });
		expect(read(changed(recordedPr.created, { command: "rebase" }), 0)).toMatchObject({ outcome: "failed", published: null });
	});

	test("an exit code that is not the record's is never used", () => {
		expect(read(recordedPr.created, 1)).toMatchObject({ outcome: "failed", published: null, failure: { diagnostic: expect.stringContaining("exit code 0") } });
	});

	test("a record for another worktree is not used", () => {
		const result = read(recordedPr.created, 0, "/work/sample-worktrees/other");
		expect(result).toMatchObject({ outcome: "failed", ran: true, published: null });
		if (result.outcome === "failed") expect(result.failure.diagnostic).toContain("not for /work/sample-worktrees/other");
	});

	test("a missing or malformed pr object", () => {
		const record = JSON.parse(recordedPr.created);
		delete record.pr;
		expectUnknown(read(JSON.stringify(record), 0), "it has no pr object");
		expectUnknown(read(changed(recordedPr.created, {}, { result: "merged" }), 0), "not one this app knows");
		expectUnknown(read(changed(recordedPr.created, {}, { number: "7" }), 0), "number is not a number");
		expectUnknown(read(changed(recordedPr.created, {}, { number: 1.5 }), 0), "number is not a number");
		expectUnknown(read(changed(recordedPr.created, {}, { url: 7 }), 0), "not text");
		expectUnknown(read(changed(recordedPr.created, {}, { published: "yes" }), 0), "whether the branch was published");
	});

	test("a result that does not go with the outcome, or a pull request where there is none", () => {
		expectUnknown(read(changed(recordedPr.refusedNotGithub, {}, { result: "created" }), 1), `"created" does not go with its outcome "failed"`);
		expectUnknown(read(changed(recordedPr.created, {}, { result: "refused" }), 0), `"refused" does not go with its outcome "succeeded"`);
		expectUnknown(read(changed(recordedPr.created, {}, { number: null }), 0), "without a pull request");
		expectUnknown(read(changed(recordedPr.created, {}, { url: null }), 0), "without a pull request");
		expectUnknown(read(changed(recordedPr.refusedNotGithub, {}, { number: 3, url: "https://github.com/example/sample/pull/3" }), 1), "names a pull request");
		expectUnknown(read(changed(recordedPr.refusedNotGithub, {}, { published: true }), 1), "refused run published");
	});

	test("reviewers that are missing or not a list this app can read", () => {
		const record = JSON.parse(recordedPr.created);
		delete record.pr.reviewers;
		expectUnknown(read(JSON.stringify(record), 0), "reviewers are not a list");
		const entry = { name: "alice", kind: "user", result: "requested", diagnostic: null };
		for (const reviewers of [
			null,
			"alice",
			[null],
			[{ ...entry, name: "" }],
			[{ ...entry, name: 7 }],
			[{ ...entry, kind: "bot" }],
			[{ ...entry, result: "pending" }],
			[{ ...entry, diagnostic: "requested with a reason" }],
			[{ ...entry, result: "failed", diagnostic: null }],
			[{ ...entry, result: "failed", diagnostic: " " }],
			[{ ...entry, result: "failed" }],
		]) {
			expectUnknown(read(changed(recordedPr.created, {}, { reviewers }), 0), "reviewers are not a list");
		}
	});

	test("reviewers on a run that created and found nothing", () => {
		const reviewers = [{ name: "alice", kind: "user", result: "requested", diagnostic: null }];
		expectUnknown(read(changed(recordedPr.refusedNotGithub, {}, { reviewers }), 1), `it lists reviewers for a result of "refused"`);
		expectUnknown(read(changed(recordedPr.failedAfterPush, {}, { reviewers }), 1), `it lists reviewers for a result of "failed"`);
	});

	test("a link that is not an https GitHub or Bitbucket link", () => {
		expectUnknown(read(changed(recordedPr.created, {}, { url: "http://github.com/example/sample/pull/7" }), 0), "not a GitHub or Bitbucket link");
		expectUnknown(read(changed(recordedPr.created, {}, { url: "https://example.com/pull/7" }), 0), "not a GitHub or Bitbucket link");
		expectUnknown(read(changed(recordedPr.created, {}, { url: "http://bitbucket.org/example/sample/pull-requests/7" }), 0), "not a GitHub or Bitbucket link");
	});

	test("a pull request Timber 0.1.4 opened on Bitbucket is read like one on GitHub", () => {
		const url = "https://bitbucket.org/example/sample/pull-requests/7";
		expect(read(changed(recordedPr.created, {}, { url }), 0)).toEqual({ outcome: "created", number: 7, url, base: "main", published: true, reviewers: [] });
	});

	test("a cancelled record, which timber pr never writes", () => {
		expectUnknown(read(changed(recordedPr.created, { outcome: "cancelled" }), 0), "cancelled");
	});
});
