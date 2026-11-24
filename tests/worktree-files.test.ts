import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
	fallbackBase: null,
	worktrees: paths.map(path => ({
		id: path, path, canonicalPath: path, branch: "feat/x", head: null, primary: path === primary, detached: false, locked: false, prunable: false,
		pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null, baseCounts: null,
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
		// A link that leads out names its real target, for the window to open read-only, but is not read here.
		expect(escape).toMatchObject({ outcome: "outside", path: "escape.txt", target: outside });
		expect(JSON.stringify(escape)).not.toContain("not yours");
		// A path that steps out says nothing of where it would lead.
		expect(await read("../outside.txt")).not.toHaveProperty("target");
	});

	test("never saves through a link that leads outside the worktree", async () => {
		const answer = await files().write({ repository: primary, worktree: linked, path: "escape.txt", text: "mine\n", expected: null });
		expect(answer).toMatchObject({ outcome: "outside" });
		expect(readFileSync(outside, "utf8")).toBe("not yours\n");
	});

	test("reads nothing in a worktree Timber does not list", async () => {
		expect(await read("README.md", join(root, "elsewhere"))).toMatchObject({ outcome: "not-listed" });
		expect(await files().read({ repository: join(root, "nope"), worktree: linked, path: "report.txt" })).toMatchObject({ outcome: "not-listed" });
	});
});

/** Every entry under a folder, with its kind, size, time, and bytes, so a read that wrote anything shows. */
function snapshot(folder: string): string {
	const lines: string[] = [];
	const walk = (directory: string) => {
		for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
			const path = join(directory, entry.name);
			const found = lstatSync(path);
			const bytes = entry.isFile() ? readFileSync(path).toString("base64") : "";
			lines.push(`${path} ${entry.isDirectory() ? "folder" : entry.isSymbolicLink() ? "link" : entry.isFIFO() ? "pipe" : "file"} ${found.size} ${found.mtimeMs} ${bytes}`);
			if (entry.isDirectory()) walk(path);
		}
	};
	walk(folder);
	return lines.join("\n");
}

// The folder has a pipe and a link, which Windows makes only with extra rights.
describe.skipIf(windows)("reading a file outside every worktree, by its complete path", () => {
	let notes: string;
	const readOutside = (path: string) => createWorktreeFiles({ findRepository: async () => null }).readOutside({ path });

	beforeAll(() => {
		notes = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-notes-")));
		writeFileSync(join(notes, "plan.md"), "# Plan\n\nRead me.\n");
		writeFileSync(join(notes, "image.bin"), "\u0000\u0001\u0002");
		writeFileSync(join(notes, "huge.txt"), "x".repeat(MAX_FILE_BYTES + 5));
		writeFileSync(join(notes, "long.txt"), "row\n".repeat(MAX_FILE_LINES + 1));
		mkdirSync(join(notes, "folder"));
		symlinkSync("plan.md", join(notes, "plan-link.md"));
		symlinkSync("nowhere.txt", join(notes, "dangling.txt"));
		Bun.spawnSync(["mkfifo", join(notes, "pipe")]);
	});

	afterAll(() => {
		rmSync(notes, { recursive: true, force: true });
	});

	test("reads a text file in no repository at all, as it is asked for", async () => {
		expect(await readOutside(join(notes, "plan.md"))).toEqual({ outcome: "read", path: join(notes, "plan.md"), content: { kind: "text", text: "# Plan\n\nRead me.\n", lines: 3 } });
		expect(await readOutside(join(notes, "plan-link.md"))).toMatchObject({ outcome: "read", content: { kind: "text" } });
	});

	test("gives the same notices as a file of a worktree", async () => {
		expect(await readOutside(join(notes, "image.bin"))).toMatchObject({ outcome: "read", content: { kind: "binary" } });
		expect(await readOutside(join(notes, "huge.txt"))).toMatchObject({ outcome: "read", content: { kind: "too-large", bytes: MAX_FILE_BYTES + 5, lines: null } });
		expect(await readOutside(join(notes, "long.txt"))).toMatchObject({ outcome: "read", content: { kind: "too-large", lines: MAX_FILE_LINES + 1 } });
		const gone = join(notes, "gone.txt");
		expect(await readOutside(gone)).toEqual({ outcome: "missing", path: gone, message: `${gone} is not there. It may have been moved or deleted.` });
		expect(await readOutside(join(notes, "dangling.txt"))).toMatchObject({ outcome: "missing", message: `${join(notes, "dangling.txt")} is a link to a file that is not there.` });
		expect(await readOutside(join(notes, "folder"))).toMatchObject({ outcome: "not-a-file", message: `${join(notes, "folder")} is a folder, not a file.` });
		// A pipe nobody writes to would hold a blocking read forever.
		expect(await readOutside(join(notes, "pipe"))).toMatchObject({ outcome: "not-a-file" });
	});

	test("refuses a path that is not complete, without reading", async () => {
		for (const path of ["plan.md", "../plan.md", "./plan.md", "", `${notes}/plan.md\0x`]) {
			expect(await readOutside(path)).toMatchObject({ outcome: "failed" });
		}
		expect(await createWorktreeFiles({ findRepository: async () => null }).readOutside({ path: 42 } as never)).toMatchObject({ outcome: "failed" });
	});

	test("writes nothing: every file and folder is as it was", async () => {
		const before = snapshot(notes);
		for (const name of ["plan.md", "plan-link.md", "image.bin", "huge.txt", "long.txt", "folder", "dangling.txt", "pipe", "gone.txt"]) await readOutside(join(notes, name));
		expect(snapshot(notes)).toBe(before);
	});
});
