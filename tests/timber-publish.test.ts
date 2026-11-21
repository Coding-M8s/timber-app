import { describe, expect, test } from "bun:test";
import { publishResultArguments, readPublishResult } from "../src/shared/timber-publish";
import { type TimberRun, readTimberResult } from "../src/shared/timber-result";

const worktree = "/work/app-worktrees/feat-login";
const command = `timber publish --result-file <temporary file> -- ${worktree}`;
const output = { text: "Worktree: /work/app-worktrees/feat-login\nBranch: feat/login", truncated: false };

/** A publish record as Timber 0.1.4 writes it, with the fields a test changes. */
function record(publish: unknown, overrides: Record<string, unknown> = {}): string {
	const failed = typeof publish === "object" && publish !== null && ["refused", "failed"].includes((publish as { result?: string }).result ?? "");
	return JSON.stringify({
		schemaVersion: 1,
		command: "publish",
		outcome: failed ? "failed" : "succeeded",
		exitCode: failed ? 1 : 0,
		repository: { commonGitDir: "/work/app/.git", primaryWorktreeRoot: "/work/app", currentWorktreeRoot: "/work/app" },
		worktree: {
			path: worktree, branch: "feat/login", head: "0ca376bccb1ef58161ebe469a4a2fc2a8ecb6d99", isPrimary: false, locked: null, prunable: null, pathExists: true,
			status: { kind: "known", modified: [], untracked: [], ignored: [] }, detached: false, canonicalPath: worktree, base: { kind: "unassigned" }, issue: { kind: "none" },
		},
		materialized: false,
		diagnostic: null,
		publish,
		...overrides,
	});
}

const published = { result: "published", remote: "origin", upstream: "refs/remotes/origin/feat/login", pushedCommit: "0ca376bccb1ef58161ebe469a4a2fc2a8ecb6d99" };
const MOVED_ON = "The remote branch origin/feat/login has moved on: it has commits this branch does not contain, or this branch was rewritten after it was published. Nothing was pushed and no local ref changed. Timber never force-pushes; integrate the remote commits with Git, then publish again.";
const OFFLINE = "Git push to origin/feat/login failed (network, remote, hook or another Git error). Nothing was forced; read Git's output above, then publish again.";

function run(text: string | null, exitCode: number | null): TimberRun {
	return { command, result: readTimberResult("publish", text, exitCode), output };
}

describe("publishResultArguments", () => {
	test("puts the result file in as it is, and the worktree after --", () => {
		expect(publishResultArguments("/a b/-c", "/tmp/x/result.json")).toEqual(["publish", "--result-file", "/tmp/x/result.json", "--", "/a b/-c"]);
	});
});

describe("readPublishResult", () => {
	test("published is done and moved; up to date is done and did not move", () => {
		expect(readPublishResult(run(record(published), 0), worktree)).toEqual({ outcome: "done", action: "push", moved: true, fetchFailure: null });
		expect(readPublishResult(run(record({ ...published, result: "up-to-date" }), 0), worktree)).toEqual({ outcome: "done", action: "push", moved: false, fetchFailure: null });
	});

	test("refused is a refusal with Timber's diagnostic, the command, and what it printed", () => {
		const text = record({ ...published, result: "refused", pushedCommit: null }, { diagnostic: MOVED_ON });
		expect(readPublishResult(run(text, 1), worktree)).toEqual({
			outcome: "refused", action: "push", reason: "timber-refused", fetchFailure: null, failure: { command, diagnostic: MOVED_ON, output },
		});
	});

	test("a refusal before Timber chose a remote, as for an unborn branch, is still a refusal", () => {
		const text = record({ result: "refused", remote: null, upstream: null, pushedCommit: null }, { diagnostic: "Cannot publish an unborn branch; commit first." });
		expect(readPublishResult(run(text, 1), worktree)).toMatchObject({ outcome: "refused", reason: "timber-refused", failure: { diagnostic: "Cannot publish an unborn branch; commit first." } });
	});

	test("failed, as when the remote cannot be reached, is a failure that ran, with Timber's diagnostic", () => {
		const text = record({ ...published, result: "failed", pushedCommit: null }, { diagnostic: OFFLINE });
		expect(readPublishResult(run(text, 1), worktree)).toEqual({ outcome: "failed", action: "push", ran: true, failure: { command, diagnostic: OFFLINE, output } });
	});

	test("no result file is a failure whose effect is unknown", () => {
		const result = readPublishResult(run(null, 1), worktree);
		expect(result).toMatchObject({ outcome: "failed", action: "push", ran: true, failure: { command } });
		if (result.outcome !== "failed") throw new Error("unreachable");
		expect(result.failure.diagnostic).toContain("left no result, so what it did is unknown");
	});

	test("a record for another worktree is not used", () => {
		const text = record(published, { worktree: { ...JSON.parse(record(published)).worktree, path: "/elsewhere", canonicalPath: "/elsewhere" } });
		const result = readPublishResult(run(text, 0), worktree);
		expect(result).toMatchObject({ outcome: "failed", ran: true });
		if (result.outcome !== "failed") throw new Error("unreachable");
		expect(result.failure.diagnostic).toContain("not for /work/app-worktrees/feat-login");
	});

	test("a publish object that is missing, unknown, or does not go with the outcome is unreadable", () => {
		const cases: [string, number][] = [
			[record(undefined), 0],
			[record({ ...published, result: "shoved" }), 0],
			[record({ ...published, remote: 5 }), 0],
			// Published, but the outcome says failed.
			[record(published, { outcome: "failed", exitCode: 1, diagnostic: "x" }), 1],
			// Refused, but the outcome says succeeded.
			[record({ ...published, result: "refused" }, { outcome: "succeeded", exitCode: 0 }), 0],
		];
		for (const [text, exitCode] of cases) {
			const result = readPublishResult(run(text, exitCode), worktree);
			expect(result).toMatchObject({ outcome: "failed", action: "push", ran: true });
			if (result.outcome !== "failed") throw new Error("unreachable");
			expect(result.failure.diagnostic).toContain("left a result this app cannot read");
		}
	});
});
