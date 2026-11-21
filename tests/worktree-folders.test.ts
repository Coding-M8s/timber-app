import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WatchDirectory } from "../src/bun/repository-watcher";
import { createWorktreeFolders } from "../src/bun/worktree-folders";
import type { Repository } from "../src/shared/model";
import { type FolderEntry, MAX_FOLDER_ENTRIES, MAX_WATCHED_FOLDERS, type WorktreeFolderChange, type WorktreeFolderResult, compareEntries, foldersToWatch, listedEntries } from "../src/shared/worktree-folders";
import { windows } from "./support/runtime";
import { fingerprint, git } from "./support/timber";

let root: string;
let primary: string;
let linked: string;

const listed = (paths: string[]): Repository => ({
	path: primary, name: "sample", available: true, failure: null,
	setup: "repository",
	worktrees: paths.map(path => ({
		id: path, path, canonicalPath: path, branch: "feat/x", head: null, primary: path === primary, detached: false, locked: false, prunable: false,
		pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null,
	})),
});

const folders = (options: Partial<Parameters<typeof createWorktreeFolders>[0]> = {}) =>
	createWorktreeFolders({ findRepository: async path => path === primary ? listed([primary, linked]) : null, ...options });
const list = (folder: string, ignored = false, worktree = linked): Promise<WorktreeFolderResult> => folders().list({ repository: primary, worktree, folder, ignored });
const names = (result: WorktreeFolderResult) => result.outcome === "listed" ? result.entries.map(entry => `${entry.kind === "folder" ? `${entry.name}/` : entry.name}${entry.ignored ? " (ignored)" : ""}`) : result;

// The tree has links, which Windows makes only with extra rights.
describe.skipIf(windows)("listing a worktree's folders from a real repository", () => {
	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-folders-")));
		primary = join(root, "sample");
		linked = join(root, "sample-worktrees", "feat x");
		git(root, "init", "--initial-branch=main", primary);
		mkdirSync(join(primary, "src"));
		writeFileSync(join(primary, ".gitignore"), "node_modules/\n*.log\n");
		writeFileSync(join(primary, "src", "app.ts"), "export {};\n");
		writeFileSync(join(primary, "src", "kept.log"), "tracked though ignored\n");
		writeFileSync(join(primary, "README.md"), "hello\n");
		git(primary, "add", "--all");
		git(primary, "add", "--force", "src/kept.log");
		git(primary, "commit", "-m", "Files");
		git(primary, "worktree", "add", "-b", "feat/x", linked);

		// What an agent leaves behind: an untracked file and folder, ignored output, and links.
		writeFileSync(join(linked, "notes.txt"), "untracked\n");
		mkdirSync(join(linked, "scratch"));
		writeFileSync(join(linked, "scratch", "draft.md"), "# Draft\n");
		mkdirSync(join(linked, "node_modules", "left-pad"), { recursive: true });
		writeFileSync(join(linked, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
		writeFileSync(join(linked, "src", "debug.log"), "noise\n");
		writeFileSync(join(linked, "-n"), "a name like an option\n");
		symlinkSync(root, join(linked, "up"));
		symlinkSync("src", join(linked, "src-link"));
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("lists a folder's entries, folders first, without .git or ignored ones", async () => {
		expect(names(await list(""))).toEqual(["scratch/", "src/", "-n", ".gitignore", "notes.txt", "README.md", "src-link", "up"]);
		expect(names(await list("src"))).toEqual(["app.ts", "kept.log"]);
		expect(names(await list("scratch"))).toEqual(["draft.md"]);
	});

	test("lists ignored entries when asked, marked, and opens an ignored folder", async () => {
		expect(names(await list("", true))).toEqual(["node_modules/ (ignored)", "scratch/", "src/", "-n", ".gitignore", "notes.txt", "README.md", "src-link", "up"]);
		// A tracked file is never ignored, even when a pattern matches it.
		expect(names(await list("src", true))).toEqual(["app.ts", "debug.log (ignored)", "kept.log"]);
		expect(names(await list("node_modules/left-pad", true))).toEqual(["index.js (ignored)"]);
	});

	test("lists links as links, never as folders", async () => {
		const result = await list("");
		const kinds = result.outcome === "listed" ? result.entries.filter(entry => entry.name === "up" || entry.name === "src-link").map(entry => entry.kind) : [];
		expect(kinds).toEqual(["link", "link"]);
		// A folder reached through a link that leads out is refused.
		expect(await list("up")).toMatchObject({ outcome: "outside" });
	});

	test("lists a submodule's folder, asking the submodule what it ignores", async () => {
		const sub = join(root, "library");
		const host = join(root, "host");
		git(root, "init", "--initial-branch=main", sub);
		writeFileSync(join(sub, ".gitignore"), "*.tmp\n");
		writeFileSync(join(sub, "lib.ts"), "export {};\n");
		git(sub, "add", "--all");
		git(sub, "commit", "-m", "Library");
		git(root, "init", "--initial-branch=main", host);
		git(host, "-c", "protocol.file.allow=always", "submodule", "add", sub, "vendor/library");
		writeFileSync(join(host, "vendor", "library", "scratch.tmp"), "noise\n");
		const hosted = createWorktreeFolders({ findRepository: async path => path === host ? { ...listed([host]), path: host } : null });
		const listHosted = (folder: string, ignored: boolean) => hosted.list({ repository: host, worktree: host, folder, ignored });
		expect(names(await listHosted("vendor", true))).toEqual(["library/"]);
		expect(names(await listHosted("vendor/library", true))).toEqual([".gitignore", "lib.ts", "scratch.tmp (ignored)"]);
		expect(names(await listHosted("vendor/library", false))).toEqual([".gitignore", "lib.ts"]);
	});

	test("lists the primary checkout too", async () => {
		expect(names(await list("", false, primary))).toEqual(["src/", ".gitignore", "README.md"]);
	});

	test("refuses paths outside the worktree, missing folders, files, and unlisted worktrees", async () => {
		expect(await list("../sample")).toMatchObject({ outcome: "outside" });
		expect(await list("/etc")).toMatchObject({ outcome: "outside" });
		expect(await list("gone")).toMatchObject({ outcome: "missing", message: "gone is not in this worktree. It may have been moved or deleted." });
		expect(await list("README.md")).toMatchObject({ outcome: "missing", message: "README.md is a file, not a folder." });
		expect(await list("", false, join(root, "elsewhere"))).toMatchObject({ outcome: "not-listed" });
		expect(await folders().list({ repository: join(root, "nope"), worktree: linked, folder: "", ignored: false })).toMatchObject({ outcome: "not-listed" });
	});

	test("listing, ignored entries shown or hidden, changes no file, ref, or index", async () => {
		const before = [fingerprint(linked), fingerprint(primary)];
		const index = readFileSync(join(primary, ".git", "index"));
		const linkedGitDir = git(linked, "rev-parse", "--absolute-git-dir").trim();
		const linkedIndex = readFileSync(join(linkedGitDir, "index"));
		for (const folder of ["", "src", "scratch", "node_modules", "node_modules/left-pad", "gone", "up", "../sample"]) {
			await list(folder, false);
			await list(folder, true);
		}
		await list("", true, primary);
		expect([fingerprint(linked), fingerprint(primary)]).toEqual(before);
		expect(readFileSync(join(primary, ".git", "index"))).toEqual(index);
		expect(readFileSync(join(linkedGitDir, "index"))).toEqual(linkedIndex);
	});

	test("hears an untracked and an ignored file made and removed in a watched folder", async () => {
		const heard: WorktreeFolderChange[] = [];
		const watcher = folders({ onChange: change => heard.push(change), quietMilliseconds: 20 });
		try {
			await watcher.watch({ repository: primary, worktree: linked, folders: ["", "node_modules"] });
			const waitFor = async (folder: string) => {
				for (let tries = 0; tries < 100 && !heard.some(change => change.folder === folder); tries++) await Bun.sleep(20);
				expect(heard.filter(change => change.folder === folder)[0]).toEqual({ repository: primary, worktree: linked, folder });
				heard.length = 0;
			};
			writeFileSync(join(linked, "made.txt"), "new\n");
			await waitFor("");
			unlinkSync(join(linked, "made.txt"));
			await waitFor("");
			writeFileSync(join(linked, "node_modules", "made.js"), "new\n");
			await waitFor("node_modules");
			unlinkSync(join(linked, "node_modules", "made.js"));
			await waitFor("node_modules");
			// A folder no longer asked for is not watched.
			await watcher.watch({ repository: primary, worktree: linked, folders: [""] });
			writeFileSync(join(linked, "node_modules", "later.js"), "new\n");
			await Bun.sleep(150);
			expect(heard.filter(change => change.folder === "node_modules")).toEqual([]);
		} finally {
			watcher.close();
		}
	});
});

describe("watching folders", () => {
	const fakeWatch = () => {
		const open = new Map<string, (name: string | null) => void>();
		const watchDirectory: WatchDirectory = (folder, recursive, onEvent) => {
			expect(recursive).toBe(false);
			open.set(folder, onEvent);
			return { close: () => open.delete(folder) };
		};
		return { open, watchDirectory };
	};

	test("watches each folder alone, settles events, skips .git, and stops when asked", async () => {
		// Each scheduled task, with whether it was called off.
		const base = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-watch-")));
		try {
			primary = join(base, "repo");
			linked = primary;
			mkdirSync(join(primary, "src"), { recursive: true });
			const { open, watchDirectory } = fakeWatch();
			const tasks: { task: () => void; after: number; off: boolean }[] = [];
			const live = () => tasks.filter(one => !one.off);
			const heard: string[] = [];
			const schedule = (task: () => void, after: number) => {
				const one = { task, after, off: false };
				tasks.push(one);
				return () => void (one.off = true);
			};
			const watcher = folders({ watchDirectory, schedule, quietMilliseconds: 300, mostMilliseconds: 2000, onChange: change => heard.push(change.folder) });
			await watcher.watch({ repository: primary, worktree: primary, folders: ["", "src", "src", "../out", "gone"] });
			expect([...open.keys()].sort()).toEqual([primary, join(primary, "src")]);
			open.get(primary)!(".git");
			expect(live()).toHaveLength(0);
			open.get(primary)!("a.txt");
			open.get(primary)!("b.txt");
			// One quiet wait, put off by each event, and one longest wait from the first.
			expect(live().map(one => one.after).sort()).toEqual([2000, 300]);
			live().find(one => one.after === 300)!.task();
			expect(heard).toEqual([""]);
			expect(live()).toHaveLength(0);
			// While events keep coming, the longest wait still reports.
			open.get(primary)!("c.txt");
			open.get(primary)!("d.txt");
			live().find(one => one.after === 2000)!.task();
			expect(heard).toEqual(["", ""]);
			expect(live()).toHaveLength(0);
			await watcher.watch(null);
			expect(open.size).toBe(0);
		} finally {
			rmSync(base, { recursive: true, force: true });
		}
	});

	test("orders and caps the folders to watch", () => {
		expect(foldersToWatch(["a/b", "", "a", "a", "../x"])).toEqual(["", "a", "a/b"]);
		expect(foldersToWatch(Array.from({ length: MAX_WATCHED_FOLDERS + 5 }, (_, index) => `f${index}`))).toHaveLength(MAX_WATCHED_FOLDERS);
	});
});

describe("ordering and capping entries", () => {
	const entry = (name: string, kind: FolderEntry["kind"] = "file", ignored = false): FolderEntry => ({ name, path: name, kind, ignored });

	test("puts folders first, then names as read, numbers in order", () => {
		const sorted = [entry("b"), entry("Z", "folder"), entry("file10"), entry("file2"), entry("a", "folder"), entry("A")].sort(compareEntries);
		expect(sorted.map(one => one.name)).toEqual(["a", "Z", "A", "b", "file2", "file10"]);
	});

	test("leaves out ignored entries unless asked, and says how many more there are past the cap", () => {
		expect(listedEntries([entry("x", "file", true), entry("y")], false)).toEqual({ entries: [entry("y")], more: 0 });
		const many = Array.from({ length: MAX_FOLDER_ENTRIES + 3 }, (_, index) => entry(`f${index}`));
		const capped = listedEntries(many, false);
		expect(capped.entries).toHaveLength(MAX_FOLDER_ENTRIES);
		expect(capped.more).toBe(3);
	});
});
