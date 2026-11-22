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
import { git, makeRepository } from "./support/timber";
import { defaultFetchSetting } from "../src/shared/fetch-setting";
import { defaultStateSounds } from "../src/shared/sound-setting";
import { defaultThemeChoice } from "../src/shared/theme";
import { DEFAULT_LIGHT_THEME } from "../src/shared/builtin-themes";

const one = { path: "/work/timber", commonDir: "/work/timber/.git" };

describe("readPreferences", () => {
	test("puts the sidebar on the left by default", () => {
		expect(defaultPreferences()).toEqual({ sidebarSide: "left", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } });
		expect(readPreferences(undefined)).toEqual({ sidebarSide: "left", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } });
	});

	test("keeps a side it can read", () => {
		expect(readPreferences({ sidebarSide: "right" })).toEqual({ sidebarSide: "right", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } });
		expect(readPreferences({ sidebarSide: "left", later: "ignored" })).toEqual({ sidebarSide: "left", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } });
	});

	test("falls back to the default for anything it cannot read, and never fails", () => {
		for (const value of [null, "right", 7, [], { sidebarSide: "top" }, { sidebarSide: "Right" }, { sidebarSide: 1 }]) {
			expect(readPreferences(value)).toEqual(defaultPreferences());
		}
	});
});

describe("the Use chops preference", () => {
	test("is on by default, and only a true or false is read", () => {
		expect(defaultPreferences().useChops).toBe(true);
		expect(readPreferences({ useChops: false }).useChops).toBe(false);
		expect(readPreferences({ useChops: "no" }).useChops).toBe(true);
		expect(applyPreferenceChange(defaultPreferences(), { useChops: "off" }).unreadable).toEqual(["useChops"]);
	});

	test("turning it off leaves the saved chops alone", () => {
		const chop = { name: "Test", kind: "command" as const, text: "bun test", description: "", agent: null, repository: null, sound: null };
		const { preferences } = applyPreferenceChange({ ...defaultPreferences(), chops: [chop] }, { useChops: false });
		expect(preferences.useChops).toBe(false);
		expect(preferences.chops).toEqual([chop]);
	});
});

describe("applyPreferenceChange", () => {
	test("replaces only what the change names", () => {
		const saved = { sidebarSide: "right" as const, editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } };
		expect(applyPreferenceChange(saved, {})).toEqual({ preferences: saved, unreadable: [] });
		expect(applyPreferenceChange(saved, { sidebarSide: undefined })).toEqual({ preferences: saved, unreadable: [] });
		expect(applyPreferenceChange(saved, { sidebarSide: "left" })).toEqual({ preferences: { sidebarSide: "left", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } }, unreadable: [] });
	});

	test("keeps a part of the change it cannot read as it was, and names it", () => {
		const saved = { sidebarSide: "right" as const, editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } };
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
		expect(applyPreferenceChange(defaultPreferences(), { sounds: { ...defaultStateSounds(), done: { kind: "custom", path: "relative.wav" } } }).unreadable).toEqual(["sounds"]);
		// A change must name every state, so one that names only some cannot silence the rest.
		expect(applyPreferenceChange(defaultPreferences(), { sounds: { done: { kind: "system" } } }).unreadable).toEqual(["sounds"]);
	});

	test("every preference in the table is read, compared, and written", () => {
		const changed = { sidebarSide: "right" as const, editor: { command: "code", terminal: false }, agents: [{ name: "Aider", command: "aider --no-auto-commits" }], chops: [{ name: "Test", kind: "command" as const, text: "bun test", description: "", agent: null, repository: "/work/app", sound: null }], useChops: false, chopOrder: { "/work/app": { favorites: ["Test"], rest: ["Lint"] } }, fileChopSounds: { "/work/app": [{ name: "Lint", sound: { kind: "bundled" as const, name: "ping" as const } }] }, playChopSounds: false, fetch: { background: false, intervalMinutes: 30 }, zoom: 1.6, theme: { mode: "system" as const, light: "timber-light", dark: "nord" }, customThemes: [{ ...DEFAULT_LIGHT_THEME, id: "custom-mine", name: "Mine" }], terminal: { fontFamily: "JetBrainsMono Nerd Font", fontSize: 15, cursor: "bar" as const }, sessionNames: "issue" as const, statusNotifications: false, notifyStates: ["needs-you" as const], sounds: { "needs-you": { kind: "bundled" as const, name: "knock" as const }, done: { kind: "custom" as const, path: "/home/me/sounds/bell.ogg" }, error: null, crashed: { kind: "system" as const } }, dmabuf: "off" as const, timber: { kind: "file" as const, path: "/opt/timber/bin/timber" } };
		for (const key of Object.keys(PREFERENCE_PARTS) as (keyof typeof PREFERENCE_PARTS)[]) {
			expect(key in defaultPreferences()).toBe(true);
			expect(samePreferences(defaultPreferences(), { ...defaultPreferences(), [key]: changed[key] })).toBe(false);
			expect(readPreferences(writePreferences(changed))[key]).toEqual(changed[key]);
		}
	});

	test("never changes what it was given", () => {
		const saved = { sidebarSide: "left" as const, editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } };
		applyPreferenceChange(saved, { sidebarSide: "right" });
		expect(saved).toEqual({ sidebarSide: "left", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } });
	});

	test("samePreferences compares every preference", () => {
		expect(samePreferences({ sidebarSide: "left", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } }, { sidebarSide: "left", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } })).toBe(true);
		expect(samePreferences({ sidebarSide: "left", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } }, { sidebarSide: "right", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } })).toBe(false);
	});
});

describe("the preferences part of the settings file", () => {
	test("round-trips beside the repositories and the layout", () => {
		const settings = { repositories: [one], layout: { sidebarWidth: 300, collapsed: [], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: ["g-work"], chopsOpen: true, chopsWidth: 400, sidePanel: "files" as const }, preferences: { sidebarSide: "right" as const, editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } } };
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
		makeRepository(root, "sample");
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
		expect(await first.preferences.save({ sidebarSide: "right" })).toEqual({ outcome: "saved", preferences: { sidebarSide: "right", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } } });
		expect(onDisk()).toEqual({ version: 1, repositories: [], preferences: { sidebarSide: "right", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } } });
		// A new holder on the same file is what a restarted app has.
		expect(await appOn().preferences.load()).toEqual({ sidebarSide: "right", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } });
	});

	test("check what the interface sent, and refuse a change they cannot read without saving any of it", async () => {
		const { preferences } = appOn();
		await preferences.save({ sidebarSide: "right" });
		const before = readFileSync(settingsFile, "utf8");
		const result = await preferences.save({ sidebarSide: "top" as "left" });
		expect(result).toEqual({ outcome: "failed", message: "Nothing was saved, because these settings could not be read: sidebarSide." });
		expect(readFileSync(settingsFile, "utf8")).toBe(before);
		expect(await preferences.load()).toEqual({ sidebarSide: "right", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } });
	});

	test("saving them and changing the layout and the repository list never lose each other's part", async () => {
		const { preferences, layout, repositories } = appOn();
		// All asked for at once, as a person who saves a setting while a repository is being added.
		const results = await Promise.all([
			repositories.addFolder(primary),
			preferences.save({ sidebarSide: "right" }),
			layout.save({ sidebarWidth: 330, collapsed: [primary], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: [], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const }),
		]);
		expect(results.map(result => result.outcome)).toEqual(["added", "saved", "saved"]);
		expect(onDisk()).toEqual({
			version: 1,
			repositories: [{ path: primary, commonDir: join(primary, ".git") }],
			layout: { sidebarWidth: 330, collapsed: [primary], setupDismissed: [], uncommittedChanges: [], issueLists: {} },
			preferences: { sidebarSide: "right", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } },
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
				expect(await first.preferences.load()).toEqual({ sidebarSide: "left", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } });
				expect(await appOn().preferences.load()).toEqual({ sidebarSide: "left", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } });
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
		expect(onDisk()).toEqual({ version: 1, repositories: [saved], preferences: { sidebarSide: "right", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, chopOrder: {}, fileChopSounds: {}, playChopSounds: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, sounds: defaultStateSounds(), dmabuf: "auto" as const, timber: { kind: "bundled" as const } } });
	});

	test("turning chops off keeps the saved chops, and turning them on again brings them back after a restart", async () => {
		const chop = { name: "Test", kind: "command" as const, text: "bun test", description: "", agent: null, repository: null, sound: null };
		const first = appOn();
		await first.preferences.save({ chops: [chop] });
		const off = await first.preferences.save({ useChops: false });
		expect(off.outcome === "saved" && off.preferences.useChops).toBe(false);
		expect(onDisk().preferences.chops).toEqual([{ name: "Test", kind: "command", text: "bun test" }]);
		expect(onDisk().preferences.useChops).toBe(false);
		const restarted = appOn();
		expect(await restarted.preferences.load()).toMatchObject({ useChops: false, chops: [chop] });
		await restarted.preferences.save({ useChops: true });
		expect(await appOn().preferences.load()).toMatchObject({ useChops: true, chops: [chop] });
	});
});

describe("a sound for each state", () => {
	const bell = { kind: "custom" as const, path: "/home/me/sounds/bell.ogg" };
	const chime = { kind: "bundled" as const, name: "chime" as const };

	test("settings from before each state had its own sound carry over and sound the same", () => {
		// The ticked states play the one sound they all played; the rest stay quiet.
		expect(readPreferences({ soundStates: ["done", "crashed"], sound: bell }).sounds).toEqual({ "needs-you": null, done: bell, error: null, crashed: bell });
		expect(readPreferences({ soundStates: ["needs-you"], sound: { kind: "system" } }).sounds).toEqual({ "needs-you": { kind: "system" }, done: null, error: null, crashed: null });
		// No sound was saved: the chime, as it was read then.
		expect(readPreferences({ soundStates: ["error"] }).sounds).toEqual({ "needs-you": null, done: null, error: chime, crashed: null });
		// A sound that could not be read was the chime too.
		expect(readPreferences({ soundStates: ["error"], sound: { kind: "custom", path: "relative.wav" } }).sounds.error).toEqual(chime);
		// A sound with no states ticked, or a list that could not be read, played nothing.
		expect(readPreferences({ sound: bell }).sounds).toEqual(defaultStateSounds());
		expect(readPreferences({ soundStates: ["done", "later"], sound: bell }).sounds).toEqual(defaultStateSounds());
		expect(readPreferences({ soundStates: [], sound: bell }).sounds).toEqual(defaultStateSounds());
	});

	test("the old parts are not written again, and saved sounds win over them", () => {
		const carried = readPreferences({ soundStates: ["done"], sound: bell });
		const written = writePreferences(carried);
		expect(Object.hasOwn(written, "soundStates")).toBe(false);
		expect(Object.hasOwn(written, "sound")).toBe(false);
		expect(readPreferences(written).sounds).toEqual(carried.sounds);
		const sounds = { "needs-you": chime, done: null, error: null, crashed: null };
		expect(readPreferences({ sounds, soundStates: ["done"], sound: bell }).sounds).toEqual(sounds);
		// Saved sounds that cannot be read whole are salvaged, never taken from the old parts.
		expect(readPreferences({ sounds: { done: bell }, soundStates: ["crashed"], sound: bell }).sounds).toEqual({ "needs-you": null, done: bell, error: null, crashed: null });
		// Saved sounds that cannot be read or salvaged at all leave the old parts to say what played.
		expect(readPreferences({ sounds: "loud", soundStates: ["done"], sound: bell }).sounds).toEqual({ "needs-you": null, done: bell, error: null, crashed: null });
		expect(readPreferences({ sounds: null, soundStates: ["done"], sound: bell }).sounds.done).toEqual(bell);
		// Only the file is carried over: a change from the window naming the old parts changes nothing.
		expect(applyPreferenceChange(defaultPreferences(), { soundStates: ["done"], sound: bell })).toEqual({ preferences: defaultPreferences(), unreadable: [] });
	});

	test("a saved entry that cannot be read plays the chime, and a missing one plays nothing", () => {
		expect(readPreferences({ sounds: { "needs-you": { kind: "bundled", name: "gong" }, done: bell, error: null } }).sounds).toEqual({ "needs-you": chime, done: bell, error: null, crashed: null });
		expect(readPreferences({ sounds: "loud" }).sounds).toEqual(defaultStateSounds());
		expect(readPreferences({ sounds: { ...defaultStateSounds(), done: bell, later: chime } }).sounds).toEqual({ "needs-you": null, done: bell, error: null, crashed: null });
	});
});
