import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { describeRowTitle } from "../src/mainview/base-format";
import { browserSampleRepositories, createMockEngine, sampleRepositories, sampleTimberStatuses } from "../src/mainview/engine/mock";
import { ISSUE_UNKNOWN, describeIssue, issueTitlePart } from "../src/mainview/issue-format";
import type { IssueEntry } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import type { Issue, IssueLookup } from "../src/shared/issues";
import type { IssueLink, Repository, TimberStatus } from "../src/shared/model";

const settle = async () => {
	for (let round = 0; round < 10; round++) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const MAC = "/work/timber-worktrees/fix-macos-portability";
const LOOKUP = "/work/timber-worktrees/feat-github-issue-lookup";

const jira: IssueLink = { kind: "linked", tracker: "jira", key: "PROJ-123", url: "https://example.atlassian.net/browse/PROJ-123" };
const issue = (fields: Partial<Issue> = {}): Issue => ({
	tracker: "jira",
	key: "PROJ-123",
	url: jira.kind === "linked" ? jira.url : "",
	title: "Sign in with SSO",
	status: { name: "In review", category: "in-progress" },
	assignee: "Alex Doe",
	...fields,
});
const entry = (lookup: IssueLookup, key = "PROJ-123"): IssueEntry => ({ tracker: "jira", key, lookup });

describe("describeIssue", () => {
	test("nothing for no link, or a Timber from before the field", () => {
		expect(describeIssue(null, undefined)).toBeNull();
		expect(describeIssue({ kind: "none" }, undefined)).toBeNull();
	});

	test("a found issue gives the key and the tracker's status name, with its link", () => {
		expect(describeIssue(jira, entry({ ok: true, outcome: "found", issue: issue() }))).toMatchObject({
			text: "PROJ-123 · In review",
			sentence: "Jira issue PROJ-123: Sign in with SSO. Status: In review. Assigned to Alex Doe.",
			url: "https://example.atlassian.net/browse/PROJ-123",
			openTitle: "Open Jira issue PROJ-123 in the browser",
			category: "in-progress",
			problem: null,
			warning: false,
		});
	});

	test("a GitHub issue is written by its number after #", () => {
		const github: IssueLink = { kind: "linked", tracker: "github", key: "153", url: "https://github.com/example/app/issues/153" };
		const read = describeIssue(github, { tracker: "github", key: "153", lookup: { ok: true, outcome: "found", issue: issue({ tracker: "github", key: "153", status: { name: "Open", category: "open" }, assignee: null }) } });
		expect(read).toMatchObject({ text: "#153 · Open", openTitle: "Open GitHub issue #153 in the browser" });
		expect(read!.sentence).toEndWith("Unassigned.");
	});

	test("offline and sign-in needed keep the key from the saved link, with a quiet reason and Timber's words", () => {
		const offline = describeIssue(jira, entry({ ok: true, outcome: "failed", reason: "offline", diagnostic: "Jira could not be reached." }));
		expect(offline).toMatchObject({ text: "PROJ-123", problem: "offline", url: jira.kind === "linked" ? jira.url : null, warning: false });
		expect(offline!.sentence).toBe("Jira issue PROJ-123. Timber could not read its status: Jira could not be reached.");
		expect(describeIssue(jira, entry({ ok: true, outcome: "failed", reason: "sign-in-needed", diagnostic: "No login." }))).toMatchObject({ text: "PROJ-123", problem: "sign-in needed" });
		expect(describeIssue(jira, entry({ ok: true, outcome: "failed", reason: "not-found", diagnostic: "x" }))!.problem).toBe("issue not found");
		expect(describeIssue(jira, entry({ ok: true, outcome: "failed", reason: "forbidden", diagnostic: "x" }))!.problem).toBe("no access");
		expect(describeIssue(jira, entry({ ok: false, message: "timber __app-issue exited with code 2." }))).toMatchObject({ text: "PROJ-123", problem: "issue not read" });
	});

	test("before an answer, or with an answer for another link, the key alone", () => {
		const ended = describeIssue(jira, entry({ ok: true, outcome: "found", issue: issue({ title: "Why does SSO fail?" }) }));
		expect(ended!.sentence).toStartWith("Jira issue PROJ-123: Why does SSO fail? Status:");
		expect(describeIssue(jira, undefined)).toMatchObject({ text: "PROJ-123", problem: null, sentence: "Jira issue PROJ-123. Its status has not been read yet." });
		expect(describeIssue(jira, entry({ ok: true, outcome: "found", issue: issue() }, "PROJ-9"))).toMatchObject({ text: "PROJ-123", category: null });
	});

	test("link metadata Timber cannot use is a warning with no link", () => {
		expect(describeIssue({ kind: "invalid", reason: "malformed" }, undefined)).toMatchObject({ text: ISSUE_UNKNOWN, url: null, openTitle: null, warning: true });
	});

	test("the row's tooltip carries the issue after the base", () => {
		const found = describeIssue(jira, entry({ ok: true, outcome: "found", issue: issue() }))!;
		const offline = describeIssue(jira, entry({ ok: true, outcome: "failed", reason: "offline", diagnostic: "x" }))!;
		expect(describeRowTitle({ path: "/work/a", base: { kind: "assigned", ref: "refs/remotes/origin/main" } }, issueTitlePart(found))).toBe("/work/a (Base origin/main) (PROJ-123 · In review)");
		expect(describeRowTitle({ path: "/work/a", base: null }, issueTitlePart(offline))).toBe("/work/a (PROJ-123, offline)");
		expect(describeRowTitle({ path: "/work/a", base: null })).toBe("/work/a");
	});
});

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { store, engine };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);
const headerOf = (markup: string) => markup.slice(markup.indexOf('class="workspace-header"'), markup.indexOf('role="tablist"'));
const panelOf = (markup: string) => markup.slice(markup.indexOf('id="workspace-panel"'));
const idOf = (store: ReturnType<typeof createAppStore>, path: string) => store.getState().repositories.flatMap(repository => repository.worktrees).find(worktree => worktree.path === path)!.id;

function selecting(store: ReturnType<typeof createAppStore>, path: string, tab: "workspace" | "pull-request" = "workspace") {
	store.select(idOf(store, path));
	store.showTab(tab);
	return render(store);
}

describe("reading linked issues", () => {
	test("reads each linked worktree once when first listed, and nothing for worktrees without a link", async () => {
		const { store, engine } = await startedStore();
		expect(engine.issueReads(MAC)).toBe(1);
		expect(engine.issueReads(LOOKUP)).toBe(1);
		expect(engine.issueReads("/work/api-server-worktrees/feat-rate-limit-headers")).toBe(1);
		expect(engine.issueReads(TIMBER)).toBe(0);
		expect(engine.issueReads("/work/timber-worktrees/spike-new-idea")).toBe(0);
		expect(store.getState().issues[idOf(store, MAC)]).toMatchObject({ tracker: "jira", key: "TIM-88", lookup: { ok: true, outcome: "found" } });
	});

	test("reads them again when a fetch of the repository ends, and only that repository's", async () => {
		const { store, engine } = await startedStore();
		await store.fetchNow(TIMBER);
		await settle();
		expect(engine.issueReads(MAC)).toBe(2);
		expect(engine.issueReads(LOOKUP)).toBe(2);
		expect(engine.issueReads("/work/api-server-worktrees/feat-rate-limit-headers")).toBe(1);
	});

	test("the reads of one repository run one after another, never at once", async () => {
		const engine = createMockEngine(sampleRepositories.slice(0, 1));
		const answer = engine.readIssue.bind(engine);
		let running = 0;
		let most = 0;
		engine.readIssue = async request => {
			running += 1;
			most = Math.max(most, running);
			await Bun.sleep(5);
			running -= 1;
			return answer(request);
		};
		const { store } = await startedStore(engine);
		await Bun.sleep(40);
		expect(engine.issueReads(MAC)).toBe(1);
		expect(engine.issueReads(LOOKUP)).toBe(1);
		// A fetch that ends while reads run adds no second read at once.
		void store.fetchNow(TIMBER);
		await Bun.sleep(1);
		await store.fetchNow(TIMBER);
		await Bun.sleep(60);
		expect(engine.issueReads(MAC)).toBeGreaterThanOrEqual(2);
		expect(most).toBe(1);
	});

	test("a link that changes while its old one is read is read again once the old answer is in", async () => {
		const repositories: Repository[] = structuredClone(sampleRepositories);
		const engine = createMockEngine(repositories);
		const answer = engine.readIssue.bind(engine);
		let release!: () => void;
		let held = true;
		engine.readIssue = async request => {
			if (held && request.worktree === MAC) {
				held = false;
				await new Promise<void>(resolve => { release = resolve; });
			}
			return answer(request);
		};
		const { store } = await startedStore(engine);
		const mac = repositories[0]!.worktrees.find(worktree => worktree.path === MAC)!;
		mac.issue = { kind: "linked", tracker: "jira", key: "TIM-90", url: "https://example.atlassian.net/browse/TIM-90" };
		engine.setRepositories(repositories);
		await store.reloadRepository(TIMBER);
		await settle();
		expect(idOf(store, MAC) in store.getState().issues).toBe(false);
		release();
		await settle();
		expect(store.getState().issues[idOf(store, MAC)]).toMatchObject({ key: "TIM-90" });
	});

	test("the first reads start when Timber becomes ready", async () => {
		let status: TimberStatus = sampleTimberStatuses["not-found"];
		const engine = createMockEngine(sampleRepositories, () => status);
		const { store } = await startedStore(engine);
		expect(engine.issueReads(MAC)).toBe(0);
		status = sampleTimberStatuses.ready;
		await store.retryTimber();
		await settle();
		expect(engine.issueReads(MAC)).toBe(1);
		expect(store.getState().issues[idOf(store, MAC)]).toMatchObject({ key: "TIM-88", lookup: { ok: true, outcome: "found" } });
	});

	test("nothing is read while Timber is not ready", async () => {
		const engine = createMockEngine(sampleRepositories, sampleTimberStatuses["not-found"]);
		await startedStore(engine);
		expect(engine.issueReads(MAC)).toBe(0);
	});

	test("an answer about another issue than the saved one is not shown as found", async () => {
		const engine = createMockEngine();
		engine.setIssue(MAC, { ok: true, outcome: "found", issue: issue({ key: "OTHER-1" }) });
		const { store } = await startedStore(engine);
		expect(store.getState().issues[idOf(store, MAC)]!.lookup).toEqual({ ok: false, message: "timber __app-issue answered about jira OTHER-1, not the saved jira TIM-88." });
	});

	test("a link that changes is read again, and a link that goes is forgotten", async () => {
		const repositories: Repository[] = structuredClone(sampleRepositories);
		const engine = createMockEngine(repositories);
		const { store } = await startedStore(engine);
		const mac = repositories[0]!.worktrees.find(worktree => worktree.path === MAC)!;
		mac.issue = { kind: "linked", tracker: "jira", key: "TIM-90", url: "https://example.atlassian.net/browse/TIM-90" };
		const lookup = repositories[0]!.worktrees.find(worktree => worktree.path === LOOKUP)!;
		lookup.issue = { kind: "none" };
		engine.setRepositories(repositories);
		await store.reloadRepository(TIMBER);
		await settle();
		expect(engine.issueReads(MAC)).toBe(2);
		expect(store.getState().issues[idOf(store, MAC)]).toMatchObject({ key: "TIM-90" });
		expect(idOf(store, LOOKUP) in store.getState().issues).toBe(false);
	});
});

describe("the issue on screen", () => {
	test("the workspace header shows the key and status as a link to the issue", async () => {
		const { store } = await startedStore();
		const header = headerOf(selecting(store, MAC));
		expect(header).toContain('<button type="button" class="issue-link in-progress" title="Jira issue TIM-88: Timber fails on macOS without GNU tools. Status: In Review. Assigned to Alex Doe."');
		expect(header).toContain(">TIM-88 · In Review</button>");
		expect(header).toContain("Open Jira issue TIM-88 in the browser.");
	});

	test("the row's tooltip shows the key and status", async () => {
		const { store } = await startedStore();
		const markup = selecting(store, MAC);
		// The rows can be moved, which their tooltip ends by saying.
		expect(markup).toContain(`title="${MAC} (Base origin/main) (TIM-88 · In Review). Tag: Work. Drag to reorder, or press Alt+Up or Alt+Down."`);
		expect(markup).toContain(`title="${LOOKUP} (Base origin/main) (#41 · Open). Tag: Work. Drag to reorder, or press Alt+Up or Alt+Down."`);
	});

	test("the link opens the saved address in the browser", async () => {
		const { store, engine } = await startedStore();
		const opened: string[] = [];
		engine.openLink = async url => {
			opened.push(url);
			return true;
		};
		await store.openLink("https://example.atlassian.net/browse/TIM-88");
		expect(opened).toEqual(["https://example.atlassian.net/browse/TIM-88"]);
	});

	test("offline and sign-in needed show the key and a quiet reason, never a dialog", async () => {
		const { store } = await startedStore(createMockEngine(browserSampleRepositories));
		const offline = headerOf(selecting(store, "/work/billing-worktrees/feat-invoices"));
		expect(offline).toContain(">BILL-12</button>");
		expect(offline).toContain('<span class="pull-problem" title="Jira issue BILL-12. Timber could not read its status: Jira could not be reached; check connectivity and try again.">offline</span>');
		const signIn = headerOf(selecting(store, "/work/billing-worktrees/feat-tax-rules"));
		expect(signIn).toContain(">BILL-30</button>");
		expect(signIn).toContain(">sign-in needed</span>");
		expect(store.getState().dialog).toBeNull();
		expect(store.getState().toasts).toEqual([]);
	});

	test("link metadata Timber cannot use is said as a warning, with no link", async () => {
		const { store } = await startedStore(createMockEngine(browserSampleRepositories));
		const header = headerOf(selecting(store, "/work/billing-worktrees/fix-unreadable"));
		expect(header).toContain(`<span class="saved-base-warning" title="Timber found a saved issue link for this worktree but cannot use it: it is not in the form Timber expects. The issue is not known, and the app does not guess one.">${ISSUE_UNKNOWN}</span>`);
		expect(header).not.toContain("issue-link");
	});

	test("a worktree without a link shows no issue", async () => {
		const { store } = await startedStore();
		const markup = selecting(store, TIMBER);
		expect(headerOf(markup)).not.toContain("issue-link");
		expect(panelOf(selecting(store, TIMBER, "pull-request"))).not.toContain("issue-section");
	});

	test("the Pull request tab shows the issue above the pull request", async () => {
		const { store } = await startedStore();
		const panel = panelOf(selecting(store, MAC, "pull-request"));
		const at = panel.indexOf('class="pull-tab-section issue-section"');
		expect(at).toBeGreaterThan(-1);
		expect(at).toBeLessThan(panel.indexOf('class="pull-tab-header after-issue"'));
		expect(panel).toContain('<span class="pull-tab-strong">Timber fails on macOS without GNU tools</span>');
		expect(panel).toContain("<span>Jira TIM-88 · In Review</span><span>Alex Doe</span>");
		expect(panel).toContain('title="Open Jira issue TIM-88 in the browser">Open in browser</button>');
	});

	test("the issue shows above a missing pull request too, and a failure there is quiet", async () => {
		const { store } = await startedStore(createMockEngine(browserSampleRepositories));
		const panel = panelOf(selecting(store, "/work/billing-worktrees/feat-tax-rules", "pull-request"));
		expect(panel).toContain('class="pull-tab-section issue-section"');
		expect(panel).toContain('<span class="pull-problem">, sign-in needed</span>');
		expect(panel.indexOf("issue-section")).toBeLessThan(panel.indexOf("pull-tab-note"));
	});

	test("text from the tracker shows as text, never as markup", async () => {
		const engine = createMockEngine();
		engine.setIssue(MAC, { ok: true, outcome: "found", issue: issue({ tracker: "jira", key: "TIM-88", url: "https://example.atlassian.net/browse/TIM-88", title: "<b>bold</b>" }) });
		const { store } = await startedStore(engine);
		const panel = panelOf(selecting(store, MAC, "pull-request"));
		expect(panel).toContain("&lt;b&gt;bold&lt;/b&gt;");
		expect(panel).not.toContain("<b>");
	});
});
