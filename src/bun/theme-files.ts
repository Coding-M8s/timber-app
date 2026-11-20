/**
 * Exporting and importing themes as files (see docs/architecture.md,
 * "Themes"). The person picks the folder or the file in the system's dialog;
 * reading and writing the text is ./theme-file.ts in src/shared.
 */
import { existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readTheme } from "../shared/theme";
import { type ExportThemeResult, type ImportThemeResult, MAX_THEME_FILE_BYTES, readThemeFile, themeFileName, themeFileText } from "../shared/theme-file";
import { messageOf } from "../shared/error-message";

export interface ThemeFileOptions {
	/** The system's folder picker. Null when it was closed without a choice. */
	pickFolder(): Promise<string | null>;
	/** The system's file picker, for one file. Null when it was closed without a choice. */
	pickFile(): Promise<string | null>;
}

export interface ThemeFiles {
	exportTheme(theme: unknown): Promise<ExportThemeResult>;
	importTheme(): Promise<ImportThemeResult>;
}

export function createThemeFiles({ pickFolder, pickFile }: ThemeFileOptions): ThemeFiles {
	return {
		async exportTheme(value) {
			// What the interface sent is checked like anything else that comes from outside.
			const { theme, replaced } = readTheme(value);
			if (replaced.length > 0) return { outcome: "failed", message: `The theme could not be read, so nothing was written: ${replaced.slice(0, 4).join(", ")}.` };
			const folder = await pickFolder();
			if (folder === null) return { outcome: "cancelled" };
			const path = join(folder, themeFileName(theme.name, name => existsSync(join(folder, name))));
			try {
				// "wx" refuses a file that appeared since the name was chosen, so nothing is ever written over.
				await writeFile(path, themeFileText(theme), { encoding: "utf8", flag: "wx" });
			} catch (error) {
				return { outcome: "failed", message: `Could not write ${path}: ${messageOf(error)}` };
			}
			return { outcome: "exported", path };
		},

		async importTheme() {
			const file = await pickFile();
			if (file === null) return { outcome: "cancelled" };
			let text: string;
			try {
				const info = await stat(file);
				if (!info.isFile()) return { outcome: "refused", file, reason: "It is not a file." };
				if (info.size > MAX_THEME_FILE_BYTES) return { outcome: "refused", file, reason: `The file is larger than ${MAX_THEME_FILE_BYTES / 1024} KB, so it is not a theme file.` };
				text = await readFile(file, "utf8");
			} catch (error) {
				return { outcome: "refused", file, reason: `Could not read it: ${messageOf(error)}` };
			}
			const read = readThemeFile(text);
			return read.outcome === "read" ? { outcome: "imported", file, theme: read.theme } : { outcome: "refused", file, reason: read.reason };
		},
	};
}
