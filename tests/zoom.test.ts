import { describe, expect, test } from "bun:test";
import { applyPreferenceChange, defaultPreferences, readPreferences } from "../src/shared/preferences";
import { ZOOM_CHOICES, readZoom, zoomChoices, zoomLabel } from "../src/shared/zoom";

describe("readZoom", () => {
	test("reads a number within the limits, to two decimals", () => {
		expect(readZoom(1)).toBe(1);
		expect(readZoom(1.6)).toBe(1.6);
		expect(readZoom(0.5)).toBe(0.5);
		expect(readZoom(3)).toBe(3);
		expect(readZoom(1.337)).toBe(1.34);
	});

	test("refuses anything else", () => {
		for (const value of [undefined, null, "1.6", "160%", true, [], {}, Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 0.49, 3.01, 16]) {
			expect(readZoom(value)).toBeUndefined();
		}
	});
});

describe("zoomLabel and zoomChoices", () => {
	test("label a zoom as a percentage", () => {
		expect(zoomLabel(1)).toBe("100%");
		expect(zoomLabel(1.6)).toBe("160%");
		expect(zoomLabel(0.75)).toBe("75%");
	});

	test("offer the fixed choices in order, 100% and 160% among them", () => {
		expect(zoomChoices(1)).toEqual([...ZOOM_CHOICES]);
		expect([...ZOOM_CHOICES]).toEqual([...ZOOM_CHOICES].sort((one, other) => one - other));
		expect(ZOOM_CHOICES).toContain(1);
		expect(ZOOM_CHOICES).toContain(1.6);
	});

	test("also offer a saved zoom that is not one of them, in its place", () => {
		const choices = zoomChoices(1.33);
		expect(choices).toHaveLength(ZOOM_CHOICES.length + 1);
		expect(choices.indexOf(1.33)).toBe(choices.indexOf(1.25) + 1);
	});
});

describe("the zoom preference", () => {
	test("is 100% until one is saved, and in a file from before the app had it", () => {
		expect(defaultPreferences().zoom).toBe(1);
		expect(readPreferences({ sidebarSide: "right" }).zoom).toBe(1);
	});

	test("a saved zoom that cannot be read falls back to 100% and costs nothing else", () => {
		expect(readPreferences({ sidebarSide: "right", zoom: "huge" })).toEqual({ ...defaultPreferences(), sidebarSide: "right" });
		expect(readPreferences({ zoom: 40 }).zoom).toBe(1);
	});

	test("a change that cannot be read is refused, not saved as something else", () => {
		const saved = { ...defaultPreferences(), zoom: 1.6 };
		expect(applyPreferenceChange(saved, { zoom: 1.25 })).toEqual({ preferences: { ...saved, zoom: 1.25 }, unreadable: [] });
		expect(applyPreferenceChange(saved, { zoom: 12 })).toEqual({ preferences: saved, unreadable: ["zoom"] });
	});
});
