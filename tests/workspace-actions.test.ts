import { describe, expect, test } from "bun:test";
import { BEING_REMOVED_REASON, DONE_CONTROL_TITLE, DONE_PRIMARY_NOTE } from "../src/mainview/done-format";
import { REBASE_CONTROL_TITLE, REBASE_FOLDER_MISSING } from "../src/mainview/rebase-format";
import {
	describeWorkspaceMenu, describeWorkspaceMore, workspaceKindLabel, workspaceMenuChoice, workspaceMenuItems, workspaceMoreKeyOpens,
} from "../src/mainview/workspace-actions-format";
import { sampleRepositories } from "../src/mainview/engine/mock";
import { PULLING_REASON, pullInsteadOfRebase } from "../src/mainview/sync-action-format";
import type { Worktree } from "../src/shared/model";

const TIMBER = "/work/timber";
const worktrees = sampleRepositories.flatMap(repository => repository.worktrees);
const primary = worktrees.find(worktree => worktree.primary)!;
const linked = worktrees.find(worktree => !worktree.primary && worktree.pathExists)!;
const missing: Worktree = { ...linked, pathExists: false };
const timber = sampleRepositories[0]!;
const asking = { pullAsks: true, pulling: false };

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

	test("the primary checkout whose base is its upstream offers Pull in place of Rebase, which opens the row's Pull", () => {
		const pull = pullInsteadOfRebase(timber, primary, asking);
		expect(pull).not.toBeNull();
		const [first, done] = workspaceMenuItems(primary, false, pull);
		expect(first).toEqual({ id: "pull", label: "Pull…", disabled: false, note: null, description: pull!.title });
		expect(done!.id).toBe("done");
		expect(workspaceMenuItems(primary, false, pull).some(item => item.id === "rebase")).toBe(false);
		expect(workspaceMenuChoice(TIMBER, primary, "pull", false, pull)).toEqual({ kind: "sync-action", action: "pull", repository: TIMBER, worktree: primary.id });
		// Without the Pull it was drawn with, the entry is not there to choose.
		expect(workspaceMenuChoice(TIMBER, primary, "pull")).toBeNull();
	});

	test("Pull is plain \"Pull\" when the Pull setting skips the dialog, and is off while it runs or Timber removes the worktree", () => {
		const skipping = pullInsteadOfRebase(timber, primary, { pullAsks: false, pulling: false })!;
		expect(workspaceMenuItems(primary, false, skipping)[0]!.label).toBe("Pull");
		const running = pullInsteadOfRebase(timber, primary, { pullAsks: false, pulling: true })!;
		expect(workspaceMenuItems(primary, false, running)[0]).toMatchObject({ id: "pull", disabled: true, note: PULLING_REASON, description: null });
		expect(workspaceMenuChoice(TIMBER, primary, "pull", false, running)).toBeNull();
		expect(workspaceMenuItems(primary, true, skipping)[0]).toMatchObject({ disabled: true, note: BEING_REMOVED_REASON });
	});

	test("a primary checkout whose saved base is its upstream offers Pull; one on a feature branch with another base keeps Rebase", () => {
		const saved: Worktree = { ...primary, base: { kind: "assigned", ref: "refs/remotes/origin/main" } };
		expect(workspaceMenuItems(saved, false, pullInsteadOfRebase({ ...timber, fallbackBase: null }, saved, asking))[0]!.id).toBe("pull");
		const feature: Worktree = {
			...primary,
			branch: "feat/login",
			base: { kind: "assigned", ref: "refs/remotes/origin/main" },
			sync: { kind: "tracking", upstream: "origin/feat/login", ahead: 0, behind: 2, remote: "origin", upstreamRef: "refs/remotes/origin/feat/login" },
		};
		const pull = pullInsteadOfRebase(timber, feature, asking);
		expect(pull).toBeNull();
		expect(workspaceMenuItems(feature, false, pull).map(item => item.id)).toEqual(["rebase", "done"]);
	});

	test("linked worktrees, and a primary checkout whose fallback base is unknown, keep Rebase", () => {
		expect(pullInsteadOfRebase(timber, linked, asking)).toBeNull();
		expect(pullInsteadOfRebase({ ...timber, fallbackBase: null }, primary, asking)).toBeNull();
		expect(workspaceMenuItems(linked, false, pullInsteadOfRebase(timber, linked, asking))[0]!.id).toBe("rebase");
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
