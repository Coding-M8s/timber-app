import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createFileChanges } from "../src/bun/file-changes";
import { createGitWrites } from "../src/bun/git-writes";
import { createRepositoryTurns } from "../src/bun/repository-turns";
import { MAX_CLEAN_CHARACTERS, TOO_MANY_TO_DELETE, alsoUnstaged, canDiscard, fileDiscardable, discardCommand, discardPaths } from "../src/shared/discard-files";
import type { FileChange, FileChangeTarget } from "../src/shared/file-changes";
import { MAX_ARGUMENT_CHARACTERS, describeGitCommand } from "../src/shared/index-writes";
import type { Repository } from "../src/shared/model";
import { windows } from "./support/runtime";
import { git } from "./support/timber";

const target = (area: FileChange["area"], path: string, previousPath: string | null = null): FileChangeTarget => ({ area, path, previousPath });
const args = (files: FileChangeTarget[], hasCommit = true) => {
	const planned = discardCommand(files, hasCommit);
	if (!planned.ok) throw new Error(planned.message);
	return planned.command.args;
};

describe("discard commands", () => {
	test("each group has its own command, and a staged rename names its old path too", () => {
		expect(args([target("unstaged", "a.ts"), target("unstaged", "new folder/b.ts")])).toEqual(["restore", "--worktree", "--", "a.ts", "new folder/b.ts"]);
		expect(args([target("staged", "b.ts", "a.ts"), target("staged", "c.ts")])).toEqual(["restore", "--staged", "--worktree", "--source=HEAD", "--", "a.ts", "b.ts", "c.ts"]);
		expect(args([target("untracked", "notes/todo.md")])).toEqual(["clean", "-f", "--", "notes/todo.md"]);
		expect(discardPaths([target("unstaged", "a.ts"), target("unstaged", "a.ts")])).toEqual(["a.ts"]);
		expect(describeGitCommand({ args: args([target("untracked", "star*.txt")]), input: null })).toBe("git clean -f -- 'star*.txt'");
	});

	test("conflicts, Base's Changed, mixed groups, and staged files before the first commit cannot be discarded", () => {
		expect(canDiscard("conflicted", true)).toBe(false);
		expect(canDiscard("base", true)).toBe(false);
		expect(canDiscard("staged", false)).toBe(false);
		expect(canDiscard("unstaged", false)).toBe(true);
		expect(canDiscard("untracked", false)).toBe(true);
		expect(discardCommand([target("conflicted", "a.ts")], true).ok).toBe(false);
		expect(discardCommand([target("staged", "a.ts")], false)).toEqual({ ok: false, message: "A staged file cannot be put back before the first commit. Unstage it first." });
		expect(discardCommand([target("staged", "a.ts"), target("unstaged", "b.ts")], true)).toEqual({ ok: false, message: "Files of different groups are discarded apart." });
		expect(discardCommand([], true).ok).toBe(false);
	});

	test("many paths go on standard input, except to git clean, which cannot take them there", () => {
		const many = (area: FileChange["area"], count: number) => Array.from({ length: count }, (_, index) => target(area, `folder/file-${index}-${"x".repeat(20)}.txt`));
		const restored = discardCommand(many("unstaged", 400), true);
		expect(restored.ok && restored.command.args).toEqual(["restore", "--worktree", "--pathspec-from-file=-", "--pathspec-file-nul"]);
		expect(restored.ok && restored.command.input?.split("\0").length).toBe(401);
		const few = Math.floor(MAX_ARGUMENT_CHARACTERS / 60);
		expect(discardCommand(many("unstaged", few), true)).toMatchObject({ ok: true, command: { input: null } });
		// More than restore takes on the command line, fewer than clean's limit: still on it.
		expect(discardCommand(many("untracked", 400), true)).toMatchObject({ ok: true, command: { input: null } });
		expect(discardCommand(many("untracked", Math.ceil(MAX_CLEAN_CHARACTERS / 30)), true)).toEqual({ ok: false, message: TOO_MANY_TO_DELETE });
	});

	test("names the staged files whose unstaged changes are lost too", () => {
		const listed = [{ area: "staged" as const, path: "a.ts" }, { area: "unstaged" as const, path: "a.ts" }, { area: "staged" as const, path: "b.ts" }, { area: "unstaged" as const, path: "c.ts" }];
		expect(alsoUnstaged([target("staged", "a.ts"), target("staged", "b.ts")], listed)).toEqual(["a.ts"]);
		expect(alsoUnstaged([target("unstaged", "c.ts")], listed)).toEqual([]);
	});
});

let root: string;

/**
 * Every file under `folder` but Git's own and those in `except`, with its
 * bytes, every folder, the refs, HEAD, and the stash, so a test can see that
 * only the files it discarded changed.
 */
function snapshot(folder: string, except: readonly string[] = []): string {
	const lines: string[] = [];
	const walk = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			if (entry.name === ".git") continue;
			const path = join(directory, entry.name);
			if (except.includes(relative(folder, path))) continue;
			const stats = lstatSync(path);
			if (stats.isDirectory()) {
				lines.push(`${path}/`);
				walk(path);
			} else lines.push(`${path} ${stats.mode} ${stats.isSymbolicLink() ? readlinkSync(path) : createHash("sha256").update(readFileSync(path)).digest("hex")} ${stats.mtimeMs}`);
		}
	};
	walk(folder);
	const plain = (...words: string[]) => Bun.spawnSync(["git", "-C", folder, ...words], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).stdout.toString();
	return [...lines, plain("for-each-ref"), plain("rev-parse", "HEAD"), plain("symbolic-ref", "-q", "HEAD"), plain("stash", "list")].join("\n");
}

/** The index entries of the paths not in `except`, so a test can see the others stayed staged as they were. */
function indexEntries(worktree: string, except: readonly string[] = []): string {
	return git(worktree, "ls-files", "--stage").split("\n").filter(line => !except.includes(line.split("\t")[1] ?? "")).join("\n");
}

/** `git status --porcelain` as the person would read it. */
const status = (worktree: string) => Bun.spawnSync(["git", "-C", worktree, "status", "--porcelain", "--untracked-files=all"], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_GLOBAL: "", GIT_CONFIG_NOSYSTEM: "1" } }).stdout.toString();

interface Sample {
	primary: string;
	linked: string;
	written: string[];
	changes: ReturnType<typeof createFileChanges>;
}

/** A repository with a linked worktree, as the app's list answers for it, and the Changes side over both. */
function sample(name: string, setUp: (linked: string) => void, { commit = true }: { commit?: boolean } = {}): Sample {
	const primary = join(root, name);
	const linked = join(root, `${name}-worktrees`, "feat x");
	git(root, "init", "--initial-branch=main", primary);
	if (commit) {
		for (const [file, text] of Object.entries({ "keep.txt": "one\n", "edited.txt": "one\n", "old name.txt": "a\nb\nc\nd\ne\n", "star*.txt": "star\n", "star-other.txt": "other\n", ".gitignore": "*.log\n" })) writeFileSync(join(primary, file), text);
		git(primary, "add", "--all");
		git(primary, "commit", "-m", "Files");
	}
	git(primary, "worktree", "add", ...(commit ? ["-b", "feat/x"] : ["--orphan", "-b", "feat/x"]), linked);
	setUp(linked);
	const listed: Repository = {
		path: primary, name, available: true, failure: null, setup: "repository", fallbackBase: null,
		worktrees: [primary, linked].map(path => ({
			id: path, path, canonicalPath: path, branch: "feat/x", head: null, primary: path === primary, detached: false, locked: false, prunable: false,
			pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null, baseCounts: null,
		})),
	};
	const written: string[] = [];
	const findRepository = async (path: string) => (path === primary ? listed : null);
	const writes = createGitWrites({ findRepository, turns: createRepositoryTurns(), onWritten: repository => written.push(repository) });
	return { primary, linked, written, changes: createFileChanges({ findRepository, writes }) };
}

/** Discard as the window does: the command it shows comes from the list it read. */
async function discard(sampled: Sample, files: FileChangeTarget[], shown: string[] = args(files)) {
	return sampled.changes.discard({ repository: sampled.primary, worktree: sampled.linked, files, shown });
}

async function listed(sampled: Sample) {
	const read = await sampled.changes.read({ repository: sampled.primary, worktree: sampled.linked, compare: "uncommitted" });
	if (read.outcome !== "read") throw new Error(read.message);
	return read;
}

const text = (folder: string, path: string) => readFileSync(join(folder, path), "utf8");

// The sample has a `*` in a file name, which Windows does not allow, as in ./index-writes.test.ts.
describe.skipIf(windows)("discarding in real repositories", () => {
	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-discard-")));
	});
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	test("an unstaged file goes back to its staged version, and nothing else changes", async () => {
		const sampled = sample("unstaged", linked => {
			writeFileSync(join(linked, "keep.txt"), "one\nstaged\n");
			git(linked, "add", "keep.txt");
			writeFileSync(join(linked, "keep.txt"), "one\nstaged\nunstaged\n");
			unlinkSync(join(linked, "edited.txt"));
			writeFileSync(join(linked, "star-other.txt"), "other edited\n");
		});
		const discarded = ["keep.txt", "edited.txt"];
		const [others, primary, index] = [snapshot(sampled.linked, discarded), snapshot(sampled.primary), git(sampled.linked, "ls-files", "--stage")];
		const answer = await discard(sampled, [target("unstaged", "keep.txt"), target("unstaged", "edited.txt")]);
		expect(answer).toEqual({ outcome: "written", command: "git restore --worktree -- keep.txt edited.txt" });
		expect(text(sampled.linked, "keep.txt")).toBe("one\nstaged\n");
		expect(text(sampled.linked, "edited.txt")).toBe("one\n");
		expect(status(sampled.linked)).toBe("M  keep.txt\n M star-other.txt\n");
		expect(snapshot(sampled.linked, discarded)).toBe(others);
		expect(snapshot(sampled.primary)).toBe(primary);
		expect(git(sampled.linked, "ls-files", "--stage")).toBe(index);
		expect(sampled.written).toEqual([sampled.primary]);
	});

	test("a staged file goes back to HEAD in the index and on disk, a rename with its old path, and a staged new file is deleted", async () => {
		const sampled = sample("staged", linked => {
			git(linked, "mv", "old name.txt", "new name.txt");
			writeFileSync(join(linked, "keep.txt"), "one\nstaged\n");
			git(linked, "add", "keep.txt");
			writeFileSync(join(linked, "keep.txt"), "one\nstaged\nunstaged\n");
			writeFileSync(join(linked, "added.txt"), "added\n");
			git(linked, "add", "added.txt");
			writeFileSync(join(linked, "edited.txt"), "one\nstaged, kept\n");
			git(linked, "add", "edited.txt");
		});
		const read = await listed(sampled);
		expect(alsoUnstaged(read.files.filter(file => file.area === "staged" && file.path === "keep.txt"), read.files)).toEqual(["keep.txt"]);
		const rename = read.files.find(file => file.kind === "renamed")!;
		const discarded = ["old name.txt", "new name.txt", "keep.txt", "added.txt"];
		const [others, index] = [snapshot(sampled.linked, discarded), indexEntries(sampled.linked, discarded)];
		const answer = await discard(sampled, [rename, target("staged", "keep.txt"), target("staged", "added.txt")]);
		expect(answer).toEqual({ outcome: "written", command: "git restore --staged --worktree --source=HEAD -- 'old name.txt' 'new name.txt' keep.txt added.txt" });
		expect(status(sampled.linked)).toBe("M  edited.txt\n");
		expect(text(sampled.linked, "keep.txt")).toBe("one\n");
		expect(text(sampled.linked, "old name.txt")).toBe("a\nb\nc\nd\ne\n");
		expect(existsSync(join(sampled.linked, "new name.txt"))).toBe(false);
		expect(existsSync(join(sampled.linked, "added.txt"))).toBe(false);
		expect(snapshot(sampled.linked, discarded)).toBe(others);
		expect(indexEntries(sampled.linked, discarded)).toBe(index);
	});

	test("an untracked file is deleted, never its folder, another untracked file, an ignored file, or a nested repository", async () => {
		const sampled = sample("untracked", linked => {
			mkdirSync(join(linked, "notes", "deep"), { recursive: true });
			writeFileSync(join(linked, "notes", "deep", "todo.md"), "todo\n");
			writeFileSync(join(linked, "notes", "other.md"), "other\n");
			writeFileSync(join(linked, "notes", "deep", "debug.log"), "ignored\n");
			writeFileSync(join(linked, "star*.new"), "star\n");
			writeFileSync(join(linked, "star-other.new"), "other\n");
			mkdirSync(join(linked, "nested"));
			git(join(linked, "nested"), "init", "-q");
			writeFileSync(join(linked, "nested", "inside.txt"), "inside\n");
		});
		const read = await listed(sampled);
		expect(read.files.filter(file => file.area === "untracked").map(file => file.path).sort()).toEqual(["nested/", "notes/deep/todo.md", "notes/other.md", "star*.new", "star-other.new"]);
		const discarded = ["notes/deep/todo.md", "star*.new"];
		const [others, index] = [snapshot(sampled.linked, discarded), git(sampled.linked, "ls-files", "--stage")];
		const answer = await discard(sampled, [target("untracked", "notes/deep/todo.md"), target("untracked", "star*.new")]);
		expect(answer).toEqual({ outcome: "written", command: "git clean -f -- notes/deep/todo.md 'star*.new'" });
		expect(existsSync(join(sampled.linked, "notes", "deep", "todo.md"))).toBe(false);
		expect(existsSync(join(sampled.linked, "star*.new"))).toBe(false);
		// The emptied folder, its ignored file, the other untracked files, and the nested repository all stay.
		expect(snapshot(sampled.linked, discarded)).toBe(others);
		expect(text(sampled.linked, "notes/deep/debug.log")).toBe("ignored\n");
		expect(git(sampled.linked, "ls-files", "--stage")).toBe(index);
		const nested = await discard(sampled, [target("untracked", "nested/")], ["clean", "-f", "--", "nested/"]);
		expect(nested.outcome).toBe("refused");
		expect(fileDiscardable(target("untracked", "nested/"), true)).toBe(false);
		expect(fileDiscardable(target("untracked", "notes/other.md"), true)).toBe(true);
		expect(text(sampled.linked, "nested/inside.txt")).toBe("inside\n");
	});

	test("takes a path literally: discarding star*.txt leaves star-other.txt alone", async () => {
		const sampled = sample("literal", linked => {
			writeFileSync(join(linked, "star*.txt"), "star 2\n");
			writeFileSync(join(linked, "star-other.txt"), "other 2\n");
		});
		expect((await discard(sampled, [target("unstaged", "star*.txt")])).outcome).toBe("written");
		expect(status(sampled.linked)).toBe(" M star-other.txt\n");
	});

	test("discards hundreds of unstaged files through standard input", async () => {
		const names = Array.from({ length: 300 }, (_, index) => `many/file-${index}-${"x".repeat(20)}.txt`);
		const sampled = sample("many", linked => {
			mkdirSync(join(linked, "many"));
			for (const name of names) writeFileSync(join(linked, name), "one\n");
			git(linked, "add", "many");
			git(linked, "commit", "-qm", "Many");
			for (const name of names) writeFileSync(join(linked, name), "two\n");
		});
		const answer = await discard(sampled, names.map(name => target("unstaged", name)));
		expect(answer).toEqual({ outcome: "written", command: "git restore --worktree --pathspec-from-file=- --pathspec-file-nul, with 300 paths on standard input" });
		expect(status(sampled.linked)).toBe("");
	});

	test("refuses a conflict, a file not listed now, one in another group, mixed groups, a staged file before the first commit, and a command not shown, before running Git", async () => {
		const sampled = sample("refuse", linked => {
			writeFileSync(join(linked, "keep.txt"), "one\ntwo\n");
			writeFileSync(join(linked, "new.txt"), "new\n");
		});
		const before = [snapshot(sampled.linked), git(sampled.linked, "ls-files", "--stage")];
		const refused = async (files: FileChangeTarget[], shown: string[]) => (await discard(sampled, files, shown));
		expect(await refused([target("unstaged", "star-other.txt")], ["restore", "--worktree", "--", "star-other.txt"]))
			.toEqual({ outcome: "refused", message: "star-other.txt is no longer a change that can be discarded in this worktree. Nothing was discarded." });
		expect((await refused([target("unstaged", "keep.txt"), target("untracked", "nowhere.txt")], ["restore", "--worktree", "--", "keep.txt"])).outcome).toBe("refused");
		expect((await refused([target("untracked", "keep.txt")], ["clean", "-f", "--", "keep.txt"])).outcome).toBe("refused");
		expect(await refused([target("unstaged", "keep.txt"), target("untracked", "new.txt")], ["restore", "--worktree", "--", "keep.txt"]))
			.toEqual({ outcome: "refused", message: "Files of different groups are discarded apart. Nothing was discarded." });
		expect((await refused([target("unstaged", "../refuse/keep.txt")], ["restore", "--worktree", "--", "../refuse/keep.txt"])).outcome).toBe("refused");
		expect(await refused([target("unstaged", "keep.txt")], ["checkout", "--", "keep.txt"]))
			.toEqual({ outcome: "refused", message: "The command is now git restore --worktree -- keep.txt, not the one that was shown. Nothing was discarded. Look at the list again." });
		expect((await refused([], [])).outcome).toBe("refused");
		expect([snapshot(sampled.linked), git(sampled.linked, "ls-files", "--stage")]).toEqual(before);
		expect(sampled.written).toEqual([]);

		const unborn = sample("refuse-unborn", linked => {
			writeFileSync(join(linked, "first.txt"), "first\n");
			git(linked, "add", "first.txt");
		}, { commit: false });
		expect(await discard(unborn, [target("staged", "first.txt")], ["restore", "--staged", "--worktree", "--source=HEAD", "--", "first.txt"]))
			.toEqual({ outcome: "refused", message: "first.txt is no longer a change that can be discarded in this worktree. Nothing was discarded." });
		expect(text(unborn.linked, "first.txt")).toBe("first\n");
	});

	test("refuses a conflicted file and leaves the merge as it is", async () => {
		const sampled = sample("conflict", linked => {
			writeFileSync(join(linked, "keep.txt"), "ours\n");
			git(linked, "commit", "-am", "Ours");
			git(linked, "checkout", "-q", "-b", "theirs", "main");
			writeFileSync(join(linked, "keep.txt"), "theirs\n");
			git(linked, "commit", "-am", "Theirs");
			git(linked, "checkout", "-q", "feat/x");
			Bun.spawnSync(["git", "-C", linked, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "merge", "theirs"]);
		});
		const before = snapshot(sampled.linked);
		const answer = await discard(sampled, [target("conflicted", "keep.txt")], ["restore", "--worktree", "--", "keep.txt"]);
		expect(answer.outcome).toBe("refused");
		expect(snapshot(sampled.linked)).toBe(before);
	});

	test("a held index.lock fails with Git's message and changes nothing", async () => {
		const sampled = sample("locked", linked => {
			writeFileSync(join(linked, "keep.txt"), "one\nstaged\n");
			git(linked, "add", "keep.txt");
		});
		const lock = git(sampled.linked, "rev-parse", "--path-format=absolute", "--git-path", "index.lock").trim();
		writeFileSync(lock, "");
		const before = snapshot(sampled.linked);
		const answer = await discard(sampled, [target("staged", "keep.txt")]);
		expect(answer.outcome).toBe("failed");
		expect(answer.outcome === "failed" && answer.message).toContain("index.lock");
		expect(snapshot(sampled.linked)).toBe(before);
		unlinkSync(lock);
	});
});
