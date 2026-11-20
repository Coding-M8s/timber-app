import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readSettings, settingsFilePath, writeSettings } from "../src/bun/settings";

const saved = { repositories: [{ path: "/work/timber", commonDir: "/work/timber/.git" }] };

let root: string;
let folders = 0;
/** A settings path in a fresh folder that does not exist yet. */
const freshFile = () => join(root, `case-${folders++}`, "timber-app", "settings.json");

beforeAll(() => {
	root = mkdtempSync(join(tmpdir(), "timber-app-settings-"));
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("settingsFilePath", () => {
	test("is in the per-user configuration directory of each platform", () => {
		expect(settingsFilePath({}, "linux", "/home/sam")).toBe("/home/sam/.config/timber-app/settings.json");
		expect(settingsFilePath({ XDG_CONFIG_HOME: "/cfg" }, "linux", "/home/sam")).toBe("/cfg/timber-app/settings.json");
		expect(settingsFilePath({ XDG_CONFIG_HOME: "relative" }, "linux", "/home/sam")).toBe("/home/sam/.config/timber-app/settings.json");
		expect(settingsFilePath({}, "darwin", "/Users/sam")).toBe("/Users/sam/Library/Application Support/timber-app/settings.json");
		expect(settingsFilePath({ APPDATA: "C:\\Users\\sam\\AppData\\Roaming" }, "win32", "C:\\Users\\sam"))
			.toBe("C:\\Users\\sam\\AppData\\Roaming\\timber-app\\settings.json");
		expect(settingsFilePath({}, "win32", "C:\\Users\\sam")).toBe("C:\\Users\\sam\\AppData\\Roaming\\timber-app\\settings.json");
	});
});

describe("writeSettings and readSettings", () => {
	test("create the folder, save, and read back the same settings", async () => {
		const file = freshFile();
		await writeSettings(file, saved);
		expect(await readSettings(file)).toEqual(saved);
		expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, ...saved });
	});

	test("replace the file whole and leave no temporary file behind", async () => {
		const file = freshFile();
		await writeSettings(file, saved);
		await writeSettings(file, { repositories: [] });
		await writeSettings(file, saved);
		expect(readdirSync(join(file, ".."))).toEqual(["settings.json"]);
		expect(await readSettings(file)).toEqual(saved);
	});

	// Skipped on Windows, where chmod only sets the read-only flag, so the folder stays writable. Also skipped for root, who can write anywhere.
	test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a save that fails leaves the old file and no temporary file", async () => {
		const file = freshFile();
		await writeSettings(file, saved);
		const folder = join(file, "..");
		chmodSync(folder, 0o500);
		try {
			await expect(writeSettings(file, { repositories: [] })).rejects.toThrow();
		} finally {
			chmodSync(folder, 0o700);
		}
		expect(readdirSync(folder)).toEqual(["settings.json"]);
		expect(await readSettings(file)).toEqual(saved);
	});
});

describe("readSettings", () => {
	test("starts empty, without a warning, when there is no file yet", async () => {
		const warnings: string[] = [];
		const file = freshFile();
		expect(await readSettings(file, message => warnings.push(message))).toEqual({ repositories: [] });
		expect(warnings).toEqual([]);
		expect(existsSync(join(file, ".."))).toBe(false);
	});

	test("starts empty from a damaged file, warns, and keeps a copy of it", async () => {
		for (const text of ["{ not json", "", '{"version":1,"repositories":[{"path":"/work/tim', '{"version":1,"repositories":"all of them"}']) {
			const warnings: string[] = [];
			const file = freshFile();
			mkdirSync(join(file, ".."), { recursive: true });
			writeFileSync(file, text);

			expect(await readSettings(file, message => warnings.push(message))).toEqual({ repositories: [] });
			expect(warnings.length).toBe(1);
			expect(warnings[0]).toContain("is damaged");
			expect(readFileSync(`${file}.damaged`, "utf8")).toBe(text);
			// Reading never rewrites the file itself.
			expect(readFileSync(file, "utf8")).toBe(text);

			// And the app can save over it afterwards.
			await writeSettings(file, saved);
			expect(await readSettings(file)).toEqual(saved);
		}
	});

	test("starts empty, with a warning, when the file cannot be read at all", async () => {
		const warnings: string[] = [];
		const file = freshFile();
		// A folder where the file should be.
		mkdirSync(file, { recursive: true });
		expect(await readSettings(file, message => warnings.push(message))).toEqual({ repositories: [] });
		expect(warnings.length).toBe(1);
	});
});
