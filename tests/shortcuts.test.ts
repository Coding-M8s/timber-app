import { describe, expect, test } from "bun:test";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import type { KeyBinding } from "@codemirror/view";
import { editorKeys } from "../src/mainview/components/TextEditor";
import { isFilesPanelShortcut } from "../src/mainview/files-panel-format";
import { isPaletteShortcut } from "../src/mainview/palette";
import { clipboardKey, sessionKey } from "../src/mainview/terminal-format";
import { isWaitingShortcut } from "../src/mainview/waiting";
import { applyPreferenceChange, defaultPreferences, readPreferences, writePreferences } from "../src/shared/preferences";
import {
	DEFAULT_SHORTCUTS, RESERVED_SHORTCUTS, SHORTCUT_IDS, chordLetterOf, chordText, describeChord, matchesChord, readChord, readShortcuts, salvageShortcuts, sameShortcuts, shortcutLetter,
	shortcutProblem, withShortcut, writeShortcuts,
} from "../src/shared/shortcuts";

const key = (key: string, modifiers: Partial<Record<"ctrlKey" | "shiftKey" | "metaKey" | "altKey", boolean>> = {}) =>
	({ type: "keydown", key, ctrlKey: false, shiftKey: false, metaKey: false, altKey: false, ...modifiers });
const chord = (letter: string) => key(letter, { ctrlKey: true, shiftKey: true });

describe("a changeable shortcut's chord", () => {
	test("is Ctrl+Shift or Cmd+Shift and a letter, read by the character", () => {
		expect(chordLetterOf(chord("t"))).toBe("T");
		expect(chordLetterOf(key("T", { metaKey: true, shiftKey: true }))).toBe("T");
		expect(matchesChord(chord("K"), "K")).toBe(true);
		expect(matchesChord(chord("K"), "T")).toBe(false);
	});

	test("is not a letter alone, Ctrl and a letter, an Alt chord, a digit, another key, or a key let go", () => {
		expect(chordLetterOf(key("t", { shiftKey: true }))).toBeNull();
		expect(chordLetterOf(key("t", { ctrlKey: true }))).toBeNull();
		expect(chordLetterOf(key("T", { ctrlKey: true, shiftKey: true, altKey: true }))).toBeNull();
		// Option+Shift+T on macOS arrives as the character it types.
		expect(chordLetterOf(key("ˇ", { altKey: true, shiftKey: true }))).toBeNull();
		// With Shift, a digit arrives as its symbol.
		expect(chordLetterOf(chord("!"))).toBeNull();
		expect(chordLetterOf(chord("F5"))).toBeNull();
		expect(chordLetterOf({ ...chord("T"), type: "keyup" })).toBeNull();
	});

	test("is saved as Ctrl+Shift and the letter, and named as this platform names it", () => {
		expect(chordText("T")).toBe("Ctrl+Shift+T");
		expect(describeChord("T", false)).toBe("Ctrl+Shift+T");
		expect(describeChord("T", true)).toBe("Cmd+Shift+T");
		expect(readChord("Ctrl+Shift+t")).toBe("T");
		expect(readChord("Alt+Shift+T")).toBeNull();
		expect(readChord("Ctrl+Shift+1")).toBeNull();
		expect(readChord("Ctrl+Shift+TT")).toBeNull();
		expect(readChord(3)).toBeNull();
	});

	test("defaults to Ctrl+Shift+K for the panel and Ctrl+Shift+T to search and run a chop", () => {
		expect(DEFAULT_SHORTCUTS).toEqual({ "chops-panel": "K", "run-chop": "T" });
		expect(shortcutLetter({}, "run-chop")).toBe("T");
		expect(shortcutLetter({ "run-chop": "Ctrl+Shift+Y" }, "run-chop")).toBe("Y");
		// Something that cannot be read is the default.
		expect(shortcutLetter({ "run-chop": "nonsense" }, "run-chop")).toBe("T");
	});
});

describe("the keys a changeable shortcut cannot take", () => {
	test("each app key in the table is one the app's own key handler takes", () => {
		const takenByApp = (letter: string) =>
			isPaletteShortcut(chord(letter)) || isWaitingShortcut(chord(letter)) || isFilesPanelShortcut(chord(letter))
			|| sessionKey(chord(letter), false) !== null || clipboardKey(chord(letter), false) !== null;
		const editorOnly = new Set(["Z", "G", "U"]);
		for (const letter of Object.keys(RESERVED_SHORTCUTS)) {
			if (!editorOnly.has(letter)) expect(takenByApp(letter)).toBe(true);
		}
		// And every Ctrl+Shift letter the app takes is in the table.
		for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
			if (letter === DEFAULT_SHORTCUTS["chops-panel"]) continue;
			if (takenByApp(letter)) expect(Object.keys(RESERVED_SHORTCUTS)).toContain(letter);
		}
	});

	test("every Shift and Mod letter the text editor binds is in the table", () => {
		const bound = new Set<string>();
		// On macOS the chord is Cmd+Shift, so the editor's Emacs-style Ctrl keys there are not its.
		const note = (spec: string | undefined, shifted: boolean, mac: boolean) => {
			if (spec === undefined) return;
			const parts = spec.split("-");
			const letter = parts.at(-1)!;
			const shift = shifted || parts.includes("Shift");
			const mod = parts.includes("Mod") || parts.includes(mac ? "Cmd" : "Ctrl");
			if (shift && mod && !parts.includes("Alt") && /^[a-z]$/i.test(letter)) bound.add(letter.toUpperCase());
		};
		const bindings: readonly KeyBinding[] = [...editorKeys(defaultKeymap), ...editorKeys(historyKeymap), ...editorKeys(searchKeymap)];
		for (const binding of bindings) {
			for (const spec of [binding.key, binding.mac, binding.linux, binding.win]) {
				const mac = spec === binding.mac;
				note(spec, false, mac);
				if (binding.shift) note(spec, true, mac);
			}
		}
		// The window's own keys are taken out of the editor's (`WINDOW_KEYS`).
		bound.delete("K");
		bound.delete("P");
		bound.delete("J");
		for (const letter of bound) expect(Object.keys(RESERVED_SHORTCUTS)).toContain(letter);
		expect([...bound].sort()).toEqual(["G", "U", "Z"]);
	});

	test("a key the app keeps is refused with what it does", () => {
		expect(shortcutProblem("run-chop", "P", {})).toBe("Ctrl+Shift+P opens the command palette, so it cannot be the key that searches and runs a chop.");
		expect(shortcutProblem("chops-panel", "C", {})).toBe("Ctrl+Shift+C copies in a terminal, so it cannot be the key that shows or hides the chops panel.");
		expect(shortcutProblem("run-chop", "Z", {})).toBe("Ctrl+Shift+Z redoes in the text editor, so it cannot be the key that searches and runs a chop.");
		for (const letter of Object.keys(RESERVED_SHORTCUTS)) {
			for (const id of SHORTCUT_IDS) expect(shortcutProblem(id, letter, {})).not.toBeNull();
		}
	});

	test("the other chop shortcut's key is refused with what it does", () => {
		expect(shortcutProblem("run-chop", "K", {})).toBe("Ctrl+Shift+K already shows or hides the chops panel. Change that one first.");
		expect(shortcutProblem("chops-panel", "Y", { "run-chop": "Ctrl+Shift+Y" })).toBe("Ctrl+Shift+Y already searches and runs a chop. Change that one first.");
		// A shortcut keeps its own key.
		expect(shortcutProblem("run-chop", "T", {})).toBeNull();
		expect(shortcutProblem("run-chop", "R", {})).toBeNull();
	});
});

describe("the shortcuts as a preference", () => {
	test("only a key that differs from the default is saved", () => {
		expect(withShortcut({}, "run-chop", "R")).toEqual({ "run-chop": "Ctrl+Shift+R" });
		expect(withShortcut({ "run-chop": "Ctrl+Shift+R" }, "run-chop", "T")).toEqual({});
		expect(writeShortcuts({ "chops-panel": "Ctrl+Shift+L" })).toEqual({ "chops-panel": "Ctrl+Shift+L" });
		expect(sameShortcuts({}, { "run-chop": "Ctrl+Shift+T" })).toBe(true);
		expect(sameShortcuts({}, { "run-chop": "Ctrl+Shift+R" })).toBe(false);
	});

	test("are read when each is a chord, none takes a kept key, and no two share one", () => {
		expect(readShortcuts({})).toEqual({});
		expect(readShortcuts({ "run-chop": "Ctrl+Shift+R", other: "Ctrl+Shift+Q" })).toEqual({ "run-chop": "Ctrl+Shift+R" });
		// Swapped keys are read whole.
		expect(readShortcuts({ "run-chop": "Ctrl+Shift+K", "chops-panel": "Ctrl+Shift+T" })).toEqual({ "run-chop": "Ctrl+Shift+K", "chops-panel": "Ctrl+Shift+T" });
		expect(readShortcuts({ "run-chop": "Ctrl+Shift+P" })).toBeUndefined();
		expect(readShortcuts({ "run-chop": "Ctrl+Shift+K" })).toBeUndefined();
		expect(readShortcuts({ "run-chop": "Alt+Shift+T" })).toBeUndefined();
		expect(readShortcuts(["Ctrl+Shift+T"])).toBeUndefined();
	});

	test("a save that clashes is refused, so the main process refuses it too", () => {
		const { preferences, unreadable } = applyPreferenceChange(defaultPreferences(), { shortcuts: { "run-chop": "Ctrl+Shift+P" } });
		expect(unreadable).toEqual(["shortcuts"]);
		expect(preferences.shortcuts).toEqual({});
		expect(applyPreferenceChange(defaultPreferences(), { shortcuts: { "run-chop": "Ctrl+Shift+R" } }).preferences.shortcuts).toEqual({ "run-chop": "Ctrl+Shift+R" });
	});

	test("a settings file edited by hand keeps each key it can, and the rest take their defaults", () => {
		expect(salvageShortcuts({ "chops-panel": "Ctrl+Shift+L", "run-chop": "Ctrl+Shift+L" })).toEqual({ "chops-panel": "Ctrl+Shift+L" });
		expect(readPreferences({ shortcuts: { "chops-panel": "Ctrl+Shift+P", "run-chop": "Ctrl+Shift+R" } }).shortcuts).toEqual({ "run-chop": "Ctrl+Shift+R" });
		expect(readPreferences({ shortcuts: "Ctrl+Shift+T" }).shortcuts).toEqual({});
		expect(readPreferences(writePreferences({ ...defaultPreferences(), shortcuts: { "run-chop": "Ctrl+Shift+Y" } })).shortcuts).toEqual({ "run-chop": "Ctrl+Shift+Y" });
	});
});
