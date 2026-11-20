import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WatchTarget } from "../src/bun/repository-watcher";
import { createWorktreeStamps } from "../src/bun/worktree-stamp";
import { windows } from "./support/runtime";
import { fingerprint, git } from "./support/timber";

describe.skipIf(windows)("createWorktreeStamps against real repositories", () => {
	let root: string;
	let primary: string;
	let linked: string;
	let stranger: string;
	let targets: WatchTarget[];

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-stamp-")));
		primary = join(root, "sample");
		linked = join(root, "sample-worktrees", "feat");
		stranger = join(root, "stranger");
		git(root, "init", "--initial-branch=main", primary);
		writeFileSync(join(primary, "a.txt"), "one\n");
		git(primary, "add", "a.txt");
		git(primary, "commit", "-m", "First");
		git(primary, "worktree", "add", "-q", "-b", "feat", linked);
		git(root, "init", "--initial-branch=main", stranger);
		targets = [{ path: primary, commonDir: join(primary, ".git") }];
	});

	afterAll(() => rmSync(root, { recursive: true, force: true }));

	const stamps = () => createWorktreeStamps({ targets: () => targets });

	test("changes with an edit, with another edit of the same file, and with a new file", async () => {
		const read = stamps();
		const clean = await read({ repository: primary, worktree: linked });
		expect(clean).not.toBeNull();
		expect(await read({ repository: primary, worktree: linked })).toBe(clean);

		writeFileSync(join(linked, "a.txt"), "two\n");
		const edited = await read({ repository: primary, worktree: linked });
		expect(edited).not.toBe(clean);

		// Still modified, so `git status` prints the same: only the file's size and time tell.
		writeFileSync(join(linked, "a.txt"), "three, longer\n");
		utimesSync(join(linked, "a.txt"), new Date(), new Date(Date.now() + 5000));
		const again = await read({ repository: primary, worktree: linked });
		expect(again).not.toBe(edited);

		writeFileSync(join(linked, "new.txt"), "new\n");
		expect(await read({ repository: primary, worktree: linked })).not.toBe(again);
	});

	test("leaves files, refs, and the index exactly as they were", async () => {
		// Same content, newer time: a plain `git status` would rewrite the index to record it.
		utimesSync(join(primary, "a.txt"), new Date(), new Date(Date.now() + 10_000));
		const before = fingerprint(root);
		const index = readFileSync(join(primary, ".git", "index"));
		const read = stamps();
		await read({ repository: primary, worktree: primary });
		await read({ repository: primary, worktree: linked });
		expect(fingerprint(root)).toBe(before);
		expect(readFileSync(join(primary, ".git", "index")).equals(index)).toBe(true);
	});

	test("answers null for a repository not in the list, a folder of another repository, and a relative path", async () => {
		const read = stamps();
		expect(await read({ repository: stranger, worktree: stranger })).toBeNull();
		expect(await read({ repository: primary, worktree: stranger })).toBeNull();
		expect(await read({ repository: primary, worktree: "sample" })).toBeNull();
		expect(await read({ repository: primary, worktree: join(root, "missing") })).toBeNull();
	});

	test("answers null when Git fails", async () => {
		const read = createWorktreeStamps({ targets: () => targets, git: join(root, "no-such-git") });
		expect(await read({ repository: primary, worktree: primary })).toBeNull();
	});
});
