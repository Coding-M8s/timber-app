import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { themePreload } from "../src/bun/theme-preload";
import { TERMINAL_MINIMUM_CONTRAST, setTerminalColors, terminalColors, watchTerminalColors } from "../src/mainview/terminal-colors";
import { switchThemeMode, themesFor } from "../src/mainview/theme-format";
import { BUILT_IN_THEMES, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "../src/shared/builtin-themes";
import { contrastRatio, parseColor, readColor, withAlpha } from "../src/shared/color";
import { applyPreferenceChange, defaultPreferences, readPreferences } from "../src/shared/preferences";
import {
	TERMINAL_COLORS,
	THEME_STYLE_ID,
	UI_COLORS,
	TERMINAL_COLOR_PROPERTIES,
	UI_COLOR_PROPERTIES,
	contrastWarnings,
	defaultThemeChoice,
	TAG_COLORS,
	findTheme,
	readTheme,
	readThemeChoice,
	resolveTheme,
	sameThemeChoice,
	themeStyleSheet,
	themeVariables,
} from "../src/shared/theme";

const STYLES = readFileSync(join(import.meta.dir, "../src/mainview/styles.css"), "utf8");

describe("colors", () => {
	test("read hex and rgb() in the forms a theme takes, written the same way every time", () => {
		expect(readColor("#ABC")).toBe("#aabbcc");
		expect(readColor("#0e0e10")).toBe("#0e0e10");
		expect(readColor(" #FFFFFF ")).toBe("#ffffff");
		expect(readColor("#00000080")).toBe("rgba(0, 0, 0, 0.502)");
		expect(readColor("rgb(1, 2, 3)")).toBe("#010203");
		expect(readColor("rgba(255, 255, 255, 0.06)")).toBe("rgba(255, 255, 255, 0.06)");
		expect(readColor("rgba(0,0,0,1)")).toBe("#000000");
	});

	test("refuse anything else", () => {
		for (const value of [undefined, null, 12, "", "red", "#12", "#12345", "#gggggg", "rgb(256, 0, 0)", "rgba(0, 0, 0, 2)", "rgb(0 0 0)", "var(--text)", "url(x)"]) {
			expect(readColor(value)).toBeUndefined();
		}
	});

	test("measure contrast as WCAG 2 does", () => {
		expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
		expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
		expect(contrastRatio("#777777", "#ffffff")).toBeCloseTo(4.48, 2);
		// A see-through color is measured as it shows over what is below it.
		expect(contrastRatio("rgba(255, 255, 255, 0)", "#000000")).toBe(1);
		expect(contrastRatio("#ffffff", "rgba(0, 0, 0, 0)", "#ffffff")).toBe(1);
	});

	test("withAlpha keeps the color and changes only how see-through it is", () => {
		expect(withAlpha("#73c991", 0.12)).toBe("rgba(115, 201, 145, 0.12)");
		expect(parseColor(withAlpha("#ffffff", 0.5))).toEqual({ r: 255, g: 255, b: 255, a: 0.5 });
		expect(() => withAlpha("blue", 0.5)).toThrow();
	});
});

describe("the built-in themes", () => {
	test("have unique ids and names, and Timber Dark is first and the default", () => {
		expect(new Set(BUILT_IN_THEMES.map(theme => theme.id)).size).toBe(BUILT_IN_THEMES.length);
		expect(new Set(BUILT_IN_THEMES.map(theme => theme.name)).size).toBe(BUILT_IN_THEMES.length);
		expect(BUILT_IN_THEMES[0]).toBe(DEFAULT_DARK_THEME);
		expect(defaultThemeChoice()).toEqual({ mode: "fixed", theme: "timber-dark" });
		expect(BUILT_IN_THEMES.some(theme => theme.appearance === "light")).toBe(true);
	});

	test("give every color, each one readable as it is", () => {
		for (const theme of BUILT_IN_THEMES) {
			expect(Object.keys(theme.ui).sort()).toEqual([...UI_COLORS].sort());
			expect(Object.keys(theme.terminal).sort()).toEqual([...TERMINAL_COLORS].sort());
			for (const color of [...Object.values(theme.ui), ...Object.values(theme.terminal)]) expect(readColor(color)).toBe(color);
			// Read back, a built-in theme is itself, with nothing replaced.
			expect(readTheme(JSON.parse(JSON.stringify(theme)))).toEqual({ theme, replaced: [] });
		}
	});

	test("give five tag colors, none of them a status color, so a tag never reads as a status", () => {
		const statuses = ["behind", "ahead", "modified", "untracked", "error", "merged", "focus"] as const;
		for (const theme of BUILT_IN_THEMES) {
			const tags = TAG_COLORS.map(tag => theme.ui[tag].toLowerCase());
			expect({ id: theme.id, distinct: new Set(tags).size }).toEqual({ id: theme.id, distinct: 5 });
			for (const status of statuses) expect({ id: theme.id, status, clash: tags.includes(theme.ui[status].toLowerCase()) }).toEqual({ id: theme.id, status, clash: false });
		}
	});

	test("pass the contrast check", () => {
		for (const theme of BUILT_IN_THEMES) expect({ id: theme.id, warnings: contrastWarnings(theme) }).toEqual({ id: theme.id, warnings: [] });
	});

	test("Timber Dark keeps the colors the app was designed in", () => {
		expect(DEFAULT_DARK_THEME.ui).toMatchObject({
			bgApp: "#0e0e10",
			bgMain: "#131316",
			bgPane: "#0c0c0e",
			line: "#1f1f23",
			fillHover: "rgba(255, 255, 255, 0.06)",
			fillSelected: "rgba(255, 255, 255, 0.08)",
			text: "#ececef",
			text2: "#a1a1aa",
			text3: "#8a8a94",
			behind: "#e8a857",
			ahead: "#6ea8fe",
			modified: "#e2c08d",
			untracked: "#73c991",
			error: "#f08b80",
			merged: "#c79bf2",
			focus: "#e8a857",
			diffAdded: "rgba(115, 201, 145, 0.12)",
			diffRemoved: "rgba(240, 139, 128, 0.12)",
			diffAddedWord: "rgba(115, 201, 145, 0.28)",
			diffRemovedWord: "rgba(240, 139, 128, 0.28)",
		});
		expect(DEFAULT_DARK_THEME.terminal).toMatchObject({ background: "#0c0c0e", foreground: "#ececef", selectionBackground: "rgba(110, 168, 254, 0.32)", black: "#1f1f23", brightWhite: "#ececef" });
	});
});

describe("contrastWarnings", () => {
	test("name each color that is too close to a surface, with its ratio and the minimum", () => {
		const faint = { ...DEFAULT_DARK_THEME, ui: { ...DEFAULT_DARK_THEME.ui, text3: "#3a3a40", error: "#2a1a1a" } };
		const warnings = contrastWarnings(faint);
		expect(warnings.filter(warning => warning.color === "text3").map(warning => warning.on)).toEqual(["bgApp", "bgMain", "bgPane", "bgRaised", "fillField"]);
		expect(warnings.find(warning => warning.color === "error" && warning.on === "bgMain")).toEqual({ color: "error", on: "bgMain", ratio: expect.any(Number), minimum: 3 });
		for (const warning of warnings) expect(warning.ratio).toBeLessThan(warning.minimum);
		expect(warnings.every(warning => warning.color === "text3" || warning.color === "error")).toBe(true);
	});

	test("check the text on each changed-word tint, laid over its line's tint and the pane", () => {
		const heavy = { ...DEFAULT_DARK_THEME, ui: { ...DEFAULT_DARK_THEME.ui, diffAddedWord: "rgba(236, 236, 239, 0.9)" } };
		const warnings = contrastWarnings(heavy);
		expect(warnings.map(warning => `${warning.color} on ${warning.on}`)).toEqual(["text on diffAddedWord", "terminal.foreground on diffAddedWord"]);
		expect(contrastWarnings(DEFAULT_DARK_THEME)).toEqual([]);
	});

	test("check the terminal's text, and take other minimums when given", () => {
		const terminal = { ...DEFAULT_DARK_THEME, terminal: { ...DEFAULT_DARK_THEME.terminal, foreground: "#202024" } };
		// On the terminal's background, and in a diff, on each changed-word tint.
		expect(contrastWarnings(terminal).map(warning => `${warning.color} on ${warning.on}`)).toEqual(["terminal.foreground on terminal.background", "terminal.foreground on diffAddedWord", "terminal.foreground on diffRemovedWord"]);
		expect(contrastWarnings(DEFAULT_DARK_THEME, { text: 21, meaning: 1 }).every(warning => warning.minimum === 21)).toBe(true);
	});
});

describe("readTheme", () => {
	test("takes every missing or unreadable part from the built-in theme of its appearance, and names it", () => {
		const { theme, replaced } = readTheme({ id: "mine", name: "Mine", appearance: "light", ui: { text: "#101010", bgMain: "not a color" }, terminal: { red: "#ff0000" } });
		expect(theme.id).toBe("mine");
		expect(theme.ui.text).toBe("#101010");
		expect(theme.ui.bgMain).toBe(DEFAULT_LIGHT_THEME.ui.bgMain);
		expect(theme.terminal.red).toBe("#ff0000");
		expect(theme.terminal.green).toBe(DEFAULT_LIGHT_THEME.terminal.green);
		expect(replaced).toContain("ui.bgMain");
		expect(replaced).not.toContain("ui.text");
		expect(replaced).toContain("terminal.green");
		expect(replaced).not.toContain("terminal.red");
	});

	test("a theme saved before the tag colors reads whole, with the built-in theme's tag colors", () => {
		const { tag1: _1, tag2: _2, tag3: _3, tag4: _4, tag5: _5, ...older } = DEFAULT_LIGHT_THEME.ui;
		const { theme, replaced } = readTheme({ ...DEFAULT_LIGHT_THEME, id: "custom-old", ui: older });
		expect(replaced).toEqual([]);
		expect([theme.ui.tag1, theme.ui.tag5]).toEqual([DEFAULT_LIGHT_THEME.ui.tag1, DEFAULT_LIGHT_THEME.ui.tag5]);
		expect(readTheme({ ...DEFAULT_LIGHT_THEME, ui: { ...older, tag2: "#123456" } }).theme.ui.tag2).toBe("#123456");
	});

	test("a theme saved before the changed-word tints reads whole, with tints from its own colors", () => {
		const { diffAddedWord: _added, diffRemovedWord: _removed, ...older } = DEFAULT_LIGHT_THEME.ui;
		const ui = { ...older, untracked: "#117733", error: "#aa2222" };
		const { theme, replaced } = readTheme({ ...DEFAULT_LIGHT_THEME, id: "custom-old", ui });
		expect(replaced).toEqual([]);
		expect(theme.ui.diffAddedWord).toBe(withAlpha("#117733", 0.26));
		expect(theme.ui.diffRemovedWord).toBe(withAlpha("#aa2222", 0.2));
		// Given ones are kept, and one that is not a color is replaced and named, as any other.
		expect(readTheme({ ...DEFAULT_LIGHT_THEME, ui: { ...ui, diffAddedWord: "#00ff00" } }).theme.ui.diffAddedWord).toBe("#00ff00");
		expect(readTheme({ ...DEFAULT_LIGHT_THEME, ui: { ...ui, diffAddedWord: "green-ish" } }).replaced).toEqual(["ui.diffAddedWord"]);
	});

	test("a theme saved before merged pull requests had a color reads whole, with its own terminal magenta for them", () => {
		const { merged: _merged, ...older } = DEFAULT_DARK_THEME.ui;
		const terminal = { ...DEFAULT_DARK_THEME.terminal, magenta: "#bb88ee" };
		const { theme, replaced } = readTheme({ ...DEFAULT_DARK_THEME, id: "custom-old", ui: older, terminal });
		expect(replaced).toEqual([]);
		expect(theme.ui.merged).toBe("#bb88ee");
		expect(readTheme({ ...DEFAULT_DARK_THEME, ui: { ...older, merged: "#aa77dd" } }).theme.ui.merged).toBe("#aa77dd");
		expect(readTheme({ ...DEFAULT_DARK_THEME, ui: { ...older, merged: "purple-ish" } }).replaced).toEqual(["ui.merged"]);
	});

	test("never fails, and gives the default theme for what is not a theme at all", () => {
		for (const value of [undefined, null, 1, "theme", [], { appearance: "sepia" }]) {
			const { theme, replaced } = readTheme(value);
			expect(theme).toEqual(DEFAULT_DARK_THEME);
			expect(replaced.length).toBeGreaterThan(0);
		}
		expect(readTheme({ id: " ", name: "x".repeat(81) }).replaced).toEqual(expect.arrayContaining(["id", "name", "appearance"]));
	});
});

describe("the theme choice", () => {
	test("reads either one theme or one for each of the system's settings, keeping ids it does not know", () => {
		expect(readThemeChoice({ mode: "fixed", theme: "nord" })).toEqual({ mode: "fixed", theme: "nord" });
		expect(readThemeChoice({ mode: "fixed", theme: "from-a-later-version" })).toEqual({ mode: "fixed", theme: "from-a-later-version" });
		expect(readThemeChoice({ mode: "system", light: "timber-light", dark: "nord", later: 1 })).toEqual({ mode: "system", light: "timber-light", dark: "nord" });
		for (const value of [undefined, "nord", {}, { mode: "fixed" }, { mode: "fixed", theme: "" }, { mode: "system", light: "timber-light" }, { mode: "auto", theme: "nord" }]) {
			expect(readThemeChoice(value)).toBeUndefined();
		}
	});

	test("is a preference: saved, read back, and left as it was when a change cannot be read", () => {
		const choice = { mode: "system" as const, light: "solarized-light", dark: "gruvbox-dark" };
		const { preferences } = applyPreferenceChange(defaultPreferences(), { theme: choice });
		expect(readPreferences(JSON.parse(JSON.stringify(preferences))).theme).toEqual(choice);
		expect(applyPreferenceChange(preferences, { theme: { mode: "system" } })).toEqual({ preferences, unreadable: ["theme"] });
		expect(readPreferences({ theme: "dark" }).theme).toEqual(defaultThemeChoice());
	});

	test("are compared by what they choose", () => {
		expect(sameThemeChoice({ mode: "fixed", theme: "nord" }, { mode: "fixed", theme: "nord" })).toBe(true);
		expect(sameThemeChoice({ mode: "fixed", theme: "nord" }, { mode: "fixed", theme: "timber-dark" })).toBe(false);
		expect(sameThemeChoice({ mode: "system", light: "a", dark: "b" }, { mode: "system", light: "a", dark: "b" })).toBe(true);
		expect(sameThemeChoice({ mode: "system", light: "a", dark: "b" }, { mode: "system", light: "a", dark: "c" })).toBe(false);
		expect(sameThemeChoice({ mode: "fixed", theme: "a" }, { mode: "system", light: "a", dark: "a" })).toBe(false);
	});

	test("resolve to a theme, falling back to the app's own of the appearance for an id that names none", () => {
		expect(resolveTheme({ mode: "fixed", theme: "nord" }, false).id).toBe("nord");
		expect(resolveTheme({ mode: "fixed", theme: "gone" }, false)).toBe(DEFAULT_DARK_THEME);
		const system = { mode: "system" as const, light: "solarized-light", dark: "nord" };
		expect(resolveTheme(system, true).id).toBe("nord");
		expect(resolveTheme(system, false).id).toBe("solarized-light");
		expect(resolveTheme({ mode: "system", light: "gone", dark: "gone" }, false)).toBe(DEFAULT_LIGHT_THEME);
		expect(findTheme("gone", "light")).toBe(DEFAULT_LIGHT_THEME);
	});
});

describe("the theme's stylesheet", () => {
	test("sets every custom property and the color scheme on the root", () => {
		const sheet = themeStyleSheet({ mode: "fixed", theme: "timber-light" });
		expect(sheet.startsWith(":root { ")).toBe(true);
		for (const [name, value] of Object.entries(themeVariables(DEFAULT_LIGHT_THEME))) expect(sheet).toContain(`${name}: ${value};`);
		expect(sheet).toContain("color-scheme: light;");
		expect(sheet).not.toContain("@media");
	});

	test("follows the system with a media query, the light theme first", () => {
		const sheet = themeStyleSheet({ mode: "system", light: "timber-light", dark: "nord" });
		const [light, dark] = sheet.split("@media (prefers-color-scheme: dark)") as [string, string];
		expect(light).toContain(`--bg-main: ${DEFAULT_LIGHT_THEME.ui.bgMain};`);
		expect(dark).toContain(`--bg-main: ${findTheme("nord").ui.bgMain};`);
		expect(dark).toContain("color-scheme: dark;");
	});

	test("defines every custom property the stylesheet uses, and the stylesheet has no color of its own", () => {
		const defined = new Set([...Object.values(UI_COLOR_PROPERTIES), ...Object.values(TERMINAL_COLOR_PROPERTIES), "--font-ui", "--font-mono", "--font-terminal", "--sidebar-width", "--chops-width", "--steady-height", "--tag"]);
		const used = new Set([...STYLES.matchAll(/var\((--[a-z0-9-]+)/g)].map(match => match[1]!));
		expect([...used].filter(name => !defined.has(name))).toEqual([]);
		const withoutComments = STYLES.replace(/\/\*[\s\S]*?\*\//g, "");
		expect(withoutComments.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|\b(?:white|black)\b(?!-)|color-scheme/gi)).toBeNull();
	});
});

describe("the preload script", () => {
	/** A page as the window has it at the start of a load: a root element and nothing else yet. */
	function startingPage(withRoot = true) {
		const added: { id: string; textContent: string }[] = [];
		const root = { appendChild: (element: { id: string; textContent: string }) => added.push(element) };
		const observers: (() => void)[] = [];
		const page = {
			documentElement: withRoot ? root : null,
			head: null,
			getElementById: (id: string) => added.find(element => element.id === id) ?? null,
			createElement: () => ({ id: "", textContent: "" }),
		};
		class MutationObserver {
			constructor(private readonly callback: () => void) {}
			observe() {
				observers.push(this.callback);
			}
			disconnect() {}
		}
		return { page, added, observers, MutationObserver, root };
	}

	test("puts the stylesheet on the page under the theme's id, once", () => {
		const sheet = themeStyleSheet({ mode: "fixed", theme: "nord" });
		const { page, added, MutationObserver } = startingPage();
		new Function("document", "MutationObserver", themePreload(sheet))(page, MutationObserver);
		new Function("document", "MutationObserver", themePreload(sheet))(page, MutationObserver);
		expect(added).toEqual([{ id: THEME_STYLE_ID, textContent: sheet }]);
	});

	test("waits for the root element when there is none yet, and never throws", () => {
		const { page, added, observers, MutationObserver, root } = startingPage(false);
		new Function("document", "MutationObserver", themePreload("</style><script> "))(page, MutationObserver);
		expect(added).toEqual([]);
		page.documentElement = root;
		for (const observer of observers) observer();
		expect(added).toEqual([{ id: THEME_STYLE_ID, textContent: "</style><script> " }]);
		expect(() => new Function("document", "MutationObserver", themePreload(""))(null, MutationObserver)).not.toThrow();
	});
});

describe("choosing in Settings", () => {
	const themes = BUILT_IN_THEMES;

	test("following the system keeps the one theme in the slot of its appearance", () => {
		expect(switchThemeMode({ mode: "fixed", theme: "nord" }, "system", true, themes)).toEqual({ mode: "system", light: "timber-light", dark: "nord" });
		expect(switchThemeMode({ mode: "fixed", theme: "solarized-light" }, "system", true, themes)).toEqual({ mode: "system", light: "solarized-light", dark: "timber-dark" });
	});

	test("going back to one theme keeps the one the system shows now", () => {
		const system = { mode: "system" as const, light: "solarized-light", dark: "nord" };
		expect(switchThemeMode(system, "fixed", true, themes)).toEqual({ mode: "fixed", theme: "nord" });
		expect(switchThemeMode(system, "fixed", false, themes)).toEqual({ mode: "fixed", theme: "solarized-light" });
		expect(switchThemeMode(system, "system", false, themes)).toBe(system);
	});

	test("each slot lists the themes of its appearance first", () => {
		const light = themesFor("light", themes);
		expect(light.map(theme => theme.appearance).indexOf("dark")).toBe(themes.filter(theme => theme.appearance === "light").length);
		expect(light).toHaveLength(themes.length);
		expect(themesFor(null, themes)).toEqual([...themes]);
	});
});

describe("the terminals' colors", () => {
	test("start as Timber Dark's, and every watcher hears each change until it stops", () => {
		expect(terminalColors()).toBe(DEFAULT_DARK_THEME.terminal);
		const heard: string[] = [];
		const stop = watchTerminalColors(colors => heard.push(colors.background));
		setTerminalColors(DEFAULT_LIGHT_THEME.terminal);
		// The same colors again are no change.
		setTerminalColors(DEFAULT_LIGHT_THEME.terminal);
		stop();
		setTerminalColors(DEFAULT_DARK_THEME.terminal);
		expect(heard).toEqual([DEFAULT_LIGHT_THEME.terminal.background]);
		expect(terminalColors()).toBe(DEFAULT_DARK_THEME.terminal);
	});

	test("Timber Dark's greys are the interface's own, and readable on the pane without help", () => {
		const terminal = DEFAULT_DARK_THEME.terminal;
		expect(terminal.white).toBe(DEFAULT_DARK_THEME.ui.text2);
		expect(terminal.brightBlack).toBe(DEFAULT_DARK_THEME.ui.text3);
		for (const grey of [terminal.white, terminal.brightBlack]) expect(contrastRatio(grey, terminal.background)).toBeGreaterThanOrEqual(TERMINAL_MINIMUM_CONTRAST);
	});

	test("every terminal, the theme maker's sample included, draws text at the minimum contrast", () => {
		expect(TERMINAL_MINIMUM_CONTRAST).toBe(4.5);
		for (const file of ["terminal-view.ts", "terminal-sample-view.ts"]) {
			const source = readFileSync(join(import.meta.dir, "../src/mainview", file), "utf8");
			expect(source).toContain("minimumContrastRatio: TERMINAL_MINIMUM_CONTRAST");
		}
	});
});
