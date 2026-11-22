import { describe, expect, test } from "bun:test";
import {
	MAX_GROUP_DEPTH,
	MAX_GROUP_NAME,
	type RepositoryGroup,
	type RepositoryGroups,
	ancestorsOf,
	arrange,
	cleanGroupName,
	createGroupIn,
	deleteGroupIn,
	depthOf,
	descendantsOf,
	emptyGroups,
	groupChainOf,
	groupLabel,
	groupNameTaken,
	moveGroupAmong,
	moveGroupIn,
	placeInOrder,
	preorder,
	readGroups,
	renameGroupIn,
	shownOrder,
	stepAmongSiblings,
	stepGroupAmongSiblings,
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
		expect(groupNameTaken([{ id: "a", name: "Work" }], "work", null)).toBe(true);
		expect(groupNameTaken([{ id: "a", name: "Work" }], "work", null, "a")).toBe(false);
		expect(groupNameTaken([{ id: "a", name: "Work" }], "Home", null)).toBe(false);
		expect(groupNameTaken([], "Work", null)).toBe(false);
	});

	test("only counts groups with the same parent", () => {
		const nested = [{ id: "a", name: "Work" }, { id: "b", name: "Misc", parent: "a" }];
		expect(groupNameTaken(nested, "misc", null)).toBe(false);
		expect(groupNameTaken(nested, "misc", "a")).toBe(true);
		expect(groupNameTaken(nested, "work", "a")).toBe(false);
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

// Work holds Client, which holds Deep; Home is at the top level after Work, and Spare is inside Work after Client.
const tree: RepositoryGroup[] = [
	{ id: "work", name: "Work" },
	{ id: "client", name: "Client", parent: "work" },
	{ id: "home", name: "Home" },
	{ id: "deep", name: "Deep", parent: "client" },
	{ id: "spare", name: "Spare", parent: "work" },
];
const ids = (groups: readonly RepositoryGroup[]) => groups.map(group => group.id);
const siblings = (groups: readonly RepositoryGroup[], parent: string | null) => ids(groups.filter(group => (group.parent ?? null) === parent));

describe("the shape of nested groups", () => {
	test("ancestors, depth, descendants, the order shown, and labels", () => {
		expect(ids(ancestorsOf(tree, "deep"))).toEqual(["client", "work"]);
		expect(ancestorsOf(tree, "work")).toEqual([]);
		expect(ancestorsOf(tree, "gone")).toEqual([]);
		expect([depthOf(tree, "work"), depthOf(tree, "client"), depthOf(tree, "deep")]).toEqual([1, 2, 3]);
		expect(MAX_GROUP_DEPTH).toBe(3);
		expect(descendantsOf(tree, "work")).toEqual(["client", "deep", "spare"]);
		expect(ids(preorder(tree))).toEqual(["work", "client", "deep", "spare", "home"]);
		expect(groupLabel(tree, "deep")).toBe("Work \u203a Client \u203a Deep");
		expect(groupLabel(tree, "home")).toBe("Home");
		expect(groupChainOf({ groups: tree, membership: { "/p1": "deep" } }, "/p1")).toEqual(["deep", "client", "work"]);
		expect(groupChainOf({ groups: tree, membership: {} }, "/p1")).toEqual([]);
	});
});

describe("readGroups with parents", () => {
	test("keeps a parent that names another group", () => {
		expect(readGroups(tree)).toEqual(tree);
	});

	test("drops a parent that is not text, names itself, or names no group", () => {
		expect(readGroups([{ id: "a", name: "A", parent: 3 }, { id: "b", name: "B", parent: "b" }, { id: "c", name: "C", parent: "gone" }, { id: "d", name: "D", parent: "" }]))
			.toEqual([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }, { id: "d", name: "D" }]);
	});

	test("drops the parents of the groups on a loop, and keeps those of groups hanging under it", () => {
		expect(readGroups([{ id: "a", name: "A", parent: "b" }, { id: "b", name: "B", parent: "a" }, { id: "c", name: "C", parent: "a" }]))
			.toEqual([{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C", parent: "a" }]);
	});

	test("a group deeper than the deepest level goes to the top level, with its subgroups", () => {
		const read = readGroups([
			{ id: "a", name: "A" },
			{ id: "b", name: "B", parent: "a" },
			{ id: "c", name: "C", parent: "b" },
			{ id: "d", name: "D", parent: "c" },
			{ id: "e", name: "E", parent: "d" },
		]);
		expect(read).toEqual([{ id: "a", name: "A" }, { id: "b", name: "B", parent: "a" }, { id: "c", name: "C", parent: "b" }, { id: "d", name: "D" }, { id: "e", name: "E", parent: "d" }]);
	});
});

describe("arrange and shownOrder with nested groups", () => {
	const nested: RepositoryGroups = { groups: tree, membership: { "/p1": "deep", "/p2": "work", "/p3": "client", "/p4": "home" } };

	test("a group holds its own members, then its subgroups", () => {
		const arranged = arrange(items, nested);
		const shape = (group: (typeof arranged.grouped)[number]): unknown => ({ id: group.group.id, items: group.items.map(item => item.path), children: group.children.map(shape) });
		expect(arranged.grouped.map(shape)).toEqual([
			{ id: "work", items: ["/p2"], children: [
				{ id: "client", items: ["/p3"], children: [{ id: "deep", items: ["/p1"], children: [] }] },
				{ id: "spare", items: [], children: [] },
			] },
			{ id: "home", items: ["/p4"], children: [] },
		]);
		expect(shownOrder(paths, nested)).toEqual(["/p2", "/p3", "/p1", "/p4"]);
	});

	test("an empty subgroup is placed into after the members of the groups shown before it", () => {
		expect(placeInOrder(paths, nested, "/p4", "spare", null)).toEqual(["/p2", "/p3", "/p1", "/p4"]);
		const empty: RepositoryGroups = { groups: tree, membership: { "/p1": "work", "/p2": "home" } };
		// Shown: loose /p3 /p4, Work /p1, Home /p2. Deep shows after Work's own members.
		expect(placeInOrder(paths, empty, "/p3", "deep", null)).toEqual(["/p4", "/p1", "/p3", "/p2"]);
	});
});

describe("changing nested groups", () => {
	const list = { groups: tree, repositories: [{ path: "/p1", group: "deep" }, { path: "/p2", group: "client" }, { path: "/p3", group: "work" }, { path: "/p4" }] };

	test("a subgroup is made at the end of its parent's, never past the deepest level, and named uniquely among its siblings", () => {
		const made = createGroupIn(list, "new", "Home", undefined, "work");
		expect(made.outcome === "changed" && made.next.groups.at(-1)).toEqual({ id: "new", name: "Home", parent: "work" });
		expect(createGroupIn(list, "new", "spare", undefined, "work")).toEqual({ outcome: "name-taken", name: "Spare" });
		expect(createGroupIn(list, "new", "Deeper", undefined, "deep")).toEqual({ outcome: "too-deep" });
		expect(createGroupIn(list, "new", "Lost", undefined, "gone")).toEqual({ outcome: "unchanged" });
		const placed = createGroupIn(list, "new", "Other", "/p4", "client");
		expect(placed.outcome === "changed" && placed.next.repositories.find(entry => entry.path === "/p4")).toEqual({ path: "/p4", group: "new" });
	});

	test("a group keeps its own name beside a sibling that has it after a delete", () => {
		const lifted = deleteGroupIn({ groups: [{ id: "a", name: "A" }, { id: "b", name: "Play", parent: "a" }, { id: "c", name: "Play" }], repositories: [] }, "a");
		if (lifted.outcome !== "changed") throw new Error(lifted.outcome);
		expect(renameGroupIn(lifted.next, "c", "  Play ")).toEqual({ outcome: "unchanged" });
		expect(renameGroupIn(lifted.next, "c", "play")).toEqual({ outcome: "name-taken", name: "Play" });
		expect(renameGroupIn(lifted.next, "c", "Games")).toMatchObject({ outcome: "changed" });
	});

	test("a rename checks the names of the siblings only, and keeps the parent", () => {
		expect(renameGroupIn(list, "deep", "Home")).toMatchObject({ outcome: "changed" });
		const renamed = renameGroupIn(list, "deep", "Inner");
		expect(renamed.outcome === "changed" && renamed.next.groups.find(group => group.id === "deep")).toEqual({ id: "deep", name: "Inner", parent: "client" });
		expect(renameGroupIn(list, "spare", "client")).toEqual({ outcome: "name-taken", name: "Client" });
	});

	test("deleting a group moves its repositories and subgroups into its parent, in its place", () => {
		const deleted = deleteGroupIn(list, "client");
		if (deleted.outcome !== "changed") throw new Error(deleted.outcome);
		expect(siblings(deleted.next.groups, "work")).toEqual(["deep", "spare"]);
		expect(deleted.next.groups.find(group => group.id === "deep")).toEqual({ id: "deep", name: "Deep", parent: "work" });
		expect(deleted.next.repositories).toEqual([{ path: "/p1", group: "deep" }, { path: "/p2", group: "work" }, { path: "/p3", group: "work" }, { path: "/p4" }]);
	});

	test("deleting a top-level group lifts its subgroups to the top level in its place, and its repositories out", () => {
		const deleted = deleteGroupIn(list, "work");
		if (deleted.outcome !== "changed") throw new Error(deleted.outcome);
		expect(siblings(deleted.next.groups, null)).toEqual(["client", "spare", "home"]);
		expect(deleted.next.repositories).toEqual([{ path: "/p1", group: "deep" }, { path: "/p2", group: "client" }, { path: "/p3" }, { path: "/p4" }]);
		// A lifted group may share a name with a new sibling: deleting never refuses.
		const clash = deleteGroupIn({ groups: [{ id: "a", name: "A" }, { id: "b", name: "Misc", parent: "a" }, { id: "c", name: "Misc" }], repositories: [] }, "a");
		expect(clash.outcome === "changed" && clash.next.groups).toEqual([{ id: "b", name: "Misc" }, { id: "c", name: "Misc" }]);
	});

	test("a group moves inside another, out to the top level, and among its siblings", () => {
		const into = moveGroupAmong(tree, "home", "work", "spare");
		expect(into.outcome === "changed" && siblings(into.groups, "work")).toEqual(["client", "home", "spare"]);
		const out = moveGroupAmong(tree, "client", null, "work");
		expect(out.outcome === "changed" && siblings(out.groups, null)).toEqual(["client", "work", "home"]);
		expect(out.outcome === "changed" && out.groups.find(group => group.id === "deep")).toEqual({ id: "deep", name: "Deep", parent: "client" });
		const end = moveGroupAmong(tree, "work", null, null);
		expect(end.outcome === "changed" && siblings(end.groups, null)).toEqual(["home", "work"]);
	});

	test("a move into itself, one of its subgroups, past the deepest level, or beside its name is refused", () => {
		expect(moveGroupAmong(tree, "work", "work", null)).toEqual({ outcome: "inside-itself" });
		expect(moveGroupAmong(tree, "work", "deep", null)).toEqual({ outcome: "inside-itself" });
		expect(moveGroupAmong(tree, "home", "deep", null)).toEqual({ outcome: "too-deep" });
		// Client holds Deep, so inside Spare it would reach a fourth level.
		expect(moveGroupAmong(tree, "client", "spare", null)).toEqual({ outcome: "too-deep" });
		expect(moveGroupAmong([...tree, { id: "c2", name: "client" }], "c2", "work", null)).toEqual({ outcome: "name-taken", name: "Client" });
	});

	test("a move to where it is, or of an unknown group or into an unknown parent, changes nothing", () => {
		expect(moveGroupAmong(tree, "spare", "work", null)).toEqual({ outcome: "unchanged" });
		expect(moveGroupAmong(tree, "client", "work", "spare")).toEqual({ outcome: "unchanged" });
		expect(moveGroupAmong(tree, "deep", "client", null)).toEqual({ outcome: "unchanged" });
		expect(moveGroupAmong(tree, "gone", null, null)).toEqual({ outcome: "unchanged" });
		expect(moveGroupAmong(tree, "work", null, "work")).toEqual({ outcome: "unchanged" });
		expect(moveGroupAmong(tree, "home", "gone", null)).toEqual({ outcome: "unchanged" });
		expect(moveGroupIn(list, "home", "gone", null)).toEqual({ outcome: "unchanged" });
	});

	test("a step moves a group one place among its siblings, and not past either end", () => {
		expect(stepGroupAmongSiblings(tree, "client", 1)).toEqual({ parent: "work", before: null });
		expect(stepGroupAmongSiblings(tree, "spare", -1)).toEqual({ parent: "work", before: "client" });
		expect(stepGroupAmongSiblings(tree, "client", -1)).toBeNull();
		expect(stepGroupAmongSiblings(tree, "spare", 1)).toBeNull();
		expect(stepGroupAmongSiblings(tree, "work", 1)).toEqual({ parent: null, before: null });
		expect(stepGroupAmongSiblings(tree, "deep", 1)).toBeNull();
		expect(stepGroupAmongSiblings(tree, "gone", 1)).toBeNull();
	});
});
