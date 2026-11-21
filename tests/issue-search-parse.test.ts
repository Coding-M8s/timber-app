import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type IssueSearchResult, issueSearchArguments, readIssueSearchRecord } from "../src/shared/issue-search";

/**
 * Recorded in this repository's primary checkout from
 * `timber __app-issues search --tracker <tracker> -- <text>` of Timber's main
 * branch (d64021f, built with `bun build --compile`) on Linux, with standard
 * input closed, an empty home folder, and no tracker tokens, exactly as
 * printed, except that local folders are written `/work/...` and assignee
 * logins `example-user`:
 *
 * - `found`: GitHub, text `16` (exit code 0). Issue 161 has a worktree.
 * - `truncated`: GitHub, `--limit 3`, text `1` (exit code 0).
 * - `no-matches`: GitHub, text `zzzqqq` (exit code 0).
 * - `jira-sign-in-needed`: Jira with no Jira site set up (exit code 1).
 * - `offline`: GitHub with HTTPS_PROXY pointing at a closed port (exit code 1).
 * - `unknown-command-0.1.3.stderr`: the standard error of Timber 0.1.3, which has no `__app-issues` (exit code 1, nothing on stdout).
 */
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "timber-app-issues", name), "utf8");

const message = (result: IssueSearchResult): string => {
	if (result.ok) throw new Error(`Expected a failure, got ${result.outcome}`);
	return result.message;
};

function altered(change: (record: Record<string, any>) => void, name = "found.json"): string {
	const record = JSON.parse(fixture(name));
	change(record);
	return JSON.stringify(record);
}

describe("issueSearchArguments", () => {
	test("names the tracker and the limit, and passes the text as one argument after --", () => {
		expect(issueSearchArguments("jira", "--help; rm -rf /")).toEqual(["__app-issues", "search", "--tracker", "jira", "--limit", "10", "--", "--help; rm -rf /"]);
	});
});

describe("readIssueSearchRecord, on what Timber printed", () => {
	test("found: each issue's key, title, status, and the worktree linked to it", () => {
		const result = readIssueSearchRecord(fixture("found.json"), "", 0, "github");
		expect(result).toMatchObject({ ok: true, outcome: "found", truncated: false });
		if (!result.ok || result.outcome !== "found") throw new Error("not found");
		expect(result.issues.map(issue => issue.key)).toEqual(["16", "161"]);
		expect(result.issues[0]).toMatchObject({ tracker: "github", url: "https://github.com/Coding-M8s/timber-app/issues/16", worktree: null });
		expect(result.issues[1]!.title).toBe("Suggest issues while typing a worktree's name");
		expect(result.issues[1]!.worktree).toEqual({
			path: "/work/timber-app-worktrees/GH-161-suggest-issues-while-typing-a-worktree-s-name",
			branch: "GH-161-suggest-issues-while-typing-a-worktree-s-name",
		});
	});

	test("truncated is passed on", () => {
		const result = readIssueSearchRecord(fixture("truncated.json"), "", 0, "github");
		expect(result).toMatchObject({ ok: true, outcome: "found", truncated: true });
	});

	test("no matches is an empty list, even with a setup hint on standard error", () => {
		expect(readIssueSearchRecord(fixture("no-matches.json"), "Before using Timber, run `timber setup` inside your repository.\n", 0, "github"))
			.toEqual({ ok: true, outcome: "found", issues: [], truncated: false });
	});

	test("none reads as an empty list", () => {
		expect(readIssueSearchRecord(altered(record => (record.outcome = "none"), "no-matches.json"), "", 0, "github")).toEqual({ ok: true, outcome: "found", issues: [], truncated: false });
	});

	test("each failure keeps its reason and Timber's diagnostic", () => {
		expect(readIssueSearchRecord(fixture("jira-sign-in-needed.json"), "", 1, "jira")).toEqual({
			ok: true, outcome: "failed", reason: "sign-in-needed", diagnostic: "Jira is not set up for this repository. Run timber setup to choose a Jira site and save a login.",
		});
		expect(readIssueSearchRecord(fixture("offline.json"), "", 1, "github")).toMatchObject({ ok: true, outcome: "failed", reason: "offline" });
		const notConfigured = altered(record => (record.reason = "not-configured"), "offline.json");
		expect(readIssueSearchRecord(notConfigured, "", 1, "github")).toMatchObject({ ok: true, outcome: "failed", reason: "not-configured" });
	});

	test("a Timber without the command is unsupported", () => {
		expect(readIssueSearchRecord("", fixture("unknown-command-0.1.3.stderr"), 1, "github")).toEqual({
			ok: false, unsupported: true, message: "This Timber has no timber __app-issues. Issue suggestions need a Timber built from its main branch.",
		});
	});

	test("a crash is a failure in Timber's words, never unsupported", () => {
		expect(readIssueSearchRecord("", "error: something broke\n", 1, "github")).toEqual({ ok: false, unsupported: false, message: "timber __app-issues exited with code 1: something broke" });
		expect(readIssueSearchRecord("", "", 2, "github")).toEqual({ ok: false, unsupported: false, message: "timber __app-issues exited with code 2 without saying why." });
	});
});

describe("readIssueSearchRecord refuses a record that does not add up", () => {
	const cases: [string, string, number | null, string][] = [
		["another tracker", fixture("found.json"), 0, "it is about another tracker"],
		["another query", altered(record => (record.query = "open")), 0, "it is not a search"],
		["found with exit code 1", fixture("found.json"), 1, "it exited with code 1, which does not match its outcome"],
		["failed with exit code 0", fixture("offline.json"), 0, "it exited with code 0, which does not match its outcome"],
		["found with a reason", altered(record => (record.reason = "offline")), 0, "its fields do not match its outcome"],
		["an unknown reason", altered(record => (record.reason = "rate-limited"), "offline.json"), 1, "its fields do not match its outcome"],
		["an unreadable issue", altered(record => (record.issues[0].url = "javascript:alert(1)")), 0, "an issue in it cannot be read"],
		["an unreadable worktree", altered(record => (record.issues[1].worktree = { path: 4 })), 0, "an issue in it cannot be read"],
		["issues that are not a list", altered(record => (record.issues = {})), 0, "its issues cannot be read"],
		["an unknown outcome", altered(record => (record.outcome = "maybe")), 0, "its outcome is not one this app knows"],
		["not JSON", "{", 0, "the output is not valid JSON"],
	];
	for (const [name, stdout, exitCode, detail] of cases) {
		test(name, () => {
			const tracker = name === "another tracker" ? "jira" : "github";
			expect(message(readIssueSearchRecord(stdout, "", exitCode, tracker))).toBe(`timber __app-issues did not answer with a record this app can read: ${detail}.`);
		});
	}

	test("another schema version", () => {
		expect(message(readIssueSearchRecord(altered(record => (record.schemaVersion = 2)), "", 0, "github"))).toStartWith("timber __app-issues answered with schema version 2");
	});

	test("titles are made safe to show", () => {
		const result = readIssueSearchRecord(altered(record => (record.issues[0].title = "Bad\u001b[31m title")), "", 0, "github");
		expect(result.ok && result.outcome === "found" && result.issues[0]!.title).toBe("Bad�[31m title");
	});
});
