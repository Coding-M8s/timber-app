/**
 * The themes that come with the app. Timber Dark is the look the app was
 * designed in; the others are well known palettes, set out the same way.
 * Where a palette's own color was too faint on its own background for text
 * or for a meaning color, a nearby shade of it is used, so every built-in
 * theme passes the contrast check (tests/theme.test.ts). The palettes'
 * notices are in licenses/theme-palettes.txt.
 */
import { withAlpha } from "./color";
import type { Appearance, TerminalColor, Theme, UiColor } from "./theme";

/** The colors a palette gives. The rest of a theme follows from them. */
interface Palette {
	bgApp: string;
	bgMain: string;
	bgPane: string;
	bgRaised: string;
	line: string;
	text: string;
	text2: string;
	text3: string;
	primaryHover: string;
	behind: string;
	ahead: string;
	modified: string;
	untracked: string;
	error: string;
	errorHover: string;
	/** The focus ring. The incoming color unless the palette says otherwise. */
	focus?: string;
	/** The sixteen ANSI colors, black to bright white. */
	ansi: readonly [string, string, string, string, string, string, string, string, string, string, string, string, string, string, string, string];
}

const ANSI_NAMES: readonly TerminalColor[] = [
	"black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
	"brightBlack", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
];

/** The see-through fills and shadows: light over a dark theme, dark over a light one. */
const FILLS: Record<Appearance, Pick<Record<UiColor, string>, "lineRaised" | "fillField" | "fillHover" | "fillSelected" | "fillStrong" | "shadow" | "shadowStrong" | "scrim">> = {
	dark: {
		lineRaised: "rgba(255, 255, 255, 0.1)",
		fillField: "rgba(255, 255, 255, 0.04)",
		fillHover: "rgba(255, 255, 255, 0.06)",
		fillSelected: "rgba(255, 255, 255, 0.08)",
		fillStrong: "rgba(255, 255, 255, 0.12)",
		shadow: "rgba(0, 0, 0, 0.45)",
		shadowStrong: "rgba(0, 0, 0, 0.6)",
		scrim: "rgba(0, 0, 0, 0.55)",
	},
	light: {
		lineRaised: "rgba(0, 0, 0, 0.1)",
		fillField: "rgba(0, 0, 0, 0.04)",
		fillHover: "rgba(0, 0, 0, 0.05)",
		fillSelected: "rgba(0, 0, 0, 0.07)",
		fillStrong: "rgba(0, 0, 0, 0.1)",
		shadow: "rgba(0, 0, 0, 0.14)",
		shadowStrong: "rgba(0, 0, 0, 0.22)",
		scrim: "rgba(0, 0, 0, 0.3)",
	},
};

function theme(id: string, name: string, appearance: Appearance, palette: Palette): Theme {
	const { ansi, focus, ...colors } = palette;
	const terminal = {} as Record<TerminalColor, string>;
	ANSI_NAMES.forEach((key, index) => {
		terminal[key] = ansi[index]!;
	});
	const scrollbar = appearance === "dark" ? "255, 255, 255" : "0, 0, 0";
	return {
		id,
		name,
		appearance,
		ui: {
			...colors,
			...FILLS[appearance],
			focus: focus ?? colors.behind,
			diffAdded: withAlpha(colors.untracked, appearance === "dark" ? 0.12 : 0.14),
			diffRemoved: withAlpha(colors.error, appearance === "dark" ? 0.12 : 0.1),
		},
		terminal: {
			...terminal,
			background: colors.bgPane,
			foreground: colors.text,
			cursor: colors.text,
			cursorAccent: colors.bgPane,
			selectionBackground: withAlpha(colors.ahead, appearance === "dark" ? 0.32 : 0.22),
			selectionInactiveBackground: `rgba(${scrollbar}, ${appearance === "dark" ? 0.14 : 0.1})`,
			scrollbarSliderBackground: `rgba(${scrollbar}, ${appearance === "dark" ? 0.1 : 0.12})`,
			scrollbarSliderHoverBackground: `rgba(${scrollbar}, ${appearance === "dark" ? 0.18 : 0.2})`,
			scrollbarSliderActiveBackground: `rgba(${scrollbar}, ${appearance === "dark" ? 0.26 : 0.28})`,
		},
	};
}

/** The look the app was designed in, and the default. */
export const DEFAULT_DARK_THEME: Theme = theme("timber-dark", "Timber Dark", "dark", {
	bgApp: "#0e0e10",
	bgMain: "#131316",
	bgPane: "#0c0c0e",
	bgRaised: "#1c1c20",
	line: "#1f1f23",
	text: "#ececef",
	text2: "#a1a1aa",
	text3: "#8a8a94",
	primaryHover: "#ffffff",
	behind: "#e8a857",
	ahead: "#6ea8fe",
	modified: "#e2c08d",
	untracked: "#73c991",
	error: "#f08b80",
	errorHover: "#f6a399",
	ansi: [
		"#1f1f23", "#f08b80", "#73c991", "#e2c08d", "#6ea8fe", "#c79bf2", "#6ccfd8", "#a1a1aa",
		"#5c5c66", "#ffa79d", "#93deac", "#f0d4a6", "#94c0ff", "#dab8f7", "#93e2e9", "#ececef",
	],
});

/** Timber Dark's colors on a light ground. */
export const DEFAULT_LIGHT_THEME: Theme = theme("timber-light", "Timber Light", "light", {
	bgApp: "#f4f4f5",
	bgMain: "#ffffff",
	bgPane: "#fafafa",
	bgRaised: "#ffffff",
	line: "#e4e4e7",
	text: "#18181b",
	text2: "#52525b",
	text3: "#686872",
	primaryHover: "#000000",
	behind: "#b45309",
	ahead: "#1d4ed8",
	modified: "#8a6100",
	untracked: "#15803d",
	error: "#c62828",
	errorHover: "#a51f1f",
	ansi: [
		"#18181b", "#c62828", "#15803d", "#8a6100", "#1d4ed8", "#9333ea", "#0e7490", "#71717a",
		"#52525b", "#dc2626", "#16a34a", "#a16207", "#2563eb", "#a855f7", "#0891b2", "#3f3f46",
	],
});

const SOLARIZED = { yellow: "#b58900", orange: "#cb4b16", red: "#dc322f", magenta: "#d33682", violet: "#6c71c4", blue: "#268bd2", cyan: "#2aa198", green: "#859900" };

const SOLARIZED_DARK = theme("solarized-dark", "Solarized Dark", "dark", {
	bgApp: "#00252f",
	bgMain: "#002b36",
	bgPane: "#00212b",
	bgRaised: "#073642",
	line: "#0a3c48",
	text: "#eee8d5",
	text2: "#b0bab7",
	text3: "#93a1a1",
	primaryHover: "#fdf6e3",
	behind: "#e0703f",
	ahead: "#4ea2e0",
	modified: SOLARIZED.yellow,
	untracked: SOLARIZED.green,
	error: "#e8605d",
	errorHover: "#f07c79",
	ansi: [
		"#073642", SOLARIZED.red, SOLARIZED.green, SOLARIZED.yellow, SOLARIZED.blue, SOLARIZED.magenta, SOLARIZED.cyan, "#eee8d5",
		"#586e75", SOLARIZED.orange, SOLARIZED.green, SOLARIZED.yellow, SOLARIZED.blue, SOLARIZED.violet, SOLARIZED.cyan, "#fdf6e3",
	],
});

const SOLARIZED_LIGHT = theme("solarized-light", "Solarized Light", "light", {
	bgApp: "#eee8d5",
	bgMain: "#fdf6e3",
	bgPane: "#f7f0dc",
	bgRaised: "#fdf6e3",
	line: "#e4ddc8",
	text: "#073642",
	text2: "#4c5f66",
	text3: "#55676e",
	primaryHover: "#002b36",
	behind: "#b5400f",
	ahead: "#1f74b0",
	modified: "#8c6a00",
	untracked: "#617000",
	error: "#c42b28",
	errorHover: "#a82422",
	ansi: [
		"#073642", SOLARIZED.red, SOLARIZED.green, SOLARIZED.yellow, SOLARIZED.blue, SOLARIZED.magenta, SOLARIZED.cyan, "#93a1a1",
		"#586e75", SOLARIZED.orange, SOLARIZED.green, SOLARIZED.yellow, SOLARIZED.blue, SOLARIZED.violet, SOLARIZED.cyan, "#002b36",
	],
});

const NORD = theme("nord", "Nord", "dark", {
	bgApp: "#2a2f3a",
	bgMain: "#2e3440",
	bgPane: "#272c36",
	bgRaised: "#3b4252",
	line: "#3b4252",
	text: "#eceff4",
	text2: "#d8dee9",
	text3: "#a7b1c2",
	primaryHover: "#ffffff",
	behind: "#d08770",
	ahead: "#88c0d0",
	modified: "#ebcb8b",
	untracked: "#a3be8c",
	error: "#d97b84",
	errorHover: "#e3949b",
	ansi: [
		"#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0",
		"#616e88", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4",
	],
});

const GRUVBOX_DARK = theme("gruvbox-dark", "Gruvbox Dark", "dark", {
	bgApp: "#1d2021",
	bgMain: "#282828",
	bgPane: "#1b1d1e",
	bgRaised: "#3c3836",
	line: "#3c3836",
	text: "#ebdbb2",
	text2: "#d5c4a1",
	text3: "#bdae93",
	primaryHover: "#fbf1c7",
	behind: "#fe8019",
	ahead: "#83a598",
	modified: "#fabd2f",
	untracked: "#b8bb26",
	error: "#fb4934",
	errorHover: "#fc6d5c",
	ansi: [
		"#282828", "#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a", "#a89984",
		"#928374", "#fb4934", "#b8bb26", "#fabd2f", "#83a598", "#d3869b", "#8ec07c", "#ebdbb2",
	],
});

const CATPPUCCIN_MOCHA = theme("catppuccin-mocha", "Catppuccin Mocha", "dark", {
	bgApp: "#181825",
	bgMain: "#1e1e2e",
	bgPane: "#11111b",
	bgRaised: "#313244",
	line: "#313244",
	text: "#cdd6f4",
	text2: "#bac2de",
	text3: "#a6adc8",
	primaryHover: "#ffffff",
	behind: "#fab387",
	ahead: "#89b4fa",
	modified: "#f9e2af",
	untracked: "#a6e3a1",
	error: "#f38ba8",
	errorHover: "#f5a3ba",
	ansi: [
		"#45475a", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#bac2de",
		"#585b70", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#a6adc8",
	],
});

/** Every built-in theme, in the order Settings lists them: the app's own first, then dark ones, then light ones. */
export const BUILT_IN_THEMES: readonly Theme[] = [
	DEFAULT_DARK_THEME,
	DEFAULT_LIGHT_THEME,
	CATPPUCCIN_MOCHA,
	GRUVBOX_DARK,
	NORD,
	SOLARIZED_DARK,
	SOLARIZED_LIGHT,
];
