import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type DirectoryWatch, type WatchDirectory, type WatchTarget, createRepositoryWatcher } from "../src/bun/repository-watcher";
import { createWorktreeStamps } from "../src/bun/worktree-stamp";
import { manualClock } from "./support/clock";
import { until } from "./support/runtime";
import { git } from "./support/timber";

/**
 * Watches that the test fires by hand. A folder in `missing` cannot be watched, as if it were not there.
 * Folders are kept with forward slashes: the watcher joins with this system's separator, and the
 * expectations read the same on every system.
 */
function fakeWatches() {
	const open = new Map<string, { recursive: boolean; event: (name: string | null) => void; error: (error: unknown) => void; closed: boolean }>();
	const missing = new Set<string>();
	const refused = new Map<string, string>();
	let started = 0;
	const watchDirectory: WatchDirectory = (joined, recursive, onEvent, onError) => {
		const folder = joined.replaceAll("\\", "/");
		if (missing.has(folder)) throw Object.assign(new Error(`ENOENT: ${folder}`), { code: "ENOENT" });
		const refusal = refused.get(folder);
		if (refusal) throw Object.assign(new Error(refusal), { code: "ENOSPC" });
		started++;
		const entry = { recursive, event: onEvent, error: onError, closed: false };
		open.set(folder, entry);
		const handle: DirectoryWatch = {
			close() {
				entry.closed = true;
				if (open.get(folder) === entry) open.delete(folder);
			},
		};
		return handle;
	};
	return {
		watchDirectory,
		missing,
		refused,
		started: () => started,
		folders: () => [...open.keys()].sort(),
		recursive: (folder: string) => open.get(folder)?.recursive,
		fire(folder: string, name: string | null) {
			const entry = open.get(folder);
			if (!entry) throw new Error(`Nothing watches ${folder}`);
			entry.event(name);
		},
		fail(folder: string, error: Error) {
			open.get(folder)!.error(error);
		},
	};
}

const REPO: WatchTarget = { path: "/work/sample", commonDir: "/work/sample/.git" };
const OTHER: WatchTarget = { path: "/work/other", commonDir: "/work/other/.git" };

function setup() {
	const clock = manualClock();
	const watches = fakeWatches();
	const changes: string[] = [];
	const warnings: string[] = [];
	const watcher = createRepositoryWatcher({
		onChange: path => changes.push(path),
		watchDirectory: watches.watchDirectory,
		schedule: clock.schedule,
		warn: message => warnings.push(message),
	});
	return { clock, watches, changes, warnings, watcher };
}

describe("createRepositoryWatcher with stand-in watches", () => {
	test("watches the common Git directory alone, refs and worktrees recursively, and never a working tree", () => {
		const { watches, watcher } = setup();
		watcher.sync([REPO]);
		expect(watches.folders()).toEqual(["/work/sample/.git", "/work/sample/.git/refs", "/work/sample/.git/reftable", "/work/sample/.git/worktrees"]);
		expect(watches.recursive("/work/sample/.git")).toBe(false);
		expect(watches.recursive("/work/sample/.git/refs")).toBe(true);
		expect(watches.recursive("/work/sample/.git/worktrees")).toBe(true);
		expect(watches.recursive("/work/sample/.git/reftable")).toBe(false);
	});

	test("reports once nothing more happened for a moment", () => {
		const { clock, watches, changes, watcher } = setup();
		watcher.sync([REPO]);
		watches.fire("/work/sample/.git/refs", "heads/main");
		clock.advance(200);
		watches.fire("/work/sample/.git", "HEAD");
		clock.advance(299);
		expect(changes).toEqual([]);
		clock.advance(1);
		expect(changes).toEqual(["/work/sample"]);
		clock.advance(5000);
		expect(changes).toEqual(["/work/sample"]);
	});

	test("turns a long burst into one report every two seconds, not one per event", () => {
		const { clock, watches, changes, watcher } = setup();
		watcher.sync([REPO]);
		// A rebase of many commits: an event every 50 ms for five seconds.
		for (let elapsed = 0; elapsed < 5000; elapsed += 50) {
			watches.fire("/work/sample/.git/refs", "heads/feat");
			watches.fire("/work/sample/.git", "HEAD");
			clock.advance(50);
		}
		clock.advance(300);
		expect(changes.length).toBe(3);
	});

	test("ignores events that cannot change what the app shows", () => {
		const { clock, watches, changes, watcher } = setup();
		watcher.sync([REPO]);
		watches.fire("/work/sample/.git", "index.lock");
		watches.fire("/work/sample/.git", "COMMIT_EDITMSG");
		watches.fire("/work/sample/.git/refs", "heads/main.lock");
		watches.fire("/work/sample/.git/worktrees", "feat/logs/HEAD");
		clock.advance(5000);
		expect(changes).toEqual([]);
	});

	test("reports each repository on its own", () => {
		const { clock, watches, changes, watcher } = setup();
		watcher.sync([REPO, OTHER]);
		watches.fire("/work/sample/.git", "HEAD");
		watches.fire("/work/other/.git/worktrees", "feat");
		clock.advance(300);
		expect(changes.sort()).toEqual(["/work/other", "/work/sample"]);
	});

	test("does without folders that are not there, and starts watching them once they are", () => {
		const { clock, watches, changes, warnings, watcher } = setup();
		watches.missing.add("/work/sample/.git/worktrees");
		watches.missing.add("/work/sample/.git/reftable");
		watcher.sync([REPO]);
		expect(watches.folders()).toEqual(["/work/sample/.git", "/work/sample/.git/refs"]);

		// The first linked worktree creates the folder.
		watches.missing.delete("/work/sample/.git/worktrees");
		watches.fire("/work/sample/.git", "worktrees");
		expect(watches.folders()).toContain("/work/sample/.git/worktrees");
		clock.advance(300);
		expect(changes).toEqual(["/work/sample"]);
		expect(warnings).toEqual([]);
	});

	test("starts the worktrees watch again after its folder went away and came back", () => {
		const { clock, watches, changes, watcher } = setup();
		watcher.sync([REPO]);
		// Removing the last linked worktree removes the folder. Its watch says so once, without a name.
		watches.missing.add("/work/sample/.git/worktrees");
		watches.fire("/work/sample/.git/worktrees", null);
		watches.fire("/work/sample/.git", "worktrees");
		expect(watches.folders()).not.toContain("/work/sample/.git/worktrees");
		clock.advance(300);
		expect(changes).toEqual(["/work/sample"]);

		watches.missing.delete("/work/sample/.git/worktrees");
		watches.fire("/work/sample/.git", "worktrees");
		watches.fire("/work/sample/.git/worktrees", "feat-2/HEAD");
		clock.advance(300);
		expect(changes).toEqual(["/work/sample", "/work/sample"]);
	});

	test("starts the common directory's watch again when the repository is cloned again in place", () => {
		const { clock, watches, changes, watcher } = setup();
		watcher.sync([REPO]);
		// The folder itself went: its watch names itself once, and then hears nothing more.
		watches.missing.add("/work/sample/.git");
		watches.fire("/work/sample/.git", ".git");
		expect(watches.folders()).not.toContain("/work/sample/.git");
		clock.advance(300);
		expect(changes).toEqual(["/work/sample"]);

		watches.missing.delete("/work/sample/.git");
		watcher.sync([REPO]);
		watches.fire("/work/sample/.git", "index");
		clock.advance(300);
		expect(changes).toEqual(["/work/sample", "/work/sample"]);
	});

	test("warns once when a watch cannot start, and tries again on the next sync", () => {
		const { watches, warnings, watcher } = setup();
		watches.refused.set("/work/sample/.git/refs", "ENOSPC: System limit for number of file watchers reached");
		watcher.sync([REPO]);
		expect(watches.folders()).not.toContain("/work/sample/.git/refs");
		expect(warnings.length).toBe(1);
		expect(warnings[0]).toContain(join("/work/sample/.git", "refs"));
		expect(warnings[0]).toContain("ENOSPC");

		watches.refused.clear();
		watcher.sync([REPO]);
		expect(watches.folders()).toContain("/work/sample/.git/refs");
		expect(warnings.length).toBe(1);
	});

	test("treats a broken watch as a change, and starts it again on the next sync", () => {
		const { clock, watches, changes, warnings, watcher } = setup();
		watcher.sync([REPO]);
		watches.fail("/work/sample/.git/refs", new Error("watch broke"));
		expect(watches.folders()).not.toContain("/work/sample/.git/refs");
		expect(warnings.length).toBe(1);
		clock.advance(300);
		expect(changes).toEqual(["/work/sample"]);
		watcher.sync([REPO]);
		expect(watches.folders()).toContain("/work/sample/.git/refs");
	});

	test("keeps working watches on sync, stops those of a removed repository, and drops its pending report", () => {
		const { clock, watches, changes, watcher } = setup();
		watcher.sync([REPO, OTHER]);
		const started = watches.started();
		watcher.sync([REPO, OTHER]);
		expect(watches.started()).toBe(started);

		watches.fire("/work/other/.git", "HEAD");
		watcher.sync([REPO]);
		expect(watches.folders().every(folder => folder.startsWith("/work/sample/"))).toBe(true);
		clock.advance(5000);
		expect(changes).toEqual([]);
	});

	test("says which watch hears a repository, none for one it does not watch, and a new one after a watch broke", () => {
		const { watches, watcher } = setup();
		expect(watcher.watching(REPO.path)).toBeNull();
		watcher.sync([REPO]);
		const first = watcher.watching(REPO.path);
		expect(first).not.toBeNull();
		expect(watcher.watching(OTHER.path)).toBeNull();
		// A sync that changes nothing keeps the same watch.
		watcher.sync([REPO]);
		expect(watcher.watching(REPO.path)).toBe(first);

		watches.fail("/work/sample/.git/refs", new Error("watch broke"));
		expect(watcher.watching(REPO.path)).toBeNull();
		watcher.sync([REPO]);
		const second = watcher.watching(REPO.path);
		expect(second).not.toBeNull();
		expect(second).not.toBe(first);

		// Removed from the list and added again: changes in between were not heard.
		watcher.sync([]);
		expect(watcher.watching(REPO.path)).toBeNull();
		watcher.sync([REPO]);
		expect([first, second]).not.toContain(watcher.watching(REPO.path));
	});

	test("hears no repository whose Git directory cannot be watched, or after it stopped", () => {
		const { watches, watcher } = setup();
		watches.missing.add("/work/sample/.git");
		watches.refused.set("/work/other/.git/refs", "ENOSPC: System limit for number of file watchers reached");
		watcher.sync([REPO, OTHER]);
		expect(watcher.watching(REPO.path)).toBeNull();
		expect(watcher.watching(OTHER.path)).toBeNull();
		watches.missing.clear();
		watches.refused.clear();
		watcher.sync([REPO, OTHER]);
		expect(watcher.watching(REPO.path)).not.toBeNull();
		expect(watcher.watching(OTHER.path)).not.toBeNull();
		watcher.stop();
		expect(watcher.watching(REPO.path)).toBeNull();
	});

	test("stop closes everything and reports nothing more", () => {
		const { clock, watches, changes, watcher } = setup();
		watcher.sync([REPO]);
		watches.fire("/work/sample/.git", "HEAD");
		watcher.stop();
		expect(watches.folders()).toEqual([]);
		clock.advance(5000);
		expect(changes).toEqual([]);
		expect(clock.waiting()).toBe(0);
	});
});

describe("createRepositoryWatcher against a real repository", () => {
	let root: string;
	let primary: string;
	let target: WatchTarget;
	let changes: string[];
	let watcher: ReturnType<typeof createRepositoryWatcher>;

	beforeEach(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-watch-")));
		primary = join(root, "sample");
		git(root, "init", "--initial-branch=main", primary);
		writeFileSync(join(primary, "a.txt"), "one\n");
		git(primary, "add", "a.txt");
		git(primary, "commit", "-m", "First");
		target = { path: primary, commonDir: join(primary, ".git") };
		changes = [];
		// Short waits, so the test is quick. The grouping itself is tested above.
		watcher = createRepositoryWatcher({ onChange: path => changes.push(path), quietMilliseconds: 50, mostMilliseconds: 500 });
		watcher.sync([target]);
	});

	afterEach(() => {
		// An open watch keeps the test process alive.
		watcher.stop();
		rmSync(root, { recursive: true, force: true });
	});

	/** Wait until no report came for a while, so a late one from an earlier step is not counted for the next. */
	async function quiet(): Promise<void> {
		let seen = -1;
		while (seen !== changes.length) {
			seen = changes.length;
			await Bun.sleep(150);
		}
	}

	/** Run `act`, then wait for a report and for things to settle. */
	async function reportsAfter(act: () => void): Promise<number> {
		await quiet();
		changes.length = 0;
		act();
		await until(() => changes.length > 0, 3000);
		await quiet();
		return changes.length;
	}

	test("reports a commit, a new branch in a folder, and a checkout", async () => {
		expect(await reportsAfter(() => {
			writeFileSync(join(primary, "a.txt"), "two\n");
			git(primary, "commit", "-am", "Second");
		})).toBeGreaterThan(0);
		expect(await reportsAfter(() => git(primary, "branch", "feat/deep/name"))).toBeGreaterThan(0);
		expect(await reportsAfter(() => git(primary, "checkout", "-q", "feat/deep/name"))).toBeGreaterThan(0);
		expect(changes.every(path => path === primary)).toBe(true);
	});

	test("reports adding and removing linked worktrees, and a checkout inside one", async () => {
		const linked = join(root, "sample-worktrees", "feat");
		expect(await reportsAfter(() => git(primary, "worktree", "add", "-q", "-b", "feat", linked))).toBeGreaterThan(0);
		expect(await reportsAfter(() => git(linked, "checkout", "-q", "--detach"))).toBeGreaterThan(0);
		expect(await reportsAfter(() => git(primary, "worktree", "remove", linked))).toBeGreaterThan(0);
		// The `worktrees` folder went with the last worktree. A new one is still heard.
		const again = join(root, "sample-worktrees", "again");
		expect(await reportsAfter(() => git(primary, "worktree", "add", "-q", "-b", "again", again))).toBeGreaterThan(0);
	});

	test("hears nothing from editing files or from the app's own status check", async () => {
		await quiet();
		changes.length = 0;
		writeFileSync(join(primary, "new.txt"), "new\n");
		// Same content, newer time: a status that may refresh the index would rewrite it here, and wake the watcher.
		utimesSync(join(primary, "a.txt"), new Date(), new Date(Date.now() + 10_000));
		const read = createWorktreeStamps({ targets: () => [target] });
		expect(await read({ repository: primary, worktree: primary })).not.toBeNull();
		await read({ repository: primary, worktree: primary });
		await Bun.sleep(300);
		expect(changes).toEqual([]);
	});

	test("hears the repository again after it was removed and made again in place", async () => {
		await quiet();
		rmSync(primary, { recursive: true, force: true });
		git(root, "init", "--initial-branch=main", primary);
		writeFileSync(join(primary, "b.txt"), "b\n");
		await quiet();
		watcher.sync([target]);
		// Only the index changes, which the common directory's own watch hears.
		expect(await reportsAfter(() => git(primary, "add", "b.txt"))).toBeGreaterThan(0);
	});
});
