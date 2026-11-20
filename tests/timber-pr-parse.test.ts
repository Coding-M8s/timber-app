import { describe, expect, test } from "bun:test";
import { initialPullRequestBase, prResultArguments, pullRequestBaseFromText, readPrResult } from "../src/shared/timber-pr";
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

const base = { worktree: WORKTREE, title: "Add login", body: "", base: null, draft: false };

describe("prResultArguments", () => {
	test("always passes the title, and only the options that were filled in", () => {
		expect(prResultArguments(base, "/tmp/r.json")).toEqual(["pr", "--title", "Add login", "--result-file", "/tmp/r.json", "--", WORKTREE]);
		expect(prResultArguments({ ...base, title: "" }, "/tmp/r.json")).toEqual(["pr", "--title", "", "--result-file", "/tmp/r.json", "--", WORKTREE]);
		expect(prResultArguments({ ...base, body: "Line one\nLine two", base: "origin/main", draft: true }, "/tmp/r.json")).toEqual([
			"pr", "--title", "Add login", "--body", "Line one\nLine two", "--base", "origin/main", "--draft", "--result-file", "/tmp/r.json", "--", WORKTREE,
		]);
	});

	test("values that start with a dash stay values, and the worktree stays after `--`", () => {
		const given = prResultArguments({ worktree: "--weird", title: "-x", body: "- item", base: "--b", draft: false }, "/tmp/r.json");
		expect(given.indexOf("--")).toBe(given.length - 2);
		expect(given.at(-1)).toBe("--weird");
		expect(given[given.indexOf("--title") + 1]).toBe("-x");
		expect(given[given.indexOf("--body") + 1]).toBe("- item");
		expect(given[given.indexOf("--base") + 1]).toBe("--b");
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
		expect(initialPullRequestBase(null)).toBe("");
	});

	test("empty or blank text means the saved base, and spaces around it are left off", () => {
		expect(pullRequestBaseFromText("")).toBeNull();
		expect(pullRequestBaseFromText("   ")).toBeNull();
		expect(pullRequestBaseFromText(" origin/main ")).toBe("origin/main");
	});
});

describe("readPrResult, with records in Timber 0.1.3's form", () => {
	test("created: the number, the link, the base, and that it was published", () => {
		expect(read(recordedPr.created, 0)).toEqual({ outcome: "created", number: 7, url: "https://github.com/example/sample/pull/7", base: "main", published: true });
	});

	test("exists: the one already open, and nothing created", () => {
		expect(read(recordedPr.exists, 0)).toEqual({ outcome: "exists", number: 5, url: "https://github.com/example/sample/pull/5", base: "main", published: false });
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

	test("a link that is not an https GitHub link", () => {
		expectUnknown(read(changed(recordedPr.created, {}, { url: "http://github.com/example/sample/pull/7" }), 0), "not a GitHub link");
		expectUnknown(read(changed(recordedPr.created, {}, { url: "https://example.com/pull/7" }), 0), "not a GitHub link");
	});

	test("a cancelled record, which timber pr never writes", () => {
		expectUnknown(read(changed(recordedPr.created, { outcome: "cancelled" }), 0), "cancelled");
	});
});
