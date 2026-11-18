import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { WorktreeRow } from "../src/mainview/components/WorktreeRow";
import { createMockEngine, samplePickableRepository, sampleRepositories } from "../src/mainview/engine/mock";
import { describeRowMarkers } from "../src/mainview/format";
import { describePullRequestMarkers, describeRepositoryPullRequestProblem, describeWorktreePullRequestProblem } from "../src/mainview/pull-request-format";
import { createAppStore } from "../src/mainview/store/store";
import type { PullRequest, PullRequestEntry, PullRequestList } from "../src/shared/pull-requests";

const settle = async () => {
	for (let round = 0; round < 8; round++) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const LOOKUP = "/work/timber-worktrees/feat-github-issue-lookup";

const pull = (fields: Partial<PullRequest> = {}): PullRequest => ({
	number: 42,
	url: "https://github.com/example/timber/pull/42",
	title: "Look up GitHub issues",
	state: "open",
	baseBranch: "main",
	checks: { summary: "passing", passing: 3, failing: 0, pending: 0, runs: [] },
	review: "review-required",
	description: "",
	...fields,
});
const found = (fields: Partial<PullRequest> = {}): PullRequestEntry => ({ path: LOOKUP, branch: "feat/github-issue-lookup", outcome: "found", pullRequest: pull(fields) });
const failed = (reason: "offline" | "sign-in-needed" | "not-github" | "failed"): PullRequestEntry => ({ path: LOOKUP, branch: "feat/github-issue-lookup", outcome: "failed", reason, diagnostic: "Timber's words" });
const shown = (entry: PullRequestEntry | null) => describePullRequestMarkers(entry).map(marker => marker.text);

describe("pull request markers", () => {
	test("give the number and state, then the checks and the review while it is open or a draft", () => {
		expect(shown(found())).toEqual(["#42", "checks pass", "review required"]);
		expect(shown(found({ state: "draft", checks: { summary: "pending", passing: 1, failing: 0, pending: 2, runs: [] } }))).toEqual(["#42 draft", "checks running", "review required"]);
		expect(shown(found({ checks: { summary: "failing", passing: 2, failing: 1, pending: 0, runs: [] }, review: "changes-requested" }))).toEqual(["#42", "checks fail", "changes requested"]);
		expect(shown(found({ review: "approved" }))).toEqual(["#42", "checks pass", "approved"]);
		// No checks and no review decision are not marked.
		expect(shown(found({ checks: { summary: "none", passing: 0, failing: 0, pending: 0, runs: [] }, review: "none" }))).toEqual(["#42"]);
	});

	test("a merged or closed pull request has only its number and state", () => {
		expect(shown(found({ state: "merged", review: "approved" }))).toEqual(["#42 merged"]);
		expect(shown(found({ state: "closed", checks: { summary: "failing", passing: 0, failing: 1, pending: 0, runs: [] } }))).toEqual(["#42 closed"]);
	});

	test("each has a whole sentence for its tooltip", () => {
		expect(describePullRequestMarkers(found({ checks: { summary: "failing", passing: 2, failing: 1, pending: 1, runs: [] }, review: "changes-requested" })).map(marker => marker.tooltip)).toEqual([
			"Pull request #42 into main is open: Look up GitHub issues.",
			"Checks fail on pull request #42: 1 failing, 1 pending, 2 passing.",
			"A reviewer asked for changes on pull request #42.",
		]);
		expect(describePullRequestMarkers(found({ state: "merged", title: "Done!" }))[0]!.tooltip).toBe("Pull request #42 was merged into main: Done! If nothing else is left in this worktree, it can go.");
		expect(describePullRequestMarkers(found({ state: "draft", title: "" }))[0]!.tooltip).toBe("Pull request #42 into main is a draft.");
		expect(describePullRequestMarkers(found({ state: "closed" }))[0]!.tooltip).toBe("Pull request #42 into main was closed without merging: Look up GitHub issues.");
	});

	test("a branch with no pull request, or one that could not be read, shows nothing on its row", () => {
		expect(shown(null)).toEqual([]);
		expect(shown({ path: LOOKUP, branch: "feat/github-issue-lookup", outcome: "none" })).toEqual([]);
		expect(shown(failed("offline"))).toEqual([]);
	});

	test("sit with the row's state flags, after them, and before the change counts", () => {
		const worktree = sampleRepositories[0]!.worktrees[1]!;
		const markers = describeRowMarkers(worktree, found());
		expect(markers.map(marker => [marker.place, marker.text])).toEqual([
			["branch", "2"],
			["pull-request", "#42"],
			["pull-request", "checks pass"],
			["pull-request", "review required"],
			["changes", "3M"],
			["changes", "1U"],
		]);
	});

	test("the row draws them with their tooltips, red only with words, and gives every sentence to assistive technology", () => {
		const worktree = sampleRepositories[0]!.worktrees[1]!;
		const markup = renderToStaticMarkup(<WorktreeRow worktree={worktree} selected={false} onSelect={() => {}} pullRequest={found({ checks: { summary: "failing", passing: 0, failing: 1, pending: 0, runs: [] } })} />);
		expect(markup).toContain('<span class="row-flag pr" title="Pull request #42 into main is open: Look up GitHub issues." aria-hidden="true">#42</span>');
		expect(markup).toContain('<span class="row-flag pr failing" title="Checks fail on pull request #42: 1 failing." aria-hidden="true">checks fail</span>');
		expect(markup).toContain('hidden="">2 commits to push to origin/feat/github-issue-lookup, as of the last fetch. Pull request #42 into main is open: Look up GitHub issues. Checks fail on pull request #42: 1 failing. Pull request #42 needs an approving review before it can merge. 3 files');
	});
});

describe("pull requests that could not be read", () => {
	const list = (entry: PullRequestEntry): PullRequestList => ({ ok: true, worktrees: [entry] });

	test("say so with a quiet word and the reason, once per repository", () => {
		expect(describeRepositoryPullRequestProblem(undefined)).toBeNull();
		expect(describeRepositoryPullRequestProblem(list(found()))).toBeNull();
		expect(describeRepositoryPullRequestProblem(list(failed("offline")))).toEqual({
			text: "PRs offline",
			tooltip: "Pull requests could not be read: GitHub could not be reached. The app tries again after the next fetch. Timber says: Timber's words.",
		});
		expect(describeRepositoryPullRequestProblem(list(failed("sign-in-needed")))!.text).toBe("PRs need sign-in");
		expect(describeRepositoryPullRequestProblem(list(failed("sign-in-needed")))!.tooltip).toContain("The app never asks");
		expect(describeRepositoryPullRequestProblem(list(failed("not-github")))!.text).toBe("not on GitHub");
		expect(describeRepositoryPullRequestProblem(list(failed("failed")))!.text).toBe("PRs failed");
	});

	test("an answer that could not be read at all is said too, never taken for no pull requests", () => {
		expect(describeRepositoryPullRequestProblem({ ok: false, message: "timber __app-pr exited with code 1: unknown command '__app-pr'" })).toEqual({
			text: "PRs unknown",
			tooltip: "Pull requests could not be read with timber __app-pr. timber __app-pr exited with code 1: unknown command '__app-pr'.",
		});
		expect(describeWorktreePullRequestProblem({ ok: false, message: "no" }, null)!.text).toBe("PRs unknown");
		expect(describeWorktreePullRequestProblem(list(failed("offline")), failed("offline"))!.text).toBe("PRs offline");
		expect(describeWorktreePullRequestProblem(list(found()), found())).toBeNull();
	});
});

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { store, engine };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

describe("the store and the window", () => {
	test("read each repository's pull requests once it is listed, and show them on the rows", async () => {
		const { store, engine } = await startedStore();
		expect(engine.pullRequestReads(TIMBER)).toBe(1);
		expect(engine.pullRequestReads("/work/api-server")).toBe(1);
		const answer = store.getState().pullRequests[TIMBER];
		expect(answer?.ok).toBe(true);
		const markup = render(store);
		expect(markup).toContain(">#42</span>");
		expect(markup).toContain(">approved</span>");
		expect(markup).toContain(">#38</span>");
		expect(markup).toContain(">changes requested</span>");
	});

	test("read them again whenever a fetch ends, in the background or after Fetch now, and it failed or not", async () => {
		const { store, engine } = await startedStore();
		await store.fetchNow(TIMBER);
		await settle();
		expect(engine.pullRequestReads(TIMBER)).toBe(2);
		engine.endFetches("offline");
		await store.fetchNow(TIMBER);
		await settle();
		expect(engine.pullRequestReads(TIMBER)).toBe(3);
		// Another repository is not read for it.
		expect(engine.pullRequestReads("/work/api-server")).toBe(1);
	});

	test("the workspace header shows the same markers and Open pull request, and openLink hands the link to the engine", async () => {
		const { store, engine } = await startedStore();
		const lookup = store.getState().repositories[0]!.worktrees.find(worktree => worktree.path === LOOKUP)!;
		store.select(lookup.id);
		const markup = render(store);
		expect(markup).toContain('<span class="pull-marker" title="Pull request #42 into main is open: Look up GitHub issues by number." aria-hidden="true">#42</span>');
		expect(markup).toContain(">Open pull request</button>");
		const opened: string[] = [];
		engine.openLink = async url => {
			opened.push(url);
			return true;
		};
		await store.openLink("https://github.com/example/timber/pull/42");
		expect(opened).toEqual(["https://github.com/example/timber/pull/42"]);
	});

	test("a branch with no pull request shows nothing, and no Open pull request", async () => {
		const { store } = await startedStore();
		// The primary checkout is selected first; main has no pull request.
		const markup = render(store);
		expect(markup).not.toContain("Open pull request");
		expect(markup).not.toContain("pull-marker");
	});

	test("a repository off GitHub gets a quiet grey word with the reason, and its rows none", async () => {
		const engine = createMockEngine([...sampleRepositories, samplePickableRepository]);
		const { store } = await startedStore(engine);
		const markup = render(store);
		expect(markup).toContain('<span class="group-flag pulls-failed" title="Pull requests are read from github.com only, and this repository&#x27;s remote is not there. Timber says: The selected remote is not a github.com repository.');
		expect(markup).toContain(">not on GitHub</span>");
		expect(store.getState().dialog).toBeNull();
	});

	test("an answer that cannot be read is a quiet word, kept until the next read works", async () => {
		const engine = createMockEngine();
		engine.setPullRequests(TIMBER, { ok: false, message: "timber __app-pr exited with code 1: unknown command '__app-pr'" });
		const { store } = await startedStore(engine);
		expect(render(store)).toContain(">PRs unknown</span>");
		engine.setPullRequests(TIMBER, null);
		await store.fetchNow(TIMBER);
		await settle();
		expect(render(store)).not.toContain("PRs unknown");
	});

	test("a repository that is removed forgets its pull requests", async () => {
		const { store } = await startedStore();
		await store.removeRepository(TIMBER);
		await settle();
		expect(store.getState().pullRequests[TIMBER]).toBeUndefined();
	});
});
