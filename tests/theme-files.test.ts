import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSavedPreferences } from "../src/bun/preferences";
import { createSettingsHolder } from "../src/bun/settings";
import { createThemeFiles } from "../src/bun/theme-files";
import { createMockThemeFiles } from "../src/mainview/engine/mock-theme-files";
import {
	choosing,
	describeWarning,
	draftFrom,
	draftModel,
	draftOf,
	pickedColor,
	pickerValue,
	uses,
	withoutTheme,
	COLOR_GROUPS,
} from "../src/mainview/theme-format";
import { BUILT_IN_THEMES, DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "../src/shared/builtin-themes";
import { MAX_CUSTOM_THEMES, copyName, freeName, nameIsFree, newThemeId, readCustomThemes, salvageCustomThemes, slugOf } from "../src/shared/custom-themes";
import { readPreferences } from "../src/shared/preferences";
import { TERMINAL_COLORS, type Theme, UI_COLORS, availableThemes, findTheme, themeStyleSheet } from "../src/shared/theme";
import { MAX_THEME_FILE_BYTES, THEME_FILE_EXTENSION, readThemeFile, themeFileName, themeFileText } from "../src/shared/theme-file";

const nord = findTheme("nord");
const mine = (id = "custom-mine", name = "Mine"): Theme => ({ ...nord, id, name });

describe("custom themes", () => {
	test("are read whole, or not at all, when they come from the interface", () => {
		expect(readCustomThemes([])).toEqual([]);
		expect(readCustomThemes([mine()])).toEqual([mine()]);
		const brokenColor = { ...mine(), ui: { ...nord.ui, text: "not a color" } };
		for (const value of [undefined, {}, [mine(), mine()], [brokenColor], [{ ...mine(), id: "nord" }], [{ ...mine(), id: "mine" }], [{ ...mine(), id: "custom-" }], Array.from({ length: MAX_CUSTOM_THEMES + 1 }, (_, index) => mine(`custom-${index}`))]) {
			expect(readCustomThemes(value)).toBeUndefined();
		}
	});

	test("keep what can be kept when they come from the settings file", () => {
		const brokenColor = { ...mine("custom-a", "A"), ui: { ...nord.ui, text: "not a color" } };
		const salvaged = salvageCustomThemes([brokenColor, { name: "No id" }, mine("custom-a", "Again"), "junk", mine("custom-b", "B")])!;
		expect(salvaged.map(theme => theme.id)).toEqual(["custom-a", "custom-b"]);
		// A color that cannot be read comes from the built-in theme of the same appearance.
		expect(salvaged[0]!.ui.text).toBe(DEFAULT_DARK_THEME.ui.text);
		expect(salvageCustomThemes("junk")).toBeUndefined();
		// Through the preferences: a broken list in the file leaves the rest of the preferences alone.
		const read = readPreferences({ zoom: 1.5, customThemes: [brokenColor, mine("custom-b", "B")] });
		expect(read.zoom).toBe(1.5);
		expect(read.customThemes.map(theme => theme.id)).toEqual(["custom-a", "custom-b"]);
	});

	test("get ids from their names that no theme has, and never a built-in one's", () => {
		expect(slugOf("  Nord Copy!! ")).toBe("nord-copy");
		expect(slugOf("Été à Paris")).toBe("ete-a-paris");
		expect(slugOf("***")).toBe("");
		expect(newThemeId("Mine", BUILT_IN_THEMES)).toBe("custom-mine");
		expect(newThemeId("Mine", [...BUILT_IN_THEMES, mine()])).toBe("custom-mine-2");
		expect(newThemeId("***", BUILT_IN_THEMES)).toBe("custom-theme");
		expect(newThemeId("Nord", BUILT_IN_THEMES)).toBe("custom-nord");
	});

	test("keep names apart, ignoring case and spaces", () => {
		const themes = [...BUILT_IN_THEMES, mine()];
		expect(nameIsFree(" nord ", themes)).toBe(false);
		expect(nameIsFree("Mine", themes, "custom-mine")).toBe(true);
		expect(freeName("Mine", themes)).toBe("Mine 2");
		expect(copyName("Nord", themes)).toBe("Nord copy");
		expect(copyName("Nord", [...themes, mine("custom-x", "Nord copy")])).toBe("Nord copy 2");
	});

	test("are themes like any other once there are some", () => {
		const themes = availableThemes([mine()]);
		expect(themes.at(-1)).toEqual(mine());
		expect(themeStyleSheet({ mode: "fixed", theme: "custom-mine" }, themes)).toContain(`--bg-main: ${nord.ui.bgMain};`);
	});
});

describe("a theme file", () => {
	test("holds everything but the id, and reads back as the same theme", () => {
		const text = themeFileText(mine());
		const value = JSON.parse(text);
		expect(value.format).toBe("timber-theme");
		expect(value.version).toBe(1);
		expect(value.id).toBeUndefined();
		expect(Object.keys(value.ui)).toEqual([...UI_COLORS]);
		expect(Object.keys(value.terminal)).toEqual([...TERMINAL_COLORS]);
		const { id: _id, ...shared } = mine();
		expect(readThemeFile(text)).toEqual({ outcome: "read", theme: shared });
	});

	test("is refused with a reason when it is not a whole theme", () => {
		const whole = JSON.parse(themeFileText(mine()));
		const refused = (text: string) => {
			const read = readThemeFile(text);
			expect(read.outcome).toBe("refused");
			return read.outcome === "refused" ? read.reason : "";
		};
		expect(refused("{ not json")).toStartWith("The file is not JSON:");
		expect(refused("[]")).toContain('does not say "format": "timber-theme"');
		expect(refused(JSON.stringify({ ...whole, format: "vscode" }))).toContain("not a Timber theme");
		expect(refused(JSON.stringify({ ...whole, version: 2 }))).toBe("The file is a theme for a later version of the app (version 2).");
		expect(refused(JSON.stringify({ ...whole, version: undefined }))).toBe("The file does not say which version of the theme format it is.");
		expect(refused(JSON.stringify({ ...whole, name: "" }))).toContain("It has no name");
		expect(refused(JSON.stringify({ ...whole, appearance: "sepia" }))).toContain('"dark" or "light"');
		const colors = refused(JSON.stringify({ ...whole, ui: { ...whole.ui, text: "red", text2: undefined }, terminal: { ...whole.terminal, red: 1 } }));
		expect(colors).toBe("These colors are missing or are not colors: ui.text, ui.text2, terminal.red.");
		const many = refused(JSON.stringify({ ...whole, ui: {} }));
		// The two changed-word tints and the merged color follow from the theme's colors, and the five tag colors from the built-in theme's, so they are never missing.
		expect(many).toContain(`and ${UI_COLORS.length - 4 - 3 - 5} more.`);
		expect(refused(" ".repeat(MAX_THEME_FILE_BYTES + 1))).toContain("larger than 64 KB");
	});

	test("is named after the theme, and never after a file that is there", () => {
		expect(themeFileName("Nord copy", () => false)).toBe(`nord-copy${THEME_FILE_EXTENSION}`);
		const taken = new Set([`nord-copy${THEME_FILE_EXTENSION}`, `nord-copy-2${THEME_FILE_EXTENSION}`]);
		expect(themeFileName("Nord copy", name => taken.has(name))).toBe(`nord-copy-3${THEME_FILE_EXTENSION}`);
		expect(themeFileName("!!!", () => false)).toBe(`theme${THEME_FILE_EXTENSION}`);
	});
});

describe("exporting and importing in the main process", () => {
	const root = mkdtempSync(join(tmpdir(), "timber-themes-"));
	let folder: string;
	let picked: string | null;
	beforeEach(() => {
		folder = mkdtempSync(join(root, "case-"));
		picked = folder;
	});
	afterAll(() => rmSync(root, { recursive: true, force: true }));
	const files = () => createThemeFiles({ pickFolder: async () => picked, pickFile: async () => picked });

	test("export writes a new file in the folder picked, and never over one that is there", async () => {
		writeFileSync(join(folder, `mine${THEME_FILE_EXTENSION}`), "someone else's");
		const first = await files().exportTheme(mine());
		expect(first).toEqual({ outcome: "exported", path: join(folder, `mine-2${THEME_FILE_EXTENSION}`) });
		const second = await files().exportTheme(mine());
		expect(second).toEqual({ outcome: "exported", path: join(folder, `mine-3${THEME_FILE_EXTENSION}`) });
		expect(readFileSync(join(folder, `mine${THEME_FILE_EXTENSION}`), "utf8")).toBe("someone else's");
		expect(readFileSync(join(folder, `mine-2${THEME_FILE_EXTENSION}`), "utf8")).toBe(themeFileText(mine()));
	});

	test("export writes nothing when the picker is closed, the theme cannot be read, or the folder cannot be written", async () => {
		picked = null;
		expect(await files().exportTheme(mine())).toEqual({ outcome: "cancelled" });
		picked = folder;
		const broken = await files().exportTheme({ ...mine(), ui: { text: "red" } });
		expect(broken.outcome).toBe("failed");
		picked = join(folder, "missing");
		const missing = await files().exportTheme(mine());
		expect(missing.outcome).toBe("failed");
		expect(missing.outcome === "failed" && missing.message).toContain(join(folder, "missing"));
		expect(readdirSync(folder)).toEqual([]);
	});

	test("import reads a whole theme, and refuses anything else with the reason", async () => {
		const good = join(folder, "good.json");
		writeFileSync(good, themeFileText(mine()));
		picked = good;
		const imported = await files().importTheme();
		expect(imported.outcome).toBe("imported");
		expect(imported.outcome === "imported" && imported.theme.name).toBe("Mine");
		expect(imported.outcome === "imported" && imported.file).toBe(good);

		const bad = join(folder, "bad.json");
		writeFileSync(bad, "{ nope");
		picked = bad;
		const refused = await files().importTheme();
		expect(refused.outcome).toBe("refused");
		expect(refused.outcome === "refused" && refused.reason).toStartWith("The file is not JSON");

		const large = join(folder, "large.json");
		writeFileSync(large, " ".repeat(MAX_THEME_FILE_BYTES + 1));
		picked = large;
		expect(await files().importTheme()).toEqual({ outcome: "refused", file: large, reason: "The file is larger than 64 KB, so it is not a theme file." });

		picked = folder;
		expect(await files().importTheme()).toEqual({ outcome: "refused", file: folder, reason: "It is not a file." });
		picked = join(folder, "gone.json");
		const gone = await files().importTheme();
		expect(gone.outcome === "refused" && gone.reason).toStartWith("Could not read it:");
		picked = null;
		expect(await files().importTheme()).toEqual({ outcome: "cancelled" });
		// Reading changed nothing.
		expect(readFileSync(good, "utf8")).toBe(themeFileText(mine()));
		expect(readFileSync(bad, "utf8")).toBe("{ nope");
	});

	// Skipped on Windows, where chmod only sets the read-only flag and the file stays readable.
	test.skipIf(process.platform === "win32")("an unreadable file is refused", async () => {
		if (process.getuid?.() === 0) return;
		const locked = join(folder, "locked.json");
		writeFileSync(locked, themeFileText(mine()));
		chmodSync(locked, 0o000);
		picked = locked;
		try {
			const result = await files().importTheme();
			expect(result.outcome).toBe("refused");
		} finally {
			chmodSync(locked, 0o600);
		}
	});

	test("the saved preferences keep custom themes, and refuse a broken one without saving anything", async () => {
		const settingsFile = join(folder, "settings", "settings.json");
		mkdirSync(join(folder, "settings"));
		const preferences = createSavedPreferences(createSettingsHolder(settingsFile));
		const saved = await preferences.save({ customThemes: [mine()], theme: { mode: "fixed", theme: "custom-mine" } });
		expect(saved.outcome).toBe("saved");
		const before = readFileSync(settingsFile, "utf8");
		expect(JSON.parse(before).preferences.customThemes[0].id).toBe("custom-mine");
		const broken = await preferences.save({ customThemes: [{ ...mine(), ui: { ...nord.ui, text: "red" } }] });
		expect(broken).toEqual({ outcome: "failed", message: "Nothing was saved, because these settings could not be read: customThemes." });
		expect(readFileSync(settingsFile, "utf8")).toBe(before);
		expect((await createSavedPreferences(createSettingsHolder(settingsFile)).load()).customThemes).toEqual([mine()]);
		expect(existsSync(settingsFile)).toBe(true);
	});
});

describe("the mock's theme files", () => {
	test("export records each file under a name of its own, and import reads what it is given", async () => {
		const mock = createMockThemeFiles();
		expect(await mock.exportTheme(mine())).toEqual({ outcome: "exported", path: `Downloads/mine${THEME_FILE_EXTENSION}` });
		expect(await mock.exportTheme(mine())).toEqual({ outcome: "exported", path: `Downloads/mine-2${THEME_FILE_EXTENSION}` });
		expect(mock.exportedThemes().map(file => file.text)).toEqual([themeFileText(mine()), themeFileText(mine())]);
		expect((await mock.exportTheme({ ...mine(), name: "" })).outcome).toBe("failed");

		mock.setThemeImport(themeFileText(mine()), "/tmp/mine.json");
		mock.setThemeImport("{", "/tmp/bad.json");
		mock.setThemeImport(null);
		const first = await mock.importTheme();
		expect(first.outcome === "imported" && first.theme.name).toBe("Mine");
		expect(await mock.importTheme()).toEqual({ outcome: "refused", file: "/tmp/bad.json", reason: expect.stringContaining("not JSON") });
		expect(await mock.importTheme()).toEqual({ outcome: "cancelled" });
		// With nothing waiting and no browser, Import is cancelled.
		expect(await mock.importTheme()).toEqual({ outcome: "cancelled" });
	});
});

describe("the maker", () => {
	const themes = availableThemes([mine()]);

	test("starts a new theme as a copy, and an edit as the theme itself", () => {
		const draft = draftFrom(nord, themes);
		expect(draft).toMatchObject({ id: null, name: "Nord copy", appearance: "dark" });
		expect(draft.ui).toEqual(nord.ui);
		expect(draftOf(mine())).toMatchObject({ id: "custom-mine", name: "Mine" });
	});

	test("lists every color in exactly one group", () => {
		const listed = COLOR_GROUPS.flatMap(group => group.keys.map(key => `${group.part}.${key}`));
		expect(listed.sort()).toEqual([...UI_COLORS.map(key => `ui.${key}`), ...TERMINAL_COLORS.map(key => `terminal.${key}`)].sort());
	});

	test("can save a new copy as it is, with a new id", () => {
		const model = draftModel(draftFrom(nord, themes), nord, themes, "aa");
		expect(model.theme).toMatchObject({ id: "custom-nord-copy", name: "Nord copy" });
		expect(model.changed).toBe(true);
		expect(model.warnings).toEqual([]);
	});

	test("cannot save an edit that changed nothing, a taken or empty name, or a color that is not one", () => {
		expect(draftModel(draftOf(mine()), mine(), themes, "aa").changed).toBe(false);
		expect(draftModel({ ...draftOf(mine()), name: " nord " }, mine(), themes, "aa")).toMatchObject({ theme: null, nameError: "There is a theme called nord already." });
		expect(draftModel({ ...draftOf(mine()), name: "  " }, mine(), themes, "aa").nameError).toBe("A theme needs a name.");
		expect(draftModel({ ...draftOf(mine()), name: "x".repeat(81) }, mine(), themes, "aa").nameError).toContain("80 characters");
		const typing = draftModel({ ...draftOf(mine()), ui: { ...mine().ui, text: "#12" } }, mine(), themes, "aa");
		expect(typing.theme).toBeNull();
		expect(typing.unreadable).toEqual(["ui.text"]);
		// The preview keeps the color it started from until the text is a color.
		expect(typing.preview.ui.text).toBe(mine().ui.text);
	});

	test("warns about colors too close to their surfaces, at the level chosen, and can still save", () => {
		const faint = draftModel({ ...draftOf(mine()), ui: { ...mine().ui, text3: mine().ui.bgMain } }, mine(), themes, "aa");
		expect(faint.theme).not.toBeNull();
		expect(faint.warnings.map(warning => `${warning.color}/${warning.on}`)).toContain("text3/bgMain");
		expect(describeWarning(faint.warnings.find(warning => warning.on === "bgMain")!)).toMatch(/^Faint text on workspace and dialogs: 1(\.0+)?:1, needs 4\.5:1$/);
		expect(draftModel(draftOf(DEFAULT_DARK_THEME as Theme), DEFAULT_DARK_THEME, BUILT_IN_THEMES, "aaa").warnings.every(warning => warning.minimum >= 4.5)).toBe(true);
		const terminal = draftModel({ ...draftOf(mine()), terminal: { ...mine().terminal, foreground: mine().terminal.background } }, mine(), themes, "aa");
		expect(describeWarning(terminal.warnings[0]!)).toStartWith("Terminal text on terminal background:");
	});

	test("the color picker takes and gives colors without losing their alpha", () => {
		expect(pickerValue("rgba(255, 255, 255, 0.06)")).toBe("#ffffff");
		expect(pickerValue("nonsense")).toBe("#000000");
		expect(pickedColor("rgba(255, 255, 255, 0.06)", "#102030")).toBe("rgba(16, 32, 48, 0.06)");
		expect(pickedColor("#ffffff", "#102030")).toBe("#102030");
	});

	test("a new theme is put in use in its slot, and a deleted one gives its place to the app's own", () => {
		const light = { ...DEFAULT_LIGHT_THEME, id: "custom-l", name: "L" };
		expect(choosing({ mode: "fixed", theme: "nord" }, mine())).toEqual({ mode: "fixed", theme: "custom-mine" });
		expect(choosing({ mode: "system", light: "timber-light", dark: "nord" }, light)).toEqual({ mode: "system", light: "custom-l", dark: "nord" });
		expect(withoutTheme({ mode: "fixed", theme: "custom-mine" }, "custom-mine")).toEqual({ mode: "fixed", theme: "timber-dark" });
		expect(withoutTheme({ mode: "system", light: "custom-l", dark: "custom-l" }, "custom-l")).toEqual({ mode: "system", light: "timber-light", dark: "timber-dark" });
		expect(withoutTheme({ mode: "fixed", theme: "nord" }, "custom-mine")).toEqual({ mode: "fixed", theme: "nord" });
		expect(uses({ mode: "system", light: "a", dark: "custom-mine" }, "custom-mine")).toBe(true);
		expect(uses({ mode: "fixed", theme: "a" }, "custom-mine")).toBe(false);
	});
});
