import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type IssueLookup, readIssueRecord } from "../src/shared/issues";

/**
 * Recorded from `bun src/index.ts __app-issue -- <worktree>` on Timber's main
 * branch after 0.1.2 on Linux, with standard input closed, an empty home
 * folder, and no tracker tokens set, exactly as printed, except that the
 * temporary folder it ran in is written `/work`:
 *
 * - `none`: a worktree with no saved link (exit code 0).
 * - `found`: a link to the public issue github.com/Coding-M8s/timber/issues/153,
 *   read without a login (exit code 0). Its assignee's login is written
 *   `example-user`.
 * - `jira-sign-in-needed`: a Jira link with no Jira site set up (exit code 1).
 * - `linear-sign-in-needed`: a Linear link with no Linear key (exit code 1).
 * - `not-found`: a link to an issue of a GitHub repository that does not exist (exit code 1).
 * - `offline`: a GitHub link with HTTPS_PROXY pointing at a closed port (exit code 1).
 * - `malformed-link`: a worktree whose `issue.json` is not JSON (exit code 1).
 * - `no-match`: a path that is no registered worktree (exit code 1).
 * - `unknown-command-0.1.2.stderr`: the standard error of Timber 0.1.2, which has no `__app-issue` (exit code 1, nothing on stdout).
 */
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", "timber-app-issue", name), "utf8");
const tree = (name: string) => `/work/sample-worktrees/${name}`;

const message = (lookup: IssueLookup): string => {
	if (lookup.ok) throw new Error(`Expected a failure, got ${lookup.outcome}`);
	return lookup.message;
};

/** The recorded found record with some fields replaced. */
function altered(change: (record: Record<string, any>) => void): string {
	const record = JSON.parse(fixture("found.json"));
	change(record);
	return JSON.stringify(record);
}

describe("readIssueRecord, on what Timber printed", () => {
	test("found: the key, title, status, assignee, and link", () => {
		expect(readIssueRecord(fixture("found.json"), "", 0, tree("feat-found"))).toEqual({
			ok: true,
			outcome: "found",
			issue: {
				tracker: "github",
				key: "153",
				url: "https://github.com/Coding-M8s/timber/issues/153",
				title: "Remember the issue a worktree was created from",
				status: { name: "Closed", category: "closed" },
				assignee: "example-user",
			},
		});
	});

	test("none, even with a setup hint on standard error", () => {
		expect(readIssueRecord(fixture("none.json"), "Before using Timber, run `timber setup` inside your repository.\n", 0, tree("plain"))).toEqual({ ok: true, outcome: "none" });
	});

	test("each failure keeps its reason and Timber's diagnostic", () => {
		const cases: [string, string, string][] = [
			["jira-sign-in-needed.json", "feat-jira", "sign-in-needed"],
			["linear-sign-in-needed.json", "feat-linear", "sign-in-needed"],
			["not-found.json", "feat-github", "not-found"],
			["offline.json", "feat-github", "offline"],
			["malformed-link.json", "feat-broken", "failed"],
		];
		for (const [name, worktree, reason] of cases) {
			const lookup = readIssueRecord(fixture(name), "", 1, tree(worktree));
			expect(lookup).toMatchObject({ ok: true, outcome: "failed", reason });
			if (lookup.ok && lookup.outcome === "failed") expect(lookup.diagnostic.length).toBeGreaterThan(10);
		}
		expect(readIssueRecord(fixture("offline.json"), "", 1, tree("feat-github"))).toMatchObject({ diagnostic: "GitHub could not be reached; check connectivity and try again." });
	});

	test("a path that names no worktree is a failure with Timber's reason", () => {
		expect(readIssueRecord(fixture("no-match.json"), "", 1, "/work/elsewhere")).toMatchObject({ ok: true, outcome: "failed", reason: "failed" });
	});

	test("a Timber without the command says so in its own words", () => {
		expect(message(readIssueRecord("", fixture("unknown-command-0.1.2.stderr"), 1, tree("plain")))).toBe("timber __app-issue exited with code 1: unknown command '__app-issue'");
	});
});

describe("readIssueRecord refuses answers it cannot trust", () => {
	const found = tree("feat-found");

	test("an answer about another worktree", () => {
		expect(message(readIssueRecord(fixture("found.json"), "", 0, tree("feat-other")))).toContain("it is about another worktree");
		expect(message(readIssueRecord(altered(record => { record.worktree = null; }), "", 0, found))).toContain("do not match its outcome");
	});

	test("an exit code that does not match the outcome, or is neither 0 nor 1", () => {
		expect(message(readIssueRecord(fixture("found.json"), "", 1, found))).toContain("does not match its outcome");
		expect(message(readIssueRecord(fixture("offline.json"), "", 0, tree("feat-github")))).toContain("does not match its outcome");
		expect(message(readIssueRecord(fixture("found.json"), "boom\n", 2, found))).toBe("timber __app-issue exited with code 2: boom");
		expect(message(readIssueRecord(fixture("found.json"), "", null, found))).toBe("timber __app-issue did not exit by itself without saying why.");
	});

	test("another schema version, no JSON, or an unknown outcome", () => {
		expect(message(readIssueRecord(altered(record => { record.schemaVersion = 2; }), "", 0, found))).toContain("schema version 2");
		expect(message(readIssueRecord("", "", 0, found))).toContain("it printed nothing");
		expect(message(readIssueRecord("{", "", 0, found))).toContain("not valid JSON");
		expect(message(readIssueRecord(altered(record => { record.outcome = "maybe"; }), "", 0, found))).toContain("outcome is not one this app knows");
	});

	test("an issue whose fields the contract does not describe", () => {
		const changes: ((issue: Record<string, any>) => void)[] = [
			issue => { issue.tracker = "asana"; },
			issue => { issue.key = ""; },
			issue => { issue.url = "http://github.com/Coding-M8s/timber/issues/153"; },
			issue => { issue.title = 7; },
			issue => { issue.status = { name: "Closed", category: "done" }; },
			issue => { delete issue.status; },
			issue => { issue.assignee = 1; },
		];
		for (const change of changes) {
			expect(message(readIssueRecord(altered(record => change(record.issue)), "", 0, found))).toContain("its issue is not one this app can read");
		}
	});

	test("a failure with an unknown reason, or a found record carrying a reason", () => {
		const offline = JSON.parse(fixture("offline.json"));
		offline.reason = "rate-limited";
		expect(message(readIssueRecord(JSON.stringify(offline), "", 1, tree("feat-github")))).toContain("do not match its outcome");
		expect(message(readIssueRecord(altered(record => { record.reason = "offline"; }), "", 0, found))).toContain("do not match its outcome");
	});
});

describe("text from the tracker", () => {
	test("is made safe to show, the status name kept short, and an empty assignee read as none", () => {
		const lookup = readIssueRecord(altered(record => {
			record.issue.title = "  Fix \u001b[31mred\u0007 ";
			record.issue.status.name = "A very long status name that a tracker might well allow";
			record.issue.assignee = "  ";
		}), "", 0, tree("feat-found"));
		if (!lookup.ok || lookup.outcome !== "found") throw new Error("Expected an issue");
		expect(lookup.issue.title).toBe("Fix �[31mred�");
		expect(Array.from(lookup.issue.status.name).length).toBe(40);
		expect(lookup.issue.status.name.endsWith("…")).toBe(true);
		expect(lookup.issue.assignee).toBeNull();
	});
});
