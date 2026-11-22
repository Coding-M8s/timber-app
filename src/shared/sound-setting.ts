/**
 * Which sound plays for an alert: one that comes with the app, the system's
 * own notification sound, or a file the person picked. Pure. The main
 * process plays it (see src/bun/sounds.ts).
 */
import { ALERT_STATES, type AlertState } from "./status-notices";

export const BUNDLED_SOUNDS = ["chime", "ping", "knock"] as const;
export type BundledSound = (typeof BUNDLED_SOUNDS)[number];

/** Names to show for the sounds that come with the app. */
export const BUNDLED_SOUND_LABELS: Record<BundledSound, string> = {
	chime: "Chime",
	ping: "Ping",
	knock: "Knock",
};

export type SoundChoice =
	| { kind: "bundled"; name: BundledSound }
	/** The system's notification sound, or the chime where there is none. */
	| { kind: "system" }
	/** A sound file the person picked, by its full path. */
	| { kind: "custom"; path: string };

/** The file types a custom sound may be, without the dot, in lower case. */
export const SOUND_FILE_TYPES = ["wav", "ogg", "oga", "flac", "mp3", "aiff", "aif"] as const;

/** The longest custom sound path that can be saved. */
export const MAX_SOUND_PATH_LENGTH = 1024;

export function defaultSoundChoice(): SoundChoice {
	return { kind: "bundled", name: "chime" };
}

export function isBundledSound(value: unknown): value is BundledSound {
	return typeof value === "string" && (BUNDLED_SOUNDS as readonly string[]).includes(value);
}

/** The extension of a path's last part, without the dot, in lower case, or "" when it has none. */
export function soundFileType(path: string): string {
	const name = soundFileName(path);
	const dot = name.lastIndexOf(".");
	return dot <= 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/** Whether `path` names a full path: POSIX (`/...`), a Windows drive (`C:\...` or `C:/...`), or a Windows share (`\\server\share...`). */
function isFullPath(path: string): boolean {
	return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || /^\\\\[^\\]+\\[^\\]+/.test(path);
}

/**
 * Whether `path` may be saved as a custom sound. It came from the window, so
 * it must be a full path within the length limit, with no control
 * characters, ending in one of SOUND_FILE_TYPES. Whether the file exists is
 * checked when it plays.
 */
export function isSoundPath(path: unknown): path is string {
	if (typeof path !== "string" || path.length === 0 || path.length > MAX_SOUND_PATH_LENGTH) return false;
	// NUL and the other control characters have no place in a file name someone picked.
	if (/[\u0000-\u001f\u007f]/.test(path)) return false;
	if (!isFullPath(path)) return false;
	return (SOUND_FILE_TYPES as readonly string[]).includes(soundFileType(path));
}

/** The choice from a value that came from outside, or undefined when it cannot be read. */
export function readSoundChoice(value: unknown): SoundChoice | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const { kind, name, path } = value as Record<string, unknown>;
	if (kind === "bundled") return isBundledSound(name) ? { kind, name } : undefined;
	if (kind === "system") return { kind };
	if (kind === "custom") return isSoundPath(path) ? { kind, path } : undefined;
	return undefined;
}

export function sameSoundChoice(one: SoundChoice, other: SoundChoice): boolean {
	if (one.kind === "bundled") return other.kind === "bundled" && one.name === other.name;
	if (one.kind === "custom") return other.kind === "custom" && one.path === other.path;
	return other.kind === "system";
}

export function writeSoundChoice(choice: SoundChoice): unknown {
	if (choice.kind === "bundled") return { kind: choice.kind, name: choice.name };
	if (choice.kind === "custom") return { kind: choice.kind, path: choice.path };
	return { kind: choice.kind };
}

/** Just the file's name, to show instead of its full path. */
export function soundFileName(path: string): string {
	const parts = path.split(/[\\/]/);
	return parts[parts.length - 1] ?? path;
}

/**
 * How a play ended. "busy": another sound was still playing, so this one did
 * not. "no-player": no program that can play this file type was found.
 * "missing": the custom sound file is not there. "failed": the player could
 * not play it.
 */
export type SoundOutcome =
	| { outcome: "played" }
	| { outcome: "busy" }
	| { outcome: "no-player" }
	| { outcome: "missing" }
	| { outcome: "failed" };

/** What choosing a sound file in Settings came to. The path is only ever one `readSoundChoice` accepts. */
export type ChooseSoundResult =
	| { outcome: "chosen"; path: string }
	| { outcome: "cancelled" }
	| { outcome: "refused"; message: string };

/**
 * The sound each status plays, or null for none. Every status is named, so a
 * save from the window that names only some cannot silence the rest.
 */
export type StateSounds = Readonly<Record<AlertState, SoundChoice | null>>;

/** No sound for any status, so the app is quiet until asked. */
export function defaultStateSounds(): StateSounds {
	return { "needs-you": null, "done": null, "error": null, "crashed": null };
}

/**
 * The sounds from a value that came from outside, or undefined when it cannot
 * be read: every status must be there, each null or a choice `readSoundChoice`
 * accepts. Names the app does not know are left out.
 */
export function readStateSounds(value: unknown): StateSounds | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const sounds: Record<AlertState, SoundChoice | null> = { ...defaultStateSounds() };
	for (const state of ALERT_STATES) {
		if (!Object.hasOwn(record, state)) return undefined;
		const entry = record[state];
		if (entry === null) continue;
		const choice = readSoundChoice(entry);
		if (choice === undefined) return undefined;
		sounds[state] = choice;
	}
	return sounds;
}

/**
 * What to keep of saved sounds that `readStateSounds` refuses, such as after a
 * hand edit: a status that is missing or null plays nothing, and one whose
 * sound cannot be read plays the chime, since a sound was asked for.
 */
export function salvageStateSounds(value: unknown): StateSounds | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const record = value as Record<string, unknown>;
	const sounds: Record<AlertState, SoundChoice | null> = { ...defaultStateSounds() };
	for (const state of ALERT_STATES) {
		const entry = record[state];
		if (entry === undefined || entry === null) continue;
		sounds[state] = readSoundChoice(entry) ?? defaultSoundChoice();
	}
	return sounds;
}

/**
 * The sounds from the settings of an app from before each status had its own:
 * `soundStates` named the statuses that played, and `sound` the one sound they
 * all played. A list that cannot be read played nothing, and a sound that
 * cannot be read was the chime, as they were read then. Undefined when neither
 * is there.
 */
export function legacyStateSounds(saved: Record<string, unknown>): StateSounds | undefined {
	const { soundStates, sound } = saved;
	if (soundStates === undefined && sound === undefined) return undefined;
	const sounds: Record<AlertState, SoundChoice | null> = { ...defaultStateSounds() };
	if (!Array.isArray(soundStates) || !soundStates.every(state => (ALERT_STATES as readonly unknown[]).includes(state))) return sounds;
	const choice = readSoundChoice(sound) ?? defaultSoundChoice();
	for (const state of ALERT_STATES) if (soundStates.includes(state)) sounds[state] = choice;
	return sounds;
}

export function sameStateSounds(one: StateSounds, other: StateSounds): boolean {
	return ALERT_STATES.every(state => {
		const left = one[state];
		const right = other[state];
		return left === null || right === null ? left === right : sameSoundChoice(left, right);
	});
}

export function writeStateSounds(sounds: StateSounds): unknown {
	const written: Record<string, unknown> = {};
	for (const state of ALERT_STATES) {
		const choice = sounds[state];
		written[state] = choice === null ? null : writeSoundChoice(choice);
	}
	return written;
}
