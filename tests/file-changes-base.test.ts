import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileChanges } from "../src/bun/file-changes";
import { type ChangeArea, type Comparison, type FileChange, type FileChangesResult, parseDiff } from "../src/shared/file-changes";
import type { Repository, SavedBase } from "../src/shared/model";
import { windows } from "./support/runtime";
import { fingerprint, git } from "./support/timber";

let root: string;
let primary: string;
let feature: string;
let fresh: string;
let conflicted: string;
let branchPoint: string;

const ORIGIN_MAIN: SavedBase = { kind: "assigned", ref: "refs/remotes/origin/main" };

/** The repository as the app's list would answer, with each worktree's saved base. */
function listed(path: string, worktrees: [string, SavedBase | null][]): Repository {
	return {
		path, name: "sample", available: true, failure: null, setup: "repository",
		worktrees: worktrees.map(([folder, base]) => ({
			id: folder, path: folder, canonicalPath: folder, branch: "feat", head: null, primary: folder === path, detached: false, locked: false, prunable: false,
			pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base, issue: null, sync: null,
		})),
	};
}

/** A reader for the feature worktree with this saved base. */
const reader = (base: SavedBase | null, folder = () => feature, repository = () => primary) =>
	createFileChanges({ findRepository: async path => path === repository() ? listed(repository(), [[folder(), base]]) : null });

/** Git as the person would run it, without the app's options, apart from not refreshing the index. */
function plainGit(cwd: string, ...args: string[]): string {
	return Bun.spawnSync(["git", "-C", cwd, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" } }).stdout.toString();
}

const entries = (files: FileChange[]) => files.map(file => `${file.area} ${file.kind} ${file.path}${file.previousPath === null ? "" : ` from ${file.previousPath}`}`).sort();

async function read(compare: Comparison, base: SavedBase | null = ORIGIN_MAIN): Promise<FileChangesResult & { outcome: "read" }> {
	const answer = await reader(base).read({ repository: primary, worktree: feature, compare });
	if (answer.outcome !== "read") throw new Error(`not read: ${answer.message}`);
	return answer;
}

// Not run on Windows yet: an untracked file's diff compares it with /dev/null, as in ./file-changes.test.ts.
describe.skipIf(windows)("comparing a worktree with its base, in real repositories", () => {
	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-base-")));
		primary = join(root, "sample");
		feature = join(root, "sample-worktrees", "feat");
		git(root, "init", "--initial-branch=main", primary);
		const lines = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n") + "\n";
		for (const [name, text] of Object.entries({ "keep.txt": "one\ntwo\n", "gone.txt": "x\n", "old name.txt": lines, "staged.txt": "s\n", "unstaged.txt": "u\n", "untracked-again.txt": "a\n" })) {
			writeFileSync(join(primary, name), text);
		}
		git(primary, "add", "--all");
		git(primary, "commit", "-m", "Start");
		git(primary, "update-ref", "refs/remotes/origin/main", "main");
		git(primary, "worktree", "add", "-b", "feat", feature, "origin/main");
		branchPoint = git(primary, "rev-parse", "main").trim();

		// Committed on the branch: an edit, a deletion, a rename, and a new file.
		writeFileSync(join(feature, "keep.txt"), "one\nTWO\n");
		git(feature, "rm", "--quiet", "gone.txt");
		git(feature, "mv", "old name.txt", "new name.txt");
		writeFileSync(join(feature, "added.txt"), "added\n");
		git(feature, "add", "--all");
		git(feature, "commit", "-m", "Work");

		// Not committed: staged, unstaged, untracked, and a file taken out of Git but still on disk.
		writeFileSync(join(feature, "staged.txt"), "s\nstaged\n");
		git(feature, "add", "staged.txt");
		writeFileSync(join(feature, "unstaged.txt"), "u\nunstaged\n");
		writeFileSync(join(feature, "new.txt"), "new\n");
		git(feature, "rm", "--quiet", "--cached", "untracked-again.txt");

		// The base moves on after the branch point.
		writeFileSync(join(primary, "base only.txt"), "only on the base\n");
		writeFileSync(join(primary, "keep.txt"), "one\ntwo\nthree on the base\n");
		git(primary, "add", "--all");
		git(primary, "commit", "-m", "Later on the base");
		git(primary, "update-ref", "refs/remotes/origin/main", "main");

		// A merge conflict in a worktree of its own, on a file the branch also changed since the base.
		conflicted = join(root, "sample-worktrees", "conflict");
		git(primary, "worktree", "add", "-b", "conflict", conflicted, branchPoint);
		writeFileSync(join(conflicted, "gone.txt"), "theirs\n");
		git(conflicted, "commit", "-am", "Theirs");
		writeFileSync(join(primary, "gone.txt"), "ours\n");
		git(primary, "commit", "-am", "Ours");
		const merge = Bun.spawnSync(["git", "-C", conflicted, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "merge", "main"], { stdout: "pipe", stderr: "pipe" });
		expect(merge.exitCode).not.toBe(0);

		// Make the index's file times stale, which is when a plain `git diff` or `git status` rewrites the index.
		const later = new Date(Date.now() + 5000);
		for (const name of ["new name.txt", "added.txt", "unstaged.txt"]) utimesSync(join(feature, name), later, later);

				// A repository whose HEAD has no commit yet.
		fresh = join(root, "fresh");
		git(root, "init", "--initial-branch=main", fresh);
		writeFileSync(join(fresh, "first.txt"), "hello\n");
		git(fresh, "add", "first.txt");
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("lists committed, staged, unstaged, untracked, renamed, and deleted files since the branch point, and nothing of the base's later commits", async () => {
		const answer = await read("base");
		expect(answer.compared).toBe("base");
		expect(answer.base).toEqual({ usable: true, ref: "refs/remotes/origin/main", name: "origin/main", commit: branchPoint });
		expect(entries(answer.files)).toEqual([
			"base added added.txt",
			"base deleted gone.txt",
			"base deleted untracked-again.txt",
			"base modified keep.txt",
			"base modified staged.txt",
			"base modified unstaged.txt",
			"base renamed new name.txt from old name.txt",
			"untracked untracked new.txt",
			"untracked untracked untracked-again.txt",
		]);
		expect(answer.more).toBe(false);
	});

	test("still shows the work after it is committed", async () => {
		// In a worktree of its own, so the shared one stays as the other tests expect.
		const other = join(root, "sample-worktrees", "committed");
		git(primary, "worktree", "add", "-b", "committed", other, branchPoint);
		writeFileSync(join(other, "keep.txt"), "one\nchanged\n");
		const ask = (compare: Comparison) => reader(ORIGIN_MAIN, () => other).read({ repository: primary, worktree: other, compare });
		expect(await ask("base")).toMatchObject({ outcome: "read", compared: "base", files: [{ area: "base", kind: "modified", path: "keep.txt" }] });

		git(other, "commit", "-am", "Commit it");
		expect(await ask("uncommitted")).toMatchObject({ outcome: "read", compared: "uncommitted", files: [] });
		expect(await ask("base")).toMatchObject({ outcome: "read", compared: "base", files: [{ area: "base", kind: "modified", path: "keep.txt" }] });
	});

	test("each diff matches git diff from the branch point, and an untracked file is all additions", async () => {
		const diff = (area: ChangeArea, path: string, previousPath: string | null = null) =>
			reader(ORIGIN_MAIN).diff({ repository: primary, worktree: feature, compare: "base", file: { area, path, previousPath } });
		for (const path of ["keep.txt", "staged.txt", "unstaged.txt", "gone.txt", "added.txt"]) {
			expect(await diff("base", path)).toEqual({ outcome: "read", file: expect.objectContaining({ area: "base", path }), diff: parseDiff(plainGit(feature, "diff", branchPoint, "--", path)) });
		}
		const keep = await diff("base", "keep.txt");
		const texts = keep.outcome === "read" && keep.diff.kind === "text" ? keep.diff.sections[0]!.hunks[0]!.lines.map(line => `${line.kind} ${line.text}`) : [];
		expect(texts).toEqual(["context one", "removed two", "added TWO"]);

		const renamed = await diff("base", "new name.txt", "old name.txt");
		expect(renamed.outcome === "read" && renamed.file).toEqual({ area: "base", kind: "renamed", path: "new name.txt", previousPath: "old name.txt" });
		expect(renamed.outcome === "read" && renamed.diff.kind === "text" && renamed.diff.sections[0]!.header).toContain("rename from old name.txt");

		const untracked = await diff("untracked", "new.txt");
		expect(untracked.outcome === "read" && untracked.diff.kind === "text" && untracked.diff.sections[0]!.hunks[0]!.lines.map(line => `${line.kind} ${line.text}`)).toEqual(["added new"]);

		// A file of the base's later commits is not part of the branch.
		expect(await diff("base", "base only.txt")).toEqual({ outcome: "read", file: null, diff: { kind: "unchanged" } });
	});

	test("reading the list and every diff changes no file, index, or ref", async () => {
		const before = [fingerprint(feature), fingerprint(primary)];
		const indexFile = plainGit(feature, "rev-parse", "--path-format=absolute", "--git-path", "index").trim();
		const index = readFileSync(indexFile);
		for (const compare of ["base", "uncommitted"] as const) {
			const answer = await read(compare);
			for (const file of answer.files) {
				await reader(ORIGIN_MAIN).diff({ repository: primary, worktree: feature, compare, file });
			}
		}
		expect([fingerprint(feature), fingerprint(primary)]).toEqual(before);
		expect(readFileSync(indexFile).equals(index)).toBe(true);
	});

	test("Uncommitted lists what git status lists, and still says the base can be used", async () => {
		const answer = await read("uncommitted");
		expect(answer.compared).toBe("uncommitted");
		expect(answer.base).toMatchObject({ usable: true, name: "origin/main" });
		expect(entries(answer.files)).toEqual([
			"staged deleted untracked-again.txt",
			"staged modified staged.txt",
			"unstaged modified unstaged.txt",
			"unstaged untracked new.txt",
			"unstaged untracked untracked-again.txt",
		]);
	});

	test("a base that cannot be used shows Uncommitted, with the reason, and nothing fails", async () => {
		git(primary, "checkout", "--quiet", "--orphan", "lone");
		git(primary, "commit", "--quiet", "--allow-empty", "-m", "No shared history");
		git(primary, "checkout", "--quiet", "main");
		const cases: [SavedBase | null, RegExp][] = [
			[null, /did not report a base/],
			[{ kind: "unassigned" }, /no base saved/],
			[{ kind: "invalid", reason: "stale" }, /cannot use it/],
			[{ kind: "assigned", ref: "refs/remotes/origin/gone" }, /refs\/remotes\/origin\/gone|origin\/gone/],
			[{ kind: "assigned", ref: "refs/heads/lone" }, /no history in common|share no history/],
			[{ kind: "assigned", ref: "--output=/tmp/x" }, /not a ref/],
		];
		for (const [base, reason] of cases) {
			const answer = await read("base", base);
			expect(answer.compared).toBe("uncommitted");
			expect(answer.base.usable).toBe(false);
			expect(!answer.base.usable && answer.base.reason).toMatch(reason);
			expect(answer.files.length).toBeGreaterThan(0);
			const diff = await reader(base).diff({ repository: primary, worktree: feature, compare: "base", file: { area: "base", path: "keep.txt", previousPath: null } });
			expect(diff).toEqual({ outcome: "read", file: null, diff: { kind: "unchanged" } });
		}
	});

	test("lists a conflicted file once, as a conflict, with Git's combined diff", async () => {
		const ask = reader(ORIGIN_MAIN, () => conflicted);
		const answer = await ask.read({ repository: primary, worktree: conflicted, compare: "base" });
		expect(answer).toMatchObject({ outcome: "read", compared: "base" });
		expect(answer.outcome === "read" && answer.files.filter(file => file.path === "gone.txt")).toEqual([{ area: "conflicted", kind: "conflicted", path: "gone.txt", previousPath: null }]);
		const diff = await ask.diff({ repository: primary, worktree: conflicted, compare: "base", file: { area: "conflicted", path: "gone.txt", previousPath: null } });
		const texts = diff.outcome === "read" && diff.diff.kind === "text" ? diff.diff.sections[0]!.hunks[0]!.lines.map(line => `${line.kind} ${line.text}`) : [];
		expect(texts.some(text => text.startsWith("added <<<<<<<"))).toBe(true);
	});

	test("a worktree with no commit yet cannot use its base", async () => {
		const answer = await reader(ORIGIN_MAIN, () => fresh, () => fresh).read({ repository: fresh, worktree: fresh, compare: "base" });
		expect(answer).toMatchObject({ outcome: "read", compared: "uncommitted", base: { usable: false }, files: [{ area: "staged", kind: "added", path: "first.txt" }] });
		expect(answer.outcome === "read" && !answer.base.usable && answer.base.reason).toMatch(/no commit/);
	});
});
