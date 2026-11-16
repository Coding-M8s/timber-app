import { describe, expect, test } from "bun:test";
import {
	DEFAULT_SIDEBAR_WIDTH,
	MAX_SIDEBAR_WIDTH,
	MIN_SIDEBAR_WIDTH,
	clampSidebarWidth,
	defaultLayout,
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
		expect(readLayout({ sidebarWidth: 320, collapsed: ["/work/timber"] })).toEqual({ sidebarWidth: 320, collapsed: ["/work/timber"] });
	});

	test("gives the defaults for anything that is not a layout", () => {
		for (const value of [undefined, null, 7, "wide", [], [320]]) expect(readLayout(value)).toEqual(defaultLayout());
	});

	test("keeps the readable part when the other part is damaged", () => {
		expect(readLayout({ sidebarWidth: "wide", collapsed: ["/work/timber"] })).toEqual({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, collapsed: ["/work/timber"] });
		expect(readLayout({ sidebarWidth: 320, collapsed: "all" })).toEqual({ sidebarWidth: 320, collapsed: [] });
		expect(readLayout({ collapsed: ["/work/timber"] })).toEqual({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, collapsed: ["/work/timber"] });
	});

	test("brings a width back within the limits, and drops entries that are not paths or are repeated", () => {
		expect(readLayout({ sidebarWidth: 9000, collapsed: ["/a", 7, "", null, "/a", "/b"] })).toEqual({ sidebarWidth: MAX_SIDEBAR_WIDTH, collapsed: ["/a", "/b"] });
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
		const layout = { sidebarWidth: 300, collapsed: ["/a", "/b"] };
		expect(forgetRepository(layout, "/a")).toEqual({ sidebarWidth: 300, collapsed: ["/b"] });
		expect(forgetRepository(layout, "/other")).toBe(layout);
	});

	test("compare width and collapsed groups", () => {
		const layout = { sidebarWidth: 300, collapsed: ["/a"] };
		expect(sameLayout(layout, { sidebarWidth: 300, collapsed: ["/a"] })).toBe(true);
		expect(sameLayout(layout, { sidebarWidth: 301, collapsed: ["/a"] })).toBe(false);
		expect(sameLayout(layout, { sidebarWidth: 300, collapsed: [] })).toBe(false);
		expect(sameLayout(layout, { sidebarWidth: 300, collapsed: ["/b"] })).toBe(false);
	});
});

describe("the layout part of the settings file", () => {
	test("round-trips beside the repositories", () => {
		const settings = { repositories: [one, two], layout: { sidebarWidth: 340, collapsed: [two.path] } };
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
		expect(parseSettings(JSON.stringify({ version: 1, repositories: [one], layout: { sidebarWidth: 1, collapsed: [one.path, 5] } })))
			.toEqual({ repositories: [one], layout: { sidebarWidth: MIN_SIDEBAR_WIDTH, collapsed: [one.path] } });
	});

	test("a damaged repository list is still a damaged file, whatever the layout says", () => {
		expect(parseSettings(JSON.stringify({ version: 1, repositories: "all", layout: defaultLayout() }))).toBeNull();
	});
});
