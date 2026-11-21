import { describe, expect, test } from "bun:test";
import { applyPreferenceChange, defaultPreferences, readPreferences } from "../src/shared/preferences";
import { defaultTimberChoice, readTimberChoice, sameTimberChoice, writeTimberChoice } from "../src/shared/timber-choice";

describe("the Timber choice", () => {
	test("is the bundled Timber by default", () => {
		expect(defaultTimberChoice()).toEqual({ kind: "bundled" });
		expect(defaultPreferences().timber).toEqual({ kind: "bundled" });
	});

	test("reads the bundled Timber, the one on PATH, and a file by its full path", () => {
		expect(readTimberChoice({ kind: "bundled" })).toEqual({ kind: "bundled" });
		expect(readTimberChoice({ kind: "path", path: "ignored" })).toEqual({ kind: "path" });
		expect(readTimberChoice({ kind: "file", path: "/opt/timber/bin/timber" })).toEqual({ kind: "file", path: "/opt/timber/bin/timber" });
		expect(readTimberChoice({ kind: "file", path: "C:\\Tools\\timber.exe" })).toEqual({ kind: "file", path: "C:\\Tools\\timber.exe" });
	});

	test("refuses a file that is not a full path, or has spaces around it or a line break in it", () => {
		for (const path of ["timber", "./bin/timber", "", " /opt/timber", "/opt/timber\n", 42]) {
			expect(readTimberChoice({ kind: "file", path })).toBeUndefined();
		}
		expect(readTimberChoice({ kind: "shell" })).toBeUndefined();
		expect(readTimberChoice("bundled")).toBeUndefined();
		expect(applyPreferenceChange(defaultPreferences(), { timber: { kind: "file", path: "timber" } }).unreadable).toEqual(["timber"]);
	});

	test("a settings file with one that cannot be read falls back to the bundled Timber", () => {
		expect(readPreferences({ timber: { kind: "file" } }).timber).toEqual({ kind: "bundled" });
	});

	test("compares and writes only what the kind needs", () => {
		expect(sameTimberChoice({ kind: "path" }, { kind: "path" })).toBe(true);
		expect(sameTimberChoice({ kind: "file", path: "/a" }, { kind: "file", path: "/b" })).toBe(false);
		expect(sameTimberChoice({ kind: "bundled" }, { kind: "path" })).toBe(false);
		expect(writeTimberChoice({ kind: "file", path: "/a" })).toEqual({ kind: "file", path: "/a" });
		expect(writeTimberChoice({ kind: "bundled" })).toEqual({ kind: "bundled" });
	});
});
