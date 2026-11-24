import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileChanges } from "../src/bun/file-changes";
import { createGitWrites } from "../src/bun/git-writes";
import { createRepositoryTurns } from "../src/bun/repository-turns";
import type { FileChange, FileChangeTarget } from "../src/shared/file-changes";
import {
	type IndexAction, MAX_ARGUMENT_CHARACTERS, canWriteIndex, describeGitCommand, indexActionOf, indexCommand, indexPaths,
} from "../src/shared/index-writes";
import type { Repository } from "../src/shared/model";
import { windows } from "./support/runtime";
import { git } from "./support/timber";

const target = (area: FileChange["area"], path: string, previousPath: string | null = null): FileChangeTarget => ({ area, path, previousPath });

describe("index write commands", () => {
	test("stage is git add, for every group but Staged and Base's Changed", () => {
		expect(indexCommand("stage", [target("unstaged", "a.ts"), target("untracked", "new file.ts"), target("conflicted", "c.ts")], true))
			.toEqual({ args: ["add", "--", "a.ts", "new file.ts", "c.ts"], input: null });
		expect(["conflicted", "unstaged", "untracked"].every(area => canWriteIndex("stage", area as FileChange["area"]))).toBe(true);
		expect(canWriteIndex("stage", "staged")).toBe(false);
		expect(canWriteIndex("stage", "base")).toBe(false);
		expect(canWriteIndex("unstage", "base")).toBe(false);
		expect(indexActionOf("base")).toBeNull();
		expect(indexActionOf("staged")).toBe("unstage");
		expect(indexActionOf("conflicted")).toBe("stage");
	});

	test("unstage is git restore --staged, with a rename's old path, or git rm --cached -f before the first commit", () => {
		expect(indexCommand("unstage", [target("staged", "b.ts", "a.ts"), target("staged", "c.ts")], true))
			.toEqual({ args: ["restore", "--staged", "--", "a.ts", "b.ts", "c.ts"], input: null });
		expect(indexCommand("unstage", [target("staged", "first.txt")], false)).toEqual({ args: ["rm", "--cached", "-f", "--", "first.txt"], input: null });
		// Staging a rename's new path is enough: the old one is not in the unstaged list.
		expect(indexPaths("stage", [target("unstaged", "b.ts", "a.ts")])).toEqual(["b.ts"]);
		expect(indexPaths("stage", [target("unstaged", "a.ts"), target("unstaged", "a.ts")])).toEqual(["a.ts"]);
	});

	test("shows the command as it runs, quoted for reading", () => {
		expect(describeGitCommand(indexCommand("stage", [target("untracked", "new file.ts"), target("unstaged", "star*.txt")], true))).toBe("git add -- 'new file.ts' 'star*.txt'");
	});

	test("many paths go on standard input rather than past the command line's limit", () => {
		const files = Array.from({ length: 400 }, (_, index) => target("untracked", `folder/file-${index}-${"x".repeat(20)}.txt`));
		const command = indexCommand("stage", files, true);
		expect(command.args).toEqual(["add", "--pathspec-from-file=-", "--pathspec-file-nul"]);
		expect(command.input).toBe(files.map(file => `${file.path}\0`).join(""));
		expect(describeGitCommand(command)).toBe("git add --pathspec-from-file=- --pathspec-file-nul, with 400 paths on standard input");
		const few = files.slice(0, Math.floor(MAX_ARGUMENT_CHARACTERS / 60));
		expect(indexCommand("stage", few, true).input).toBeNull();
	});
});

let root: string;

/** Every file under `folder` but Git's own, with its bytes, and the refs and HEAD, so a test can see that only the index changed. */
function snapshot(folder: string): string {
	const files: string[] = [];
	const walk = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			if (entry.name === ".git") continue;
			const path = join(directory, entry.name);
			const stats = lstatSync(path);
			if (stats.isDirectory()) walk(path);
			else files.push(`${path} ${stats.mode} ${stats.isSymbolicLink() ? readlinkSync(path) : createHash("sha256").update(readFileSync(path)).digest("hex")} ${stats.mtimeMs}`);
		}
	};
	walk(folder);
	const plain = (...args: string[]) => Bun.spawnSync(["git", "-C", folder, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } }).stdout.toString();
	return [...files, plain("for-each-ref"), plain("rev-parse", "HEAD"), plain("symbolic-ref", "-q", "HEAD"), plain("stash", "list")].join("\n");
}

/** The index file of a worktree, as bytes, wherever Git keeps it. */
function indexBytes(worktree: string): string {
	const path = git(worktree, "rev-parse", "--path-format=absolute", "--git-path", "index").trim();
	return createHash("sha256").update(readFileSync(path)).digest("hex");
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
		for (const [file, text] of Object.entries({ "keep.txt": "one\n", "gone.txt": "gone\n", "old name.txt": "a\nb\nc\nd\ne\n", "star*.txt": "star\n", "star-other.txt": "other\n" })) writeFileSync(join(primary, file), text);
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

/** Stage or unstage as the window does: the command it shows comes from the list it read. */
async function write(sampled: Sample, action: IndexAction, files: FileChangeTarget[], hasCommit = true) {
	const request = { repository: sampled.primary, worktree: sampled.linked, files, shown: indexCommand(action, files, hasCommit).args };
	return action === "stage" ? sampled.changes.stage(request) : sampled.changes.unstage(request);
}

async function listed(sampled: Sample) {
	const read = await sampled.changes.read({ repository: sampled.primary, worktree: sampled.linked, compare: "uncommitted" });
	if (read.outcome !== "read") throw new Error(read.message);
	return read;
}

// The sample has a `*` in a file name, which Windows does not allow, as in ./file-changes.test.ts.
describe.skipIf(windows)("staging and unstaging in real repositories", () => {
	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-index-")));
	});
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	test("stages an edit, a deletion, and a new file in one git add, and changes only the index", async () => {
		const sampled = sample("stage", linked => {
			writeFileSync(join(linked, "keep.txt"), "one\ntwo\n");
			unlinkSync(join(linked, "gone.txt"));
			mkdirSync(join(linked, "new folder"));
			writeFileSync(join(linked, "new folder", "zażółć.txt"), "new\n");
		});
		const before = snapshot(sampled.linked);
		const primaryBefore = snapshot(sampled.primary);
		const answer = await write(sampled, "stage", [target("unstaged", "keep.txt"), target("unstaged", "gone.txt"), target("untracked", "new folder/zażółć.txt")]);
		expect(answer).toEqual({ outcome: "written", command: "git add -- keep.txt gone.txt 'new folder/zażółć.txt'" });
		expect(status(sampled.linked)).toBe("D  gone.txt\nM  keep.txt\nA  \"new folder/za\\305\\274\\303\\263\\305\\202\\304\\207.txt\"\n");
		expect(snapshot(sampled.linked)).toBe(before);
		expect(snapshot(sampled.primary)).toBe(primaryBefore);
		expect(sampled.written).toEqual([sampled.primary]);
		expect((await listed(sampled)).files.map(file => `${file.area} ${file.kind} ${file.path}`)).toEqual(["staged", "staged", "staged"].map((area, index) => `${area} ${["deleted", "modified", "added"][index]} ${["gone.txt", "keep.txt", "new folder/zażółć.txt"][index]}`));
	});

	test("stages hundreds of files through standard input, a star among them still literal", async () => {
		const names = Array.from({ length: 400 }, (_, index) => `many/file-${index}-${"x".repeat(20)}.txt`);
		const sampled = sample("many", linked => {
			mkdirSync(join(linked, "many"));
			for (const name of names) writeFileSync(join(linked, name), "new\n");
			writeFileSync(join(linked, "star*.txt"), "star 2\n");
			writeFileSync(join(linked, "star-other.txt"), "other 2\n");
		});
		const files = [...names.map(name => target("untracked", name)), target("unstaged", "star*.txt")];
		const answer = await write(sampled, "stage", files);
		expect(answer).toEqual({ outcome: "written", command: "git add --pathspec-from-file=- --pathspec-file-nul, with 401 paths on standard input" });
		const lines = status(sampled.linked).trimEnd().split("\n");
		expect(lines.filter(line => line.startsWith("A  many/"))).toHaveLength(400);
		expect(lines).toContain("M  star*.txt");
		expect(lines).toContain(" M star-other.txt");
	});

	test("takes a path literally: staging star*.txt leaves star-other.txt alone", async () => {
		const sampled = sample("literal", linked => {
			writeFileSync(join(linked, "star*.txt"), "star 2\n");
			writeFileSync(join(linked, "star-other.txt"), "other 2\n");
		});
		expect((await write(sampled, "stage", [target("unstaged", "star*.txt")])).outcome).toBe("written");
		expect(status(sampled.linked)).toBe("M  star*.txt\n M star-other.txt\n");
	});

	test("unstages a staged rename with its old path, and a file staged and then edited keeps its edit", async () => {
		const sampled = sample("rename", linked => {
			git(linked, "mv", "old name.txt", "new name.txt");
			writeFileSync(join(linked, "keep.txt"), "one\nstaged\n");
			git(linked, "add", "keep.txt");
			writeFileSync(join(linked, "keep.txt"), "one\nstaged\nthen edited\n");
		});
		const files = (await listed(sampled)).files;
		const rename = files.find(file => file.kind === "renamed")!;
		expect(rename).toMatchObject({ area: "staged", path: "new name.txt", previousPath: "old name.txt" });
		const before = snapshot(sampled.linked);
		const answer = await write(sampled, "unstage", [rename, target("staged", "keep.txt")]);
		expect(answer).toEqual({ outcome: "written", command: "git restore --staged -- 'old name.txt' 'new name.txt' keep.txt" });
		expect(status(sampled.linked)).toBe(" M keep.txt\n D \"old name.txt\"\n?? \"new name.txt\"\n");
		expect(snapshot(sampled.linked)).toBe(before);
		expect(readFileSync(join(sampled.linked, "keep.txt"), "utf8")).toBe("one\nstaged\nthen edited\n");
	});

	test("marks a conflict resolved, and a modify/delete conflict too, and it leaves the conflicts", async () => {
		const sampled = sample("conflict", linked => {
			writeFileSync(join(linked, "keep.txt"), "ours\n");
			unlinkSync(join(linked, "gone.txt"));
			git(linked, "commit", "-am", "Ours");
			git(linked, "checkout", "-q", "-b", "theirs", "main");
			writeFileSync(join(linked, "keep.txt"), "theirs\n");
			writeFileSync(join(linked, "gone.txt"), "theirs edited\n");
			git(linked, "commit", "-am", "Theirs");
			git(linked, "checkout", "-q", "feat/x");
			Bun.spawnSync(["git", "-C", linked, "-c", "user.name=T", "-c", "user.email=t@example.invalid", "merge", "theirs"]);
		});
		const conflicts = (await listed(sampled)).files.filter(file => file.area === "conflicted");
		expect(conflicts.map(file => file.path).sort()).toEqual(["gone.txt", "keep.txt"]);
		const before = snapshot(sampled.linked);
		writeFileSync(join(sampled.linked, "keep.txt"), "resolved\n");
		const resolved = snapshot(sampled.linked);
		expect(resolved).not.toBe(before);
		const answer = await write(sampled, "stage", conflicts);
		expect(answer.outcome).toBe("written");
		const after = (await listed(sampled)).files;
		expect(after.filter(file => file.area === "conflicted")).toEqual([]);
		expect(after.map(file => `${file.area} ${file.path}`).sort()).toEqual(["staged gone.txt", "staged keep.txt"]);
		// MERGE_HEAD stays: marking resolved does not commit the merge.
		expect(snapshot(sampled.linked)).toBe(resolved);
		expect(git(sampled.linked, "rev-parse", "-q", "--verify", "MERGE_HEAD").trim()).toMatch(/^[0-9a-f]{40}$/);
	});

	test("unstages before the first commit with git rm --cached -f, leaving the files as they are on disk", async () => {
		const sampled = sample("unborn", linked => {
			writeFileSync(join(linked, "first.txt"), "first\n");
			writeFileSync(join(linked, "second.txt"), "second\n");
			git(linked, "add", "first.txt", "second.txt");
			writeFileSync(join(linked, "second.txt"), "second, edited after staging\n");
		}, { commit: false });
		const read = await listed(sampled);
		expect(read.hasCommit).toBe(false);
		const before = snapshot(sampled.linked);
		const answer = await write(sampled, "unstage", [target("staged", "first.txt"), target("staged", "second.txt")], false);
		expect(answer).toEqual({ outcome: "written", command: "git rm --cached -f -- first.txt second.txt" });
		expect(status(sampled.linked)).toBe("?? first.txt\n?? second.txt\n");
		expect(snapshot(sampled.linked)).toBe(before);
		expect(readFileSync(join(sampled.linked, "second.txt"), "utf8")).toBe("second, edited after staging\n");
	});

	test("unstages thousands of files before the first commit through standard input, though git rm prints a line for each", async () => {
		const names = Array.from({ length: 5000 }, (_, index) => `many/file-${index}.txt`);
		const sampled = sample("unborn-many", linked => {
			mkdirSync(join(linked, "many"));
			for (const name of names) writeFileSync(join(linked, name), "new\n");
			git(linked, "add", "many");
		}, { commit: false });
		const files = names.map(name => target("staged", name));
		const answer = await write(sampled, "unstage", files, false);
		expect(answer).toEqual({ outcome: "written", command: "git rm --cached -f --pathspec-from-file=- --pathspec-file-nul, with 5000 paths on standard input" });
		const lines = status(sampled.linked).trimEnd().split("\n");
		expect(lines).toHaveLength(5000);
		expect(lines.every(line => line.startsWith("?? many/"))).toBe(true);
	}, 30_000);

	test("a held index.lock fails with Git's message and changes nothing", async () => {
		const sampled = sample("locked", linked => writeFileSync(join(linked, "keep.txt"), "one\ntwo\n"));
		const lock = git(sampled.linked, "rev-parse", "--path-format=absolute", "--git-path", "index.lock").trim();
		writeFileSync(lock, "");
		const [before, index] = [snapshot(sampled.linked), indexBytes(sampled.linked)];
		const answer = await write(sampled, "stage", [target("unstaged", "keep.txt")]);
		expect(answer.outcome).toBe("failed");
		expect(answer.outcome === "failed" && answer.command).toBe("git add -- keep.txt");
		expect(answer.outcome === "failed" && answer.message).toContain("index.lock': File exists.");
		expect(snapshot(sampled.linked)).toBe(before);
		expect(indexBytes(sampled.linked)).toBe(index);
		unlinkSync(lock);
	});

	test("refuses a file not in the status now, one in the wrong group, a path outside, and a command not shown, before running Git", async () => {
		const sampled = sample("refuse", linked => {
			writeFileSync(join(linked, "keep.txt"), "one\ntwo\n");
			writeFileSync(join(linked, "new.txt"), "new\n");
		});
		const [before, index] = [snapshot(sampled.linked), indexBytes(sampled.linked)];
		const refusedFor = async (action: IndexAction, files: FileChangeTarget[], shown?: string[]) => {
			const request = { repository: sampled.primary, worktree: sampled.linked, files, shown: shown ?? indexCommand(action, files, true).args };
			return action === "stage" ? sampled.changes.stage(request) : sampled.changes.unstage(request);
		};
		// Clean, so not in the list, though Git would happily add it.
		expect(await refusedFor("stage", [target("unstaged", "star-other.txt")])).toEqual({ outcome: "refused", message: "star-other.txt is no longer a change that can be staged in this worktree. Nothing was staged." });
		// One good file and one gone: nothing runs at all.
		expect((await refusedFor("stage", [target("unstaged", "keep.txt"), target("untracked", "nowhere.txt")])).outcome).toBe("refused");
		// The group must be the one Git lists the file in.
		expect((await refusedFor("stage", [target("untracked", "keep.txt")])).outcome).toBe("refused");
		expect((await refusedFor("unstage", [target("unstaged", "keep.txt")])).outcome).toBe("refused");
		expect(await refusedFor("stage", [target("unstaged", "../stage/keep.txt")])).toEqual({ outcome: "refused", message: "../stage/keep.txt is not a path inside the worktree. Nothing was staged." });
		const other = await refusedFor("stage", [target("unstaged", "keep.txt")], ["add", "--", "keep.txt", "new.txt"]);
		expect(other).toEqual({ outcome: "refused", message: "The command is now git add -- keep.txt, not the one that was shown. Nothing was staged. Look at the list again." });
		expect((await refusedFor("stage", [])).outcome).toBe("refused");
		expect(snapshot(sampled.linked)).toBe(before);
		expect(indexBytes(sampled.linked)).toBe(index);
		expect(sampled.written).toEqual([]);
	});

	test("refuses a worktree Timber does not list", async () => {
		const sampled = sample("unlisted", linked => writeFileSync(join(linked, "keep.txt"), "one\ntwo\n"));
		const request = { repository: sampled.primary, worktree: join(root, "elsewhere"), files: [target("unstaged", "keep.txt")], shown: ["add", "--", "keep.txt"] };
		const answer = await sampled.changes.stage(request);
		expect(answer.outcome).toBe("refused");
		expect(answer.outcome === "refused" && answer.message).toContain("Nothing was staged.");
		expect(status(sampled.linked)).toBe(" M keep.txt\n");
	});
});
