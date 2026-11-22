import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { repositoryMenuEntries } from "../src/mainview/components/RepositoryMenu";
import { WorktreeMenuView } from "../src/mainview/components/WorktreeMenu";
import { DELETE_GROUP_HINT, REMOVE_REPOSITORY_HINT } from "../src/mainview/format";
import { describeGroupMenu, describeRepositoryMenu, groupMenuItems, repositoryMenuItems } from "../src/mainview/repository-menu-format";
import { worktreeMenuKeyAction } from "../src/mainview/worktree-menu-format";

const groups = { groups: [{ id: "g1", name: "Personal" }, { id: "g2", name: "Work" }], membership: { "/work/timber": "g1" } };

describe("a repository's menu", () => {
	const markup = renderToStaticMarkup(
		<WorktreeMenuView label={describeRepositoryMenu("timber")} items={repositoryMenuEntries(repositoryMenuItems(groups, "/work/timber"))} at={{ left: 10, top: 20 }} idBase="m" />,
	);

	test("is a menu named after the repository, with every entry a menu item", () => {
		expect(markup).toContain('role="menu" aria-label="Actions for timber"');
		expect(markup.match(/role="menuitem"/g)?.length).toBe(5);
		expect(markup).toContain('<span class="session-menu-label">Move to Work</span>');
		expect(markup).toContain('<span class="session-menu-label">New group...</span>');
		expect(markup).toContain('<span class="session-menu-label">Take out of Personal</span>');
		expect(markup).toContain('<span class="session-menu-label">Icon...</span>');
		expect(markup).toContain(`title="${REMOVE_REPOSITORY_HINT}"><span class="session-menu-label">Remove from the list</span>`);
		expect(markup).not.toContain("aria-disabled");
	});

	test("the arrows, Home, and End move through it; Escape and Tab close it", () => {
		expect(worktreeMenuKeyAction(4, 0, "ArrowDown")).toEqual({ kind: "move", index: 1 });
		expect(worktreeMenuKeyAction(4, 0, "ArrowUp")).toEqual({ kind: "move", index: 3 });
		expect(worktreeMenuKeyAction(4, 2, "Home")).toEqual({ kind: "move", index: 0 });
		expect(worktreeMenuKeyAction(4, 0, "End")).toEqual({ kind: "move", index: 3 });
		expect(worktreeMenuKeyAction(4, 0, "Escape")).toEqual({ kind: "close", preventDefault: true });
		expect(worktreeMenuKeyAction(4, 0, "Tab")).toEqual({ kind: "close", preventDefault: false });
	});
});

describe("a group's menu", () => {
	test("offers Rename and Delete group, which says its repositories stay", () => {
		const markup = renderToStaticMarkup(
			<WorktreeMenuView label={describeGroupMenu("Work")} items={repositoryMenuEntries(groupMenuItems([{ id: "g2", name: "Work" }], "g2"))} at={{ left: 0, top: 0 }} idBase="g" />,
		);
		expect(markup).toContain('aria-label="Actions for group Work"');
		expect(markup).toContain('<span class="session-menu-label">Rename</span>');
		expect(markup).toContain(`title="${DELETE_GROUP_HINT}"><span class="session-menu-label">Delete group</span>`);
	});
});
