import { mkdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, win32 } from "node:path";
import { type BundledSound, type ChooseSoundResult, type SoundChoice, type SoundOutcome, isSoundPath, soundFileName, soundFileType } from "../shared/sound-setting";
import { toneWav } from "../shared/tones";

export type { SoundOutcome };

/** What a started player looks like to this module. Tests pass their own. */
export interface SoundProcess {
	/** Its exit code once it ended, or null when a signal ended it. */
	exited: Promise<number | null>;
	kill(): void;
}

export interface SoundPlayerDependencies {
	/** The PATH the app was started with. */
	path: string;
	/** Where the sounds that come with the app are written as WAV files, on first use. */
	cacheFolder: string;
	platform?: NodeJS.Platform;
	/** Start a player with these arguments, never through a shell, with `environment` added to the app's own. */
	spawn?: (argv: string[], environment?: Record<string, string>) => SoundProcess;
	/** Whether there is a regular file at this path. */
	isRegularFile?: (path: string) => boolean;
	/** Write a file, making its folder when needed. */
	writeFile?: (path: string, bytes: Uint8Array) => void;
	/** Windows only: the Windows folder, as %SystemRoot% names it. */
	systemRoot?: string;
	/** The clock. Tests pass their own. */
	now?: () => number;
	setTimer?: (run: () => void, milliseconds: number) => unknown;
	clearTimer?: (timer: unknown) => void;
}

export interface PlayOptions {
	/**
	 * When the custom sound file is gone, play the chime instead of returning
	 * "missing". For automatic alerts; a preview leaves it off so the person
	 * learns the file is gone.
	 */
	fallBackToChime?: boolean;
}

export interface SoundPlayer {
	play(choice: SoundChoice, options?: PlayOptions): Promise<SoundOutcome>;
	/** Stop the sound playing now, and play no more, for quitting. */
	stopAll(): void;
}

/** A sound still playing after this long is stopped, so a long custom file cannot hold up every later sound. */
export const MAX_SOUND_MILLISECONDS = 4000;

/** A player that fails within this long never played the sound. One that ends badly later did play some of it. */
const FAST_FAILURE_MILLISECONDS = 1500;

/** The environment variable that hands the file to PowerShell, so the path is never part of the script's text. */
export const WINDOWS_SOUND_VARIABLE = "TIMBER_SOUND_FILE";

/** The fixed PowerShell script for Windows. It reads the file from WINDOWS_SOUND_VARIABLE. SoundPlayer plays WAV only. */
export const WINDOWS_SOUND_SCRIPT = `$ErrorActionPreference = 'Stop'; (New-Object System.Media.SoundPlayer $env:${WINDOWS_SOUND_VARIABLE}).PlaySync()`;

/** A player for one file: its arguments, and what to add to its environment. */
export interface PlayerCommand {
	argv: string[];
	environment?: Record<string, string>;
}

/**
 * The command that plays `file`, using the first player found on
 * `searchPath`, or null when none can play its type.
 *
 * Linux (tested): `pw-play`, then `paplay`, then `aplay`, which plays WAV
 * only. Each takes `--` before the file. macOS (written, not tested):
 * `afplay`; the file is always a full path, so it cannot be read as an
 * option. Windows (tested): Windows PowerShell's
 * System.Media.SoundPlayer, WAV only, with the file in an environment
 * variable.
 */
export function playerCommand(platform: NodeJS.Platform, searchPath: string, file: string): PlayerCommand | null {
	return playerCommands(platform, searchPath, file)[0] ?? null;
}

/**
 * Every player found that can play `file`, best first. On Linux a player
 * that fails at once, such as `pw-play` on a system whose sound server is
 * PulseAudio, gives way to the next.
 */
export function playerCommands(platform: NodeJS.Platform, searchPath: string, file: string): PlayerCommand[] {
	const type = soundFileType(file);
	const which = (name: string) => Bun.which(name, { PATH: searchPath });
	if (platform === "linux") {
		const commands: PlayerCommand[] = [];
		for (const name of ["pw-play", "paplay", "aplay"]) {
			if (name === "aplay" && type !== "wav") continue;
			const executable = which(name);
			if (executable === null) continue;
			commands.push({ argv: name === "aplay" ? [executable, "-q", "--", file] : [executable, "--", file] });
		}
		return commands;
	}
	const one = otherPlayer(platform, which, file, type);
	return one === null ? [] : [one];
}

function otherPlayer(platform: NodeJS.Platform, which: (name: string) => string | null, file: string, type: string): PlayerCommand | null {
	if (platform === "darwin") {
		const executable = which("afplay");
		return executable === null ? null : { argv: [executable, file] };
	}
	if (platform === "win32") {
		if (type !== "wav") return null;
		const executable = which("powershell.exe");
		if (executable === null) return null;
		return {
			argv: [executable, "-NoProfile", "-NonInteractive", "-Command", WINDOWS_SOUND_SCRIPT],
			environment: { [WINDOWS_SOUND_VARIABLE]: file },
		};
	}
	return null;
}

/**
 * Where the system's notification sound may be, best first. Linux (tested):
 * the freedesktop sound theme. Windows (tested): `Windows Notify.wav` in
 * the Windows folder. macOS: written, not tested.
 */
export function systemSoundFiles(platform: NodeJS.Platform, systemRoot: string): string[] {
	if (platform === "linux") {
		return ["/usr/share/sounds/freedesktop/stereo/message-new-instant.oga", "/usr/share/sounds/freedesktop/stereo/complete.oga"];
	}
	if (platform === "darwin") return ["/System/Library/Sounds/Glass.aiff"];
	if (platform === "win32") return [win32.join(systemRoot, "Media", "Windows Notify.wav")];
	return [];
}

function spawnSound(argv: string[], environment?: Record<string, string>): SoundProcess {
	const child = Bun.spawn(argv, {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
		...(environment === undefined ? {} : { env: { ...process.env, ...environment } }),
	});
	return { exited: child.exited.then(() => child.exitCode), kill: () => child.kill() };
}

function isRegularFileOnDisk(path: string): boolean {
	try {
		return statSync(path).isFile();
	} catch {
		return false;
	}
}

function writeFileOnDisk(path: string, bytes: Uint8Array): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, bytes);
}

/**
 * Plays alert sounds from the main process, so they play while the window is
 * hidden. One at a time: a sound asked for while another plays is skipped,
 * and "another" lasts across every player tried for it.
 * Players run as an executable plus arguments, never through a shell.
 */
export function createSoundPlayer(dependencies: SoundPlayerDependencies): SoundPlayer {
	const {
		path: searchPath,
		cacheFolder,
		platform = process.platform,
		spawn = spawnSound,
		isRegularFile = isRegularFileOnDisk,
		writeFile = writeFileOnDisk,
		systemRoot = process.env.SystemRoot ?? "C:\\Windows",
		now = Date.now,
		setTimer = (run, milliseconds) => setTimeout(run, milliseconds),
		clearTimer = timer => clearTimeout(timer as ReturnType<typeof setTimeout>),
	} = dependencies;
	/** The sounds written to the cache folder by this run of the app. Written again on a new run, in case the app's sounds changed. */
	const written = new Set<BundledSound>();
	let playing: SoundProcess | null = null;
	/** True from the moment a play is asked for until it ends, across every player it tries. */
	let busy = false;
	let stopped = false;

	/** The file of a bundled sound, written on first use. Null when it cannot be written. */
	function bundledFile(name: BundledSound): string | null {
		const file = join(cacheFolder, `${name}.wav`);
		// Written again when it went missing while the app ran, such as when the cache was cleared.
		if (!written.has(name) || !isRegularFile(file)) {
			try {
				writeFile(file, toneWav(name));
			} catch {
				return null;
			}
			written.add(name);
		}
		return file;
	}

	/** The file to play, or the outcome when there is none. */
	function resolveFile(choice: SoundChoice, options: PlayOptions): string | SoundOutcome {
		let file: string | null;
		if (choice.kind === "bundled") file = bundledFile(choice.name);
		else if (choice.kind === "system") {
			file = systemSoundFiles(platform, systemRoot).find(candidate => isRegularFile(candidate)) ?? bundledFile("chime");
		} else if (isSoundPath(choice.path) && isRegularFile(choice.path)) file = choice.path;
		else if (options.fallBackToChime === true) file = bundledFile("chime");
		else return { outcome: "missing" };
		return file ?? { outcome: "failed" };
	}

	/** Play with one player. "failed" only when it failed at once, so the next player may be tried. */
	function playWith(command: PlayerCommand): Promise<SoundOutcome> {
		let child: SoundProcess;
		try {
			child = spawn(command.argv, command.environment);
		} catch {
			return Promise.resolve({ outcome: "failed" });
		}
		playing = child;
		const startedAt = now();
		let cut = false;
		const timer = setTimer(() => {
			cut = true;
			child.kill();
		}, MAX_SOUND_MILLISECONDS);
		const finish = (exitCode: number | null): SoundOutcome => {
			clearTimer(timer);
			if (playing === child) playing = null;
			// One stopped for running too long, or for quitting, did play.
			if (cut || stopped || exitCode === 0) return { outcome: "played" };
			// Only a quick failure means nothing was heard.
			return now() - startedAt < FAST_FAILURE_MILLISECONDS ? { outcome: "failed" } : { outcome: "played" };
		};
		return child.exited.then(finish, () => finish(-1));
	}

	return {
		async play(choice, options = {}) {
			if (stopped || busy) return { outcome: "busy" };
			busy = true;
			try {
				return await playChoice(choice, options);
			} finally {
				busy = false;
			}
		},
		stopAll() {
			stopped = true;
			playing?.kill();
		},
	};

	/** Play a choice with the first player that works. */
	async function playChoice(choice: SoundChoice, options: PlayOptions): Promise<SoundOutcome> {
		const resolved = resolveFile(choice, options);
		if (typeof resolved !== "string") return resolved;
		let file = resolved;
		let commands = playerCommands(platform, searchPath, file);
		// The system's sound or a missing own file falls back to the chime, which every player reads, when nothing can play it.
		if (commands.length === 0 && (choice.kind === "system" || options.fallBackToChime === true)) {
			const chime = bundledFile("chime");
			if (chime !== null && chime !== file) {
				file = chime;
				commands = playerCommands(platform, searchPath, file);
			}
		}
		if (commands.length === 0) return { outcome: "no-player" };
		let outcome: SoundOutcome = { outcome: "failed" };
		for (const command of commands) {
			outcome = await playWith(command);
			if (outcome.outcome !== "failed" || stopped) break;
		}
		return outcome;
	}
}

/**
 * Ask the person for a sound file of their own, for Settings. The path comes
 * back only when the preference would accept it and it is a regular file;
 * nothing is saved here. The path is never logged.
 */
export async function chooseSoundFile(pickFile: () => Promise<string | null>, isRegularFile: (path: string) => boolean = isRegularFileOnDisk): Promise<ChooseSoundResult> {
	const path = await pickFile();
	if (path === null) return { outcome: "cancelled" };
	if (!isSoundPath(path)) return { outcome: "refused", message: `The app cannot play ${soundFileName(path)}. Choose a WAV, Ogg, FLAC, MP3, or AIFF file.` };
	if (!isRegularFile(path)) return { outcome: "refused", message: `${soundFileName(path)} is not a file the app can read.` };
	return { outcome: "chosen", path };
}
