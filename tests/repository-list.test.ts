import { afterAll, beforeAll, beforeEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { type RepositoryListOptions, createRepositoryList } from "../src/bun/repository-list";
import { type RepositoryReader, createRepositoryReader } from "../src/bun/repository-reader";
import { type Settings, parseSettings, serializeSettings } from "../src/shared/settings";
import { REAL_TIMBER_TIMEOUT_MS, fingerprint, git, makeRepository, realTimber, recorded, standInTimber } from "./support/timber";

setDefaultTimeout(REAL_TIMBER_TIMEOUT_MS);

let root: string;
let primary: string;
let linked: string;
let other: string;
let plain: string;
let settingsFile: string;
let cases = 0;

beforeAll(() => {
	// Git reports real paths, so resolve the temporary folder once (it is a link on macOS).
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-list-")));
	primary = join(root, "sample");
	linked = join(root, "sample-worktrees", "feat-x");
	other = join(root, "other");
	plain = join(root, "plain");
	makeRepository(root, "sample");
	git(primary, "worktree", "add", "-b", "feat/x", linked);
	writeFileSync(join(linked, "tracked.txt"), "two\n");
	writeFileSync(join(linked, "new.txt"), "new\n");
	mkdirSync(join(primary, "nested", "deep"), { recursive: true });
	makeRepository(root, "other");
	mkdirSync(plain);
	writeFileSync(join(plain, "notes.txt"), "not a repository\n");
});

beforeEach(() => {
	settingsFile = join(root, `config-${cases++}`, "timber-app", "settings.json");
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

/** Reads repositories with the Timber installed on this machine. */
const reader = createRepositoryReader(async () => ({ state: "ready", source: "path", path: realTimber!, version: "0.1.1" }));

/** A list on this test's settings file. */
function listOn(overrides: Partial<RepositoryListOptions> = {}) {
	return createRepositoryList({
		settingsFile,
		pickFolder: async () => null,
		reader,
		environment: {},
		warn: () => {},
		...overrides,
	});
}

const names = async (list: { list(): Promise<{ name: string }[]> }) => (await list.list()).map(repository => repository.name);

describe.skipIf(realTimber === null)("adding", () => {
	test("a repository appears in the list and is still there after a restart", async () => {
		const first = listOn({ pickFolder: async () => primary });
		expect(await first.list()).toEqual([]);

		const result = await first.add();
		expect(result).toMatchObject({ outcome: "added", repository: { path: primary, name: "sample", available: true } });
		expect(await names(first)).toEqual(["sample"]);

		// A new list on the same file is what a restarted app has.
		const restarted = listOn();
		const [repository] = await restarted.list();
		expect(repository).toMatchObject({ path: primary, name: "sample", available: true });
		expect(repository?.worktrees.map(worktree => worktree.branch)).toEqual(["main", "feat/x"]);
	});

	test("a linked worktree adds the repository it belongs to", async () => {
		const list = listOn();
		expect(await list.addFolder(linked)).toMatchObject({ outcome: "added", repository: { path: primary } });
		expect((await listOn().list()).map(repository => repository.path)).toEqual([primary]);
	});

	test("the same repository twice, by any of its folders, makes one entry", async () => {
		const list = listOn();
		expect((await list.addFolder(primary)).outcome).toBe("added");
		const again = { outcome: "already-listed", repository: primary } as const;
		expect(await list.addFolder(primary)).toEqual(again);
		expect(await list.addFolder(linked)).toEqual(again);
		expect(await list.addFolder(join(primary, "nested", "deep"))).toEqual(again);
		expect(await list.addFolder(`${primary}/`)).toEqual(again);
		expect(await names(list)).toEqual(["sample"]);
		expect(await names(listOn())).toEqual(["sample"]);
		expect(JSON.parse(readFileSync(settingsFile, "utf8")).repositories.length).toBe(1);
	});

	// Skipped on Windows, which makes symbolic links only in Developer Mode or for an administrator.
	test.skipIf(process.platform === "win32")("a link to a repository is the same repository", async () => {
		const link = join(root, `link-${cases}`);
		symlinkSync(linked, link);
		const list = listOn();
		expect((await list.addFolder(link)).outcome).toBe("added");
		expect(await list.addFolder(primary)).toEqual({ outcome: "already-listed", repository: primary });
		rmSync(link);
	});

	test("the worktree first, then the primary checkout, is still one entry", async () => {
		const list = listOn();
		await list.addFolder(linked);
		expect(await list.addFolder(primary)).toEqual({ outcome: "already-listed", repository: primary });
	});

	test("adds at the same moment make one entry", async () => {
		const list = listOn();
		const results = await Promise.all([list.addFolder(primary), list.addFolder(linked), list.addFolder(primary)]);
		expect(results.map(result => result.outcome).sort()).toEqual(["added", "already-listed", "already-listed"]);
		expect(await names(listOn())).toEqual(["sample"]);
	});

	test("keeps repositories in the order they were added", async () => {
		const list = listOn();
		await list.addFolder(other);
		await list.addFolder(linked);
		expect(await names(listOn())).toEqual(["other", "sample"]);
	});

	test("a folder that is not a Git repository is refused and nothing is saved", async () => {
		const list = listOn({ pickFolder: async () => plain });
		expect(await list.add()).toEqual({ outcome: "not-a-repository", folder: plain });
		expect(await list.addFolder(join(root, "does-not-exist"))).toEqual({ outcome: "not-a-repository", folder: join(root, "does-not-exist") });
		expect(await list.list()).toEqual([]);
		expect(existsSync(settingsFile)).toBe(false);
	});

	test("a closed picker adds nothing, and a picker that fails is reported", async () => {
		expect(await listOn({ pickFolder: async () => null }).add()).toEqual({ outcome: "cancelled" });
		const broken = listOn({ pickFolder: async () => { throw new Error("no display"); } });
		expect(await broken.add()).toEqual({ outcome: "failed", message: "Could not open the folder picker: no display" });
		expect(existsSync(settingsFile)).toBe(false);
	});

	test("a save that fails is reported, and the list stays as it was", async () => {
		// The settings folder cannot be created, because a file is in its place.
		mkdirSync(join(settingsFile, "..", ".."), { recursive: true });
		writeFileSync(join(settingsFile, ".."), "in the way");
		const list = listOn();
		const result = await list.addFolder(primary);
		expect(result.outcome).toBe("failed");
		expect(result.outcome === "failed" && result.message).toContain("Could not save settings to");
		expect(await list.list()).toEqual([]);
	});

	test("changes nothing in the repository", async () => {
		const before = [fingerprint(primary), fingerprint(linked)];
		const list = listOn();
		await list.addFolder(linked);
		await list.addFolder(primary);
		await list.list();
		expect([fingerprint(primary), fingerprint(linked)]).toEqual(before);
	});
});

describe.skipIf(realTimber === null)("removing", () => {
	test("forgets the repository, for good, and changes nothing on disk", async () => {
		const list = listOn();
		await list.addFolder(primary);
		await list.addFolder(other);
		const before = [fingerprint(primary), fingerprint(linked), fingerprint(other)];

		expect(await list.remove(primary)).toEqual({ outcome: "removed" });
		expect(await names(list)).toEqual(["other"]);
		expect(await names(listOn())).toEqual(["other"]);

		expect([fingerprint(primary), fingerprint(linked), fingerprint(other)]).toEqual(before);
		expect(existsSync(join(primary, ".git"))).toBe(true);
		expect(existsSync(linked)).toBe(true);
	});

	test("is safe to repeat, and a removed repository can be added again", async () => {
		const list = listOn();
		await list.addFolder(primary);
		expect(await list.remove(primary)).toEqual({ outcome: "removed" });
		expect(await list.remove(primary)).toEqual({ outcome: "removed" });
		expect(await list.remove("/never/listed")).toEqual({ outcome: "removed" });
		expect(await list.list()).toEqual([]);
		expect((await list.addFolder(linked)).outcome).toBe("added");
		expect(await names(listOn())).toEqual(["sample"]);
	});
});

describe.skipIf(realTimber === null)("reordering", () => {
	test("saves the new order, which a restart keeps, and changes nothing on disk", async () => {
		const list = listOn();
		await list.addFolder(primary);
		await list.addFolder(other);
		const before = [fingerprint(primary), fingerprint(linked), fingerprint(other)];

		expect(await list.reorder([other, primary])).toEqual({ outcome: "saved" });
		expect(await names(list)).toEqual(["other", "sample"]);
		expect(await names(listOn())).toEqual(["other", "sample"]);
		expect((await list.watchTargets()).map(target => target.path)).toEqual([other, primary]);

		expect([fingerprint(primary), fingerprint(linked), fingerprint(other)]).toEqual(before);
	});

	test("keeps a repository the order leaves out, and skips a path that is not listed", async () => {
		const list = listOn();
		await list.addFolder(primary);
		await list.addFolder(other);
		expect(await list.reorder(["/never/listed", other])).toEqual({ outcome: "saved" });
		expect(await names(listOn())).toEqual(["other", "sample"]);
		expect(await list.reorder([])).toEqual({ outcome: "saved" });
		expect(await names(listOn())).toEqual(["other", "sample"]);
	});

	test("an order that changes nothing writes nothing", async () => {
		const list = listOn();
		await list.addFolder(primary);
		await list.addFolder(other);
		const saved = statSync(settingsFile).mtimeMs;
		const text = readFileSync(settingsFile, "utf8");
		expect(await list.reorder([primary, other])).toEqual({ outcome: "saved" });
		expect(readFileSync(settingsFile, "utf8")).toBe(text);
		expect(statSync(settingsFile).mtimeMs).toBe(saved);
	});

	test("a save that fails is reported, and the order stays as it was", async () => {
		const list = listOn();
		await list.addFolder(primary);
		await list.addFolder(other);
		// The settings folder can no longer be written, because a file is in its place.
		const folder = join(settingsFile, "..");
		renameSync(folder, `${folder}-moved`);
		writeFileSync(folder, "in the way");
		const result = await list.reorder([other, primary]);
		expect(result.outcome).toBe("failed");
		expect(result.outcome === "failed" && result.message).toContain("Could not save settings to");
		expect(await names(list)).toEqual(["sample", "other"]);
	});
});

describe.skipIf(realTimber === null)("a saved repository whose folder is missing", () => {
	test("stays in the list, marked unavailable, comes back with its folder, and can be removed", async () => {
		const moving = makeRepository(root, `moving-${cases}`);
		const away = `${moving}-away`;
		const list = listOn();
		await list.addFolder(other);
		await list.addFolder(moving);

		renameSync(moving, away);
		const unavailable = { path: moving, name: `moving-${cases}`, available: false, failure: null, setup: "unknown" as const, worktrees: [] };
		expect(await list.list()).toMatchObject([{ name: "other", available: true }, unavailable]);
		// After a restart too, and listing it did not create the folder or drop the entry.
		expect((await listOn().list())[1]).toEqual(unavailable);
		expect(existsSync(moving)).toBe(false);
		expect(JSON.parse(readFileSync(settingsFile, "utf8")).repositories.length).toBe(2);

		renameSync(away, moving);
		expect((await list.list())[1]).toMatchObject({ path: moving, available: true });

		renameSync(moving, away);
		expect(await list.remove(moving)).toEqual({ outcome: "removed" });
		expect(await names(listOn())).toEqual(["other"]);
		expect(existsSync(join(away, "tracked.txt"))).toBe(true);
	});

	test("a folder that is no longer a repository is unavailable as well", async () => {
		const list = listOn();
		await list.addFolder(primary);
		writeFileSync(settingsFile, readFileSync(settingsFile, "utf8").replaceAll(JSON.stringify(primary).slice(1, -1), JSON.stringify(plain).slice(1, -1)));
		expect(await listOn().list()).toEqual([{ path: plain, name: "plain", available: false, failure: null, setup: "unknown" as const, worktrees: [] }]);
	});
});

describe.skipIf(realTimber === null)("a damaged settings file", () => {
	test("does not stop the list from working, and is kept as a copy", async () => {
		mkdirSync(join(settingsFile, ".."), { recursive: true });
		writeFileSync(settingsFile, '{"version":1,"repositories":[{"path":"/work/tim');
		const warnings: string[] = [];
		const list = listOn({ warn: message => warnings.push(message) });

		expect(await list.list()).toEqual([]);
		expect(warnings.length).toBe(1);
		expect((await list.addFolder(primary)).outcome).toBe("added");
		expect(await names(listOn())).toEqual(["sample"]);
		expect(readFileSync(`${settingsFile}.damaged`, "utf8")).toBe('{"version":1,"repositories":[{"path":"/work/tim');
	});
});

describe.skipIf(realTimber === null)("finding a repository of the list", () => {
	test("answers only for a primary checkout that is in the list", async () => {
		const list = listOn();
		await list.addFolder(linked);
		expect(await list.find(primary)).toMatchObject({ path: primary, available: true, failure: null });
		expect((await list.find(primary))?.worktrees.map(worktree => worktree.path)).toEqual([primary, linked]);
		// A repository that is on disk but not in the list, one of the listed repository's worktrees, and a plain folder.
		expect(await list.find(other)).toBeNull();
		expect(await list.find(linked)).toBeNull();
		expect(await list.find(plain)).toBeNull();
		expect(await list.find(`${primary}/`)).toBeNull();
	});

	test("a listed repository whose folder is gone is found as unavailable", async () => {
		const gone = makeRepository(root, `gone-${cases}`);
		const list = listOn();
		await list.addFolder(gone);
		rmSync(gone, { recursive: true });
		expect(await list.find(gone)).toEqual({ path: gone, name: `gone-${cases}`, available: false, failure: null, setup: "unknown" as const, worktrees: [] });
	});

	test("with the override, only the repositories it names are found", async () => {
		await listOn().addFolder(other);
		const overridden = listOn({ environment: { TIMBER_APP_REPOS: linked } });
		expect(await overridden.find(primary)).toMatchObject({ path: primary });
		expect(await overridden.find(other)).toBeNull();
	});

	test("finding changes nothing", async () => {
		const list = listOn();
		await list.addFolder(primary);
		const before = [fingerprint(primary), fingerprint(linked), readFileSync(settingsFile, "utf8")];
		await list.find(primary);
		await list.find(other);
		expect([fingerprint(primary), fingerprint(linked), readFileSync(settingsFile, "utf8")]).toEqual(before);
	});
});

describe.skipIf(realTimber === null)("the TIMBER_APP_REPOS override", () => {
	test("replaces the saved list without changing it, and refuses add, remove, and reorder", async () => {
		await listOn().addFolder(other);
		const savedText = readFileSync(settingsFile, "utf8");

		const environment = { TIMBER_APP_REPOS: [linked, plain].join(delimiter) };
		const overridden = listOn({ environment, pickFolder: async () => { throw new Error("the picker must not open"); } });
		expect(await names(overridden)).toEqual(["sample"]);
		expect(await overridden.add()).toEqual({ outcome: "overridden" });
		expect(await overridden.addFolder(primary)).toEqual({ outcome: "overridden" });
		expect(await overridden.remove(primary)).toEqual({ outcome: "overridden" });
		expect(await overridden.reorder([primary])).toEqual({ outcome: "overridden" });
		expect(readFileSync(settingsFile, "utf8")).toBe(savedText);

		// Without the override the saved list is back.
		expect(await names(listOn())).toEqual(["other"]);
	});
});

describe.skipIf(realTimber === null)("includes", () => {
	test("is true only for the primary checkout of a listed repository", async () => {
		const list = listOn();
		expect(await list.includes(primary)).toBe(false);
		await list.addFolder(linked);
		expect(await list.includes(primary)).toBe(true);
		// A worktree, another repository, and a plain folder are not places to run a command in.
		expect(await list.includes(linked)).toBe(false);
		expect(await list.includes(other)).toBe(false);
		expect(await list.includes(plain)).toBe(false);
		await list.remove(primary);
		expect(await list.includes(primary)).toBe(false);
	});

	test("follows the override, by the repositories it resolves to", async () => {
		await listOn().addFolder(other);
		const overridden = listOn({ environment: { TIMBER_APP_REPOS: [linked, plain].join(delimiter) } });
		expect(await overridden.includes(primary)).toBe(true);
		expect(await overridden.includes(other)).toBe(false);
	});
});

describe("when Timber cannot list the worktrees", () => {
	const failing = () => createRepositoryReader(async () => ({ state: "ready", source: "path", path: standInTimber(root, "failing-timber", recorded.failed, 1).path, version: "0.1.1" }));
	const diagnostic = "Not a Git repository: /work/plain";

	test("adding reports the diagnostic and saves nothing", async () => {
		const list = listOn({ reader: failing() });
		expect(await list.addFolder(primary)).toEqual({ outcome: "failed", message: diagnostic });
		expect(await list.list()).toEqual([]);
		expect(existsSync(settingsFile)).toBe(false);
	});

	test("a folder outside any repository is still refused as not a repository", async () => {
		expect(await listOn({ reader: failing() }).addFolder(plain)).toEqual({ outcome: "not-a-repository", folder: plain });
	});

	test("a saved repository stays listed, with the diagnostic and no worktrees", async () => {
		mkdirSync(join(settingsFile, ".."), { recursive: true });
		writeFileSync(settingsFile, JSON.stringify({ version: 1, repositories: [{ path: primary, commonDir: realpathSync(join(primary, ".git")) }] }));
		const failed = { path: primary, name: "sample", available: true, failure: diagnostic, setup: "unknown" as const, worktrees: [] };
		const list = listOn({ reader: failing() });
		expect(await list.list()).toEqual([failed]);
		expect(await list.reload(primary)).toEqual(failed);
		// The saved list is untouched, so the repository is back as soon as Timber answers.
		expect(JSON.parse(readFileSync(settingsFile, "utf8")).repositories.length).toBe(1);
	});

	test("the override lists a repository that Timber fails on by the folder it was given", async () => {
		const overridden = listOn({ reader: failing(), environment: { TIMBER_APP_REPOS: [linked, plain, linked].join(delimiter) } });
		expect(await overridden.list()).toEqual([{ path: linked, name: "feat-x", available: true, failure: diagnostic, setup: "unknown" as const, worktrees: [] }]);
	});
});

describe.skipIf(realTimber === null)("finding for a read-only view", () => {
	test("answers through the reader's recent listing, and only for a repository in the list", async () => {
		await listOn().addFolder(linked);
		const asked: string[] = [];
		const recentReader = {
			...reader,
			recent: async (path: string) => {
				asked.push(path);
				return { path, name: "recent", available: true, failure: null, setup: "unknown" as const, worktrees: [] };
			},
		};
		const list = listOn({ reader: recentReader });
		expect((await list.findRecent(primary))?.name).toBe("recent");
		expect(await list.findRecent(plain)).toBeNull();
		expect(asked).toEqual([primary]);
	});
});

describe.skipIf(realTimber === null)("the repositories to watch", () => {
	test("are the saved ones, each with its common Git directory, without asking Timber", async () => {
		const list = listOn();
		expect(await list.watchTargets()).toEqual([]);
		await list.addFolder(linked);
		await list.addFolder(other);
		const before = fingerprint(primary);
		expect(await listOn({ reader: { find: async () => { throw new Error("Timber was asked"); }, reload: async () => { throw new Error("Timber was asked"); } } }).watchTargets()).toEqual([
			{ path: primary, commonDir: join(primary, ".git") },
			{ path: other, commonDir: join(other, ".git") },
		]);
		expect(fingerprint(primary)).toBe(before);
	});

	test("with the override, are the repositories it lists, each once", async () => {
		const environment = { TIMBER_APP_REPOS: [linked, primary, plain].join(delimiter) };
		expect(await listOn({ environment }).watchTargets()).toEqual([{ path: primary, commonDir: join(primary, ".git") }]);
	});
});

describe("groups", () => {
	// Grouping never asks Git or Timber anything, so these lists have a reader that refuses.
	const refusing: RepositoryReader = {
		find: async () => { throw new Error("Timber was asked"); },
		reload: async () => { throw new Error("Timber was asked"); },
	};
	const one = { path: "/work/timber", commonDir: "/work/timber/.git" };
	const two = { path: "/work/api-server", commonDir: "/work/api-server/.git" };
	const three = { path: "/work/docs-site", commonDir: "/work/docs-site/.git" };

	function savedWith(settings: Settings) {
		mkdirSync(join(settingsFile, ".."), { recursive: true });
		writeFileSync(settingsFile, serializeSettings(settings));
	}
	const groupsOn = (overrides: Partial<RepositoryListOptions> = {}) => listOn({ reader: refusing, ...overrides });
	const onDisk = () => parseSettings(readFileSync(settingsFile, "utf8"))!;

	test("making a group saves it, and a restart still has it", async () => {
		savedWith({ repositories: [one, two] });
		const list = groupsOn();
		expect(await list.listGroups()).toEqual({ groups: [], membership: {} });
		const result = await list.createGroup("  Work  ");
		expect(result.outcome).toBe("saved");
		const id = onDisk().groups![0]!.id;
		expect(result).toEqual({ outcome: "saved", groups: { groups: [{ id, name: "Work" }], membership: {} } });
		expect(onDisk()).toEqual({ repositories: [one, two], groups: [{ id, name: "Work" }] });
		// A new holder on the same file is what a restarted app has.
		expect(await groupsOn().listGroups()).toEqual({ groups: [{ id, name: "Work" }], membership: {} });
	});

	test("making a group with a repository puts it in, at the end of the shown order", async () => {
		savedWith({ repositories: [one, two, three] });
		const result = await groupsOn().createGroup("Work", two.path);
		const id = onDisk().groups![0]!.id;
		expect(result).toEqual({ outcome: "saved", groups: { groups: [{ id, name: "Work" }], membership: { [two.path]: id } } });
		expect(onDisk().repositories).toEqual([one, three, { ...two, group: id }]);
	});

	test("making a group with a repository that is not listed still makes the group", async () => {
		savedWith({ repositories: [one] });
		const result = await groupsOn().createGroup("Work", "/never/listed");
		expect(result.outcome === "saved" && result.groups.groups.map(group => group.name)).toEqual(["Work"]);
		expect(onDisk().repositories).toEqual([one]);
	});

	test("an empty name or a name already taken, ignoring case, saves nothing", async () => {
		savedWith({ repositories: [one], groups: [{ id: "g1", name: "Work" }] });
		const text = readFileSync(settingsFile, "utf8");
		const list = groupsOn();
		expect(await list.createGroup("   ")).toEqual({ outcome: "name-empty" });
		expect(await list.createGroup(" work ")).toEqual({ outcome: "name-taken", name: "Work" });
		expect(readFileSync(settingsFile, "utf8")).toBe(text);
	});

	test("renaming saves the new name, refuses a taken one, and keeps the same one without writing", async () => {
		savedWith({ repositories: [one], groups: [{ id: "g1", name: "Work" }, { id: "g2", name: "Personal" }] });
		const list = groupsOn();
		expect(await list.renameGroup("g1", "Job")).toEqual({ outcome: "saved", groups: { groups: [{ id: "g1", name: "Job" }, { id: "g2", name: "Personal" }], membership: {} } });
		expect(onDisk().groups).toEqual([{ id: "g1", name: "Job" }, { id: "g2", name: "Personal" }]);
		expect(await list.renameGroup("g1", "PERSONAL")).toEqual({ outcome: "name-taken", name: "Personal" });
		expect(await list.renameGroup("g1", "")).toEqual({ outcome: "name-empty" });
		const text = readFileSync(settingsFile, "utf8");
		const saved = statSync(settingsFile).mtimeMs;
		expect((await list.renameGroup("g1", " Job ")).outcome).toBe("saved");
		expect(readFileSync(settingsFile, "utf8")).toBe(text);
		expect(statSync(settingsFile).mtimeMs).toBe(saved);
		// Only the case changes: that is a new name.
		expect(await list.renameGroup("g1", "job")).toEqual({ outcome: "saved", groups: { groups: [{ id: "g1", name: "job" }, { id: "g2", name: "Personal" }], membership: {} } });
	});

	test("deleting a group keeps its repositories in the list, loose, and forgets that it was folded", async () => {
		const layout = { sidebarWidth: 300, collapsed: [one.path], setupDismissed: [], uncommittedChanges: [], issueLists: {}, collapsedGroups: ["g1", "g2"], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const, diffLayout: "unified" as const };
		savedWith({ repositories: [{ ...one, group: "g1" }, { ...two, group: "g1" }, { ...three, group: "g2" }], groups: [{ id: "g1", name: "Work" }, { id: "g2", name: "Personal" }], layout });
		expect(await groupsOn().deleteGroup("g1")).toEqual({ outcome: "saved", groups: { groups: [{ id: "g2", name: "Personal" }], membership: { [three.path]: "g2" } } });
		expect(onDisk()).toEqual({
			repositories: [one, two, { ...three, group: "g2" }],
			groups: [{ id: "g2", name: "Personal" }],
			layout: { ...layout, collapsedGroups: ["g2"], chopsOpen: false, chopsWidth: 320, sidePanel: "chops" as const },
		});
	});

	test("a repository goes into a group, out of it, and with an order the whole list is saved in that order", async () => {
		savedWith({ repositories: [one, two, three], groups: [{ id: "g1", name: "Work" }] });
		const list = groupsOn();
		expect(await list.place(one.path, "g1")).toEqual({ outcome: "saved", groups: { groups: [{ id: "g1", name: "Work" }], membership: { [one.path]: "g1" } } });
		expect(onDisk().repositories).toEqual([{ ...one, group: "g1" }, two, three]);
		expect(await list.place(one.path, null)).toEqual({ outcome: "saved", groups: { groups: [{ id: "g1", name: "Work" }], membership: {} } });
		expect(onDisk().repositories).toEqual([one, two, three]);
		expect((await list.place(two.path, "g1", [three.path, one.path, two.path])).outcome).toBe("saved");
		expect(onDisk().repositories).toEqual([three, one, { ...two, group: "g1" }]);
		// A restart lists them in that order.
		expect((await groupsOn().watchTargets()).map(target => target.path)).toEqual([three.path, one.path, two.path]);
	});

	test("groups are moved among their siblings, and a restart reads them back", async () => {
		const work = { id: "g1", name: "Work" };
		const personal = { id: "g2", name: "Personal" };
		const spare = { id: "g3", name: "Spare" };
		savedWith({ repositories: [one], groups: [work, personal, spare] });
		const list = groupsOn();
		expect(await list.moveGroup("g3", null, "g1")).toEqual({ outcome: "saved", groups: { groups: [spare, work, personal], membership: {} } });
		expect(onDisk().groups).toEqual([spare, work, personal]);
		expect(await groupsOn().listGroups()).toEqual({ groups: [spare, work, personal], membership: {} });
	});

	test("subgroups are made, moved in and out, and deleted, each in one save that a restart reads back", async () => {
		savedWith({ repositories: [{ ...one, group: "g1" }, two], groups: [{ id: "g1", name: "Work" }, { id: "g2", name: "Personal" }] });
		const list = groupsOn();
		const made = await list.createGroup("Client A", two.path, "g1");
		expect(made.outcome).toBe("saved");
		const client = made.outcome === "saved" ? made.groups.groups[2]! : { id: "" };
		expect(client).toEqual({ id: client.id, name: "Client A", parent: "g1" });
		expect(onDisk().repositories).toEqual([{ ...one, group: "g1" }, { ...two, group: client.id }]);

		// Personal into Client A, then back to the top level, before Work.
		expect((await list.moveGroup("g2", client.id, null)).outcome).toBe("saved");
		expect(onDisk().groups).toEqual([{ id: "g1", name: "Work" }, { id: client.id, name: "Client A", parent: "g1" }, { id: "g2", name: "Personal", parent: client.id }]);
		// Too deep a parent, or a group inside itself, is refused and nothing is written.
		const text = readFileSync(settingsFile, "utf8");
		expect(await list.createGroup("Deeper", undefined, "g2")).toEqual({ outcome: "too-deep" });
		expect(await list.moveGroup("g1", "g2", null)).toEqual({ outcome: "inside-itself" });
		expect(readFileSync(settingsFile, "utf8")).toBe(text);
		expect((await list.moveGroup("g2", null, "g1")).outcome).toBe("saved");
		expect((await groupsOn().listGroups()).groups.map(group => [group.name, group.parent ?? null])).toEqual([["Personal", null], ["Work", null], ["Client A", "g1"]]);

		// Deleting Work moves Client A and timber up to the top level, and keeps every repository.
		expect((await list.deleteGroup("g1")).outcome).toBe("saved");
		expect(onDisk().groups).toEqual([{ id: "g2", name: "Personal" }, { id: client.id, name: "Client A" }]);
		expect(onDisk().repositories).toEqual([one, { ...two, group: client.id }]);
	});

	test("an unknown group or repository changes nothing and writes nothing, so it is safe to ask again", async () => {
		savedWith({ repositories: [{ ...one, group: "g1" }, two], groups: [{ id: "g1", name: "Work" }] });
		const text = readFileSync(settingsFile, "utf8");
		const saved = statSync(settingsFile).mtimeMs;
		const current = { outcome: "saved" as const, groups: { groups: [{ id: "g1", name: "Work" }], membership: { [one.path]: "g1" } } };
		const list = groupsOn();
		expect(await list.renameGroup("gone", "Other")).toEqual(current);
		expect(await list.deleteGroup("gone")).toEqual(current);
		expect(await list.place(two.path, "gone")).toEqual(current);
		expect(await list.place("/never/listed", "g1")).toEqual(current);
		expect(await list.place(two.path, null)).toEqual(current);
		expect(await list.moveGroup("gone", null, null)).toEqual(current);
		expect(await list.moveGroup("g1", "gone", null)).toEqual(current);
		expect(await list.createGroup("Other", undefined, "gone")).toEqual(current);
		expect(readFileSync(settingsFile, "utf8")).toBe(text);
		expect(statSync(settingsFile).mtimeMs).toBe(saved);
	});

	test("changes asked for at once run one after another and never lose each other", async () => {
		savedWith({ repositories: [one, two] });
		const list = groupsOn();
		const [work, personal] = await Promise.all([list.createGroup("Work", one.path), list.createGroup("Personal", two.path)]);
		expect(work!.outcome).toBe("saved");
		expect(personal!.outcome === "saved" && personal.groups.groups.map(group => group.name)).toEqual(["Work", "Personal"]);
		expect(onDisk().repositories.map(entry => entry.group === undefined)).toEqual([false, false]);
		// Deleting a group while a place into it waits makes the place change nothing.
		const id = personal!.outcome === "saved" ? personal.groups.groups[1]!.id : "";
		const [, placed] = await Promise.all([list.deleteGroup(id), list.place(one.path, id)]);
		expect(placed!.outcome === "saved" && placed.groups.membership[one.path]).not.toBe(id);
	});

	test("removing a grouped repository keeps the group", async () => {
		savedWith({ repositories: [{ ...one, group: "g1" }, two], groups: [{ id: "g1", name: "Work" }] });
		const list = groupsOn();
		expect(await list.remove(one.path)).toEqual({ outcome: "removed" });
		expect(onDisk()).toEqual({ repositories: [two], groups: [{ id: "g1", name: "Work" }] });
		expect(await list.listGroups()).toEqual({ groups: [{ id: "g1", name: "Work" }], membership: {} });
	});

	test("a save that fails is reported, and the groups stay as they were", async () => {
		savedWith({ repositories: [one] });
		const list = groupsOn();
		await list.listGroups();
		const folder = join(settingsFile, "..");
		renameSync(folder, `${folder}-moved`);
		writeFileSync(folder, "in the way");
		const result = await list.createGroup("Work");
		expect(result.outcome).toBe("failed");
		expect(result.outcome === "failed" && result.message).toContain(`Could not save settings to ${settingsFile}: `);
		expect(await list.listGroups()).toEqual({ groups: [], membership: {} });
	});

	test("with the TIMBER_APP_REPOS override, every change says so and the file is left alone", async () => {
		savedWith({ repositories: [{ ...one, group: "g1" }], groups: [{ id: "g1", name: "Work" }] });
		const text = readFileSync(settingsFile, "utf8");
		const list = groupsOn({ environment: { TIMBER_APP_REPOS: one.path } });
		expect(await list.listGroups()).toEqual({ groups: [], membership: {} });
		expect(await list.createGroup("Personal")).toEqual({ outcome: "overridden" });
		expect(await list.createGroup("Personal", one.path)).toEqual({ outcome: "overridden" });
		expect(await list.renameGroup("g1", "Job")).toEqual({ outcome: "overridden" });
		expect(await list.deleteGroup("g1")).toEqual({ outcome: "overridden" });
		expect(await list.moveGroup("g1", null, null)).toEqual({ outcome: "overridden" });
		expect(await list.place(one.path, null)).toEqual({ outcome: "overridden" });
		expect(await list.place(one.path, "g1", [one.path])).toEqual({ outcome: "overridden" });
		expect(readFileSync(settingsFile, "utf8")).toBe(text);
	});
});
