import { describe, expect, test } from "bun:test";
import {
	DEFAULT_FETCH_MINUTES, MAX_FETCH_MINUTES, MIN_FETCH_MINUTES, defaultFetchSetting, isFetchInterval, readFetchSetting, salvageFetchSetting, sameFetchSetting,
	writeFetchSetting,
} from "../src/shared/fetch-setting";
import { applyPreferenceChange, defaultPreferences, readPreferences } from "../src/shared/preferences";

describe("the Fetching setting", () => {
	test("fetches in the background every five minutes until something else is saved", () => {
		expect(defaultFetchSetting()).toEqual({ background: true, intervalMinutes: DEFAULT_FETCH_MINUTES });
		expect(DEFAULT_FETCH_MINUTES).toBe(5);
		expect(defaultPreferences().fetch).toEqual(defaultFetchSetting());
	});

	test("takes whole minutes from one minute to one day", () => {
		for (const minutes of [MIN_FETCH_MINUTES, 5, 90, MAX_FETCH_MINUTES]) expect(isFetchInterval(minutes)).toBe(true);
		for (const minutes of [0, -5, 0.5, 2.5, MAX_FETCH_MINUTES + 1, Number.NaN, Number.POSITIVE_INFINITY, "5", null]) expect(isFetchInterval(minutes)).toBe(false);
	});

	test("reads a saved setting, and refuses one that is not whole", () => {
		expect(readFetchSetting({ background: false, intervalMinutes: 30 })).toEqual({ background: false, intervalMinutes: 30 });
		expect(readFetchSetting({ background: false, intervalMinutes: 30, later: true })).toEqual({ background: false, intervalMinutes: 30 });
		for (const value of [null, "on", [], {}, { background: "yes", intervalMinutes: 5 }, { background: true }, { background: true, intervalMinutes: 0 }]) {
			expect(readFetchSetting(value)).toBeUndefined();
		}
	});

	test("compares and writes both parts", () => {
		expect(sameFetchSetting({ background: true, intervalMinutes: 5 }, { background: true, intervalMinutes: 5 })).toBe(true);
		expect(sameFetchSetting({ background: true, intervalMinutes: 5 }, { background: false, intervalMinutes: 5 })).toBe(false);
		expect(sameFetchSetting({ background: true, intervalMinutes: 5 }, { background: true, intervalMinutes: 6 })).toBe(false);
		expect(readFetchSetting(writeFetchSetting({ background: false, intervalMinutes: 15 }))).toEqual({ background: false, intervalMinutes: 15 });
	});

	test("a saved setting with an interval that cannot be read keeps background fetching off when it says so", () => {
		expect(readPreferences({ fetch: { background: false, intervalMinutes: 0 } }).fetch).toEqual({ background: false, intervalMinutes: DEFAULT_FETCH_MINUTES });
		expect(readPreferences({ fetch: { background: false, intervalMinutes: "soon" } }).fetch).toEqual({ background: false, intervalMinutes: DEFAULT_FETCH_MINUTES });
		expect(readPreferences({ fetch: { background: "no", intervalMinutes: 0 } }).fetch).toEqual(defaultFetchSetting());
		expect(salvageFetchSetting(null)).toBeUndefined();
		// A change is never salvaged: it is refused by name.
		expect(applyPreferenceChange(defaultPreferences(), { fetch: { background: false, intervalMinutes: 0 } }).unreadable).toEqual(["fetch"]);
	});

	test("a setting that cannot be read falls back on its own, and a change to it is refused by name", () => {
		expect(readPreferences({ sidebarSide: "right", fetch: { background: true, intervalMinutes: 0 } }).fetch).toEqual(defaultFetchSetting());
		expect(readPreferences({ sidebarSide: "right", fetch: { background: true, intervalMinutes: 0 } }).sidebarSide).toBe("right");
		expect(applyPreferenceChange(defaultPreferences(), { fetch: { background: true, intervalMinutes: 99999 } }).unreadable).toEqual(["fetch"]);
		expect(applyPreferenceChange(defaultPreferences(), { fetch: { background: false, intervalMinutes: 10 } }).preferences.fetch).toEqual({ background: false, intervalMinutes: 10 });
	});
});
