import { describe, expect, test } from "bun:test";
import { defaultKeymap, historyKeymap } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import type { KeyBinding } from "@codemirror/view";
import { editorKeys } from "../src/mainview/components/TextEditor";
import { isFilesPanelShortcut } from "../src/mainview/files-panel-format";
import { isChangesPanelShortcut } from "../src/mainview/changes-panel-format";
import { isPaletteShortcut } from "../src/mainview/palette";
import { clipboardKey, sessionKey } from "../src/mainview/terminal-format";
import { isWaitingShortcut } from "../src/mainview/waiting";
import { applyPreferenceChange, defaultPreferences, readPreferences, writePreferences } from "../src/shared/preferences";
import {
	DEFAULT_SHORTCUTS, RESERVED_SHORTCUTS, SHORTCUT_IDS, SHORTCUT_LABELS, SHORTCUT_WORDS, chordLetterOf, chordText, describeChord, isShortcut, matchesChord, pressedKeyProblem, readChord, readShortcuts,
	salvageShortcuts, sameShortcuts, shortcutKeys, shortcutLetter, shortcutProblem, withShortcut, writeShortcuts,
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

	test("each defaults to the key it always had", () => {
		expect(DEFAULT_SHORTCUTS).toEqual({ palette: "P", "next-waiting": "J", "session-chips": "S", "files-panel": "E", "changes-panel": "G", "chops-panel": "K", "run-chop": "T" });
		expect(SHORTCUT_IDS.every(id => SHORTCUT_LABELS[id] !== "" && SHORTCUT_WORDS[id] !== "")).toBe(true);
		expect(shortcutLetter({}, "run-chop")).toBe("T");
		expect(shortcutLetter({ "run-chop": "Ctrl+Shift+Y" }, "run-chop")).toBe("Y");
		// Something that cannot be read is the default.
		expect(shortcutLetter({ "run-chop": "nonsense" }, "run-chop")).toBe("T");
	});
});

describe("the keys a changeable shortcut cannot take", () => {
	test("the table holds only the terminal's copy and paste and the editor's keys; the app's own are shortcuts", () => {
		expect(Object.keys(RESERVED_SHORTCUTS).sort()).toEqual(["C", "U", "V", "Z"]);
		expect(clipboardKey(chord("C"), false)).toBe("copy");
		expect(clipboardKey(chord("V"), false)).toBe("paste");
		// Every Ctrl+Shift letter the app takes by default is a shortcut's default, or the terminal's copy and paste.
		const defaults = new Set(Object.values(DEFAULT_SHORTCUTS));
		for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
			const taken = isPaletteShortcut(chord(letter)) || isWaitingShortcut(chord(letter)) || isFilesPanelShortcut(chord(letter)) || isChangesPanelShortcut(chord(letter))
				|| sessionKey(chord(letter), false) !== null;
			if (taken) expect(defaults.has(letter)).toBe(true);
			if (clipboardKey(chord(letter), false) !== null) expect(Object.keys(RESERVED_SHORTCUTS)).toContain(letter);
		}
		// No default takes a kept key, and no two share one.
		expect(defaults.size).toBe(SHORTCUT_IDS.length);
		for (const id of SHORTCUT_IDS) expect(shortcutProblem(id, DEFAULT_SHORTCUTS[id], {})).toBeNull();
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
		// The window's own keys, as they are by default, are taken out of the editor's (`WINDOW_KEYS`).
		for (const letter of bound) expect(Object.keys(RESERVED_SHORTCUTS)).toContain(letter);
		expect([...bound].sort()).toEqual(["U", "Z"]);
	});

	test("a key a terminal or the editor keeps is refused with what it does", () => {
		expect(shortcutProblem("palette", "C", {})).toBe("Ctrl+Shift+C copies in a terminal on Linux and Windows, so it cannot be the key that opens the command palette.");
		expect(shortcutProblem("chops-panel", "V", {})).toBe("Ctrl+Shift+V pastes in a terminal on Linux and Windows, so it cannot be the key that shows or hides the chops panel.");
		expect(shortcutProblem("run-chop", "Z", {}, { mac: true })).toBe("Cmd+Shift+Z redoes in the text editor, so it cannot be the key that searches and runs a chop.");
		for (const letter of Object.keys(RESERVED_SHORTCUTS)) {
			for (const id of SHORTCUT_IDS) expect(shortcutProblem(id, letter, {})).not.toBeNull();
		}
	});

	test("another shortcut's key, as set, is refused with what it does", () => {
		expect(shortcutProblem("run-chop", "P", {})).toBe("Ctrl+Shift+P already opens the command palette. Change that one first.");
		expect(shortcutProblem("palette", "K", {})).toBe("Ctrl+Shift+K already shows or hides the chops panel. Change that one first.");
		expect(shortcutProblem("files-panel", "S", {})).toBe("Ctrl+Shift+S already goes to the session chips. Change that one first.");
		expect(shortcutProblem("chops-panel", "Y", { "run-chop": "Ctrl+Shift+Y" })).toBe("Ctrl+Shift+Y already searches and runs a chop. Change that one first.");
		// A default set aside is free for another.
		expect(shortcutProblem("files-panel", "P", { palette: "Ctrl+Shift+O" })).toBeNull();
		// A shortcut keeps its own key.
		expect(shortcutProblem("run-chop", "T", {})).toBeNull();
		expect(shortcutProblem("run-chop", "R", {})).toBeNull();
	});

	test("a chop shortcut keeps its key with chops off, and the refusal says how to reach it", () => {
		expect(shortcutProblem("palette", "K", {}, { useChops: false })).toBe("Ctrl+Shift+K shows or hides the chops panel while Use chops is on. To use it here, turn on Use chops in Settings, Chops, and change that one first.");
		expect(shortcutProblem("palette", "J", {}, { useChops: false })).toBe("Ctrl+Shift+J already shows the next session that needs you or is done. Change that one first.");
	});

	test("a pressed key that is not a chord says what to press, and Ctrl and a letter says a terminal has it", () => {
		expect(pressedKeyProblem(chord("K"), false)).toBeNull();
		expect(pressedKeyProblem(key("c", { ctrlKey: true }), false)).toBe("Ctrl+C belongs to the program in a terminal, as Ctrl+C stops it, so a shortcut is Ctrl+Shift and a letter, such as Ctrl+Shift+T.");
		expect(pressedKeyProblem(key("c", { metaKey: true }), true)).toBe("Cmd+C is kept for the system and the text editor, so a shortcut is Cmd+Shift and a letter, such as Cmd+Shift+T.");
		expect(pressedKeyProblem(key("F5"), false)).toBe("Press Ctrl+Shift and a letter, such as Ctrl+Shift+T.");
		expect(pressedKeyProblem(chord("!"), true)).toBe("Press Cmd+Shift and a letter, such as Cmd+Shift+T.");
	});

	test("each shortcut's key as set is named and matched", () => {
		const set = { palette: "Ctrl+Shift+O", "session-chips": "Ctrl+Shift+A" };
		expect(shortcutKeys(set, "palette", false)).toBe("Ctrl+Shift+O");
		expect(shortcutKeys(set, "palette", true)).toBe("Cmd+Shift+O");
		expect(shortcutKeys(set, "files-panel", false)).toBe("Ctrl+Shift+E");
		expect(isShortcut(chord("o"), set, "palette")).toBe(true);
		expect(isShortcut(chord("p"), set, "palette")).toBe(false);
		expect(isPaletteShortcut(chord("O"), "O")).toBe(true);
		expect(isWaitingShortcut(chord("X"), "X")).toBe(true);
		expect(isFilesPanelShortcut(chord("E"), "X")).toBe(false);
		expect(isChangesPanelShortcut(chord("X"), "X")).toBe(true);
		expect(sessionKey(chord("A"), false, "A")).toBe("chips");
		expect(sessionKey(chord("S"), false, "A")).toBeNull();
		expect(sessionKey(key("a", { metaKey: true, shiftKey: true }), true, "A")).toBe("chips");
		// The session keys that are not letters stay as they are.
		expect(sessionKey(key("PageDown", { ctrlKey: true }), false, "A")).toBe("next");
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
		// Every shortcut, moved round so each takes the last one's default.
		const moved = { palette: "Ctrl+Shift+T", "next-waiting": "Ctrl+Shift+P", "session-chips": "Ctrl+Shift+J", "files-panel": "Ctrl+Shift+S", "changes-panel": "Ctrl+Shift+E", "chops-panel": "Ctrl+Shift+G", "run-chop": "Ctrl+Shift+K" };
		expect(readShortcuts(moved)).toEqual(moved);
		expect(readShortcuts({ palette: "Ctrl+Shift+J" })).toBeUndefined();
		expect(readShortcuts({ "files-panel": "Ctrl+Shift+C" })).toBeUndefined();
		// Swapped keys are read whole.
		expect(readShortcuts({ "run-chop": "Ctrl+Shift+K", "chops-panel": "Ctrl+Shift+T" })).toEqual({ "run-chop": "Ctrl+Shift+K", "chops-panel": "Ctrl+Shift+T" });
		expect(readShortcuts({ "run-chop": "Ctrl+Shift+P" })).toBeUndefined();
		expect(readShortcuts({ "run-chop": "Ctrl+Shift+K" })).toBeUndefined();
		expect(readShortcuts({ "run-chop": "Alt+Shift+T" })).toBeUndefined();
		expect(readShortcuts(["Ctrl+Shift+T"])).toBeUndefined();
	});

	test("a save that clashes is refused, so the main process refuses it too", () => {
		const { preferences, unreadable } = applyPreferenceChange(defaultPreferences(), { shortcuts: { "palette": "Ctrl+Shift+V" } });
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
