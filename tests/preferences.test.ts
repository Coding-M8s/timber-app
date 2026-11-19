import { defaultTerminalAppearance } from "../src/shared/terminal-appearance";
import { AGENT_PRESETS } from "../src/shared/agent";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createSavedLayout } from "../src/bun/layout";
import { createSavedPreferences } from "../src/bun/preferences";
import { createRepositoryList } from "../src/bun/repository-list";
import type { RepositoryReader } from "../src/bun/repository-reader";
import { createSettingsHolder } from "../src/bun/settings";
import { PREFERENCE_PARTS, applyPreferenceChange, readAlertStates, defaultPreferences, readPreferences, samePreferences, writePreferences } from "../src/shared/preferences";
import { parseSettings, serializeSettings } from "../src/shared/settings";
import { git } from "./support/timber";
import { defaultFetchSetting } from "../src/shared/fetch-setting";
import { defaultThemeChoice } from "../src/shared/theme";
import { DEFAULT_LIGHT_THEME } from "../src/shared/builtin-themes";

const one = { path: "/work/timber", commonDir: "/work/timber/.git" };

describe("readPreferences", () => {
	test("puts the sidebar on the left by default", () => {
		expect(defaultPreferences()).toEqual({ sidebarSide: "left", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } });
		expect(readPreferences(undefined)).toEqual({ sidebarSide: "left", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } });
	});

	test("keeps a side it can read", () => {
		expect(readPreferences({ sidebarSide: "right" })).toEqual({ sidebarSide: "right", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } });
		expect(readPreferences({ sidebarSide: "left", later: "ignored" })).toEqual({ sidebarSide: "left", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } });
	});

	test("falls back to the default for anything it cannot read, and never fails", () => {
		for (const value of [null, "right", 7, [], { sidebarSide: "top" }, { sidebarSide: "Right" }, { sidebarSide: 1 }]) {
			expect(readPreferences(value)).toEqual(defaultPreferences());
		}
	});
});

describe("applyPreferenceChange", () => {
	test("replaces only what the change names", () => {
		const saved = { sidebarSide: "right" as const, editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } };
		expect(applyPreferenceChange(saved, {})).toEqual({ preferences: saved, unreadable: [] });
		expect(applyPreferenceChange(saved, { sidebarSide: undefined })).toEqual({ preferences: saved, unreadable: [] });
		expect(applyPreferenceChange(saved, { sidebarSide: "left" })).toEqual({ preferences: { sidebarSide: "left", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } }, unreadable: [] });
	});

	test("keeps a part of the change it cannot read as it was, and names it", () => {
		const saved = { sidebarSide: "right" as const, editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } };
		expect(applyPreferenceChange(saved, { sidebarSide: "middle" })).toEqual({ preferences: saved, unreadable: ["sidebarSide"] });
		expect(applyPreferenceChange(saved, { sidebarSide: null })).toEqual({ preferences: saved, unreadable: ["sidebarSide"] });
		// Something that is not a change at all names nothing.
		expect(applyPreferenceChange(saved, null)).toEqual({ preferences: saved, unreadable: [] });
		expect(applyPreferenceChange(saved, "left")).toEqual({ preferences: saved, unreadable: [] });
	});

	test("the statuses that notify or play a sound are read in Settings order, and anything else is refused", () => {
		expect(readAlertStates(["crashed", "needs-you", "crashed"])).toEqual(["needs-you", "crashed"]);
		expect(readAlertStates([])).toEqual([]);
		expect(readAlertStates(["working"])).toBeUndefined();
		expect(readAlertStates("done")).toBeUndefined();
		expect(applyPreferenceChange(defaultPreferences(), { soundStates: ["later"] }).unreadable).toEqual(["soundStates"]);
		expect(applyPreferenceChange(defaultPreferences(), { sound: { kind: "custom", path: "relative.wav" } }).unreadable).toEqual(["sound"]);
	});

	test("every preference in the table is read, compared, and written", () => {
		const changed = { sidebarSide: "right" as const, editor: { command: "code", terminal: false }, agents: [{ name: "Aider", command: "aider --no-auto-commits" }], fetch: { background: false, intervalMinutes: 30 }, zoom: 1.6, theme: { mode: "system" as const, light: "timber-light", dark: "nord" }, customThemes: [{ ...DEFAULT_LIGHT_THEME, id: "custom-mine", name: "Mine" }], terminal: { fontFamily: "JetBrainsMono Nerd Font", fontSize: 15, cursor: "bar" as const }, statusNotifications: false, notifyStates: ["needs-you" as const], soundStates: ["done" as const, "crashed" as const], sound: { kind: "custom" as const, path: "/home/me/sounds/bell.ogg" } };
		for (const key of Object.keys(PREFERENCE_PARTS) as (keyof typeof PREFERENCE_PARTS)[]) {
			expect(key in defaultPreferences()).toBe(true);
			expect(samePreferences(defaultPreferences(), { ...defaultPreferences(), [key]: changed[key] })).toBe(false);
			expect(readPreferences(writePreferences(changed))[key]).toEqual(changed[key]);
		}
	});

	test("never changes what it was given", () => {
		const saved = { sidebarSide: "left" as const, editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } };
		applyPreferenceChange(saved, { sidebarSide: "right" });
		expect(saved).toEqual({ sidebarSide: "left", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } });
	});

	test("samePreferences compares every preference", () => {
		expect(samePreferences({ sidebarSide: "left", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } }, { sidebarSide: "left", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } })).toBe(true);
		expect(samePreferences({ sidebarSide: "left", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } }, { sidebarSide: "right", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } })).toBe(false);
	});
});

describe("the preferences part of the settings file", () => {
	test("round-trips beside the repositories and the layout", () => {
		const settings = { repositories: [one], layout: { sidebarWidth: 300, collapsed: [], setupDismissed: [] }, preferences: { sidebarSide: "right" as const, editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } } };
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
		find: async folder => ({ outcome: "read", repository: { path: folder, name: basename(folder), available: true, failure: null, setup: "unknown", worktrees: [] } }),
		reload: async path => ({ path, name: basename(path), available: true, failure: null, setup: "unknown", worktrees: [] }),
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
		expect(await first.preferences.save({ sidebarSide: "right" })).toEqual({ outcome: "saved", preferences: { sidebarSide: "right", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } } });
		expect(onDisk()).toEqual({ version: 1, repositories: [], preferences: { sidebarSide: "right", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } } });
		// A new holder on the same file is what a restarted app has.
		expect(await appOn().preferences.load()).toEqual({ sidebarSide: "right", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } });
	});

	test("check what the interface sent, and refuse a change they cannot read without saving any of it", async () => {
		const { preferences } = appOn();
		await preferences.save({ sidebarSide: "right" });
		const before = readFileSync(settingsFile, "utf8");
		const result = await preferences.save({ sidebarSide: "top" as "left" });
		expect(result).toEqual({ outcome: "failed", message: "Nothing was saved, because these settings could not be read: sidebarSide." });
		expect(readFileSync(settingsFile, "utf8")).toBe(before);
		expect(await preferences.load()).toEqual({ sidebarSide: "right", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } });
	});

	test("saving them and changing the layout and the repository list never lose each other's part", async () => {
		const { preferences, layout, repositories } = appOn();
		// All asked for at once, as a person who saves a setting while a repository is being added.
		const results = await Promise.all([
			repositories.addFolder(primary),
			preferences.save({ sidebarSide: "right" }),
			layout.save({ sidebarWidth: 330, collapsed: [primary], setupDismissed: [] }),
		]);
		expect(results.map(result => result.outcome)).toEqual(["added", "saved", "saved"]);
		expect(onDisk()).toEqual({
			version: 1,
			repositories: [{ path: primary, commonDir: join(primary, ".git") }],
			layout: { sidebarWidth: 330, collapsed: [primary], setupDismissed: [] },
			preferences: { sidebarSide: "right", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } },
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
				expect(await first.preferences.load()).toEqual({ sidebarSide: "left", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } });
				expect(await appOn().preferences.load()).toEqual({ sidebarSide: "left", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } });
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
		expect(onDisk()).toEqual({ version: 1, repositories: [saved], preferences: { sidebarSide: "right", editor: null, agents: AGENT_PRESETS, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const } } });
	});
});
