import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorktreeRow } from "../src/mainview/components/WorktreeRow";
import { describeRowMarkers } from "../src/mainview/format";
import { describeRowProgress, pullRequestStateWord } from "../src/mainview/row-progress-format";
import type { Worktree } from "../src/shared/model";
import type { PullRequest, PullRequestEntry } from "../src/shared/pull-requests";

/**
 * A worktree's progress at a glance (issue 241): one mark leading the second
 * line of its row, and the pull request's number as a button that opens it.
 */

const worktree: Worktree = {
	id: "/work/app/.git\0verified\0/work/app-worktrees/feat-x",
	path: "/work/app-worktrees/feat-x",
	canonicalPath: "/work/app-worktrees/feat-x",
	branch: "feat/x",
	head: "1234567890abcdef1234567890abcdef12345678",
	primary: false,
	detached: false,
	locked: false,
	prunable: false,
	pathExists: true,
	changes: { kind: "known", modified: [], untracked: [] },
	base: null,
	issue: null,
	sync: { kind: "tracking", upstream: "origin/feat/x", ahead: 0, behind: 0 },
};
const forcePushed: Worktree = { ...worktree, sync: { kind: "tracking", upstream: "origin/feat/x", ahead: 0, behind: 0, forcePushed: { at: 1 } } };
const gone: Worktree = { ...worktree, sync: { kind: "gone", upstream: "origin/feat/x" } };

const found = (state: PullRequest["state"]): PullRequestEntry => ({
	path: worktree.path,
	branch: "feat/x",
	outcome: "found",
	pullRequest: {
		number: 42,
		url: "https://github.com/example/app/pull/42",
		title: "Make x",
		state,
		baseBranch: "main",
		checks: { summary: "none", passing: 0, failing: 0, pending: 0, runs: [] },
		review: "none",
		reviewers: [],
		reviewersComplete: true,
		description: "",
	},
});

const progressOf = (tree: Worktree, entry: PullRequestEntry | null = null) => describeRowProgress(describeRowMarkers(tree, entry), entry)?.kind ?? null;

describe("the progress mark", () => {
	test("says each pull request state, a rewritten upstream, and a deleted one", () => {
		expect(progressOf(worktree, found("open"))).toBe("open");
		expect(progressOf(worktree, found("draft"))).toBe("draft");
		expect(progressOf(worktree, found("merged"))).toBe("merged");
		expect(progressOf(worktree, found("closed"))).toBe("closed");
		expect(progressOf(forcePushed)).toBe("force-pushed");
		expect(progressOf(gone)).toBe("upstream-gone");
	});

	test("is the most urgent one when several hold: force-pushed, then merged or closed, then upstream gone, then open or draft", () => {
		expect(progressOf(forcePushed, found("merged"))).toBe("force-pushed");
		expect(progressOf(forcePushed, found("open"))).toBe("force-pushed");
		expect(progressOf(gone, found("merged"))).toBe("merged");
		expect(progressOf(gone, found("closed"))).toBe("closed");
		expect(progressOf(gone, found("open"))).toBe("upstream-gone");
		expect(progressOf(gone, found("draft"))).toBe("upstream-gone");
	});

	test("is not there for a branch level with its upstream, one only local, a detached HEAD, or a pull request not read", () => {
		expect(progressOf(worktree)).toBeNull();
		expect(progressOf({ ...worktree, primary: true })).toBeNull();
		expect(progressOf({ ...worktree, sync: { kind: "unpublished" } })).toBeNull();
		expect(progressOf({ ...worktree, branch: null, detached: true, sync: null })).toBeNull();
		expect(progressOf(worktree, { path: worktree.path, branch: "feat/x", outcome: "failed", reason: "offline", diagnostic: "Offline" })).toBeNull();
		expect(progressOf(worktree, { path: worktree.path, branch: "feat/x", outcome: "none" })).toBeNull();
	});

	test("carries the sentence of the state it stands for", () => {
		const markers = describeRowMarkers(forcePushed, found("open"));
		expect(describeRowProgress(markers, found("open"))?.tooltip).toBe(markers.find(marker => marker.kind === "force-pushed")!.tooltip);
		const merged = describeRowMarkers(gone, found("merged"));
		expect(describeRowProgress(merged, found("merged"))?.tooltip).toBe(merged.find(marker => marker.kind === "pull-request")!.tooltip);
	});
});

describe("the word after the pull request's number", () => {
	test("is the state, except for an open one whose own mark already leads the line", () => {
		expect(pullRequestStateWord("draft", { kind: "draft", tooltip: "" })).toBe("draft");
		expect(pullRequestStateWord("merged", { kind: "merged", tooltip: "" })).toBe("merged");
		expect(pullRequestStateWord("closed", { kind: "closed", tooltip: "" })).toBe("closed");
		expect(pullRequestStateWord("open", { kind: "open", tooltip: "" })).toBeNull();
		expect(pullRequestStateWord("open", { kind: "force-pushed", tooltip: "" })).toBe("open");
		expect(pullRequestStateWord("open", { kind: "upstream-gone", tooltip: "" })).toBe("open");
	});
});

const render = (tree: Worktree, entry: PullRequestEntry | null = null, onOpen?: (url: string) => void) =>
	renderToStaticMarkup(<WorktreeRow worktree={tree} selected={false} onSelect={() => {}} pullRequest={entry} onOpenPullRequest={onOpen} />);

/** The drawing inside a row's progress mark, and its class. */
const markOf = (markup: string) => /<span class="(row-progress [^"]*)" title="[^"]*" aria-hidden="true"><svg[^>]*>(.*?)<\/svg><\/span>/.exec(markup);

describe("a row's progress mark", () => {
	test("leads the second line, outside the row's button, with its tooltip, hidden from assistive technology", () => {
		const markup = render(worktree, found("merged"));
		expect(markup).toContain('</button><div class="row-line row-meta" title="/work/app-worktrees/feat-x"><span class="row-progress progress-merged" title="Pull request #42 was merged into main: Make x. If nothing else is left in this worktree, it can go." aria-hidden="true"><svg');
	});

	test("draws each state in a shape of its own, not only a color", () => {
		const shapes = new Set<string>();
		for (const markup of [render(worktree, found("open")), render(worktree, found("draft")), render(worktree, found("merged")), render(worktree, found("closed")), render(forcePushed), render(gone)]) {
			const mark = markOf(markup);
			expect(mark).not.toBeNull();
			shapes.add(mark![2]!);
		}
		expect(shapes.size).toBe(6);
	});

	test("is not drawn on a row that has none", () => {
		expect(markOf(render(worktree))).toBeNull();
		expect(render(worktree)).not.toContain("row-progress");
	});

	test("leaves the row's description as it was: every marker's sentence", () => {
		const markup = render(gone, found("merged"));
		const sentences = describeRowMarkers(gone, found("merged")).map(marker => marker.tooltip).join(" ");
		expect(markup).toContain(`class="row-description" hidden="">${sentences.replaceAll("'", "&#x27;")}</span>`);
	});
});

describe("a row's pull request number", () => {
	const open = () => {};

	test("is a button beside the row's own, that names what it opens", () => {
		const markup = render(worktree, found("open"), open);
		const label = "Open pull request #42 on GitHub in the browser";
		expect(markup).toContain(`<span class="row-flag pr row-pull"><button type="button" class="row-pull-link" aria-label="${label}" title="${label}.">#42<svg`);
		const rowButton = /<button type="button" class="row"[\s\S]*?<\/button>/.exec(markup)?.[0] ?? "";
		expect(rowButton).not.toContain("row-pull-link");
		expect(markup.match(/<button/g)?.length).toBe(2);
	});

	test("keeps its state's word after it, with the state's sentence as its tooltip", () => {
		const markup = render(worktree, found("merged"), open);
		expect(markup).toContain('<span class="row-pull-state" title="Pull request #42 was merged into main: Make x. If nothing else is left in this worktree, it can go." aria-hidden="true">merged</span>');
	});

	test("an open one says open only when another state's mark leads the line", () => {
		expect(render(worktree, found("open"), open)).not.toContain("row-pull-state");
		expect(render(forcePushed, found("open"), open)).toContain('aria-hidden="true">open</span>');
		// Without a way to open it, the number and its word stay one marker.
		expect(render(forcePushed, found("open"))).toContain('aria-hidden="true">#42 open</span>');
		expect(render(worktree, found("open"))).toContain('aria-hidden="true">#42</span>');
	});

	test("is not a button without a way to open it, or without a pull request", () => {
		expect(render(worktree, found("open"))).not.toContain("row-pull-link");
		expect(render(worktree, null, open)).not.toContain("row-pull-link");
	});
});
