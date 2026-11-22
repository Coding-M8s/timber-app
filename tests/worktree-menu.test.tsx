import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorktreeMenuView } from "../src/mainview/components/WorktreeMenu";
import { WorktreeRow } from "../src/mainview/components/WorktreeRow";
import { BEING_REMOVED_REASON, DONE_CONTROL_TITLE, DONE_PRIMARY_NOTE } from "../src/mainview/done-format";
import {
	WORKTREE_MENU_SHORTCUTS, describeWorktreeMenu, opensWorktreeMenu, placeMenu, worktreeMenuChoice, worktreeMenuItems, worktreeMenuKeyAction,
} from "../src/mainview/worktree-menu-format";
import type { Worktree } from "../src/shared/model";

const linked: Worktree = {
	id: "/work/app/.git\0verified\0/work/app-worktrees/feat-x",
	path: "/work/app-worktrees/feat-x",
	canonicalPath: "/work/app-worktrees/feat-x",
	branch: "feat/x",
	head: "1234567890abcdef1234567890abcdef12345678",
	primary: false,
	detached: false,
	locked: false,
	prunable: false,
	pathExists: true,
	changes: { kind: "known", modified: [], untracked: [] },
	base: null,
	issue: null,
	sync: { kind: "tracking", upstream: "origin/feat/x", ahead: 0, behind: 0 },
	baseCounts: null,
};
const primary: Worktree = { ...linked, id: "/work/app/.git\0verified\0/work/app", path: "/work/app", canonicalPath: "/work/app", branch: "main", primary: true };

const key = (name: string, change: Partial<{ shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }> = {}) =>
	({ key: name, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...change });

describe("a worktree row's menu", () => {
	test("offers Done for a linked worktree, with the same tooltip as the workspace header", () => {
		expect(worktreeMenuItems(linked)).toEqual([{ id: "done", label: "Done", disabled: false, note: null, title: DONE_CONTROL_TITLE }]);
	});

	test("offers Done disabled for a primary checkout, with the reason the header gives", () => {
		expect(worktreeMenuItems(primary)).toEqual([{ id: "done", label: "Done", disabled: true, note: DONE_PRIMARY_NOTE, title: DONE_PRIMARY_NOTE }]);
	});

	test("offers Done disabled while Timber removes the worktree, saying so", () => {
		expect(worktreeMenuItems(linked, true)).toEqual([{ id: "done", label: "Done", disabled: true, note: BEING_REMOVED_REASON, title: BEING_REMOVED_REASON }]);
		expect(worktreeMenuChoice("/work/app", linked, "done", true)).toBeNull();
	});

	test("choosing Done asks for the Done dialog of the row's own worktree", () => {
		expect(worktreeMenuChoice("/work/app", linked, "done")).toEqual({ kind: "done-worktree", repository: "/work/app", worktree: linked.id });
	});

	test("choosing the disabled Done of a primary checkout asks for nothing", () => {
		expect(worktreeMenuChoice("/work/app", primary, "done")).toBeNull();
	});

	test("is named after the worktree", () => {
		expect(describeWorktreeMenu(linked)).toBe("Actions for feat/x");
	});

	test("opens with Shift+F10 or the context menu key, and no other key", () => {
		expect(opensWorktreeMenu(key("F10", { shiftKey: true }))).toBe(true);
		expect(opensWorktreeMenu(key("ContextMenu"))).toBe(true);
		expect(opensWorktreeMenu(key("ContextMenu", { shiftKey: true }))).toBe(true);
		expect(opensWorktreeMenu(key("F10"))).toBe(false);
		expect(opensWorktreeMenu(key("F10", { shiftKey: true, ctrlKey: true }))).toBe(false);
		expect(opensWorktreeMenu(key("ContextMenu", { altKey: true }))).toBe(false);
		expect(opensWorktreeMenu(key("Enter"))).toBe(false);
	});

	test("moves with the arrows, Home, and End, and closes with Escape or Tab, keeping Tab's own move", () => {
		expect(worktreeMenuKeyAction(3, 0, "ArrowDown")).toEqual({ kind: "move", index: 1 });
		expect(worktreeMenuKeyAction(3, 0, "ArrowUp")).toEqual({ kind: "move", index: 2 });
		expect(worktreeMenuKeyAction(3, 1, "End")).toEqual({ kind: "move", index: 2 });
		expect(worktreeMenuKeyAction(1, 0, "ArrowDown")).toEqual({ kind: "move", index: 0 });
		expect(worktreeMenuKeyAction(1, 0, "Escape")).toEqual({ kind: "close", preventDefault: true });
		expect(worktreeMenuKeyAction(1, 0, "Tab")).toEqual({ kind: "close", preventDefault: false });
		expect(worktreeMenuKeyAction(1, 0, "Enter")).toBeNull();
		expect(worktreeMenuKeyAction(1, 0, "a")).toBeNull();
	});

	test("stays where it was asked for when it fits, and moves inside the window when it does not", () => {
		const menu = { width: 180, height: 40 };
		const window = { width: 800, height: 600 };
		expect(placeMenu({ left: 100, top: 200 }, menu, window)).toEqual({ left: 100, top: 200 });
		expect(placeMenu({ left: 790, top: 590 }, menu, window)).toEqual({ left: 616, top: 556 });
		expect(placeMenu({ left: -20, top: -5 }, menu, window)).toEqual({ left: 4, top: 4 });
		// A window smaller than the menu keeps its top left corner in view.
		expect(placeMenu({ left: 50, top: 50 }, menu, { width: 100, height: 20 })).toEqual({ left: 4, top: 4 });
	});
});

describe("WorktreeMenuView", () => {
	const render = (worktree: Worktree) => renderToStaticMarkup(
		<WorktreeMenuView label={describeWorktreeMenu(worktree)} items={worktreeMenuItems(worktree)} at={{ left: 10, top: 20 }} idBase="m" />,
	);

	test("is a menu named after the worktree with Done as an entry", () => {
		const markup = render(linked);
		expect(markup).toContain('role="menu" aria-label="Actions for feat/x"');
		expect(markup).toContain('style="left:10px;top:20px"');
		expect(markup).toContain(`<button type="button" role="menuitem" id="m-item-0" class="session-menu-item worktree-menu-item" tabindex="-1" title="${DONE_CONTROL_TITLE}"><span class="session-menu-label">Done</span></button>`);
		expect(markup).not.toContain("aria-disabled");
		expect(markup).not.toContain("worktree-menu-note");
	});

	test("shows Done disabled for a primary checkout, with the reason under it", () => {
		const markup = render(primary);
		expect(markup).toContain('aria-disabled="true" aria-describedby="m-note-0"');
		expect(markup).toContain(`<p id="m-note-0" class="worktree-menu-note" role="none">${DONE_PRIMARY_NOTE}</p>`);
	});
});

describe("a worktree row with a menu", () => {
	test("says which keys open its menu, and the menu stays closed until asked", () => {
		const markup = renderToStaticMarkup(<WorktreeRow worktree={linked} selected={false} onSelect={() => {}} onMenuChoice={() => {}} />);
		expect(markup).toContain(`aria-keyshortcuts="${WORKTREE_MENU_SHORTCUTS}"`);
		expect(markup).toContain('<div class="row-item" data-worktree-path="/work/app-worktrees/feat-x">');
		expect(markup).not.toContain('role="menu"');
	});

	test("without a menu, it has no menu keys", () => {
		const markup = renderToStaticMarkup(<WorktreeRow worktree={linked} selected={false} onSelect={() => {}} />);
		expect(markup).not.toContain("aria-keyshortcuts");
		expect(markup).not.toContain('role="menu"');
	});
});
