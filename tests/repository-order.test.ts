import { describe, expect, test } from "bun:test";
import { DRAG_THRESHOLD, dropIndex, moveStep } from "../src/mainview/repository-drag";
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

describe("dropIndex", () => {
	test("counts the groups whose middle is above the pointer", () => {
		const middles = [10, 50, 90];
		expect(dropIndex(middles, 0)).toBe(0);
		expect(dropIndex(middles, 10)).toBe(0);
		expect(dropIndex(middles, 11)).toBe(1);
		expect(dropIndex(middles, 70)).toBe(2);
		expect(dropIndex(middles, 500)).toBe(3);
		expect(dropIndex([], 20)).toBe(0);
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
