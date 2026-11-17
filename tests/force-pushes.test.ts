import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSavedForcePushes } from "../src/bun/force-pushes";
import { createSettingsHolder } from "../src/bun/settings";
import { parseSettings, serializeSettings } from "../src/shared/settings";

const one = { path: "/work/timber", commonDir: "/work/timber/.git" };
const mark = { upstream: "refs/remotes/origin/main", upstreamName: "origin/main", object: "a".repeat(40), branchObject: "b".repeat(40), at: 7 };

describe("the force-push marks part of the settings file", () => {
	test("round-trips, and is left out when there are none", () => {
		const settings = { repositories: [one], forcePushes: { [one.path]: { main: mark } } };
		expect(parseSettings(serializeSettings(settings))).toEqual(settings);
		expect(serializeSettings({ repositories: [one], forcePushes: {} })).not.toContain("forcePushes");
		expect(parseSettings(serializeSettings({ repositories: [one], forcePushes: {} }))).toEqual({ repositories: [one] });
	});

	test("a damaged part is dropped and never costs the repository list", () => {
		for (const forcePushes of [null, "x", [], { [one.path]: { main: { ...mark, object: "nope" } } }]) {
			expect(parseSettings(JSON.stringify({ version: 1, repositories: [one], forcePushes }))).toEqual({ repositories: [one] });
		}
	});
});

describe("createSavedForcePushes", () => {
	let root: string;
	let file: string;
	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-force-pushes-")));
		file = join(root, "settings.json");
	});
	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("saves the marks beside the other parts, and takes the part away when none are left", async () => {
		const settings = createSettingsHolder(file);
		await settings.save({ repositories: [one], layout: { sidebarWidth: 300, collapsed: [], setupDismissed: [] } });
		const saved = createSavedForcePushes(settings);
		expect(await saved.load()).toEqual({});
		await saved.save({ [one.path]: { main: mark } });
		expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ repositories: [one], layout: { sidebarWidth: 300 }, forcePushes: { [one.path]: { main: mark } } });
		expect(await createSavedForcePushes(createSettingsHolder(file)).load()).toEqual({ [one.path]: { main: mark } });
		await saved.save({});
		expect(JSON.parse(readFileSync(file, "utf8")).forcePushes).toBeUndefined();
	});

	test("a save that fails is a warning without branch names, and changes nothing", async () => {
		const warnings: string[] = [];
		const settings = createSettingsHolder(join(root, "missing", "\0", "settings.json"), () => {});
		const saved = createSavedForcePushes(settings, message => warnings.push(message));
		await saved.save({ [one.path]: { "secret-branch": mark } });
		expect(warnings.length).toBe(1);
		expect(warnings[0]).toContain("force-pushed");
		expect(warnings[0]).not.toContain("secret-branch");
		expect(await saved.load()).toEqual({});
	});
});
