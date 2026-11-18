import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createSavedPreferences } from "../src/bun/preferences";
import { createSettingsHolder } from "../src/bun/settings";
import { App } from "../src/mainview/App";
import { TerminalSectionView, type TerminalSectionViewProps } from "../src/mainview/components/settings/TerminalSection";
import { estimateTerminalSize } from "../src/mainview/components/TerminalPanel";
import { createMockEngine } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import { missingFontNote, terminalDraftModel, terminalDraftOf } from "../src/mainview/terminal-appearance-format";
import { setTerminalAppearance, terminalAppearance, watchTerminalAppearance } from "../src/mainview/terminal-look";
import { applyPreferenceChange, defaultPreferences, readPreferences, writePreferences } from "../src/shared/preferences";
import {
	type TerminalAppearance, defaultTerminalAppearance, estimateTerminalCells, fontIsInstalled, readTerminalAppearance, readTerminalFont,
	readTerminalFontSize, salvageTerminalAppearance, terminalFontStack,
} from "../src/shared/terminal-appearance";

const settle = async () => {
	for (let round = 0; round < 5; round++) await Bun.sleep(0);
};
const NERD: TerminalAppearance = { fontFamily: "JetBrainsMono Nerd Font", fontSize: 15, cursor: "bar" };

describe("reading the terminal's appearance", () => {
	test("is Geist Mono at 13 pixels with a block cursor by default", () => {
		expect(defaultTerminalAppearance()).toEqual({ fontFamily: "", fontSize: 13, cursor: "block" });
		expect(defaultPreferences().terminal).toEqual(defaultTerminalAppearance());
	});

	test("clamps a size outside the limits and rounds it, and refuses one that is not a number", () => {
		expect(readTerminalFontSize(15)).toBe(15);
		expect(readTerminalFontSize(4)).toBe(10);
		expect(readTerminalFontSize(99)).toBe(24);
		expect(readTerminalFontSize(14.6)).toBe(15);
		for (const value of ["14", null, undefined, Number.NaN, Number.POSITIVE_INFINITY, {}]) expect(readTerminalFontSize(value)).toBeUndefined();
	});

	test("keeps one font name, trimmed, and refuses what would break out of it in CSS", () => {
		expect(readTerminalFont("  JetBrainsMono Nerd Font ")).toBe("JetBrainsMono Nerd Font");
		expect(readTerminalFont("")).toBe("");
		// The built-in font's name is the default.
		expect(readTerminalFont("geist mono")).toBe("");
		for (const value of ['Fira"; color: red', "Fira, serif", "Fira'", "Fira;", "a\\b", "x".repeat(201), 7, null]) expect(readTerminalFont(value)).toBeUndefined();
	});

	test("refuses a change it cannot read whole, and keeps what it can of a saved one", () => {
		expect(readTerminalAppearance(NERD)).toEqual(NERD);
		expect(readTerminalAppearance({ ...NERD, fontSize: 40 })).toEqual({ ...NERD, fontSize: 24 });
		for (const value of [null, "bar", { ...NERD, cursor: "underline" }, { ...NERD, fontSize: "big" }, { fontSize: 15, cursor: "bar" }]) {
			expect(readTerminalAppearance(value)).toBeUndefined();
		}
		expect(salvageTerminalAppearance({ fontFamily: "Iosevka", fontSize: "big", cursor: "bar" })).toEqual({ fontFamily: "Iosevka", fontSize: 13, cursor: "bar" });
		expect(salvageTerminalAppearance("nonsense")).toEqual(defaultTerminalAppearance());
	});

	test("as part of the preferences, never fails, and a save that cannot be read is named", () => {
		expect(readPreferences({ terminal: NERD }).terminal).toEqual(NERD);
		expect(readPreferences({ terminal: { fontFamily: "Iosevka", fontSize: "x", cursor: "beam" } }).terminal).toEqual({ fontFamily: "Iosevka", fontSize: 13, cursor: "block" });
		expect(readPreferences({ terminal: 12 }).terminal).toEqual(defaultTerminalAppearance());
		expect(readPreferences(writePreferences({ ...defaultPreferences(), terminal: NERD })).terminal).toEqual(NERD);
		expect(applyPreferenceChange(defaultPreferences(), { terminal: { ...NERD, cursor: "beam" } }).unreadable).toEqual(["terminal"]);
	});

	test("puts the chosen font first, then Geist Mono and the Nerd Font symbols", () => {
		expect(terminalFontStack("")).toBe('"Geist Mono", "Symbols Nerd Font Mono", "Symbols Nerd Font", ui-monospace, "Cascadia Code", Consolas, monospace');
		expect(terminalFontStack("Iosevka")).toBe('"Iosevka", "Geist Mono", "Symbols Nerd Font Mono", "Symbols Nerd Font", ui-monospace, "Cascadia Code", Consolas, monospace');
	});

	test("tells an installed font from one drawn in a stand-in", () => {
		const widths: Record<string, number> = { "72px monospace": 600, "72px serif": 500 };
		const missing = (font: string) => widths[font.replace(/"[^"]*", /, "")]!;
		expect(fontIsInstalled("Nope", missing)).toBe(false);
		expect(fontIsInstalled("Iosevka", font => font.includes("Iosevka") ? 610 : widths[font]!)).toBe(true);
		expect(fontIsInstalled("", () => 0)).toBe(true);
	});

	test("estimates the cells for the chosen size, as for 13 pixels before", () => {
		expect(estimateTerminalCells(0, 400, 13)).toEqual({ cols: 80, rows: 24 });
		expect(estimateTerminalCells(796, 674, 13)).toEqual({ cols: 100, rows: 40 });
		expect(estimateTerminalCells(796, 674, 20)).toEqual({ cols: 65, rows: 26 });
		expect(estimateTerminalCells(100, 60, 24)).toEqual({ cols: 20, rows: 5 });
	});
});

describe("the saved terminal appearance", () => {
	let root: string;
	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-terminal-look-")));
	});
	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("is there after a restart", async () => {
		const file = join(root, "restart", "settings.json");
		const first = createSavedPreferences(createSettingsHolder(file, () => {}));
		expect(await first.save({ terminal: NERD })).toEqual({ outcome: "saved", preferences: { ...defaultPreferences(), terminal: NERD } });
		expect(JSON.parse(readFileSync(file, "utf8")).preferences.terminal).toEqual(NERD);
		expect((await createSavedPreferences(createSettingsHolder(file, () => {})).load()).terminal).toEqual(NERD);
	});

	test("refuses a change it cannot read and keeps the file as it was", async () => {
		const file = join(root, "refuse", "settings.json");
		const preferences = createSavedPreferences(createSettingsHolder(file, () => {}));
		await preferences.save({ terminal: NERD });
		const before = readFileSync(file, "utf8");
		const result = await preferences.save({ terminal: { ...NERD, cursor: "beam" } as unknown as TerminalAppearance });
		expect(result).toEqual({ outcome: "failed", message: "Nothing was saved, because these settings could not be read: terminal." });
		expect(readFileSync(file, "utf8")).toBe(before);
	});

	test("reads a size edited by hand outside the limits as the nearest one, and a size that is not a number as the default", async () => {
		const file = join(root, "by-hand", "settings.json");
		mkdirSync(join(file, ".."), { recursive: true });
		writeFileSync(file, JSON.stringify({ version: 1, repositories: [], preferences: { terminal: { fontFamily: "Iosevka", fontSize: 80, cursor: "bar" } } }));
		expect((await createSavedPreferences(createSettingsHolder(file, () => {})).load()).terminal).toEqual({ fontFamily: "Iosevka", fontSize: 24, cursor: "bar" });
		writeFileSync(file, JSON.stringify({ version: 1, repositories: [], preferences: { terminal: { fontFamily: "Iosevka", fontSize: "large", cursor: "bar" } } }));
		expect((await createSavedPreferences(createSettingsHolder(file, () => {})).load()).terminal).toEqual({ fontFamily: "Iosevka", fontSize: 13, cursor: "bar" });
	});
});

describe("the mock engine and the store", () => {
	test("the mock engine holds the appearance and refuses one it cannot read", async () => {
		const engine = createMockEngine();
		expect((await engine.loadPreferences()).terminal).toEqual(defaultTerminalAppearance());
		expect(await engine.savePreferences({ terminal: NERD })).toEqual({ outcome: "saved", preferences: { ...defaultPreferences(), terminal: NERD } });
		expect((await engine.loadPreferences()).terminal).toEqual(NERD);
		const refused = await engine.savePreferences({ terminal: { ...NERD, fontSize: "big" } as unknown as TerminalAppearance });
		expect(refused.outcome).toBe("failed");
		expect((await engine.loadPreferences()).terminal).toEqual(NERD);
	});

	test("the store shows a saved appearance, and terminals hear each change once", async () => {
		const store = createAppStore(createMockEngine(), () => () => {});
		store.start();
		await settle();
		const heard: TerminalAppearance[] = [];
		const stop = watchTerminalAppearance(appearance => heard.push(appearance));
		try {
			expect((await store.savePreferences({ terminal: NERD })).outcome).toBe("saved");
			expect(store.getState().preferences.terminal).toEqual(NERD);
			setTerminalAppearance(store.getState().preferences.terminal);
			setTerminalAppearance({ ...NERD });
			expect(heard).toEqual([NERD]);
			expect(terminalAppearance()).toEqual(NERD);
			// A pane is measured for the chosen size before its terminal is drawn.
			expect(estimateTerminalSize({ clientWidth: 796, clientHeight: 674 } as HTMLElement)).toEqual(estimateTerminalCells(796, 674, 15));
		} finally {
			stop();
			setTerminalAppearance(defaultTerminalAppearance());
		}
	});
});

describe("Settings, Terminal", () => {
	const saved = defaultTerminalAppearance();
	const view = (props: Partial<TerminalSectionViewProps>) => renderToStaticMarkup(
		<TerminalSectionView draft={terminalDraftOf(saved)} saved={saved} save={{ state: "idle" }} fontInstalled onEdit={() => {}} onSave={() => {}} {...props} />,
	);

	test("can save only a change it can read, with the size clamped", () => {
		const draft = terminalDraftOf(saved);
		expect(terminalDraftModel(draft, saved)).toEqual({ appearance: saved, canSave: false, invalid: null, error: null });
		expect(terminalDraftModel({ ...draft, cursor: "bar" }, saved)).toEqual({ appearance: { ...saved, cursor: "bar" }, canSave: true, invalid: null, error: null });
		expect(terminalDraftModel({ ...draft, fontSize: "40" }, saved).appearance).toEqual({ ...saved, fontSize: 24 });
		expect(terminalDraftModel({ ...draft, fontSize: "" }, saved)).toMatchObject({ canSave: false, invalid: "size" });
		expect(terminalDraftModel({ ...draft, fontSize: "12px" }, saved)).toMatchObject({ canSave: false, invalid: "size" });
		expect(terminalDraftModel({ ...draft, fontFamily: "Fira, serif" }, saved)).toMatchObject({ canSave: false, invalid: "font" });
	});

	test("says when a font is not installed, and that Geist Mono is used instead", () => {
		expect(missingFontNote("Iosevka", true)).toBeNull();
		expect(missingFontNote("", false)).toBeNull();
		expect(missingFontNote(" Nope ", false)).toBe('Nope is not installed on this computer, so terminals use Geist Mono. Check the name as your system lists it, such as "JetBrainsMono Nerd Font".');
		const markup = view({ draft: { ...terminalDraftOf(saved), fontFamily: "Nope" }, fontInstalled: false });
		expect(markup).toContain("Nope is not installed on this computer, so terminals use Geist Mono.");
	});

	test("draws the font, the size, and both cursors", () => {
		const markup = view({});
		expect(markup).toContain('placeholder="Geist Mono"');
		expect(markup).toContain('value="13"');
		expect(markup).toContain("Block");
		expect(markup).toContain("Bar");
		expect(markup).toContain("A thin line before the cell.");
		expect(markup).toContain('aria-disabled="true">Save</button>');
		const wrong = view({ draft: { ...terminalDraftOf(saved), fontSize: "big" } });
		expect(wrong).toContain('aria-invalid="true"');
		expect(wrong).toContain("The text size is a number from 10 to 24.");
	});

	test("is a section of the Settings dialog", async () => {
		const store = createAppStore(createMockEngine(), () => () => {});
		store.start();
		await settle();
		store.openDialog({ kind: "settings", section: "terminal" });
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain(">Terminal</button>");
		expect(markup).toContain("The font, the text size, and the cursor of every terminal.");
	});
});
