import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH, clampSidebarWidth } from "../shared/layout";
import type { SidebarSide } from "../shared/preferences";
import type { Repository } from "../shared/model";
import { type LayoutProblem, type SettingsSection, WORKSPACE_TABS, type WorkspaceTab } from "./store/state";

/**
 * Words and keyboard rules of the window's frame: the title bar, the sidebar's
 * edge, and the tabs. Pure, so they can be tested without a window.
 */

export const SETTINGS_LABEL = "Settings";

/** The names of the Settings dialog's sections, as listed down its side. */
export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
	layout: "Layout",
	theme: "Theme",
	terminal: "Terminal",
	rendering: "Rendering",
	editor: "Editor",
	agents: "Agents",
	notifications: "Notifications",
	fetch: "Fetching",
	about: "About",
	machine: "Machine",
	repository: "Repository",
};

/** Sections that show Timber's own settings, listed under a heading of their own. */
export const TIMBER_SETTINGS_SECTIONS: readonly SettingsSection[] = ["machine", "repository"];

export const SIDEBAR_SIDE_LABELS: Record<SidebarSide, string> = {
	left: "Left",
	right: "Right",
};

export const TAB_LABELS: Record<WorkspaceTab, string> = {
	workspace: "Workspace",
	changes: "Changes",
	"pull-request": "Pull request",
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
 * one step the way they point, so toward the workspace widens the sidebar
 * whichever side it is on. Home and End go to the narrowest and the widest.
 * Null for any other key.
 */
export function sidebarWidthAfterKey(width: number, key: string, side: SidebarSide = "left"): number | null {
	const widen = side === "left" ? "ArrowRight" : "ArrowLeft";
	const narrow = side === "left" ? "ArrowLeft" : "ArrowRight";
	switch (key) {
		case narrow:
			return clampSidebarWidth(width - SIDEBAR_KEY_STEP);
		case widen:
			return clampSidebarWidth(width + SIDEBAR_KEY_STEP);
		case "Home":
			return MIN_SIDEBAR_WIDTH;
		case "End":
			return MAX_SIDEBAR_WIDTH;
		default:
			return null;
	}
}

/**
 * The sidebar width while its edge is dragged `deltaX` pixels to the right
 * from where the drag started. The edge follows the pointer, so on the right
 * a drag to the left widens the sidebar.
 */
export function sidebarWidthAfterDrag(startWidth: number, deltaX: number, side: SidebarSide = "left"): number {
	return clampSidebarWidth(side === "left" ? startWidth + deltaX : startWidth - deltaX);
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
