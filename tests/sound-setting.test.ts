import { describe, expect, test } from "bun:test";
import {
	BUNDLED_SOUNDS,
	BUNDLED_SOUND_LABELS,
	MAX_SOUND_PATH_LENGTH,
	type SoundChoice,
	defaultSoundChoice,
	defaultStateSounds,
	isSoundPath,
	readStateSounds,
	sameStateSounds,
	writeStateSounds,
	readSoundChoice,
	sameSoundChoice,
	soundFileName,
	soundFileType,
	writeSoundChoice,
} from "../src/shared/sound-setting";

describe("sound setting", () => {
	test("the default is the chime, and every bundled sound has a label", () => {
		expect(defaultSoundChoice()).toEqual({ kind: "bundled", name: "chime" });
		for (const name of BUNDLED_SOUNDS) expect(BUNDLED_SOUND_LABELS[name].length).toBeGreaterThan(0);
	});

	test("each kind of choice survives writing and reading", () => {
		const choices: SoundChoice[] = [
			{ kind: "bundled", name: "knock" },
			{ kind: "system" },
			{ kind: "custom", path: "/home/me/Sounds/bell.ogg" },
		];
		for (const choice of choices) expect(readSoundChoice(writeSoundChoice(choice))).toEqual(choice);
	});

	test("anything else cannot be read", () => {
		for (const value of [null, "chime", [], {}, { kind: "bundled", name: "gong" }, { kind: "loud" }, { kind: "custom" }, { kind: "custom", path: 7 }]) {
			expect(readSoundChoice(value)).toBeUndefined();
		}
	});

	test("reading keeps only the fields of the kind", () => {
		expect(readSoundChoice({ kind: "system", path: "/x.wav", extra: 1 })).toEqual({ kind: "system" });
	});

	test("a custom path is a full POSIX path, Windows drive path, or Windows share", () => {
		for (const path of ["/a/b.wav", "C:\\Users\\me\\ding.WAV", "d:/sounds/ding.mp3", "\\\\server\\share\\ding.flac"]) {
			expect(isSoundPath(path)).toBe(true);
		}
		for (const path of ["ding.wav", "./ding.wav", "~/ding.wav", "C:ding.wav", "\\\\server", ""]) expect(isSoundPath(path)).toBe(false);
	});

	test("a custom path has no control characters", () => {
		for (const path of ["/a/b\u0000.wav", "/a/b\n.wav", "/a/\u001b[1mb.wav", "/a/b\u007f.wav"]) expect(isSoundPath(path)).toBe(false);
	});

	test("a custom path is within the length limit", () => {
		const fits = `/${"a".repeat(MAX_SOUND_PATH_LENGTH - 5)}.wav`;
		expect(fits.length).toBe(MAX_SOUND_PATH_LENGTH);
		expect(isSoundPath(fits)).toBe(true);
		expect(isSoundPath(`/${"a".repeat(MAX_SOUND_PATH_LENGTH)}.wav`)).toBe(false);
	});

	test("a custom path ends in a sound file type, in any case", () => {
		for (const type of ["wav", "OGG", "oga", "Flac", "mp3", "aiff", "AIF"]) expect(isSoundPath(`/s/ding.${type}`)).toBe(true);
		for (const path of ["/s/ding.exe", "/s/ding", "/s/.wav", "/s.wav/ding", "/s/ding.wav.sh"]) expect(isSoundPath(path)).toBe(false);
		expect(readSoundChoice({ kind: "custom", path: "/s/run.sh" })).toBeUndefined();
	});

	test("the file name and type come from the last part of the path", () => {
		expect(soundFileName("/home/me/Sounds/bell.ogg")).toBe("bell.ogg");
		expect(soundFileName("C:\\Users\\me\\ding.WAV")).toBe("ding.WAV");
		expect(soundFileType("C:\\Users\\me\\ding.WAV")).toBe("wav");
		expect(soundFileType("/a.b/ding")).toBe("");
	});

	test("same choice compares kind and its field", () => {
		expect(sameSoundChoice({ kind: "bundled", name: "ping" }, { kind: "bundled", name: "ping" })).toBe(true);
		expect(sameSoundChoice({ kind: "bundled", name: "ping" }, { kind: "bundled", name: "chime" })).toBe(false);
		expect(sameSoundChoice({ kind: "system" }, { kind: "system" })).toBe(true);
		expect(sameSoundChoice({ kind: "system" }, { kind: "custom", path: "/a.wav" })).toBe(false);
		expect(sameSoundChoice({ kind: "custom", path: "/a.wav" }, { kind: "custom", path: "/a.wav" })).toBe(true);
		expect(sameSoundChoice({ kind: "custom", path: "/a.wav" }, { kind: "custom", path: "/b.wav" })).toBe(false);
	});
});

describe("a sound for each state", () => {
	const bell: SoundChoice = { kind: "custom", path: "/home/me/bell.ogg" };

	test("every state is named, each with a sound or none, and round-trips", () => {
		const sounds = { "needs-you": { kind: "bundled", name: "ping" }, done: bell, error: null, crashed: { kind: "system" } } as const;
		expect(readStateSounds(writeStateSounds(sounds))).toEqual(sounds);
		expect(writeStateSounds(defaultStateSounds())).toEqual({ "needs-you": null, done: null, error: null, crashed: null });
		expect(readStateSounds({ ...defaultStateSounds(), later: bell })).toEqual(defaultStateSounds());
	});

	test("a state left out, or a sound that cannot be read, refuses the whole", () => {
		const { crashed: _left, ...three } = defaultStateSounds();
		expect(readStateSounds(three)).toBeUndefined();
		expect(readStateSounds({ ...defaultStateSounds(), done: { kind: "custom", path: "/home/me/run.sh" } })).toBeUndefined();
		expect(readStateSounds({ ...defaultStateSounds(), done: "chime" })).toBeUndefined();
		for (const value of [null, [], "chime", 1]) expect(readStateSounds(value)).toBeUndefined();
	});

	test("compares each state's sound", () => {
		expect(sameStateSounds(defaultStateSounds(), defaultStateSounds())).toBe(true);
		expect(sameStateSounds({ ...defaultStateSounds(), done: bell }, { ...defaultStateSounds(), done: { ...bell } })).toBe(true);
		expect(sameStateSounds({ ...defaultStateSounds(), done: bell }, defaultStateSounds())).toBe(false);
		expect(sameStateSounds({ ...defaultStateSounds(), done: bell }, { ...defaultStateSounds(), error: bell })).toBe(false);
	});
});
