import { CHOPS_LIMITS, SIDEBAR_LIMITS, type WidthLimits, clampWidth } from "../shared/layout";
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
	tags: "Tags",
	theme: "Theme",
	terminal: "Terminal",
	rendering: "Rendering",
	editor: "Editor",
	agents: "Agents",
	chops: "Chops",
	notifications: "Notifications",
	fetch: "Fetching",
	pull: "Pull",
	about: "About",
	executable: "Executable",
	machine: "Machine",
	repository: "Repository",
};

/** Sections about Timber, listed under a heading of their own: which Timber runs, then Timber's own settings. */
export const TIMBER_SETTINGS_SECTIONS: readonly SettingsSection[] = ["executable", "machine", "repository"];

/**
 * How the list down the side of Settings groups its sections, top to bottom.
 * About is not in a group: it sits on its own at the foot of the list.
 */
export const SETTINGS_NAV_GROUPS: readonly { label: string; sections: readonly SettingsSection[] }[] = [
	{ label: "Appearance", sections: ["layout", "tags", "theme", "terminal", "rendering"] },
	{ label: "Workflow", sections: ["editor", "agents", "chops"] },
	{ label: "Activity", sections: ["notifications", "fetch", "pull"] },
	{ label: "Timber", sections: TIMBER_SETTINGS_SECTIONS },
];

/** The section at the foot of the Settings list, apart from the groups. */
export const SETTINGS_NAV_FOOT: SettingsSection = "about";

export const SIDEBAR_SIDE_LABELS: Record<SidebarSide, string> = {
	left: "Left",
	right: "Right",
};

export const TAB_LABELS: Record<WorkspaceTab, string> = {
	workspace: "Workspace",
	"pull-request": "Pull request",
	diff: "Diff",
	file: "File",
};

/** The tabs a worktree shows: the diff only while a diff is open there, and File only while a file is. */
export function visibleTabs(fileOpen: boolean, diffOpen = false): WorkspaceTab[] {
	return WORKSPACE_TABS.filter(tab => (tab !== "file" || fileOpen) && (tab !== "diff" || diffOpen));
}

/**
 * The tab a key moves to from `current`: the arrows step and wrap around, Home
 * and End jump to the first and the last. Null for any other key.
 */
export function tabAfterKey(current: WorkspaceTab, key: string, tabs: readonly WorkspaceTab[] = visibleTabs(false)): WorkspaceTab | null {
	const count = tabs.length;
	const index = Math.max(0, tabs.indexOf(current));
	switch (key) {
		case "ArrowRight":
			return tabs[(index + 1) % count]!;
		case "ArrowLeft":
			return tabs[(index + count - 1) % count]!;
		case "Home":
			return tabs[0]!;
		case "End":
			return tabs[count - 1]!;
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
export function sidebarWidthAfterKey(width: number, key: string, side: SidebarSide = "left", limits: WidthLimits = SIDEBAR_LIMITS): number | null {
	const widen = side === "left" ? "ArrowRight" : "ArrowLeft";
	const narrow = side === "left" ? "ArrowLeft" : "ArrowRight";
	switch (key) {
		case narrow:
			return clampWidth(width - SIDEBAR_KEY_STEP, limits);
		case widen:
			return clampWidth(width + SIDEBAR_KEY_STEP, limits);
		case "Home":
			return limits.min;
		case "End":
			return limits.max;
		default:
			return null;
	}
}

/**
 * The sidebar width while its edge is dragged `deltaX` pixels to the right
 * from where the drag started. The edge follows the pointer, so on the right
 * a drag to the left widens the sidebar.
 */
export function sidebarWidthAfterDrag(startWidth: number, deltaX: number, side: SidebarSide = "left", limits: WidthLimits = SIDEBAR_LIMITS): number {
	return clampWidth(side === "left" ? startWidth + deltaX : startWidth - deltaX, limits);
}

/**
 * The chops panel's width after a key on its edge. The panel is always to
 * the right of the workspace, so its edge works as a sidebar's on the right
 * does: the arrow pointing at the workspace widens it, within the panel's
 * own limits.
 */
export function chopsWidthAfterKey(width: number, key: string): number | null {
	return sidebarWidthAfterKey(width, key, "right", CHOPS_LIMITS);
}

/** The chops panel's width while its edge is dragged `deltaX` pixels to the right: a drag to the left widens it. */
export function chopsWidthAfterDrag(startWidth: number, deltaX: number): number {
	return sidebarWidthAfterDrag(startWidth, deltaX, "right", CHOPS_LIMITS);
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
