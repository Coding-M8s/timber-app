import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createChops } from "../src/bun/chops";
import { createSavedPreferences } from "../src/bun/preferences";
import { createSettingsHolder } from "../src/bun/settings";
import { App } from "../src/mainview/App";
import { addChopDraft, chopDraftsOf, chopRenames, chopsSectionRenames, editChopDraft, removeChopDraft } from "../src/mainview/chop-format";
import { CHOPS_DRAG_SCROLL_EDGE, CHOPS_DRAG_SCROLL_STEP, chopDropPlace, chopsDragScroll, chopsPanelModel } from "../src/mainview/chops-panel-format";
import { createMockEngine } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import {
	CHOP_ORDER_LIMIT, CHOP_ORDER_REPOSITORY_LIMIT, type ChopArrangement, NO_CHOP_ARRANGEMENT, arrangeChops, chopArrangementOf, describeChopAtEnd, describeChopPlace, placeChop, readChopArrangements,
	renameInArrangements, salvageChopArrangements, sameChopArrangements, stepChop, toggleChopFavorite, withChopArrangement, writeChopArrangements,
} from "../src/shared/chop-order";
import type { ChopKind, ListedChop, PersonalChop } from "../src/shared/chops";
import { applyPreferenceChange, defaultPreferences, readPreferences } from "../src/shared/preferences";
import type { Repository } from "../src/shared/model";
import { fingerprint, git } from "./support/timber";

const chop = (name: string, kind: ChopKind = "command"): ListedChop => ({ name, kind, text: "x", description: "", agent: null, source: "personal-every", sound: null });
const names = (rows: readonly { chop: { name: string } }[]) => rows.map(row => row.chop.name);
const arrangement = (favorites: string[], rest: string[]): ChopArrangement => ({ favorites, rest });

describe("arranging a repository's chops", () => {
	const listed = [chop("A"), chop("B"), chop("C"), chop("D")];

	test("with nothing saved, the chops keep the listed order and none is a favorite", () => {
		const arranged = arrangeChops(listed, NO_CHOP_ARRANGEMENT);
		expect(names(arranged)).toEqual(["A", "B", "C", "D"]);
		expect(arranged.every(row => !row.favorite)).toBe(true);
	});

	test("favorites come first in their order, then the rest in theirs, then chops neither names, in listed order", () => {
		const arranged = arrangeChops(listed, arrangement(["c", "A"], ["D"]));
		expect(names(arranged)).toEqual(["C", "A", "D", "B"]);
		expect(arranged.map(row => row.favorite)).toEqual([true, true, false, false]);
	});

	test("names the list does not have are passed over", () => {
		expect(names(arrangeChops(listed, arrangement(["Gone"], ["Old", "B"])))).toEqual(["B", "A", "C", "D"]);
	});
});

describe("moving and starring a chop", () => {
	const listed = [chop("A"), chop("B"), chop("C"), chop("D")];

	test("a chop goes before another in its part, or at the end of the part", () => {
		const moved = placeChop(listed, NO_CHOP_ARRANGEMENT, "D", { favorite: false, before: "B" });
		expect(moved).toEqual(arrangement([], ["A", "D", "B", "C"]));
		expect(placeChop(listed, moved, "a", { favorite: false, before: null })).toEqual(arrangement([], ["D", "B", "C", "A"]));
	});

	test("a drop into Favorites pins it, and a drop out of them unpins it", () => {
		const pinned = placeChop(listed, NO_CHOP_ARRANGEMENT, "C", { favorite: true, before: null });
		expect(pinned).toEqual(arrangement(["C"], ["A", "B", "D"]));
		expect(placeChop(listed, pinned, "C", { favorite: false, before: "B" })).toEqual(arrangement([], ["A", "C", "B", "D"]));
	});

	test("a star puts a chop at the end of Favorites, and taking it off puts it at the top of the rest", () => {
		const one = toggleChopFavorite(listed, NO_CHOP_ARRANGEMENT, "B");
		const two = toggleChopFavorite(listed, one, "D");
		expect(two).toEqual(arrangement(["B", "D"], ["A", "C"]));
		expect(toggleChopFavorite(listed, two, "B")).toEqual(arrangement(["D"], ["B", "A", "C"]));
	});

	test("an unknown chop changes nothing", () => {
		const saved = arrangement(["A"], ["B"]);
		expect(placeChop(listed, saved, "Nope", { favorite: true, before: null })).toBe(saved);
	});

	test("names not listed now keep their place after the listed ones, so a chop back again finds it", () => {
		const saved = arrangement(["Gone", "A"], ["B", "Away"]);
		const moved = placeChop(listed, saved, "D", { favorite: true, before: "A" });
		expect(moved).toEqual(arrangement(["D", "A", "Gone"], ["B", "C", "Away"]));
		const back = [...listed, chop("Gone"), chop("Away")];
		expect(names(arrangeChops(back, moved))).toEqual(["D", "A", "Gone", "B", "C", "Away"]);
	});

	test("names not listed are dropped first once the limit is reached", () => {
		const many = Array.from({ length: CHOP_ORDER_LIMIT }, (_, index) => chop(`Chop ${index}`));
		const saved = arrangement(["Gone"], many.map(entry => entry.name));
		const moved = placeChop(many, saved, "Chop 5", { favorite: true, before: null });
		expect(moved.favorites).toEqual(["Chop 5"]);
		expect(moved.favorites.length + moved.rest.length).toBe(CHOP_ORDER_LIMIT);
	});
});

describe("Alt+Up and Alt+Down", () => {
	// Commands and prompts share one order; a tab shows its own kind.
	const listed = [chop("A"), chop("P1", "prompt"), chop("B"), chop("C"), chop("E"), chop("P2", "prompt"), chop("D")];
	const saved = arrangement(["A", "B"], ["P1", "C", "E", "P2", "D"]);
	const arranged = arrangeChops(listed, saved);
	const commands = arranged.filter(row => row.chop.kind === "command");
	const step = (shown: typeof commands, name: string, by: -1 | 1) => {
		const place = stepChop(arranged, shown, name, by);
		return place === null ? null : placeChop(listed, saved, name, place);
	};

	test("a step takes the place of the row shown next to it in its part", () => {
		expect(stepChop(arranged, commands, "B", -1)).toEqual({ favorite: true, before: "A" });
		expect(step(commands, "B", -1)).toEqual(arrangement(["B", "A"], ["P1", "C", "E", "P2", "D"]));
		expect(step(commands, "C", 1)).toEqual(arrangement(["A", "B"], ["P1", "E", "C", "P2", "D"]));
		expect(step(commands, "E", -1)).toEqual(arrangement(["A", "B"], ["P1", "E", "C", "P2", "D"]));
	});

	test("the other tab's chops keep their places", () => {
		const next = step(commands, "D", -1)!;
		expect(next.rest).toEqual(["P1", "C", "D", "E", "P2"]);
		const prompts = arrangeChops(listed, next).filter(row => row.chop.kind === "prompt");
		expect(names(prompts)).toEqual(["P1", "P2"]);
	});

	test("with a filter on, a step passes the next row shown, with the hidden ones between", () => {
		const filtered = commands.filter(row => row.chop.name !== "E");
		expect(step(filtered, "C", 1)).toEqual(arrangement(["A", "B"], ["P1", "E", "P2", "D", "C"]));
		expect(step(filtered, "D", -1)).toEqual(arrangement(["A", "B"], ["P1", "D", "C", "E", "P2"]));
		expect(stepChop(arranged, filtered, "D", 1)).toBeNull();
	});

	test("a step never crosses between Favorites and the rest, and stops at the ends", () => {
		expect(stepChop(arranged, commands, "B", 1)).toBeNull();
		expect(stepChop(arranged, commands, "C", -1)).toBeNull();
		expect(stepChop(arranged, commands, "A", -1)).toBeNull();
		expect(stepChop(arranged, commands, "D", 1)).toBeNull();
		expect(stepChop(arranged, commands, "Nope", 1)).toBeNull();
	});

	test("the live region says where the chop is now, or that it is at the end already", () => {
		expect(describeChopPlace(commands, "B")).toBe("B, 2 of 2 in Favorites.");
		expect(describeChopPlace(commands, "c")).toBe("C, 1 of 3 in Other chops.");
		expect(describeChopAtEnd("A", true, -1)).toBe("A is already first in Favorites.");
		expect(describeChopAtEnd("D", false, 1)).toBe("D is already last in Other chops.");
	});
});

describe("dropping a dragged chop", () => {
	const slots = [
		{ name: "A", favorite: true, middle: 10 },
		{ name: "B", favorite: true, middle: 30 },
		{ name: "C", favorite: false, middle: 70 },
		{ name: "D", favorite: false, middle: 90 },
	];

	test("above a row's middle lands before it, and past the last row of a part at its end", () => {
		expect(chopDropPlace(slots, 50, 5)).toEqual({ favorite: true, before: "A" });
		expect(chopDropPlace(slots, 50, 20)).toEqual({ favorite: true, before: "B" });
		expect(chopDropPlace(slots, 50, 45)).toEqual({ favorite: true, before: null });
		expect(chopDropPlace(slots, 50, 55)).toEqual({ favorite: false, before: "C" });
		expect(chopDropPlace(slots, 50, 200)).toEqual({ favorite: false, before: null });
	});

	test("with no Favorites line, nothing is pinned", () => {
		const rest = slots.filter(slot => !slot.favorite);
		expect(chopDropPlace(rest, null, 0)).toEqual({ favorite: false, before: "C" });
	});
});

describe("scrolling the list while a chop is dragged", () => {
	test("near the top it scrolls up, near the bottom down, faster nearer the edge and past it, and not in between", () => {
		expect(chopsDragScroll(300, 100, 500)).toBe(0);
		expect(chopsDragScroll(100 + CHOPS_DRAG_SCROLL_EDGE - 1, 100, 500)).toBeLessThan(0);
		expect(chopsDragScroll(101, 100, 500)).toBeLessThan(chopsDragScroll(120, 100, 500));
		expect(chopsDragScroll(40, 100, 500)).toBe(-CHOPS_DRAG_SCROLL_STEP);
		expect(chopsDragScroll(500 - CHOPS_DRAG_SCROLL_EDGE + 1, 100, 500)).toBeGreaterThan(0);
		expect(chopsDragScroll(900, 100, 500)).toBe(CHOPS_DRAG_SCROLL_STEP);
	});

	test("a list too short for its edges, or with no height, scrolls by its middle or not at all", () => {
		expect(chopsDragScroll(120, 100, 140)).toBe(0);
		expect(chopsDragScroll(101, 100, 140)).toBeLessThan(0);
		expect(chopsDragScroll(100, 100, 100)).toBe(0);
	});
});

describe("the chop order in the settings file", () => {
	test("reads and writes each repository's favorites and rest", () => {
		const value = { "/work/app": { favorites: ["Test"], rest: ["Lint", "Build"] } };
		const read = readChopArrangements(value);
		expect(read).toEqual(value);
		expect(writeChopArrangements(read!)).toEqual(value);
		expect(sameChopArrangements(read!, value)).toBe(true);
		expect(sameChopArrangements(read!, { "/work/app": { favorites: [], rest: ["Test", "Lint", "Build"] } })).toBe(false);
	});

	test("a change with any part that cannot be read is refused whole", () => {
		expect(readChopArrangements([])).toBeUndefined();
		expect(readChopArrangements({ "/a": { favorites: ["A"], rest: ["a"] } })).toBeUndefined();
		expect(readChopArrangements({ "/a": { favorites: [" A"], rest: [] } })).toBeUndefined();
		expect(readChopArrangements({ "/a": { favorites: [1], rest: [] } })).toBeUndefined();
		expect(readChopArrangements({ "": { favorites: [], rest: ["A"] } })).toBeUndefined();
		expect(readChopArrangements({ "/a": { rest: ["A"] } })).toBeUndefined();
		expect(readChopArrangements({ "/a": { favorites: [], rest: Array.from({ length: CHOP_ORDER_LIMIT + 1 }, (_, index) => `C${index}`) } })).toBeUndefined();
		const many = Object.fromEntries(Array.from({ length: CHOP_ORDER_REPOSITORY_LIMIT + 1 }, (_, index) => [`/r${index}`, { favorites: [], rest: ["A"] }]));
		expect(readChopArrangements(many)).toBeUndefined();
		expect(applyPreferenceChange(defaultPreferences(), { chopOrder: { "/a": "no" } }).unreadable).toEqual(["chopOrder"]);
	});

	test("a hand-edited file keeps every name it can read", () => {
		const read = readPreferences({ chopOrder: { "/a": { favorites: ["A", 3, "a"], rest: ["B", " bad", "A"] }, "": { rest: ["X"] }, "/b": "no", "/c": { favorites: [], rest: [] } } });
		expect(read.chopOrder).toEqual({ "/a": { favorites: ["A"], rest: ["B"] } });
		expect(salvageChopArrangements("no")).toBeUndefined();
	});

	test("past the limit of repositories, the arrangement changed longest ago is dropped", () => {
		let many: Record<string, ChopArrangement> = {};
		for (let index = 0; index < CHOP_ORDER_REPOSITORY_LIMIT; index += 1) many = withChopArrangement(many, `/r${index}`, arrangement([], ["A"]));
		many = withChopArrangement(many, "/r0", arrangement(["A"], []));
		many = withChopArrangement(many, "/new", arrangement([], ["A"]));
		expect(Object.keys(many)).toHaveLength(CHOP_ORDER_REPOSITORY_LIMIT);
		expect(many["/r1"]).toBeUndefined();
		expect(many["/r0"]).toEqual(arrangement(["A"], []));
		expect(Object.keys(many).at(-1)).toBe("/new");
		expect(readChopArrangements(many)).toEqual(many);
	});

	test("an empty arrangement is left out, and none is the default", () => {
		expect(defaultPreferences().chopOrder).toEqual({});
		expect(withChopArrangement({ "/a": arrangement(["A"], []) }, "/a", NO_CHOP_ARRANGEMENT)).toEqual({});
		expect(chopArrangementOf({}, "/a")).toEqual(NO_CHOP_ARRANGEMENT);
		expect(chopArrangementOf({}, "constructor")).toEqual(NO_CHOP_ARRANGEMENT);
	});
});

describe("renaming a chop", () => {
	const saved = { "/a": arrangement(["Lint"], ["Test"]), "/b": arrangement([], ["Lint", "Build"]) };
	const every = (name: string): PersonalChop => ({ name, kind: "command", text: "x", description: "", agent: null, repository: null, sound: null });
	const here = (name: string, repository: string): PersonalChop => ({ ...every(name), repository });

	test("a chop for one repository keeps its place and star there only", () => {
		expect(renameInArrangements(saved, [{ repository: "/a", from: "lint", to: "Check" }])).toEqual({ "/a": arrangement(["Check"], ["Test"]), "/b": saved["/b"] });
	});

	test("a chop for every repository keeps its place in each, and takes the place of the name it takes", () => {
		// In /b, Build was a file chop or a deleted one: the renamed chop is the one listed as Build now.
		expect(renameInArrangements(saved, [{ repository: null, from: "Lint", to: "Build" }])).toEqual({ "/a": arrangement(["Build"], ["Test"]), "/b": arrangement([], ["Build"]) });
		expect(renameInArrangements(saved, [{ repository: null, from: "Lint", to: "LINT" }])).toEqual({ "/a": arrangement(["LINT"], ["Test"]), "/b": arrangement([], ["LINT", "Build"]) });
	});

	test("a rename onto a deleted chop's name takes the renamed chop's place and star, not the deleted one's", () => {
		const kept = { "/a": arrangement(["Deploy"], ["Ship", "Test"]) };
		expect(renameInArrangements(kept, [{ repository: "/a", from: "Ship", to: "Deploy" }])).toEqual({ "/a": arrangement([], ["Deploy", "Test"]) });
	});

	test("a chop for every repository keeps its place where a chop for a repository has its new name, which stays listed there", () => {
		const renames = chopRenames([every("Lint"), here("Build", "/b")], [{ from: every("Lint"), to: every("Build") }]);
		expect(renames).toEqual([{ repository: null, from: "Lint", to: "Build", shadowed: ["/b"] }]);
		expect(renameInArrangements(saved, renames)).toEqual({ "/a": arrangement(["Build"], ["Test"]), "/b": saved["/b"] });
	});

	test("two chops that swap names swap places and stars", () => {
		expect(renameInArrangements(saved, [{ repository: null, from: "Lint", to: "Test" }, { repository: null, from: "Test", to: "Lint" }])).toEqual({ "/a": arrangement(["Test"], ["Lint"]), "/b": arrangement([], ["Test", "Build"]) });
	});

	test("a chop for every repository is not renamed where a chop for that repository with its name is the one listed", () => {
		const renames = chopRenames([every("Lint"), here("Lint", "/a")], [{ from: every("Lint"), to: every("Check") }]);
		expect(renames).toEqual([{ repository: null, from: "Lint", to: "Check", shadowed: ["/a"] }]);
		expect(renameInArrangements(saved, renames)).toEqual({ "/a": saved["/a"], "/b": arrangement([], ["Check", "Build"]) });
	});

	test("a chop for a repository deleted in the same save does not hold back a chop for every repository renamed to its name", () => {
		const chops = [every("A"), here("B", "/b")];
		const savedDrafts = chopDraftsOf(chops);
		const drafts = editChopDraft(removeChopDraft(savedDrafts, savedDrafts[1]!.key), savedDrafts[0]!.key, { name: "B" });
		expect(chopsSectionRenames(chops, savedDrafts, drafts)).toEqual([{ repository: null, from: "A", to: "B", shadowed: [] }]);
	});

	test("a save that keeps the names, or a chop new or with no name yet, renames nothing", () => {
		expect(chopRenames([every("Lint")], [{ from: every("Lint"), to: { name: "Lint" } }, { from: every("Lint"), to: { name: "" } }])).toEqual([]);
	});

	test("Settings, Chops finds its renames by row, among moved, added, and removed rows", () => {
		const chops = [every("Lint"), here("Test", "/a"), every("Build")];
		const savedDrafts = chopDraftsOf(chops);
		let drafts = editChopDraft(savedDrafts, savedDrafts[0]!.key, { name: "Check" });
		drafts = removeChopDraft(drafts, savedDrafts[2]!.key);
		drafts = addChopDraft(drafts);
		drafts = editChopDraft(drafts, drafts.at(-1)!.key, { name: "New", text: "y" });
		expect(chopsSectionRenames(chops, savedDrafts, [drafts[1]!, drafts[0]!, drafts[2]!])).toEqual([{ repository: null, from: "Lint", to: "Check", shadowed: [] }]);
	});
});

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};

describe("the chops panel's order", () => {
	async function panelStore(engine = createMockEngine()) {
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		// ChopsKeeper reads them in a window; with no worktree selected, the list read last shows.
		await store.readChops("/work/timber");
		return { engine, store };
	}

	test("a star and a move show at once, and quick moves add up before the saves answer", async () => {
		const { engine, store } = await panelStore();
		const before = names(chopsPanelModel(store.getState(), "command", "").rows);
		expect(before).toEqual(["Test", "Dev server"]);
		const repository = "/work/timber";
		const chops = chopsPanelModel(store.getState(), "command", "").list!;
		const listed = chops.outcome === "listed" ? chops.chops : [];
		const order = () => store.getState().chopOrderAim ?? store.getState().preferences.chopOrder;
		const first = store.saveChopOrder(withChopArrangement(order(), repository, toggleChopFavorite(listed, chopArrangementOf(order(), repository), "Dev server")));
		const second = store.saveChopOrder(withChopArrangement(order(), repository, placeChop(listed, chopArrangementOf(order(), repository), "Review the diff", { favorite: true, before: null })));
		const model = chopsPanelModel(store.getState(), "command", "");
		expect(model.rows.map(row => [row.chop.name, row.favorite])).toEqual([["Dev server", true], ["Test", false]]);
		await Promise.all([first, second]);
		expect(store.getState().chopOrderAim).toBeNull();
		expect((await engine.loadPreferences()).chopOrder).toEqual({ [repository]: { favorites: ["Dev server", "Review the diff"], rest: ["Test"] } });
	});

	test("a failed save shows the saved order again", async () => {
		const engine = createMockEngine();
		const { store } = await panelStore(engine);
		engine.failPreferenceSaves("disk full");
		const result = await store.saveChopOrder({ "/work/timber": arrangement(["Dev server"], []) });
		expect(result).toEqual({ outcome: "failed", message: "disk full" });
		expect(names(chopsPanelModel(store.getState(), "command", "").rows)).toEqual(["Test", "Dev server"]);
	});

	test("the panel draws Favorites first with a pressed star, each row with a handle", async () => {
		const { store } = await panelStore();
		await store.saveChopOrder({ "/work/timber": arrangement(["Dev server"], []) });
		store.toggleChopsPanel();
		const markup = renderToStaticMarkup(<App store={store} />);
		const panel = markup.slice(markup.indexOf('id="chops-panel"'));
		expect(panel).toContain('aria-label="Favorite Dev server" aria-pressed="true"');
		expect(panel).toContain('aria-label="Favorite Test" aria-pressed="false"');
		expect(panel).toContain('aria-label="Move Test" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"');
		const favorites = panel.indexOf(">Favorites</h3>");
		const rest = panel.indexOf(">Other chops</h3>");
		expect(favorites).toBeGreaterThan(-1);
		expect(favorites).toBeLessThan(panel.indexOf('data-chop-row="Dev server"'));
		expect(panel.indexOf('data-chop-row="Dev server"')).toBeLessThan(rest);
		expect(rest).toBeLessThan(panel.indexOf('data-chop-row="Test"'));
		expect(panel).toContain('role="status" aria-live="polite"');
	});

	test("with the saved settings unreadable, the handles and stars are off and say why", async () => {
		const engine = createMockEngine();
		engine.loadPreferences = async () => {
			throw new Error("bad JSON");
		};
		const { store } = await panelStore(engine);
		expect(store.getState().preferencesProblem).not.toBeNull();
		store.toggleChopsPanel();
		const panel = renderToStaticMarkup(<App store={store} />);
		expect(panel).toContain('aria-label="Move Test" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" aria-disabled="true" title="The saved settings could not be read');
		expect(panel).toContain('aria-label="Favorite Test" aria-pressed="false" aria-disabled="true" title="The saved settings could not be read');
	});

	test("a renamed chop keeps its place by its old name while the list read before the save still shows", async () => {
		const { store } = await panelStore();
		await store.saveChopOrder({ "/work/timber": arrangement(["Dev server"], []) });
		const renames = [{ repository: "/work/timber", from: "Dev server", to: "Serve" }];
		store.noteChopRenames(renames);
		await store.saveChopOrder(renameInArrangements(store.getState().preferences.chopOrder, renames));
		expect(chopsPanelModel(store.getState(), "command", "").rows.map(row => [row.chop.name, row.favorite])).toEqual([["Dev server", true], ["Test", false]]);
		// Read again, the list no longer is the one the rename was saved against.
		await store.readChops("/work/timber");
		expect(chopsPanelModel(store.getState(), "command", "").rows.map(row => [row.chop.name, row.favorite])).toEqual([["Test", false], ["Dev server", false]]);
	});

	test("the last chop of the rest gone to Favorites leaves no empty heading", async () => {
		const { store } = await panelStore();
		await store.saveChopOrder({ "/work/timber": arrangement(["Test", "Dev server"], []) });
		store.toggleChopsPanel();
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain(">Favorites</h3>");
		expect(markup).not.toContain(">Other chops</h3>");
	});

	test("with no favorite, no headings show", async () => {
		const { store } = await panelStore();
		store.toggleChopsPanel();
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).not.toContain(">Favorites</h3>");
		expect(markup).not.toContain(">Other chops</h3>");
	});
});

describe("the chop order on disk", () => {
	let root: string;
	let primary: string;
	const fileText = `${JSON.stringify({ version: 1, chops: [{ name: "Test", kind: "command", text: "bun test" }, { name: "Lint", kind: "command", text: "bun run lint" }] }, null, "\t")}\n`;
	const repository = (path: string): Repository => ({ path, name: "sample", available: true, failure: null, setup: "repository", worktrees: [] });

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-chop-order-")));
		primary = join(root, "sample");
		git(root, "init", "--initial-branch=main", primary);
		mkdirSync(join(primary, ".timber"));
		writeFileSync(join(primary, ".timber", "chops.json"), fileText);
		git(primary, "add", "--all");
		git(primary, "commit", "-m", "Share chops");
	});

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	test("a starred and moved file chop is kept across a restart, for its repository only, and the file and repository do not change", async () => {
		const path = join(primary, ".timber", "chops.json");
		const bytes = readFileSync(path);
		const { mtimeMs } = statSync(path);
		const before = fingerprint(primary);
		const settingsFile = join(root, "settings.json");
		const preferences = createSavedPreferences(createSettingsHolder(settingsFile, () => {}));
		const chops = createChops({ findRepository: async folder => folder === primary ? repository(folder) : null, personal: async () => (await preferences.load()).chops });
		const listed = await chops.list({ repository: primary });
		if (listed.outcome !== "listed") throw new Error("not listed");
		const starred = toggleChopFavorite(listed.chops, NO_CHOP_ARRANGEMENT, "Lint");
		expect(await preferences.save({ chopOrder: { [primary]: starred } })).toMatchObject({ outcome: "saved" });

		// A new holder reads the file again, as the app does when it starts.
		const again = createSavedPreferences(createSettingsHolder(settingsFile, () => {}));
		const order = (await again.load()).chopOrder;
		expect(order).toEqual({ [primary]: { favorites: ["Lint"], rest: ["Test"] } });
		expect(names(arrangeChops(listed.chops, chopArrangementOf(order, primary)))).toEqual(["Lint", "Test"]);
		expect(chopArrangementOf(order, join(root, "other"))).toEqual(NO_CHOP_ARRANGEMENT);

		expect(readFileSync(path).equals(bytes)).toBe(true);
		expect(statSync(path).mtimeMs).toBe(mtimeMs);
		expect(fingerprint(primary)).toBe(before);
	});
});
