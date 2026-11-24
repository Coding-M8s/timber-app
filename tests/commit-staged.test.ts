import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFileChanges } from "../src/bun/file-changes";
import { createGitWrites } from "../src/bun/git-writes";
import { createRepositoryTurns } from "../src/bun/repository-turns";
import { COMMIT_ARGUMENTS, COMMIT_COMMAND_LINE, type CommitRequest, commitBlocker, operationOf } from "../src/shared/commit-staged";
import type { Repository } from "../src/shared/model";
import { windows } from "./support/runtime";
import { git } from "./support/timber";

describe("when Commit may run", () => {
	const ready = { staged: 2, operation: null, detached: false, message: "Fix the thing" };

	test("runs with something staged, a message, a branch, and nothing in progress", () => {
		expect(commitBlocker(ready)).toBeNull();
		expect(COMMIT_ARGUMENTS).toEqual(["commit", "-F", "-"]);
		expect(COMMIT_COMMAND_LINE).toBe("git commit -F -, with the message on standard input");
	});

	test("says why not, an operation in progress first, then a detached HEAD, nothing staged, and an empty message", () => {
		expect(commitBlocker({ ...ready, operation: "merge", staged: 0, message: "" })).toBe("A merge is in progress. Finish it in the terminal, then commit.");
		expect(commitBlocker({ ...ready, operation: "rebase" })).toBe("A rebase is in progress. Finish it in the terminal, then commit.");
		expect(commitBlocker({ ...ready, operation: "cherry-pick" })).toBe("A cherry-pick is in progress. Finish it in the terminal, then commit.");
		expect(commitBlocker({ ...ready, detached: true, staged: 0 })).toBe("HEAD is detached, so there is no branch to commit on. Commit in the terminal.");
		expect(commitBlocker({ ...ready, staged: 0, message: "" })).toBe("Nothing is staged. Stage the files to commit first.");
		expect(commitBlocker({ ...ready, message: " \n\t\n" })).toBe("Write a commit message first.");
	});

	test("a rebase that stopped on a cherry-pick is a rebase", () => {
		expect(operationOf([false, false, false, false, false])).toBeNull();
		expect(operationOf([true, false, false, false, false])).toBe("merge");
		expect(operationOf([false, true, false, true, false])).toBe("rebase");
		expect(operationOf([false, false, false, false, true])).toBe("rebase");
		expect(operationOf([false, false, true, false, false])).toBe("revert");
	});
});

let root: string;

/** The person's own Git config stays out, so no hook path or signing of theirs runs, and commits get a test identity. */
const ISOLATED = {
	GIT_CONFIG_GLOBAL: "", GIT_CONFIG_NOSYSTEM: "1",
	GIT_AUTHOR_NAME: "Timber Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Timber Test", GIT_COMMITTER_EMAIL: "test@example.invalid",
};

/** Every file under `folder` but Git's own, with its bytes, and the refs and HEAD. */
function snapshot(folder: string): string {
	const files: string[] = [];
	const walk = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			if (entry.name === ".git") continue;
			const path = join(directory, entry.name);
			const stats = lstatSync(path);
			if (stats.isDirectory()) walk(path);
			else files.push(`${path} ${stats.mode} ${stats.isSymbolicLink() ? readlinkSync(path) : createHash("sha256").update(readFileSync(path)).digest("hex")}`);
		}
	};
	walk(folder);
	return [...files, plain(folder, "for-each-ref"), plain(folder, "rev-parse", "HEAD"), plain(folder, "symbolic-ref", "-q", "HEAD")].join("\n");
}

const plain = (folder: string, ...args: string[]) => Bun.spawnSync(["git", "-C", folder, ...args], { env: { ...process.env, ...ISOLATED, GIT_OPTIONAL_LOCKS: "0" } }).stdout.toString();

/** What the index holds: each path with its mode and blob. A failed commit may still refresh the index's cached file times, as in a terminal. */
const indexEntries = (worktree: string) => plain(worktree, "ls-files", "--stage");

/** The index file of a worktree, as bytes. */
const indexBytes = (worktree: string) => createHash("sha256").update(readFileSync(plain(worktree, "rev-parse", "--path-format=absolute", "--git-path", "index").trim())).digest("hex");

interface Sample {
	primary: string;
	linked: string;
	written: string[];
	changes: ReturnType<typeof createFileChanges>;
	commit: (message: string, shown?: string[]) => ReturnType<ReturnType<typeof createFileChanges>["commit"]>;
}

/** A repository with a linked worktree on feat/x, as the app's list answers for it, and the Changes side over both. */
function sample(name: string, setUp: (linked: string) => void, { commit = true, commitMilliseconds }: { commit?: boolean; commitMilliseconds?: number } = {}): Sample {
	const primary = join(root, name);
	const linked = join(root, `${name}-worktrees`, "feat x");
	git(root, "init", "--initial-branch=main", primary);
	if (commit) {
		for (const [file, text] of Object.entries({ "keep.txt": "one\n", "other.txt": "other\n" })) writeFileSync(join(primary, file), text);
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
	const writes = createGitWrites({ findRepository, turns: createRepositoryTurns(), onWritten: repository => written.push(repository), environment: ISOLATED });
	const changes = createFileChanges({ findRepository, writes, ...(commitMilliseconds === undefined ? {} : { commitMilliseconds }) });
	const request = (message: string, shown: string[]): CommitRequest => ({ repository: primary, worktree: linked, message, shown });
	return { primary, linked, written, changes, commit: (message, shown = [...COMMIT_ARGUMENTS]) => changes.commit(request(message, shown)) };
}

/** Put a hook in the repository's shared hooks folder, where a linked worktree's commit finds it. */
function hook(sampled: Sample, name: string, script: string) {
	const common = plain(sampled.linked, "rev-parse", "--path-format=absolute", "--git-common-dir").trim();
	const path = join(common, "hooks", name);
	writeFileSync(path, `#!/bin/sh\n${script}\n`);
	chmodSync(path, 0o755);
}

// Hooks here are shell scripts, which Windows does not run as Git does elsewhere.
describe.skipIf(windows)("committing in real repositories", () => {
	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-commit-")));
	});
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	test("commits only what is staged: a file edited again after staging keeps its edit, and unstaged and untracked files stay", async () => {
		const sampled = sample("partial", linked => {
			writeFileSync(join(linked, "keep.txt"), "one\nstaged\n");
			git(linked, "add", "keep.txt");
			writeFileSync(join(linked, "keep.txt"), "one\nstaged\nnot staged\n");
			writeFileSync(join(linked, "other.txt"), "other\nnot staged\n");
			writeFileSync(join(linked, "new.txt"), "new\n");
		});
		const before = plain(sampled.linked, "rev-parse", "HEAD").trim();
		const message = "Stage only the first line\n\n# Kept: a message from -F is not stripped of comments.\n";
		const answer = await sampled.commit(message);
		expect(answer.outcome).toBe("committed");
		if (answer.outcome !== "committed") return;
		expect(answer.command).toBe(COMMIT_COMMAND_LINE);
		expect(answer.commit).toBe(plain(sampled.linked, "rev-parse", "HEAD").trim());
		expect(answer.short).toBe(plain(sampled.linked, "rev-parse", "--short", "HEAD").trim());
		expect(plain(sampled.linked, "rev-parse", "HEAD^").trim()).toBe(before);
		expect(plain(sampled.linked, "symbolic-ref", "HEAD").trim()).toBe("refs/heads/feat/x");
		expect(plain(sampled.linked, "log", "-1", "--format=%B")).toBe(`${message}\n`);
		expect(plain(sampled.linked, "show", "HEAD:keep.txt")).toBe("one\nstaged\n");
		expect(plain(sampled.linked, "show", "--name-only", "--format=", "HEAD")).toBe("keep.txt\n");
		expect(readFileSync(join(sampled.linked, "keep.txt"), "utf8")).toBe("one\nstaged\nnot staged\n");
		expect(plain(sampled.linked, "status", "--porcelain")).toBe(" M keep.txt\n M other.txt\n?? new.txt\n");
		expect(sampled.written).toEqual([sampled.primary]);
		// The primary checkout's branch did not move.
		expect(plain(sampled.primary, "log", "-1", "--format=%s", "main").trim()).toBe("Files");
	});

	test("makes the first commit of a branch with no commit yet", async () => {
		const sampled = sample("first", linked => {
			writeFileSync(join(linked, "first.txt"), "first\n");
			git(linked, "add", "first.txt");
		}, { commit: false });
		const answer = await sampled.commit("First");
		expect(answer.outcome).toBe("committed");
		expect(plain(sampled.linked, "log", "--format=%s", "feat/x").trim()).toBe("First");
	});

	test("a failing pre-commit hook makes no commit, changes nothing, and answers with what it printed", async () => {
		const sampled = sample("hook-fails", linked => {
			writeFileSync(join(linked, "keep.txt"), "one\ntwo\n");
			git(linked, "add", "keep.txt");
			writeFileSync(join(linked, "other.txt"), "other\nnot staged\n");
		});
		hook(sampled, "pre-commit", "echo 'lint: checking'\necho 'lint: 2 problems in keep.txt' >&2\nexit 1");
		const [before, index] = [snapshot(sampled.linked), indexEntries(sampled.linked)];
		const answer = await sampled.commit("Will not happen");
		expect(answer).toEqual({ outcome: "failed", command: COMMIT_COMMAND_LINE, message: expect.stringContaining("lint: 2 problems in keep.txt") });
		expect(answer.outcome === "failed" && answer.message).toContain("lint: checking");
		expect(snapshot(sampled.linked)).toBe(before);
		expect(indexEntries(sampled.linked)).toBe(index);
		expect(plain(sampled.linked, "status", "--porcelain")).toBe("M  keep.txt\n M other.txt\n");
	});

	test("a hook that prints a lot and passes still commits, and its end is kept when one fails", async () => {
		const sampled = sample("chatty", linked => {
			writeFileSync(join(linked, "keep.txt"), "one\ntwo\n");
			git(linked, "add", "keep.txt");
		});
		// About 400 KB on each stream, far past what a pipe holds.
		hook(sampled, "pre-commit", "i=0\nwhile [ $i -lt 5000 ]; do echo \"line $i of a long test run that prints a great deal\"; echo \"warning $i of a long test run that prints a great deal\" >&2; i=$((i+1)); done\nexit 0");
		expect((await sampled.commit("Chatty hook")).outcome).toBe("committed");
		writeFileSync(join(sampled.linked, "keep.txt"), "one\ntwo\nthree\n");
		git(sampled.linked, "add", "keep.txt");
		hook(sampled, "pre-commit", "i=0\nwhile [ $i -lt 5000 ]; do echo \"warning $i of a long test run that prints a great deal\" >&2; i=$((i+1)); done\necho 'FAILED: 1 test' >&2\nexit 1");
		const failed = await sampled.commit("Fails at the end");
		expect(failed.outcome).toBe("failed");
		expect(failed.outcome === "failed" && failed.message.endsWith("FAILED: 1 test")).toBe(true);
	}, 30_000);

	test("hooks run in the person's environment: paths are not literal, the index may refresh, and the locale is theirs", async () => {
		const seen = join(root, "seen-environment");
		const sampled = sample("environment", linked => {
			writeFileSync(join(linked, "keep.txt"), "one\ntwo\n");
			git(linked, "add", "keep.txt");
		});
		hook(sampled, "pre-commit", `echo "\${GIT_LITERAL_PATHSPECS-unset} \${GIT_OPTIONAL_LOCKS-unset} \${LC_ALL-unset}" > '${seen}'\ngit diff --cached --name-only -- '*.txt' >> '${seen}'`);
		expect((await sampled.commit("Environment")).outcome).toBe("committed");
		expect(readFileSync(seen, "utf8")).toBe(`unset unset ${process.env.LC_ALL ?? "unset"}\nkeep.txt\n`);
	});

	test("a hook that takes too long is stopped, and no commit is made", async () => {
		const sampled = sample("slow", linked => {
			writeFileSync(join(linked, "keep.txt"), "one\ntwo\n");
			git(linked, "add", "keep.txt");
		}, { commitMilliseconds: 500 });
		hook(sampled, "pre-commit", "echo 'starting a slow check'\nexec sleep 5");
		const before = plain(sampled.linked, "rev-parse", "HEAD");
		const answer = await sampled.commit("Too slow");
		expect(answer.outcome).toBe("failed");
		expect(answer.outcome === "failed" && answer.message).toContain("Git took longer than 0.5 seconds and was stopped.");
		expect(plain(sampled.linked, "rev-parse", "HEAD")).toBe(before);
	});

	test("refuses with nothing staged, an empty message, and a command not shown, before running Git", async () => {
		const sampled = sample("refuse", linked => {
			writeFileSync(join(linked, "keep.txt"), "one\ntwo\n");
			writeFileSync(join(linked, "new.txt"), "new\n");
		});
		const [before, index] = [snapshot(sampled.linked), indexBytes(sampled.linked)];
		expect(await sampled.commit("Nothing staged")).toEqual({ outcome: "refused", message: "Nothing is staged. Stage the files to commit first. Nothing was committed." });
		expect([snapshot(sampled.linked), indexBytes(sampled.linked)]).toEqual([before, index]);
		git(sampled.linked, "add", "keep.txt");
		const staged = [snapshot(sampled.linked), indexBytes(sampled.linked)];
		expect(await sampled.commit("  \n")).toEqual({ outcome: "refused", message: "Write a commit message first. Nothing was committed." });
		expect(await sampled.commit("Amend", ["commit", "--amend", "-F", "-"])).toEqual({
			outcome: "refused",
			message: "The command is now git commit -F -, with the message on standard input, not the one that was shown. Nothing was committed. Look at the list again.",
		});
		expect(await sampled.commit("Skip hooks", ["commit", "--no-verify", "-F", "-"])).toMatchObject({ outcome: "refused" });
		expect([snapshot(sampled.linked), indexBytes(sampled.linked)]).toEqual(staged);
		expect(sampled.written).toEqual([]);
	});

	test("refuses during a merge and a rebase, and on a detached HEAD, and the list says which", async () => {
		const sampled = sample("operations", linked => {
			writeFileSync(join(linked, "keep.txt"), "ours\n");
			git(linked, "commit", "-am", "Ours");
		});
		git(sampled.primary, "commit", "--allow-empty", "-m", "Base moves");
		writeFileSync(join(sampled.primary, "keep.txt"), "theirs\n");
		git(sampled.primary, "commit", "-am", "Theirs");
		const read = async () => {
			const answer = await sampled.changes.read({ repository: sampled.primary, worktree: sampled.linked, compare: "uncommitted" });
			if (answer.outcome !== "read") throw new Error(answer.message);
			return { operation: answer.operation, detached: answer.detached };
		};
		expect(await read()).toEqual({ operation: null, detached: false });

		Bun.spawnSync(["git", "-C", sampled.linked, "merge", "main"], { env: { ...process.env, ...ISOLATED } });
		writeFileSync(join(sampled.linked, "keep.txt"), "resolved\n");
		git(sampled.linked, "add", "keep.txt");
		expect(await read()).toEqual({ operation: "merge", detached: false });
		let before = snapshot(sampled.linked);
		expect(await sampled.commit("Merge")).toEqual({ outcome: "refused", message: "A merge is in progress. Finish it in the terminal, then commit. Nothing was committed." });
		expect(snapshot(sampled.linked)).toBe(before);
		git(sampled.linked, "merge", "--abort");

		Bun.spawnSync(["git", "-C", sampled.linked, "rebase", "main"], { env: { ...process.env, ...ISOLATED } });
		writeFileSync(join(sampled.linked, "keep.txt"), "resolved\n");
		git(sampled.linked, "add", "keep.txt");
		expect(await read()).toEqual({ operation: "rebase", detached: true });
		before = snapshot(sampled.linked);
		expect(await sampled.commit("Mid rebase")).toEqual({ outcome: "refused", message: "A rebase is in progress. Finish it in the terminal, then commit. Nothing was committed." });
		expect(snapshot(sampled.linked)).toBe(before);
		git(sampled.linked, "rebase", "--abort");

		git(sampled.linked, "checkout", "--detach");
		writeFileSync(join(sampled.linked, "keep.txt"), "detached\n");
		git(sampled.linked, "add", "keep.txt");
		expect(await read()).toEqual({ operation: null, detached: true });
		expect(await sampled.commit("Detached")).toEqual({ outcome: "refused", message: "HEAD is detached, so there is no branch to commit on. Commit in the terminal. Nothing was committed." });
		expect(sampled.written).toEqual([]);
	});

	test("refuses a worktree Timber does not list, and a request that is not complete", async () => {
		const sampled = sample("unlisted", linked => {
			writeFileSync(join(linked, "keep.txt"), "one\ntwo\n");
			git(linked, "add", "keep.txt");
		});
		const answer = await sampled.changes.commit({ repository: sampled.primary, worktree: join(root, "elsewhere"), message: "Elsewhere", shown: [...COMMIT_ARGUMENTS] });
		expect(answer.outcome).toBe("refused");
		expect(answer.outcome === "refused" && answer.message).toContain("Nothing was committed.");
		const broken = await sampled.changes.commit({ repository: sampled.primary, worktree: sampled.linked, message: 42, shown: [...COMMIT_ARGUMENTS] } as unknown as CommitRequest);
		expect(broken).toEqual({ outcome: "refused", message: "The request is not complete. Nothing was committed." });
		expect(sampled.written).toEqual([]);
	});
});
