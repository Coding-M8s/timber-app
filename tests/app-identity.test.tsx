import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { aboutRows } from "../src/mainview/about-format";
import { AboutSectionView } from "../src/mainview/components/settings/AboutSection";
import { createMockEngine, sampleTimberStatuses } from "../src/mainview/engine/mock";
import { SETTINGS_SECTION_LABELS, TIMBER_SETTINGS_SECTIONS } from "../src/mainview/shell";
import { SETTINGS_SECTIONS } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { APP_DESCRIPTION, APP_IDENTIFIER, APP_NAME, APP_VERSION } from "../src/shared/app-info";

const root = resolve(import.meta.dirname, "..");
const at = (...parts: string[]) => resolve(root, ...parts);
const text = (...parts: string[]) => readFileSync(at(...parts), "utf8");

/** The width and height a PNG file states in its header. */
function pngSize(file: string): { width: number; height: number } {
	const bytes = readFileSync(file);
	expect(bytes.subarray(1, 4).toString("latin1")).toBe("PNG");
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The sizes of the pictures inside an ICO file. A zero stands for 256. */
function icoSizes(file: string): number[] {
	const bytes = readFileSync(file);
	expect([bytes.readUInt16LE(0), bytes.readUInt16LE(2)]).toEqual([0, 1]);
	const count = bytes.readUInt16LE(4);
	return Array.from({ length: count }, (_, index) => bytes.readUInt8(6 + index * 16) || 256).sort((left, right) => left - right);
}

interface BuildConfig {
	app: { name: string; identifier: string; version: string; description?: string };
	build: {
		copy: Record<string, string>;
		mac: { icons?: string };
		linux: { icon?: string };
		win: { icon?: string };
	};
}

// A path made at run time, so the default type check does not need the Electrobun SDK that the file names.
const config = (await import(at("electrobun.config.ts")) as { default: BuildConfig }).default;

describe("the app's identity", () => {
	test("the identifier is the final one, and the build uses it", () => {
		expect(APP_IDENTIFIER).toBe("com.codingm8s.timber-app");
		expect(config.app.identifier).toBe(APP_IDENTIFIER);
	});

	test("the window, the taskbar, and the installer are all named Timber", () => {
		expect(APP_NAME).toBe("Timber");
		expect(config.app.name).toBe("Timber");
		expect(text("src/mainview/index.html")).toContain("<title>Timber</title>");
		expect(text("src/bun/index.ts")).toContain("title: APP_NAME,");
	});

	test("the version is written once, in package.json", () => {
		const manifest = JSON.parse(text("package.json")) as { version: string };
		expect(APP_VERSION).toBe(manifest.version);
		expect(config.app.version).toBe(manifest.version);
		expect(text("electrobun.config.ts")).not.toContain(`"${manifest.version}"`);
	});

	test("menus get a description that differs from the name", () => {
		expect(config.app.description).toBe(APP_DESCRIPTION);
		expect(APP_DESCRIPTION).not.toBe(APP_NAME);
	});
});

describe("the app icons", () => {
	test("Linux gets a 512 pixel PNG", () => {
		expect(config.build.linux.icon).toBe("icons/icon.png");
		expect(pngSize(at("icons/icon.png"))).toEqual({ width: 512, height: 512 });
	});

	test("Windows gets an ICO with every size from 16 to 256", () => {
		expect(config.build.win.icon).toBe("icons/icon.ico");
		expect(icoSizes(at("icons/icon.ico"))).toEqual([16, 24, 32, 48, 64, 128, 256]);
	});

	test("macOS has a full iconset prepared, each picture at the size its name says", () => {
		expect(config.build.mac.icons).toBe("icons/icon.iconset");
		const files = readdirSync(at("icons/icon.iconset")).sort();
		const expected = [16, 32, 128, 256, 512].flatMap(size => [`icon_${size}x${size}.png`, `icon_${size}x${size}@2x.png`]).sort();
		expect(files).toEqual(expected);
		for (const file of files) {
			const [, size, twice] = /^icon_(\d+)x\d+(@2x)?\.png$/.exec(file)!;
			const pixels = Number(size) * (twice ? 2 : 1);
			expect(pngSize(at("icons/icon.iconset", file))).toEqual({ width: pixels, height: pixels });
		}
	});
});

describe("the bundled fonts", () => {
	const styles = text("src/mainview/styles.css");
	const faces = [...styles.matchAll(/@font-face\s*\{[^}]*\}/g)].map(match => match[0]);

	test("Geist and Geist Mono each come from a file in the repository", () => {
		const families = faces.map(face => /font-family:\s*"([^"]+)"/.exec(face)?.[1]);
		expect(families).toEqual(["Geist", "Geist Mono"]);
		for (const face of faces) {
			const file = /url\("([^"]+)"\)/.exec(face)![1]!;
			const bytes = readFileSync(at("src/mainview", file));
			// Every WOFF2 file starts with these four letters.
			expect(bytes.subarray(0, 4).toString("latin1")).toBe("wOF2");
		}
	});

	test("the interface asks for the bundled faces first", () => {
		expect(styles).toMatch(/--font-ui:\s*"Geist",/);
		expect(styles).toMatch(/--font-mono:\s*"Geist Mono",/);
	});

	test("nothing in the interface is fetched from the network", () => {
		expect(styles).not.toMatch(/url\(\s*["']?(https?:)?\/\//);
		expect(styles).not.toContain("@import");
		const page = text("src/mainview/index.html");
		expect(page).not.toMatch(/<link\b/);
		expect(page).not.toMatch(/https?:\/\//);
	});
});

describe("the licenses", () => {
	test("the font license and the logo notice are in the repository and copied into every build", () => {
		expect(config.build.copy.licenses).toBe("licenses");
		expect(text("licenses/geist-fonts-OFL.txt")).toContain("SIL OPEN FONT LICENSE Version 1.1");
		expect(text("licenses/geist-fonts-OFL.txt")).toContain("Vercel");
		expect(text("licenses/timber-logo.txt")).toContain("All rights reserved.");
		expect(existsSync(at("LICENSE"))).toBe(true);
	});
});

describe("About", () => {
	test("lists the app's version and the Timber in use, with where it was found", () => {
		expect(aboutRows("0.4.0", { known: true, status: { state: "ready", path: "/usr/bin/timber", version: "0.1.2" } })).toEqual([
			{ label: "Timber app", value: "0.4.0", mono: true, note: null },
			{ label: "Timber", value: "0.1.2", mono: true, note: "/usr/bin/timber" },
		]);
	});

	test("says so when a version is not known yet, or Timber is missing, too old, or could not be looked for", () => {
		const timberRow = (...parameters: Parameters<typeof aboutRows>) => aboutRows(...parameters)[1]!;
		expect(aboutRows(null, null)[0]).toEqual({ label: "Timber app", value: "Version not known", mono: false, note: null });
		expect(timberRow(null, null).value).toBe("Looking for Timber");
		expect(timberRow(null, { known: true, status: { state: "not-found", override: null } }).value).toBe("Not installed");
		expect(timberRow(null, { known: true, status: { state: "too-old", path: "/usr/bin/timber", found: "0.1.0", required: "0.1.2" } })).toEqual({
			label: "Timber",
			value: "0.1.0",
			mono: true,
			note: "Too old: the app needs 0.1.2 or newer. Found at /usr/bin/timber",
		});
		expect(timberRow(null, { known: false, message: "spawn failed" })).toEqual({ label: "Timber", value: "Could not look for Timber", mono: false, note: "spawn failed" });
	});

	test("draws both versions and names the licenses of the fonts and the logo", () => {
		const markup = renderToStaticMarkup(<AboutSectionView rows={aboutRows("0.4.0", { known: true, status: sampleTimberStatuses.ready })} />);
		expect(markup).toContain(">About</h3>");
		expect(markup).toContain('<dt class="about-label">Timber app</dt>');
		expect(markup).toContain('<span class="mono">0.4.0</span>');
		expect(markup).toContain('<dt class="about-label">Timber</dt>');
		expect(markup).toContain("SIL Open Font License 1.1");
		expect(markup).toContain("all rights reserved");
	});

	test("is a section of Settings, among the app's own and not under Timber's", () => {
		expect(SETTINGS_SECTIONS).toContain("about");
		expect(SETTINGS_SECTION_LABELS.about).toBe("About");
		expect(TIMBER_SETTINGS_SECTIONS).not.toContain("about");
		expect(SETTINGS_SECTIONS.indexOf("about")).toBeLessThan(SETTINGS_SECTIONS.indexOf(TIMBER_SETTINGS_SECTIONS[0]!));
	});

	test("the store asks the engine for the app's version on start", async () => {
		const engine = createMockEngine();
		expect((await engine.appInfo()).version).toBe(APP_VERSION);
		const store = createAppStore(engine);
		expect(store.getState().appVersion).toBeNull();
		expect(store.getState().rendering).toBeNull();
		const stop = store.start();
		await engine.appInfo();
		await Promise.resolve();
		expect(store.getState().appVersion).toBe(APP_VERSION);
		expect(store.getState().rendering).toEqual((await engine.appInfo()).rendering);
		stop();
	});

	test("a failed answer leaves the version unknown and the app running", async () => {
		const engine = { ...createMockEngine(), appInfo: () => Promise.reject(new Error("no answer")) };
		const store = createAppStore(engine);
		const stop = store.start();
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(store.getState().appVersion).toBeNull();
		stop();
	});
});
