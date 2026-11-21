import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { createMockEngine } from "../src/mainview/engine/mock";
import { bigSprint } from "../src/mainview/engine/mock-issue-lists";
import {
	boardColumns, boardTracker, boardTrackerChoices, describeHiddenList, describeListFailure, describeListSummary, shownList,
} from "../src/mainview/issue-board-format";
import { type IssueBoard, boardKey, boardView, emptyBoard, listsToRead, withRead } from "../src/mainview/store/issue-board";
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

const card = (key: string, category: "open" | "in-progress" | "closed", name: string, tracker: SuggestedIssue["tracker"] = "jira"): SuggestedIssue => ({
	tracker, key, url: `https://example.atlassian.net/browse/${key}`, title: key, status: { name, category }, assignee: null, worktree: null, pullRequests: [],
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
		expect(shownList("open", ["sprint", "assigned", "open"])).toBeNull();
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
		expect(readLayout({ issueLists: { "/a": "open", "/b": "search", "": "open", "/c": 7 } }).issueLists).toEqual({ "/a": "open" });
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
		expect(markup).toContain('<span class="issue-card-branch">feat/github-issue-lookup</span>');
		expect(markup).toContain('<span class="issues-row-sprint" title="v0.3">v0.3</span>');
		// GitHub and Jira are set up, so the Tracker field shows.
		expect(markup).toContain('<span>Tracker</span>');
		// Start work is a placeholder until issue 156.
		expect(markup).toMatch(/<button type="button" class="issue-card-start" disabled=""/);
		// No worktree row is the shown one, and the title bar names the board.
		expect(markup).not.toContain('class="row selected"');
		expect(markup).toContain('<span class="titlebar-branch" title="Issues">Issues</span>');
	});

	test("a list that is not set up leaves the picker, the next shows, and the remembered pick is kept", async () => {
		const engine = createMockEngine();
		engine.setIssueList({ ok: true, outcome: "failed", reason: "not-configured", diagnostic: "No GitHub sprint is configured." }, "sprint");
		const { store } = await startedStore(engine);
		store.openBoard(API);
		await settle();
		expect(engine.issueListReads().map(read => read.list)).toEqual(["sprint", "assigned"]);
		const markup = render(store);
		expect(markup).not.toContain(">Current sprint</button>");
		expect(markup).toContain('aria-pressed="true">Assigned to me</button>');
		expect(markup).toContain("Current sprint is not set up for GitHub. No GitHub sprint is configured.");
		expect(store.getState().layout.issueLists[API]).toBeUndefined();
		// Set up again: Refresh asks again, and it comes back.
		engine.setIssueList(null, "sprint");
		await store.refreshBoard(API);
		await settle();
		expect(render(store)).toContain(">Current sprint</button>");
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
