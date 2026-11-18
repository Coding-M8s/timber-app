/**
 * Exporting and importing themes as the mock acts them out. In a browser,
 * Export downloads the file and Import opens the browser's file picker. Tests
 * and the console give Import a file's text with `setThemeImport`, and read
 * what Export wrote with `exportedThemes`.
 */
import type { Engine } from "../../shared/engine";
import { readTheme } from "../../shared/theme";
import { MAX_THEME_FILE_BYTES, readThemeFile, themeFileName, themeFileText } from "../../shared/theme-file";

export interface ThemeFileControls {
	/**
	 * Decide what the next Import reads: this text, as from a file of this
	 * name, or null for a picker closed without a choice. Each Import takes
	 * one; with none waiting, a browser opens its file picker and anywhere
	 * else Import is cancelled.
	 */
	setThemeImport(text: string | null, file?: string): void;
	/** Every file Export wrote, oldest first. */
	exportedThemes(): { path: string; text: string }[];
}

/** Ask the browser for a file. Null when the picker was closed without one. */
function pickInBrowser(): Promise<{ file: string; text: string } | null> {
	return new Promise(resolve => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = ".json,application/json";
		input.addEventListener("cancel", () => resolve(null));
		input.addEventListener("change", () => {
			const file = input.files?.[0];
			if (!file) return resolve(null);
			if (file.size > MAX_THEME_FILE_BYTES) return resolve({ file: file.name, text: "x".repeat(MAX_THEME_FILE_BYTES + 1) });
			void file.text().then(text => resolve({ file: file.name, text }), () => resolve(null));
		});
		input.click();
	});
}

function download(fileName: string, text: string): void {
	const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = fileName;
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const inBrowser = () => typeof document !== "undefined" && typeof URL.createObjectURL === "function";

export function createMockThemeFiles(): Pick<Engine, "exportTheme" | "importTheme"> & ThemeFileControls {
	const waiting: ({ file: string; text: string } | null)[] = [];
	const exported: { path: string; text: string }[] = [];
	return {
		async exportTheme(value) {
			const { theme, replaced } = readTheme(structuredClone(value));
			if (replaced.length > 0) return { outcome: "failed", message: `The theme could not be read, so nothing was written: ${replaced.slice(0, 4).join(", ")}.` };
			const fileName = themeFileName(theme.name, name => exported.some(entry => entry.path === `Downloads/${name}`));
			const text = themeFileText(theme);
			exported.push({ path: `Downloads/${fileName}`, text });
			if (inBrowser()) download(fileName, text);
			return { outcome: "exported", path: `Downloads/${fileName}` };
		},
		async importTheme() {
			const picked = waiting.length > 0 ? waiting.shift()! : inBrowser() ? await pickInBrowser() : null;
			if (picked === null) return { outcome: "cancelled" };
			const read = readThemeFile(picked.text);
			return read.outcome === "read" ? { outcome: "imported", file: picked.file, theme: read.theme } : { outcome: "refused", file: picked.file, reason: read.reason };
		},
		setThemeImport(text, file = "/home/sample/theme.timber-theme.json") {
			waiting.push(text === null ? null : { file, text });
		},
		exportedThemes: () => structuredClone(exported),
	};
}
