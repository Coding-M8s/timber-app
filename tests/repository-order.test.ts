import { describe, expect, test } from "bun:test";
import { DRAG_THRESHOLD, type DropSlot, type GroupDropSlot, dropPlace, groupDropPlace, moveStep } from "../src/mainview/repository-drag";
import { applyOrder, moveInOrder, sameOrder } from "../src/shared/repository-order";

const items = (...paths: string[]) => paths.map(path => ({ path }));

describe("moveInOrder", () => {
	test("moves a path to an index counted without it", () => {
		expect(moveInOrder(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
		expect(moveInOrder(["a", "b", "c"], "a", 2)).toEqual(["b", "c", "a"]);
		expect(moveInOrder(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
		expect(moveInOrder(["a", "b", "c"], "b", 1)).toEqual(["a", "b", "c"]);
	});

	test("clamps an index past either end, and leaves the order alone for an unknown path", () => {
		expect(moveInOrder(["a", "b", "c"], "b", -4)).toEqual(["b", "a", "c"]);
		expect(moveInOrder(["a", "b", "c"], "b", 40)).toEqual(["a", "c", "b"]);
		expect(moveInOrder(["a", "b"], "z", 0)).toEqual(["a", "b"]);
	});

	test("does not change the order it was given", () => {
		const order = ["a", "b"];
		moveInOrder(order, "b", 0);
		expect(order).toEqual(["a", "b"]);
	});
});

describe("applyOrder", () => {
	test("sorts the items as the order names them", () => {
		expect(applyOrder(items("a", "b", "c"), ["c", "a", "b"])).toEqual(items("c", "a", "b"));
	});

	test("keeps items the order leaves out after the named ones, in their own order", () => {
		expect(applyOrder(items("a", "b", "c", "d"), ["d", "b"])).toEqual(items("d", "b", "a", "c"));
		expect(applyOrder(items("a", "b"), [])).toEqual(items("a", "b"));
	});

	test("skips paths that name no item, and a path named twice counts where it first appears", () => {
		expect(applyOrder(items("a", "b"), ["x", "b", "y", "a", "b"])).toEqual(items("b", "a"));
	});

	test("keeps the items themselves", () => {
		const one = { path: "a", name: "one" };
		const two = { path: "b", name: "two" };
		const sorted = applyOrder([one, two], ["b", "a"]);
		expect(sorted[0]).toBe(two);
		expect(sorted[1]).toBe(one);
	});
});

test("sameOrder compares paths in order", () => {
	expect(sameOrder(items("a", "b"), items("a", "b"))).toBe(true);
	expect(sameOrder(items("a", "b"), items("b", "a"))).toBe(false);
	expect(sameOrder(items("a"), items("a", "b"))).toBe(false);
});

describe("groupDropPlace", () => {
	// Work at 0-40 with something under it, Client at 100-140 folded, Personal at 200-240 empty.
	const slots: GroupDropSlot[] = [
		{ id: "work", top: 0, bottom: 40, expanded: true },
		{ id: "client", top: 100, bottom: 140, expanded: false },
		{ id: "personal", top: 200, bottom: 240, expanded: false },
	];

	test("the top quarter of a header, or the gap above it, lands before that group", () => {
		expect(groupDropPlace(slots, -5)).toEqual({ kind: "before", id: "work" });
		expect(groupDropPlace(slots, 9)).toEqual({ kind: "before", id: "work" });
		expect(groupDropPlace(slots, 60)).toEqual({ kind: "before", id: "client" });
		expect(groupDropPlace(slots, 109)).toEqual({ kind: "before", id: "client" });
	});

	test("the middle of a header goes inside that group", () => {
		expect(groupDropPlace(slots, 10)).toEqual({ kind: "into", id: "work" });
		expect(groupDropPlace(slots, 20)).toEqual({ kind: "into", id: "work" });
		expect(groupDropPlace(slots, 130)).toEqual({ kind: "into", id: "client" });
	});

	test("the bottom quarter lands after a group with nothing under it, and inside one with something", () => {
		expect(groupDropPlace(slots, 135)).toEqual({ kind: "after", id: "client" });
		expect(groupDropPlace(slots, 240)).toEqual({ kind: "after", id: "personal" });
		expect(groupDropPlace(slots, 35)).toEqual({ kind: "into", id: "work" });
	});

	test("below every header is the end of the top level", () => {
		expect(groupDropPlace(slots, 500)).toEqual({ kind: "end" });
		expect(groupDropPlace([], 20)).toEqual({ kind: "end" });
	});

	test("a drag needs a few pixels of movement", () => {
		expect(DRAG_THRESHOLD).toBeGreaterThan(0);
	});
});

describe("moveStep", () => {
	const key = (name: string, extra: Partial<{ altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }> = {}) =>
		({ key: name, altKey: true, ctrlKey: false, metaKey: false, shiftKey: false, ...extra });

	test("Alt+Up moves up and Alt+Down moves down", () => {
		expect(moveStep(key("ArrowUp"))).toBe(-1);
		expect(moveStep(key("ArrowDown"))).toBe(1);
	});

	test("any other key or modifier moves nothing", () => {
		expect(moveStep(key("ArrowUp", { altKey: false }))).toBe(0);
		expect(moveStep(key("ArrowDown", { shiftKey: true }))).toBe(0);
		expect(moveStep(key("ArrowDown", { ctrlKey: true }))).toBe(0);
		expect(moveStep(key("ArrowUp", { metaKey: true }))).toBe(0);
		expect(moveStep(key("ArrowLeft"))).toBe(0);
		expect(moveStep(key("Enter"))).toBe(0);
	});
});

describe("dropPlace", () => {
	// Shown top to bottom: loose a and b, then Work (open) with c and d, then Home (folded), then Spare (open, empty).
	const slots: DropSlot[] = [
		{ kind: "repository", path: "/a", group: null, middle: 10 },
		{ kind: "repository", path: "/b", group: null, middle: 30 },
		{ kind: "group", id: "work", top: 40, bottom: 60, open: true },
		{ kind: "repository", path: "/c", group: "work", middle: 70 },
		{ kind: "repository", path: "/d", group: "work", middle: 90 },
		{ kind: "group", id: "home", top: 110, bottom: 130, open: false },
		{ kind: "group", id: "spare", top: 140, bottom: 160, open: true },
	];

	test("above the middle of a repository lands before it, in its group", () => {
		expect(dropPlace(slots, 5)).toEqual({ group: null, before: "/a" });
		expect(dropPlace(slots, 25)).toEqual({ group: null, before: "/b" });
		expect(dropPlace(slots, 65)).toEqual({ group: "work", before: "/c" });
		expect(dropPlace(slots, 80)).toEqual({ group: "work", before: "/d" });
	});

	test("below the last loose repository and above the first group lands at the end of the loose ones", () => {
		expect(dropPlace(slots, 35)).toEqual({ group: null, before: null });
	});

	test("over a group's header lands at the end of that group", () => {
		expect(dropPlace(slots, 40)).toEqual({ group: "work", before: null });
		expect(dropPlace(slots, 55)).toEqual({ group: "work", before: null });
	});

	test("below the last member of an open group, above the next group, lands at the end of that group", () => {
		expect(dropPlace(slots, 100)).toEqual({ group: "work", before: null });
	});

	test("over a folded group, or an empty one, lands at the end of it", () => {
		expect(dropPlace(slots, 120)).toEqual({ group: "home", before: null });
		expect(dropPlace(slots, 150)).toEqual({ group: "spare", before: null });
	});

	test("above everything lands first, and below everything at the end of the last group", () => {
		expect(dropPlace(slots, -100)).toEqual({ group: null, before: "/a" });
		expect(dropPlace(slots, 999)).toEqual({ group: "spare", before: null });
	});

	test("with a single group and no loose repositories, above it is loose, and over it is in it", () => {
		const single: DropSlot[] = [{ kind: "group", id: "work", top: 40, bottom: 60, open: true }];
		expect(dropPlace(single, 10)).toEqual({ group: null, before: null });
		expect(dropPlace(single, 50)).toEqual({ group: "work", before: null });
		expect(dropPlace(single, 200)).toEqual({ group: "work", before: null });
	});

	test("with nothing else shown, lands loose", () => {
		expect(dropPlace([], 50)).toEqual({ group: null, before: null });
	});
});
