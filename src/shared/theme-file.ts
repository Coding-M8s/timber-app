/**
 * A theme as a file, for sharing: written by Export and read by Import.
 * Reading is strict and pure: a file that is not a whole theme is refused
 * with a reason, and nothing is made of it. See docs/architecture.md, "Themes".
 */
import { slugOf } from "./custom-themes";
import { type Theme, readTheme, writeTheme } from "./theme";
import { messageOf } from "./error-message";

export const THEME_FILE_FORMAT = "timber-theme";
export const THEME_FILE_VERSION = 1;
export const THEME_FILE_EXTENSION = ".timber-theme.json";
/** A theme file is a few kilobytes. Anything this large is something else. */
export const MAX_THEME_FILE_BYTES = 64 * 1024;

/** A theme as a file holds it: everything but the id, which belongs to the app that keeps it. */
export type SharedTheme = Omit<Theme, "id">;

export type ExportThemeResult =
	| { outcome: "exported"; path: string }
	| { outcome: "cancelled" }
	| { outcome: "failed"; message: string };

export type ImportThemeResult =
	| { outcome: "imported"; file: string; theme: SharedTheme }
	| { outcome: "cancelled" }
	| { outcome: "refused"; file: string; reason: string };

/** The text of a theme file. */
export function themeFileText(theme: Theme): string {
	const { id: _id, ...shared } = writeTheme(theme);
	return `${JSON.stringify({ format: THEME_FILE_FORMAT, version: THEME_FILE_VERSION, ...shared }, null, "\t")}\n`;
}

/** A file name for a theme, such as `nord-copy.timber-theme.json`, or with "-2" and up when `taken` says it is. */
export function themeFileName(name: string, taken: (fileName: string) => boolean): string {
	const base = slugOf(name) || "theme";
	for (let number = 1; ; number++) {
		const fileName = `${number === 1 ? base : `${base}-${number}`}${THEME_FILE_EXTENSION}`;
		if (!taken(fileName)) return fileName;
	}
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Up to `shown` names, and how many more there are. */
function listOf(names: readonly string[], shown = 4): string {
	if (names.length <= shown) return names.join(", ");
	return `${names.slice(0, shown).join(", ")}, and ${names.length - shown} more`;
}

/** The theme in a file's text, or why it is refused. Never fails. */
export function readThemeFile(text: string): { outcome: "read"; theme: SharedTheme } | { outcome: "refused"; reason: string } {
	if (new TextEncoder().encode(text).length > MAX_THEME_FILE_BYTES) {
		return { outcome: "refused", reason: `The file is larger than ${MAX_THEME_FILE_BYTES / 1024} KB, so it is not a theme file.` };
	}
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch (error) {
		return { outcome: "refused", reason: `The file is not JSON: ${messageOf(error)}` };
	}
	if (!isRecord(value) || value.format !== THEME_FILE_FORMAT) {
		return { outcome: "refused", reason: `The file is not a Timber theme: it does not say "format": "${THEME_FILE_FORMAT}".` };
	}
	if (value.version !== THEME_FILE_VERSION) {
		const later = typeof value.version === "number" && value.version > THEME_FILE_VERSION;
		return { outcome: "refused", reason: later ? `The file is a theme for a later version of the app (version ${value.version}).` : "The file does not say which version of the theme format it is." };
	}
	// The id is the app's own, so a file's is never used.
	const { theme, replaced } = readTheme({ ...value, id: "imported" });
	const problems: string[] = [];
	if (replaced.includes("name")) problems.push(`It has no name, or a name longer than 80 characters.`);
	if (replaced.includes("appearance")) problems.push(`It does not say whether it is "dark" or "light".`);
	const colors = replaced.filter(part => part.includes("."));
	if (colors.length > 0) problems.push(`These colors are missing or are not colors: ${listOf(colors)}.`);
	if (problems.length > 0) return { outcome: "refused", reason: problems.join(" ") };
	const { id: _id, ...shared } = theme;
	return { outcome: "read", theme: shared };
}
