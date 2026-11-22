import { describe, expect, test } from "bun:test";
import {
	DEFAULT_CHOPS_WIDTH,
	DEFAULT_SIDEBAR_WIDTH,
	MAX_CHOPS_WIDTH,
	MIN_CHOPS_WIDTH,
	MAX_SIDEBAR_WIDTH,
	MIN_SIDEBAR_WIDTH,
	chooseComparison,
	chosenComparison,
	clampChopsWidth,
	clampSidebarWidth,
	defaultLayout,
	dismissSetup,
	forgetGroup,
	forgetRepository,
	readLayout,
	sameLayout,
	toggleCollapsed,
	toggleGroupCollapsed,
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

describe("the chops panel in the layout", () => {
	test("is hidden by default, at the default width", () => {
		expect(defaultLayout().chopsOpen).toBe(false);
		expect(defaultLayout().chopsWidth).toBe(DEFAULT_CHOPS_WIDTH);
	});

	test("its width is kept within its own limits, as whole pixels", () => {
		expect(clampChopsWidth(333.4)).toBe(333);
		expect(clampChopsWidth(10)).toBe(MIN_CHOPS_WIDTH);
		expect(clampChopsWidth(9000)).toBe(MAX_CHOPS_WIDTH);
		expect(clampChopsWidth(Number.NaN)).toBe(DEFAULT_CHOPS_WIDTH);
	});

	test("is read from outside part by part, a part that cannot be read taking its default", () => {
		expect(readLayout({ chopsOpen: true, chopsWidth: 400, sidePanel: "files" as const })).toMatchObject({ chopsOpen: true, chopsWidth: 400, sidePanel: "files" as const });
		expect(readLayout({ chopsOpen: "yes", chopsWidth: "wide" })).toMatchObject({ chopsOpen: false, chopsWidth: DEFAULT_CHOPS_WIDTH, sidePanel: "chops" as const });
		expect(readLayout({ chopsWidth: 50 }).chopsWidth).toBe(MIN_CHOPS_WIDTH);
	});

	test("a change to either part is a change to the layout", () => {
		expect(sameLayout(defaultLayout(), { ...defaultLayout(), chopsOpen: true })).toBe(false);
		expect(sameLayout(defaultLayout(), { ...defaultLayout(), chopsWidth: 400 })).toBe(false);
	});

	test("is written to the file only once it differs from the default, so an older file stays as it was", () => {
		const settings = { repositories: [one], layout: defaultLayout() };
		const written = JSON.parse(serializeSettings(settings)).layout;
		expect("chopsOpen" in written).toBe(false);
		expect("chopsWidth" in written).toBe(false);
		expect(parseSettings(serializeSettings(settings))).toEqual(settings);
		const shown = { repositories: [one], layout: { ...defaultLayout(), chopsOpen: true, chopsWidth: 420, sidePanel: "files" as const } };
		expect(JSON.parse(serializeSettings(shown)).layout).toMatchObject({ chopsOpen: true, chopsWidth: 420 });
		expect(parseSettings(serializeSettings(shown))).toEqual(shown);
	});
});

describe("what the side panel shows in the layout", () => {
	test("is the chops by default, and the files once chosen", () => {
		expect(defaultLayout().sidePanel).toBe("chops");
		expect(readLayout({ sidePanel: "files" }).sidePanel).toBe("files");
		expect(readLayout({ sidePanel: "editor" }).sidePanel).toBe("chops");
		expect(readLayout({ sidePanel: 3 }).sidePanel).toBe("chops");
	});

	test("is a change to the layout, written only once it differs from the default", () => {
		expect(sameLayout(defaultLayout(), { ...defaultLayout(), sidePanel: "files" })).toBe(false);
		expect("sidePanel" in JSON.parse(serializeSettings({ repositories: [one], layout: defaultLayout() })).layout).toBe(false);
		const files = { repositories: [one], layout: { ...defaultLayout(), sidePanel: "files" as const } };
		expect(JSON.parse(serializeSettings(files)).layout.sidePanel).toBe("files");
		expect(parseSettings(serializeSettings(files))).toEqual(files);
	});

	test("can be the changes, saved and read back", () => {
		expect(readLayout({ chopsOpen: true, sidePanel: "changes" })).toMatchObject({ chopsOpen: true, sidePanel: "changes" });
		const changes = { repositories: [one], layout: { ...defaultLayout(), chopsOpen: true, sidePanel: "changes" as const } };
		expect(JSON.parse(serializeSettings(changes)).layout.sidePanel).toBe("changes");
		expect(parseSettings(serializeSettings(changes))).toEqual(changes);
	});

	test("a layout saved before the Changes view reads as it was", () => {
		// Saved by the app before the Changes view: two views, and every part kept.
		const before = { sidebarWidth: 300, collapsed: ["/a"], setupDismissed: [], uncommittedChanges: ["wt-1"], issueLists: {}, collapsedGroups: [], chopsOpen: true, chopsWidth: 400, sidePanel: "files" };
		expect(readLayout(before)).toEqual({ ...defaultLayout(), ...before, sidePanel: "files" });
	});
});

describe("the diff tab's layout in the layout", () => {
	test("is Unified by default, and Split once chosen", () => {
		expect(defaultLayout().diffLayout).toBe("unified");
		expect(readLayout({ diffLayout: "split" }).diffLayout).toBe("split");
		expect(readLayout({ diffLayout: "columns" }).diffLayout).toBe("unified");
		expect(readLayout({ diffLayout: 2 }).diffLayout).toBe("unified");
	});

	test("is saved and read back, so it is kept after a restart, and a layout saved before it reads as Unified", () => {
		expect(sameLayout(defaultLayout(), { ...defaultLayout(), diffLayout: "split" })).toBe(false);
		const split = { repositories: [one], layout: { ...defaultLayout(), diffLayout: "split" as const } };
		expect(JSON.parse(serializeSettings(split)).layout.diffLayout).toBe("split");
		expect(parseSettings(serializeSettings(split))).toEqual(split);
		const { diffLayout: _left, ...before } = defaultLayout();
		expect(readLayout(before)).toEqual(defaultLayout());
	});
});

describe("readLayout", () => {
	test("reads a width and the collapsed repositories", () => {
		expect(readLayout({ sidebarWidth: 320, collapsed: ["/work/timber"], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const })).toEqual({ sidebarWidth: 320, collapsed: ["/work/timber"], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const });
	});

	test("gives the defaults for anything that is not a layout", () => {
		for (const value of [undefined, null, 7, "wide", [], [320]]) expect(readLayout(value)).toEqual(defaultLayout());
	});

	test("keeps the readable part when the other part is damaged", () => {
		expect(readLayout({ sidebarWidth: "wide", collapsed: ["/work/timber"], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const })).toEqual({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, collapsed: ["/work/timber"], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const });
		expect(readLayout({ sidebarWidth: 320, collapsed: "all" })).toEqual({ sidebarWidth: 320, collapsed: [], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const });
		expect(readLayout({ collapsed: ["/work/timber"] })).toEqual({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, collapsed: ["/work/timber"], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const });
	});

	test("brings a width back within the limits, and drops entries that are not paths or are repeated", () => {
		expect(readLayout({ sidebarWidth: 9000, collapsed: ["/a", 7, "", null, "/a", "/b"], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const })).toEqual({ sidebarWidth: MAX_SIDEBAR_WIDTH, collapsed: ["/a", "/b"], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const });
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
		const layout = { sidebarWidth: 300, collapsed: ["/a", "/b"], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const };
		expect(forgetRepository(layout, "/a")).toEqual({ sidebarWidth: 300, collapsed: ["/b"], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const });
		expect(forgetRepository(layout, "/other")).toBe(layout);
	});

	test("compare width and collapsed groups", () => {
		const layout = { sidebarWidth: 300, collapsed: ["/a"], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const };
		expect(sameLayout(layout, { sidebarWidth: 300, collapsed: ["/a"], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const })).toBe(true);
		expect(sameLayout(layout, { sidebarWidth: 301, collapsed: ["/a"], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const })).toBe(false);
		expect(sameLayout(layout, { sidebarWidth: 300, collapsed: [], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const })).toBe(false);
		expect(sameLayout(layout, { sidebarWidth: 300, collapsed: ["/b"], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const })).toBe(false);
	});
});

describe("dismissed setup prompts", () => {
	test("an older layout without them reads as none dismissed", () => {
		expect(readLayout({ sidebarWidth: 300, collapsed: ["/a"] }).setupDismissed).toEqual([]);
	});

	test("are read as distinct paths, dropping anything else", () => {
		expect(readLayout({ setupDismissed: ["/a", 7, "", null, "/a", "/b"], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const }).setupDismissed).toEqual(["/a", "/b"]);
		expect(readLayout({ setupDismissed: "all" }).setupDismissed).toEqual([]);
	});

	test("dismissing adds the repository once and leaves the given layout as it was", () => {
		const start = defaultLayout();
		const dismissed = dismissSetup(start, "/work/docs-site");
		expect(dismissed).toEqual({ ...start, setupDismissed: ["/work/docs-site"], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const });
		expect(start.setupDismissed).toEqual([]);
		expect(dismissSetup(dismissed, "/work/docs-site")).toBe(dismissed);
	});

	test("a repository that leaves the list is forgotten here too", () => {
		const layout = { sidebarWidth: 300, collapsed: ["/b"], setupDismissed: ["/a", "/b"], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const };
		expect(forgetRepository(layout, "/a")).toEqual({ sidebarWidth: 300, collapsed: ["/b"], setupDismissed: ["/b"], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const });
		expect(forgetRepository(layout, "/b")).toEqual({ sidebarWidth: 300, collapsed: [], setupDismissed: ["/a"], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const });
	});

	test("count when comparing layouts", () => {
		const layout = { sidebarWidth: 300, collapsed: [], setupDismissed: ["/a"], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const };
		expect(sameLayout(layout, { sidebarWidth: 300, collapsed: [], setupDismissed: ["/a"], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const })).toBe(true);
		expect(sameLayout(layout, { sidebarWidth: 300, collapsed: [], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const })).toBe(false);
		expect(sameLayout(layout, { sidebarWidth: 300, collapsed: [], setupDismissed: ["/b"], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const })).toBe(false);
	});

	test("are written to the settings file and read back", () => {
		const settings = { repositories: [one], layout: { sidebarWidth: 300, collapsed: [], setupDismissed: [one.path], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const } };
		expect(parseSettings(serializeSettings(settings))).toEqual(settings);
	});
});

describe("the layout part of the settings file", () => {
	test("round-trips beside the repositories", () => {
		const settings = { repositories: [one, two], layout: { sidebarWidth: 340, collapsed: [two.path], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: ["g-work"], chopsOpen: true, chopsWidth: 400, sidePanel: "files" as const, diffLayout: "split" as const } };
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
		expect(parseSettings(JSON.stringify({ version: 1, repositories: [one], layout: { sidebarWidth: 1, collapsed: [one.path, 5], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const } })))
			.toEqual({ repositories: [one], layout: { sidebarWidth: MIN_SIDEBAR_WIDTH, collapsed: [one.path], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const } });
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

describe("folded repository groups", () => {
	test("start as none, and an older layout without them reads as none", () => {
		expect(defaultLayout().collapsedGroups).toEqual([]);
		expect(readLayout({ sidebarWidth: 300, collapsed: ["/a"] }).collapsedGroups).toEqual([]);
	});

	test("are read as distinct non-empty ids, dropping anything else", () => {
		expect(readLayout({ collapsedGroups: ["g1", 7, "", null, "g1", "g2"], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const }).collapsedGroups).toEqual(["g1", "g2"]);
		expect(readLayout({ collapsedGroups: "all" }).collapsedGroups).toEqual([]);
	});

	test("toggle both ways and leave the given layout as it was", () => {
		const start = defaultLayout();
		const folded = toggleGroupCollapsed(start, "g1");
		expect(folded.collapsedGroups).toEqual(["g1"]);
		expect(start.collapsedGroups).toEqual([]);
		expect(toggleGroupCollapsed(folded, "g1")).toEqual(start);
	});

	test("a deleted group is forgotten", () => {
		const layout = { ...defaultLayout(), collapsedGroups: ["g1", "g2"], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const };
		expect(forgetGroup(layout, "g1")).toEqual({ ...defaultLayout(), collapsedGroups: ["g2"], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const });
		expect(forgetGroup(layout, "other")).toBe(layout);
	});

	test("count when comparing layouts", () => {
		const layout = { ...defaultLayout(), collapsedGroups: ["g1"], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const };
		expect(sameLayout(layout, { ...defaultLayout(), collapsedGroups: ["g1"], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const })).toBe(true);
		expect(sameLayout(layout, defaultLayout())).toBe(false);
		expect(sameLayout(layout, { ...defaultLayout(), collapsedGroups: ["g2"], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const })).toBe(false);
	});
});
