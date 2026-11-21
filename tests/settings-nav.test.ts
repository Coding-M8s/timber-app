import { describe, expect, test } from "bun:test";
import { SETTINGS_NAV_FOOT, SETTINGS_NAV_GROUPS, TIMBER_SETTINGS_SECTIONS } from "../src/mainview/shell";
import { SETTINGS_SECTIONS } from "../src/mainview/store/state";

describe("the Settings list", () => {
	test("lists every section exactly once, in a group or at the foot", () => {
		const listed = [...SETTINGS_NAV_GROUPS.flatMap(group => group.sections), SETTINGS_NAV_FOOT];
		expect([...listed].sort()).toEqual([...SETTINGS_SECTIONS].sort());
		expect(new Set(listed).size).toBe(listed.length);
	});

	test("keeps About apart at the foot and Timber's own sections under Timber", () => {
		expect(SETTINGS_NAV_FOOT).toBe("about");
		expect(SETTINGS_NAV_GROUPS.find(group => group.label === "Timber")?.sections).toEqual(TIMBER_SETTINGS_SECTIONS);
		expect(SETTINGS_NAV_GROUPS.map(group => group.label)).toEqual(["Appearance", "Workflow", "Activity", "Timber"]);
	});
});
