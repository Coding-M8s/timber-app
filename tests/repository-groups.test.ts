import { describe, expect, test } from "bun:test";
import {
	MAX_GROUP_NAME,
	type RepositoryGroups,
	arrange,
	cleanGroupName,
	emptyGroups,
	groupNameTaken,
	placeInOrder,
	readGroups,
	shownOrder,
	stepAmongSiblings,
} from "../src/shared/repository-groups";

const personal = { id: "g1", name: "Personal" };
const work = { id: "g2", name: "Work" };
const paths = ["/p1", "/p2", "/p3", "/p4"];
const groups: RepositoryGroups = { groups: [personal, work], membership: { "/p1": "g1", "/p3": "g2", "/p4": "gone" } };
const items = paths.map(path => ({ path }));

describe("cleanGroupName", () => {
	test("trims, makes inner whitespace one space, and cuts a long name", () => {
		expect(cleanGroupName("  Work   stuff ")).toBe("Work stuff");
		expect(cleanGroupName("Work\t\nstuff")).toBe("Work stuff");
		expect(cleanGroupName("   ")).toBeNull();
		expect(cleanGroupName("")).toBeNull();
		const long = cleanGroupName("x".repeat(60));
		expect(long).toHaveLength(MAX_GROUP_NAME);
		expect(MAX_GROUP_NAME).toBe(40);
	});

	test("does not end a cut name with a space", () => {
		expect(cleanGroupName(`${"x".repeat(39)} yz`)).toBe("x".repeat(39));
	});
});

describe("groupNameTaken", () => {
	test("matches ignoring case, except the named group", () => {
		expect(groupNameTaken([{ id: "a", name: "Work" }], "work")).toBe(true);
		expect(groupNameTaken([{ id: "a", name: "Work" }], "work", "a")).toBe(false);
		expect(groupNameTaken([{ id: "a", name: "Work" }], "Home")).toBe(false);
		expect(groupNameTaken([], "Work")).toBe(false);
	});
});

describe("readGroups", () => {
	test("never fails, and skips anything that is not a group or repeats an id", () => {
		expect(readGroups("x")).toEqual([]);
		expect(readGroups(undefined)).toEqual([]);
		expect(readGroups({ id: "a", name: "Work" })).toEqual([]);
		expect(readGroups([{ id: "a", name: "Work" }, { id: "a", name: "Dup" }, { id: "", name: "x" }, { id: "b", name: 7 }, { id: "c", name: "  " }, null, "a"])).toEqual([{ id: "a", name: "Work" }]);
	});

	test("cleans the names it keeps", () => {
		expect(readGroups([{ id: "a", name: "  Work   stuff " }])).toEqual([{ id: "a", name: "Work stuff" }]);
	});
});

describe("emptyGroups", () => {
	test("has no groups and no members", () => {
		expect(emptyGroups()).toEqual({ groups: [], membership: {} });
	});
});

describe("arrange and shownOrder", () => {
	test("put loose items first, then each group with its members, in order", () => {
		const arranged = arrange(items, groups);
		expect(arranged.loose.map(item => item.path)).toEqual(["/p2", "/p4"]);
		expect(arranged.grouped.map(({ group, items }) => ({ group, items: items.map(item => item.path) }))).toEqual([
			{ group: personal, items: ["/p1"] },
			{ group: work, items: ["/p3"] },
		]);
		expect(shownOrder(paths, groups)).toEqual(["/p2", "/p4", "/p1", "/p3"]);
	});

	test("show an empty group with no items", () => {
		const arranged = arrange(items, { groups: [personal, work, { id: "g3", name: "Empty" }], membership: {} });
		expect(arranged.loose).toHaveLength(4);
		expect(arranged.grouped.map(group => group.items.length)).toEqual([0, 0, 0]);
	});

	test("with no groups, everything is loose in the given order", () => {
		expect(arrange(items, emptyGroups())).toEqual({ loose: items, grouped: [] });
		expect(shownOrder(paths, emptyGroups())).toEqual(paths);
	});
});

describe("placeInOrder", () => {
	test("puts a loose path at the end of a group", () => {
		expect(placeInOrder(paths, groups, "/p2", "g1", null)).toEqual(["/p4", "/p1", "/p2", "/p3"]);
	});

	test("takes a path out of a group, before a named loose path", () => {
		expect(placeInOrder(paths, groups, "/p3", null, "/p4")).toEqual(["/p2", "/p3", "/p4", "/p1"]);
	});

	test("moves within a group before a sibling", () => {
		const two = { ...groups, membership: { ...groups.membership, "/p2": "g1" } };
		// Shown: loose /p4, Personal /p1 /p2, Work /p3.
		expect(placeInOrder(paths, two, "/p2", "g1", "/p1")).toEqual(["/p4", "/p2", "/p1", "/p3"]);
	});

	test("puts a path in an empty group", () => {
		const three = { groups: [personal, work, { id: "g3", name: "Empty" }], membership: groups.membership };
		expect(placeInOrder(paths, three, "/p2", "g3", null)).toEqual(["/p4", "/p1", "/p3", "/p2"]);
	});

	test("a `before` that is not in the destination means the end of it", () => {
		expect(placeInOrder(paths, groups, "/p2", "g1", "/p3")).toEqual(["/p4", "/p1", "/p2", "/p3"]);
		expect(placeInOrder(paths, groups, "/p2", "g1", "/p2")).toEqual(["/p4", "/p1", "/p2", "/p3"]);
	});

	test("answers null for a path that is not listed", () => {
		expect(placeInOrder(paths, groups, "/other", "g1", null)).toBeNull();
	});
});

describe("stepAmongSiblings", () => {
	const grouped = { groups: [personal], membership: { "/p2": "g1", "/p3": "g1" } };
	// Shown: loose /p1 /p4, Personal /p2 /p3.

	test("moves within the loose ones only", () => {
		expect(stepAmongSiblings(paths, grouped, "/p1", 1)).toEqual(["/p4", "/p1", "/p2", "/p3"]);
		expect(stepAmongSiblings(paths, grouped, "/p4", 1)).toBeNull();
	});

	test("moves within a group only", () => {
		expect(stepAmongSiblings(paths, grouped, "/p3", -1)).toEqual(["/p1", "/p4", "/p3", "/p2"]);
		expect(stepAmongSiblings(paths, grouped, "/p2", -1)).toBeNull();
	});

	test("answers null at the first and the last sibling, and for a path not listed", () => {
		expect(stepAmongSiblings(paths, grouped, "/p1", -1)).toBeNull();
		expect(stepAmongSiblings(paths, grouped, "/p3", 1)).toBeNull();
		expect(stepAmongSiblings(paths, grouped, "/other", 1)).toBeNull();
	});

	test("with no groups, it is one step in the whole list", () => {
		expect(stepAmongSiblings(paths, emptyGroups(), "/p2", 1)).toEqual(["/p1", "/p3", "/p2", "/p4"]);
	});
});
