import type { Comparison } from "./file-changes";

/**
 * How the person arranged the window: the part of the layout that is
 * remembered between runs. Everything here is pure.
 */
export interface Layout {
	/** Width of the sidebar in pixels, always within the limits below. */
	sidebarWidth: number;
	/** The repositories whose group is collapsed, each named by the path of its primary checkout. */
	collapsed: string[];
	/**
	 * The repositories whose setup prompt the person dismissed with "Not now",
	 * each named by the path of its primary checkout. Setup stays possible
	 * in Settings > Repository, or with `timber setup` in a terminal.
	 */
	setupDismissed: string[];
	/**
	 * The worktrees, each named by its identity (`Worktree.id`), whose Changes
	 * tab the person set to Uncommitted. Every other worktree compares with
	 * its base when it can.
	 */
	uncommittedChanges: string[];
}

export const DEFAULT_SIDEBAR_WIDTH = 272;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 480;

export function defaultLayout(): Layout {
	return { sidebarWidth: DEFAULT_SIDEBAR_WIDTH, collapsed: [], setupDismissed: [], uncommittedChanges: [] };
}

/** A whole number of pixels within the limits. Anything that is not a number gives the default width. */
export function clampSidebarWidth(width: number): number {
	if (!Number.isFinite(width)) return DEFAULT_SIDEBAR_WIDTH;
	return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(width)));
}

/**
 * Read a layout from a value that came from outside, such as the settings
 * file. A layout is a convenience, so this never fails: each part that is
 * missing or unreadable falls back to its default, and the rest is kept.
 */
export function readLayout(value: unknown): Layout {
	const layout = defaultLayout();
	if (typeof value !== "object" || value === null || Array.isArray(value)) return layout;
	const { sidebarWidth, collapsed, setupDismissed, uncommittedChanges } = value as Record<string, unknown>;
	if (typeof sidebarWidth === "number") layout.sidebarWidth = clampSidebarWidth(sidebarWidth);
	layout.collapsed = readPaths(collapsed);
	layout.setupDismissed = readPaths(setupDismissed);
	layout.uncommittedChanges = readPaths(uncommittedChanges);
	return layout;
}

/** The distinct non-empty paths of a list from outside. Anything else in it is left out. */
function readPaths(value: unknown): string[] {
	const paths: string[] = [];
	if (!Array.isArray(value)) return paths;
	for (const path of value) {
		if (typeof path === "string" && path !== "" && !paths.includes(path)) paths.push(path);
	}
	return paths;
}

const samePaths = (one: readonly string[], other: readonly string[]) =>
	one.length === other.length && one.every((path, index) => path === other[index]);

export function sameLayout(one: Layout, other: Layout): boolean {
	return one.sidebarWidth === other.sidebarWidth
		&& samePaths(one.collapsed, other.collapsed)
		&& samePaths(one.setupDismissed, other.setupDismissed)
		&& samePaths(one.uncommittedChanges, other.uncommittedChanges);
}

/** What the Changes tab of a worktree asks to compare with: its base, unless the person chose Uncommitted there. */
export function chosenComparison(layout: Layout, worktree: string): Comparison {
	return layout.uncommittedChanges.includes(worktree) ? "uncommitted" : "base";
}

/** The layout with this comparison remembered for the worktree's Changes tab. */
export function chooseComparison(layout: Layout, worktree: string, compare: Comparison): Layout {
	if (chosenComparison(layout, worktree) === compare) return layout;
	const uncommittedChanges = compare === "uncommitted"
		? [...layout.uncommittedChanges, worktree]
		: layout.uncommittedChanges.filter(id => id !== worktree);
	return { ...layout, uncommittedChanges };
}

/** The layout with the group of this repository collapsed when it was open, and open when it was collapsed. */
export function toggleCollapsed(layout: Layout, repository: string): Layout {
	const collapsed = layout.collapsed.includes(repository)
		? layout.collapsed.filter(path => path !== repository)
		: [...layout.collapsed, repository];
	return { ...layout, collapsed };
}

/** The layout with the setup prompt of this repository dismissed. */
export function dismissSetup(layout: Layout, repository: string): Layout {
	return layout.setupDismissed.includes(repository) ? layout : { ...layout, setupDismissed: [...layout.setupDismissed, repository] };
}

/** The layout without anything remembered about this repository, for when it leaves the list. */
export function forgetRepository(layout: Layout, repository: string): Layout {
	if (!layout.collapsed.includes(repository) && !layout.setupDismissed.includes(repository)) return layout;
	return {
		...layout,
		collapsed: layout.collapsed.filter(path => path !== repository),
		setupDismissed: layout.setupDismissed.filter(path => path !== repository),
	};
}
