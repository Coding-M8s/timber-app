import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBaseCounts } from "../src/bun/git-engine";
import { countAgainstBases, countUnpushed, createRepositoryReader } from "../src/bun/repository-reader";
import type { BaseCounts, Repository, SavedBase } from "../src/shared/model";
import { REAL_TIMBER_TIMEOUT_MS, fingerprint, git, isolatedEnvironment, makeRepository, ready, realTimber } from "./support/timber";

setDefaultTimeout(REAL_TIMBER_TIMEOUT_MS);

/**
 * How far each worktree is from its saved base (issue 337), counted by Git
 * on real temporary repositories: `main` with a worktree `feat` based on it,
 * commits on both sides, and a worktree whose base branch was deleted.
 */

let root: string;
let primary: string;
let commonGitDir: string;
let feat: string;
let orphan: string;

const head = (folder: string) => git(folder, "rev-parse", "HEAD").trim();
const commit = (folder: string, message: string) => git(folder, "commit", "--allow-empty", "-m", message);
const counted = (ahead: number, behind: number): BaseCounts => ({ kind: "counted", ahead, behind });
const onMain: SavedBase = { kind: "assigned", ref: "refs/heads/main" };

beforeAll(() => {
	// Git reports real paths, so resolve the temporary folder once (it is a link on macOS).
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-base-counts-")));
	primary = makeRepository(root, "sample");
	commonGitDir = realpathSync(join(primary, ".git"));
	feat = join(root, "sample-worktrees", "feat");
	orphan = join(root, "sample-worktrees", "orphan");
	git(primary, "worktree", "add", "-b", "feat", feat);
	commit(feat, "Feature one");
	commit(feat, "Feature two");
	commit(primary, "Main moves on");
	git(primary, "branch", "doomed");
	git(primary, "worktree", "add", "-b", "orphan", orphan);
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("readBaseCounts", () => {
	test("counts the commits only on the worktree's side as ahead, and only on the base's side as behind", async () => {
		expect(await readBaseCounts(commonGitDir, onMain, head(feat))).toEqual(counted(2, 1));
		expect(await readBaseCounts(commonGitDir, onMain, head(primary))).toEqual(counted(0, 0));
	});

	test("counts against a commit base by its full hash", async () => {
		const first = git(primary, "rev-parse", "HEAD~1").trim();
		expect(await readBaseCounts(commonGitDir, { kind: "commit", commit: first }, head(feat))).toEqual(counted(2, 0));
	});

	test("a base ref that no longer exists cannot be counted, which is not level", async () => {
		expect(await readBaseCounts(commonGitDir, { kind: "assigned", ref: "refs/heads/no-such-branch" }, head(feat))).toEqual({ kind: "unreadable" });
	});

	test("nothing is counted without a base Git can compare with, or without a commit", async () => {
		expect(await readBaseCounts(commonGitDir, null, head(feat))).toBeNull();
		expect(await readBaseCounts(commonGitDir, { kind: "unassigned" }, head(feat))).toBeNull();
		expect(await readBaseCounts(commonGitDir, { kind: "invalid", reason: "malformed" }, head(feat))).toBeNull();
		expect(await readBaseCounts(commonGitDir, onMain, null)).toBeNull();
		expect(await readBaseCounts(commonGitDir, onMain, "HEAD")).toBeNull();
	});

	test("a saved base or a head that reads as an option never reaches Git", async () => {
		const written = join(root, "written-by-git");
		expect(await readBaseCounts(commonGitDir, { kind: "assigned", ref: `--output=${written}` }, head(feat))).toBeNull();
		expect(await readBaseCounts(commonGitDir, onMain, `--output=${written}`)).toBeNull();
		expect(existsSync(written)).toBe(false);
	});

	test("leaves every file, ref, and index untouched", async () => {
		const before = [primary, feat].map(fingerprint);
		await readBaseCounts(commonGitDir, onMain, head(feat));
		await readBaseCounts(commonGitDir, { kind: "assigned", ref: "refs/heads/no-such-branch" }, head(feat));
		expect([primary, feat].map(fingerprint)).toEqual(before);
	});
});

describe("countUnpushed", () => {
	test("counts only unpublished branches with a commit, once per commit, and leaves one Git could not count as it was", async () => {
		const asked: (string | null)[] = [];
		const a = "a".repeat(40);
		const b = "b".repeat(40);
		const c = "c".repeat(40);
		const count = async (_directory: string, at: string | null): Promise<number | null> => {
			asked.push(at);
			return at === a ? 2 : at === b ? 0 : null;
		};
		const tracking = { kind: "tracking", upstream: "origin/x", ahead: 1, behind: 0 } as const;
		const answers = await countUnpushed("/work/.git", [
			{ head: a, sync: { kind: "unpublished" } },
			{ head: a, sync: tracking },
			{ head: b, sync: { kind: "unpublished" } },
			{ head: a, sync: { kind: "unpublished" } },
			{ head: null, sync: { kind: "unpublished" } },
			{ head: c, sync: { kind: "unpublished" } },
			{ head: c, sync: null },
		], count);
		expect(answers).toEqual([
			{ kind: "unpublished", unpushed: 2 }, tracking, { kind: "unpublished", unpushed: 0 }, { kind: "unpublished", unpushed: 2 }, { kind: "unpublished" }, { kind: "unpublished" }, null,
		]);
		expect(asked).toEqual([a, b, c]);
	});
});

describe("countAgainstBases", () => {
	test("asks once for each base and head, and answers in the order listed", async () => {
		const asked: string[] = [];
		const count = async (_directory: string, base: SavedBase | null, at: string | null): Promise<BaseCounts | null> => {
			asked.push(`${base?.kind} ${at}`);
			return base?.kind === "assigned" ? counted(at === "b".repeat(40) ? 2 : 1, 0) : null;
		};
		const a = "a".repeat(40);
		const b = "b".repeat(40);
		const answers = await countAgainstBases("/work/.git", [
			{ base: onMain, head: a }, { base: { kind: "unassigned" }, head: a }, { base: onMain, head: b }, { base: onMain, head: a },
		], count);
		expect(answers).toEqual([counted(1, 0), null, counted(2, 0), counted(1, 0)]);
		expect(asked).toEqual([`assigned ${a}`, `unassigned ${a}`, `assigned ${b}`]);
	});

	test("runs no more counts at once than it is allowed", async () => {
		let running = 0;
		let most = 0;
		const count = async (): Promise<BaseCounts | null> => {
			running += 1;
			most = Math.max(most, running);
			await new Promise(resolve => setTimeout(resolve, 5));
			running -= 1;
			return counted(1, 0);
		};
		const listed = Array.from({ length: 10 }, (_, index) => ({ base: onMain, head: String(index).repeat(40) }));
		expect(await countAgainstBases("/work/.git", listed, count, 3)).toEqual(Array.from({ length: 10 }, () => counted(1, 0)));
		expect(most).toBe(3);
	});
});

describe.skipIf(realTimber === null)("with the installed Timber, on a real repository", () => {
	let made: Record<string, string | undefined> | undefined;
	// Made once: it creates the home folder Timber runs with.
	const environment = () => (made ??= isolatedEnvironment(root));
	const timber = (...args: string[]) => {
		const run = Bun.spawnSync([realTimber!, ...args], { cwd: primary, env: environment(), stdout: "pipe", stderr: "pipe" });
		if (run.exitCode !== 0) throw new Error(`timber ${args.join(" ")} failed: ${run.stderr.toString()}`);
	};
	const read = async (): Promise<Repository> => (await createRepositoryReader(async () => ready(realTimber!), environment()).reload(primary))!;
	const countsOf = (repository: Repository, branch: string) => repository.worktrees.find(worktree => worktree.branch === branch)!.baseCounts;

	beforeAll(() => {
		timber("base", "--set", "refs/heads/main", "feat");
		timber("base", "--set", "refs/heads/doomed", "orphan");
		git(primary, "branch", "-D", "doomed");
	});

	test("each listed worktree with a saved base has its counts, and the others none", async () => {
		const repository = await read();
		expect(countsOf(repository, "feat")).toEqual(counted(2, 1));
		// The primary checkout has no saved base, so nothing is counted for it.
		expect(countsOf(repository, "main")).toBeNull();
		// Its base branch was deleted: said as not counted, never as level.
		expect(countsOf(repository, "orphan")).toEqual({ kind: "unreadable" });
	});

	test("the counts follow a commit on either side, as the next listing reads them", async () => {
		commit(feat, "Feature three");
		expect(countsOf(await read(), "feat")).toEqual(counted(3, 1));
		// The base moves as a fetch or a pull would move it.
		commit(primary, "Main moves again");
		expect(countsOf(await read(), "feat")).toEqual(counted(3, 2));
		git(primary, "update-ref", "refs/heads/main", "HEAD~2");
		git(primary, "reset", "--hard", "HEAD");
		expect(countsOf(await read(), "feat")).toEqual(counted(3, 0));
	});

	test("a worktree whose folder is missing has no counts, because Timber cannot verify its base", async () => {
		const parked = join(root, "parked");
		renameSync(feat, parked);
		try {
			const worktree = (await read()).worktrees.find(candidate => candidate.branch === "feat")!;
			expect(worktree.pathExists).toBe(false);
			expect(worktree.base).toEqual({ kind: "invalid", reason: "stale" });
			expect(worktree.baseCounts).toBeNull();
		} finally {
			renameSync(parked, feat);
		}
		// Git itself counts from the common Git directory, whatever state the folder is in.
		expect(await readBaseCounts(commonGitDir, onMain, head(feat))).toEqual(counted(3, 0));
	});

	test("reading leaves every file, ref, and index untouched", async () => {
		const folders = [primary, feat, orphan];
		const before = folders.map(fingerprint);
		await read();
		expect(folders.map(fingerprint)).toEqual(before);
	});
});
