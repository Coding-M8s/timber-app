import { describe, expect, test } from "bun:test";
import { DELETE_GROUP_HINT, REMOVE_REPOSITORY_HINT } from "../src/mainview/format";
import { groupMenuItems, repositoryMenuItems } from "../src/mainview/repository-menu-format";

const personal = { id: "g1", name: "Personal" };
const work = { id: "g2", name: "Work" };
const labels = (items: { label: string }[]) => items.map(item => item.label);

describe("repositoryMenuItems", () => {
	test("a loose repository can be added to each group", () => {
		const items = repositoryMenuItems({ groups: [personal, work], membership: {} }, "/work/timber");
		expect(labels(items)).toEqual(["Add to Personal", "Add to Work", "New group...", "Remove from the list"]);
		expect(items.map(item => item.choice)).toEqual([
			{ kind: "place", group: "g1" },
			{ kind: "place", group: "g2" },
			{ kind: "new-group" },
			{ kind: "remove" },
		]);
		expect(items[3]!.title).toBe(REMOVE_REPOSITORY_HINT);
		expect(new Set(items.map(item => item.id)).size).toBe(items.length);
	});

	test("a grouped repository can move to another group, or be taken out", () => {
		const items = repositoryMenuItems({ groups: [personal, work], membership: { "/work/timber": "g1" } }, "/work/timber");
		expect(labels(items)).toEqual(["Move to Work", "New group...", "Take out of Personal", "Remove from the list"]);
		expect(items.map(item => item.choice)).toEqual([{ kind: "place", group: "g2" }, { kind: "new-group" }, { kind: "take-out" }, { kind: "remove" }]);
	});

	test("Clean up merged comes first when the sidebar gives it, disabled with its reason when there is nothing to clean up", () => {
		const cleanUp = { id: "clean-up-merged" as const, label: "Clean up merged", disabled: true, note: "No merged worktrees.", title: "No merged worktrees." };
		const items = repositoryMenuItems({ groups: [work], membership: {} }, "/work/timber", cleanUp);
		expect(labels(items)).toEqual(["Clean up merged", "Add to Work", "New group...", "Remove from the list"]);
		expect(items[0]).toEqual({ id: "clean-up-merged", label: "Clean up merged", title: "No merged worktrees.", disabled: true, note: "No merged worktrees.", choice: { kind: "clean-up-merged" } });
		expect(repositoryMenuItems({ groups: [], membership: {} }, "/work/timber", { ...cleanUp, disabled: false, note: null })[0]!.disabled).toBe(false);
	});

	test("with no groups, offers a new group and removing", () => {
		expect(labels(repositoryMenuItems({ groups: [], membership: {} }, "/work/timber"))).toEqual(["New group...", "Remove from the list"]);
	});

	test("a membership that names no group counts as loose", () => {
		expect(labels(repositoryMenuItems({ groups: [work], membership: { "/work/timber": "gone" } }, "/work/timber"))).toEqual(["Add to Work", "New group...", "Remove from the list"]);
	});
});

describe("groupMenuItems", () => {
	test("rename and delete, which says the repositories stay", () => {
		const items = groupMenuItems();
		expect(labels(items)).toEqual(["Rename", "Delete group"]);
		expect(items.map(item => item.choice)).toEqual([{ kind: "rename" }, { kind: "delete" }]);
		expect(items[1]!.title).toBe(DELETE_GROUP_HINT);
	});
});
