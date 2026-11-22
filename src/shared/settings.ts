import { type ChopApprovals, readChopApprovals } from "./chops";
import { type ForcePushMarks, readForcePushMarks } from "./git-fetch";
import { DEFAULT_CHOPS_WIDTH, type Layout, readLayout } from "./layout";
import { type RepositoryGroup, readGroups } from "./repository-groups";
import { type Preferences, readPreferences, writePreferences } from "./preferences";
import { type SavedWindow, readSavedWindow } from "./window-frame";

/**
 * What the app remembers between runs. Parsing and formatting are pure; the
 * main process reads and writes the file (see src/bun/settings.ts).
 */
export interface SavedRepository {
	/** Absolute path of the primary checkout, as Git reported it when the repository was added. */
	path: string;
	/**
	 * The repository's common Git directory, with links resolved. Every worktree
	 * of a repository shares it, so it tells whether a picked folder is already
	 * in the list.
	 */
	commonDir: string;
	/** The id of the group it is shown in. Absent when it is not in a group. */
	group?: string;
}

export interface Settings {
	repositories: SavedRepository[];
	/**
	 * The groups the sidebar gathers repositories into, in the order shown
	 * among those that share a parent. A group inside another names it in
	 * `parent`. Absent until the person makes one, and in files written before
	 * groups existed.
	 */
	groups?: RepositoryGroup[];
	/**
	 * How the window was arranged. Absent until the person first changes the
	 * layout, and in files written before the app remembered it.
	 */
	layout?: Layout;
	/**
	 * The app's own settings, chosen in the Settings dialog. Absent until the
	 * person first saves one, and in files written before the app had them.
	 */
	preferences?: Preferences;
	/**
	 * Branches marked force-pushed that the person has not seen yet, by
	 * repository, so the marks outlive a restart. Absent when there are none.
	 */
	forcePushes?: ForcePushMarks;
	/**
	 * Where the window was and how large. Absent until the window is first
	 * moved or resized, and in files written before the app remembered it.
	 */
	window?: SavedWindow;
	/**
	 * The texts of repository chops the person agreed to run, as digests, by
	 * the repository's primary checkout (see `ChopApprovals` in ./chops.ts).
	 * Absent when there are none.
	 */
	chopApprovals?: ChopApprovals;
}

export const SETTINGS_VERSION = 1;

export function emptySettings(): Settings {
	return { repositories: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRepository(value: unknown): SavedRepository | null {
	if (!isRecord(value)) return null;
	const { path, commonDir } = value;
	if (typeof path !== "string" || path === "" || typeof commonDir !== "string" || commonDir === "") return null;
	return { path, commonDir };
}

/**
 * Read the text of a settings file. Null when it is damaged: not JSON, not
 * this version, or holding an entry that is not a saved repository. A damaged
 * file is never half-read, so a later save cannot quietly drop part of it.
 *
 * The groups, the layout, the preferences, the force-push marks, the window, and the chop approvals are the exception,
 * because they are only a convenience: a part that cannot be read falls back to the defaults (see
 * `readGroups`, `readLayout`, `readPreferences`, and `readSavedWindow`) and never costs the
 * repository list. A repository's group that names no readable group is dropped, and the repository kept. A group's
 * `parent` that is unknown, loops, or nests too deep is dropped, and the group goes to the top level.
 */
export function parseSettings(text: string): Settings | null {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isRecord(value) || value.version !== SETTINGS_VERSION) return null;
	const listed = value.repositories ?? [];
	if (!Array.isArray(listed)) return null;

	const groups = readGroups(value.groups);
	const repositories: SavedRepository[] = [];
	for (const entry of listed) {
		const repository = readRepository(entry);
		if (!repository) return null;
		// A file edited by hand may repeat a repository. Keep the first.
		if (!repositories.some(known => known.path === repository.path || known.commonDir === repository.commonDir)) {
			// A group that names none of the groups read is dropped, never the repository.
			const { group } = entry as Record<string, unknown>;
			if (typeof group === "string" && groups.some(known => known.id === group)) repository.group = group;
			repositories.push(repository);
		}
	}
	const settings: Settings = { repositories };
	if (groups.length > 0) settings.groups = groups;
	if (value.layout !== undefined) settings.layout = readLayout(value.layout);
	if (value.preferences !== undefined) settings.preferences = readPreferences(value.preferences);
	if (value.forcePushes !== undefined) {
		const forcePushes = readForcePushMarks(value.forcePushes);
		if (Object.keys(forcePushes).length > 0) settings.forcePushes = forcePushes;
	}
	const window = readSavedWindow(value.window);
	if (window) settings.window = window;
	const chopApprovals = readChopApprovals(value.chopApprovals);
	if (Object.keys(chopApprovals).length > 0) settings.chopApprovals = chopApprovals;
	return settings;
}

/** The text of a settings file, readable and stable enough to edit by hand. */
export function serializeSettings(settings: Settings): string {
	const repositories = settings.repositories.map(({ path, commonDir, group }) => ({ path, commonDir, ...(group === undefined ? {} : { group }) }));
	const groups = settings.groups && settings.groups.length > 0 ? settings.groups.map(({ id, name, parent }) => ({ id, name, ...(parent === undefined ? {} : { parent }) })) : null;
	const layout = settings.layout && {
		sidebarWidth: settings.layout.sidebarWidth,
		collapsed: [...settings.layout.collapsed],
		setupDismissed: [...settings.layout.setupDismissed],
		uncommittedChanges: [...settings.layout.uncommittedChanges],
		issueLists: { ...settings.layout.issueLists },
		// Written only once a group is folded, so a file without groups stays as it was.
		...(settings.layout.collapsedGroups.length > 0 ? { collapsedGroups: [...settings.layout.collapsedGroups] } : {}),
		// Written only once the chops panel was shown or resized, so an older file stays as it was until then.
		...(settings.layout.chopsOpen ? { chopsOpen: true } : {}),
		...(settings.layout.chopsWidth !== DEFAULT_CHOPS_WIDTH ? { chopsWidth: settings.layout.chopsWidth } : {}),
		...(settings.layout.sidePanel !== "chops" ? { sidePanel: settings.layout.sidePanel } : {}),
		...(settings.layout.diffLayout !== "unified" ? { diffLayout: settings.layout.diffLayout } : {}),
	};
	const preferences = settings.preferences && writePreferences(settings.preferences);
	const forcePushes = settings.forcePushes && Object.keys(settings.forcePushes).length > 0 ? readForcePushMarks(settings.forcePushes) : null;
	const window = settings.window && readSavedWindow(settings.window);
	const chopApprovals = settings.chopApprovals ? readChopApprovals(settings.chopApprovals) : {};
	return `${JSON.stringify({
		version: SETTINGS_VERSION,
		repositories,
		...(groups ? { groups } : {}),
		...(layout ? { layout } : {}),
		...(preferences ? { preferences } : {}),
		...(forcePushes ? { forcePushes } : {}),
		...(window ? { window: { frame: { x: window.frame.x, y: window.frame.y, width: window.frame.width, height: window.frame.height }, maximized: window.maximized } } : {}),
		...(Object.keys(chopApprovals).length > 0 ? { chopApprovals } : {}),
	}, null, "\t")}\n`;
}
