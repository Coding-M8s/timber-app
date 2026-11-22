import { fileExtensions, fileNames, folderNames, light } from "material-icon-theme/dist/material-icons.json";
import type { Appearance } from "../shared/theme";

/*
 * The icon before each name in the Files panel, from Material Icon Theme
 * (the `material-icon-theme` package, MIT, notice in
 * licenses/material-icon-theme.txt). The lookup is pure, so it is tested
 * without a window. The icons themselves are the package's SVG files, which
 * vite.config.ts copies into the app's assets; each one loads only when a
 * row shows it.
 */

export type IconKind = "file" | "folder";

const FILE = "file";
const FOLDER = "folder";

/** The theme spells some names in capitals (`CLAUDE.md`, `PKGBUILD`); names match whatever their case. */
function lowered(table: Readonly<Record<string, string>>): ReadonlyMap<string, string> {
	const map = new Map<string, string>();
	for (const [key, icon] of Object.entries(table)) {
		// A key with a slash names a path, such as `.github/FUNDING.yml`; a row matches by its own name only.
		if (!key.includes("/")) map.set(key.toLowerCase(), icon);
	}
	return map;
}

const NAMES = lowered(fileNames);
const EXTENSIONS = lowered(fileExtensions);
const FOLDERS = lowered(folderNames);
const LIGHT_NAMES = lowered(light.fileNames);
const LIGHT_EXTENSIONS = lowered(light.fileExtensions);
const LIGHT_FOLDERS = lowered(light.folderNames);

/** A light theme's drawing of the icon, where the theme has one. */
function pick(key: string, dark: ReadonlyMap<string, string>, lightTable: ReadonlyMap<string, string>, appearance: Appearance): string | undefined {
	return (appearance === "light" ? lightTable.get(key) : undefined) ?? dark.get(key);
}

/** The theme names an open folder's icon after the closed one: `folder-src-open`, `folder-idea-open_light`. */
function opened(icon: string): string {
	return icon.endsWith("_light") ? `${icon.slice(0, -"_light".length)}-open_light` : `${icon}-open`;
}

/**
 * The icon of a row: a file by its exact name first, then by its extension,
 * longest first (`.test.ts` before `.ts`); a folder by its name, open or
 * closed. Anything else gets the generic file or folder icon.
 */
export function iconFor(name: string, kind: IconKind, open: boolean, appearance: Appearance = "dark"): string {
	const key = name.toLowerCase();
	if (kind === "folder") {
		const closed = pick(key, FOLDERS, LIGHT_FOLDERS, appearance) ?? FOLDER;
		return open ? opened(closed) : closed;
	}
	const named = pick(key, NAMES, LIGHT_NAMES, appearance);
	if (named !== undefined) return named;
	for (let dot = key.indexOf("."); dot !== -1; dot = key.indexOf(".", dot + 1)) {
		const extension = key.slice(dot + 1);
		if (extension === "") break;
		const icon = pick(extension, EXTENSIONS, LIGHT_EXTENSIONS, appearance);
		if (icon !== undefined) return icon;
	}
	return FILE;
}

/** Every icon the lookup can give, for the build to copy and the tests to check. */
export function iconIds(): string[] {
	const ids = new Set<string>([FILE, FOLDER, opened(FOLDER)]);
	for (const map of [NAMES, EXTENSIONS, LIGHT_NAMES, LIGHT_EXTENSIONS]) for (const icon of map.values()) ids.add(icon);
	for (const map of [FOLDERS, LIGHT_FOLDERS]) {
		for (const icon of map.values()) {
			ids.add(icon);
			ids.add(opened(icon));
		}
	}
	return [...ids].sort();
}

/** Where the app serves an icon: among its own assets, so nothing is fetched from the network. */
export const FILE_ICONS_PATH = "assets/material-icons";

export function fileIconUrl(icon: string): string {
	return `/${FILE_ICONS_PATH}/${encodeURIComponent(icon)}.svg`;
}
