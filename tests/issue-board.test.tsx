import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { createMockEngine } from "../src/mainview/engine/mock";
import { bigSprint } from "../src/mainview/engine/mock-issue-lists";
import {
	boardColumns, boardTracker, boardTrackerChoices, describeBlockedToggle, describeEmptyList, describeHiddenList, describeListFailure,
	describeListSummary, describePartial, describeTruncated, shownList,
} from "../src/mainview/issue-board-format";
import { type IssueBoard, boardKey, boardToggles, boardView, emptyBoard, hiddenDiagnostic, hiddenLists, listsToRead, withRead } from "../src/mainview/store/issue-board";
import { createAppStore } from "../src/mainview/store/store";
import type { IssueListResult } from "../src/shared/issue-lists";
import type { SuggestedIssue } from "../src/shared/issue-search";
import { chooseIssueList, defaultLayout, forgetRepository, readLayout, sameLayout } from "../src/shared/layout";
import { parseSettings, serializeSettings } from "../src/shared/settings";

const TIMBER = "/work/timber";
const API = "/work/api-server";

const settle = async () => {
	for (let round = 0; round < 8; round++) await Bun.sleep(0);
};

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine);
	store.start();
	await settle();
	return { store, engine };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

/** A toggle of the board as drawn: whether it is on and disabled, and its tooltip and hint, or null when it is not drawn. */
function toggleIn(markup: string, label: "Current sprint" | "Assigned to me") {
	const button = [...markup.matchAll(/<button [^>]*class="board-toggle[^"]*"[^>]*>(?:(?!<\/button>).)*<\/button>/g)].map(match => match[0]).find(one => one.endsWith(`${label}</button>`));
	if (button === undefined) return null;
	return {
		on: button.includes('aria-pressed="true"'),
		disabled: / disabled=""/.test(button),
		title: /title="([^"]*)"/.exec(button)?.[1] ?? null,
		hint: /aria-describedby="([^"]*)"/.exec(button)?.[1] ?? null,
	};
}

const card = (key: string, category: "open" | "in-progress" | "closed", name: string, tracker: SuggestedIssue["tracker"] = "jira"): SuggestedIssue => ({
	tracker, key, url: `https://example.atlassian.net/browse/${key}`, title: key, status: { name, category }, assignee: null, worktree: null, pullRequests: [], assignedToMe: false,
});

describe("boardColumns", () => {
	test("Open, In progress, and Done, each with the tracker's own status names in the order listed", () => {
		const columns = boardColumns([card("A-1", "open", "To Do"), card("A-2", "in-progress", "In Review"), card("A-3", "open", "Selected"), card("A-4", "closed", "Won't Do"), card("A-5", "in-progress", "In Progress")], "sprint", "jira");
		expect(columns.map(column => [column.label, column.statuses, column.issues.map(issue => issue.key)])).toEqual([
			["Open", ["To Do", "Selected"], ["A-1", "A-3"]],
			["In progress", ["In Review", "In Progress"], ["A-2", "A-5"]],
			["Done", ["Won't Do"], ["A-4"]],
		]);
	});

	test("a GitHub board has no In progress column, and Assigned to me and Open issues have no Done column", () => {
		expect(boardColumns([], "sprint", "github").map(column => column.id)).toEqual(["open", "done"]);
		expect(boardColumns([], "assigned", "jira").map(column => column.id)).toEqual(["open", "in-progress"]);
		expect(boardColumns([], "open", "github").map(column => column.id)).toEqual(["open"]);
	});

	test("never leaves an issue out, even one whose status is outside the usual columns", () => {
		const issues = [card("1", "in-progress", "Open", "github"), card("2", "closed", "Closed", "github")];
		const columns = boardColumns(issues, "open", "github");
		expect(columns.map(column => column.id)).toEqual(["open", "in-progress", "done"]);
		expect(columns.flatMap(column => column.issues)).toHaveLength(2);
	});

	test("a sprint of 500 issues is sorted into columns quickly", () => {
		const result = bigSprint(500) as Extract<IssueListResult, { outcome: "found" }>;
		const started = performance.now();
		const columns = boardColumns(result.issues, "sprint", "jira");
		expect(performance.now() - started).toBeLessThan(50);
		expect(columns.reduce((sum, column) => sum + column.issues.length, 0)).toBe(500);
	});
});

describe("the board's words", () => {
	test("a sprint is named with where it came from; other lists name the tracker", () => {
		expect(describeListSummary("sprint", "jira", { name: "Sprint 42", source: "jira-board" }, 12, false)).toBe("Sprint 42, Jira board, 12 issues");
		expect(describeListSummary("sprint", "jira", { name: null, source: "jira-jql" }, 1, false)).toBe("The saved Jira query, 1 issue");
		expect(describeListSummary("open", "github", null, 50, true)).toBe("Open issues in GitHub, 50+ issues");
		expect(describeListSummary("assigned", "linear", null, 2, false)).toBe("Assigned to me in Linear, 2 issues");
	});

	test("my issues in the sprint name the sprint and the filter, and say when they may be incomplete", () => {
		expect(describeListSummary("my-sprint", "jira", { name: "Sprint 42", source: "jira-board" }, 3, false)).toBe("Sprint 42, Jira board, assigned to you, 3 issues");
		expect(describeListSummary("my-sprint", "github", { name: "v0.3", source: "github-milestone" }, 1, false, true)).toBe("v0.3, GitHub milestone, assigned to you, 1 issue, may be incomplete");
		expect(describePartial("github")).toContain("Done issues, issues of other repositories in the project, and any past those 50 may be missing.");
		expect(describePartial("jira")).toContain("Done issues and any past those 50 may be missing.");
		expect(describeEmptyList("my-sprint", "linear").title).toBe("Nothing assigned to you in the current sprint");
		expect(describeTruncated("my-sprint", "jira")).toBe(describeTruncated("sprint", "jira"));
	});

	test("Done shows only with Current sprint on", () => {
		const ids = (list: Parameters<typeof boardColumns>[1]) => boardColumns([], list, "jira").map(column => column.id);
		expect(ids("sprint")).toEqual(["open", "in-progress", "done"]);
		expect(ids("my-sprint")).toEqual(["open", "in-progress", "done"]);
		expect(ids("assigned")).toEqual(["open", "in-progress"]);
		expect(ids("open")).toEqual(["open", "in-progress"]);
	});

	test("each failure has a quiet word and never asks to sign in here", () => {
		expect(describeListFailure("offline", "jira").word).toBe("offline");
		expect(describeListFailure("sign-in-needed", "jira")).toMatchObject({ word: "sign-in needed", command: "timber setup" });
		expect(describeListFailure("forbidden", "github").word).toBe("no access");
		expect(describeHiddenList("sprint", "jira", "No Jira sprint is configured. Set [jira].board or [jira].sprint_jql."))
			.toBe("Current sprint is not set up for Jira. No Jira sprint is configured. Set [jira].board or [jira].sprint_jql.");
	});
});

describe("which list and tracker the board shows", () => {
	test("the remembered list, unless it is not set up, then the first that is", () => {
		expect(shownList(undefined, [])).toBe("sprint");
		expect(shownList("open", [])).toBe("open");
		expect(shownList(undefined, ["sprint"])).toBe("assigned");
		expect(shownList("sprint", ["sprint"])).toBe("assigned");
		expect(shownList("open", ["sprint", "assigned", "open", "my-sprint"])).toBeNull();
		// Both toggles on, and the sprint is not set up: Assigned to me alone shows.
		expect(shownList("my-sprint", [])).toBe("my-sprint");
		expect(shownList("my-sprint", ["sprint", "my-sprint"])).toBe("assigned");
		// Both off, and Open issues is not set up: the sprint shows.
		expect(shownList("open", ["open"])).toBe("sprint");
	});

	test("both sprint lists are not set up when the newer of their answers says so, and Refresh asks only as sprint", () => {
		let board: IssueBoard = { ...emptyBoard(), trackers: { ok: true, defaultTracker: "jira", available: ["jira"], githubRepository: null } };
		const notSetUp = (diagnostic: string): IssueListResult => ({ ok: true, outcome: "failed", reason: "not-configured", diagnostic });
		const found: IssueListResult = { ok: true, outcome: "found", issues: [], truncated: false, sprint: { name: "S", source: "jira-board" } };
		board = withRead(board, boardKey("jira", "my-sprint"), { result: notSetUp("No Jira sprint."), at: 1 });
		expect(hiddenLists(board, "jira")).toEqual(["sprint", "my-sprint"]);
		expect(hiddenDiagnostic(board, "jira", "sprint")).toBe("No Jira sprint.");
		expect(boardView(board, "my-sprint").list).toBe("assigned");
		expect(listsToRead(board, "my-sprint")).toEqual(["assigned", "sprint"]);
		board = withRead(board, boardKey("jira", "sprint"), { result: found, at: 2 });
		expect(hiddenLists(board, "jira")).toEqual([]);
		expect(boardView(board, "my-sprint").list).toBe("my-sprint");
		board = withRead(board, boardKey("jira", "my-sprint"), { result: notSetUp("Still none."), at: 3 });
		expect(hiddenLists(board, "jira")).toEqual(["sprint", "my-sprint"]);
		expect(hiddenDiagnostic(board, "jira", "my-sprint")).toBe("Still none.");
	});

	test("a toggle is blocked when flipping it would show a list that is not set up", () => {
		expect(boardToggles("open", [])).toEqual({ sprint: { on: false, blockedBy: null }, assigned: { on: false, blockedBy: null } });
		expect(boardToggles("my-sprint", [])).toEqual({ sprint: { on: true, blockedBy: null }, assigned: { on: true, blockedBy: null } });
		expect(boardToggles("assigned", ["sprint", "my-sprint"])).toEqual({ sprint: { on: false, blockedBy: "my-sprint" }, assigned: { on: true, blockedBy: null } });
		expect(boardToggles("assigned", ["sprint", "my-sprint", "open"])).toEqual({ sprint: { on: false, blockedBy: "my-sprint" }, assigned: { on: true, blockedBy: "open" } });
		// Jira without a project: the sprint shows, and turning it off would show Open issues.
		expect(boardToggles("sprint", ["open"]).sprint).toEqual({ on: true, blockedBy: "open" });
		expect(describeBlockedToggle(false, "my-sprint", "jira")).toBe("Current sprint is not set up for Jira.");
		expect(describeBlockedToggle(true, "open", "linear")).toBe("Turning this off shows Open issues, which is not set up for Linear.");
	});

	test("the tracker picked, else Timber's default, else the first set up; the field shows with two or more", () => {
		const two = { ok: true as const, defaultTracker: null, available: ["github" as const, "linear" as const], githubRepository: "example/timber" };
		expect(boardTracker(two, null)).toBe("github");
		expect(boardTracker({ ...two, defaultTracker: "linear" }, null)).toBe("linear");
		expect(boardTracker(two, "linear")).toBe("linear");
		expect(boardTracker(two, "jira")).toBe("github");
		expect(boardTracker({ ok: true, defaultTracker: null, available: [], githubRepository: null }, null)).toBeNull();
		expect(boardTrackerChoices(two)).toEqual(["github", "linear"]);
		expect(boardTrackerChoices({ ok: true, defaultTracker: null, available: ["jira"], githubRepository: null })).toEqual([]);
	});

	test("a failed read keeps the last good list, and a list not set up is read again on Refresh", () => {
		let board: IssueBoard = { ...emptyBoard(), trackers: { ok: true, defaultTracker: "jira", available: ["jira"], githubRepository: null } };
		const found: IssueListResult = { ok: true, outcome: "found", issues: [], truncated: false, sprint: { name: "S", source: "jira-board" } };
		board = withRead(board, boardKey("jira", "sprint"), { result: found, at: 1 });
		board = withRead(board, boardKey("jira", "sprint"), { result: { ok: true, outcome: "failed", reason: "offline", diagnostic: "x" }, at: 2 });
		const view = boardView(board, undefined);
		expect(view.good?.at).toBe(1);
		expect(view.latest?.at).toBe(2);
		board = withRead(board, boardKey("jira", "sprint"), { result: { ok: true, outcome: "failed", reason: "not-configured", diagnostic: "x" }, at: 3 });
		expect(boardView(board, undefined).list).toBe("assigned");
		expect(listsToRead(board, undefined)).toEqual(["assigned", "sprint"]);
	});
});

describe("the remembered list in the layout", () => {
	test("is read, kept per repository, compared, and forgotten with the repository", () => {
		expect(readLayout({ issueLists: { "/a": "open", "/b": "search", "": "open", "/c": 7, "/d": "my-sprint" } }).issueLists).toEqual({ "/a": "open", "/d": "my-sprint" });
		const chosen = chooseIssueList(defaultLayout(), "/a", "assigned");
		expect(chosen.issueLists).toEqual({ "/a": "assigned" });
		expect(chooseIssueList(chosen, "/a", "assigned")).toBe(chosen);
		expect(sameLayout(chosen, defaultLayout())).toBe(false);
		expect(forgetRepository(chosen, "/a").issueLists).toEqual({});
	});

	test("survives the settings file", () => {
		const layout = chooseIssueList(defaultLayout(), "/work/timber", "open");
		expect(parseSettings(serializeSettings({ repositories: [], layout }))?.layout?.issueLists).toEqual({ "/work/timber": "open" });
	});
});

describe("the board in the window", () => {
	test("an Issues row comes first in each repository, and nothing is read until a board opens", async () => {
		const { store, engine } = await startedStore();
		const markup = render(store);
		expect(markup.match(/class="row issues-row"/g)?.length).toBeGreaterThanOrEqual(2);
		expect(engine.issueListReads()).toEqual([]);
	});

	test("opening a board shows its sprint in columns, marks worktrees, and names it in the sidebar", async () => {
		const { store, engine } = await startedStore();
		store.openBoard(TIMBER);
		await settle();
		expect(engine.issueListReads()).toEqual([{ repository: TIMBER, list: "sprint", tracker: "github" }]);
		const markup = render(store);
		expect(markup).toContain('class="row issues-row selected"');
		expect(markup).toContain("v0.3, GitHub milestone, 4 issues");
		// A card with a worktree offers Open worktree, with the branch in its tooltip.
		expect(markup).toContain('title="Open the worktree feat/github-issue-lookup"');
		expect(markup).toContain('<span class="issue-card-label">Open worktree</span>');
		expect(markup).toContain('<span class="issues-row-sprint" title="v0.3">v0.3</span>');
		// GitHub and Jira are set up, so the Tracker field shows.
		expect(markup).toContain('<span>Tracker</span>');
		// Every card without a worktree offers Start work, done ones too.
		expect(markup.match(/class="issue-card-start issue-card-start-work" title=/g)?.length).toBe(3);
		// No worktree row is the shown one, and the title bar names the board.
		expect(markup).not.toContain('class="row selected"');
		expect(markup).toContain('<span class="titlebar-branch" title="Issues">Issues</span>');
	});

	test("two toggles replace the three lists, and each single toggle and neither show today's lists", async () => {
		const { store, engine } = await startedStore();
		store.openBoard(TIMBER);
		await settle();
		let markup = render(store);
		expect(markup).toContain('role="group" aria-label="Filter"');
		expect(markup).not.toContain("Open issues</button>");
		expect(toggleIn(markup, "Current sprint")).toMatchObject({ on: true, disabled: false });
		expect(toggleIn(markup, "Assigned to me")).toMatchObject({ on: false, disabled: false });
		await store.pickBoardList(TIMBER, "assigned");
		markup = render(store);
		expect(markup).toContain("Assigned to me in GitHub, 1 issue");
		expect(toggleIn(markup, "Current sprint")?.on).toBe(false);
		expect(toggleIn(markup, "Assigned to me")?.on).toBe(true);
		await store.pickBoardList(TIMBER, "open");
		markup = render(store);
		expect(markup).toContain("Open issues in GitHub, 4 issues");
		expect(toggleIn(markup, "Current sprint")?.on).toBe(false);
		expect(toggleIn(markup, "Assigned to me")?.on).toBe(false);
		expect(engine.issueListReads().map(read => read.list)).toEqual(["sprint", "assigned", "open"]);
	});

	test("both toggles on list only my issues in the current sprint, done ones too, and are remembered", async () => {
		const { store, engine } = await startedStore();
		store.openBoard(TIMBER);
		await settle();
		await store.pickBoardList(TIMBER, "my-sprint");
		expect(engine.issueListReads().at(-1)).toEqual({ repository: TIMBER, list: "my-sprint", tracker: "github" });
		expect(store.getState().layout.issueLists[TIMBER]).toBe("my-sprint");
		let markup = render(store);
		expect(toggleIn(markup, "Current sprint")?.on).toBe(true);
		expect(toggleIn(markup, "Assigned to me")?.on).toBe(true);
		expect(markup).toContain("v0.3, GitHub milestone, assigned to you, 2 issues");
		expect(markup).toContain("Look up GitHub issues by number");
		expect(markup).toContain("Fix the login redirect loop");
		expect(markup).not.toContain("Explain why New arena is disabled");
		expect(markup).toContain('aria-label="Done, 1"');
		// Jira has In progress too: my three, across the columns.
		await store.pickBoardTracker(TIMBER, "jira");
		markup = render(store);
		expect(markup).toContain("TIM Sprint 14, Jira board, assigned to you, 3 issues");
		expect(markup).toContain('aria-label="Open, 1"');
		expect(markup).toContain('aria-label="In progress, 2"');
		expect(markup).toContain('aria-label="Done, 0"');
	});

	test("from a Timber without --assigned, my sprint is joined from two lists and says it may be incomplete", async () => {
		const engine = createMockEngine();
		engine.setAssignedOption(false);
		const { store } = await startedStore(engine);
		store.openBoard(TIMBER);
		await settle();
		await store.pickBoardList(TIMBER, "my-sprint");
		const markup = render(store);
		expect(markup).toContain("v0.3, GitHub milestone, assigned to you, 1 issue, may be incomplete");
		expect(markup).toContain("This Timber cannot list only your issues in the sprint");
		// Done issue 7 is mine, and the assigned list holds only open issues.
		expect(markup).not.toContain("Fix the login redirect loop");
	});

	test("an empty combination is named, and an empty joined one says it may be incomplete", async () => {
		const engine = createMockEngine();
		engine.setIssueList({ ok: true, outcome: "found", issues: [], truncated: false, sprint: { name: "v0.3", source: "github-milestone" } }, "my-sprint");
		const { store } = await startedStore(engine);
		store.openBoard(TIMBER);
		await settle();
		await store.pickBoardList(TIMBER, "my-sprint");
		expect(render(store)).toContain("Nothing assigned to you in the current sprint");
		engine.setIssueList({ ok: true, outcome: "found", issues: [], truncated: false, sprint: { name: "v0.3", source: "github-milestone" }, partial: true }, "my-sprint");
		await store.refreshBoard(TIMBER);
		const markup = render(store);
		expect(markup).toContain("Nothing assigned to you in the current sprint");
		expect(markup).toContain("This Timber cannot list only your issues in the sprint");
		expect(markup).toContain("assigned to you, 0 issues, may be incomplete");
	});

	test("a sprint that is not set up disables Current sprint with its hint, and the remembered toggles are kept", async () => {
		const engine = createMockEngine();
		engine.setIssueList({ ok: true, outcome: "failed", reason: "not-configured", diagnostic: "No GitHub sprint is configured." }, "sprint");
		const { store } = await startedStore(engine);
		store.openBoard(API);
		await settle();
		expect(engine.issueListReads().map(read => read.list)).toEqual(["sprint", "assigned"]);
		const markup = render(store);
		expect(toggleIn(markup, "Current sprint")).toEqual({ on: false, disabled: true, title: "Current sprint is not set up for GitHub.", hint: "board-hint-sprint" });
		expect(toggleIn(markup, "Assigned to me")).toMatchObject({ on: true, disabled: false });
		expect(markup).toContain('<p id="board-hint-sprint" class="board-hint">Current sprint is not set up for GitHub. No GitHub sprint is configured.</p>');
		expect(store.getState().layout.issueLists[API]).toBeUndefined();
		// Set up again: Refresh asks again, as sprint only, and it comes back.
		engine.setIssueList(null, "sprint");
		await store.refreshBoard(API);
		await settle();
		expect(engine.issueListReads().map(read => read.list).slice(2)).toEqual(["assigned", "sprint"]);
		expect(toggleIn(render(store), "Current sprint")).toMatchObject({ on: true, disabled: false });
	});

	test("turning a toggle to a list not set up comes back, and then that toggle is disabled with the list's hint", async () => {
		const engine = createMockEngine();
		const notSetUp = (diagnostic: string): IssueListResult => ({ ok: true, outcome: "failed", reason: "not-configured", diagnostic });
		engine.setIssueList(notSetUp("No sprint."), "sprint");
		engine.setIssueList(notSetUp("No team."), "open");
		const { store } = await startedStore(engine);
		store.openBoard(API);
		await settle();
		// Open issues was never asked about, so Assigned to me can still be turned off.
		expect(toggleIn(render(store), "Assigned to me")).toMatchObject({ on: true, disabled: false });
		await store.pickBoardList(API, "open");
		await settle();
		const markup = render(store);
		expect(toggleIn(markup, "Assigned to me")).toEqual({ on: true, disabled: true, title: "Turning this off shows Open issues, which is not set up for GitHub.", hint: "board-hint-open" });
		expect(markup).toContain("Open issues is not set up for GitHub. No team.");
		expect(markup).toContain("Assigned to me in GitHub");
		expect(store.getState().layout.issueLists[API]).toBe("assigned");
	});

	test("turning a toggle to a list not set up comes back to the list shown before, not to another", async () => {
		const engine = createMockEngine();
		engine.setIssueList({ ok: true, outcome: "failed", reason: "not-configured", diagnostic: "No team." }, "open");
		const { store } = await startedStore(engine);
		store.openBoard(TIMBER);
		await settle();
		await store.pickBoardList(TIMBER, "assigned");
		await store.pickBoardList(TIMBER, "open");
		await settle();
		// The sprint is set up, yet the board comes back to Assigned to me alone, and remembers it.
		expect(engine.issueListReads().map(read => read.list)).toEqual(["sprint", "assigned", "open"]);
		expect(store.getState().layout.issueLists[TIMBER]).toBe("assigned");
		const markup = render(store);
		expect(toggleIn(markup, "Current sprint")).toMatchObject({ on: false, disabled: false });
		expect(toggleIn(markup, "Assigned to me")).toMatchObject({ on: true, disabled: true, hint: "board-hint-open" });
	});

	test("both toggles remembered with a sprint not set up come back, read again, once the sprint is set up", async () => {
		const engine = createMockEngine();
		await engine.saveLayout(chooseIssueList(defaultLayout(), API, "my-sprint"));
		const notSetUp: IssueListResult = { ok: true, outcome: "failed", reason: "not-configured", diagnostic: "No sprint." };
		engine.setIssueList(notSetUp, "sprint");
		engine.setIssueList(notSetUp, "my-sprint");
		const { store } = await startedStore(engine);
		store.openBoard(API);
		await settle();
		expect(engine.issueListReads().map(read => read.list)).toEqual(["my-sprint", "assigned"]);
		expect(toggleIn(render(store), "Assigned to me")?.on).toBe(true);
		engine.setIssueList(null, "sprint");
		engine.setIssueList(null, "my-sprint");
		await store.refreshBoard(API);
		await settle();
		// Refresh asks as sprint; once it is set up, my issues in it are read too, not shown from the old answer.
		expect(engine.issueListReads().map(read => read.list).slice(2)).toEqual(["assigned", "sprint", "my-sprint"]);
		const markup = render(store);
		expect(markup).toContain("v0.3, GitHub milestone, assigned to you, 2 issues");
		expect(markup).not.toContain("not set up");
		expect(store.getState().layout.issueLists[API]).toBe("my-sprint");
	});

	test("both toggles on stay on across a tracker switch, each tracker read as my issues in its sprint", async () => {
		const { store, engine } = await startedStore();
		store.openBoard(TIMBER);
		await settle();
		await store.pickBoardList(TIMBER, "my-sprint");
		await store.pickBoardTracker(TIMBER, "jira");
		await store.pickBoardTracker(TIMBER, "github");
		expect(engine.issueListReads().map(read => `${read.tracker} ${read.list}`)).toEqual(["github sprint", "github my-sprint", "jira my-sprint", "github my-sprint"]);
		expect(render(store)).toContain("v0.3, GitHub milestone, assigned to you, 2 issues");
	});

	test("with no list set up, both toggles stay, disabled, with their hints", async () => {
		const engine = createMockEngine();
		engine.setIssueList({ ok: true, outcome: "failed", reason: "not-configured", diagnostic: "Nothing set up." });
		const { store } = await startedStore(engine);
		store.openBoard(API);
		await settle();
		await store.pickBoardList(API, "open");
		await settle();
		const markup = render(store);
		expect(markup).toContain("No list is set up for GitHub.");
		expect(toggleIn(markup, "Current sprint")?.disabled).toBe(true);
		expect(toggleIn(markup, "Assigned to me")?.disabled).toBe(true);
		expect(markup).toContain("Current sprint is not set up for GitHub.");
		expect(markup).toContain("Assigned to me is not set up for GitHub.");
	});

	test("a repository that remembered a list shows it as the matching toggles", async () => {
		const engine = createMockEngine();
		await engine.saveLayout(chooseIssueList(defaultLayout(), TIMBER, "assigned"));
		const { store } = await startedStore(engine);
		store.openBoard(TIMBER);
		await settle();
		expect(engine.issueListReads().map(read => read.list)).toEqual(["assigned"]);
		const markup = render(store);
		expect(toggleIn(markup, "Current sprint")?.on).toBe(false);
		expect(toggleIn(markup, "Assigned to me")?.on).toBe(true);
	});

	test("picking a list remembers it for the repository and reads it; Refresh reads again, with no timer", async () => {
		const { store, engine } = await startedStore();
		store.openBoard(TIMBER);
		await settle();
		await store.pickBoardList(TIMBER, "open");
		expect(store.getState().layout.issueLists[TIMBER]).toBe("open");
		await Bun.sleep(50);
		expect(engine.issueListReads()).toHaveLength(2);
		await store.refreshBoard(TIMBER);
		expect(engine.issueListReads().map(read => read.list)).toEqual(["sprint", "open", "open"]);
	});

	test("an answer for another list never shows on the one picked", async () => {
		const engine = createMockEngine();
		engine.setIssueListDelay(30);
		const { store } = await startedStore(engine);
		store.openBoard(TIMBER);
		await Bun.sleep(5);
		await store.pickBoardList(TIMBER, "assigned");
		await Bun.sleep(80);
		const view = boardView(store.getState().issueBoards[TIMBER]!, store.getState().layout.issueLists[TIMBER]);
		expect(view.list).toBe("assigned");
		expect(view.good?.result.outcome === "found" && view.good.result.sprint).toBeNull();
	});

	test("offline keeps the last list on screen with a quiet word; a first failure is a line, never a dialog", async () => {
		const { store, engine } = await startedStore();
		store.openBoard(TIMBER);
		await settle();
		engine.setIssueList({ ok: true, outcome: "failed", reason: "offline", diagnostic: "GitHub could not be reached." });
		await store.refreshBoard(TIMBER);
		let markup = render(store);
		expect(markup).toContain('<span class="board-word" title="GitHub could not be reached.">offline</span>');
		expect(markup).toContain("feat/github-issue-lookup");
		await store.pickBoardTracker(TIMBER, "jira");
		markup = render(store);
		expect(markup).toContain("Could not reach Jira.");
		expect(store.getState().dialog).toBeNull();
	});

	test("a Timber without __app-issues says the board needs a newer Timber", async () => {
		const engine = createMockEngine();
		engine.setIssueList({ ok: false, unsupported: true, message: "This Timber has no timber __app-issues." });
		const { store } = await startedStore(engine);
		store.openBoard(TIMBER);
		await settle();
		expect(render(store)).toContain("The issues board needs a Timber built from its main branch.");
	});

	test("a worktree's tab, or a session shown, puts the board away too", async () => {
		const { store } = await startedStore();
		store.openBoard(TIMBER);
		store.showTab("workspace");
		expect(store.getState().board).toBeNull();
		const worktree = store.getState().repositories.find(repository => repository.path === TIMBER)!.worktrees[0]!;
		await store.openTerminal({ repository: TIMBER, worktree: worktree.path, cols: 80, rows: 24 });
		await settle();
		store.openBoard(TIMBER);
		store.revealSession(store.getState().terminals[0]!.id);
		expect(store.getState().board).toBeNull();
	});

	test("trackers that could not be read on Refresh keep the last list on screen", async () => {
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		store.openBoard(TIMBER);
		await settle();
		const read = engine.readIssueTrackers;
		engine.readIssueTrackers = async () => ({ ok: false, message: "Timber's settings could not be read." });
		await store.refreshBoard(TIMBER);
		expect(render(store)).toContain("v0.3, GitHub milestone, 4 issues");
		engine.readIssueTrackers = read;
	});

	test("choosing a worktree puts the board away, the selected one included", async () => {
		const { store } = await startedStore();
		const selected = store.getState().selection!.worktree;
		store.openBoard(TIMBER);
		store.select(selected);
		expect(store.getState().board).toBeNull();
		expect(store.getState().selection!.worktree).toBe(selected);
	});
});
