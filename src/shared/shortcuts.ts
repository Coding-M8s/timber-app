/**
 * The shortcuts a person can change in Settings: for now the two chop
 * shortcuts, which show or hide the chops panel and search and run a chop.
 * Everything here is pure.
 *
 * A changeable shortcut is Ctrl+Shift and a letter, or Cmd+Shift and the
 * letter on macOS; either modifier counts, as for the app's fixed
 * shortcuts, so the key needs no platform test. It is read by the
 * character, and only letters are allowed: with Shift a digit arrives as
 * its symbol, and Alt chords type characters on macOS and reach terminal
 * programs as Meta keys. A terminal program sees Ctrl+Shift and a letter
 * as Ctrl and the letter, so taking it leaves the program its own key.
 *
 * They are saved under `shortcuts` in the preferences, by id, only where
 * they differ from the default, so a later list of every app shortcut can
 * keep the same values.
 */

/** The shortcuts Settings can change, by id. */
export const SHORTCUT_IDS = ["chops-panel", "run-chop"] as const;
export type ShortcutId = typeof SHORTCUT_IDS[number];

/** The keys set in Settings, by id, as a chord such as "Ctrl+Shift+K". Only the ones that differ from the default. */
export type ShortcutSettings = Partial<Record<ShortcutId, string>>;

/** A changeable shortcut's letter, upper case, such as "K" for Ctrl+Shift+K. */
export type ShortcutLetter = string;

/** The letter each shortcut has until another is set. */
export const DEFAULT_SHORTCUTS: Readonly<Record<ShortcutId, ShortcutLetter>> = {
	"chops-panel": "K",
	"run-chop": "T",
};

/** What each shortcut does, as Settings and a clash name it. */
export const SHORTCUT_WORDS: Readonly<Record<ShortcutId, string>> = {
	"chops-panel": "shows or hides the chops panel",
	"run-chop": "searches and runs a chop",
};

/**
 * The Ctrl+Shift letters the app or its text editor keep, with what they
 * do. A changeable shortcut never takes one: the window hears keys before
 * the editor and a terminal, so it would take it from them.
 */
export const RESERVED_SHORTCUTS: Readonly<Record<ShortcutLetter, string>> = {
	P: "opens the command palette",
	J: "shows the next session that needs you",
	S: "goes to the session chips",
	E: "shows or hides the files",
	C: "copies in a terminal",
	V: "pastes in a terminal",
	Z: "redoes in the text editor",
	G: "finds the previous match in the text editor",
	U: "redoes a selection in the text editor on macOS",
};

/** A chord as it is saved and shown off macOS, such as "Ctrl+Shift+K". */
export function chordText(letter: ShortcutLetter): string {
	return `Ctrl+Shift+${letter}`;
}

/** A chord as this platform's keyboard names it: Cmd+Shift on macOS, Ctrl+Shift elsewhere. */
export function describeChord(letter: ShortcutLetter, mac: boolean): string {
	return `${mac ? "Cmd" : "Ctrl"}+Shift+${letter}`;
}

/** The letter of a saved chord, or null when it is not Ctrl+Shift and one letter. */
export function readChord(value: unknown): ShortcutLetter | null {
	if (typeof value !== "string") return null;
	const found = /^Ctrl\+Shift\+([A-Za-z])$/.exec(value.trim());
	return found ? found[1]!.toUpperCase() : null;
}

type Keys = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "shiftKey" | "metaKey" | "altKey">;

/** The letter of a key press that is Ctrl+Shift or Cmd+Shift and a letter, without Alt, or null for any other. */
export function chordLetterOf(event: Keys): ShortcutLetter | null {
	if (event.type !== "keydown" || event.altKey || !event.shiftKey || !(event.ctrlKey || event.metaKey)) return null;
	return /^[a-z]$/i.test(event.key) ? event.key.toUpperCase() : null;
}

/** Whether a key press is the chord with this letter. */
export function matchesChord(event: Keys, letter: ShortcutLetter): boolean {
	return chordLetterOf(event) === letter;
}

/** The letter a shortcut has now: the one set, or its default. */
export function shortcutLetter(settings: ShortcutSettings, id: ShortcutId): ShortcutLetter {
	return readChord(settings[id]) ?? DEFAULT_SHORTCUTS[id];
}

/**
 * Why a shortcut cannot take this letter, or null when it can: the app or
 * its editor keeps it, or the other changeable shortcut has it now.
 */
export function shortcutProblem(id: ShortcutId, letter: ShortcutLetter, settings: ShortcutSettings): string | null {
	const chord = chordText(letter);
	const kept = Object.hasOwn(RESERVED_SHORTCUTS, letter) ? RESERVED_SHORTCUTS[letter] : undefined;
	if (kept !== undefined) return `${chord} ${kept}, so it cannot be the key that ${SHORTCUT_WORDS[id]}.`;
	const other = SHORTCUT_IDS.find(candidate => candidate !== id && shortcutLetter(settings, candidate) === letter);
	if (other !== undefined) return `${chord} already ${SHORTCUT_WORDS[other]}. Change that one first.`;
	return null;
}

/** The settings with one shortcut set to a letter; its default is saved as nothing. */
export function withShortcut(settings: ShortcutSettings, id: ShortcutId, letter: ShortcutLetter): ShortcutSettings {
	const next: ShortcutSettings = { ...settings };
	if (letter === DEFAULT_SHORTCUTS[id]) delete next[id];
	else next[id] = chordText(letter);
	return next;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether no two shortcuts have the same letter and none takes a kept one. */
function usable(settings: ShortcutSettings): boolean {
	return SHORTCUT_IDS.every(id => shortcutProblem(id, shortcutLetter(settings, id), settings) === null);
}

/**
 * The shortcuts from outside, such as a save from Settings, or undefined
 * when one cannot be read, takes a kept letter, or has the other's. Ids the
 * app does not know are left out; a default is kept as nothing.
 */
export function readShortcuts(value: unknown): ShortcutSettings | undefined {
	if (!isRecord(value)) return undefined;
	let read: ShortcutSettings = {};
	for (const id of SHORTCUT_IDS) {
		if (value[id] === undefined) continue;
		const letter = readChord(value[id]);
		if (letter === null) return undefined;
		read = withShortcut(read, id, letter);
	}
	return usable(read) ? read : undefined;
}

/** What to keep of saved shortcuts `readShortcuts` refused: each that can be read and clashes with nothing kept before it. */
export function salvageShortcuts(value: unknown): ShortcutSettings | undefined {
	if (!isRecord(value)) return undefined;
	let kept: ShortcutSettings = {};
	for (const id of SHORTCUT_IDS) {
		const letter = readChord(value[id]);
		if (letter === null) continue;
		const next = withShortcut(kept, id, letter);
		if (usable(next)) kept = next;
	}
	return kept;
}

export function sameShortcuts(one: ShortcutSettings, other: ShortcutSettings): boolean {
	return SHORTCUT_IDS.every(id => shortcutLetter(one, id) === shortcutLetter(other, id));
}

export function writeShortcuts(settings: ShortcutSettings): Record<string, string> {
	const written: Record<string, string> = {};
	for (const id of SHORTCUT_IDS) if (settings[id] !== undefined) written[id] = settings[id]!;
	return written;
}
