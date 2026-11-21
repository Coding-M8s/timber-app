import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type IssueListResult, issueListArguments, readIssueListRecord } from "../src/shared/issue-lists";

/**
 * Recorded on Linux from `timber __app-issues <list> --tracker <tracker>` of
 * Timber's main branch (4c42ed0, `bun run build`, run with Bun), with
 * standard input closed, exactly as printed, except that local folders are
 * written `/work/...` and assignee logins `example-user`:
 *
 * - `assigned`: GitHub, in this repository's primary checkout (exit code 0). Issue 155 has a worktree.
 * - `open-truncated`: GitHub, `open --limit 3` (exit code 0).
 * - `assigned-empty-linear`: Linear, with a login and nothing assigned (exit code 0).
 * - `sprint-iteration`: GitHub, in a clone with `[github].project` naming a Projects board with an iteration field.
 *   It holds issues of another repository (exit code 0).
 * - `sprint-empty-milestone`: GitHub, `[github].milestone` naming an open milestone with no open issues (exit code 0).
 * - `sprint-not-found`: GitHub, `[github].milestone` naming no milestone (exit code 1).
 * - `sprint-not-configured`: GitHub with no sprint settings (exit code 1).
 * - `no-tracker`: `sprint` with no `--tracker` and no default tracker (exit code 1).
 * - `jira-sign-in-needed`: Jira with no Jira site set up (exit code 1).
 * - `linear-sprint-none`: Linear, `[linear].team` naming a real team with no active cycle (exit code 0).
 * - `offline`: GitHub `open` with HTTPS_PROXY pointing at a closed port (exit code 1).
 * - `unknown-command-0.1.3.stderr`: the standard error of Timber 0.1.3, which has no `__app-issues` (exit code 1, nothing on stdout).
 */
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "timber-app-issue-lists", name), "utf8");

const message = (result: IssueListResult): string => {
	if (result.ok) throw new Error(`Expected a failure, got ${result.outcome}`);
	return result.message;
};

function altered(change: (record: Record<string, any>) => void, name = "assigned.json"): string {
	const record = JSON.parse(fixture(name));
	change(record);
	return JSON.stringify(record);
}

describe("issueListArguments", () => {
	test("always names the tracker; assigned and open ask for 50, a sprint is listed whole", () => {
		expect(issueListArguments("sprint", "jira")).toEqual(["__app-issues", "sprint", "--tracker", "jira"]);
		expect(issueListArguments("assigned", "github")).toEqual(["__app-issues", "assigned", "--tracker", "github", "--limit", "50"]);
		expect(issueListArguments("open", "linear")).toEqual(["__app-issues", "open", "--tracker", "linear", "--limit", "50"]);
	});
});

describe("readIssueListRecord, on what Timber printed", () => {
	test("assigned: each issue, and the worktree linked to it", () => {
		const result = readIssueListRecord(fixture("assigned.json"), "", 0, "assigned", "github");
		if (!result.ok || result.outcome !== "found") throw new Error("not found");
		expect(result.sprint).toBeNull();
		expect(result.truncated).toBe(false);
		expect(result.issues.map(issue => issue.key)).toEqual(["155", "29", "123"]);
		expect(result.issues[0]).toMatchObject({
			tracker: "github",
			url: "https://github.com/Coding-M8s/timber-app/issues/155",
			status: { category: "open" },
			assignee: "example-user",
			worktree: { path: "/work/timber-app-worktrees/GH-155-issues-board-sprint-assigned-to-me-and-open-issues", branch: "GH-155-issues-board-sprint-assigned-to-me-and-open-issues" },
		});
		expect(result.issues[1]!.worktree).toBeNull();
	});

	test("truncated is passed on", () => {
		expect(readIssueListRecord(fixture("open-truncated.json"), "", 0, "open", "github")).toMatchObject({ ok: true, outcome: "found", truncated: true });
	});

	test("an empty list is found with no issues", () => {
		expect(readIssueListRecord(fixture("assigned-empty-linear.json"), "", 0, "assigned", "linear")).toEqual({ ok: true, outcome: "found", issues: [], truncated: false, sprint: null });
	});

	test("a sprint says what it is and where it came from, and keeps issues of other repositories", () => {
		const result = readIssueListRecord(fixture("sprint-iteration.json"), "", 0, "sprint", "github");
		if (!result.ok || result.outcome !== "found") throw new Error("not found");
		expect(result.sprint).toEqual({ name: "Iteration 1", source: "github-iteration" });
		expect(result.issues.map(issue => issue.url)).toEqual([
			"https://github.com/Coding-M8s/timber/issues/103",
			"https://github.com/Coding-M8s/timber/issues/147",
			"https://github.com/Coding-M8s/timber/issues/146",
		]);
		expect(result.issues.map(issue => issue.status.category)).toEqual(["open", "closed", "closed"]);
	});

	test("an empty milestone is a found sprint with no issues", () => {
		expect(readIssueListRecord(fixture("sprint-empty-milestone.json"), "", 0, "sprint", "github"))
			.toEqual({ ok: true, outcome: "found", issues: [], truncated: false, sprint: { name: "01 Foundation", source: "github-milestone" } });
	});

	test("a Linear team with no active cycle is none", () => {
		expect(readIssueListRecord(fixture("linear-sprint-none.json"), "", 0, "sprint", "linear")).toEqual({ ok: true, outcome: "none" });
	});

	test("no current sprint is none", () => {
		const none = altered(record => Object.assign(record, { outcome: "none", sprint: null, issues: [] }), "sprint-empty-milestone.json");
		expect(readIssueListRecord(none, "", 0, "sprint", "github")).toEqual({ ok: true, outcome: "none" });
	});

	test("a saved Jira query has no sprint name", () => {
		const jql = altered(record => Object.assign(record, { tracker: "jira", sprint: { name: null, source: "jira-jql" } }), "sprint-empty-milestone.json");
		expect(readIssueListRecord(jql, "", 0, "sprint", "jira")).toMatchObject({ ok: true, outcome: "found", sprint: { name: null, source: "jira-jql" } });
	});

	test("each failure keeps Timber's reason and its words", () => {
		expect(readIssueListRecord(fixture("sprint-not-configured.json"), "", 1, "sprint", "github")).toEqual({
			ok: true, outcome: "failed", reason: "not-configured",
			diagnostic: "No GitHub sprint is configured. Set [github].project to a Projects board with an iteration field, or [github].milestone.",
		});
		expect(readIssueListRecord(fixture("sprint-not-found.json"), "", 1, "sprint", "github")).toMatchObject({ ok: true, outcome: "failed", reason: "not-found" });
		expect(readIssueListRecord(fixture("jira-sign-in-needed.json"), "", 1, "sprint", "jira")).toMatchObject({ ok: true, outcome: "failed", reason: "sign-in-needed" });
		expect(readIssueListRecord(fixture("offline.json"), "", 1, "open", "github")).toEqual({
			ok: true, outcome: "failed", reason: "offline", diagnostic: "GitHub could not be reached; check connectivity and try again.",
		});
	});

	test("a Timber without the command is unsupported, never a crash", () => {
		expect(readIssueListRecord("", fixture("unknown-command-0.1.3.stderr"), 1, "sprint", "github")).toMatchObject({ ok: false, unsupported: true });
	});
});

describe("readIssueListRecord refuses what it cannot trust", () => {
	test("a record of another list or tracker, including one that named no tracker", () => {
		expect(message(readIssueListRecord(fixture("assigned.json"), "", 0, "open", "github"))).toContain("another list");
		expect(message(readIssueListRecord(fixture("assigned.json"), "", 0, "assigned", "jira"))).toContain("another tracker");
		expect(message(readIssueListRecord(fixture("no-tracker.json"), "", 1, "sprint", "github"))).toContain("another tracker");
	});

	test("an exit code that does not match the outcome", () => {
		expect(message(readIssueListRecord(fixture("assigned.json"), "", 1, "assigned", "github"))).toContain("does not match");
		expect(message(readIssueListRecord(fixture("offline.json"), "", 0, "open", "github"))).toContain("does not match");
	});

	test("a found sprint without its sprint, or another list with one", () => {
		const bare = altered(record => { record.sprint = null; }, "sprint-iteration.json");
		expect(message(readIssueListRecord(bare, "", 0, "sprint", "github"))).toContain("sprint cannot be read");
		const odd = altered(record => { record.sprint = { name: "x", source: "jira-board" }; });
		expect(message(readIssueListRecord(odd, "", 0, "assigned", "github"))).toContain("do not match");
		const source = altered(record => { record.sprint.source = "trello"; }, "sprint-iteration.json");
		expect(message(readIssueListRecord(source, "", 0, "sprint", "github"))).toContain("sprint cannot be read");
	});

	test("an unreadable issue, an unknown reason, or another version", () => {
		const issue = altered(record => { record.issues[0].url = "http://example.com/1"; });
		expect(message(readIssueListRecord(issue, "", 0, "assigned", "github"))).toContain("an issue in it");
		const reason = altered(record => { record.reason = "busy"; }, "offline.json");
		expect(message(readIssueListRecord(reason, "", 1, "open", "github"))).toContain("do not match");
		const version = altered(record => { record.schemaVersion = 2; });
		expect(readIssueListRecord(version, "", 0, "assigned", "github")).toMatchObject({ ok: false, unsupported: false });
	});

	test("a crash or a stopped run says what happened", () => {
		expect(message(readIssueListRecord("", "Segmentation fault\n", 139, "open", "github"))).toContain("Segmentation fault");
		expect(readIssueListRecord("", "", null, "open", "github")).toMatchObject({ ok: false, unsupported: false });
	});

	test("an older Timber's record without pull requests is still read", () => {
		const older = altered(record => { for (const issue of record.issues) delete issue.pullRequests; });
		expect(readIssueListRecord(older, "", 0, "assigned", "github")).toMatchObject({ ok: true, outcome: "found" });
	});
});
