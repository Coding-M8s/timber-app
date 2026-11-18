/**
 * What the Theme section of Settings shows and how its choices change, kept
 * pure so it is tested without a window.
 */
import { type Theme, type ThemeChoice, defaultTheme, findTheme } from "../shared/theme";

export const THEME_MODE_LABELS: Record<ThemeChoice["mode"], string> = {
	fixed: "One theme",
	system: "Follow the system's light or dark setting",
};

/**
 * The choice after switching how the theme is picked, keeping what can be
 * kept: the one theme takes the slot of its appearance when following the
 * system, and the system's current slot becomes the one theme.
 */
export function switchThemeMode(choice: ThemeChoice, mode: ThemeChoice["mode"], systemDark: boolean, themes: readonly Theme[]): ThemeChoice {
	if (choice.mode === mode) return choice;
	if (choice.mode === "system") return { mode: "fixed", theme: systemDark ? choice.dark : choice.light };
	const current = findTheme(choice.theme, "dark", themes);
	const light = current.appearance === "light" ? current.id : defaultTheme("light").id;
	const dark = current.appearance === "dark" ? current.id : defaultTheme("dark").id;
	return { mode: "system", light, dark };
}

/** The themes in the order a slot offers them: those of its appearance first, each group in the given order. */
export function themesFor(appearance: Theme["appearance"] | null, themes: readonly Theme[]): Theme[] {
	if (appearance === null) return [...themes];
	return [...themes.filter(theme => theme.appearance === appearance), ...themes.filter(theme => theme.appearance !== appearance)];
}
