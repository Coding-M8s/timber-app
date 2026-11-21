import { describe, expect, test } from "bun:test";
import { SUGGEST_DEBOUNCE_MS, createIssueSuggestions, pickedName, searchText, suggestionHint, suggestionTracker } from "../src/mainview/components/worktree-modes/issue-suggestions";
import type { IssueSearchRequest, IssueSearchResult, SuggestedIssue } from "../src/shared/issue-search";
import { manualClock } from "./support/clock";

const settle = () => Bun.sleep(0);

const issue = (key: string, worktree: SuggestedIssue["worktree"] = null): SuggestedIssue => ({
	tracker: "jira", key, url: `https://example.atlassian.net/browse/${key}`, title: `Title of ${key}`, status: { name: "To Do", category: "open" }, assignee: null, worktree,
});
const found = (...keys: string[]): IssueSearchResult => ({ ok: true, outcome: "found", issues: keys.map(key => issue(key)), truncated: false });

/** A search the test answers by hand, one request at a time. */
function handSearch() {
	const asked: { request: IssueSearchRequest; answer: (result: IssueSearchResult) => Promise<void> }[] = [];
	const search = (request: IssueSearchRequest) => new Promise<IssueSearchResult>(resolve => {
		asked.push({ request, answer: async result => (resolve(result), await settle()) });
	});
	return { search, asked, texts: () => asked.map(entry => entry.request.text) };
}

function setUp() {
	const clock = manualClock();
	const hand = handSearch();
	const suggestions = createIssueSuggestions({ search: hand.search, repository: "/work/timber", schedule: clock.schedule });
	return { clock, hand, suggestions, state: () => suggestions.getState() };
}

describe("which tracker and which text", () => {
	test("the picked tracker, else the default, else the only one set up", () => {
		expect(suggestionTracker({ ok: true, defaultTracker: "github", available: ["github", "jira"] }, "jira")).toBe("jira");
		expect(suggestionTracker({ ok: true, defaultTracker: "jira", available: ["github", "jira"] }, null)).toBe("jira");
		expect(suggestionTracker({ ok: true, defaultTracker: null, available: ["github"] }, null)).toBe("github");
		expect(suggestionTracker({ ok: true, defaultTracker: null, available: ["github", "jira"] }, null)).toBeNull();
		expect(suggestionTracker({ ok: false, message: "unreadable" }, null)).toBeNull();
		expect(suggestionTracker(undefined, null)).toBeNull();
	});

	test("a name already naming a tracker, an empty one, or a long one is not searched", () => {
		expect(searchText("  ENG-4 ")).toBe("ENG-4");
		expect(searchText("fix login")).toBe("fix login");
		expect(searchText("jira:ENG-4")).toBeNull();
		expect(searchText("GitHub:12")).toBeNull();
		expect(searchText("   ")).toBeNull();
		expect(searchText("a".repeat(201))).toBeNull();
	});

	test("a pick fills the issue with its tracker", () => {
		expect(pickedName({ tracker: "jira", key: "ENG-42" })).toBe("jira:ENG-42");
		expect(pickedName({ tracker: "github", key: "161" })).toBe("github:161");
	});
});

describe("searching while typing", () => {
	test("no search starts for each key press: only once typing pauses, for the latest text", async () => {
		const { clock, hand, suggestions, state } = setUp();
		for (const name of ["E", "EN", "ENG", "ENG-", "ENG-4"]) {
			suggestions.type(name, "jira");
			clock.advance(SUGGEST_DEBOUNCE_MS - 50);
		}
		expect(hand.texts()).toEqual([]);
		expect(state().searching).toBe(true);
		clock.advance(50);
		expect(hand.asked.map(entry => entry.request)).toEqual([{ repository: "/work/timber", tracker: "jira", text: "ENG-4" }]);
		await hand.asked[0]!.answer(found("ENG-4", "ENG-40"));
		expect(state()).toMatchObject({ open: true, highlighted: -1, searching: false, hint: null });
		expect(state().issues.map(entry => entry.key)).toEqual(["ENG-4", "ENG-40"]);
	});

	test("one search runs at a time, only the latest text waits, and an older answer never replaces a newer one", async () => {
		const { clock, hand, suggestions, state } = setUp();
		suggestions.type("ENG", "jira");
		clock.advance(SUGGEST_DEBOUNCE_MS);
		for (const name of ["ENG-1", "ENG-12"]) {
			suggestions.type(name, "jira");
			clock.advance(SUGGEST_DEBOUNCE_MS);
		}
		// "ENG" is still running, so "ENG-1" and "ENG-12" did not start, and only "ENG-12" waits.
		expect(hand.texts()).toEqual(["ENG"]);
		await hand.asked[0]!.answer(found("ENG-1", "ENG-2"));
		expect(state().issues).toEqual([]);
		expect(hand.texts()).toEqual(["ENG", "ENG-12"]);
		await hand.asked[1]!.answer(found("ENG-12"));
		expect(state().issues.map(entry => entry.key)).toEqual(["ENG-12"]);
	});

	test("typing back to an earlier text shows its kept list at once, with no search", async () => {
		const { clock, hand, suggestions, state } = setUp();
		suggestions.type("ENG", "jira");
		clock.advance(SUGGEST_DEBOUNCE_MS);
		await hand.asked[0]!.answer(found("ENG-1"));
		suggestions.type("ENG-9", "jira");
		clock.advance(SUGGEST_DEBOUNCE_MS);
		await hand.asked[1]!.answer(found());
		expect(state().open).toBe(false);
		suggestions.type("ENG", "jira");
		expect(state().issues.map(entry => entry.key)).toEqual(["ENG-1"]);
		expect(state().open).toBe(true);
		clock.advance(SUGGEST_DEBOUNCE_MS * 4);
		expect(hand.asked).toHaveLength(2);
	});

	test("a cleared name, or no tracker, shows nothing and searches nothing", () => {
		const { clock, hand, suggestions, state } = setUp();
		suggestions.type("ENG", "jira");
		suggestions.type("", "jira");
		clock.advance(SUGGEST_DEBOUNCE_MS * 2);
		suggestions.type("ENG", null);
		clock.advance(SUGGEST_DEBOUNCE_MS * 2);
		expect(hand.asked).toHaveLength(0);
		expect(state()).toMatchObject({ open: false, searching: false, issues: [] });
	});

	test("while paused, nothing starts and an answer changes nothing; typing again starts over", async () => {
		const { clock, hand, suggestions, state } = setUp();
		suggestions.type("ENG", "jira");
		clock.advance(SUGGEST_DEBOUNCE_MS);
		suggestions.type("ENG-1", "jira");
		suggestions.pause();
		clock.advance(SUGGEST_DEBOUNCE_MS);
		await hand.asked[0]!.answer(found("ENG-1"));
		expect(hand.asked).toHaveLength(1);
		expect(state().issues).toEqual([]);
		suggestions.type("ENG", "jira");
		expect(state().issues.map(entry => entry.key)).toEqual(["ENG-1"]);
	});
});

describe("when there is nothing to suggest", () => {
	test("offline is a quiet hint, and the next text asks again", async () => {
		const { clock, hand, suggestions, state } = setUp();
		suggestions.type("ENG", "jira");
		clock.advance(SUGGEST_DEBOUNCE_MS);
		await hand.asked[0]!.answer({ ok: true, outcome: "failed", reason: "offline", diagnostic: "Jira could not be reached." });
		expect(state()).toMatchObject({ open: false, issues: [], hint: "No suggestions: Jira could not be reached." });
		suggestions.type("ENG-4", "jira");
		clock.advance(SUGGEST_DEBOUNCE_MS);
		expect(hand.asked).toHaveLength(2);
	});

	test("sign-in needed stops asking that tracker while the dialog is open", async () => {
		const { clock, hand, suggestions, state } = setUp();
		suggestions.type("ENG", "jira");
		clock.advance(SUGGEST_DEBOUNCE_MS);
		await hand.asked[0]!.answer({ ok: true, outcome: "failed", reason: "sign-in-needed", diagnostic: "No login." });
		suggestions.type("ENG-4", "jira");
		clock.advance(SUGGEST_DEBOUNCE_MS);
		expect(hand.asked).toHaveLength(1);
		expect(state().hint).toBe("No suggestions: Jira needs a sign-in. Run timber setup.");
		suggestions.type("ENG-4", "github");
		clock.advance(SUGGEST_DEBOUNCE_MS);
		expect(hand.asked).toHaveLength(2);
	});

	test("a Timber without search stops asking any tracker", async () => {
		const { clock, hand, suggestions, state } = setUp();
		suggestions.type("login", "github");
		clock.advance(SUGGEST_DEBOUNCE_MS);
		await hand.asked[0]!.answer({ ok: false, unsupported: true, message: "no command" });
		suggestions.type("login", "jira");
		clock.advance(SUGGEST_DEBOUNCE_MS);
		expect(hand.asked).toHaveLength(1);
		expect(state().hint).toBe("Issue suggestions need a Timber built from its main branch.");
	});

	test("a search that throws is a hint, not a crash", async () => {
		const clock = manualClock();
		const suggestions = createIssueSuggestions({ search: async () => { throw new Error("bridge gone"); }, repository: "/work/timber", schedule: clock.schedule });
		suggestions.type("login", "github");
		clock.advance(SUGGEST_DEBOUNCE_MS);
		await settle();
		expect(suggestions.getState().hint).toBe("No suggestions: could not search GitHub.");
	});

	test("each reason has its own quiet words", () => {
		const failedWith = (reason: "not-configured" | "forbidden" | "failed"): IssueSearchResult => ({ ok: true, outcome: "failed", reason, diagnostic: "x" });
		expect(suggestionHint("linear", failedWith("not-configured"))).toBe("No suggestions: Linear is not set up for searching.");
		expect(suggestionHint("github", failedWith("forbidden"))).toBe("No suggestions: this GitHub login cannot search these issues.");
		expect(suggestionHint("jira", failedWith("failed"))).toBe("No suggestions: Jira did not answer the search.");
		expect(suggestionHint("jira", found("ENG-1"))).toBeNull();
	});
});

describe("keys in the Name field", () => {
	async function withList() {
		const setup = setUp();
		setup.suggestions.type("ENG", "jira");
		setup.clock.advance(SUGGEST_DEBOUNCE_MS);
		await setup.hand.asked[0]!.answer(found("ENG-1", "ENG-2", "ENG-3"));
		return setup;
	}

	test("Enter with nothing highlighted is left to the form, so typed text still creates", async () => {
		const { suggestions } = await withList();
		expect(suggestions.key("Enter")).toBe(false);
	});

	test("arrow keys move the highlight and wrap, and Enter picks the highlighted issue", async () => {
		const { suggestions, state } = await withList();
		expect(suggestions.key("ArrowDown")).toBe(true);
		expect(state().highlighted).toBe(0);
		suggestions.key("ArrowDown");
		suggestions.key("ArrowDown");
		suggestions.key("ArrowDown");
		expect(state().highlighted).toBe(0);
		suggestions.key("ArrowUp");
		expect(state().highlighted).toBe(2);
		const picked = suggestions.key("Enter");
		expect(picked).toMatchObject({ key: "ENG-3" });
		expect(suggestions.pick(picked as SuggestedIssue)).toBe("jira:ENG-3");
		expect(state()).toMatchObject({ open: false, issues: [] });
	});

	test("Escape closes the list and is used; with no list it is left to the dialog", async () => {
		const { suggestions, state } = await withList();
		expect(suggestions.key("Escape")).toBe(true);
		expect(state().open).toBe(false);
		expect(suggestions.key("Escape")).toBe(false);
		// An arrow opens it again.
		expect(suggestions.key("ArrowDown")).toBe(true);
		expect(state()).toMatchObject({ open: true, highlighted: 0 });
	});

	test("leaving Name closes the list, and an arrow key opens it again", async () => {
		const { suggestions, state } = await withList();
		suggestions.blur();
		expect(state()).toMatchObject({ open: false, highlighted: -1 });
		expect(state().issues).toHaveLength(3);
		expect(suggestions.key("Enter")).toBe(false);
		expect(suggestions.key("ArrowDown")).toBe(true);
		expect(state()).toMatchObject({ open: true, highlighted: 0 });
	});

	test("another tracker drops the list at once, before its own search answers", async () => {
		const { suggestions, state } = await withList();
		suggestions.type("ENG", "github");
		expect(state()).toMatchObject({ open: false, issues: [], searching: true });
	});

	test("a picked name names its tracker, so filling it searches nothing", async () => {
		const { clock, hand, suggestions } = await withList();
		suggestions.type(suggestions.pick(issue("ENG-2")), "jira");
		clock.advance(SUGGEST_DEBOUNCE_MS * 2);
		expect(hand.asked).toHaveLength(1);
	});

	test("while the next list is found, arrows and Enter are left alone", async () => {
		const { suggestions, state } = await withList();
		suggestions.key("ArrowDown");
		suggestions.type("ENG-", "jira");
		expect(state()).toMatchObject({ highlighted: -1, searching: true });
		expect(suggestions.key("ArrowDown")).toBe(false);
		expect(suggestions.key("Enter")).toBe(false);
	});
});
