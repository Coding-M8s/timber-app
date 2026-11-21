/**
 * How the app looks, as data: every color of the interface and of the
 * terminals. Reading a theme, choosing one, and turning it into a stylesheet
 * are pure. See docs/architecture.md, "Themes".
 */
import { BUILT_IN_THEMES, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "./builtin-themes";
import { contrastRatio, readColor } from "./color";

/**
 * The id of the style element that holds the theme on the page. The main
 * process puts it there before the page is first drawn, and the interface
 * keeps it up to date, so the two never stack.
 */
export const THEME_STYLE_ID = "timber-theme";

export const APPEARANCES = ["dark", "light"] as const;
export type Appearance = typeof APPEARANCES[number];

/**
 * The interface's colors, each with the CSS custom property the stylesheet
 * uses for it. Every color in `src/mainview/styles.css` is one of these.
 */
export const UI_COLOR_PROPERTIES = {
	/** Behind everything: the title bar and the sidebar. */
	bgApp: "--bg-app",
	/** The workspace and dialogs. */
	bgMain: "--bg-main",
	/** Sunken panes, such as a diff. */
	bgPane: "--bg-pane",
	/** What floats over the rest, such as a toast. */
	bgRaised: "--bg-raised",
	/** Hairline dividers. */
	line: "--line",
	/** The edge of what floats: dialogs and toasts. */
	lineRaised: "--line-raised",
	/** Inside a text field that has no frame of its own, such as the filter. */
	fillField: "--fill-field",
	fillHover: "--fill-hover",
	fillSelected: "--fill-selected",
	/** A button under the pointer. */
	fillStrong: "--fill-strong",
	text: "--text",
	text2: "--text-2",
	text3: "--text-3",
	/** The primary button, which is drawn in the text color, under the pointer. */
	primaryHover: "--primary-hover",
	/** Incoming commits. */
	behind: "--behind",
	/** Outgoing commits and running agents. */
	ahead: "--ahead",
	/** Modified files. */
	modified: "--modified",
	/** Untracked and added files. */
	untracked: "--untracked",
	/** Errors, and destructive or rewritten state. */
	error: "--error",
	/** The destructive button under the pointer. */
	errorHover: "--error-hover",
	focus: "--focus",
	diffAdded: "--diff-added",
	diffRemoved: "--diff-removed",
	/** The shadow under small floating things, such as menus and toasts. */
	shadow: "--shadow",
	/** The shadow under dialogs. */
	shadowStrong: "--shadow-strong",
	/** What covers the window behind a dialog. */
	scrim: "--scrim",
} as const;
export type UiColor = keyof typeof UI_COLOR_PROPERTIES;
export const UI_COLORS = Object.keys(UI_COLOR_PROPERTIES) as UiColor[];

/** The terminal's colors, named as xterm.js names them, so they pass to it as they are. */
export const TERMINAL_COLORS = [
	"background",
	"foreground",
	"cursor",
	"cursorAccent",
	"selectionBackground",
	"selectionInactiveBackground",
	"scrollbarSliderBackground",
	"scrollbarSliderHoverBackground",
	"scrollbarSliderActiveBackground",
	"black",
	"red",
	"green",
	"yellow",
	"blue",
	"magenta",
	"cyan",
	"white",
	"brightBlack",
	"brightRed",
	"brightGreen",
	"brightYellow",
	"brightBlue",
	"brightMagenta",
	"brightCyan",
	"brightWhite",
] as const;
export type TerminalColor = typeof TERMINAL_COLORS[number];

/**
 * The terminal's text and sixteen ANSI colors, each with a CSS custom
 * property, for what the interface draws in them too: the File tab's editor
 * colors code with them, so it matches the terminals in every theme.
 */
export const TERMINAL_COLOR_PROPERTIES = {
	foreground: "--terminal-foreground",
	black: "--terminal-black",
	red: "--terminal-red",
	green: "--terminal-green",
	yellow: "--terminal-yellow",
	blue: "--terminal-blue",
	magenta: "--terminal-magenta",
	cyan: "--terminal-cyan",
	white: "--terminal-white",
	brightBlack: "--terminal-bright-black",
	brightRed: "--terminal-bright-red",
	brightGreen: "--terminal-bright-green",
	brightYellow: "--terminal-bright-yellow",
	brightBlue: "--terminal-bright-blue",
	brightMagenta: "--terminal-bright-magenta",
	brightCyan: "--terminal-bright-cyan",
	brightWhite: "--terminal-bright-white",
} as const satisfies Partial<Record<TerminalColor, string>>;

export interface Theme {
	/** What a choice saves. Built-in themes start with "timber-" or the theme's own name. */
	id: string;
	/** As Settings shows it. */
	name: string;
	/** Whether it is a dark or a light theme, for the system's setting and the page's own controls. */
	appearance: Appearance;
	ui: Readonly<Record<UiColor, string>>;
	terminal: Readonly<Record<TerminalColor, string>>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The longest name or id a theme can have. */
const MAX_NAME_LENGTH = 80;

function readName(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const name = value.trim();
	return name.length > 0 && name.length <= MAX_NAME_LENGTH ? name : undefined;
}

/**
 * A theme from outside, such as a file. This never fails: every part that is
 * missing or cannot be read comes from the built-in theme of the same
 * appearance, and is named in `replaced`, so an import can refuse the file
 * instead.
 */
export function readTheme(value: unknown): { theme: Theme; replaced: string[] } {
	const replaced: string[] = [];
	const source = isRecord(value) ? value : {};
	if (!isRecord(value)) replaced.push("theme");
	const appearance = APPEARANCES.includes(source.appearance as Appearance) ? source.appearance as Appearance : undefined;
	if (appearance === undefined) replaced.push("appearance");
	const fallback = defaultTheme(appearance ?? "dark");
	const id = readName(source.id);
	if (id === undefined) replaced.push("id");
	const name = readName(source.name);
	if (name === undefined) replaced.push("name");

	const readColors = <Key extends string>(part: "ui" | "terminal", keys: readonly Key[], defaults: Readonly<Record<Key, string>>) => {
		const given = isRecord(source[part]) ? source[part] : {};
		const colors = {} as Record<Key, string>;
		for (const key of keys) {
			const color = readColor(given[key]);
			if (color === undefined) replaced.push(`${part}.${key}`);
			colors[key] = color ?? defaults[key];
		}
		return colors;
	};
	return {
		theme: {
			id: id ?? fallback.id,
			name: name ?? fallback.name,
			appearance: appearance ?? fallback.appearance,
			ui: readColors("ui", UI_COLORS, fallback.ui),
			terminal: readColors("terminal", TERMINAL_COLORS, fallback.terminal),
		},
		replaced,
	};
}

/**
 * Which theme the app uses: always the same one, or one for each of the
 * system's light and dark settings. Themes are named by id, and an id that
 * names no theme means the default of that appearance.
 */
export type ThemeChoice =
	| { mode: "fixed"; theme: string }
	| { mode: "system"; light: string; dark: string };

export function defaultThemeChoice(): ThemeChoice {
	return { mode: "fixed", theme: DEFAULT_DARK_THEME.id };
}

/** A choice from outside, or undefined when it cannot be read. An id it does not know is kept, as it may be a theme of a later version. */
export function readThemeChoice(value: unknown): ThemeChoice | undefined {
	if (!isRecord(value)) return undefined;
	if (value.mode === "fixed") {
		const theme = readName(value.theme);
		return theme === undefined ? undefined : { mode: "fixed", theme };
	}
	if (value.mode === "system") {
		const light = readName(value.light);
		const dark = readName(value.dark);
		return light === undefined || dark === undefined ? undefined : { mode: "system", light, dark };
	}
	return undefined;
}

export function sameThemeChoice(one: ThemeChoice, other: ThemeChoice): boolean {
	if (one.mode === "fixed" && other.mode === "fixed") return one.theme === other.theme;
	if (one.mode === "system" && other.mode === "system") return one.light === other.light && one.dark === other.dark;
	return false;
}

export function writeThemeChoice(choice: ThemeChoice): unknown {
	return { ...choice };
}

/** Every theme that can be chosen: the built-in ones, then the person's own. */
export function availableThemes(custom: readonly Theme[] = []): readonly Theme[] {
	return custom.length === 0 ? BUILT_IN_THEMES : [...BUILT_IN_THEMES, ...custom];
}

/** A theme as it goes into a file, with its colors always in the same order. */
export function writeTheme(theme: Theme): Theme {
	const ui = {} as Record<UiColor, string>;
	for (const key of UI_COLORS) ui[key] = theme.ui[key];
	const terminal = {} as Record<TerminalColor, string>;
	for (const key of TERMINAL_COLORS) terminal[key] = theme.terminal[key];
	return { id: theme.id, name: theme.name, appearance: theme.appearance, ui, terminal };
}

export function sameTheme(one: Theme, other: Theme): boolean {
	return JSON.stringify(writeTheme(one)) === JSON.stringify(writeTheme(other));
}

/** The app's own theme of an appearance: Timber Dark or Timber Light. */
export function defaultTheme(appearance: Appearance): Theme {
	return appearance === "light" ? DEFAULT_LIGHT_THEME : DEFAULT_DARK_THEME;
}

/** The theme with this id, or the default one of the appearance when there is none. */
export function findTheme(id: string, appearance: Appearance = "dark", themes: readonly Theme[] = availableThemes()): Theme {
	return themes.find(theme => theme.id === id) ?? defaultTheme(appearance);
}

/** The theme a choice shows, given whether the system is set to dark. */
export function resolveTheme(choice: ThemeChoice, systemDark: boolean, themes: readonly Theme[] = availableThemes()): Theme {
	if (choice.mode === "fixed") return findTheme(choice.theme, "dark", themes);
	return systemDark ? findTheme(choice.dark, "dark", themes) : findTheme(choice.light, "light", themes);
}

/** The custom properties of a theme, by name, as a stylesheet or an element's style takes them. */
export function themeVariables(theme: Theme): Record<string, string> {
	const variables: Record<string, string> = {};
	for (const key of UI_COLORS) variables[UI_COLOR_PROPERTIES[key]] = theme.ui[key];
	for (const [key, name] of Object.entries(TERMINAL_COLOR_PROPERTIES)) variables[name] = theme.terminal[key as keyof typeof TERMINAL_COLOR_PROPERTIES];
	return variables;
}

function rule(selector: string, theme: Theme): string {
	const declarations = Object.entries(themeVariables(theme)).map(([name, value]) => `${name}: ${value};`);
	declarations.push(`color-scheme: ${theme.appearance};`);
	return `${selector} { ${declarations.join(" ")} }`;
}

/**
 * The stylesheet that gives the page a choice's colors. Following the system
 * is a media query, so the page changes with the system without any script.
 */
export function themeStyleSheet(choice: ThemeChoice, themes: readonly Theme[] = availableThemes()): string {
	if (choice.mode === "fixed") return rule(":root", resolveTheme(choice, true, themes));
	return `${rule(":root", resolveTheme(choice, false, themes))}\n@media (prefers-color-scheme: dark) { ${rule(":root", resolveTheme(choice, true, themes))} }`;
}

/** The lowest contrast ratios the check asks for: WCAG AA for text, and for the graphics that carry meaning. */
export const CONTRAST_MINIMUMS = { text: 4.5, meaning: 3 } as const;

/** One color that is too close to what it is drawn on. */
export interface ContrastWarning {
	color: UiColor | "terminal.foreground";
	on: UiColor | "terminal.background";
	ratio: number;
	minimum: number;
}

const TEXT_COLORS: readonly UiColor[] = ["text", "text2", "text3"];
const MEANING_COLORS: readonly UiColor[] = ["behind", "ahead", "modified", "untracked", "error", "focus"];
const SURFACES: readonly UiColor[] = ["bgApp", "bgMain", "bgPane", "bgRaised"];

/**
 * The colors of a theme that fall under the minimums on the surfaces they
 * are drawn on, with the ratio rounded down to two decimals. Empty when every
 * one is clear. The sixteen terminal colors are the programs' own and are not
 * checked.
 */
export function contrastWarnings(theme: Theme, minimums: { text: number; meaning: number } = CONTRAST_MINIMUMS): ContrastWarning[] {
	const warnings: ContrastWarning[] = [];
	const check = (color: ContrastWarning["color"], value: string, on: ContrastWarning["on"], background: string, minimum: number) => {
		const ratio = Math.floor(contrastRatio(value, background, theme.ui.bgApp) * 100) / 100;
		if (ratio < minimum) warnings.push({ color, on, ratio, minimum });
	};
	for (const surface of SURFACES) {
		for (const color of TEXT_COLORS) check(color, theme.ui[color], surface, theme.ui[surface], minimums.text);
		for (const color of MEANING_COLORS) check(color, theme.ui[color], surface, theme.ui[surface], minimums.meaning);
	}
	check("terminal.foreground", theme.terminal.foreground, "terminal.background", theme.terminal.background, minimums.text);
	return warnings;
}
