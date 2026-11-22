import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileIconUrl, iconFor, iconIds } from "../src/mainview/file-icons";

const PACKAGE = join(import.meta.dir, "..", "node_modules", "material-icon-theme");
const manifest = JSON.parse(readFileSync(join(PACKAGE, "dist", "material-icons.json"), "utf8")) as {
	iconDefinitions: Record<string, { iconPath: string }>;
	folderNames: Record<string, string>;
	folderNamesExpanded: Record<string, string>;
	light: { folderNames: Record<string, string>; folderNamesExpanded: Record<string, string> };
};

describe("the icon of a file", () => {
	test("an exact file name wins over its extension", () => {
		expect(iconFor("package.json", "file", false)).toBe("nodejs");
		expect(iconFor("tsconfig.json", "file", false)).toBe("tsconfig");
		expect(iconFor("other.json", "file", false)).toBe("json");
	});

	test("well-known names without an extension have their own icon", () => {
		expect(iconFor("Dockerfile", "file", false)).toBe("docker");
		expect(iconFor("Makefile", "file", false)).toBe("makefile");
		expect(iconFor("LICENSE", "file", false)).toBe("license");
	});

	test("a longer extension wins over a shorter one", () => {
		expect(iconFor("store.test.ts", "file", false)).toBe("test-ts");
		expect(iconFor("engine.d.ts", "file", false)).toBe("typescript-def");
		expect(iconFor("store.ts", "file", false)).toBe("typescript");
		expect(iconFor("archive.tar.gz", "file", false)).toBe(iconFor("x.gz", "file", false));
	});

	test("dotfiles match by name", () => {
		expect(iconFor(".gitignore", "file", false)).toBe("git");
		expect(iconFor(".editorconfig", "file", false)).toBe("editorconfig");
	});

	test("letter case does not matter, also for names the theme spells in capitals", () => {
		expect(iconFor("README.md", "file", false)).toBe("readme");
		expect(iconFor("readme.MD", "file", false)).toBe("readme");
		expect(iconFor("STORE.TS", "file", false)).toBe("typescript");
		expect(iconFor("claude.md", "file", false)).toBe("claude");
		expect(iconFor("pkgbuild", "file", false)).toBe(iconFor("PKGBUILD", "file", false));
	});

	test("an unknown file, or one with no extension, gets the generic file icon", () => {
		expect(iconFor("notes.zzqq", "file", false)).toBe("file");
		expect(iconFor("whatever", "file", false)).toBe("file");
		expect(iconFor("trailing.", "file", false)).toBe("file");
		expect(iconFor("", "file", false)).toBe("file");
	});

	test("whether a file is open does not change its icon", () => {
		expect(iconFor("store.ts", "file", true)).toBe("typescript");
	});
});

describe("the icon of a folder", () => {
	test("a named folder has its own icon, open or closed", () => {
		expect(iconFor("src", "folder", false)).toBe("folder-src");
		expect(iconFor("src", "folder", true)).toBe("folder-src-open");
		expect(iconFor("tests", "folder", false)).toBe("folder-test");
		expect(iconFor("docs", "folder", true)).toBe("folder-docs-open");
		expect(iconFor(".github", "folder", false)).toBe("folder-github");
		expect(iconFor("node_modules", "folder", false)).toBe("folder-node");
	});

	test("letter case does not matter", () => {
		expect(iconFor("SRC", "folder", false)).toBe("folder-src");
		expect(iconFor("Docs", "folder", true)).toBe("folder-docs-open");
	});

	test("any other folder gets the generic folder icon, which opens too", () => {
		expect(iconFor("zzqq", "folder", false)).toBe("folder");
		expect(iconFor("zzqq", "folder", true)).toBe("folder-open");
	});

	test("a folder is never matched as a file, nor a file as a folder", () => {
		expect(iconFor("src.ts", "folder", false)).toBe("folder");
		expect(iconFor("src", "file", false)).toBe("file");
	});

	test("the open icon of every named folder is the closed one's with -open, as the theme lists it", () => {
		for (const [name, closed] of Object.entries(manifest.folderNames)) expect(`${closed}-open`).toBe(manifest.folderNamesExpanded[name]!);
		for (const [name, closed] of Object.entries(manifest.light.folderNames)) expect(closed.replace(/_light$/, "-open_light")).toBe(manifest.light.folderNamesExpanded[name]!);
	});
});

describe("the icons of a light theme", () => {
	test("an icon the theme redraws for light backgrounds uses that drawing on a light theme only", () => {
		expect(iconFor("bun.lock", "file", false, "light")).toBe("bun_light");
		expect(iconFor("bun.lock", "file", false, "dark")).toBe("bun");
		expect(iconFor("config.toml", "file", false, "light")).toBe("toml_light");
		expect(iconFor(".idea", "folder", true, "light")).toBe("folder-intellij-open_light");
		expect(iconFor(".idea", "folder", true)).toBe("folder-intellij-open");
	});

	test("an icon with no light drawing stays the same", () => {
		expect(iconFor("store.ts", "file", false, "light")).toBe("typescript");
		expect(iconFor("src", "folder", false, "light")).toBe("folder-src");
	});
});

describe("the icon files", () => {
	test("every icon the lookup can give is a file the theme ships, so no row is ever blank", () => {
		const ids = iconIds();
		expect(ids.length).toBeGreaterThan(500);
		for (const id of ids) {
			const definition = manifest.iconDefinitions[id];
			expect(definition, id).toBeDefined();
			expect(existsSync(join(PACKAGE, "dist", definition!.iconPath)), id).toBe(true);
		}
	});

	test("each icon has its own address among the app's assets, never on the network", () => {
		expect(fileIconUrl("typescript")).toBe("/assets/material-icons/typescript.svg");
		expect(fileIconUrl("folder-src-open")).toBe("/assets/material-icons/folder-src-open.svg");
	});
});
