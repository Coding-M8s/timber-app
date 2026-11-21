import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChopsWatcher } from "../src/bun/chops-watcher";
import type { DirectoryWatch, WatchDirectory } from "../src/bun/repository-watcher";
import { manualClock } from "./support/clock";
import { until } from "./support/runtime";

/** Watches the test fires by hand. A folder in `missing` cannot be watched. Folders are kept with forward slashes. */
function fakeWatches() {
	const open = new Map<string, { recursive: boolean; event: (name: string | null) => void; error: (error: unknown) => void }>();
	const missing = new Set<string>();
	const watchDirectory: WatchDirectory = (joined, recursive, onEvent, onError) => {
		const folder = joined.replaceAll("\\", "/");
		if (missing.has(folder)) throw Object.assign(new Error(`ENOENT: ${folder}`), { code: "ENOENT" });
		const entry = { recursive, event: onEvent, error: onError };
		open.set(folder, entry);
		const handle: DirectoryWatch = {
			close() {
				if (open.get(folder) === entry) open.delete(folder);
			},
		};
		return handle;
	};
	return {
		watchDirectory,
		missing,
		folders: () => [...open.keys()].sort(),
		recursive: (folder: string) => open.get(folder)?.recursive,
		fire(folder: string, name: string | null) {
			const entry = open.get(folder);
			if (!entry) throw new Error(`Nothing watches ${folder}`);
			entry.event(name);
		},
	};
}

const REPO = "/work/sample";

function setup() {
	const clock = manualClock();
	const watches = fakeWatches();
	const changes: string[] = [];
	const watcher = createChopsWatcher({ onChange: path => changes.push(path), watchDirectory: watches.watchDirectory, schedule: clock.schedule, warn: () => {} });
	return { clock, watches, changes, watcher };
}

describe("createChopsWatcher with stand-in watches", () => {
	test("watches the main checkout and its .timber folder, neither recursively, and nothing else", () => {
		const { watches, watcher } = setup();
		watcher.sync([REPO]);
		expect(watches.folders()).toEqual([REPO, `${REPO}/.timber`]);
		expect(watches.recursive(REPO)).toBe(false);
		expect(watches.recursive(`${REPO}/.timber`)).toBe(false);
	});

	test("a change in .timber is one report per burst; other names in the checkout are not heard", () => {
		const { clock, watches, changes, watcher } = setup();
		watcher.sync([REPO]);
		watches.fire(`${REPO}/.timber`, "chops.json");
		watches.fire(`${REPO}/.timber`, "chops.json");
		watches.fire(REPO, "dist");
		watches.fire(REPO, "node_modules");
		clock.advance(1000);
		expect(changes).toEqual([REPO]);
	});

	test("a .timber folder made later is watched from then on, and heard", () => {
		const { clock, watches, changes, watcher } = setup();
		watches.missing.add(`${REPO}/.timber`);
		watcher.sync([REPO]);
		expect(watches.folders()).toEqual([REPO]);
		watches.missing.delete(`${REPO}/.timber`);
		watches.fire(REPO, ".timber");
		expect(watches.folders()).toEqual([REPO, `${REPO}/.timber`]);
		clock.advance(1000);
		expect(changes).toEqual([REPO]);
	});

	test("a repository that leaves the list is no longer watched, and a pending report is dropped", () => {
		const { clock, watches, changes, watcher } = setup();
		watcher.sync([REPO]);
		watches.fire(`${REPO}/.timber`, "chops.json");
		watcher.sync([]);
		clock.advance(1000);
		expect(watches.folders()).toEqual([]);
		expect(changes).toEqual([]);
	});
});

describe("createChopsWatcher against a real folder", () => {
	let root: string;
	let changes: string[];
	let watcher: ReturnType<typeof createChopsWatcher>;

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-chops-watch-")));
		changes = [];
		watcher = createChopsWatcher({ onChange: path => changes.push(path), quietMilliseconds: 50 });
		watcher.sync([root]);
	});

	afterEach(() => {
		// An open watch keeps the test process alive.
		watcher.stop();
		rmSync(root, { recursive: true, force: true });
	});

	test("hears the chops file made, then edited, with no polling", async () => {
		mkdirSync(join(root, ".timber"));
		expect(await until(() => changes.length > 0, 3000)).toBe(true);
		await Bun.sleep(200);
		changes.length = 0;
		writeFileSync(join(root, ".timber", "chops.json"), "{}\n");
		expect(await until(() => changes.length > 0, 3000)).toBe(true);
		await Bun.sleep(200);
		changes.length = 0;
		writeFileSync(join(root, ".timber", "chops.json"), "{ \"version\": 1, \"chops\": [] }\n");
		expect(await until(() => changes.length > 0, 3000)).toBe(true);
		expect(changes.every(path => path === root)).toBe(true);
	});

	test("does not hear a file written beside .timber", async () => {
		await Bun.sleep(200);
		changes.length = 0;
		writeFileSync(join(root, "build.log"), "x\n");
		await Bun.sleep(300);
		expect(changes).toEqual([]);
	});
});
