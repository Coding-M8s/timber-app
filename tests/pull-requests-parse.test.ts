import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type PullRequestEntry, type PullRequestList, descriptionText, pullRequestOf, readPullRequestList } from "../src/shared/pull-requests";

/**
 * `offline`, `sign-in-needed` (a token GitHub refused), `no-login`,
 * `not-github`, `not-a-repository`, and the standard error of Timber 0.1.2,
 * which has no `__app-pr`, were recorded from Timber on Linux, exactly as
 * printed, except that the temporary folder they ran in is written `/work`.
 * `found` is written by hand to the same shape, checked field by field
 * against a real run: the repository it was recorded from is private.
 */
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "timber-app-pr", name), "utf8");

const ok = (list: PullRequestList): PullRequestEntry[] => {
	if (!list.ok) throw new Error(list.message);
	return list.worktrees;
};

describe("descriptionText", () => {
	test("keeps lines and tabs, makes Windows line endings one break, and replaces other control characters", () => {
		expect(descriptionText("  One\r\nTwo\rThree\n\tindented\u0007\u001b[31m  ")).toBe("One\nTwo\nThree\n\tindented\uFFFD\uFFFD[31m");
		expect(descriptionText("a\u2028b")).toBe("a\uFFFDb");
	});

	test("cuts a long description short with an ellipsis", () => {
		expect(descriptionText("abcdef", 4)).toBe("abc\u2026");
		expect(descriptionText("abcd", 4)).toBe("abcd");
	});
});

describe("readPullRequestList", () => {
	test("reads each state, the checks by status, and the review decision, each run, and the description as text", () => {
		const entries = ok(readPullRequestList(fixture("found.json"), "", 0));
		expect(entries.map(entry => [entry.path, entry.outcome])).toEqual([
			["/work/sample", "none"],
			["/work/sample-worktrees/feat-approved", "found"],
			["/work/sample-worktrees/feat-changes", "found"],
			["/work/sample-worktrees/feat-draft", "found"],
			["/work/sample-worktrees/fix-merged", "found"],
			["/work/sample-worktrees/old-closed", "found"],
			["/work/sample-worktrees/review", "none"],
		]);
		expect(entries[1]).toEqual({
			path: "/work/sample-worktrees/feat-approved",
			branch: "feat/approved",
			outcome: "found",
			pullRequest: {
				number: 12,
				url: "https://github.com/example/sample/pull/12",
				title: "Add the approved feature",
				state: "open",
				baseBranch: "main",
				// A skipped run counts as none of these.
				checks: {
					summary: "passing",
					passing: 2,
					failing: 0,
					pending: 0,
					runs: [
						{ name: "test", status: "passing", url: "https://github.com/example/sample/actions/runs/1" },
						{ name: "lint", status: "passing", url: "https://github.com/example/sample/actions/runs/2" },
						{ name: "docs", status: "skipped", url: "https://github.com/example/sample/actions/runs/3" },
					],
				},
				review: "approved",
				// Markup stays text: nothing here is ever rendered as markup.
				description: "Closes #11.\n\n<b>Markup</b> stays text.",
			},
		});
		const pulls = entries.flatMap(entry => entry.outcome === "found" ? [entry.pullRequest] : []);
		expect(pulls.map(pull => [pull.number, pull.state, pull.checks.summary, pull.review])).toEqual([
			[12, "open", "passing", "approved"],
			[13, "open", "failing", "changes-requested"],
			[14, "draft", "pending", "review-required"],
			[9, "merged", "passing", "none"],
			[7, "closed", "none", "none"],
		]);
		expect(pulls[1]!.checks).toMatchObject({ summary: "failing", passing: 1, failing: 1, pending: 1 });
		// A status with no link keeps none.
		expect(pulls[1]!.checks.runs.at(-1)).toEqual({ name: "legacy status", status: "pending", url: null });
		expect(pulls[4]!.checks.runs).toEqual([]);
		expect(pulls[1]!.description).toBe("");
		// Text from GitHub is trimmed, and a control character cannot reach the screen.
		expect(pulls[2]!.title).toBe("Work in progress�");
	});

	test("a check link that is not https is not offered, and a run that is not one refuses the list", () => {
		const record = JSON.parse(fixture("found.json"));
		record.worktrees[1].pullRequest.checks.runs[0].url = "javascript:alert(1)";
		record.worktrees[1].pullRequest.checks.runs[1].url = "http://ci.example/run/2";
		const entries = ok(readPullRequestList(JSON.stringify(record), "", 0));
		const pull = entries[1]!.outcome === "found" ? entries[1]!.pullRequest : null;
		expect(pull?.checks.runs.slice(0, 2).map(run => run.url)).toEqual([null, null]);

		record.worktrees[1].pullRequest.checks.runs[0].url = 7;
		expect(readPullRequestList(JSON.stringify(record), "", 0).ok).toBe(false);
	});

	test("a pull request without a description as text refuses the list", () => {
		const record = JSON.parse(fixture("found.json"));
		delete record.worktrees[1].pullRequest.description;
		expect(readPullRequestList(JSON.stringify(record), "", 0).ok).toBe(false);
	});

	test("a detached HEAD has no pull request and no branch", () => {
		const entries = ok(readPullRequestList(fixture("found.json"), "", 0));
		expect(entries.at(-1)).toEqual({ path: "/work/sample-worktrees/review", branch: null, outcome: "none" });
	});

	test("each reason a lookup failed comes through for every branch, with Timber's diagnostic", () => {
		const cases = [
			["offline.json", "offline", "Cannot reach GitHub; check connectivity and try again."],
			["sign-in-needed.json", "sign-in-needed", "GitHub rejected the login; check your environment token or sign in with gh auth login."],
			["no-login.json", "sign-in-needed", "No usable GitHub login. Sign in with gh auth login, or set GH_TOKEN or GITHUB_TOKEN to a valid token."],
			["not-github.json", "not-github", "The selected remote is not a github.com repository. Pull requests are read from github.com only; check the remote setting or the origin fetch URL."],
		] as const;
		for (const [name, reason, diagnostic] of cases) {
			expect(ok(readPullRequestList(fixture(name), "", 1))).toEqual([
				{ path: "/work/sample", branch: "main", outcome: "failed", reason, diagnostic },
				{ path: "/work/sample-worktrees/feat-login", branch: "feat/login", outcome: "failed", reason, diagnostic },
				{ path: "/work/sample-worktrees/review", branch: null, outcome: "none" },
			]);
		}
	});

	test("a repository Timber could not read is a failure with its diagnostic, never an empty answer", () => {
		expect(readPullRequestList(fixture("not-a-repository.json"), "", 1)).toEqual({
			ok: false,
			message: "timber __app-pr could not read the repository: Not a Git repository: /work",
		});
	});

	test("a Timber without the command says so", () => {
		expect(readPullRequestList("", fixture("unknown-command-0.1.2.stderr"), 1)).toEqual({
			ok: false,
			message: "timber __app-pr exited with code 1: unknown command '__app-pr'",
		});
	});

	test("an exit code other than 0 or 1, or none, is a failure even with a record", () => {
		expect(readPullRequestList(fixture("found.json"), "", 2)).toEqual({ ok: false, message: "timber __app-pr exited with code 2 without saying why." });
		expect(readPullRequestList(fixture("found.json"), "", null)).toEqual({ ok: false, message: "timber __app-pr did not exit by itself without saying why." });
	});

	test("an exit code that does not match the entries is not trusted", () => {
		const found = readPullRequestList(fixture("found.json"), "", 1);
		expect(found.ok).toBe(false);
		expect(!found.ok && found.message).toContain("does not match its entries");
		expect(readPullRequestList(fixture("offline.json"), "", 0).ok).toBe(false);
	});

	test("another schema version is refused by name", () => {
		const record = fixture("found.json").replace('"schemaVersion":1', '"schemaVersion":2');
		expect(readPullRequestList(record, "", 0)).toEqual({
			ok: false,
			message: "timber __app-pr answered with schema version 2, and this app reads version 1 only. Update Timber app, or install a Timber that matches it.",
		});
	});

	test("one entry that cannot be read fails the whole answer", () => {
		const record = JSON.parse(fixture("found.json"));
		const broken = (change: (value: any) => void) => {
			const copy = structuredClone(record);
			change(copy);
			return readPullRequestList(JSON.stringify(copy), "", 0);
		};
		const unreadable = (list: PullRequestList) => !list.ok && list.message.startsWith("timber __app-pr did not answer with a record this app can read: worktree ");
		expect(unreadable(broken(copy => void (copy.worktrees[1].pullRequest.state = "reopened")))).toBe(true);
		expect(unreadable(broken(copy => void (copy.worktrees[1].pullRequest.checks.runs[0].status = "neutral")))).toBe(true);
		expect(unreadable(broken(copy => void (copy.worktrees[1].pullRequest.review = "maybe")))).toBe(true);
		expect(unreadable(broken(copy => void (copy.worktrees[1].pullRequest.number = "12")))).toBe(true);
		expect(unreadable(broken(copy => void (copy.worktrees[1].pullRequest = null)))).toBe(true);
		expect(unreadable(broken(copy => void (copy.worktrees[0].outcome = "maybe")))).toBe(true);
		// Only an https link is ever opened.
		expect(unreadable(broken(copy => void (copy.worktrees[1].pullRequest.url = "javascript:alert(1)")))).toBe(true);
		expect(unreadable(broken(copy => void (copy.worktrees[1].pullRequest.url = "http://github.com/example/sample/pull/12")))).toBe(true);
	});

	test("output that is not a record is a failure with a message", () => {
		expect(readPullRequestList("", "", 0)).toEqual({ ok: false, message: "timber __app-pr did not answer with a record this app can read: it printed nothing." });
		expect(readPullRequestList("{", "", 0)).toEqual({ ok: false, message: "timber __app-pr did not answer with a record this app can read: the output is not valid JSON." });
		expect(readPullRequestList("[]", "", 0)).toEqual({ ok: false, message: "timber __app-pr did not answer with a record this app can read: the output is not a JSON object." });
		expect(readPullRequestList('{"schemaVersion":1,"diagnostic":null}', "", 0)).toEqual({ ok: false, message: "timber __app-pr did not answer with a record this app can read: it has no list of worktrees." });
	});

	test("an entry is found by its worktree path", () => {
		const list = readPullRequestList(fixture("found.json"), "", 0);
		expect(pullRequestOf(list, "/work/sample-worktrees/fix-merged")?.outcome).toBe("found");
		expect(pullRequestOf(list, "/work/elsewhere")).toBeNull();
		expect(pullRequestOf(undefined, "/work/sample")).toBeNull();
		expect(pullRequestOf({ ok: false, message: "no" }, "/work/sample")).toBeNull();
	});
});
