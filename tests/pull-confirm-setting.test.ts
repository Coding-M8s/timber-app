import { describe, expect, test } from "bun:test";
import { defaultPreferences, readPreferences, writePreferences } from "../src/shared/preferences";
import {
	PULL_SKIP_LIMIT, confirmsPull, defaultPullConfirmSetting, forgetPullRepository, readPullConfirmSetting,
	samePullConfirmSetting, skipsPullConfirmation, withPullSkipped, writePullConfirmSetting,
} from "../src/shared/pull-confirm-setting";

describe("the Pull setting", () => {
	test("asks before pulling in every repository by default", () => {
		expect(defaultPullConfirmSetting()).toEqual({ ask: true, skip: [] });
		expect(defaultPreferences().pull).toEqual({ ask: true, skip: [] });
		expect(confirmsPull(defaultPullConfirmSetting(), "/work/app")).toBe(true);
	});

	test("asks only while Ask before pulling is on and the repository's own switch is off", () => {
		const skipped = { ask: true, skip: ["/work/app"] };
		expect(confirmsPull(skipped, "/work/app")).toBe(false);
		expect(confirmsPull(skipped, "/work/other")).toBe(true);
		expect(confirmsPull({ ask: false, skip: [] }, "/work/app")).toBe(false);
		expect(confirmsPull({ ask: false, skip: ["/work/app"] }, "/work/other")).toBe(false);
		expect(skipsPullConfirmation({ ask: false, skip: [] }, "/work/app")).toBe(false);
		expect(skipsPullConfirmation(skipped, "/work/app")).toBe(true);
	});

	test("reads a whole setting, with the paths sorted and each once", () => {
		expect(readPullConfirmSetting({ ask: false, skip: ["/b", "/a", "/b"] })).toEqual({ ask: false, skip: ["/a", "/b"] });
		expect(readPullConfirmSetting({ ask: true, skip: [] })).toEqual({ ask: true, skip: [] });
	});

	test("refuses a setting any part of which cannot be read", () => {
		for (const value of [null, undefined, "on", [], { ask: "yes", skip: [] }, { skip: [] }, { ask: true }, { ask: true, skip: "/a" }, { ask: true, skip: [""] }, { ask: true, skip: [3] }, { ask: true, skip: ["/a\n/b"] }]) {
			expect(readPullConfirmSetting(value)).toBeUndefined();
		}
		const many = Array.from({ length: PULL_SKIP_LIMIT + 1 }, (_, index) => `/work/repo-${index}`);
		expect(readPullConfirmSetting({ ask: true, skip: many })).toBeUndefined();
	});

	test("a saved value that cannot be read asks, never skips", () => {
		expect(readPreferences({ pull: "skip everything" }).pull).toEqual({ ask: true, skip: [] });
		// Any part that cannot be read: the whole setting asks, even what could be read of it.
		expect(readPreferences({ pull: { ask: 0, skip: ["/work/app"] } }).pull).toEqual({ ask: true, skip: [] });
		expect(readPreferences({ pull: { ask: false, skip: "everything" } }).pull).toEqual({ ask: true, skip: [] });
		expect(readPreferences({ pull: { ask: false, skip: ["/work/app", 4] } }).pull).toEqual({ ask: true, skip: [] });
		expect(confirmsPull(readPreferences({ pull: { ask: false } }).pull, "/work/app")).toBe(true);
	});

	test("compares and writes every part, and survives a write and a read", () => {
		const setting = { ask: false, skip: ["/work/app"] };
		expect(samePullConfirmSetting(setting, { ask: false, skip: ["/work/app"] })).toBe(true);
		expect(samePullConfirmSetting(setting, { ask: true, skip: ["/work/app"] })).toBe(false);
		expect(samePullConfirmSetting(setting, { ask: false, skip: [] })).toBe(false);
		expect(samePullConfirmSetting(setting, { ask: false, skip: ["/work/other"] })).toBe(false);
		expect(writePullConfirmSetting(setting)).toEqual({ ask: false, skip: ["/work/app"] });
		expect(readPreferences(writePreferences({ ...defaultPreferences(), pull: setting })).pull).toEqual(setting);
	});

	test("turns one repository's switch on and off, and forgets a repository that left", () => {
		const one = withPullSkipped(defaultPullConfirmSetting(), "/work/b", true);
		const two = withPullSkipped(one, "/work/a", true);
		expect(two).toEqual({ ask: true, skip: ["/work/a", "/work/b"] });
		expect(withPullSkipped(two, "/work/a", true)).toEqual(two);
		expect(withPullSkipped(two, "/work/a", false)).toEqual({ ask: true, skip: ["/work/b"] });
		expect(forgetPullRepository(two, "/work/b")).toEqual({ ask: true, skip: ["/work/a"] });
		expect(forgetPullRepository({ ask: false, skip: [] }, "/work/b")).toEqual({ ask: false, skip: [] });
	});
});
