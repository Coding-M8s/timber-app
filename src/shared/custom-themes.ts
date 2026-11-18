/**
 * The themes a person made or imported, kept in the preferences beside the
 * choice. Everything here is pure. See docs/architecture.md, "Themes".
 */
import { BUILT_IN_THEMES } from "./builtin-themes";
import { type Theme, readTheme, sameTheme, writeTheme } from "./theme";

/** Every custom theme's id starts with this, so it can never be taken for a built-in one. */
export const CUSTOM_THEME_PREFIX = "custom-";
export const MAX_CUSTOM_THEMES = 50;

const BUILT_IN_IDS = new Set(BUILT_IN_THEMES.map(theme => theme.id));

/** The parts of a theme that say what it is. One that cannot be read leaves nothing worth keeping. */
const IDENTITY = ["theme", "id", "name", "appearance"];

function usableId(id: string): boolean {
	return id.startsWith(CUSTOM_THEME_PREFIX) && id.length > CUSTOM_THEME_PREFIX.length && !BUILT_IN_IDS.has(id);
}

/**
 * The custom themes from outside, such as a save from the interface, or
 * undefined when any of them cannot be read whole, two share an id, or there
 * are too many. Strict, so a save never keeps less than it was asked to.
 */
export function readCustomThemes(value: unknown): Theme[] | undefined {
	if (!Array.isArray(value) || value.length > MAX_CUSTOM_THEMES) return undefined;
	const themes: Theme[] = [];
	for (const entry of value) {
		const { theme, replaced } = readTheme(entry);
		if (replaced.length > 0 || !usableId(theme.id) || themes.some(other => other.id === theme.id)) return undefined;
		themes.push(theme);
	}
	return themes;
}

/**
 * What to keep of saved custom themes that `readCustomThemes` refuses: each
 * one whose id, name, and appearance can be read, with any color that cannot
 * be read taken from the built-in theme of its appearance. A theme whose id
 * is taken already is dropped.
 */
export function salvageCustomThemes(value: unknown): Theme[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const themes: Theme[] = [];
	for (const entry of value) {
		const { theme, replaced } = readTheme(entry);
		if (replaced.some(part => IDENTITY.includes(part)) || !usableId(theme.id) || themes.some(other => other.id === theme.id)) continue;
		themes.push(theme);
		if (themes.length === MAX_CUSTOM_THEMES) break;
	}
	return themes;
}

export function sameCustomThemes(one: readonly Theme[], other: readonly Theme[]): boolean {
	return one.length === other.length && one.every((theme, index) => sameTheme(theme, other[index]!));
}

export function writeCustomThemes(themes: readonly Theme[]): unknown {
	return themes.map(writeTheme);
}

/** A name as an id or a file name takes it: lowercase letters, digits, and single dashes. */
export function slugOf(name: string): string {
	return name
		.normalize("NFKD")
		// Accents come apart from their letters above, and are dropped here.
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40)
		.replace(/-+$/, "");
}

/** A new custom theme's id, from its name, that no theme in `themes` has. */
export function newThemeId(name: string, themes: readonly Theme[]): string {
	const base = `${CUSTOM_THEME_PREFIX}${slugOf(name) || "theme"}`;
	const taken = new Set(themes.map(theme => theme.id));
	if (!taken.has(base)) return base;
	for (let number = 2; ; number++) {
		const id = `${base}-${number}`;
		if (!taken.has(id)) return id;
	}
}

/** Whether a name is free, ignoring case and the spaces around it. A theme can keep its own name. */
export function nameIsFree(name: string, themes: readonly Theme[], ownId: string | null = null): boolean {
	const wanted = name.trim().toLowerCase();
	return !themes.some(theme => theme.id !== ownId && theme.name.trim().toLowerCase() === wanted);
}

/** `name`, or the first of "name 2", "name 3", and so on that no theme has. */
export function freeName(name: string, themes: readonly Theme[]): string {
	if (nameIsFree(name, themes)) return name;
	for (let number = 2; ; number++) {
		const candidate = `${name} ${number}`;
		if (nameIsFree(candidate, themes)) return candidate;
	}
}

/** The name of a copy: "Nord copy", or "Nord copy 2" when that is taken. */
export function copyName(name: string, themes: readonly Theme[]): string {
	return freeName(`${name} copy`, themes);
}
