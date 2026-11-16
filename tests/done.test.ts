import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { type Done, createDone } from "../src/bun/done";
import { createRepositoryList } from "../src/bun/repository-list";
import { createRepositoryReader } from "../src/bun/repository-reader";
import { runTimberWithResultFile } from "../src/bun/timber-run";
import type { Repository, TimberStatus } from "../src/shared/model";
import { DEFAULT_DONE_OPTIONS, type DoneOptions, doneApplyArguments } from "../src/shared/timber-done";
import { type StandInRun, git, realTimber, recordedDone, standInResultTimber } from "./support/timber";

const ready = (path: string): TimberStatus => ({ state: "ready", path, version: "0.1.1" });

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

/** What `git status --porcelain` shows for a worktree, with every untracked and ignored file on its own line. */
function gitStatus(folder: string): { modified: string[]; untracked: string[]; ignored: string[] } {
	const printed = Bun.spawnSync(["git", "-C", folder, "status", "--porcelain=v1", "-z", "--untracked-files=all", "--ignored"], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).stdout.toString();
	const entries = printed.split("\0").filter(entry => entry !== "");
	const status = { modified: [] as string[], untracked: [] as string[], ignored: [] as string[] };
	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index]!;
		const code = entry.slice(0, 2);
		const path = entry.slice(3);
		if (code === "??") status.untracked.push(path);
		else if (code === "!!") status.ignored.push(path);
		else status.modified.push(path);
		// A rename or a copy is followed by the path it came from.
		if (code.includes("R") || code.includes("C")) index++;
	}
	for (const list of Object.values(status)) list.sort();
	return status;
}

describe.skipIf(realTimber === null)("with the installed Timber, on real repositories", () => {
	let work: string;
	let primary: string;
	let trees: string;
	let other: string;
	let otherTree: string;
	let scratch: string;
	let environment: Record<string, string | undefined>;
	let done: Done;
	let clock: number | null = null;
	let count = 0;

	beforeAll(async () => {
		// Git reports real paths, so resolve the temporary folder once (it is a link on macOS).
		work = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-done-")));
		primary = join(work, "my sample");
		trees = join(work, "my sample-worktrees");
		other = join(work, "other");
		otherTree = join(work, "other-worktrees", "feat-elsewhere");
		scratch = join(work, "temporary");
		mkdirSync(scratch);
		// A home of its own, so Timber's first-use marker and any user configuration stay out of this.
		const home = join(work, "home");
		mkdirSync(home);
		environment = { ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: join(home, ".config"), XDG_STATE_HOME: join(home, ".local", "state"), GIT_CONFIG_GLOBAL: "", GIT_CONFIG_NOSYSTEM: "1" };

		for (const repository of [primary, other]) {
			git(work, "init", "--initial-branch=main", repository);
			writeFileSync(join(repository, "tracked.txt"), "one\n");
			writeFileSync(join(repository, "old name.txt"), "old\n");
			writeFileSync(join(repository, ".gitignore"), "*.log\n");
			git(repository, "add", ".");
			git(repository, "commit", "-m", "Initial commit");
		}
		git(other, "worktree", "add", "-b", "feat/elsewhere", otherTree);

		// The app's list holds the first repository only.
		const timber = async () => ready(realTimber!);
		const list = createRepositoryList({
			settingsFile: join(work, "config", "timber-app", "settings.json"),
			pickFolder: async () => null,
			reader: createRepositoryReader(timber, environment),
			environment: {},
			warn: () => {},
		});
		expect((await list.addFolder(primary)).outcome).toBe("added");
		done = createDone({ timber, findRepository: path => list.find(path), environment, temporaryRoot: scratch, now: () => clock ?? Date.now() });
	});

	afterEach(() => {
		clock = null;
		// Whatever happened, no approval, no result, and no folder for them is left behind.
		expect(readdirSync(scratch)).toEqual([]);
	});

	afterAll(() => {
		rmSync(work, { recursive: true, force: true });
	});

	/** A new linked worktree of the listed repository, on a new branch. */
	function tree(name: string): { path: string; branch: string } {
		const branch = `feat/${name}-${++count}`;
		const path = join(trees, `${name} ${count}`);
		git(primary, "worktree", "add", "-b", branch, path);
		return { path, branch };
	}

	/** Edits, a staged file, a rename, untracked files, and an ignored file. */
	function dirty(path: string): void {
		writeFileSync(join(path, "tracked.txt"), "two\n");
		writeFileSync(join(path, "staged.txt"), "staged\n");
		git(path, "add", "staged.txt");
		git(path, "mv", "old name.txt", "new name.txt");
		writeFileSync(join(path, "notes zażółć.txt"), "note\n");
		mkdirSync(join(path, "src", "deep"), { recursive: true });
		writeFileSync(join(path, "src", "deep", "new.ts"), "export {};\n");
		writeFileSync(join(path, "debug.log"), "log\n");
	}

	const preview = (path: string, options: Partial<DoneOptions> = {}, repository = primary) =>
		done.preview({ repository, path, options: { ...DEFAULT_DONE_OPTIONS, ...options } });

	/** The name of a preview that must have worked. */
	async function previewed(path: string, options: Partial<DoneOptions> = {}): Promise<string> {
		const result = await preview(path, options);
		if (result.outcome !== "previewed") throw new Error(result.failure.diagnostic);
		return result.id;
	}

	const apply = (path: string, id: string, repository = primary) => done.apply({ repository, path, preview: id });
	const isListed = (path: string) => git(primary, "worktree", "list", "--porcelain").includes(`worktree ${path}\n`);
	const hasBranch = (branch: string) => git(primary, "branch", "--list", branch).trim() !== "";

	test("the preview lists the files git status shows for that worktree, and changes nothing", async () => {
		const { path, branch } = tree("dirty");
		dirty(path);
		const status = gitStatus(path);
		expect(status).toEqual({
			modified: ["new name.txt", "staged.txt", "tracked.txt"],
			untracked: ["notes zażółć.txt", "src/deep/new.ts"],
			ignored: ["debug.log"],
		});
		const before = [fingerprint(path), fingerprint(primary)];

		const result = await preview(path);
		expect(result.outcome).toBe("previewed");
		if (result.outcome !== "previewed") return;
		const { changes } = result.preview.worktree;
		expect(changes.kind === "known" && [...changes.modified].sort()).toEqual(status.modified);
		expect(changes.kind === "known" && [...changes.untracked].sort()).toEqual(status.untracked);
		expect([...result.preview.ignored].sort()).toEqual(status.ignored);
		expect(result.preview).toMatchObject({
			worktree: { path, branch, primary: false },
			repository: { primaryWorktreeRoot: primary },
			options: { keepBranch: false, discardIgnored: true, base: null },
		});
		expect(result.preview.expiresAt).toBeGreaterThan(Date.now() + 9 * 60_000);
		expect(result.preview.expiresAt).toBeLessThanOrEqual(Date.now() + 10 * 60_000);

		// Nothing is removed until the removal is asked for: files, refs, and the index are as they were.
		expect([fingerprint(path), fingerprint(primary)]).toEqual(before);
		expect(isListed(path)).toBe(true);
		expect(hasBranch(branch)).toBe(true);
	});

	test("the removal deletes the worktree with its files, and the branch", async () => {
		const { path, branch } = tree("remove");
		dirty(path);
		expect(await apply(path, await previewed(path))).toEqual({ outcome: "removed" });
		expect(existsSync(path)).toBe(false);
		expect(isListed(path)).toBe(false);
		expect(hasBranch(branch)).toBe(false);
		expect(git(primary, "status", "--porcelain")).toBe("");
	});

	test("with keep branch, the folder goes and the branch stays", async () => {
		const { path, branch } = tree("keep");
		expect(await apply(path, await previewed(path, { keepBranch: true }))).toEqual({ outcome: "removed" });
		expect(existsSync(path)).toBe(false);
		expect(isListed(path)).toBe(false);
		expect(hasBranch(branch)).toBe(true);
	});

	test("a base is passed on, and one that does not exist is refused by Timber", async () => {
		const { path, branch } = tree("base");
		const missing = await preview(path, { base: "no-such-branch" });
		expect(missing).toMatchObject({ outcome: "failed", failure: { diagnostic: "Base branch no-such-branch is missing or ambiguous. Select an exact branch.", output: null } });
		expect(missing.outcome === "failed" && missing.failure.command).toBe(`timber __ide-done preview --base=no-such-branch -- '${path}'`);

		const result = await preview(path, { base: "main" });
		expect(result).toMatchObject({ outcome: "previewed", preview: { options: { base: "main" } } });
		expect(await apply(path, result.outcome === "previewed" ? result.id : "")).toEqual({ outcome: "removed" });
		expect(hasBranch(branch)).toBe(false);
	});

	test("a change between the preview and the removal is refused, and nothing is removed", async () => {
		const { path, branch } = tree("changed");
		const id = await previewed(path);
		writeFileSync(join(path, "late.txt"), "written after the preview\n");

		const result = await apply(path, id);
		expect(result).toMatchObject({
			outcome: "failed",
			ran: true,
			failure: {
				command: `timber __ide-done apply --approval-file <approved preview> --result-file <temporary file> -- '${path}'`,
				diagnostic: "Worktree, files, settings or repository changed. Review the updated preview before removing.",
			},
		});
		expect(existsSync(join(path, "late.txt"))).toBe(true);
		expect(isListed(path)).toBe(true);
		expect(hasBranch(branch)).toBe(true);

		// The preview is used up: asking again runs nothing.
		expect(await apply(path, id)).toMatchObject({ outcome: "failed", ran: false, failure: { command: null } });
		// A new preview shows the new file, and approving that one works.
		const fresh = await preview(path);
		expect(fresh).toMatchObject({ outcome: "previewed", preview: { worktree: { changes: { untracked: ["late.txt"] } } } });
		expect(await apply(path, fresh.outcome === "previewed" ? fresh.id : "")).toEqual({ outcome: "removed" });
	});

	test("a preview can be approved once", async () => {
		const { path } = tree("once");
		const id = await previewed(path);
		expect(await apply(path, id)).toEqual({ outcome: "removed" });
		const again = await apply(path, id);
		expect(again).toMatchObject({ outcome: "failed", ran: false });
		expect(again.outcome === "failed" && again.failure.diagnostic).toContain("no longer holds that preview");
	});

	test("the primary checkout is refused by Timber, and stays", async () => {
		const { path } = tree("beside-primary");
		const before = fingerprint(primary);
		const result = await preview(primary);
		expect(result).toEqual({
			outcome: "failed",
			failure: { command: `timber __ide-done preview -- '${primary}'`, diagnostic: "Select an existing linked worktree; the primary worktree cannot be removed.", output: null },
		});
		// A preview of another worktree does not approve the primary checkout either.
		expect(await apply(primary, await previewed(path))).toMatchObject({ outcome: "failed", ran: false });
		expect(fingerprint(primary)).toBe(before);
		expect(existsSync(join(primary, "tracked.txt"))).toBe(true);
		expect(isListed(path)).toBe(true);
	});

	test("a locked worktree, and keep ignored files while some exist, are refused in Timber's words", async () => {
		const locked = tree("locked");
		git(primary, "worktree", "lock", locked.path);
		expect(await preview(locked.path)).toMatchObject({ outcome: "failed", failure: { diagnostic: `Worktree at ${locked.path} is locked; unlock it explicitly before cleanup.` } });

		const ignoring = tree("ignoring");
		writeFileSync(join(ignoring.path, "debug.log"), "log\n");
		expect(await preview(ignoring.path, { keepIgnored: true })).toMatchObject({
			outcome: "failed",
			failure: { diagnostic: "Ignored files exist. Move them out of the worktree or choose to discard ignored files." },
		});
		expect(await preview(ignoring.path)).toMatchObject({ outcome: "previewed", preview: { ignored: ["debug.log"] } });
		expect(existsSync(join(ignoring.path, "debug.log"))).toBe(true);
	});

	test("a repository outside the app's list is refused before anything runs", async () => {
		const before = fingerprint(other);
		const result = await preview(otherTree, {}, other);
		expect(result).toEqual({ outcome: "failed", failure: { command: null, diagnostic: `${other} is not a repository in this app's list. Nothing was run.`, output: null } });
		expect(fingerprint(other)).toBe(before);
	});

	test("a path that Timber does not list for that repository is refused before anything runs", async () => {
		const notListed = (path: string) => ({ outcome: "failed" as const, failure: { command: null, diagnostic: `Timber lists no worktree at ${path} in ${primary}. Nothing was run. Refresh the list.`, output: null } });
		// A worktree of another repository, a plain folder, a folder inside a worktree, and the same worktree spelled differently.
		const { path } = tree("exact");
		for (const candidate of [otherTree, scratch, join(primary, "nested"), `${path}/`, join(path, "..", "exact 0")]) {
			expect(await preview(candidate)).toEqual(notListed(candidate));
		}
		expect(isListed(path)).toBe(true);
	});

	test("a preview does not approve another worktree, and an unknown name approves nothing", async () => {
		const first = tree("first");
		const second = tree("second");
		const id = await previewed(first.path);
		const mixed = await apply(second.path, id);
		expect(mixed).toMatchObject({ outcome: "failed", ran: false, failure: { command: null } });
		expect(mixed.outcome === "failed" && mixed.failure.diagnostic).toContain(`That preview is for ${first.path}, not for ${second.path}`);
		expect(await apply(first.path, "no-such-preview")).toMatchObject({ outcome: "failed", ran: false });
		expect(await apply(first.path, "")).toMatchObject({ outcome: "failed", ran: false });
		for (const { path, branch } of [first, second]) {
			expect(isListed(path)).toBe(true);
			expect(hasBranch(branch)).toBe(true);
		}
	});

	test("an expired preview is refused without running Timber", async () => {
		const { path, branch } = tree("expired");
		const result = await preview(path);
		if (result.outcome !== "previewed") throw new Error(result.failure.diagnostic);
		clock = result.preview.expiresAt;
		expect(await apply(path, result.id)).toEqual({ outcome: "failed", ran: false, failure: { command: null, diagnostic: "The preview expired. Nothing was run. Ask for a new preview.", output: null } });
		expect(isListed(path)).toBe(true);
		expect(hasBranch(branch)).toBe(true);
	});

	test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a partial failure is reported with Timber's diagnostic: the folder is gone and the branch is not", async () => {
		const { path, branch } = tree("partial");
		const id = await previewed(path);
		// Git cannot delete a branch whose folder of refs it may not write to.
		const refs = join(primary, ".git", "refs", "heads", "feat");
		chmodSync(refs, 0o555);
		let result;
		try {
			result = await apply(path, id);
		} finally {
			chmodSync(refs, 0o755);
		}
		expect(result).toMatchObject({ outcome: "failed", ran: true });
		const diagnostic = result.outcome === "failed" ? result.failure.diagnostic : "";
		expect(diagnostic).toContain(`The worktree was removed from ${path}, but local branch ${branch} was not deleted`);
		expect(existsSync(path)).toBe(false);
		expect(isListed(path)).toBe(false);
		expect(hasBranch(branch)).toBe(true);
	});

	test("Timber itself refuses an approval that was altered or has expired", async () => {
		const { path, branch } = tree("altered");
		const printed = Bun.spawnSync([realTimber!, "__ide-done", "preview", "--keep-branch", "--", path], { cwd: primary, env: environment }).stdout.toString();
		const applyWith = (change: (record: { options: { keepBranch: boolean }; expiresAt: number }) => void) => {
			const record = JSON.parse(printed);
			change(record);
			return runTimberWithResultFile({
				executable: realTimber!,
				command: "done",
				arguments: (resultFile, approvalFile) => doneApplyArguments(approvalFile, resultFile, path),
				approval: new TextEncoder().encode(JSON.stringify(record)),
				folder: primary,
				environment,
				temporaryRoot: scratch,
			});
		};
		// Approved with the branch kept, altered to delete it.
		const altered = await applyWith(record => { record.options.keepBranch = false; });
		expect(altered.result).toMatchObject({ outcome: "failed", diagnostic: "Worktree, files, settings or repository changed. Review the updated preview before removing." });
		const expired = await applyWith(record => { record.expiresAt -= 11 * 60_000; });
		expect(expired.result).toMatchObject({ outcome: "failed", diagnostic: "Cleanup preview expired or target changed. Review the worktree again." });
		const extended = await applyWith(record => { record.expiresAt += 60 * 60_000; });
		expect(extended.result).toMatchObject({ outcome: "failed", diagnostic: "Cleanup preview expired or target changed. Review the worktree again." });
		expect(isListed(path)).toBe(true);
		expect(hasBranch(branch)).toBe(true);
	});

	test("the preview says nothing about commits, and the removal deletes a branch whose commit is nowhere else", async () => {
		const { path, branch } = tree("unpublished");
		writeFileSync(join(path, "tracked.txt"), "committed\n");
		git(path, "commit", "-am", "Only here");
		const commit = git(path, "rev-parse", "HEAD").trim();
		const result = await preview(path);
		expect(result).toMatchObject({ outcome: "previewed", preview: { worktree: { head: commit, changes: { kind: "known", modified: [], untracked: [] } }, ignored: [] } });
		expect(await apply(path, result.outcome === "previewed" ? result.id : "")).toEqual({ outcome: "removed" });
		// This is why the dialog words this case itself, from the upstream state the list already shows.
		expect(hasBranch(branch)).toBe(false);
		expect(git(primary, "branch", "--contains", commit).trim()).toBe("");
	});

	test("nothing that Timber printed is written to a log", async () => {
		const log = spyOn(console, "log");
		const warn = spyOn(console, "warn");
		const error = spyOn(console, "error");
		try {
			const { path } = tree("quiet");
			dirty(path);
			const id = await previewed(path);
			writeFileSync(join(path, "late.txt"), "late\n");
			await apply(path, id);
			await apply(path, await previewed(path));
			await preview(primary);
			expect(existsSync(path)).toBe(false);
			expect([log.mock.calls, warn.mock.calls, error.mock.calls]).toEqual([[], [], []]);
		} finally {
			log.mockRestore();
			warn.mockRestore();
			error.mockRestore();
		}
		// Five runs of Timber: more than the default five seconds on a slow machine.
	}, 20_000);
});

describe("with a stand-in for Timber", () => {
	let root: string;
	let repository: string;
	let worktree: string;
	let scratch: string;
	let count = 0;

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-done-stand-in-")));
		repository = join(root, "sample");
		worktree = join(root, "sample-worktrees", "feat-dirty");
		scratch = join(root, "temporary");
		for (const folder of [repository, worktree, scratch]) mkdirSync(folder, { recursive: true });
	});

	afterEach(() => {
		expect(readdirSync(scratch)).toEqual([]);
		expect(readdirSync(repository)).toEqual([]);
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	/** The recordings expire ten minutes after they were made, so these tests run at a time shortly before that. */
	const recordedNow = () => (JSON.parse(recordedDone.previews.dirty) as { expiresAt: number }).expiresAt - 60_000;

	/** A recording with its `/work` folder replaced by the folder of these tests. */
	const here = (text: string) => text.replaceAll("/work", root);

	/** The repository as the app's list would answer, with these worktree paths. */
	const listed = (paths: string[]): Repository => ({
		path: repository, name: "sample", available: true, failure: null,
		setup: "repository",
		worktrees: paths.map(path => ({
			id: path, path, canonicalPath: path, branch: "feat/dirty", head: null, primary: false, detached: false, locked: false, prunable: false,
			pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, sync: null,
		})),
	});

	function standIn(run: StandInRun, found: Repository | null = listed([worktree]), status?: TimberStatus) {
		const timber = standInResultTimber(root, `stand-in-${++count}`, run);
		const done = createDone({ timber: async () => status ?? ready(timber.path), findRepository: async () => found, temporaryRoot: scratch, now: recordedNow });
		const request = { repository, path: worktree };
		return {
			timber,
			ran: () => existsSync(join(dirname(timber.path), "notes.json")),
			preview: (options: Partial<DoneOptions> = {}) => done.preview({ ...request, options: { ...DEFAULT_DONE_OPTIONS, ...options } }),
			apply: (id: string) => done.apply({ ...request, preview: id }),
		};
	}

	test("the approval file holds exactly the bytes Timber printed, in a private folder outside the repository", async () => {
		// Not how Timber formats it, to show that nothing is parsed and written again.
		const printed = `${JSON.stringify(JSON.parse(here(recordedDone.previews.dirty)), null, 3)}  \n\n`;
		const { timber, preview, apply } = standIn({ result: here(recordedDone.results.removed), stdout: printed });

		const result = await preview();
		expect(result).toMatchObject({ outcome: "previewed", preview: { worktree: { path: worktree }, ignored: ["build/app.js", "debug.log"] } });
		expect(timber.notes().arguments).toEqual(["__ide-done", "preview", "--", worktree]);
		expect(realpathSync(timber.notes().cwd)).toBe(repository);
		// The interface gets a name for the preview, and nothing of what was printed beyond what it shows.
		expect(Object.keys(result).sort()).toEqual(["id", "outcome", "preview"]);

		expect(await apply(result.outcome === "previewed" ? result.id : "")).toEqual({ outcome: "removed" });
		const notes = timber.notes();
		expect(Buffer.from(notes.approval!, "base64").toString("utf8")).toBe(printed);
		expect(notes.arguments).toEqual(doneApplyArguments(notes.approvalFile!, notes.resultFile!, worktree));
		expect(dirname(notes.approvalFile!)).toBe(dirname(notes.resultFile!));
		expect(dirname(dirname(notes.approvalFile!))).toBe(scratch);
		expect(notes.approvalFile!.startsWith(repository)).toBe(false);
		expect(realpathSync(notes.cwd)).toBe(repository);
		if (process.platform !== "win32") {
			expect(notes.folderMode).toBe(0o700);
			expect(notes.approvalMode).toBe(0o600);
		}
		expect(existsSync(notes.approvalFile!)).toBe(false);
	});

	test("the options become flags of the preview", async () => {
		const { timber, preview } = standIn({ result: null, stdout: here(recordedDone.previews.dirty) });
		const result = await preview({ keepBranch: true, keepIgnored: true, base: "main" });
		expect(timber.notes().arguments).toEqual(["__ide-done", "preview", "--keep-branch", "--keep-ignored", "--base=main", "--", worktree]);
		// The stand-in answered for the default options, which is not what was asked.
		expect(result).toMatchObject({ outcome: "failed", failure: { diagnostic: "Timber answered with a preview for other options than the ones asked for. It was not used." } });
	});

	test("a preview for another worktree is not used", async () => {
		const { preview } = standIn({ result: null, stdout: here(recordedDone.previews.clean) });
		const result = await preview();
		expect(result.outcome).toBe("failed");
		expect(result.outcome === "failed" && result.failure.diagnostic).toContain(`Timber answered with a preview for ${join(root, "sample-worktrees", "feat-clean")}`);
	});

	test("output that is not a preview is a failure, even with exit code 0", async () => {
		for (const stdout of ["", "Removed worktree\n", here(recordedDone.previews.dirty).slice(0, 200), here(recordedDone.previews.dirty).replace('"schemaVersion":1', '"schemaVersion":2')]) {
			const result = await standIn({ result: null, stdout }).preview();
			expect(result.outcome).toBe("failed");
			expect(result.outcome === "failed" && result.failure.command).toBe(`timber __ide-done preview -- ${worktree}`);
		}
	});

	test("a preview that exits with a failure is not used, whatever it printed", async () => {
		const refusal = here(recordedDone.refusals.locked);
		const refused = await standIn({ result: null, stdout: here(recordedDone.previews.dirty), stderr: refusal, exitCode: 1 }).preview();
		expect(refused).toEqual({
			outcome: "failed",
			failure: { command: `timber __ide-done preview -- ${worktree}`, diagnostic: `Worktree at ${join(root, "sample-worktrees", "feat-locked")} is locked; unlock it explicitly before cleanup.`, output: null },
		});

		const crashed = await standIn({ result: null, stderr: "TypeError: undefined is not an object\n    at preview (machine-done.ts:40)\n", exitCode: 1 }).preview();
		expect(crashed).toMatchObject({ outcome: "failed", failure: { output: { text: "TypeError: undefined is not an object\n    at preview (machine-done.ts:40)\n", truncated: false } } });
		expect(crashed.outcome === "failed" && crashed.failure.diagnostic).toContain("exited with code 1 and gave no preview");

		const silent = await standIn({ result: null, exitCode: 3 }).preview();
		expect(silent.outcome === "failed" && silent.failure.diagnostic).toContain("exited with code 3");
	});

	test("nothing runs for a repository that is not in the list, is unavailable, or could not be listed", async () => {
		const run = { result: null, stdout: here(recordedDone.previews.dirty) };
		const cases: [Repository | null, string][] = [
			[null, "is not a repository in this app's list"],
			[{ ...listed([worktree]), available: false }, "Git cannot read the repository"],
			[{ ...listed([]), failure: "Not a Git repository" }, "Timber could not list the worktrees"],
			[listed([join(root, "sample-worktrees", "feat-other")]), "Timber lists no worktree at"],
		];
		for (const [found, words] of cases) {
			const { preview, ran } = standIn(run, found);
			const result = await preview();
			expect(result).toMatchObject({ outcome: "failed", failure: { command: null, output: null } });
			expect(result.outcome === "failed" && result.failure.diagnostic).toContain(words);
			expect(ran()).toBe(false);
		}
	});

	test("nothing runs while Timber is not ready", async () => {
		const { preview, ran } = standIn({ result: null }, listed([worktree]), { state: "too-old", path: "/usr/bin/timber", found: "0.1.0", required: "0.1.1" });
		const result = await preview();
		expect(result).toMatchObject({ outcome: "failed", failure: { command: null } });
		expect(result.outcome === "failed" && result.failure.diagnostic).toContain("Nothing was run");
		expect(ran()).toBe(false);
	});

	test("the list is asked again before the removal, and a worktree that left it is not removed", async () => {
		let found: Repository | null = listed([worktree]);
		const timber = standInResultTimber(root, `stand-in-${++count}`, { result: here(recordedDone.results.removed), stdout: here(recordedDone.previews.dirty) });
		const done = createDone({ timber: async () => ready(timber.path), findRepository: async () => found, temporaryRoot: scratch, now: recordedNow });
		const result = await done.preview({ repository, path: worktree, options: DEFAULT_DONE_OPTIONS });
		if (result.outcome !== "previewed") throw new Error(result.failure.diagnostic);
		found = listed([]);
		const applied = await done.apply({ repository, path: worktree, preview: result.id });
		expect(applied).toMatchObject({ outcome: "failed", ran: false });
		expect(timber.notes().arguments[1]).toBe("preview");
	});

	test("a removal that leaves no result is a failure, and is not tried again", async () => {
		const { timber, preview, apply } = standIn({ result: null, stdout: here(recordedDone.previews.dirty) });
		const result = await preview();
		const applied = await apply(result.outcome === "previewed" ? result.id : "");
		expect(applied).toMatchObject({ outcome: "failed", ran: true });
		expect(applied.outcome === "failed" && applied.failure.diagnostic).toContain("left no result, so what it did is unknown");
		expect(timber.notes().arguments[1]).toBe("apply");
		rmSync(join(dirname(timber.path), "notes.json"));
		expect(await apply(result.outcome === "previewed" ? result.id : "")).toMatchObject({ outcome: "failed", ran: false });
		expect(existsSync(join(dirname(timber.path), "notes.json"))).toBe(false);
	});

	test("the recorded partial failure comes back with its diagnostic and what was printed", async () => {
		const partial = here(recordedDone.results.partial);
		const diagnostic = (JSON.parse(partial) as { diagnostic: string }).diagnostic;
		// One stand-in answers the preview, and another acts out the removal that fails halfway.
		const previewing = standInResultTimber(root, `stand-in-${++count}`, { result: null, stdout: here(recordedDone.previews.dirty) });
		const removing = standInResultTimber(root, `stand-in-${++count}`, { result: partial, stderr: `error: ${diagnostic}\n`, exitCode: 1 });
		let executable = previewing.path;
		const done = createDone({ timber: async () => ready(executable), findRepository: async () => listed([worktree]), temporaryRoot: scratch, now: recordedNow });
		const result = await done.preview({ repository, path: worktree, options: DEFAULT_DONE_OPTIONS });
		if (result.outcome !== "previewed") throw new Error(result.failure.diagnostic);

		executable = removing.path;
		expect(await done.apply({ repository, path: worktree, preview: result.id })).toEqual({
			outcome: "failed",
			ran: true,
			failure: {
				command: `timber __ide-done apply --approval-file <approved preview> --result-file <temporary file> -- ${worktree}`,
				diagnostic,
				output: { text: `error: ${diagnostic}\n`, truncated: false },
			},
		});
		expect(diagnostic).toContain("was removed from");
	});

	test("a result with another exit code than the process had is not trusted", async () => {
		const { preview, apply } = standIn({ result: here(recordedDone.results.partial), stdout: here(recordedDone.previews.dirty) });
		const result = await preview();
		const applied = await apply(result.outcome === "previewed" ? result.id : "");
		expect(applied).toMatchObject({ outcome: "failed", ran: true });
		expect(applied.outcome === "failed" && applied.failure.diagnostic).toContain("but its result says exit code 1");
	});

	test("only so many previews are kept, and the oldest go first", async () => {
		const { preview, apply, ran, timber } = standIn({ result: here(recordedDone.results.removed), stdout: here(recordedDone.previews.dirty) });
		const ids: string[] = [];
		for (let index = 0; index < 17; index++) {
			const result = await preview();
			if (result.outcome !== "previewed") throw new Error(result.failure.diagnostic);
			ids.push(result.id);
		}
		expect(new Set(ids).size).toBe(17);
		rmSync(join(dirname(timber.path), "notes.json"));
		expect(await apply(ids[0]!)).toMatchObject({ outcome: "failed", ran: false });
		expect(ran()).toBe(false);
		expect(await apply(ids[16]!)).toEqual({ outcome: "removed" });
	});
});
