import { type Appearance, THEME_STYLE_ID, type Theme, type ThemeChoice, availableThemes, defaultThemeChoice, resolveTheme, themeStyleSheet } from "../shared/theme";
import { setTerminalColors } from "./terminal-colors";

/*
 * The page's theme: the style element named THEME_STYLE_ID, which the main
 * process put there before the page was first drawn (src/bun/theme-preload.ts),
 * and the colors of every terminal.
 */

const SYSTEM_DARK = "(prefers-color-scheme: dark)";

let saved: ThemeChoice = defaultThemeChoice();
/** Every theme there is: the built-in ones and the saved custom ones. */
let themes: readonly Theme[] = availableThemes();
/** What Settings shows while a theme is chosen but not saved yet. */
let preview: ThemeChoice | null = null;
let written: string | null = null;
let listening = false;
/** Whether the theme that shows is a dark or a light one, for what picks its drawing by it, such as the Files panel's icons. */
let appearance: Appearance = "dark";
const appearanceListeners = new Set<() => void>();

function systemIsDark(): boolean {
	return typeof matchMedia === "function" ? matchMedia(SYSTEM_DARK).matches : true;
}

function styleElement(): HTMLStyleElement {
	const existing = document.getElementById(THEME_STYLE_ID);
	if (existing instanceof HTMLStyleElement) return existing;
	const style = document.createElement("style");
	style.id = THEME_STYLE_ID;
	document.head.appendChild(style);
	return style;
}

/** The terminals take their colors from script, and the appearance is read in script, so both follow the system's setting from here. */
function followTheme(): void {
	const theme = resolveTheme(preview ?? saved, systemIsDark(), themes);
	setTerminalColors(theme.terminal);
	if (theme.appearance === appearance) return;
	appearance = theme.appearance;
	for (const listener of appearanceListeners) listener();
}

/** Whether the theme that shows, saved or previewed, is dark or light. */
export function currentAppearance(): Appearance {
	return appearance;
}

/** Hear when the theme that shows turns from dark to light or back. Returns the way to stop. */
export function onAppearanceChange(listener: () => void): () => void {
	appearanceListeners.add(listener);
	return () => appearanceListeners.delete(listener);
}

function apply(): void {
	if (typeof document === "undefined") return;
	const sheet = themeStyleSheet(preview ?? saved, themes);
	// Written only when it changes, so the page is not restyled for nothing.
	if (sheet !== written) {
		styleElement().textContent = sheet;
		written = sheet;
	}
	followTheme();
	if (!listening && typeof matchMedia === "function") {
		matchMedia(SYSTEM_DARK).addEventListener("change", followTheme);
		listening = true;
	}
}

/** Draw the app in the saved choice, with the saved custom themes, unless Settings is showing another choice. */
export function applySavedTheme(choice: ThemeChoice, custom: readonly Theme[] = []): void {
	saved = choice;
	themes = availableThemes(custom);
	apply();
}

/** Show a choice that is not saved yet, or pass null to go back to the saved one. */
export function previewTheme(choice: ThemeChoice | null): void {
	preview = choice;
	apply();
}
