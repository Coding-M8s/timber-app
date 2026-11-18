import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { appendFileSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRepositoryReader } from "../src/bun/repository-reader";
import { describeRowMarkers } from "../src/mainview/format";
import type { Repository, Worktree } from "../src/shared/model";
import { fingerprint, git, realTimber } from "./support/timber";

/**
 * Branch status in a worktree row, end to end: a real repository, the
 * installed Timber, the app's own reading, and the markers a row shows,
 * compared with what Git says when asked directly.
 */
let root: string;
let primary: string;
let trees: string;

const tree = (name: string) => join(trees, name);
const commit = (folder: string, message: string) => git(folder, "commit", "--allow-empty", "-m", message);

/** A linked worktree on a new branch that is published and level with its upstream. */
function published(branch: string): string {
	git(primary, "worktree", "add", "-b", branch, tree(branch));
	git(tree(branch), "push", "--set-upstream", "origin", branch);
	return tree(branch);
}

beforeAll(() => {
	// Git reports real paths, so resolve the temporary folder once (it is a link on macOS).
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-status-")));
	primary = join(root, "sample");
	trees = join(root, "sample-worktrees");

	git(root, "init", "--initial-branch=main", primary);
	const tracked = ["staged.txt", "unstaged.txt", "both.txt", "deleted.txt", "removed.txt", "old name.txt", "with space.txt", "zażółć gęślą.txt", "日本語 メモ.txt"];
	// Each file has its own content, so Git pairs the rename below with the right file.
	for (const name of tracked) writeFileSync(join(primary, name), `${name}\none\ntwo\nthree\n`);
	mkdirSync(join(primary, "nested"));
	writeFileSync(join(primary, "nested", "deep.txt"), "one\n");
	writeFileSync(join(primary, ".gitignore"), "*.log\n");
	git(primary, "add", "--all");
	git(primary, "commit", "-m", "Initial commit");

	const remote = join(root, "remote.git");
	git(root, "init", "--bare", remote);
	git(primary, "remote", "add", "origin", remote);
	git(primary, "push", "--set-upstream", "origin", "main");

	// Every kind of change Git tells apart, in a worktree that is level with its upstream.
	const changes = published("changes");
	const change = (name: string) => appendFileSync(join(changes, name), "more\n");
	change("staged.txt");
	git(changes, "add", "staged.txt");
	change("unstaged.txt");
	change("both.txt");
	git(changes, "add", "both.txt");
	change("both.txt");
	rmSync(join(changes, "deleted.txt"));
	git(changes, "rm", "--quiet", "removed.txt");
	git(changes, "mv", "old name.txt", "new name.txt");
	change("with space.txt");
	change("zażółć gęślą.txt");
	change("日本語 メモ.txt");
	change(join("nested", "deep.txt"));
	writeFileSync(join(changes, "added.txt"), "new\n");
	git(changes, "add", "added.txt");
	writeFileSync(join(changes, "untracked.txt"), "new\n");
	writeFileSync(join(changes, "untracked with space.txt"), "new\n");
	writeFileSync(join(changes, "nowe żółte.txt"), "new\n");
	mkdirSync(join(changes, "new folder"));
	writeFileSync(join(changes, "new folder", "first.txt"), "new\n");
	writeFileSync(join(changes, "new folder", "second.txt"), "new\n");
	writeFileSync(join(changes, "ignored.log"), "noise\n");

	const ahead = published("ahead");
	commit(ahead, "Ahead one");
	commit(ahead, "Ahead two");

	const behind = published("behind");
	for (const message of ["Behind one", "Behind two", "Behind three"]) commit(behind, message);
	git(behind, "push");
	git(behind, "reset", "--hard", "HEAD~3");

	const both = published("both");
	commit(both, "Theirs");
	git(both, "push");
	git(both, "reset", "--hard", "HEAD~1");
	commit(both, "Mine one");
	commit(both, "Mine two");

	git(primary, "worktree", "add", "-b", "local", tree("local"));

	const deleted = published("deleted");
	git(deleted, "push", "origin", "--delete", "deleted");

	// An unpublished branch with a file renamed on disk only, which Git sees as one deletion and one new file.
	git(primary, "worktree", "add", "-b", "moved", tree("moved"));
	renameSync(join(tree("moved"), "with space.txt"), join(tree("moved"), "moved by hand.txt"));

	git(primary, "worktree", "add", "--detach", tree("detached"));
	git(primary, "worktree", "add", "-b", "kept", tree("kept"));
	git(primary, "worktree", "lock", tree("kept"));
	git(primary, "worktree", "add", "-b", "gone", tree("gone"));
	rmSync(tree("gone"), { recursive: true });
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

/**
 * What `git status` lists for a folder, counted: entries for tracked files,
 * and untracked files one by one. A rename is one entry followed by the old
 * name, which is skipped.
 */
function statusCounts(folder: string): { tracked: number; untracked: number } {
	const entries = git(folder, "status", "--porcelain", "-z", "--untracked-files=all").split("\0").filter(Boolean);
	let tracked = 0;
	let untracked = 0;
	for (let index = 0; index < entries.length; index++) {
		const code = entries[index]!.slice(0, 2);
		if (code === "??") untracked++;
		else tracked++;
		if (code.includes("R") || code.includes("C")) index++;
	}
	return { tracked, untracked };
}

/** Ahead and behind as Git counts them: commits only on the branch, then commits only on its upstream. */
function revListCounts(branch: string): { ahead: number; behind: number } {
	const [ahead, behind] = git(primary, "rev-list", "--left-right", "--count", `${branch}...${branch}@{upstream}`).trim().split("\t").map(Number);
	return { ahead: ahead!, behind: behind! };
}

describe.skipIf(realTimber === null)("branch status with the installed Timber, on a real repository", () => {
	const reader = () => createRepositoryReader(async () => ({ state: "ready", path: realTimber!, version: "0.1.1" }));
	const read = async (): Promise<Repository> => (await reader().reload(primary))!;
	const at = (repository: Repository, name: string): Worktree => repository.worktrees.find(worktree => worktree.path === (name === "main" ? primary : tree(name)))!;
	const shown = (worktree: Worktree) => describeRowMarkers(worktree).map(marker => marker.kind === "ahead" ? `up ${marker.text}` : marker.kind === "behind" ? `down ${marker.text}` : marker.text);

	test("the counts in the row match git status, for every kind of change", async () => {
		const worktree = at(await read(), "changes");
		const counts = statusCounts(tree("changes"));
		// Guard the comparison itself: this is what the repository above was given.
		expect(counts).toEqual({ tracked: 11, untracked: 5 });
		expect(git(tree("changes"), "status", "--porcelain", "-z").split("\0")).toEqual(expect.arrayContaining([
			"M  staged.txt", " M unstaged.txt", "MM both.txt", " D deleted.txt", "D  removed.txt", "R  new name.txt", "A  added.txt",
			" M with space.txt", " M zażółć gęślą.txt", " M 日本語 メモ.txt", "?? nowe żółte.txt", "?? untracked with space.txt",
		]));

		expect(worktree.changes).toEqual({
			kind: "known",
			modified: ["added.txt", "both.txt", "deleted.txt", "nested/deep.txt", "new name.txt", "removed.txt", "staged.txt", "unstaged.txt", "with space.txt", "zażółć gęślą.txt", "日本語 メモ.txt"],
			untracked: ["new folder/first.txt", "new folder/second.txt", "nowe żółte.txt", "untracked with space.txt", "untracked.txt"],
		});
		expect(shown(worktree)).toEqual([`${counts.tracked}M`, `${counts.untracked}U`]);
		expect(shown(worktree)).toEqual(["11M", "5U"]);
	});

	test("a file renamed on disk only counts as Git counts it: one deletion and one untracked file", async () => {
		const worktree = at(await read(), "moved");
		expect(statusCounts(tree("moved"))).toEqual({ tracked: 1, untracked: 1 });
		expect(shown(worktree)).toEqual(["local only", "1M", "1U"]);
	});

	test("ahead and behind match git rev-list for each tracking branch", async () => {
		const repository = await read();
		expect(revListCounts("ahead")).toEqual({ ahead: 2, behind: 0 });
		expect(revListCounts("behind")).toEqual({ ahead: 0, behind: 3 });
		expect(revListCounts("both")).toEqual({ ahead: 2, behind: 1 });
		for (const branch of ["main", "changes", "ahead", "behind", "both"]) {
			expect(at(repository, branch).sync).toEqual({ kind: "tracking", upstream: `origin/${branch}`, ...revListCounts(branch) });
		}
		expect(shown(at(repository, "ahead"))).toEqual(["up 2"]);
		expect(shown(at(repository, "behind"))).toEqual(["down 3"]);
		expect(shown(at(repository, "both"))).toEqual(["down 1", "up 2"]);
		expect(describeRowMarkers(at(repository, "both")).map(marker => marker.tooltip)).toEqual([
			"1 commit to pull from origin/both, as of the last fetch.",
			"2 commits to push to origin/both, as of the last fetch.",
		]);
	});

	test("a branch with no upstream shows local only, and one whose upstream was deleted shows upstream gone", async () => {
		const repository = await read();
		// Git itself: no upstream is configured for one, and the other's upstream ref is gone.
		expect(git(primary, "for-each-ref", "--format=%(upstream)", "refs/heads/local").trim()).toBe("");
		expect(git(primary, "for-each-ref", "--format=%(upstream) %(upstream:track)", "refs/heads/deleted").trim()).toBe("refs/remotes/origin/deleted [gone]");
		expect(shown(at(repository, "local"))).toEqual(["local only"]);
		expect(shown(at(repository, "deleted"))).toEqual(["upstream gone"]);
		expect(describeRowMarkers(at(repository, "deleted"))[0]!.tooltip).toBe("The upstream branch origin/deleted no longer exists, as of the last fetch.");
	});

	test("a clean worktree that is level with its upstream shows no markers", async () => {
		expect(statusCounts(primary)).toEqual({ tracked: 0, untracked: 0 });
		expect(revListCounts("main")).toEqual({ ahead: 0, behind: 0 });
		expect(describeRowMarkers(at(await read(), "main"))).toEqual([]);
	});

	test("a detached HEAD, a locked worktree, and a missing folder are marked, and a missing folder never shows as clean", async () => {
		const repository = await read();
		expect(shown(at(repository, "detached"))).toEqual(["detached HEAD"]);
		expect(shown(at(repository, "kept"))).toEqual(["local only", "locked"]);
		expect(shown(at(repository, "gone"))).toEqual(["local only", "folder missing"]);
		expect(describeRowMarkers(at(repository, "gone"))[1]!.tooltip).toBe(`The folder is missing: ${tree("gone")}. Its status is unknown.`);
		// Timber calls the base of a folder it could not verify stale. The row says "folder missing" once, not that twice.
		expect(at(repository, "gone").base).toEqual({ kind: "invalid", reason: "stale" });
	});

	test("reading the status leaves every file, ref, and index untouched", async () => {
		const folders = [primary, tree("changes"), tree("ahead"), tree("behind"), tree("both"), tree("deleted"), tree("moved"), tree("kept")];
		const before = folders.map(fingerprint);
		const repository = await read();
		repository.worktrees.forEach(worktree => describeRowMarkers(worktree));
		expect(folders.map(fingerprint)).toEqual(before);
	});
});
