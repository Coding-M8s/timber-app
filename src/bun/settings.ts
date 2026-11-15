import { randomUUID } from "node:crypto";
import { copyFile, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, posix, win32 } from "node:path";
import { type Settings, emptySettings, parseSettings, serializeSettings } from "../shared/settings";

type Environment = Record<string, string | undefined>;

/** The folder inside the per-user configuration directory, and the file in it. */
const SETTINGS_FOLDER = "timber-app";
const SETTINGS_FILE = "settings.json";

/**
 * Where the settings file lives: the per-user configuration directory of the
 * platform. That is %APPDATA% on Windows, ~/Library/Application Support on
 * macOS, and $XDG_CONFIG_HOME or ~/.config elsewhere.
 */
export function settingsFilePath(
	environment: Environment = process.env,
	platform: string = process.platform,
	home: string = homedir(),
): string {
	if (platform === "win32") {
		const roaming = environment.APPDATA || win32.join(home, "AppData", "Roaming");
		return win32.join(roaming, SETTINGS_FOLDER, SETTINGS_FILE);
	}
	if (platform === "darwin") {
		return posix.join(home, "Library", "Application Support", SETTINGS_FOLDER, SETTINGS_FILE);
	}
	// The XDG specification says to ignore a relative value.
	const configured = environment.XDG_CONFIG_HOME;
	const base = configured && posix.isAbsolute(configured) ? configured : posix.join(home, ".config");
	return posix.join(base, SETTINGS_FOLDER, SETTINGS_FILE);
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Read the settings file. This never fails, so a missing, unreadable, or
 * damaged file cannot stop the app from starting: the app then begins with
 * empty settings. A damaged file is first copied to `<file>.damaged`, so the
 * next save does not destroy what a person may want to repair.
 */
export async function readSettings(file: string, warn: (message: string) => void = console.warn): Promise<Settings> {
	let text: string;
	try {
		text = await readFile(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") warn(`Could not read settings at ${file}: ${messageOf(error)}`);
		return emptySettings();
	}
	const settings = parseSettings(text);
	if (settings) return settings;

	const kept = `${file}.damaged`;
	try {
		await copyFile(file, kept);
		warn(`The settings file at ${file} is damaged. Starting with empty settings. A copy was kept at ${kept}.`);
	} catch (error) {
		warn(`The settings file at ${file} is damaged, and it could not be copied to ${kept}: ${messageOf(error)}. Starting with empty settings.`);
	}
	return emptySettings();
}

/**
 * Write the settings file atomically: the text goes to a temporary file in the
 * same folder, is flushed to disk, and is then renamed over the real one. A
 * crash at any point leaves either the old file or the new one, never a part.
 */
export async function writeSettings(file: string, settings: Settings): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
	try {
		const handle = await open(temporary, "wx");
		try {
			await handle.writeFile(serializeSettings(settings), "utf8");
			await handle.sync();
		} finally {
			await handle.close();
		}
		await rename(temporary, file);
	} catch (error) {
		await rm(temporary, { force: true });
		throw error;
	}
}
