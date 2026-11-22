import { CHOP_LIMIT, type ListedChop, sameChopName } from "./chops";
import { type SoundChoice, defaultSoundChoice, readSoundChoice, sameSoundChoice, writeSoundChoice } from "./sound-setting";
import { cleanSessionName } from "./terminal";

/**
 * The sounds of chops from `.timber/chops.json`. Pure, so the rules can be
 * tested without a window.
 *
 * A person's own chop keeps its sound with it (`PersonalChop.sound` in
 * ./chops.ts). A chop from the repository file cannot: the app never writes
 * that file. So its sound is kept in the app's settings (the
 * `fileChopSounds` preference), by the primary checkout of the repository
 * and the chop's name, ignoring case. Only chops with a sound are kept:
 * choosing None takes the entry away. A name not listed now, such as a chop
 * of a damaged file, keeps its sound while there is room, so the chop gets
 * it back when the file is read again.
 */

export interface FileChopSound {
	name: string;
	sound: SoundChoice;
}

/** The file chop sounds of each repository, by its primary checkout, oldest change first. */
export type FileChopSounds = Readonly<Record<string, readonly FileChopSound[]>>;

/** The most sounds kept for one repository: every chop of the file, and as many again for names not listed now. */
export const FILE_CHOP_SOUND_LIMIT = 2 * CHOP_LIMIT;
/** The most repositories with file chop sounds. A save drops the ones changed longest ago past this many. */
export const FILE_CHOP_SOUND_REPOSITORY_LIMIT = 200;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isName = (value: unknown): value is string => typeof value === "string" && cleanSessionName(value) === value;
const indexIn = (sounds: readonly FileChopSound[], name: string) => sounds.findIndex(entry => sameChopName(entry.name, name));

/** One repository's sounds, or undefined when any of it cannot be read: clean names, each once ignoring case, each with a sound, within the limit. */
function readRepositorySounds(value: unknown): FileChopSound[] | undefined {
	if (!Array.isArray(value) || value.length > FILE_CHOP_SOUND_LIMIT) return undefined;
	const sounds: FileChopSound[] = [];
	for (const entry of value) {
		if (!isRecord(entry) || !isName(entry.name) || indexIn(sounds, entry.name) !== -1) return undefined;
		const sound = readSoundChoice(entry.sound);
		if (sound === undefined) return undefined;
		sounds.push({ name: entry.name, sound });
	}
	return sounds;
}

/** The sounds from a save, or undefined when any of it cannot be read, so a save never keeps half of what was asked. An empty list is left out. */
export function readFileChopSounds(value: unknown): Record<string, FileChopSound[]> | undefined {
	if (!isRecord(value)) return undefined;
	const entries = Object.entries(value);
	if (entries.length > FILE_CHOP_SOUND_REPOSITORY_LIMIT) return undefined;
	const read: [string, FileChopSound[]][] = [];
	for (const [repository, entry] of entries) {
		const sounds = readRepositorySounds(entry);
		if (repository === "" || sounds === undefined) return undefined;
		if (sounds.length > 0) read.push([repository, sounds]);
	}
	// Built from entries, so a key such as `__proto__` is an entry like any other.
	return Object.fromEntries(read);
}

/**
 * What can be read of sounds in a settings file that `readFileChopSounds`
 * refused, such as after a hand edit: each entry with a clean name, once, up
 * to the limits. A sound that cannot be read plays the chime, since a sound
 * was asked for.
 */
export function salvageFileChopSounds(value: unknown): Record<string, FileChopSound[]> | undefined {
	if (!isRecord(value)) return undefined;
	const read: [string, FileChopSound[]][] = [];
	for (const [repository, entry] of Object.entries(value)) {
		if (read.length === FILE_CHOP_SOUND_REPOSITORY_LIMIT) break;
		if (repository === "" || !Array.isArray(entry)) continue;
		const sounds: FileChopSound[] = [];
		for (const item of entry) {
			if (sounds.length === FILE_CHOP_SOUND_LIMIT) break;
			if (!isRecord(item) || !isName(item.name) || indexIn(sounds, item.name) !== -1) continue;
			sounds.push({ name: item.name, sound: readSoundChoice(item.sound) ?? defaultSoundChoice() });
		}
		if (sounds.length > 0) read.push([repository, sounds]);
	}
	return Object.fromEntries(read);
}

export function writeFileChopSounds(sounds: FileChopSounds): Record<string, unknown[]> {
	return Object.fromEntries(Object.entries(sounds).map(([repository, list]) => [repository, list.map(entry => ({ name: entry.name, sound: writeSoundChoice(entry.sound) }))]));
}

export function sameFileChopSounds(one: FileChopSounds, other: FileChopSounds): boolean {
	const keys = Object.keys(one);
	if (keys.length !== Object.keys(other).length) return false;
	return keys.every(key => {
		const mine = one[key]!;
		const theirs = other[key];
		return theirs !== undefined && mine.length === theirs.length && mine.every((entry, index) => entry.name === theirs[index]!.name && sameSoundChoice(entry.sound, theirs[index]!.sound));
	});
}

/** The sound of a file chop of a repository, by name ignoring case, or null for none. */
export function fileChopSoundOf(sounds: FileChopSounds, repository: string, name: string): SoundChoice | null {
	const list = Object.hasOwn(sounds, repository) ? sounds[repository]! : [];
	return list[indexIn(list, name)]?.sound ?? null;
}

/**
 * The sounds with one file chop's sound set, or taken away with null. The
 * chop's entry goes last, and its repository goes last, so past the limits
 * the ones changed longest ago are dropped.
 */
export function withFileChopSound(sounds: FileChopSounds, repository: string, name: string, sound: SoundChoice | null): Record<string, FileChopSound[]> {
	const current = Object.hasOwn(sounds, repository) ? sounds[repository]! : [];
	const others = current.filter(entry => !sameChopName(entry.name, name));
	const list = sound === null ? others : [...others, { name, sound }].slice(-FILE_CHOP_SOUND_LIMIT);
	const rest: [string, FileChopSound[]][] = Object.entries(sounds).filter(([key]) => key !== repository).map(([key, entries]) => [key, [...entries]]);
	const kept: [string, FileChopSound[]][] = list.length === 0 ? rest : [...rest, [repository, list]];
	return Object.fromEntries(kept.slice(-FILE_CHOP_SOUND_REPOSITORY_LIMIT));
}

/** The sound to play when a chop starts: its own, unless "Play each chop's sound" is off. Null for none. */
export function chopSoundToPlay(chop: Pick<ListedChop, "sound">, playChopSounds: boolean): SoundChoice | null {
	return playChopSounds ? chop.sound : null;
}
