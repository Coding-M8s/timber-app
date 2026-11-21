import { defaultTerminalAppearance } from "../src/shared/terminal-appearance";
import { AGENT_PRESETS } from "../src/shared/agent";
import { describe, expect, test } from "bun:test";
import {
	EDITOR_PRESETS, describeEditorCommand, describeOtherExecutableNames, editorCommand, otherExecutableNames, presetOf, readEditorSetting, sameEditorSetting,
	writeEditorSetting,
} from "../src/shared/editor";
import { applyPreferenceChange, defaultPreferences, readPreferences, samePreferences } from "../src/shared/preferences";
import { parseSettings, serializeSettings } from "../src/shared/settings";
import { defaultFetchSetting } from "../src/shared/fetch-setting";
import { defaultThemeChoice } from "../src/shared/theme";

const SPACED = "/work/my repo-worktrees/feat login";

describe("editorCommand", () => {
	test("the worktree path is the last argument, one argument even with spaces", () => {
		expect(editorCommand({ command: "code", terminal: false }, SPACED)).toEqual({ ok: true, executable: "code", arguments: [SPACED] });
		expect(editorCommand({ command: "zed --new", terminal: false }, SPACED)).toEqual({ ok: true, executable: "zed", arguments: ["--new", SPACED] });
	});

	test("{path} takes the place of the path, also inside a word, and then nothing is added", () => {
		expect(editorCommand({ command: "edit --folder {path} --wait", terminal: false }, SPACED))
			.toEqual({ ok: true, executable: "edit", arguments: ["--folder", SPACED, "--wait"] });
		expect(editorCommand({ command: "edit --folder={path}", terminal: false }, SPACED))
			.toEqual({ ok: true, executable: "edit", arguments: [`--folder=${SPACED}`] });
	});

	test("dollar signs in the path are taken as they are, where {path} stands", () => {
		for (const path of ["/work/a$$b", "/work/it$'s", "/work/a$`b", "/work/cash$&x", "/work/$1 and $<name>"]) {
			expect(editorCommand({ command: "edit --folder={path} --wait", terminal: false }, path))
				.toEqual({ ok: true, executable: "edit", arguments: [`--folder=${path}`, "--wait"] });
			expect(editorCommand({ command: "edit {path}", terminal: false }, path)).toEqual({ ok: true, executable: "edit", arguments: [path] });
		}
	});

	test("a path that looks like an option, or holds quotes or {path}, is still one argument", () => {
		for (const path of ["--help", `/work/it's "here"`, "/work/{path}", "/work/a;b|c $(id)"]) {
			const command = editorCommand({ command: "code -n", terminal: false }, path);
			expect(command).toEqual({ ok: true, executable: "code", arguments: ["-n", path] });
		}
	});

	test("an executable with spaces in its path is quoted in the setting", () => {
		expect(editorCommand({ command: `"/opt/My Editor/bin/edit" -r`, terminal: false }, "/work/a"))
			.toEqual({ ok: true, executable: "/opt/My Editor/bin/edit", arguments: ["-r", "/work/a"] });
	});

	test("an empty or unreadable command is an error", () => {
		expect(editorCommand({ command: "   ", terminal: false }, "/work/a")).toEqual({ ok: false, message: "The editor command is empty." });
		expect(editorCommand({ command: `code "x`, terminal: false }, "/work/a"))
			.toEqual({ ok: false, message: "The editor command cannot be read: The double quote at character 6 is never closed." });
		expect(editorCommand({ command: `"" x`, terminal: false }, "/work/a")).toEqual({ ok: false, message: "The editor command is empty." });
	});

	test("the description is the exact command, quoted for reading", () => {
		expect(describeEditorCommand({ command: "code", terminal: false }, SPACED)).toBe(`code '${SPACED}'`);
		expect(describeEditorCommand({ command: "nvim", terminal: true }, "/work/a")).toBe("nvim /work/a");
		expect(describeEditorCommand({ command: `code "x`, terminal: false }, "/work/a")).toBeNull();
	});
});

describe("presets", () => {
	test("VS Code, Zed, and Neovim, and only Neovim runs in a terminal", () => {
		expect(EDITOR_PRESETS.map(preset => [preset.label, preset.setting.command, preset.setting.terminal]))
			.toEqual([["VS Code", "code", false], ["Zed", "zed", false], ["Neovim", "nvim", true]]);
	});

	test("the preset is found from the command, and anything else is no preset", () => {
		expect(presetOf({ command: " code ", terminal: false })?.id).toBe("vscode");
		expect(presetOf({ command: "nvim", terminal: true })?.id).toBe("neovim");
		expect(presetOf({ command: "nvim", terminal: false })).toBeNull();
		expect(presetOf({ command: "code --new-window", terminal: false })).toBeNull();
		expect(presetOf(null)).toBeNull();
	});
});

describe("other names of an executable", () => {
	test("zed is also looked for as zeditor, and nothing else has another name", () => {
		expect(otherExecutableNames("zed")).toEqual(["zeditor"]);
		for (const executable of ["code", "nvim", "zeditor", "Zed", "/usr/bin/zed", "", "constructor", "toString", "__proto__"]) expect(otherExecutableNames(executable)).toEqual([]);
	});

	test("a command with another name is said so in words, and one without is not", () => {
		expect(describeOtherExecutableNames("zed")).toContain('"zeditor" is tried');
		expect(describeOtherExecutableNames("code")).toBeNull();
	});
});

describe("reading, writing, and comparing the editor setting on its own", () => {
	test("null is no editor, a readable setting is itself, anything else is not one", () => {
		expect(readEditorSetting(null)).toBeNull();
		expect(readEditorSetting({ command: "code", terminal: false, extra: 1 })).toEqual({ command: "code", terminal: false });
		for (const value of [undefined, "code", { command: "code" }, { command: `code "x`, terminal: false }]) expect(readEditorSetting(value)).toBeUndefined();
	});

	test("writes only its own fields, and reads back what it wrote", () => {
		const setting = { command: "zed --new", terminal: false };
		expect(writeEditorSetting({ ...setting, extra: 1 } as typeof setting)).toEqual(setting);
		expect(readEditorSetting(writeEditorSetting(setting))).toEqual(setting);
		expect(writeEditorSetting(null)).toBeNull();
		expect(sameEditorSetting(null, null)).toBe(true);
		expect(sameEditorSetting(setting, null)).toBe(false);
	});
});

describe("the editor preference", () => {
	test("is not set by default", () => {
		expect(defaultPreferences().editor).toBeNull();
		expect(readPreferences({ sidebarSide: "right" })).toEqual({ sidebarSide: "right", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const }, dmabuf: "auto" as const, timber: { kind: "bundled" as const } });
	});

	test("is read when it is a readable command and a terminal flag", () => {
		expect(readPreferences({ editor: { command: "zed --new", terminal: false } }).editor).toEqual({ command: "zed --new", terminal: false });
	});

	test("falls back to not set when it cannot be read, and keeps the other preferences", () => {
		for (const editor of ["code", 3, [], {}, { command: "code" }, { command: 3, terminal: false }, { command: "code", terminal: "no" }, { command: "", terminal: false }, { command: `code "x`, terminal: false }]) {
			expect(readPreferences({ sidebarSide: "right", editor })).toEqual({ sidebarSide: "right", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const }, dmabuf: "auto" as const, timber: { kind: "bundled" as const } });
		}
	});

	test("a change sets it, clears it with null, leaves it alone when it does not name it, and reports it when it cannot be read", () => {
		const set = applyPreferenceChange(defaultPreferences(), { editor: { command: "code", terminal: false } });
		expect(set).toEqual({ preferences: { sidebarSide: "left", editor: { command: "code", terminal: false }, agents: AGENT_PRESETS, chops: [], useChops: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const }, dmabuf: "auto" as const, timber: { kind: "bundled" as const } }, unreadable: [] });
		expect(applyPreferenceChange(set.preferences, { sidebarSide: "right" })).toEqual({ preferences: { sidebarSide: "right", editor: { command: "code", terminal: false }, agents: AGENT_PRESETS, chops: [], useChops: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const }, dmabuf: "auto" as const, timber: { kind: "bundled" as const } }, unreadable: [] });
		expect(applyPreferenceChange(set.preferences, { editor: { command: "  ", terminal: false } })).toEqual({ preferences: set.preferences, unreadable: ["editor"] });
		expect(applyPreferenceChange(set.preferences, { editor: { command: `code "x`, terminal: false } })).toEqual({ preferences: set.preferences, unreadable: ["editor"] });
		expect(applyPreferenceChange(set.preferences, { editor: null })).toEqual({ preferences: { sidebarSide: "left", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const }, dmabuf: "auto" as const, timber: { kind: "bundled" as const } }, unreadable: [] });
	});

	test("counts in comparing preferences", () => {
		const one = { sidebarSide: "left" as const, editor: { command: "code", terminal: false }, agents: AGENT_PRESETS, chops: [], useChops: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const }, dmabuf: "auto" as const, timber: { kind: "bundled" as const } };
		expect(samePreferences(one, { ...one, editor: { command: "code", terminal: false } })).toBe(true);
		expect(samePreferences(one, { ...one, editor: { command: "code", terminal: true } })).toBe(false);
		expect(samePreferences(one, { ...one, editor: null })).toBe(false);
		expect(samePreferences(defaultPreferences(), defaultPreferences())).toBe(true);
	});

	test("is saved in the settings file and read back, set or not", () => {
		for (const editor of [null, { command: `"/opt/My Editor/edit" --folder={path}`, terminal: false }, { command: "nvim", terminal: true }]) {
			const settings = { repositories: [], preferences: { sidebarSide: "left" as const, editor, agents: AGENT_PRESETS, chops: [], useChops: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const }, dmabuf: "auto" as const, timber: { kind: "bundled" as const } } };
			expect(parseSettings(serializeSettings(settings))).toEqual(settings);
		}
	});

	test("an unreadable editor in the file costs neither the file nor the other preferences", () => {
		const text = JSON.stringify({ version: 1, repositories: [{ path: "/work/a", commonDir: "/work/a/.git" }], preferences: { sidebarSide: "right", editor: { command: 7 } } });
		expect(parseSettings(text)).toEqual({ repositories: [{ path: "/work/a", commonDir: "/work/a/.git" }], preferences: { sidebarSide: "right", editor: null, agents: AGENT_PRESETS, chops: [], useChops: true, fetch: defaultFetchSetting(), zoom: 1, theme: defaultThemeChoice(), customThemes: [], terminal: defaultTerminalAppearance(), sessionNames: "plain" as const, statusNotifications: true, notifyStates: ["needs-you", "done", "error", "crashed"] as const, soundStates: [] as const, sound: { kind: "bundled" as const, name: "chime" as const }, dmabuf: "auto" as const, timber: { kind: "bundled" as const } } });
	});
});
