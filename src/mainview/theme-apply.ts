import { THEME_STYLE_ID, type ThemeChoice, availableThemes, defaultThemeChoice, resolveTheme, sameThemeChoice, themeStyleSheet } from "../shared/theme";
import { setTerminalColors } from "./terminal-colors";

/*
 * The page's theme: the style element named THEME_STYLE_ID, which the main
 * process put there before the page was first drawn (src/bun/theme-preload.ts),
 * and the colors of every terminal.
 */

const SYSTEM_DARK = "(prefers-color-scheme: dark)";

let saved: ThemeChoice = defaultThemeChoice();
/** What Settings shows while a theme is chosen but not saved yet. */
let preview: ThemeChoice | null = null;
let applied: ThemeChoice | null = null;
let listening = false;

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

/** The terminals take their colors from script, so they follow the system's setting from here. */
function colorTerminals(): void {
	setTerminalColors(resolveTheme(preview ?? saved, systemIsDark()).terminal);
}

function apply(): void {
	if (typeof document === "undefined") return;
	const choice = preview ?? saved;
	if (applied === null || !sameThemeChoice(applied, choice)) {
		styleElement().textContent = themeStyleSheet(choice, availableThemes());
		applied = choice;
	}
	colorTerminals();
	if (!listening && typeof matchMedia === "function") {
		matchMedia(SYSTEM_DARK).addEventListener("change", colorTerminals);
		listening = true;
	}
}

/** Draw the app in the saved choice, unless Settings is showing another. */
export function applySavedTheme(choice: ThemeChoice): void {
	saved = choice;
	apply();
}

/** Show a choice that is not saved yet, or pass null to go back to the saved one. */
export function previewTheme(choice: ThemeChoice | null): void {
	preview = choice;
	apply();
}
