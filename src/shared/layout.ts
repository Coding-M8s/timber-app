/**
 * How the person arranged the window: the part of the layout that is
 * remembered between runs. Everything here is pure.
 */
export interface Layout {
	/** Width of the sidebar in pixels, always within the limits below. */
	sidebarWidth: number;
	/** The repositories whose group is collapsed, each named by the path of its primary checkout. */
	collapsed: string[];
}

export const DEFAULT_SIDEBAR_WIDTH = 272;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 480;

export function defaultLayout(): Layout {
	return { sidebarWidth: DEFAULT_SIDEBAR_WIDTH, collapsed: [] };
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
	const { sidebarWidth, collapsed } = value as Record<string, unknown>;
	if (typeof sidebarWidth === "number") layout.sidebarWidth = clampSidebarWidth(sidebarWidth);
	if (Array.isArray(collapsed)) {
		for (const path of collapsed) {
			if (typeof path === "string" && path !== "" && !layout.collapsed.includes(path)) layout.collapsed.push(path);
		}
	}
	return layout;
}

export function sameLayout(one: Layout, other: Layout): boolean {
	return one.sidebarWidth === other.sidebarWidth
		&& one.collapsed.length === other.collapsed.length
		&& one.collapsed.every((path, index) => path === other.collapsed[index]);
}

/** The layout with the group of this repository collapsed when it was open, and open when it was collapsed. */
export function toggleCollapsed(layout: Layout, repository: string): Layout {
	const collapsed = layout.collapsed.includes(repository)
		? layout.collapsed.filter(path => path !== repository)
		: [...layout.collapsed, repository];
	return { ...layout, collapsed };
}

/** The layout without anything remembered about this repository, for when it leaves the list. */
export function forgetRepository(layout: Layout, repository: string): Layout {
	return layout.collapsed.includes(repository)
		? { ...layout, collapsed: layout.collapsed.filter(path => path !== repository) }
		: layout;
}
