import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSavedPreferences } from "../src/bun/preferences";
import { createRepositoryList } from "../src/bun/repository-list";
import { createRepositoryReader } from "../src/bun/repository-reader";
import { type SettingsHolder, createSettingsHolder, writeSettings } from "../src/bun/settings";
import { createSidebarTags } from "../src/bun/sidebar-tags";
import type { Repository } from "../src/shared/model";
import { parseSettings } from "../src/shared/settings";
import { type SidebarTags, WORK_TAG_ID, worktreeTagId } from "../src/shared/worktree-tags";
import { REAL_TIMBER_TIMEOUT_MS, fingerprint, git, isolatedEnvironment, makeRepository, ready, realTimber } from "./support/timber";

let root: string;
let primary: string;
let other: string;
let settingsFile: string;
let holder: SettingsHolder;
let cases = 0;

beforeAll(() => {
	// Git reports real paths, so resolve the temporary folder once (it is a link on macOS).
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-tags-")));
	primary = makeRepository(root, "shop");
	other = makeRepository(root, "notes");
	git(primary, "worktree", "add", "-b", "feat/a", join(root, "shop-worktrees", "feat-a"));
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

beforeEach(async () => {
	settingsFile = join(root, `config-${cases++}`, "timber-app", "settings.json");
	await writeSettings(settingsFile, {
		repositories: [primary, other].map(path => ({ path, commonDir: join(path, ".git") })),
		groups: [{ id: "g-1", name: "Clients" }],
	});
	holder = createSettingsHolder(settingsFile, () => {});
});

const saved = () => parseSettings(readFileSync(settingsFile, "utf8"))!;
const treeA = () => join(root, "shop-worktrees", "feat-a");
/** A listing of the primary checkout that worked, naming these worktrees. */
const listing = (path: string, worktrees: string[], failure: string | null = null): Repository => ({
	path, name: "shop", available: true, failure, setup: "repository", fallbackBase: null,
	worktrees: worktrees.map(worktree => ({ path: worktree }) as Repository["worktrees"][number]),
});

describe("worktree tags in the settings file", () => {
	test("start empty: every worktree is Work and no header has a color", async () => {
		const tags = await createSidebarTags(holder, {}).list();
		expect(tags).toEqual({ worktrees: {}, repositories: {}, groups: {} });
		expect(worktreeTagId(tags, primary, treeA())).toBe(WORK_TAG_ID);
	});

	test("a tag is saved beside its repository, and Work takes it away, with nothing in the repository touched", async () => {
		const before = fingerprint(primary);
		const store = createSidebarTags(holder, {});
		const set = await store.setWorktreeTag({ repository: primary, worktree: treeA(), tag: "review" });
		expect(set).toEqual({ outcome: "saved", tags: { worktrees: { [primary]: { [treeA()]: "review" } }, repositories: {}, groups: {} } });
		expect(saved().repositories[0]!.worktreeTags).toEqual({ [treeA()]: "review" });
		// Read again from the file, as after a restart.
		expect(await createSidebarTags(createSettingsHolder(settingsFile, () => {}), {}).list()).toEqual((set as { tags: SidebarTags }).tags);
		expect((await store.setWorktreeTag({ repository: primary, worktree: treeA(), tag: WORK_TAG_ID })).outcome).toBe("saved");
		expect(saved().repositories[0]!.worktreeTags).toBeUndefined();
		expect(fingerprint(primary)).toBe(before);
	});

	test("a tag that is not saved, or a repository not in the list, saves nothing", async () => {
		const store = createSidebarTags(holder, {});
		expect(await store.setWorktreeTag({ repository: primary, worktree: treeA(), tag: "tag-9" })).toEqual({ outcome: "unknown" });
		expect(await store.setWorktreeTag({ repository: join(root, "elsewhere"), worktree: treeA(), tag: "review" })).toEqual({ outcome: "unknown" });
		expect((await store.setWorktreeTag({ repository: primary, worktree: "relative/path", tag: "review" })).outcome).toBe("failed");
		expect(saved().repositories.every(entry => entry.worktreeTags === undefined)).toBe(true);
	});

	test("a header's color is saved beside its repository or group, and null takes it away", async () => {
		const store = createSidebarTags(holder, {});
		expect(await store.setHeaderColor({ kind: "repository", path: other }, 4)).toEqual({ outcome: "saved", tags: { worktrees: {}, repositories: { [other]: 4 }, groups: {} } });
		expect((await store.setHeaderColor({ kind: "group", id: "g-1" }, 2)).outcome).toBe("saved");
		expect(saved().repositories[1]!.color).toBe(4);
		expect(saved().groups).toEqual([{ id: "g-1", name: "Clients", color: 2 }]);
		expect((await store.setHeaderColor({ kind: "group", id: "g-1" }, null)).outcome).toBe("saved");
		expect(saved().groups).toEqual([{ id: "g-1", name: "Clients" }]);
		expect(await store.setHeaderColor({ kind: "group", id: "g-9" }, 1)).toEqual({ outcome: "unknown" });
		expect((await store.setHeaderColor({ kind: "group", id: "g-1" }, 6 as 1)).outcome).toBe("failed");
	});

	test("removing a tag in Settings moves its worktrees back to Work in the same save", async () => {
		const store = createSidebarTags(holder, {});
		const preferences = createSavedPreferences(holder, {});
		expect((await preferences.save({ tags: [{ id: "work", name: "Work", color: 1 }, { id: "review", name: "Review", color: 2 }, { id: "tag-1", name: "Bots", color: 5 }] })).outcome).toBe("saved");
		await store.setWorktreeTag({ repository: primary, worktree: treeA(), tag: "tag-1" });
		await store.setWorktreeTag({ repository: primary, worktree: join(root, "shop-worktrees", "feat-b"), tag: "review" });
		expect((await preferences.save({ tags: [{ id: "work", name: "Work", color: 1 }, { id: "review", name: "Reviews", color: 3 }] })).outcome).toBe("saved");
		expect(saved().repositories[0]!.worktreeTags).toEqual({ [join(root, "shop-worktrees", "feat-b")]: "review" });
	});

	test("a listing that no longer names a worktree drops its tag, but only a listing that worked, and never a tag set while it ran", async () => {
		const store = createSidebarTags(holder, {});
		const gone = join(root, "shop-worktrees", "gone");
		await store.setWorktreeTag({ repository: primary, worktree: treeA(), tag: "review" });
		await store.setWorktreeTag({ repository: primary, worktree: gone, tag: "review" });
		// A failed listing names nothing, and drops nothing.
		await store.forgetRemoved([listing(primary, [], "Timber could not list")], store.mark());
		expect(Object.keys(saved().repositories[0]!.worktreeTags!)).toHaveLength(2);
		// A listing that started before a new worktree was tagged keeps that tag.
		const mark = store.mark();
		const fresh = join(root, "shop-worktrees", "fresh");
		await store.setWorktreeTag({ repository: primary, worktree: fresh, tag: "review" });
		await store.forgetRemoved([listing(primary, [primary, treeA()])], mark);
		expect(saved().repositories[0]!.worktreeTags).toEqual({ [treeA()]: "review", [fresh]: "review" });
		// The next listing does not name it either: it is gone.
		await store.forgetRemoved([listing(primary, [primary, treeA()])], store.mark());
		expect(saved().repositories[0]!.worktreeTags).toEqual({ [treeA()]: "review" });
	});

	test("nothing is listed or saved while the development override is set", async () => {
		const store = createSidebarTags(holder, { TIMBER_APP_REPOS: primary });
		expect(await store.setWorktreeTag({ repository: primary, worktree: treeA(), tag: "review" })).toEqual({ outcome: "overridden" });
		expect(await store.setHeaderColor({ kind: "repository", path: primary }, 1)).toEqual({ outcome: "overridden" });
		expect(await store.list()).toEqual({ worktrees: {}, repositories: {}, groups: {} });
	});
});

describe.skipIf(realTimber === null)("with the installed Timber, on a real repository", () => {
	test("a worktree made with timber new outside the app is Work; removed and made again at its path, it is Work again; Timber's metadata is never written", async () => {
		const work = realpathSync(mkdtempSync(join(root, "timber-")));
		const repository = makeRepository(work, "app");
		const environment = isolatedEnvironment(work);
		const timberNew = () => {
			const ran = Bun.spawnSync([realTimber!, "new", "--no-editor", "--no-agent", "--no-setup", "--base", "main", "--", "feat/x"], { cwd: repository, env: environment, stdout: "pipe", stderr: "pipe" });
			expect(ran.exitCode).toBe(0);
		};
		const file = join(work, "config", "timber-app", "settings.json");
		await writeSettings(file, { repositories: [{ path: repository, commonDir: join(repository, ".git") }] });
		const shared = createSettingsHolder(file, () => {});
		const list = createRepositoryList({ settingsFile: file, settings: shared, pickFolder: async () => null, reader: createRepositoryReader(async () => ready(realTimber!), environment), environment: {}, warn: () => {} });
		const store = createSidebarTags(shared, {});
		const read = async () => {
			const mark = store.mark();
			const listed = await list.list();
			await store.forgetRemoved(listed, mark);
			return listed[0]!;
		};

		timberNew();
		const made = (await read()).worktrees.find(worktree => !worktree.primary)!;
		expect(worktreeTagId(await store.list(), repository, made.path)).toBe(WORK_TAG_ID);
		const metadata = fingerprint(join(repository, ".git", "worktrees"));
		await store.setWorktreeTag({ repository, worktree: made.path, tag: "review" });
		await read();
		expect(worktreeTagId(await store.list(), repository, made.path)).toBe("review");
		expect(fingerprint(join(repository, ".git", "worktrees"))).toBe(metadata);

		// Removed outside the app, then made again at the same path.
		git(repository, "worktree", "remove", made.path);
		git(repository, "branch", "-D", "feat/x");
		await read();
		timberNew();
		const again = (await read()).worktrees.find(worktree => !worktree.primary)!;
		expect(again.path).toBe(made.path);
		expect(worktreeTagId(await store.list(), repository, again.path)).toBe(WORK_TAG_ID);
	}, REAL_TIMBER_TIMEOUT_MS * 2);
});
