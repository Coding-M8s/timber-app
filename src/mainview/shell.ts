import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, clampSidebarWidth } from "../shared/layout";
import type { Repository } from "../shared/model";
import { type LayoutProblem, WORKSPACE_TABS, type WorkspaceTab } from "./store/state";

/**
 * Words and keyboard rules of the window's frame: the title bar, the sidebar's
 * edge, and the tabs. Pure, so they can be tested without a window.
 */

/** Said on controls whose feature is designed but not built, so they do not pretend to work. */
export const PALETTE_HINT = "Command palette. Not built yet.";
export const SETTINGS_HINT = "Settings. Not built yet.";

export const TAB_LABELS: Record<WorkspaceTab, string> = {
	workspace: "Workspace",
	changes: "Changes",
};

/** What each tab says until its own content exists. */
export const TAB_EMPTY: Record<WorkspaceTab, { title: string; text: string }> = {
	workspace: {
		title: "Nothing running here yet",
		text: "Agent and terminal panes for this worktree will show here. They are not built yet.",
	},
	changes: {
		title: "No changes to show yet",
		text: "The diff for this worktree will show here. It is not built yet.",
	},
};

/**
 * The tab a key moves to from `current`: the arrows step and wrap around, Home
 * and End jump to the first and the last. Null for any other key.
 */
export function tabAfterKey(current: WorkspaceTab, key: string): WorkspaceTab | null {
	const count = WORKSPACE_TABS.length;
	const index = WORKSPACE_TABS.indexOf(current);
	switch (key) {
		case "ArrowRight":
			return WORKSPACE_TABS[(index + 1) % count]!;
		case "ArrowLeft":
			return WORKSPACE_TABS[(index + count - 1) % count]!;
		case "Home":
			return WORKSPACE_TABS[0];
		case "End":
			return WORKSPACE_TABS[count - 1]!;
		default:
			return null;
	}
}

/** How far one press of an arrow key moves the sidebar's edge, in pixels. */
export const SIDEBAR_KEY_STEP = 16;

/**
 * The sidebar width after a key on its resize handle: the arrows move the edge
 * one step, Home and End go to the narrowest and the widest. Null for any
 * other key.
 */
export function sidebarWidthAfterKey(width: number, key: string): number | null {
	switch (key) {
		case "ArrowLeft":
			return clampSidebarWidth(width - SIDEBAR_KEY_STEP);
		case "ArrowRight":
			return clampSidebarWidth(width + SIDEBAR_KEY_STEP);
		case "Home":
			return MIN_SIDEBAR_WIDTH;
		case "End":
			return MAX_SIDEBAR_WIDTH;
		default:
			return null;
	}
}

/** The tooltip of a repository header: the whole name, which the header may cut short, and where it is. */
export function describeRepository(repository: Pick<Repository, "name" | "path">): string {
	return `${repository.name} (${repository.path})`;
}

/** What to tell the person when the layout could not be read or saved. */
export function describeLayoutProblem(problem: LayoutProblem): { title: string; text: string; consequence: string } {
	return problem.action === "save"
		? {
			title: "Could not save the layout",
			text: problem.message,
			consequence: "The window stays as you arranged it, but the next start may not remember it.",
		}
		: {
			title: "Could not read the saved layout",
			text: problem.message,
			consequence: "The window starts with the usual layout.",
		};
}
