import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ThemeMakerView, type ThemeMakerViewProps } from "../src/mainview/components/settings/ThemeMaker";
import { draftFrom, draftOf } from "../src/mainview/theme-format";
import { TERMINAL_COLORS, UI_COLORS, availableThemes, findTheme } from "../src/shared/theme";

const nord = findTheme("nord");
const mine = { ...nord, id: "custom-mine", name: "Mine" };
const themes = availableThemes([mine]);

function render(props: Partial<ThemeMakerViewProps>) {
	const all: ThemeMakerViewProps = {
		draft: draftFrom(nord, themes),
		start: nord,
		themes,
		level: "aa",
		save: { state: "idle" },
		onEdit: () => {},
		onLevel: () => {},
		onSave: () => {},
		onCancel: () => {},
		...props,
	};
	return renderToStaticMarkup(<ThemeMakerView {...all} />);
}

describe("the theme maker", () => {
	test("starts a new theme as a named copy, with every color, the previews, Cancel, and Save", () => {
		const markup = render({});
		expect(markup).toContain(">New theme</h3>");
		expect(markup).toContain("A copy of Nord to change.");
		expect(markup).toContain('value="Nord copy"');
		expect(markup.match(/class="theme-color"/g)).toHaveLength(UI_COLORS.length + TERMINAL_COLORS.length);
		expect(markup.match(/type="color"/g)).toHaveLength(UI_COLORS.length + TERMINAL_COLORS.length);
		for (const group of ["Surfaces", "Text", "Meaning", "Lines and fills", "Diffs", "Shadows", "Terminal", "Terminal colors"]) expect(markup).toContain(`>${group}</legend>`);
		expect(markup).toContain('aria-label="Preview of the interface"');
		expect(markup).toContain('aria-label="Preview of a terminal"');
		expect(markup).toContain(">Cancel</button>");
		expect(markup).toContain('aria-disabled="false">Save</button>');
		expect(markup).toContain("Every text and meaning color stands out enough");
		// A see-through color keeps its alpha in the text, and the picker shows it without.
		expect(markup).toContain('value="rgba(255, 255, 255, 0.06)"');
	});

	test("draws the previews in the draft's colors", () => {
		const draft = { ...draftOf(mine), ui: { ...mine.ui, bgApp: "#123456" } };
		expect(render({ draft, start: mine })).toMatch(/class="theme-sample" style="--bg-app:#123456;/);
	});

	test("an edit that changed nothing cannot be saved, and names the theme", () => {
		const markup = render({ draft: draftOf(mine), start: mine });
		expect(markup).toContain(">Edit Mine</h3>");
		expect(markup).toContain('aria-disabled="true">Save</button>');
	});

	test("shows what stops a save, at the field it is about", () => {
		const draft = { ...draftOf(mine), name: "Nord", ui: { ...mine.ui, text: "#12" } };
		const markup = render({ draft, start: mine });
		expect(markup).toContain("There is a theme called Nord already.");
		expect(markup).toContain(">Not a color</span>");
		expect(markup).toMatch(/aria-invalid="true"[^>]*value="#12"/);
		expect(markup).toContain('aria-disabled="true">Save</button>');
	});

	test("lists the colors that are too close to their surfaces, and marks their rows, at the level chosen", () => {
		const draft = { ...draftOf(mine), ui: { ...mine.ui, text3: mine.ui.bgMain } };
		const markup = render({ draft, start: mine });
		expect(markup).toMatch(/\d+ colors are too close to what they are drawn on/);
		expect(markup).toContain("Faint text on workspace and dialogs: 1:1, needs 4.5:1");
		expect(markup).toContain(">Low contrast</span>");
		expect(markup).toContain("The theme can still be saved.");
		expect(markup).toContain('aria-disabled="false">Save</button>');
		const strict = render({ draft: draftOf(mine), start: mine, level: "aaa" });
		expect(strict).toContain("needs 7:1");
		expect(strict).toContain('<option value="aaa" selected="">');
	});
});
