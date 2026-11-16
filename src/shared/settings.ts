import { type Layout, readLayout } from "./layout";
import { type Preferences, readPreferences, writePreferences } from "./preferences";

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
}

export interface Settings {
	repositories: SavedRepository[];
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
 * The layout and the preferences are the exception, because they are only a
 * convenience: a part that cannot be read falls back to the defaults (see
 * `readLayout` and `readPreferences`) and never costs the repository list.
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

	const repositories: SavedRepository[] = [];
	for (const entry of listed) {
		const repository = readRepository(entry);
		if (!repository) return null;
		// A file edited by hand may repeat a repository. Keep the first.
		if (!repositories.some(known => known.path === repository.path || known.commonDir === repository.commonDir)) {
			repositories.push(repository);
		}
	}
	const settings: Settings = { repositories };
	if (value.layout !== undefined) settings.layout = readLayout(value.layout);
	if (value.preferences !== undefined) settings.preferences = readPreferences(value.preferences);
	return settings;
}

/** The text of a settings file, readable and stable enough to edit by hand. */
export function serializeSettings(settings: Settings): string {
	const repositories = settings.repositories.map(({ path, commonDir }) => ({ path, commonDir }));
	const layout = settings.layout && { sidebarWidth: settings.layout.sidebarWidth, collapsed: [...settings.layout.collapsed] };
	const preferences = settings.preferences && writePreferences(settings.preferences);
	return `${JSON.stringify({ version: SETTINGS_VERSION, repositories, ...(layout ? { layout } : {}), ...(preferences ? { preferences } : {}) }, null, "\t")}\n`;
}
