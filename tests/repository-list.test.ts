import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { type RepositoryListOptions, createRepositoryList } from "../src/bun/repository-list";
import { createRepositoryReader } from "../src/bun/repository-reader";
import { git, realTimber, recorded, standInTimber } from "./support/timber";

let root: string;
let primary: string;
let linked: string;
let other: string;
let plain: string;
let settingsFile: string;
let cases = 0;

function makeRepository(path: string): void {
	git(root, "init", "--initial-branch=main", path);
	writeFileSync(join(path, "tracked.txt"), "one\n");
	git(path, "add", "tracked.txt");
	git(path, "commit", "-m", "Initial commit");
}

beforeAll(() => {
	// Git reports real paths, so resolve the temporary folder once (it is a link on macOS).
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-list-")));
	primary = join(root, "sample");
	linked = join(root, "sample-worktrees", "feat-x");
	other = join(root, "other");
	plain = join(root, "plain");
	makeRepository(primary);
	git(primary, "worktree", "add", "-b", "feat/x", linked);
	writeFileSync(join(linked, "tracked.txt"), "two\n");
	writeFileSync(join(linked, "new.txt"), "new\n");
	mkdirSync(join(primary, "nested", "deep"), { recursive: true });
	makeRepository(other);
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
const reader = createRepositoryReader(async () => ({ state: "ready", path: realTimber!, version: "0.1.1" }));

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

/** Every file under `folder` with its size and time of last change, and what Git says about the repository. */
function fingerprint(folder: string): string {
	const files: string[] = [];
	const walk = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const path = join(directory, entry.name);
			if (entry.isDirectory()) walk(path);
			else files.push(`${path} ${statSync(path).size} ${statSync(path).mtimeMs}`);
		}
	};
	walk(folder);
	// Without optional locks, so that looking does not itself refresh the index file.
	const run = (...args: string[]) => Bun.spawnSync(["git", "-C", folder, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).stdout.toString();
	return [...files, run("for-each-ref"), run("worktree", "list", "--porcelain"), run("status", "--porcelain"), run("ls-files", "--stage")].join("\n");
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

describe.skipIf(realTimber === null)("a saved repository whose folder is missing", () => {
	test("stays in the list, marked unavailable, comes back with its folder, and can be removed", async () => {
		const moving = join(root, `moving-${cases}`);
		const away = `${moving}-away`;
		makeRepository(moving);
		const list = listOn();
		await list.addFolder(other);
		await list.addFolder(moving);

		renameSync(moving, away);
		const unavailable = { path: moving, name: `moving-${cases}`, available: false, failure: null, worktrees: [] };
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
		expect(await listOn().list()).toEqual([{ path: plain, name: "plain", available: false, failure: null, worktrees: [] }]);
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
		const gone = join(root, `gone-${cases}`);
		makeRepository(gone);
		const list = listOn();
		await list.addFolder(gone);
		rmSync(gone, { recursive: true });
		expect(await list.find(gone)).toEqual({ path: gone, name: `gone-${cases}`, available: false, failure: null, worktrees: [] });
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
	test("replaces the saved list without changing it, and refuses add and remove", async () => {
		await listOn().addFolder(other);
		const savedText = readFileSync(settingsFile, "utf8");

		const environment = { TIMBER_APP_REPOS: [linked, plain].join(delimiter) };
		const overridden = listOn({ environment, pickFolder: async () => { throw new Error("the picker must not open"); } });
		expect(await names(overridden)).toEqual(["sample"]);
		expect(await overridden.add()).toEqual({ outcome: "overridden" });
		expect(await overridden.addFolder(primary)).toEqual({ outcome: "overridden" });
		expect(await overridden.remove(primary)).toEqual({ outcome: "overridden" });
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
	const failing = () => createRepositoryReader(async () => ({ state: "ready", path: standInTimber(root, "failing-timber", recorded.failed, 1).path, version: "0.1.1" }));
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
		const failed = { path: primary, name: "sample", available: true, failure: diagnostic, worktrees: [] };
		const list = listOn({ reader: failing() });
		expect(await list.list()).toEqual([failed]);
		expect(await list.reload(primary)).toEqual(failed);
		// The saved list is untouched, so the repository is back as soon as Timber answers.
		expect(JSON.parse(readFileSync(settingsFile, "utf8")).repositories.length).toBe(1);
	});

	test("the override lists a repository that Timber fails on by the folder it was given", async () => {
		const overridden = listOn({ reader: failing(), environment: { TIMBER_APP_REPOS: [linked, plain, linked].join(delimiter) } });
		expect(await overridden.list()).toEqual([{ path: linked, name: "feat-x", available: true, failure: diagnostic, worktrees: [] }]);
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
