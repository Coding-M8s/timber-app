import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { createSavedLayout } from "../src/bun/layout";
import { createRepositoryList } from "../src/bun/repository-list";
import type { RepositoryReader } from "../src/bun/repository-reader";
import { createSettingsHolder, readSettings, writeSettings } from "../src/bun/settings";
import { DEFAULT_SIDEBAR_WIDTH, MAX_SIDEBAR_WIDTH, defaultLayout } from "../src/shared/layout";
import { git, makeRepository } from "./support/timber";

let root: string;
let primary: string;
let other: string;
let settingsFile: string;
let cases = 0;

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-layout-")));
	primary = join(root, "sample");
	other = join(root, "other");
	makeRepository(root, "sample");
	makeRepository(root, "other");
});

beforeEach(() => {
	settingsFile = join(root, `config-${cases++}`, "timber-app", "settings.json");
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

const onDisk = () => JSON.parse(readFileSync(settingsFile, "utf8"));
const saved = (path: string) => ({ path, commonDir: join(path, ".git") });

/**
 * Stands in for Timber's list, which the layout has nothing to do with: every
 * folder is its own primary checkout. Git still says, for real, which
 * repository a folder belongs to.
 */
const reader: RepositoryReader = {
	find: async folder => ({ outcome: "read", repository: { path: folder, name: basename(folder), available: true, failure: null, setup: "unknown", worktrees: [] } }),
	reload: async path => ({ path, name: basename(path), available: true, failure: null, setup: "unknown", worktrees: [] }),
};

/** What the main process sets up: one holder of the file, shared by the repository list and the layout. */
function appOn(file = settingsFile) {
	const settings = createSettingsHolder(file, () => {});
	return {
		layout: createSavedLayout(settings),
		repositories: createRepositoryList({ settingsFile: file, settings, pickFolder: async () => null, reader, environment: {}, warn: () => {} }),
	};
}

describe("the saved layout", () => {
	test("is the default when nothing was saved, and reading it writes nothing", async () => {
		expect(await appOn().layout.load()).toEqual(defaultLayout());
		expect(() => readFileSync(settingsFile)).toThrow();
	});

	test("is still there after a restart", async () => {
		const layout = { sidebarWidth: 344, collapsed: [primary], setupDismissed: [], uncommittedChanges: [], issueLists: {} };
		const first = appOn();
		expect(await first.layout.save(layout)).toEqual({ outcome: "saved" });
		expect(await first.layout.load()).toEqual(layout);
		expect(onDisk()).toEqual({ version: 1, repositories: [], layout });

		// A new holder on the same file is what a restarted app has.
		expect(await appOn().layout.load()).toEqual(layout);
	});

	test("the latest save wins, and no temporary file is left behind", async () => {
		const { layout } = appOn();
		await Promise.all([280, 300, 320, 340].map(sidebarWidth => layout.save({ sidebarWidth, collapsed: [], setupDismissed: [], uncommittedChanges: [], issueLists: {} })));
		expect(onDisk().layout).toEqual({ sidebarWidth: 340, collapsed: [], setupDismissed: [], uncommittedChanges: [], issueLists: {} });
		expect(readdirSync(join(settingsFile, ".."))).toEqual(["settings.json"]);
	});

	test("checks what the interface sent before saving it", async () => {
		const { layout } = appOn();
		await layout.save({ sidebarWidth: 99_999, collapsed: [primary, primary, 7 as unknown as string], setupDismissed: [], uncommittedChanges: [], issueLists: {} });
		expect(onDisk().layout).toEqual({ sidebarWidth: MAX_SIDEBAR_WIDTH, collapsed: [primary], setupDismissed: [], uncommittedChanges: [], issueLists: {} });
	});

	test("an older settings file without a layout keeps its repositories when the layout is first saved", async () => {
		mkdirSync(join(settingsFile, ".."), { recursive: true });
		writeFileSync(settingsFile, JSON.stringify({ version: 1, repositories: [saved(primary), saved(other)] }));

		const { layout, repositories } = appOn();
		expect(await layout.load()).toEqual(defaultLayout());
		expect((await repositories.list()).map(repository => repository.path)).toEqual([primary, other]);
		// Reading alone leaves the older file exactly as it was.
		expect(onDisk()).toEqual({ version: 1, repositories: [saved(primary), saved(other)] });

		await layout.save({ sidebarWidth: 300, collapsed: [other], setupDismissed: [], uncommittedChanges: [], issueLists: {} });
		expect(onDisk()).toEqual({ version: 1, repositories: [saved(primary), saved(other)], layout: { sidebarWidth: 300, collapsed: [other], setupDismissed: [], uncommittedChanges: [], issueLists: {} } });
		expect((await appOn().repositories.list()).map(repository => repository.path)).toEqual([primary, other]);
	});

	test("a damaged layout part is read as the defaults and the repositories are kept", async () => {
		mkdirSync(join(settingsFile, ".."), { recursive: true });
		writeFileSync(settingsFile, JSON.stringify({ version: 1, repositories: [saved(primary)], layout: { sidebarWidth: "wide", collapsed: 3 } }));
		const warnings: string[] = [];
		const settings = createSettingsHolder(settingsFile, message => warnings.push(message));
		expect(await createSavedLayout(settings).load()).toEqual({ sidebarWidth: DEFAULT_SIDEBAR_WIDTH, collapsed: [], setupDismissed: [], uncommittedChanges: [], issueLists: {} });
		expect((await settings.current()).repositories).toEqual([saved(primary)]);
		expect(warnings).toEqual([]);
		expect(readdirSync(join(settingsFile, ".."))).toEqual(["settings.json"]);
	});

	test("saving the layout and changing the repository list never lose each other's part", async () => {
		const { layout, repositories } = appOn();
		// All asked for at once, as a person who drags the sidebar while a repository is being added.
		const results = await Promise.all([
			repositories.addFolder(primary),
			layout.save({ sidebarWidth: 310, collapsed: [primary], setupDismissed: [], uncommittedChanges: [], issueLists: {} }),
			repositories.addFolder(other),
			layout.save({ sidebarWidth: 330, collapsed: [primary], setupDismissed: [], uncommittedChanges: [], issueLists: {} }),
		]);
		expect(results.map(result => result.outcome)).toEqual(["added", "saved", "added", "saved"]);
		expect(onDisk()).toEqual({
			version: 1,
			repositories: [{ path: primary, commonDir: join(primary, ".git") }, { path: other, commonDir: join(other, ".git") }],
			layout: { sidebarWidth: 330, collapsed: [primary], setupDismissed: [], uncommittedChanges: [], issueLists: {} },
		});
		// Neither repository was touched.
		expect(git(primary, "status", "--porcelain")).toBe("");
		expect(git(other, "status", "--porcelain")).toBe("");
	});

	test("removing a repository forgets its collapsed group and keeps the rest of the layout", async () => {
		const { layout, repositories } = appOn();
		await repositories.addFolder(primary);
		await repositories.addFolder(other);
		await layout.save({ sidebarWidth: 310, collapsed: [primary, other], setupDismissed: [], uncommittedChanges: [], issueLists: {} });

		expect(await repositories.remove(primary)).toEqual({ outcome: "removed" });
		expect(await layout.load()).toEqual({ sidebarWidth: 310, collapsed: [other], setupDismissed: [], uncommittedChanges: [], issueLists: {} });
		expect(onDisk().layout).toEqual({ sidebarWidth: 310, collapsed: [other], setupDismissed: [], uncommittedChanges: [], issueLists: {} });
		expect(onDisk().repositories.map((entry: { path: string }) => entry.path)).toEqual([other]);
	});

	// Skipped on Windows, where chmod only sets the read-only flag, so the folder stays writable. Also skipped for root, who can write anywhere.
	test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a save of the layout that is already saved does not write the file again", async () => {
		const { layout } = appOn();
		await layout.save({ sidebarWidth: 310, collapsed: [], setupDismissed: [], uncommittedChanges: [], issueLists: {} });
		const folder = join(settingsFile, "..");
		// With the folder read-only a write would fail, so "saved" shows that none was tried.
		chmodSync(folder, 0o500);
		try {
			expect(await layout.save({ sidebarWidth: 310, collapsed: [], setupDismissed: [], uncommittedChanges: [], issueLists: {} })).toEqual({ outcome: "saved" });
		} finally {
			chmodSync(folder, 0o700);
		}
	});

	// Skipped on Windows, where chmod only sets the read-only flag, so the folder stays writable. Also skipped for root, who can write anywhere.
	test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a save that fails says so, and leaves the file and the remembered layout as they were", async () => {
		await writeSettings(settingsFile, { repositories: [saved(primary)], layout: { sidebarWidth: 300, collapsed: [], setupDismissed: [], uncommittedChanges: [], issueLists: {} } });
		const { layout } = appOn();
		const folder = join(settingsFile, "..");
		chmodSync(folder, 0o500);
		let result;
		try {
			result = await layout.save({ sidebarWidth: 400, collapsed: [primary], setupDismissed: [], uncommittedChanges: [], issueLists: {} });
		} finally {
			chmodSync(folder, 0o700);
		}
		expect(result.outcome).toBe("failed");
		expect(result).toMatchObject({ message: expect.stringContaining(`Could not save settings to ${settingsFile}`) });
		expect(await layout.load()).toEqual({ sidebarWidth: 300, collapsed: [], setupDismissed: [], uncommittedChanges: [], issueLists: {} });
		expect(await readSettings(settingsFile)).toEqual({ repositories: [saved(primary)], layout: { sidebarWidth: 300, collapsed: [], setupDismissed: [], uncommittedChanges: [], issueLists: {} } });
		expect(readdirSync(folder)).toEqual(["settings.json"]);

		// And the next save works again.
		expect(await layout.save({ sidebarWidth: 400, collapsed: [primary], setupDismissed: [], uncommittedChanges: [], issueLists: {} })).toEqual({ outcome: "saved" });
		expect(await appOn().layout.load()).toEqual({ sidebarWidth: 400, collapsed: [primary], setupDismissed: [], uncommittedChanges: [], issueLists: {} });
	});
});
