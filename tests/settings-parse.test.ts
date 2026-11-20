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

describe("repository groups", () => {
	const work = { id: "g-work", name: "Work" };
	const personal = { id: "g-personal", name: "Personal" };

	test("round-trip the groups and each repository's group, written after the repositories", () => {
		const settings = { repositories: [{ ...one, group: work.id }, two], groups: [work, personal] };
		const text = serializeSettings(settings);
		expect(parseSettings(text)).toEqual(settings);
		expect(Object.keys(JSON.parse(text))).toEqual(["version", "repositories", "groups"]);
		expect(JSON.parse(text).repositories).toEqual([{ ...one, group: work.id }, two]);
	});

	test("a file with no groups is written exactly as before groups existed", () => {
		const text = "{\n\t\"version\": 1,\n\t\"repositories\": [\n\t\t{\n\t\t\t\"path\": \"/work/timber\",\n\t\t\t\"commonDir\": \"/work/timber/.git\"\n\t\t},\n\t\t{\n\t\t\t\"path\": \"/work/api-server\",\n\t\t\t\"commonDir\": \"/work/api-server/.git\"\n\t\t}\n\t],\n\t\"layout\": {\n\t\t\"sidebarWidth\": 300,\n\t\t\"collapsed\": [\n\t\t\t\"/work/timber\"\n\t\t],\n\t\t\"setupDismissed\": [],\n\t\t\"uncommittedChanges\": [],\n\t\t\"issueLists\": {}\n\t}\n}\n";
		expect(serializeSettings(parseSettings(text)!)).toBe(text);
		expect(serializeSettings({ repositories: [one], groups: [] })).toBe(serializeSettings({ repositories: [one] }));
	});

	test("a group that names no saved group is dropped, and the repository kept", () => {
		const text = JSON.stringify({ version: 1, repositories: [{ ...one, group: "gone" }, { ...two, group: work.id }], groups: [work] });
		expect(parseSettings(text)).toEqual({ repositories: [one, { ...two, group: work.id }], groups: [work] });
		expect(parseSettings(JSON.stringify({ version: 1, repositories: [{ ...one, group: 7 }] }))).toEqual({ repositories: [one] });
	});

	test("unreadable group data never costs the repository list", () => {
		for (const groups of [5, "Work", null, {}, [7, { id: "", name: "x" }, { id: "a", name: 3 }]]) {
			expect(parseSettings(JSON.stringify({ version: 1, repositories: [{ ...one, group: "a" }, two], groups }))).toEqual({ repositories: [one, two] });
		}
		expect(parseSettings(JSON.stringify({ version: 1, repositories: [one], groups: [work, { id: work.id, name: "Again" }, { id: "x", name: "  " }] })))
			.toEqual({ repositories: [one], groups: [work] });
	});

	test("the folded groups round-trip in the layout", () => {
		const settings = { repositories: [{ ...one, group: work.id }], groups: [work], layout: { sidebarWidth: 300, collapsed: [], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [work.id] } };
		expect(parseSettings(serializeSettings(settings))).toEqual(settings);
		expect(JSON.parse(serializeSettings(settings)).layout.collapsedGroups).toEqual([work.id]);
	});
});
