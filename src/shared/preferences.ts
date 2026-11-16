/**
 * The app's own settings, chosen in the Settings dialog: how the app looks and
 * behaves, never how Timber is configured. They are the `preferences` part of
 * the app's settings file. Everything here is pure.
 */

/** The sides of the window the sidebar can be on. */
export const SIDEBAR_SIDES = ["left", "right"] as const;
export type SidebarSide = typeof SIDEBAR_SIDES[number];

export interface Preferences {
	/** Which side of the window the sidebar is on. */
	sidebarSide: SidebarSide;
}

export function defaultPreferences(): Preferences {
	return { sidebarSide: "left" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSidebarSide(value: unknown): value is SidebarSide {
	return SIDEBAR_SIDES.includes(value as SidebarSide);
}

/**
 * Read preferences from a value that came from outside, such as the settings
 * file. Like the layout, they are a convenience, so this never fails: each
 * part that is missing or unreadable falls back to its default, and the rest
 * is kept.
 */
export function readPreferences(value: unknown): Preferences {
	return applyPreferenceChange(defaultPreferences(), value);
}

/**
 * The preferences with only the parts that a change names replaced. Each
 * section of the Settings dialog saves its own parts, so one section's Save
 * never undoes another's. A part of the change that cannot be read is left
 * out, never saved.
 */
export function applyPreferenceChange(preferences: Preferences, change: unknown): Preferences {
	const next = { ...preferences };
	if (!isRecord(change)) return next;
	if (isSidebarSide(change.sidebarSide)) next.sidebarSide = change.sidebarSide;
	return next;
}

export function samePreferences(one: Preferences, other: Preferences): boolean {
	return one.sidebarSide === other.sidebarSide;
}
