import { describe, expect, test } from "bun:test";
import { DELETE_GROUP_HINT, GROUP_TOO_DEEP, REMOVE_REPOSITORY_HINT } from "../src/mainview/format";
import { groupMenuItems, repositoryMenuItems } from "../src/mainview/repository-menu-format";

const personal = { id: "g1", name: "Personal" };
const work = { id: "g2", name: "Work" };
const labels = (items: { label: string }[]) => items.map(item => item.label);

describe("repositoryMenuItems", () => {
	test("a loose repository can be added to each group", () => {
		const items = repositoryMenuItems({ groups: [personal, work], membership: {} }, "/work/timber");
		expect(labels(items)).toEqual(["Add to Personal", "Add to Work", "New group...", "Icon...", "Remove from the list"]);
		expect(items.map(item => item.choice)).toEqual([
			{ kind: "place", group: "g1" },
			{ kind: "place", group: "g2" },
			{ kind: "new-group" },
			{ kind: "icon" },
			{ kind: "remove" },
		]);
		expect(items.at(-1)!.description).toBe(REMOVE_REPOSITORY_HINT);
		expect(new Set(items.map(item => item.id)).size).toBe(items.length);
	});

	test("a grouped repository can move to another group, or be taken out", () => {
		const items = repositoryMenuItems({ groups: [personal, work], membership: { "/work/timber": "g1" } }, "/work/timber");
		expect(labels(items)).toEqual(["Move to Work", "New group...", "Take out of Personal", "Icon...", "Remove from the list"]);
		expect(items.map(item => item.choice)).toEqual([{ kind: "place", group: "g2" }, { kind: "new-group" }, { kind: "take-out" }, { kind: "icon" }, { kind: "remove" }]);
	});

	test("Clean up merged comes first when the sidebar gives it, disabled with its reason when there is nothing to clean up", () => {
		const cleanUp = { id: "clean-up-merged" as const, label: "Clean up merged", disabled: true, note: "No merged worktrees.", description: null };
		const items = repositoryMenuItems({ groups: [work], membership: {} }, "/work/timber", cleanUp);
		expect(labels(items)).toEqual(["Clean up merged", "Add to Work", "New group...", "Icon...", "Remove from the list"]);
		expect(items[0]).toEqual({ id: "clean-up-merged", label: "Clean up merged", description: null, disabled: true, note: "No merged worktrees.", choice: { kind: "clean-up-merged" } });
		expect(repositoryMenuItems({ groups: [], membership: {} }, "/work/timber", { ...cleanUp, disabled: false, note: null })[0]!.disabled).toBe(false);
	});

	test("with no groups, offers a new group and removing", () => {
		expect(labels(repositoryMenuItems({ groups: [], membership: {} }, "/work/timber"))).toEqual(["New group...", "Icon...", "Remove from the list"]);
	});

	test("a membership that names no group counts as loose", () => {
		expect(labels(repositoryMenuItems({ groups: [work], membership: { "/work/timber": "gone" } }, "/work/timber"))).toEqual(["Add to Work", "New group...", "Icon...", "Remove from the list"]);
	});
});

describe("groupMenuItems", () => {
	test("rename, a new subgroup, and delete, which says the repositories stay", () => {
		const items = groupMenuItems([work], "g2");
		expect(labels(items)).toEqual(["Rename", "Icon...", "New subgroup...", "Delete group"]);
		expect(items.map(item => item.choice)).toEqual([{ kind: "rename" }, { kind: "icon" }, { kind: "new-subgroup" }, { kind: "delete" }]);
		expect(items.at(-1)!.description).toBe(DELETE_GROUP_HINT);
	});

	// Work holds Client, which holds Deep. Personal and Misc are at the top level, and Client holds a Misc too.
	const nested = [
		personal,
		work,
		{ id: "client", name: "Client", parent: "g2" },
		{ id: "deep", name: "Deep", parent: "client" },
		{ id: "misc", name: "Misc" },
		{ id: "inner-misc", name: "Misc", parent: "client" },
	];

	test("moves into each other group, named with the groups around it, but not into itself, its subgroups, or where it is", () => {
		expect(labels(groupMenuItems(nested, "g1"))).toEqual([
			"Rename", "Icon...", "New subgroup...", "Move down", "Move into Work", "Move into Work \u203a Client", "Move into Work \u203a Client \u203a Deep", "Move into Work \u203a Client \u203a Misc", "Move into Misc", "Delete group",
		]);
		expect(labels(groupMenuItems(nested, "g2"))).toEqual(["Rename", "Icon...", "New subgroup...", "Move up", "Move down", "Move into Personal", "Move into Misc", "Delete group"]);
		expect(labels(groupMenuItems(nested, "client"))).toEqual([
			"Rename", "Icon...", "New subgroup...", "Move into Personal", "Move into Misc", "Move to the top level", "Delete group",
		]);
		expect(groupMenuItems(nested, "g2").filter(item => item.choice.kind === "step").map(item => item.choice)).toEqual([{ kind: "step", step: -1 }, { kind: "step", step: 1 }]);
		expect(groupMenuItems(nested, "client").find(item => item.id === "move-top")!.choice).toEqual({ kind: "move", parent: null });
	});

	test("a place too deep, or beside a group with its name, shows disabled with the reason", () => {
		const items = groupMenuItems(nested, "g1");
		expect(items.find(item => item.label === "Move into Work \u203a Client \u203a Deep")).toMatchObject({ disabled: true, note: GROUP_TOO_DEEP });
		expect(items.find(item => item.label === "Move into Work \u203a Client")).not.toHaveProperty("disabled");
		// Client holds Deep, so it fits only one level under the top.
		expect(groupMenuItems(nested, "client").find(item => item.label === "Move into Personal")).not.toHaveProperty("disabled");
		const misc = groupMenuItems(nested, "misc");
		expect(misc.find(item => item.label === "Move into Work \u203a Client")).toMatchObject({ disabled: true, note: "There is already a group named Misc there." });
		expect(groupMenuItems(nested, "inner-misc").find(item => item.id === "move-top")).toMatchObject({ disabled: true, note: "There is already a group named Misc there." });
	});

	test("New subgroup... is disabled at the deepest level", () => {
		expect(groupMenuItems(nested, "deep").find(item => item.id === "new-subgroup")).toMatchObject({ disabled: true, note: GROUP_TOO_DEEP });
		expect(groupMenuItems(nested, "client").find(item => item.id === "new-subgroup")).not.toHaveProperty("disabled");
	});
});

describe("repositoryMenuItems with nested groups", () => {
	test("names each group with the groups around it, in the order shown", () => {
		const nested = { groups: [work, personal, { id: "client", name: "Client", parent: "g2" }], membership: {} };
		expect(labels(repositoryMenuItems(nested, "/work/timber"))).toEqual(["Add to Work", "Add to Work \u203a Client", "Add to Personal", "New group...", "Icon...", "Remove from the list"]);
	});
});
