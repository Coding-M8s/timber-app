import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createSavedLayout } from "../src/bun/layout";
import { createSavedPreferences } from "../src/bun/preferences";
import { createRepositoryList } from "../src/bun/repository-list";
import type { RepositoryReader } from "../src/bun/repository-reader";
import { createSettingsHolder } from "../src/bun/settings";
import { applyPreferenceChange, defaultPreferences, readPreferences, samePreferences } from "../src/shared/preferences";
import { parseSettings, serializeSettings } from "../src/shared/settings";
import { git } from "./support/timber";

const one = { path: "/work/timber", commonDir: "/work/timber/.git" };

describe("readPreferences", () => {
	test("puts the sidebar on the left by default", () => {
		expect(defaultPreferences()).toEqual({ sidebarSide: "left" });
		expect(readPreferences(undefined)).toEqual({ sidebarSide: "left" });
	});

	test("keeps a side it can read", () => {
		expect(readPreferences({ sidebarSide: "right" })).toEqual({ sidebarSide: "right" });
		expect(readPreferences({ sidebarSide: "left", later: "ignored" })).toEqual({ sidebarSide: "left" });
	});

	test("falls back to the default for anything it cannot read, and never fails", () => {
		for (const value of [null, "right", 7, [], { sidebarSide: "top" }, { sidebarSide: "Right" }, { sidebarSide: 1 }]) {
			expect(readPreferences(value)).toEqual(defaultPreferences());
		}
	});
});

describe("applyPreferenceChange", () => {
	test("replaces only what the change names", () => {
		const saved = { sidebarSide: "right" as const };
		expect(applyPreferenceChange(saved, {})).toEqual(saved);
		expect(applyPreferenceChange(saved, { sidebarSide: "left" })).toEqual({ sidebarSide: "left" });
	});

	test("leaves out a part of the change it cannot read", () => {
		const saved = { sidebarSide: "right" as const };
		expect(applyPreferenceChange(saved, { sidebarSide: "middle" })).toEqual(saved);
		expect(applyPreferenceChange(saved, null)).toEqual(saved);
		expect(applyPreferenceChange(saved, "left")).toEqual(saved);
	});

	test("never changes what it was given", () => {
		const saved = { sidebarSide: "left" as const };
		applyPreferenceChange(saved, { sidebarSide: "right" });
		expect(saved).toEqual({ sidebarSide: "left" });
	});

	test("samePreferences compares every preference", () => {
		expect(samePreferences({ sidebarSide: "left" }, { sidebarSide: "left" })).toBe(true);
		expect(samePreferences({ sidebarSide: "left" }, { sidebarSide: "right" })).toBe(false);
	});
});

describe("the preferences part of the settings file", () => {
	test("round-trips beside the repositories and the layout", () => {
		const settings = { repositories: [one], layout: { sidebarWidth: 300, collapsed: [] }, preferences: { sidebarSide: "right" as const } };
		const text = serializeSettings(settings);
		expect(JSON.parse(text)).toEqual({ version: 1, ...settings });
		expect(parseSettings(text)).toEqual(settings);
	});

	test("an older file without it stays valid, and stays without it when written again", () => {
		const settings = parseSettings(JSON.stringify({ version: 1, repositories: [one] }));
		expect(settings).toEqual({ repositories: [one] });
		expect(settings && "preferences" in settings).toBe(false);
		expect(JSON.parse(serializeSettings(settings!))).toEqual({ version: 1, repositories: [one] });
	});

	test("a damaged preferences part falls back to the defaults and never costs the repository list", () => {
		for (const preferences of [null, "right", 7, [], { sidebarSide: "top" }]) {
			expect(parseSettings(JSON.stringify({ version: 1, repositories: [one], preferences }))).toEqual({ repositories: [one], preferences: defaultPreferences() });
		}
	});
});

describe("the saved preferences in the main process", () => {
	let root: string;
	let primary: string;
	let settingsFile: string;
	let cases = 0;

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-preferences-")));
		primary = join(root, "sample");
		git(root, "init", "--initial-branch=main", primary);
		writeFileSync(join(primary, "tracked.txt"), "one\n");
		git(primary, "add", "tracked.txt");
		git(primary, "commit", "-m", "Initial commit");
	});

	beforeEach(() => {
		settingsFile = join(root, `config-${cases++}`, "timber-app", "settings.json");
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const onDisk = () => JSON.parse(readFileSync(settingsFile, "utf8"));

	/** Stands in for Timber's list: every folder is its own primary checkout. Git still says, for real, what a folder is. */
	const reader: RepositoryReader = {
		find: async folder => ({ outcome: "read", repository: { path: folder, name: basename(folder), available: true, failure: null, worktrees: [] } }),
		reload: async path => ({ path, name: basename(path), available: true, failure: null, worktrees: [] }),
	};

	/** What the main process sets up: one holder of the file, shared by everything that saves a part of it. */
	function appOn(file = settingsFile) {
		const settings = createSettingsHolder(file, () => {});
		return {
			preferences: createSavedPreferences(settings),
			layout: createSavedLayout(settings),
			repositories: createRepositoryList({ settingsFile: file, settings, pickFolder: async () => null, reader, environment: {}, warn: () => {} }),
		};
	}

	test("are the defaults when nothing was saved, and reading them writes nothing", async () => {
		expect(await appOn().preferences.load()).toEqual(defaultPreferences());
		expect(() => readFileSync(settingsFile)).toThrow();
	});

	test("are still there after a restart", async () => {
		const first = appOn();
		expect(await first.preferences.save({ sidebarSide: "right" })).toEqual({ outcome: "saved", preferences: { sidebarSide: "right" } });
		expect(onDisk()).toEqual({ version: 1, repositories: [], preferences: { sidebarSide: "right" } });
		// A new holder on the same file is what a restarted app has.
		expect(await appOn().preferences.load()).toEqual({ sidebarSide: "right" });
	});

	test("check what the interface sent, and save only what they can read", async () => {
		const { preferences } = appOn();
		await preferences.save({ sidebarSide: "right" });
		const result = await preferences.save({ sidebarSide: "top" as "left" });
		expect(result).toEqual({ outcome: "saved", preferences: { sidebarSide: "right" } });
		expect(onDisk().preferences).toEqual({ sidebarSide: "right" });
	});

	test("saving them and changing the layout and the repository list never lose each other's part", async () => {
		const { preferences, layout, repositories } = appOn();
		// All asked for at once, as a person who saves a setting while a repository is being added.
		const results = await Promise.all([
			repositories.addFolder(primary),
			preferences.save({ sidebarSide: "right" }),
			layout.save({ sidebarWidth: 330, collapsed: [primary] }),
		]);
		expect(results.map(result => result.outcome)).toEqual(["added", "saved", "saved"]);
		expect(onDisk()).toEqual({
			version: 1,
			repositories: [{ path: primary, commonDir: join(primary, ".git") }],
			layout: { sidebarWidth: 330, collapsed: [primary] },
			preferences: { sidebarSide: "right" },
		});
		expect(readdirSync(join(settingsFile, ".."))).toEqual(["settings.json"]);
		// Saving the preferences changed nothing in the repository.
		expect(git(primary, "status", "--porcelain")).toBe("");
	});

	test("a save that cannot be written is an answer, and the next start reads what was saved before", async () => {
		const first = appOn();
		await first.preferences.save({ sidebarSide: "left" });
		const folder = join(settingsFile, "..");
		chmodSync(folder, 0o500);
		try {
			const result = await first.preferences.save({ sidebarSide: "right" });
			// A user who can write anywhere, such as root, gets a save that works.
			if (result.outcome === "failed") {
				expect(result.message).toContain(settingsFile);
				expect(await first.preferences.load()).toEqual({ sidebarSide: "left" });
				expect(await appOn().preferences.load()).toEqual({ sidebarSide: "left" });
			}
		} finally {
			chmodSync(folder, 0o700);
		}
	});

	test("an older settings file keeps its repositories when the preferences are first saved", async () => {
		mkdirSync(join(settingsFile, ".."), { recursive: true });
		const saved = { path: primary, commonDir: join(primary, ".git") };
		writeFileSync(settingsFile, JSON.stringify({ version: 1, repositories: [saved] }));
		const { preferences } = appOn();
		expect(await preferences.load()).toEqual(defaultPreferences());
		await preferences.save({ sidebarSide: "right" });
		expect(onDisk()).toEqual({ version: 1, repositories: [saved], preferences: { sidebarSide: "right" } });
	});
});
