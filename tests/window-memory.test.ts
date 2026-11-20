import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createSavedLayout } from "../src/bun/layout";
import { createSettingsHolder } from "../src/bun/settings";
import { createWindowMemory } from "../src/bun/window-memory";
import type { SeenWindow } from "../src/shared/window-frame";

let root: string;
let settingsFile: string;
let cases = 0;

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-window-")));
});

beforeEach(() => {
	settingsFile = join(root, `config-${cases++}`, "timber-app", "settings.json");
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

const onDisk = () => JSON.parse(readFileSync(settingsFile, "utf8"));
const frame = { x: 300, y: 200, width: 1500, height: 900 };
const normal = (seen = frame): SeenWindow => ({ frame: seen, maximized: false, fullScreen: false });

/** What the main process sets up: one holder of the file, and a window that reports whatever `seen` holds. */
function appOn(seen: { window: SeenWindow | Error }, delay = 5, warnings: string[] = []) {
	const settings = createSettingsHolder(settingsFile, () => {});
	const memory = createWindowMemory({
		settings,
		read: () => {
			if (seen.window instanceof Error) throw seen.window;
			return seen.window;
		},
		delay,
		warn: message => warnings.push(message),
	});
	return { settings, memory, layout: createSavedLayout(settings), warnings };
}

const wait = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

describe("the saved window", () => {
	test("is null when nothing was saved, and reading it writes nothing", async () => {
		expect(await appOn({ window: normal() }).memory.load()).toBeNull();
		expect(() => readFileSync(settingsFile)).toThrow();
	});

	test("is still there after a restart", async () => {
		await appOn({ window: normal() }).memory.flush();
		expect(onDisk().window).toEqual({ frame, maximized: false });
		expect(await appOn({ window: normal() }).memory.load()).toEqual({ frame, maximized: false });
	});

	test("is saved once after the window has been still, with the last frame", async () => {
		const seen = { window: normal() };
		const { memory, settings } = appOn(seen, 30);
		let saves = 0;
		const save = settings.save;
		settings.save = next => {
			saves++;
			return save(next);
		};
		for (const width of [1000, 1100, 1200]) {
			seen.window = normal({ ...frame, width });
			memory.changed();
			await wait(5);
		}
		expect(() => readFileSync(settingsFile)).toThrow();
		await wait(80);
		await settings.inTurn(async () => {});
		expect(onDisk().window.frame.width).toBe(1200);
		expect(saves).toBe(1);
	});

	test("keeps the chosen size while maximized, and remembers that it was", async () => {
		const seen = { window: normal() };
		const { memory } = appOn(seen);
		await memory.flush();
		seen.window = { frame: { x: 0, y: 0, width: 1920, height: 1080 }, maximized: true, fullScreen: false };
		await memory.flush();
		expect(onDisk().window).toEqual({ frame, maximized: true });
	});

	test("does not write again when nothing changed", async () => {
		const { memory, settings } = appOn({ window: normal() });
		await memory.flush();
		let saves = 0;
		settings.save = async () => {
			saves++;
		};
		await memory.flush();
		expect(saves).toBe(0);
	});

	test("leaves every other part of the settings as it is, and they leave it", async () => {
		const { memory, layout } = appOn({ window: normal() });
		const arranged = { sidebarWidth: 344, collapsed: ["/work/sample"], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: ["g-work"] };
		await Promise.all([layout.save(arranged), memory.flush()]);
		expect(onDisk().layout).toEqual(arranged);
		expect(onDisk().window).toEqual({ frame, maximized: false });
		await layout.save({ ...arranged, sidebarWidth: 300 });
		expect(onDisk().window).toEqual({ frame, maximized: false });
	});

	test("an older file without a window, and a window part that cannot be read, both mean none", async () => {
		mkdirSync(dirname(settingsFile), { recursive: true });
		writeFileSync(settingsFile, JSON.stringify({ version: 1, repositories: [] }));
		expect(await appOn({ window: normal() }).memory.load()).toBeNull();
		writeFileSync(settingsFile, JSON.stringify({ version: 1, repositories: [], window: { frame: { width: "wide" } } }));
		const { memory, settings } = appOn({ window: normal() });
		expect(await memory.load()).toBeNull();
		expect((await settings.current()).repositories).toEqual([]);
	});

	test("saves nothing when the window is gone", async () => {
		const { memory } = appOn({ window: new Error("no window") });
		await memory.flush();
		expect(() => readFileSync(settingsFile)).toThrow();
	});

	test("a save that fails is a warning, and the next one works", async () => {
		if (process.platform === "win32" || process.getuid?.() === 0) return;
		const seen = { window: normal() };
		const { memory, warnings } = appOn(seen);
		await memory.flush();
		chmodSync(dirname(settingsFile), 0o500);
		try {
			seen.window = normal({ ...frame, width: 1600 });
			await memory.flush();
		} finally {
			chmodSync(dirname(settingsFile), 0o700);
		}
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toContain("Could not save the window size");
		expect(onDisk().window.frame.width).toBe(1500);
		await memory.flush();
		expect(onDisk().window.frame.width).toBe(1600);
	});
});
