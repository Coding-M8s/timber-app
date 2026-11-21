import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktreeFiles } from "../src/bun/worktree-files";
import type { Repository } from "../src/shared/model";
import { MAX_FILE_BYTES, MAX_FILE_LINES, type WorktreeFileResult } from "../src/shared/worktree-files";
import { windows } from "./support/runtime";
import { fingerprint, git } from "./support/timber";

let root: string;
let primary: string;
let linked: string;
let outside: string;

const listed = (paths: string[]): Repository => ({
	path: primary, name: "sample", available: true, failure: null,
	setup: "repository",
	worktrees: paths.map(path => ({
		id: path, path, canonicalPath: path, branch: "feat/x", head: null, primary: path === primary, detached: false, locked: false, prunable: false,
		pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null,
	})),
});

const files = () => createWorktreeFiles({ findRepository: async path => path === primary ? listed([primary, linked]) : null });
const read = (path: string, worktree = linked): Promise<WorktreeFileResult> => files().read({ repository: primary, worktree, path });

// The tree has links, which Windows makes only with extra rights.
describe.skipIf(windows)("reading a worktree file from a real repository", () => {
	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-files-")));
		primary = join(root, "sample");
		linked = join(root, "sample-worktrees", "feat x");
		outside = join(root, "outside.txt");
		writeFileSync(outside, "not yours\n");
		git(root, "init", "--initial-branch=main", primary);
		mkdirSync(join(primary, "docs"));
		writeFileSync(join(primary, "docs", "plan.md"), "# Plan\n\nStep one\n");
		writeFileSync(join(primary, "README.md"), "hello\n");
		git(primary, "add", "--all");
		git(primary, "commit", "-m", "Files");
		git(primary, "worktree", "add", "-b", "feat/x", linked);

		// What an agent leaves behind: untracked text, binary, huge, and links.
		writeFileSync(join(linked, "report.txt"), "zażółć\nline two");
		writeFileSync(join(linked, "image.bin"), "\u0000\u0001\u0002");
		writeFileSync(join(linked, "huge.txt"), "x".repeat(MAX_FILE_BYTES + 5));
		writeFileSync(join(linked, "long.txt"), "row\n".repeat(MAX_FILE_LINES + 1));
		symlinkSync(outside, join(linked, "escape.txt"));
		symlinkSync("docs/plan.md", join(linked, "plan-link.md"));
		symlinkSync("nowhere.txt", join(linked, "dangling.txt"));
		Bun.spawnSync(["mkfifo", join(linked, "pipe")]);
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("reads a tracked and an untracked file, and changes no file and no ref", async () => {
		const before = [fingerprint(linked), fingerprint(primary)];
		const index = readFileSync(join(primary, ".git", "index"));
		expect(await read("docs/plan.md")).toEqual({ outcome: "read", path: "docs/plan.md", content: { kind: "text", text: "# Plan\n\nStep one\n", lines: 3 } });
		expect(await read("report.txt")).toEqual({ outcome: "read", path: "report.txt", content: { kind: "text", text: "zażółć\nline two", lines: 2 } });
		expect(await read("README.md", primary)).toEqual({ outcome: "read", path: "README.md", content: { kind: "text", text: "hello\n", lines: 1 } });
		for (const path of ["image.bin", "huge.txt", "long.txt", "escape.txt", "dangling.txt", "pipe", "docs", "gone.txt", "../outside.txt"]) await read(path);
		expect([fingerprint(linked), fingerprint(primary)]).toEqual(before);
		expect(readFileSync(join(primary, ".git", "index"))).toEqual(index);
	});

	test("follows a link that stays inside the worktree", async () => {
		const answer = await read("plan-link.md");
		expect(answer.outcome).toBe("read");
	});

	test("refuses binary and big files clearly", async () => {
		expect(await read("image.bin")).toEqual({ outcome: "read", path: "image.bin", content: { kind: "binary" } });
		expect(await read("huge.txt")).toEqual({ outcome: "read", path: "huge.txt", content: { kind: "too-large", bytes: MAX_FILE_BYTES + 5, lines: null } });
		const long = await read("long.txt");
		expect(long).toEqual({ outcome: "read", path: "long.txt", content: { kind: "too-large", bytes: 4 * (MAX_FILE_LINES + 1), lines: MAX_FILE_LINES + 1 } });
	});

	test("says a missing file, a dangling link, a folder, and a pipe are not readable", async () => {
		expect(await read("gone.txt")).toMatchObject({ outcome: "missing", path: "gone.txt" });
		expect(await read("docs/gone/deeper.txt")).toMatchObject({ outcome: "missing" });
		expect(await read("dangling.txt")).toMatchObject({ outcome: "missing", message: "dangling.txt is a link to a file that is not there." });
		expect(await read("docs")).toMatchObject({ outcome: "not-a-file", message: "docs is a folder, not a file." });
		expect(await read("pipe")).toMatchObject({ outcome: "not-a-file" });
	});

	test("refuses paths and links that lead outside the worktree", async () => {
		expect(await read("../outside.txt")).toMatchObject({ outcome: "outside" });
		expect(await read(outside)).toMatchObject({ outcome: "outside" });
		expect(await read("docs/../../outside.txt")).toMatchObject({ outcome: "outside" });
		const escape = await read("escape.txt");
		expect(escape).toMatchObject({ outcome: "outside" });
		expect(JSON.stringify(escape)).not.toContain("not yours");
	});

	test("reads nothing in a worktree Timber does not list", async () => {
		expect(await read("README.md", join(root, "elsewhere"))).toMatchObject({ outcome: "not-listed" });
		expect(await files().read({ repository: join(root, "nope"), worktree: linked, path: "report.txt" })).toMatchObject({ outcome: "not-listed" });
	});
});
