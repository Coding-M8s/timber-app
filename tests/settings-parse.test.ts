import { describe, expect, test } from "bun:test";
import { emptySettings, parseSettings, serializeSettings } from "../src/shared/settings";

const one = { path: "/work/timber", commonDir: "/work/timber/.git" };
const two = { path: "/work/api-server", commonDir: "/work/api-server/.git" };

describe("serializeSettings and parseSettings", () => {
	test("round-trip the saved repositories in order", () => {
		const settings = { repositories: [one, two] };
		expect(parseSettings(serializeSettings(settings))).toEqual(settings);
		expect(parseSettings(serializeSettings(emptySettings()))).toEqual({ repositories: [] });
	});

	test("write a versioned file that ends with a newline", () => {
		const text = serializeSettings({ repositories: [one] });
		expect(JSON.parse(text)).toEqual({ version: 1, repositories: [one] });
		expect(text.endsWith("}\n")).toBe(true);
	});
});

describe("the window part", () => {
	const window = { frame: { x: 300, y: 200, width: 1500, height: 900 }, maximized: true };

	test("round-trips next to the repositories", () => {
		const settings = { repositories: [one], window };
		expect(JSON.parse(serializeSettings(settings)).window).toEqual(window);
		expect(parseSettings(serializeSettings(settings))).toEqual(settings);
	});

	test("is left out when it cannot be read, and never makes the file count as damaged", () => {
		for (const damaged of [null, "wide", { frame: { x: 0, y: 0, width: 10, height: 10 } }]) {
			expect(parseSettings(JSON.stringify({ version: 1, repositories: [one], window: damaged }))).toEqual({ repositories: [one] });
		}
	});
});

describe("parseSettings", () => {
	test("reads a file without a repository list as empty", () => {
		expect(parseSettings('{"version":1}')).toEqual({ repositories: [] });
	});

	test("keeps the first of a repeated repository", () => {
		const moved = { path: "/elsewhere", commonDir: one.commonDir };
		expect(parseSettings(JSON.stringify({ version: 1, repositories: [one, two, one, moved] }))).toEqual({ repositories: [one, two] });
	});

	test("answers null for anything damaged", () => {
		const damaged = [
			"",
			"{",
			'{"version":1,"repositories":[{"path":"/work/timber","commonDir":"/work',
			"null",
			"[]",
			'"text"',
			"{}",
			'{"version":2,"repositories":[]}',
			'{"version":1,"repositories":{}}',
			'{"version":1,"repositories":["/work/timber"]}',
			'{"version":1,"repositories":[{"path":"/work/timber"}]}',
			'{"version":1,"repositories":[{"path":"","commonDir":"/x"}]}',
			'{"version":1,"repositories":[{"path":7,"commonDir":"/x"}]}',
		];
		for (const text of damaged) expect(parseSettings(text)).toBeNull();
	});
});
