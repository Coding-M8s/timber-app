import type { Comparison } from "./file-changes";
import { ISSUE_LISTS, type IssueList } from "./issue-lists";

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
	/**
	 * The list each repository's issues board was last set to, by the path of
	 * its primary checkout. A repository not named here starts on the
	 * current sprint.
	 */
	issueLists: Record<string, IssueList>;
	/** The repository groups that are folded, each named by its id. */
	collapsedGroups: string[];
	/** Whether the chops panel shows beside the workspace. Hidden until the person shows it. */
	chopsOpen: boolean;
	/** Width of the chops panel in pixels, always within the limits below, kept while the panel is hidden. */
	chopsWidth: number;
}

export const DEFAULT_SIDEBAR_WIDTH = 272;
export const MIN_SIDEBAR_WIDTH = 200;
export const MAX_SIDEBAR_WIDTH = 480;

export const DEFAULT_CHOPS_WIDTH = 320;
export const MIN_CHOPS_WIDTH = 240;
export const MAX_CHOPS_WIDTH = 560;

/** The narrowest and widest a resizable part may be, and the width it takes when nothing usable is saved. */
export interface WidthLimits {
	min: number;
	max: number;
	fallback: number;
}

export const SIDEBAR_LIMITS: WidthLimits = { min: MIN_SIDEBAR_WIDTH, max: MAX_SIDEBAR_WIDTH, fallback: DEFAULT_SIDEBAR_WIDTH };
export const CHOPS_LIMITS: WidthLimits = { min: MIN_CHOPS_WIDTH, max: MAX_CHOPS_WIDTH, fallback: DEFAULT_CHOPS_WIDTH };

export function defaultLayout(): Layout {
	return {
		sidebarWidth: DEFAULT_SIDEBAR_WIDTH,
		collapsed: [],
		setupDismissed: [],
		uncommittedChanges: [],
		issueLists: {},
		collapsedGroups: [],
		chopsOpen: false,
		chopsWidth: DEFAULT_CHOPS_WIDTH,
	};
}

/** A whole number of pixels within the limits. Anything that is not a number gives the fallback width. */
export function clampWidth(width: number, limits: WidthLimits): number {
	if (!Number.isFinite(width)) return limits.fallback;
	return Math.min(limits.max, Math.max(limits.min, Math.round(width)));
}

/** A whole number of pixels within the limits. Anything that is not a number gives the default width. */
export function clampSidebarWidth(width: number): number {
	return clampWidth(width, SIDEBAR_LIMITS);
}

/** The chops panel's width within its limits. Anything that is not a number gives the default width. */
export function clampChopsWidth(width: number): number {
	return clampWidth(width, CHOPS_LIMITS);
}

/**
 * Read a layout from a value that came from outside, such as the settings
 * file. A layout is a convenience, so this never fails: each part that is
 * missing or unreadable falls back to its default, and the rest is kept.
 */
export function readLayout(value: unknown): Layout {
	const layout = defaultLayout();
	if (typeof value !== "object" || value === null || Array.isArray(value)) return layout;
	const { sidebarWidth, collapsed, setupDismissed, uncommittedChanges, issueLists, collapsedGroups, chopsOpen, chopsWidth } = value as Record<string, unknown>;
	if (typeof sidebarWidth === "number") layout.sidebarWidth = clampSidebarWidth(sidebarWidth);
	if (typeof chopsOpen === "boolean") layout.chopsOpen = chopsOpen;
	if (typeof chopsWidth === "number") layout.chopsWidth = clampChopsWidth(chopsWidth);
	layout.collapsed = readPaths(collapsed);
	layout.setupDismissed = readPaths(setupDismissed);
	layout.uncommittedChanges = readPaths(uncommittedChanges);
	layout.issueLists = readIssueLists(issueLists);
	layout.collapsedGroups = readPaths(collapsedGroups);
	return layout;
}

/** The lists remembered for each repository. A path that is empty, or a list this app does not know, is left out. */
function readIssueLists(value: unknown): Record<string, IssueList> {
	const lists: Record<string, IssueList> = {};
	if (typeof value !== "object" || value === null || Array.isArray(value)) return lists;
	for (const [path, list] of Object.entries(value)) {
		if (path !== "" && typeof list === "string" && (ISSUE_LISTS as readonly string[]).includes(list)) lists[path] = list as IssueList;
	}
	return lists;
}

const sameIssueLists = (one: Readonly<Record<string, IssueList>>, other: Readonly<Record<string, IssueList>>) =>
	Object.keys(one).length === Object.keys(other).length && Object.entries(one).every(([path, list]) => other[path] === list);

/** The distinct non-empty paths (or group ids) of a list from outside. Anything else in it is left out. */
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
		&& samePaths(one.uncommittedChanges, other.uncommittedChanges)
		&& sameIssueLists(one.issueLists, other.issueLists)
		&& samePaths(one.collapsedGroups, other.collapsedGroups)
		&& one.chopsOpen === other.chopsOpen
		&& one.chopsWidth === other.chopsWidth;
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

/** The layout with this list remembered for the repository's issues board. */
export function chooseIssueList(layout: Layout, repository: string, list: IssueList): Layout {
	return layout.issueLists[repository] === list ? layout : { ...layout, issueLists: { ...layout.issueLists, [repository]: list } };
}

/** The layout without anything remembered about this repository, for when it leaves the list. */
export function forgetRepository(layout: Layout, repository: string): Layout {
	if (!layout.collapsed.includes(repository) && !layout.setupDismissed.includes(repository) && !(repository in layout.issueLists)) return layout;
	const { [repository]: _forgotten, ...issueLists } = layout.issueLists;
	return {
		...layout,
		collapsed: layout.collapsed.filter(path => path !== repository),
		setupDismissed: layout.setupDismissed.filter(path => path !== repository),
		issueLists,
	};
}

/** The layout with this repository group folded when it was open, and open when it was folded. */
export function toggleGroupCollapsed(layout: Layout, group: string): Layout {
	const collapsedGroups = layout.collapsedGroups.includes(group)
		? layout.collapsedGroups.filter(id => id !== group)
		: [...layout.collapsedGroups, group];
	return { ...layout, collapsedGroups };
}

/** The layout without anything remembered about this repository group, for when it is deleted. */
export function forgetGroup(layout: Layout, group: string): Layout {
	if (!layout.collapsedGroups.includes(group)) return layout;
	return { ...layout, collapsedGroups: layout.collapsedGroups.filter(id => id !== group) };
}
