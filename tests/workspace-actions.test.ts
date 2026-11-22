import { describe, expect, test } from "bun:test";
import { BEING_REMOVED_REASON, DONE_CONTROL_TITLE, DONE_PRIMARY_NOTE } from "../src/mainview/done-format";
import { REBASE_CONTROL_TITLE, REBASE_FOLDER_MISSING } from "../src/mainview/rebase-format";
import {
	describeWorkspaceMenu, describeWorkspaceMore, workspaceKindLabel, workspaceMenuChoice, workspaceMenuItems, workspaceMoreKeyOpens,
} from "../src/mainview/workspace-actions-format";
import { sampleRepositories } from "../src/mainview/engine/mock";
import type { Worktree } from "../src/shared/model";

const TIMBER = "/work/timber";
const worktrees = sampleRepositories.flatMap(repository => repository.worktrees);
const primary = worktrees.find(worktree => worktree.primary)!;
const linked = worktrees.find(worktree => !worktree.primary && worktree.pathExists)!;
const missing: Worktree = { ...linked, pathExists: false };

describe("the workspace header's More menu", () => {
	test("a linked worktree offers Rebase and Done, each with today's tooltip as its description", () => {
		expect(workspaceMenuItems(linked)).toEqual([
			{ id: "rebase", label: "Rebase…", disabled: false, note: null, description: REBASE_CONTROL_TITLE },
			{ id: "done", label: "Done…", disabled: false, note: null, description: DONE_CONTROL_TITLE },
		]);
	});

	test("a primary checkout's Done is off and says it is never removed", () => {
		const [rebase, done] = workspaceMenuItems(primary);
		expect(rebase!.disabled).toBe(false);
		expect(done).toEqual({ id: "done", label: "Done…", disabled: true, note: DONE_PRIMARY_NOTE, description: null });
	});

	test("a missing folder turns Rebase off with its reason, and leaves Done on", () => {
		const [rebase, done] = workspaceMenuItems(missing);
		expect(rebase).toEqual({ id: "rebase", label: "Rebase…", disabled: true, note: REBASE_FOLDER_MISSING, description: null });
		expect(done!.disabled).toBe(false);
	});

	test("while Timber removes the worktree, both are off and say so", () => {
		for (const item of workspaceMenuItems(linked, true)) {
			expect(item.disabled).toBe(true);
			expect(item.note).toBe(BEING_REMOVED_REASON);
		}
	});

	test("choosing opens the dialog that shows the command, and a disabled entry opens nothing", () => {
		expect(workspaceMenuChoice(TIMBER, linked, "rebase")).toEqual({ kind: "rebase-worktree", repository: TIMBER, worktree: linked.id });
		expect(workspaceMenuChoice(TIMBER, linked, "done")).toEqual({ kind: "done-worktree", repository: TIMBER, worktree: linked.id });
		expect(workspaceMenuChoice(TIMBER, primary, "done")).toBeNull();
		expect(workspaceMenuChoice(TIMBER, missing, "rebase")).toBeNull();
		expect(workspaceMenuChoice(TIMBER, linked, "rebase", true)).toBeNull();
	});

	test("the button and the menu are named after the worktree", () => {
		expect(describeWorkspaceMore(primary)).toBe("More for main");
		expect(describeWorkspaceMenu(primary)).toBe("Actions for main");
	});

	test("Down opens the menu on its first entry and Up on its last; other keys are the button's own", () => {
		expect(workspaceMoreKeyOpens("ArrowDown")).toBe("first");
		expect(workspaceMoreKeyOpens("ArrowUp")).toBe("last");
		expect(workspaceMoreKeyOpens("Enter")).toBeNull();
		expect(workspaceMoreKeyOpens(" ")).toBeNull();
		expect(workspaceMoreKeyOpens("Tab")).toBeNull();
	});
});

describe("the quiet label after the worktree's name", () => {
	test("a primary checkout says so, a linked worktree has none", () => {
		expect(workspaceKindLabel(primary)).toBe("Primary checkout");
		expect(workspaceKindLabel(linked)).toBeNull();
	});
});
