/**
 * The app's own settings, chosen in the Settings dialog and in a few places
 * of the window, such as the chops panel's order: how the app looks and
 * behaves, never how Timber is configured. They are the `preferences` part of
 * the app's settings file. Everything here is pure.
 */
import { AGENT_PRESETS, type AgentSetting, readAgentSettings, sameAgentSettings, writeAgentSettings } from "./agent";
import { type ChopArrangements, readChopArrangements, salvageChopArrangements, sameChopArrangements, writeChopArrangements } from "./chop-order";
import { type PersonalChop, readPersonalChops, salvagePersonalChops, samePersonalChops, writePersonalChops } from "./chops";
import { type EditorSetting, readEditorSetting, sameEditorSetting, writeEditorSetting } from "./editor";
import { readCustomThemes, salvageCustomThemes, sameCustomThemes, writeCustomThemes } from "./custom-themes";
import { type Theme, type ThemeChoice, defaultThemeChoice, readThemeChoice, sameThemeChoice, writeThemeChoice } from "./theme";
import { DEFAULT_ZOOM, readZoom } from "./zoom";
import { type FetchSetting, defaultFetchSetting, readFetchSetting, salvageFetchSetting, sameFetchSetting, writeFetchSetting } from "./fetch-setting";
import { type StateSounds, defaultStateSounds, legacyStateSounds, readStateSounds, salvageStateSounds, sameStateSounds, writeStateSounds } from "./sound-setting";
import { ALERT_STATES, type AlertState } from "./status-notices";
import { type SessionNaming, readSessionNaming } from "./terminal";
import { type DmabufChoice, readDmabufChoice } from "./rendering";
import { type TimberChoice, defaultTimberChoice, readTimberChoice, sameTimberChoice, writeTimberChoice } from "./timber-choice";
import { type TerminalAppearance, defaultTerminalAppearance, readTerminalAppearance, salvageTerminalAppearance, sameTerminalAppearance, writeTerminalAppearance } from "./terminal-appearance";

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
	/**
	 * The person's own chops (./chops.ts), for every repository or for one,
	 * in the order of Settings, Chops. None until some are saved. An entry
	 * that cannot be read is dropped and the rest kept, so a hand edit does
	 * not cost the others.
	 */
	chops: readonly PersonalChop[];
	/**
	 * Whether chops are in use: the title bar's Chops button, the chops
	 * panel, the chop shortcuts, and chops anywhere else in the window. On
	 * by default. Turning it off hides them
	 * and keeps `chops` as it is, so turning it on again brings them back.
	 */
	useChops: boolean;
	/**
	 * The order of each repository's chops in the chops panel, and which are
	 * favorites, by the primary checkout (./chop-order.ts). Saved by the
	 * panel, never in the repository. None until a chop is moved or starred.
	 */
	chopOrder: ChopArrangements;
	/** Whether and how often the app fetches every repository in the background. */
	fetch: FetchSetting;
	/** How large the interface is drawn, where 1 is the size the window system gives. */
	zoom: number;
	/** Which theme the app is drawn in, or one for each of the system's light and dark settings. */
	theme: ThemeChoice;
	/**
	 * The themes the person made or imported, in the order Settings lists
	 * them, after the built-in ones. Saved whole. One in the file that cannot
	 * be read is left out, and a color that cannot be read takes the built-in
	 * theme's.
	 */
	customThemes: readonly Theme[];
	/**
	 * How terminals are drawn: the font family, the text size, and the
	 * cursor's shape. A part of it in the file that cannot be read takes its
	 * default, and a size outside the limits is clamped.
	 */
	terminal: TerminalAppearance;
	/**
	 * How new terminal and agent sessions are named: after the shell or the
	 * agent, after the worktree's branch, or after the issue key in the
	 * branch (see `sessionNameBase` in ./terminal.ts). Plain by default.
	 * Sessions already open keep their names.
	 */
	sessionNames: SessionNaming;
	/**
	 * Whether a desktop notification says when an agent needs the person, is
	 * done, reports an error, or crashed, in a worktree that is not on screen.
	 * On by default.
	 */
	statusNotifications: boolean;
	/** The statuses that get a desktop notification while `statusNotifications` is on. All four by default. */
	notifyStates: readonly AlertState[];
	/**
	 * The sound each status plays: one that comes with the app, the system's,
	 * a file the person chose, or none. None for every status by default, so
	 * the app is quiet until asked. A file from before each status had its
	 * own sound is carried over (see `legacyStateSounds` in ./sound-setting.ts).
	 */
	sounds: StateSounds;
	/**
	 * Whether WebKitGTK uses its DMA-BUF renderer on Linux: Auto decides by the
	 * graphics found (see `autoDmabuf` in ./rendering.ts). Read once at start,
	 * so a change takes effect the next time the app starts.
	 */
	dmabuf: DmabufChoice;
	/**
	 * Which Timber the app runs: the one that comes with the app, the one on
	 * PATH, or a file (see ./timber-choice.ts). Bundled by default. A saved
	 * change makes the app look for Timber again at once.
	 */
	timber: TimberChoice;
}

/**
 * A list of statuses, in Settings order, without repeats. Undefined when it
 * is not a list or names a status the app does not know.
 */
export function readAlertStates(value: unknown): AlertState[] | undefined {
	if (!Array.isArray(value) || !value.every(item => (ALERT_STATES as readonly unknown[]).includes(item))) return undefined;
	return ALERT_STATES.filter(state => value.includes(state));
}

function sameAlertStates(one: readonly AlertState[], other: readonly AlertState[]): boolean {
	return one.length === other.length && one.every(state => other.includes(state));
}

const alertStatesPart = (fallback: () => AlertState[]): PreferencePart<readonly AlertState[]> => ({
	fallback,
	read: readAlertStates,
	same: sameAlertStates,
	write: value => [...value],
});

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
	/**
	 * The value from the parts an older app saved in its place, read only from
	 * the settings file and only when this part is not there, or undefined for
	 * the default.
	 */
	legacy?(saved: Record<string, unknown>): Value | undefined;
	/**
	 * True when the app reads the preference only as it starts, so a saved
	 * change waits for a restart. Settings then offers to restart the app
	 * (see `restartNeededFor`). This is the one place that says so.
	 */
	restart?: true;
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
	chops: {
		fallback: () => [],
		read: readPersonalChops,
		same: samePersonalChops,
		write: writePersonalChops,
		salvage: salvagePersonalChops,
	},
	useChops: {
		fallback: () => true,
		read: value => typeof value === "boolean" ? value : undefined,
		same: (one, other) => one === other,
		write: value => value,
	},
	chopOrder: {
		fallback: () => ({}),
		read: readChopArrangements,
		same: sameChopArrangements,
		write: writeChopArrangements,
		salvage: salvageChopArrangements,
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
	customThemes: {
		fallback: () => [],
		read: readCustomThemes,
		same: sameCustomThemes,
		write: writeCustomThemes,
		salvage: salvageCustomThemes,
	},
	terminal: {
		fallback: defaultTerminalAppearance,
		read: readTerminalAppearance,
		same: sameTerminalAppearance,
		write: writeTerminalAppearance,
		salvage: salvageTerminalAppearance,
	},
	sessionNames: {
		fallback: () => "plain",
		read: readSessionNaming,
		same: (one, other) => one === other,
		write: value => value,
	},
	statusNotifications: {
		fallback: () => true,
		read: value => typeof value === "boolean" ? value : undefined,
		same: (one, other) => one === other,
		write: value => value,
	},
	notifyStates: alertStatesPart(() => [...ALERT_STATES]),
	sounds: {
		fallback: defaultStateSounds,
		read: readStateSounds,
		same: sameStateSounds,
		write: writeStateSounds,
		salvage: salvageStateSounds,
		legacy: legacyStateSounds,
	},
	dmabuf: {
		fallback: () => "auto",
		read: readDmabufChoice,
		same: (one, other) => one === other,
		write: value => value,
		// WebKitGTK reads its variable once, before the window is made.
		restart: true,
	},
	timber: {
		fallback: defaultTimberChoice,
		read: readTimberChoice,
		same: sameTimberChoice,
		write: writeTimberChoice,
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
 * its `salvage` keeps of it, and the rest is kept. A part that is missing
 * takes what its `legacy` reads from the parts an older app saved in its
 * place, if any, and so does one that is there but neither read nor salvaged. Parts this version of the app does not know are left out, so they
 * are lost on the next save, for example after going back to an older build.
 */
export function readPreferences(value: unknown): Preferences {
	const { preferences, unreadable } = applyPreferenceChange(defaultPreferences(), value);
	const read = preferences as Record<keyof Preferences, unknown>;
	const salvaged = new Set<keyof Preferences>();
	for (const key of unreadable) {
		const kept = partOf(key).salvage?.((value as Record<string, unknown>)[key]);
		if (kept !== undefined) {
			read[key] = kept;
			salvaged.add(key);
		}
	}
	if (isRecord(value)) {
		for (const key of PREFERENCE_KEYS) {
			// Read whole or salvaged, the part itself wins over what an older app saved.
			if (value[key] !== undefined && (!unreadable.includes(key) || salvaged.has(key))) continue;
			const carried = partOf(key).legacy?.(value);
			if (carried !== undefined) read[key] = carried;
		}
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

/**
 * The preferences that are read only as the app starts and differ between
 * `atStart`, what this run started with, and `saved`, what is saved now.
 * Empty when nothing saved waits for a restart.
 */
export function restartNeededFor(atStart: Preferences, saved: Preferences): (keyof Preferences)[] {
	return PREFERENCE_KEYS.filter(key => partOf(key).restart === true && !partOf(key).same(atStart[key], saved[key]));
}
