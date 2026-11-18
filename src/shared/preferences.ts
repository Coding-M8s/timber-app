/**
 * The app's own settings, chosen in the Settings dialog: how the app looks and
 * behaves, never how Timber is configured. They are the `preferences` part of
 * the app's settings file. Everything here is pure.
 */
import { AGENT_PRESETS, type AgentSetting, readAgentSettings, sameAgentSettings, writeAgentSettings } from "./agent";
import { type EditorSetting, readEditorSetting, sameEditorSetting, writeEditorSetting } from "./editor";
import { type ThemeChoice, defaultThemeChoice, readThemeChoice, sameThemeChoice, writeThemeChoice } from "./theme";
import { DEFAULT_ZOOM, readZoom } from "./zoom";
import { type FetchSetting, defaultFetchSetting, readFetchSetting, salvageFetchSetting, sameFetchSetting, writeFetchSetting } from "./fetch-setting";

/** The sides of the window the sidebar can be on. */
export const SIDEBAR_SIDES = ["left", "right"] as const;
export type SidebarSide = typeof SIDEBAR_SIDES[number];

export interface Preferences {
	/** Which side of the window the sidebar is on. */
	sidebarSide: SidebarSide;
	/** The editor that "Open in editor" starts. Null until one is chosen. */
	editor: EditorSetting | null;
	/**
	 * The coding agents the "+" menu of a worktree's sessions starts, in menu
	 * order. Claude Code and Codex until a list is saved; a saved empty list
	 * stays empty. Read whole: one entry that cannot be read puts the presets
	 * back, and the next save of the Agents section writes them.
	 */
	agents: readonly AgentSetting[];
	/** Whether and how often the app fetches every repository in the background. */
	fetch: FetchSetting;
	/** How large the interface is drawn, where 1 is the size the window system gives. */
	zoom: number;
	/** Which theme the app is drawn in, or one for each of the system's light and dark settings. */
	theme: ThemeChoice;
}

/** How one preference is read from outside, compared, and written to the settings file. */
interface PreferencePart<Value> {
	/** The value as the default when nothing was saved. */
	fallback(): Value;
	/** The value, or undefined when what came from outside cannot be read. */
	read(value: unknown): Value | undefined;
	same(one: Value, other: Value): boolean;
	/** The value as it goes into the settings file. */
	write(value: Value): unknown;
	/**
	 * What to keep of a saved value that `read` refuses, instead of the
	 * default, or undefined for the default. Only for reading the settings
	 * file: a change that cannot be read is always refused.
	 */
	salvage?(value: unknown): Value | undefined;
}

/**
 * Every preference, once. Reading, merging, comparing, and writing all go
 * through this table, so a preference added here cannot be left out of any of
 * them, and the type makes leaving it out of the table an error.
 */
export const PREFERENCE_PARTS: { [Key in keyof Preferences]: PreferencePart<Preferences[Key]> } = {
	sidebarSide: {
		fallback: () => "left",
		read: value => SIDEBAR_SIDES.includes(value as SidebarSide) ? value as SidebarSide : undefined,
		same: (one, other) => one === other,
		write: value => value,
	},
	editor: {
		fallback: () => null,
		read: readEditorSetting,
		same: sameEditorSetting,
		write: writeEditorSetting,
	},
	agents: {
		fallback: () => AGENT_PRESETS.map(agent => ({ ...agent })),
		read: readAgentSettings,
		same: sameAgentSettings,
		write: writeAgentSettings,
	},
	fetch: {
		fallback: defaultFetchSetting,
		read: readFetchSetting,
		same: sameFetchSetting,
		write: writeFetchSetting,
		salvage: salvageFetchSetting,
	},
	zoom: {
		fallback: () => DEFAULT_ZOOM,
		read: readZoom,
		same: (one, other) => one === other,
		write: value => value,
	},
	theme: {
		fallback: defaultThemeChoice,
		read: readThemeChoice,
		same: sameThemeChoice,
		write: writeThemeChoice,
	},
};

const PREFERENCE_KEYS = Object.keys(PREFERENCE_PARTS) as (keyof Preferences)[];

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** One preference, typed by its key, for the loops below. */
function partOf<Key extends keyof Preferences>(key: Key): PreferencePart<Preferences[Key]> {
	return PREFERENCE_PARTS[key];
}

export function defaultPreferences(): Preferences {
	const preferences = {} as Record<keyof Preferences, unknown>;
	for (const key of PREFERENCE_KEYS) preferences[key] = partOf(key).fallback();
	return preferences as Preferences;
}

/**
 * Read preferences from a value that came from outside, such as the settings
 * file. Like the layout, they are a convenience, so this never fails: each
 * part that is missing or unreadable falls back to its default, or to what
 * its `salvage` keeps of it, and the rest is kept. Parts this version of the app does not know are left out, so they
 * are lost on the next save, for example after going back to an older build.
 */
export function readPreferences(value: unknown): Preferences {
	const { preferences, unreadable } = applyPreferenceChange(defaultPreferences(), value);
	const read = preferences as Record<keyof Preferences, unknown>;
	for (const key of unreadable) {
		const salvaged = partOf(key).salvage?.((value as Record<string, unknown>)[key]);
		if (salvaged !== undefined) read[key] = salvaged;
	}
	return preferences;
}

/**
 * The preferences with only the parts that a change names replaced. Each
 * section of the Settings dialog saves its own parts, so one section's Save
 * never undoes another's. A named part that cannot be read is left as it
 * was and is listed in `unreadable`, so a save can refuse it instead of
 * claiming it was saved.
 */
export function applyPreferenceChange(preferences: Preferences, change: unknown): { preferences: Preferences; unreadable: (keyof Preferences)[] } {
	const next = { ...preferences } as Record<keyof Preferences, unknown>;
	const unreadable: (keyof Preferences)[] = [];
	if (!isRecord(change)) return { preferences: next as Preferences, unreadable };
	for (const key of PREFERENCE_KEYS) {
		if (!Object.hasOwn(change, key) || change[key] === undefined) continue;
		const value = partOf(key).read(change[key]);
		if (value === undefined) unreadable.push(key);
		else next[key] = value;
	}
	return { preferences: next as Preferences, unreadable };
}

export function samePreferences(one: Preferences, other: Preferences): boolean {
	return PREFERENCE_KEYS.every(key => partOf(key).same(one[key], other[key]));
}

/** The preferences as they go into the settings file. */
export function writePreferences(preferences: Preferences): Record<string, unknown> {
	const written: Record<string, unknown> = {};
	for (const key of PREFERENCE_KEYS) written[key] = partOf(key).write(preferences[key]);
	return written;
}
