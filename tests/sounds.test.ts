import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";
import {
	MAX_SOUND_MILLISECONDS,
	type SoundPlayerDependencies,
	type SoundProcess,
	WINDOWS_SOUND_SCRIPT,
	WINDOWS_SOUND_VARIABLE,
	chooseSoundFile,
	createSoundPlayer,
	playerCommand,
	systemSoundFiles,
} from "../src/bun/sounds";

/**
 * The file name of a pretend player. Bun.which finds a file on Windows only
 * by an extension in PATHEXT, so there the pretend players end in .exe, as
 * real players would.
 */
function stub(name: string): string {
	return process.platform === "win32" && !name.endsWith(".exe") ? `${name}.exe` : name;
}

/** The pretend cache folder, in this system's path form, as the player joins file names to it. */
const cache = join("/cache", "sounds");

/** A pretend player the test ends by hand. */
function pretend() {
	const started: { argv: string[]; environment: Record<string, string> | undefined; end: (exitCode: number | null) => void; killed: boolean }[] = [];
	const spawn = (argv: string[], environment?: Record<string, string>): SoundProcess => {
		let end: (exitCode: number | null) => void = () => {};
		const exited = new Promise<number | null>(resolve => {
			end = resolve;
		});
		const entry = { argv, environment, end, killed: false };
		started.push(entry);
		return { exited, kill: () => {
			entry.killed = true;
			end(null);
		} };
	};
	return { started, spawn };
}

/** Timers the test runs by hand. */
function pretendTimers() {
	const timers = new Map<number, () => void>();
	let next = 0;
	return {
		timers,
		setTimer: (run: () => void) => {
			next += 1;
			timers.set(next, run);
			return next;
		},
		clearTimer: (timer: unknown) => {
			timers.delete(timer as number);
		},
		runAll: () => {
			for (const [id, run] of [...timers]) {
				timers.delete(id);
				run();
			}
		},
	};
}

describe("sounds", () => {
	let root: string;
	/** Folders holding pretend players, by which players they hold. */
	const bins: Record<string, string> = {};

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "timber-app-sounds-"));
		const sets: Record<string, string[]> = {
			all: ["pw-play", "paplay", "aplay"],
			paplay: ["paplay", "aplay"],
			aplay: ["aplay"],
			mac: ["afplay"],
			windows: ["powershell.exe"],
		};
		for (const [name, players] of Object.entries(sets)) {
			const bin = join(root, name);
			mkdirSync(bin);
			for (const player of players) {
				writeFileSync(join(bin, stub(player)), "#!/bin/sh\nexit 0\n");
				chmodSync(join(bin, stub(player)), 0o755);
			}
			bins[name] = bin;
		}
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	/** A player on Linux with every pretend player, a pretend file system, and pretend timers. */
	function setUp(overrides: Partial<SoundPlayerDependencies> & { files?: string[] } = {}) {
		const { started, spawn } = pretend();
		const timers = pretendTimers();
		const files = new Set(overrides.files ?? []);
		const writes: string[] = [];
		let clock = 0;
		const player = createSoundPlayer({
			path: bins.all!,
			cacheFolder: cache,
			platform: "linux",
			spawn,
			isRegularFile: path => files.has(path),
			writeFile: (path, bytes) => {
				expect(bytes.length).toBeGreaterThan(44);
				writes.push(path);
				files.add(path);
			},
			now: () => clock,
			setTimer: timers.setTimer,
			clearTimer: timers.clearTimer,
			...overrides,
		});
		return { player, started, timers, writes, files, advance: (milliseconds: number) => (clock += milliseconds) };
	}

	test("on Linux the first player found is used, with -- before the file", () => {
		expect(playerCommand("linux", bins.all!, "/s/a.ogg")).toEqual({ argv: [join(bins.all!, stub("pw-play")), "--", "/s/a.ogg"] });
		expect(playerCommand("linux", bins.paplay!, "/s/a.ogg")).toEqual({ argv: [join(bins.paplay!, stub("paplay")), "--", "/s/a.ogg"] });
		expect(playerCommand("linux", `/nowhere${delimiter}${bins.aplay!}`, "/s/a.wav")).toEqual({ argv: [join(bins.aplay!, stub("aplay")), "-q", "--", "/s/a.wav"] });
	});

	test("aplay plays WAV only", () => {
		expect(playerCommand("linux", bins.aplay!, "/s/a.ogg")).toBeNull();
		expect(playerCommand("linux", bins.aplay!, "/s/a.WAV")).not.toBeNull();
		expect(playerCommand("linux", "/nowhere", "/s/a.wav")).toBeNull();
	});

	test("macOS uses afplay", () => {
		expect(playerCommand("darwin", bins.mac!, "/s/a.aiff")).toEqual({ argv: [join(bins.mac!, stub("afplay")), "/s/a.aiff"] });
		expect(playerCommand("darwin", bins.all!, "/s/a.aiff")).toBeNull();
	});

	test("Windows uses a fixed PowerShell script that reads the file from the environment, WAV only", () => {
		const path = "C:\\Users\\me\\it's $(evil).wav";
		const command = playerCommand("win32", bins.windows!, path);
		expect(command).toEqual({
			argv: [join(bins.windows!, stub("powershell.exe")), "-NoProfile", "-NonInteractive", "-Command", WINDOWS_SOUND_SCRIPT],
			environment: { [WINDOWS_SOUND_VARIABLE]: path },
		});
		expect(WINDOWS_SOUND_SCRIPT).not.toContain("evil");
		expect(playerCommand("win32", bins.windows!, "C:\\s\\a.mp3")).toBeNull();
	});

	test("system sounds are looked for where each system keeps them", () => {
		expect(systemSoundFiles("linux", "")[0]).toBe("/usr/share/sounds/freedesktop/stereo/message-new-instant.oga");
		expect(systemSoundFiles("darwin", "")).toEqual(["/System/Library/Sounds/Glass.aiff"]);
		expect(systemSoundFiles("win32", "C:\\Windows")).toEqual(["C:\\Windows\\Media\\Windows Notify.wav"]);
		expect(systemSoundFiles("freebsd", "")).toEqual([]);
	});

	test("a bundled sound is written to the cache once, then played", async () => {
		const { player, started, writes } = setUp();
		const first = player.play({ kind: "bundled", name: "ping" });
		expect(started[0]!.argv).toEqual([join(bins.all!, stub("pw-play")), "--", join(cache, "ping.wav")]);
		started[0]!.end(0);
		expect(await first).toEqual({ outcome: "played" });
		const second = player.play({ kind: "bundled", name: "ping" });
		started[1]!.end(0);
		expect(await second).toEqual({ outcome: "played" });
		expect(writes).toEqual([join(cache, "ping.wav")]);
	});

	test("nothing is written before the first play", () => {
		const { writes } = setUp();
		expect(writes).toEqual([]);
	});

	test("a bundled sound that cannot be written fails", async () => {
		const { player, started } = setUp({ writeFile: () => {
			throw new Error("read-only");
		} });
		expect(await player.play({ kind: "bundled", name: "chime" })).toEqual({ outcome: "failed" });
		expect(started).toEqual([]);
	});

	test("the system sound is the first one there, else the chime", async () => {
		const complete = "/usr/share/sounds/freedesktop/stereo/complete.oga";
		const found = setUp({ files: [complete] });
		void found.player.play({ kind: "system" });
		expect(found.started[0]!.argv.at(-1)).toBe(complete);

		const none = setUp();
		void none.player.play({ kind: "system" });
		expect(none.started[0]!.argv.at(-1)).toBe(join(cache, "chime.wav"));
		expect(none.writes).toEqual([join(cache, "chime.wav")]);
	});

	test("a custom file plays when it is there", async () => {
		const { player, started } = setUp({ files: ["/home/me/bell.ogg"] });
		void player.play({ kind: "custom", path: "/home/me/bell.ogg" });
		expect(started[0]!.argv).toEqual([join(bins.all!, stub("pw-play")), "--", "/home/me/bell.ogg"]);
	});

	test("a custom file that is gone is missing, or the chime for automatic alerts", async () => {
		const { player, started } = setUp();
		expect(await player.play({ kind: "custom", path: "/home/me/bell.ogg" })).toEqual({ outcome: "missing" });
		expect(started).toEqual([]);
		void player.play({ kind: "custom", path: "/home/me/bell.ogg" }, { fallBackToChime: true });
		expect(started[0]!.argv.at(-1)).toBe(join(cache, "chime.wav"));
	});

	test("a custom path that could not have been saved is missing, even if a file is there", async () => {
		const { player, started } = setUp({ files: ["relative.wav", "/home/me/run.sh"] });
		expect(await player.play({ kind: "custom", path: "relative.wav" })).toEqual({ outcome: "missing" });
		expect(await player.play({ kind: "custom", path: "/home/me/run.sh" })).toEqual({ outcome: "missing" });
		expect(started).toEqual([]);
	});

	test("an OGG with only aplay has no player", async () => {
		const { player, started } = setUp({ path: bins.aplay!, files: ["/home/me/bell.ogg"] });
		expect(await player.play({ kind: "custom", path: "/home/me/bell.ogg" })).toEqual({ outcome: "no-player" });
		expect(started).toEqual([]);
	});

	test("one sound at a time: another while one plays is busy", async () => {
		const { player, started } = setUp();
		const first = player.play({ kind: "bundled", name: "chime" });
		expect(await player.play({ kind: "bundled", name: "knock" })).toEqual({ outcome: "busy" });
		expect(started).toHaveLength(1);
		started[0]!.end(0);
		await first;
		void player.play({ kind: "bundled", name: "knock" });
		expect(started).toHaveLength(2);
	});

	test("a sound still playing after the limit is stopped, and the next one plays", async () => {
		const { player, started, timers, advance } = setUp({ files: ["/home/me/long.flac"] });
		const long = player.play({ kind: "custom", path: "/home/me/long.flac" });
		expect(MAX_SOUND_MILLISECONDS).toBe(4000);
		advance(MAX_SOUND_MILLISECONDS);
		timers.runAll();
		expect(started[0]!.killed).toBe(true);
		expect(await long).toEqual({ outcome: "played" });
		void player.play({ kind: "bundled", name: "ping" });
		expect(started).toHaveLength(2);
	});

	test("a sound that ends in time clears its limit", async () => {
		const { player, started, timers } = setUp();
		const played = player.play({ kind: "bundled", name: "ping" });
		expect(timers.timers.size).toBe(1);
		started[0]!.end(0);
		await played;
		expect(timers.timers.size).toBe(0);
	});

	test("a player that fails at once failed; one that fails later did play", async () => {
		const { player, started, advance } = setUp();
		const quick = player.play({ kind: "bundled", name: "ping" });
		// Each player found fails at once in turn: pw-play, paplay, then aplay for a WAV.
		for (let index = 0; index < 3; index += 1) {
			await Bun.sleep(0);
			started[index]!.end(1);
		}
		expect(await quick).toEqual({ outcome: "failed" });
		expect(started.map(entry => basename(entry.argv[0]!))).toEqual(["pw-play", "paplay", "aplay"].map(stub));
		const late = player.play({ kind: "bundled", name: "ping" });
		advance(3000);
		started[3]!.end(1);
		expect(await late).toEqual({ outcome: "played" });
	});

	test("a player that fails at once gives way to the next, and a second sound waits for neither", async () => {
		const { player, started } = setUp();
		const first = player.play({ kind: "bundled", name: "ping" });
		started[0]!.end(1);
		await Bun.sleep(0);
		expect(started).toHaveLength(2);
		expect(await player.play({ kind: "bundled", name: "chime" })).toEqual({ outcome: "busy" });
		started[1]!.end(0);
		expect(await first).toEqual({ outcome: "played" });
	});

	test("the system sound plays the chime when no player found reads its file", async () => {
		const { player, started } = setUp({ path: bins.aplay!, files: ["/usr/share/sounds/freedesktop/stereo/message-new-instant.oga"] });
		const playing = player.play({ kind: "system" });
		expect(started[0]!.argv.at(-1)).toBe(join(cache, "chime.wav"));
		started[0]!.end(0);
		expect(await playing).toEqual({ outcome: "played" });
	});

	test("a sound of the app's that went missing from the cache is written again", async () => {
		const { player, started, writes, files } = setUp();
		const once = player.play({ kind: "bundled", name: "ping" });
		started[0]!.end(0);
		await once;
		files.delete(join(cache, "ping.wav"));
		const again = player.play({ kind: "bundled", name: "ping" });
		started[1]!.end(0);
		await again;
		expect(writes).toEqual([join(cache, "ping.wav"), join(cache, "ping.wav")]);
	});

	test("a player that cannot start failed", async () => {
		const { player } = setUp({ spawn: () => {
			throw new Error("no such file");
		} });
		expect(await player.play({ kind: "bundled", name: "ping" })).toEqual({ outcome: "failed" });
	});

	test("stopping all stops the sound playing and plays no more", async () => {
		const { player, started } = setUp();
		const playing = player.play({ kind: "bundled", name: "chime" });
		player.stopAll();
		expect(started[0]!.killed).toBe(true);
		expect(await playing).toEqual({ outcome: "played" });
		expect(await player.play({ kind: "bundled", name: "ping" })).toEqual({ outcome: "busy" });
		expect(started).toHaveLength(1);
	});

	test("Windows passes the file in the environment", async () => {
		const { player, started } = setUp({ platform: "win32", path: bins.windows!, systemRoot: "C:\\Windows", files: ["C:\\Windows\\Media\\Windows Notify.wav"] });
		void player.play({ kind: "system" });
		expect(started[0]!.argv.at(-1)).toBe(WINDOWS_SOUND_SCRIPT);
		expect(started[0]!.environment).toEqual({ [WINDOWS_SOUND_VARIABLE]: "C:\\Windows\\Media\\Windows Notify.wav" });
	});
});

describe("choosing a sound file", () => {
	test("only a path the preference accepts, that is a regular file", async () => {
		const pick = (path: string | null) => async () => path;
		expect(await chooseSoundFile(pick(null), () => true)).toEqual({ outcome: "cancelled" });
		expect(await chooseSoundFile(pick("/home/me/bell.ogg"), () => true)).toEqual({ outcome: "chosen", path: "/home/me/bell.ogg" });
		expect(await chooseSoundFile(pick("/home/me/notes.txt"), () => true)).toEqual({ outcome: "refused", message: "The app cannot play notes.txt. Choose a WAV, Ogg, FLAC, MP3, or AIFF file." });
		expect(await chooseSoundFile(pick("/home/me/folder.wav"), () => false)).toEqual({ outcome: "refused", message: "folder.wav is not a file the app can read." });
	});
});
