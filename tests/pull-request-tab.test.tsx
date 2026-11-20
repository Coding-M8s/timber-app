import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { browserSampleRepositories, createMockEngine, samplePickableRepository, sampleRepositories } from "../src/mainview/engine/mock";
import { samplePullRequests } from "../src/mainview/engine/mock-pull-requests";
import { NO_CHECKS, NO_DESCRIPTION, NO_REVIEWERS, OPEN_IN_BROWSER, describePullRequestTab } from "../src/mainview/pull-request-tab-format";
import { createAppStore } from "../src/mainview/store/store";
import type { PullRequest, PullRequestEntry, PullRequestList } from "../src/shared/pull-requests";

const settle = async () => {
	for (let round = 0; round < 8; round++) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const LOOKUP = "/work/timber-worktrees/feat-github-issue-lookup";
const BRANCH = "feat/github-issue-lookup";

const pull = (fields: Partial<PullRequest> = {}): PullRequest => ({
	number: 42,
	url: "https://github.com/example/timber/pull/42",
	title: "Look up GitHub issues",
	state: "open",
	baseBranch: "main",
	checks: {
		summary: "failing",
		passing: 1,
		failing: 1,
		pending: 0,
		runs: [
			{ name: "test", status: "failing", url: "https://github.com/example/timber/actions/runs/1" },
			{ name: "lint", status: "passing", url: null },
			{ name: "docs", status: "skipped", url: "https://github.com/example/timber/actions/runs/3" },
		],
	},
	review: "changes-requested",
	reviewers: [],
	reviewersComplete: true,
	description: "Closes #41.",
	...fields,
});
const found = (fields: Partial<PullRequest> = {}): PullRequestEntry => ({ path: LOOKUP, branch: BRANCH, outcome: "found", pullRequest: pull(fields) });
const list = (entry: PullRequestEntry): PullRequestList => ({ ok: true, worktrees: [entry] });

describe("describePullRequestTab", () => {
	test("a pull request gives its title, state, base, checks, and review", () => {
		const view = describePullRequestTab(list(found()), found(), BRANCH);
		expect(view).toMatchObject({
			kind: "found",
			heading: "Look up GitHub issues",
			state: "Open",
			base: "into main",
			checks: { text: "Checks fail: 1 failing, 1 passing, 1 skipped.", warning: true },
			review: { label: "Changes requested", sentence: "A reviewer asked for changes.", warning: true },
			openTitle: "Open pull request #42 on GitHub in the browser",
		});
	});

	test("each state, review decision, and checks summary has its words", () => {
		const of = (fields: Partial<PullRequest>) => {
			const view = describePullRequestTab(list(found(fields)), found(fields), BRANCH);
			if (view.kind !== "found") throw new Error(view.kind);
			return view;
		};
		expect([of({ state: "draft" }).state, of({ state: "merged" }).state, of({ state: "closed" }).state]).toEqual(["Draft", "Merged", "Closed"]);
		expect(of({ state: "merged" }).base).toBe("merged into main");
		expect(of({ review: "approved" }).review).toEqual({ label: "Approved", sentence: "A reviewer approved it.", warning: false });
		expect(of({ review: "review-required" }).review.label).toBe("Review required");
		expect(of({ review: "none" }).review.sentence).toBe("The repository asks for no review decision on it.");
		expect(of({ checks: { summary: "pending", passing: 0, failing: 0, pending: 2, runs: [] } }).checks).toEqual({ text: "Checks still run: 2 pending.", warning: false });
		expect(of({ checks: { summary: "none", passing: 0, failing: 0, pending: 0, runs: [] } }).checks.text).toBe(NO_CHECKS);
		expect(of({ title: "" }).heading).toBe("Pull request #42");
	});

	test("each reviewer has its state in a word, teams and bots say so, and a request for changes is red", () => {
		const reviewers = [
			{ kind: "team", name: "example/maintainers", state: "requested", url: "https://github.com/orgs/example/teams/maintainers" },
			{ kind: "user", name: "bob", state: "changes-requested", url: "https://github.com/bob" },
			{ kind: "user", name: "carol", state: "approved", url: null },
			{ kind: "bot", name: "copilot-pull-request-reviewer", state: "commented", url: null },
			{ kind: "user", name: "dave", state: "dismissed", url: "https://github.com/dave" },
		] as const;
		const view = describePullRequestTab(list(found({ reviewers: [...reviewers] })), found({ reviewers: [...reviewers] }), BRANCH);
		if (view.kind !== "found") throw new Error(view.kind);
		expect(view.reviewers).toEqual([
			{ name: "example/maintainers", kind: "team", state: "requested", warning: false, url: "https://github.com/orgs/example/teams/maintainers", openTitle: "Open example/maintainers on GitHub in the browser" },
			{ name: "bob", kind: null, state: "changes requested", warning: true, url: "https://github.com/bob", openTitle: "Open bob on GitHub in the browser" },
			{ name: "carol", kind: null, state: "approved", warning: false, url: null, openTitle: "Open carol on GitHub in the browser" },
			{ name: "copilot-pull-request-reviewer", kind: "bot", state: "commented", warning: false, url: null, openTitle: "Open copilot-pull-request-reviewer on GitHub in the browser" },
			{ name: "dave", kind: null, state: "dismissed", warning: false, url: "https://github.com/dave", openTitle: "Open dave on GitHub in the browser" },
		]);
		expect(view.reviewersNote).toBeNull();
	});

	test("no reviewers, or reviewers Timber's login could not all read, are said in a quiet line", () => {
		const note = (fields: Partial<PullRequest>) => {
			const view = describePullRequestTab(list(found(fields)), found(fields), BRANCH);
			if (view.kind !== "found") throw new Error(view.kind);
			return view.reviewersNote;
		};
		const one = [{ kind: "user", name: "dave", state: "requested", url: null }] as const;
		expect(note({ reviewers: [], reviewersComplete: true })).toBe(NO_REVIEWERS);
		expect(note({ reviewers: [], reviewersComplete: false })).toBe("No reviewers could be read with Timber's GitHub login. Some, such as a team it cannot see, may be hidden from it.");
		expect(note({ reviewers: [...one], reviewersComplete: false })).toBe("Some reviewers could not be read with Timber's GitHub login, such as a team it cannot see.");
		expect(note({ reviewers: [...one], reviewersComplete: true })).toBeNull();
	});

	test("no pull request is a quiet note, also for a detached HEAD", () => {
		const none: PullRequestEntry = { path: LOOKUP, branch: BRANCH, outcome: "none" };
		expect(describePullRequestTab(list(none), none, BRANCH)).toEqual({ kind: "none", title: "No pull request yet", text: "GitHub has no pull request for feat/github-issue-lookup." });
		expect(describePullRequestTab(list(none), { ...none, branch: null }, null).kind).toBe("none");
	});

	test("offline, sign-in needed, not on GitHub, and an unreadable answer give the reason in place", () => {
		const failed = (reason: "offline" | "sign-in-needed" | "not-github" | "failed"): PullRequestEntry => ({ path: LOOKUP, branch: BRANCH, outcome: "failed", reason, diagnostic: "Timber's words" });
		expect(describePullRequestTab(list(failed("offline")), failed("offline"), BRANCH)).toEqual({
			kind: "problem",
			title: "GitHub could not be reached",
			text: "Pull requests could not be read: GitHub could not be reached. The app tries again after the next fetch. Timber says: Timber's words.",
		});
		expect(describePullRequestTab(list(failed("sign-in-needed")), failed("sign-in-needed"), BRANCH)).toMatchObject({ title: "Sign-in needed" });
		expect(describePullRequestTab(list(failed("not-github")), failed("not-github"), BRANCH)).toMatchObject({ title: "Not on GitHub" });
		expect(describePullRequestTab(list(failed("failed")), failed("failed"), BRANCH)).toMatchObject({ title: "The pull request could not be read" });
		expect(describePullRequestTab({ ok: false, message: "unknown command '__app-pr'" }, null, BRANCH)).toEqual({
			kind: "problem",
			title: "The pull request is unknown",
			text: "Pull requests could not be read with timber __app-pr. unknown command '__app-pr'.",
		});
		// An answer that leaves this worktree out is never taken for no pull request.
		expect(describePullRequestTab({ ok: true, worktrees: [] }, null, BRANCH).kind).toBe("problem");
	});

	test("before the first answer it says so, and never that there is none", () => {
		expect(describePullRequestTab(undefined, null, BRANCH)).toMatchObject({ kind: "waiting", title: "Not read yet" });
	});
});

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { store, engine };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);
const panelOf = (markup: string) => markup.slice(markup.indexOf('id="workspace-panel"'));

function showing(store: ReturnType<typeof createAppStore>, path: string) {
	for (const repository of store.getState().repositories) {
		const worktree = repository.worktrees.find(candidate => candidate.path === path);
		if (worktree) store.select(worktree.id);
	}
	store.showTab("pull-request");
	return panelOf(render(store));
}

describe("the Pull request tab", () => {
	test("shows the pull request with its checks, review, description, and Open in browser", async () => {
		const { store, engine } = await startedStore();
		const panel = showing(store, "/work/timber-worktrees/fix-macos-portability");
		expect(panel).toContain('aria-labelledby="tab-pull-request"');
		expect(panel).toContain(">Run on macOS without GNU tools</h2>");
		expect(panel).toContain(">Open</span><span>#38</span><span>into main</span>");
		expect(panel).toContain(`>${OPEN_IN_BROWSER}</button>`);
		expect(panel).toContain('<p class="pull-tab-line failing"><span class="pull-tab-strong">Changes requested.</span> A reviewer asked for changes.</p>');
		expect(panel).toContain('<p class="pull-tab-line failing">Checks fail: 1 failing, 1 pending, 2 passing.</p>');
		expect(panel).toContain('<span class="pull-check-status failing">failing</span><span class="pull-check-name" title="test (macos)">test (macos)</span><button type="button" class="text-button" title="Open test (macos) in the browser">Open</button>');
		// A status without a link has no Open.
		expect(panel).toContain('<span class="pull-check-name" title="legacy status">legacy status</span></li>');
		expect(panel).toContain("Replaces `sed -i` and `readlink -f`, which differ on macOS.");
		// Reviewers sit under the decision, each with its state, and an Open when it has a link.
		expect(panel).toContain('<li class="pull-reviewer"><span class="pull-reviewer-state">requested</span><span class="pull-reviewer-name" title="example/maintainers">example/maintainers<span class="pull-reviewer-kind">team</span></span><button type="button" class="text-button" title="Open example/maintainers on GitHub in the browser">Open</button></li>');
		expect(panel).toContain('<li class="pull-reviewer"><span class="pull-reviewer-state failing">changes requested</span><span class="pull-reviewer-name" title="bob">bob</span><button type="button" class="text-button" title="Open bob on GitHub in the browser">Open</button></li>');
		// The tab reads only: it runs nothing, and only Open asks the engine for anything.
		expect(engine.pullRequestReads(TIMBER)).toBe(1);
		expect(store.getState().dialog).toBeNull();
	});

	test("Open in browser and a check's Open hand their links to the engine", async () => {
		const { store, engine } = await startedStore();
		const opened: string[] = [];
		engine.openLink = async url => {
			opened.push(url);
			return true;
		};
		showing(store, LOOKUP);
		await store.openLink(samplePullRequests[BRANCH]!.url);
		expect(opened).toEqual(["https://github.com/example/timber/pull/42"]);
	});

	test("a description shows as text, never as markup", async () => {
		const { store } = await startedStore();
		const panel = showing(store, LOOKUP);
		expect(panel).toContain('<div class="pull-description">Adds `timber new github:&lt;n&gt;`, which names the branch after the issue.\n\nCloses #41.\n\n&lt;b&gt;Markup&lt;/b&gt; from GitHub shows as text.</div>');
		expect(panel).not.toContain("<b>");
	});

	test("every sample state renders in the browser build: open, draft, merged, closed", async () => {
		const { store } = await startedStore(createMockEngine(browserSampleRepositories));
		expect(showing(store, LOOKUP)).toContain('<span class="pull-state open">Open</span>');
		expect(showing(store, "/work/billing-worktrees/feat-invoices")).toContain('<span class="pull-state draft">Draft</span>');
		expect(showing(store, "/work/api-server-worktrees/feat-rate-limit-headers")).toContain("<span>merged into main</span>");
		const closed = showing(store, "/work/billing-worktrees/release-2.4");
		expect(closed).toContain('<span class="pull-state closed">Closed</span>');
		expect(closed).toContain(NO_CHECKS);
		expect(closed).toContain(NO_DESCRIPTION);
		expect(closed).toContain(`<p class="pull-tab-line quiet">${NO_REVIEWERS}</p>`);
		// A bot, and a list Timber's login could not read all of.
		expect(showing(store, LOOKUP)).toContain('<span class="pull-reviewer-kind">bot</span>');
		expect(showing(store, "/work/billing-worktrees/feat-invoices")).toContain("Some reviewers could not be read with Timber&#x27;s GitHub login");
	});

	test("a branch with no pull request gets a quiet placeholder", async () => {
		const { store } = await startedStore();
		const panel = showing(store, TIMBER);
		expect(panel).toContain('<div class="empty pull-tab-note none"><p class="empty-title">No pull request yet</p><p class="empty-text">GitHub has no pull request for main.</p></div>');
		expect(panel).not.toContain(OPEN_IN_BROWSER);
	});

	test("a repository off GitHub says why in place, never in a dialog", async () => {
		const engine = createMockEngine([...sampleRepositories, samplePickableRepository]);
		const { store } = await startedStore(engine);
		const panel = showing(store, samplePickableRepository.path);
		expect(panel).toContain('<p class="empty-title">Not on GitHub</p>');
		expect(panel).toContain("Pull requests are read from github.com only");
		expect(store.getState().dialog).toBeNull();
	});

	test("offline and sign-in needed say why in place", async () => {
		const engine = createMockEngine();
		const failing = (reason: "offline" | "sign-in-needed"): PullRequestList => ({
			ok: true,
			worktrees: sampleRepositories[0]!.worktrees.map((worktree): PullRequestEntry => worktree.branch === null
				? { path: worktree.path, branch: null, outcome: "none" }
				: { path: worktree.path, branch: worktree.branch, outcome: "failed", reason, diagnostic: "Timber's words" }),
		});
		engine.setPullRequests(TIMBER, failing("offline"));
		const { store } = await startedStore(engine);
		expect(showing(store, LOOKUP)).toContain('<p class="empty-title">GitHub could not be reached</p>');
		engine.setPullRequests(TIMBER, failing("sign-in-needed"));
		await store.fetchNow(TIMBER);
		await settle();
		expect(showing(store, LOOKUP)).toContain('<p class="empty-title">Sign-in needed</p>');
		expect(store.getState().dialog).toBeNull();
	});

	test("follows the pull requests each time they are read again", async () => {
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		expect(showing(store, LOOKUP)).toContain('<span class="pull-state open">Open</span>');
		const merged: PullRequestList = {
			ok: true,
			worktrees: [{ path: LOOKUP, branch: BRANCH, outcome: "found", pullRequest: { ...samplePullRequests[BRANCH]!, state: "merged" } }],
		};
		engine.setPullRequests(TIMBER, merged);
		await store.fetchNow(TIMBER);
		await settle();
		expect(showing(store, LOOKUP)).toContain('<span class="pull-state merged">Merged</span>');
	});
});
