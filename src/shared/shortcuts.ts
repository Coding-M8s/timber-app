/**
 * The app's shortcuts, each of which a person can change in Settings,
 * Shortcuts. Everything here is pure.
 *
 * A shortcut is Ctrl+Shift and a letter, or Cmd+Shift and the letter on
 * macOS; either modifier counts, so the key needs no platform test (the
 * session chips' key keeps to the platform's own modifier, as the other
 * keys a terminal leaves to the app do). It is read by the character, and
 * only letters are allowed: with Shift a digit arrives as its symbol, and
 * Alt chords type characters on macOS and reach terminal programs as Meta
 * keys. A terminal program sees Ctrl+Shift and a letter as Ctrl and the
 * letter, so taking it leaves the program its own key.
 *
 * They are saved under `shortcuts` in the preferences, by id, only where
 * they differ from the default. The app's other keys (zoom, moving between
 * sessions, copy and paste, the text editor's, a focused row's) follow
 * the browser's and the terminal's ways and stay as they are.
 */

/** The shortcuts, by id, in the order Settings lists them. */
export const SHORTCUT_IDS = ["palette", "next-waiting", "session-chips", "files-panel", "changes-panel", "chops-panel", "run-chop"] as const;
export type ShortcutId = typeof SHORTCUT_IDS[number];

/** The shortcuts that are gone with "Use chops" off: Settings does not list them, and they take no key. */
export const CHOP_SHORTCUT_IDS: readonly ShortcutId[] = ["chops-panel", "run-chop"];

/** The keys set in Settings, by id, as a chord such as "Ctrl+Shift+K". Only the ones that differ from the default. */
export type ShortcutSettings = Partial<Record<ShortcutId, string>>;

/** A shortcut's letter, upper case, such as "K" for Ctrl+Shift+K. */
export type ShortcutLetter = string;

/** The letter each shortcut has until another is set. */
export const DEFAULT_SHORTCUTS: Readonly<Record<ShortcutId, ShortcutLetter>> = {
	palette: "P",
	"next-waiting": "J",
	"session-chips": "S",
	"files-panel": "E",
	"changes-panel": "G",
	"chops-panel": "K",
	"run-chop": "T",
};

/** Each shortcut's field label in Settings, Shortcuts. */
export const SHORTCUT_LABELS: Readonly<Record<ShortcutId, string>> = {
	palette: "Open the command palette",
	"next-waiting": "Show the next session that needs you",
	"session-chips": "Go to the session chips from a terminal",
	"files-panel": "Show or hide the files",
	"changes-panel": "Show or hide the changes",
	"chops-panel": "Show or hide the chops panel",
	"run-chop": "Search and run a chop",
};

/** What each shortcut does, as a clash names it. */
export const SHORTCUT_WORDS: Readonly<Record<ShortcutId, string>> = {
	palette: "opens the command palette",
	"next-waiting": "shows the next session that needs you or is done",
	"session-chips": "goes to the session chips",
	"files-panel": "shows or hides the files",
	"changes-panel": "shows or hides the changes",
	"chops-panel": "shows or hides the chops panel",
	"run-chop": "searches and runs a chop",
};

/**
 * The Ctrl+Shift letters that terminals and the text editor keep, with
 * what they do. No shortcut takes one: the window hears keys before the
 * editor and a terminal, so it would take it from them.
 */
export const RESERVED_SHORTCUTS: Readonly<Record<ShortcutLetter, string>> = {
	C: "copies in a terminal on Linux and Windows",
	V: "pastes in a terminal on Linux and Windows",
	Z: "redoes in the text editor",
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

/** How a refusal names things: Cmd on macOS, and whether the chop shortcuts are in use and so listed in Settings. */
export interface ShortcutContext {
	mac?: boolean;
	/** False while "Use chops" is off, so a clash with a chop shortcut says how to reach it. True when left out. */
	useChops?: boolean;
}

/**
 * Why a shortcut cannot take this letter, or null when it can: a terminal
 * or the text editor keeps it, or another shortcut has it now. A chop
 * shortcut keeps its key with chops off, so turning them on never leaves
 * two shortcuts on one key.
 */
export function shortcutProblem(id: ShortcutId, letter: ShortcutLetter, settings: ShortcutSettings, context: ShortcutContext = {}): string | null {
	const chord = describeChord(letter, context.mac ?? false);
	const kept = Object.hasOwn(RESERVED_SHORTCUTS, letter) ? RESERVED_SHORTCUTS[letter] : undefined;
	if (kept !== undefined) return `${chord} ${kept}, so it cannot be the key that ${SHORTCUT_WORDS[id]}.`;
	const other = SHORTCUT_IDS.find(candidate => candidate !== id && shortcutLetter(settings, candidate) === letter);
	if (other === undefined) return null;
	if (context.useChops === false && CHOP_SHORTCUT_IDS.includes(other)) {
		return `${chord} ${SHORTCUT_WORDS[other]} while Use chops is on. To use it here, turn on Use chops in Settings, Chops, and change that one first.`;
	}
	return `${chord} already ${SHORTCUT_WORDS[other]}. Change that one first.`;
}

/**
 * What a pressed key that cannot be a shortcut says, so the person knows
 * what to press: Ctrl and a letter belongs to the program in a terminal,
 * such as Ctrl+C, which stops it. Null for a key that is a shortcut's
 * chord, which `shortcutProblem` then checks.
 */
export function pressedKeyProblem(event: Keys, mac: boolean): string | null {
	if (chordLetterOf(event) !== null) return null;
	const modifier = mac ? "Cmd" : "Ctrl";
	const example = describeChord("T", mac);
	const plain = event.type === "keydown" && !event.altKey && !event.shiftKey && (mac ? event.metaKey : event.ctrlKey) && /^[a-z]$/i.test(event.key);
	if (plain && !mac) return `Ctrl+${event.key.toUpperCase()} belongs to the program in a terminal, as Ctrl+C stops it, so a shortcut is Ctrl+Shift and a letter, such as ${example}.`;
	if (plain) return `Cmd+${event.key.toUpperCase()} is kept for the system and the text editor, so a shortcut is Cmd+Shift and a letter, such as ${example}.`;
	return `Press ${modifier}+Shift and a letter, such as ${example}.`;
}

/** A shortcut's key as set, as this platform names it, such as "Ctrl+Shift+P". */
export function shortcutKeys(settings: ShortcutSettings, id: ShortcutId, mac: boolean): string {
	return describeChord(shortcutLetter(settings, id), mac);
}

/** Whether a key press is a shortcut's chord as set. */
export function isShortcut(event: Keys, settings: ShortcutSettings, id: ShortcutId): boolean {
	return matchesChord(event, shortcutLetter(settings, id));
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
 * when one cannot be read, takes a kept letter, or has another's. Ids the
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
