import { describe, expect, test } from "bun:test";
import { applyPreferenceChange, defaultPreferences, readPreferences } from "../src/shared/preferences";
import { createMockEngine } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import { zoomKey } from "../src/mainview/zoom-keys";
import type { Preferences } from "../src/shared/preferences";
import { ZOOM_CHOICES, readZoom, stepZoom, zoomChoices, zoomLabel } from "../src/shared/zoom";
import { defaultThemeChoice } from "../src/shared/theme";

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
		const saved = { ...defaultPreferences(), zoom: 1.6, theme: defaultThemeChoice(), customThemes: [] };
		expect(applyPreferenceChange(saved, { zoom: 1.25 })).toEqual({ preferences: { ...saved, zoom: 1.25 }, unreadable: [] });
		expect(applyPreferenceChange(saved, { zoom: 12 })).toEqual({ preferences: saved, unreadable: ["zoom"] });
	});
});

describe("stepZoom", () => {
	test("steps through the zooms Settings offers, both ways", () => {
		expect(stepZoom(1, "in")).toBe(1.1);
		expect(stepZoom(1.1, "in")).toBe(1.25);
		expect(stepZoom(1.5, "in")).toBe(1.6);
		expect(stepZoom(1, "out")).toBe(0.9);
		expect(stepZoom(0.9, "out")).toBe(0.75);
		for (const zoom of ZOOM_CHOICES) expect(zoomChoices(1)).toContain(stepZoom(zoom, "in"));
	});

	test("a zoom between two choices goes to the nearest one that way", () => {
		expect(stepZoom(1.33, "in")).toBe(1.5);
		expect(stepZoom(1.33, "out")).toBe(1.25);
	});

	test("stays at either end, and outside the list moves only toward it", () => {
		expect(stepZoom(3, "in")).toBe(3);
		expect(stepZoom(0.75, "out")).toBe(0.75);
		expect(stepZoom(0.5, "out")).toBe(0.5);
		expect(stepZoom(0.5, "in")).toBe(0.75);
	});

	test("reset is 100% from anywhere", () => {
		for (const zoom of [0.5, 1, 1.33, 3]) expect(stepZoom(zoom, "reset")).toBe(1);
	});
});

describe("zoomKey", () => {
	const key = (key: string, more: Partial<KeyboardEvent> = {}) =>
		({ type: "keydown", key, ctrlKey: false, metaKey: false, altKey: false, ...more }) as KeyboardEvent;
	const ctrl = (name: string, more: Partial<KeyboardEvent> = {}) => key(name, { ctrlKey: true, ...more });
	const cmd = (name: string, more: Partial<KeyboardEvent> = {}) => key(name, { metaKey: true, ...more });

	test("Ctrl with plus, equals, minus, and 0 on Linux and Windows", () => {
		expect(zoomKey(ctrl("+"), false)).toBe("in");
		expect(zoomKey(ctrl("="), false)).toBe("in");
		expect(zoomKey(ctrl("-"), false)).toBe("out");
		expect(zoomKey(ctrl("0"), false)).toBe("reset");
	});

	test("Cmd on macOS, and not Ctrl there", () => {
		expect(zoomKey(cmd("+"), true)).toBe("in");
		expect(zoomKey(cmd("-"), true)).toBe("out");
		expect(zoomKey(cmd("0"), true)).toBe("reset");
		expect(zoomKey(ctrl("+"), true)).toBeNull();
		expect(zoomKey(cmd("+"), false)).toBeNull();
	});

	test("leaves every other key alone, the underscore for undo in a terminal among them", () => {
		expect(zoomKey(key("+"), false)).toBeNull();
		expect(zoomKey(key("-"), false)).toBeNull();
		expect(zoomKey(ctrl("_", { shiftKey: true }), false)).toBeNull();
		expect(zoomKey(ctrl("+", { altKey: true }), false)).toBeNull();
		expect(zoomKey(ctrl("+", { metaKey: true }), false)).toBeNull();
		expect(zoomKey(ctrl("1"), false)).toBeNull();
		expect(zoomKey(ctrl("+", { type: "keyup" }), false)).toBeNull();
	});
});

describe("changeZoom", () => {
	const settle = async () => {
		for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
	};
	async function startedStore(engine = createMockEngine()) {
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		return { engine, store };
	}

	test("saves the next zoom as the preference and says it in one toast", async () => {
		const { engine, store } = await startedStore();
		await store.changeZoom("in");
		expect(store.getState().preferences.zoom).toBe(1.1);
		expect((await engine.loadPreferences()).zoom).toBe(1.1);
		await store.changeZoom("in");
		expect(store.getState().preferences.zoom).toBe(1.25);
		expect(store.getState().toasts.map(toast => toast.text)).toEqual(["Zoom 125%"]);
		await store.changeZoom("reset");
		expect(store.getState().preferences.zoom).toBe(1);
		expect(store.getState().toasts.map(toast => toast.text)).toEqual(["Zoom 100%"]);
	});

	test("quick presses add up before the saves answer", async () => {
		const { store } = await startedStore();
		await Promise.all([store.changeZoom("in"), store.changeZoom("in"), store.changeZoom("in")]);
		expect(store.getState().preferences.zoom).toBe(1.5);
		await store.changeZoom("out");
		expect(store.getState().preferences.zoom).toBe(1.25);
	});

	test("at an end it stays, saves nothing, and still says the zoom", async () => {
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		await store.savePreferences({ zoom: 3 });
		let saves = 0;
		const save = engine.savePreferences.bind(engine);
		engine.savePreferences = (change: Partial<Preferences>) => {
			saves += 1;
			return save(change);
		};
		await store.changeZoom("in");
		expect(saves).toBe(0);
		expect(store.getState().preferences.zoom).toBe(3);
		expect(store.getState().toasts.map(toast => toast.text)).toEqual(["Zoom 300%"]);
	});

	test("a failed save changes nothing and shows no toast", async () => {
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		engine.failPreferenceSaves("disk full");
		await store.changeZoom("in");
		expect(store.getState().preferences.zoom).toBe(1);
		expect(store.getState().toasts).toEqual([]);
		engine.failPreferenceSaves(null);
		await store.changeZoom("in");
		expect(store.getState().preferences.zoom).toBe(1.1);
	});
});
