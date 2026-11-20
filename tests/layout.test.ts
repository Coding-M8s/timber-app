import { describe, expect, test } from "bun:test";
import {
	DEFAULT_SIDEBAR_WIDTH,
	MAX_SIDEBAR_WIDTH,
	MIN_SIDEBAR_WIDTH,
	chooseComparison,
	chosenComparison,
	clampSidebarWidth,
	defaultLayout,
	dismissSetup,
	forgetRepository,
	readLayout,
	sameLayout,
	toggleCollapsed,
} from "../src/shared/layout";
import { parseSettings, serializeSettings } from "../src/shared/settings";

const one = { path: "/work/timber", commonDir: "/work/timber/.git" };
const two = { path: "/work/api-server", commonDir: "/work/api-server/.git" };

describe("clampSidebarWidth", () => {
	test("keeps a width within the limits, as whole pixels", () => {
		expect(clampSidebarWidth(300)).toBe(300);
		expect(clampSidebarWidth(300.6)).toBe(301);
		expect(clampSidebarWidth(10)).toBe(MIN_SIDEBAR_WIDTH);
		expect(clampSidebarWidth(-50)).toBe(MIN_SIDEBAR_WIDTH);
		expect(clampSidebarWidth(5000)).toBe(MAX_SIDEBAR_WIDTH);
	});

	test("answers the default for anything that is not a number", () => {
		expect(clampSidebarWidth(Number.NaN)).toBe(DEFAULT_SIDEBAR_WIDTH);
		expect(clampSidebarWidth(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SIDEBAR_WIDTH);
	});
});

describe("readLayout", () => {
	test("reads a width and the collapsed repositories", () => {
		expect(readLayout({ sidebarWidth: 320, collapsed: ["/work/timber"], setupDismissed: [], uncommittedChanges: [] })).toEqual({ sidebarWidth: 320, collapsed: ["/work/timber"], setupDismissed: [], uncommittedChanges: [] });
	});

	test("gives the defaults for anything that is not a layout", () => {
		for (const value of [undefined, null, 7, "wide", [], [320]]) expect(readLayout(value)).toEqual(defaultLayout());
	});

	test("keeps the readable part when the other part is damaged", () => {
		expect(readLayout({ sidebarWidth: "wide", collapsed: ["/work/timber"], setupDismissed: [], uncommittedChanges: [] })).toEqual({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, collapsed: ["/work/timber"], setupDismissed: [], uncommittedChanges: [] });
		expect(readLayout({ sidebarWidth: 320, collapsed: "all" })).toEqual({ sidebarWidth: 320, collapsed: [], setupDismissed: [], uncommittedChanges: [] });
		expect(readLayout({ collapsed: ["/work/timber"] })).toEqual({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, collapsed: ["/work/timber"], setupDismissed: [], uncommittedChanges: [] });
	});

	test("brings a width back within the limits, and drops entries that are not paths or are repeated", () => {
		expect(readLayout({ sidebarWidth: 9000, collapsed: ["/a", 7, "", null, "/a", "/b"], setupDismissed: [], uncommittedChanges: [] })).toEqual({ sidebarWidth: MAX_SIDEBAR_WIDTH, collapsed: ["/a", "/b"], setupDismissed: [], uncommittedChanges: [] });
	});
});

describe("toggleCollapsed, forgetRepository, and sameLayout", () => {
	test("collapse a group, open it again, and leave the given layout as it was", () => {
		const start = defaultLayout();
		const collapsed = toggleCollapsed(start, "/work/timber");
		expect(collapsed.collapsed).toEqual(["/work/timber"]);
		expect(start.collapsed).toEqual([]);
		expect(toggleCollapsed(collapsed, "/work/timber")).toEqual(start);
	});

	test("forget a repository that leaves the list", () => {
		const layout = { sidebarWidth: 300, collapsed: ["/a", "/b"], setupDismissed: [], uncommittedChanges: [] };
		expect(forgetRepository(layout, "/a")).toEqual({ sidebarWidth: 300, collapsed: ["/b"], setupDismissed: [], uncommittedChanges: [] });
		expect(forgetRepository(layout, "/other")).toBe(layout);
	});

	test("compare width and collapsed groups", () => {
		const layout = { sidebarWidth: 300, collapsed: ["/a"], setupDismissed: [], uncommittedChanges: [] };
		expect(sameLayout(layout, { sidebarWidth: 300, collapsed: ["/a"], setupDismissed: [], uncommittedChanges: [] })).toBe(true);
		expect(sameLayout(layout, { sidebarWidth: 301, collapsed: ["/a"], setupDismissed: [], uncommittedChanges: [] })).toBe(false);
		expect(sameLayout(layout, { sidebarWidth: 300, collapsed: [], setupDismissed: [], uncommittedChanges: [] })).toBe(false);
		expect(sameLayout(layout, { sidebarWidth: 300, collapsed: ["/b"], setupDismissed: [], uncommittedChanges: [] })).toBe(false);
	});
});

describe("dismissed setup prompts", () => {
	test("an older layout without them reads as none dismissed", () => {
		expect(readLayout({ sidebarWidth: 300, collapsed: ["/a"] }).setupDismissed).toEqual([]);
	});

	test("are read as distinct paths, dropping anything else", () => {
		expect(readLayout({ setupDismissed: ["/a", 7, "", null, "/a", "/b"], uncommittedChanges: [] }).setupDismissed).toEqual(["/a", "/b"]);
		expect(readLayout({ setupDismissed: "all" }).setupDismissed).toEqual([]);
	});

	test("dismissing adds the repository once and leaves the given layout as it was", () => {
		const start = defaultLayout();
		const dismissed = dismissSetup(start, "/work/docs-site");
		expect(dismissed).toEqual({ ...start, setupDismissed: ["/work/docs-site"], uncommittedChanges: [] });
		expect(start.setupDismissed).toEqual([]);
		expect(dismissSetup(dismissed, "/work/docs-site")).toBe(dismissed);
	});

	test("a repository that leaves the list is forgotten here too", () => {
		const layout = { sidebarWidth: 300, collapsed: ["/b"], setupDismissed: ["/a", "/b"], uncommittedChanges: [] };
		expect(forgetRepository(layout, "/a")).toEqual({ sidebarWidth: 300, collapsed: ["/b"], setupDismissed: ["/b"], uncommittedChanges: [] });
		expect(forgetRepository(layout, "/b")).toEqual({ sidebarWidth: 300, collapsed: [], setupDismissed: ["/a"], uncommittedChanges: [] });
	});

	test("count when comparing layouts", () => {
		const layout = { sidebarWidth: 300, collapsed: [], setupDismissed: ["/a"], uncommittedChanges: [] };
		expect(sameLayout(layout, { sidebarWidth: 300, collapsed: [], setupDismissed: ["/a"], uncommittedChanges: [] })).toBe(true);
		expect(sameLayout(layout, { sidebarWidth: 300, collapsed: [], setupDismissed: [], uncommittedChanges: [] })).toBe(false);
		expect(sameLayout(layout, { sidebarWidth: 300, collapsed: [], setupDismissed: ["/b"], uncommittedChanges: [] })).toBe(false);
	});

	test("are written to the settings file and read back", () => {
		const settings = { repositories: [one], layout: { sidebarWidth: 300, collapsed: [], setupDismissed: [one.path], uncommittedChanges: [] } };
		expect(parseSettings(serializeSettings(settings))).toEqual(settings);
	});
});

describe("the layout part of the settings file", () => {
	test("round-trips beside the repositories", () => {
		const settings = { repositories: [one, two], layout: { sidebarWidth: 340, collapsed: [two.path], setupDismissed: [], uncommittedChanges: [] } };
		const text = serializeSettings(settings);
		expect(JSON.parse(text)).toEqual({ version: 1, ...settings });
		expect(parseSettings(text)).toEqual(settings);
	});

	test("an older file without it stays valid, and stays without it when written again", () => {
		const older = JSON.stringify({ version: 1, repositories: [one] });
		const settings = parseSettings(older);
		expect(settings).toEqual({ repositories: [one] });
		expect(settings && "layout" in settings).toBe(false);
		expect(JSON.parse(serializeSettings(settings!))).toEqual({ version: 1, repositories: [one] });
	});

	test("a damaged layout part falls back to the defaults and never costs the repository list", () => {
		for (const layout of [null, "wide", 7, [], { sidebarWidth: "wide", collapsed: 3 }]) {
			expect(parseSettings(JSON.stringify({ version: 1, repositories: [one, two], layout }))).toEqual({ repositories: [one, two], layout: defaultLayout() });
		}
		expect(parseSettings(JSON.stringify({ version: 1, repositories: [one], layout: { sidebarWidth: 1, collapsed: [one.path, 5], setupDismissed: [], uncommittedChanges: [] } })))
			.toEqual({ repositories: [one], layout: { sidebarWidth: MIN_SIDEBAR_WIDTH, collapsed: [one.path], setupDismissed: [], uncommittedChanges: [] } });
	});

	test("a damaged repository list is still a damaged file, whatever the layout says", () => {
		expect(parseSettings(JSON.stringify({ version: 1, repositories: "all", layout: defaultLayout() }))).toBeNull();
	});
});

describe("the comparison of each worktree's Changes tab", () => {
	test("is the base unless Uncommitted was chosen there, and choosing it again changes nothing", () => {
		const start = defaultLayout();
		expect(chosenComparison(start, "w1")).toBe("base");
		const uncommitted = chooseComparison(start, "w1", "uncommitted");
		expect(uncommitted.uncommittedChanges).toEqual(["w1"]);
		expect(chosenComparison(uncommitted, "w1")).toBe("uncommitted");
		expect(chosenComparison(uncommitted, "w2")).toBe("base");
		expect(chooseComparison(uncommitted, "w1", "uncommitted")).toBe(uncommitted);
		expect(chooseComparison(uncommitted, "w1", "base").uncommittedChanges).toEqual([]);
		expect(start.uncommittedChanges).toEqual([]);
	});

	test("is read from the settings file, keeping only distinct names, and counts when comparing layouts", () => {
		expect(readLayout({ uncommittedChanges: ["w1", 7, "", "w1", "w2"] }).uncommittedChanges).toEqual(["w1", "w2"]);
		expect(readLayout({ uncommittedChanges: "all" }).uncommittedChanges).toEqual([]);
		expect(sameLayout(defaultLayout(), { ...defaultLayout(), uncommittedChanges: ["w1"] })).toBe(false);
		const settings = { repositories: [one], layout: { ...defaultLayout(), uncommittedChanges: ["w1"] } };
		expect(parseSettings(serializeSettings(settings))).toEqual(settings);
	});
});
