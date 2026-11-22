/**
 * What the Theme section of Settings shows and how its choices change, kept
 * pure so it is tested without a window.
 */
import { formatColor, parseColor, readColor } from "../shared/color";
import { copyName, nameIsFree, newThemeId } from "../shared/custom-themes";
import { type Appearance, type ContrastWarning, type TerminalColor, type Theme, type ThemeChoice, type UiColor, contrastWarnings, defaultTheme, findTheme, sameTheme } from "../shared/theme";

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

/** What each interface color is called in the maker, and what it is for. */
export const UI_COLOR_LABELS: Record<UiColor, string> = {
	bgApp: "Sidebar and title bar",
	bgMain: "Workspace and dialogs",
	bgPane: "Sunken panes",
	bgRaised: "Toasts",
	line: "Dividers",
	lineRaised: "Edges of dialogs and toasts",
	fillField: "Filter field and repository headers",
	fillHover: "Under the pointer",
	fillSelected: "Selected",
	fillStrong: "Button under the pointer",
	text: "Text",
	text2: "Secondary text",
	text3: "Faint text",
	primaryHover: "Primary button under the pointer",
	behind: "Incoming commits",
	ahead: "Outgoing commits and running agents",
	modified: "Modified files",
	untracked: "Untracked files",
	error: "Errors and destructive actions",
	errorHover: "Destructive button under the pointer",
	focus: "Focus ring",
	diffAdded: "Added lines",
	diffRemoved: "Removed lines",
	shadow: "Shadow under menus and toasts",
	shadowStrong: "Shadow under dialogs",
	scrim: "Behind a dialog",
};

export const TERMINAL_COLOR_LABELS: Record<TerminalColor, string> = {
	background: "Background",
	foreground: "Text",
	cursor: "Cursor",
	cursorAccent: "Text under the cursor",
	selectionBackground: "Selection",
	selectionInactiveBackground: "Selection while elsewhere",
	scrollbarSliderBackground: "Scroll bar",
	scrollbarSliderHoverBackground: "Scroll bar under the pointer",
	scrollbarSliderActiveBackground: "Scroll bar while dragged",
	black: "Black",
	red: "Red",
	green: "Green",
	yellow: "Yellow",
	blue: "Blue",
	magenta: "Magenta",
	cyan: "Cyan",
	white: "White",
	brightBlack: "Bright black",
	brightRed: "Bright red",
	brightGreen: "Bright green",
	brightYellow: "Bright yellow",
	brightBlue: "Bright blue",
	brightMagenta: "Bright magenta",
	brightCyan: "Bright cyan",
	brightWhite: "Bright white",
};

/** The maker's groups of colors, in order. Every color is in exactly one. */
export const COLOR_GROUPS: readonly { title: string; part: "ui" | "terminal"; keys: readonly (UiColor | TerminalColor)[] }[] = [
	{ title: "Surfaces", part: "ui", keys: ["bgApp", "bgMain", "bgPane", "bgRaised"] },
	{ title: "Text", part: "ui", keys: ["text", "text2", "text3"] },
	{ title: "Meaning", part: "ui", keys: ["behind", "ahead", "modified", "untracked", "error", "focus"] },
	{ title: "Lines and fills", part: "ui", keys: ["line", "lineRaised", "fillField", "fillHover", "fillSelected", "fillStrong", "primaryHover", "errorHover"] },
	{ title: "Diffs", part: "ui", keys: ["diffAdded", "diffRemoved"] },
	{ title: "Shadows", part: "ui", keys: ["shadow", "shadowStrong", "scrim"] },
	{ title: "Terminal", part: "terminal", keys: ["background", "foreground", "cursor", "cursorAccent", "selectionBackground", "selectionInactiveBackground", "scrollbarSliderBackground", "scrollbarSliderHoverBackground", "scrollbarSliderActiveBackground"] },
	{ title: "Terminal colors", part: "terminal", keys: ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white", "brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite"] },
];

/** The contrast levels the maker checks against: WCAG AA, or the stricter AAA. */
export const CONTRAST_LEVELS = {
	aa: { label: "WCAG AA: text 4.5:1, meaning colors 3:1", minimums: { text: 4.5, meaning: 3 } },
	aaa: { label: "WCAG AAA: text 7:1, meaning colors 4.5:1", minimums: { text: 7, meaning: 4.5 } },
} as const;
export type ContrastLevel = keyof typeof CONTRAST_LEVELS;

/** A theme as the maker holds it while it is changed: each color as typed, which may not be a color yet. */
export interface ThemeDraft {
	/** The id of the custom theme being changed, or null for a new one. */
	id: string | null;
	name: string;
	appearance: Appearance;
	ui: Record<UiColor, string>;
	terminal: Record<TerminalColor, string>;
}

/** A draft of a new theme that starts as a copy of `from`. */
export function draftFrom(from: Theme, themes: readonly Theme[]): ThemeDraft {
	return { id: null, name: copyName(from.name, themes), appearance: from.appearance, ui: { ...from.ui }, terminal: { ...from.terminal } };
}

/** A draft of a custom theme as it is saved. */
export function draftOf(theme: Theme): ThemeDraft {
	return { id: theme.id, name: theme.name, appearance: theme.appearance, ui: { ...theme.ui }, terminal: { ...theme.terminal } };
}

export interface DraftModel {
	/** The theme to save, or null while something cannot be saved. */
	theme: Theme | null;
	/** What the previews draw: each color that cannot be read yet keeps the one it started from. */
	preview: Theme;
	nameError: string | null;
	/** The colors, as "ui.text" or "terminal.red", that are not colors. */
	unreadable: string[];
	warnings: ContrastWarning[];
	/** Whether anything differs from the theme the draft started from. */
	changed: boolean;
}

/**
 * What the maker shows for a draft. `themes` is every theme there is, to
 * keep names apart; `start` is the theme the draft started from, which
 * stands in for a color that cannot be read yet.
 */
export function draftModel(draft: ThemeDraft, start: Theme, themes: readonly Theme[], level: ContrastLevel): DraftModel {
	const unreadable: string[] = [];
	const ui = {} as Record<UiColor, string>;
	const terminal = {} as Record<TerminalColor, string>;
	for (const key of Object.keys(draft.ui) as UiColor[]) {
		const color = readColor(draft.ui[key]);
		if (color === undefined) unreadable.push(`ui.${key}`);
		ui[key] = color ?? start.ui[key];
	}
	for (const key of Object.keys(draft.terminal) as TerminalColor[]) {
		const color = readColor(draft.terminal[key]);
		if (color === undefined) unreadable.push(`terminal.${key}`);
		terminal[key] = color ?? start.terminal[key];
	}
	const name = draft.name.trim();
	let nameError: string | null = null;
	if (name === "") nameError = "A theme needs a name.";
	else if (name.length > 80) nameError = "A name can be at most 80 characters long.";
	else if (!nameIsFree(name, themes, draft.id)) nameError = `There is a theme called ${name} already.`;
	const preview: Theme = { id: draft.id ?? newThemeId(name, themes), name: name || start.name, appearance: draft.appearance, ui, terminal };
	const changed = draft.id === null || !sameTheme(preview, start) || name !== start.name;
	return {
		theme: nameError === null && unreadable.length === 0 ? { ...preview, name } : null,
		preview,
		nameError,
		unreadable,
		warnings: contrastWarnings(preview, CONTRAST_LEVELS[level].minimums),
		changed,
	};
}

/** The value a color picker takes for a color: the color without its alpha, as six hex digits. */
export function pickerValue(color: string): string {
	const parsed = parseColor(color);
	return parsed === undefined ? "#000000" : formatColor({ ...parsed, a: 1 });
}

/** A color picked from the picker, keeping the alpha the color had. */
export function pickedColor(current: string, picked: string): string {
	const alpha = parseColor(current)?.a ?? 1;
	const color = parseColor(picked);
	return color === undefined ? current : formatColor({ ...color, a: alpha });
}

/** What a contrast warning says, such as "Faint text on Sunken panes: 3.21:1, needs 4.5:1". */
export function describeWarning(warning: ContrastWarning): string {
	const label = (key: string) => key.startsWith("terminal.") ? `Terminal ${TERMINAL_COLOR_LABELS[key.slice(9) as TerminalColor].toLowerCase()}` : UI_COLOR_LABELS[key as UiColor];
	return `${label(warning.color)} on ${label(warning.on).toLowerCase()}: ${warning.ratio}:1, needs ${warning.minimum}:1`;
}

/** The choice with this theme in use: as the one theme, or in the system's slot of its appearance. */
export function choosing(choice: ThemeChoice, theme: Theme): ThemeChoice {
	if (choice.mode === "fixed") return { mode: "fixed", theme: theme.id };
	return theme.appearance === "light" ? { ...choice, light: theme.id } : { ...choice, dark: theme.id };
}

/** The choice without a theme that is going away: where it was used, the app's own theme of that slot takes its place. */
export function withoutTheme(choice: ThemeChoice, id: string): ThemeChoice {
	if (choice.mode === "fixed") return choice.theme === id ? { mode: "fixed", theme: defaultTheme("dark").id } : choice;
	return {
		mode: "system",
		light: choice.light === id ? defaultTheme("light").id : choice.light,
		dark: choice.dark === id ? defaultTheme("dark").id : choice.dark,
	};
}

/** Whether a choice uses a theme. */
export function uses(choice: ThemeChoice, id: string): boolean {
	return choice.mode === "fixed" ? choice.theme === id : choice.light === id || choice.dark === id;
}
