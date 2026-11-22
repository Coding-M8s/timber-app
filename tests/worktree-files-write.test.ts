import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWorktreeFiles } from "../src/bun/worktree-files";
import type { Repository } from "../src/shared/model";
import { MAX_FILE_BYTES, type WorktreeFileWriteResult, editableText, textToSave } from "../src/shared/worktree-files";
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
		pathExists: true, changes: { kind: "known", modified: [], untracked: [] }, base: null, issue: null, sync: null, baseCounts: null,
	})),
});

const files = () => createWorktreeFiles({ findRepository: async path => path === primary ? listed([primary, linked]) : null });
const write = (path: string, text: string, expected: string | null, worktree = linked): Promise<WorktreeFileWriteResult> =>
	files().write({ repository: primary, worktree, path, text, expected });
const onDisk = (path: string) => readFileSync(join(linked, path));
/** What Git can see: the refs, the index, and HEAD of both checkouts. */
const gitState = () => [git(primary, "for-each-ref"), git(primary, "rev-parse", "HEAD"), git(linked, "rev-parse", "HEAD"), readFileSync(join(primary, ".git", "index")).toString("hex")];
const entries = (folder: string) => readdirSync(folder).sort();

// The tree has links, which Windows makes only with extra rights.
describe.skipIf(windows)("saving a worktree file in a real repository", () => {
	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-save-")));
		primary = join(root, "sample");
		linked = join(root, "sample-worktrees", "feat x");
		outside = join(root, "outside.md");
		writeFileSync(outside, "not yours\n");
		git(root, "init", "--initial-branch=main", primary);
		mkdirSync(join(primary, "docs"));
		writeFileSync(join(primary, "docs", "plan.md"), "# Plan\n\nStep one\n");
		writeFileSync(join(primary, "notes.md"), "# Notes\n");
		git(primary, "add", "--all");
		git(primary, "commit", "-m", "Files");
		git(primary, "worktree", "add", "-b", "feat/x", linked);

		writeFileSync(join(linked, "windows.md"), "# Title\r\n\r\nLine\r\n");
		writeFileSync(join(linked, "bom.md"), Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from("# Marked\n")]));
		writeFileSync(join(linked, "script.md"), "# Run\n");
		chmodSync(join(linked, "script.md"), 0o750);
		writeFileSync(join(linked, "image.bin"), "\u0000\u0001");
		symlinkSync(outside, join(linked, "escape.md"));
		symlinkSync("docs/plan.md", join(linked, "plan-link.md"));
		symlinkSync("nowhere.md", join(linked, "dangling.md"));
		Bun.spawnSync(["mkfifo", join(linked, "pipe.md")]);
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test("writes only that file: Git sees one changed path, and refs, index, and the folder's entries stay", async () => {
		const refs = gitState();
		const before = entries(join(linked, "docs"));
		const top = entries(linked);
		const primaryBefore = fingerprint(primary);
		expect(await write("docs/plan.md", "# Plan\n\nStep two\n", "# Plan\n\nStep one\n")).toEqual({
			outcome: "saved", path: "docs/plan.md", content: { kind: "text", text: "# Plan\n\nStep two\n", lines: 3 },
		});
		expect(onDisk("docs/plan.md").toString()).toBe("# Plan\n\nStep two\n");
		// Looked at before git status, which refreshes the worktree's index itself.
		expect(fingerprint(primary)).toEqual(primaryBefore);
		expect(gitState()).toEqual(refs);
		expect(entries(join(linked, "docs"))).toEqual(before);
		expect(entries(linked)).toEqual(top);
		expect(git(linked, "status", "--porcelain", "--untracked-files=no")).toBe(" M docs/plan.md\n");
	});

	test("saving unedited text leaves the very same bytes, CR LF and a byte order mark included", async () => {
		for (const path of ["windows.md", "bom.md"]) {
			const bytes = onDisk(path);
			const read = await files().read({ repository: primary, worktree: linked, path });
			if (read.outcome !== "read" || read.content.kind !== "text") throw new Error(`${path} was not read as text`);
			const original = read.content.text;
			const saved = await write(path, textToSave(original, editableText(original)), original);
			expect(saved.outcome).toBe("saved");
			expect(onDisk(path)).toEqual(bytes);
		}
		await write("windows.md", textToSave("# Title\r\n\r\nLine\r\n", "# Title\n\nLine two\n"), "# Title\r\n\r\nLine\r\n");
		expect(onDisk("windows.md").toString()).toBe("# Title\r\n\r\nLine two\r\n");
	});

	test("keeps the file's mode, and writes through a link that stays inside to its target", async () => {
		expect((await write("script.md", "# Run again\n", "# Run\n")).outcome).toBe("saved");
		expect(statSync(join(linked, "script.md")).mode & 0o777).toBe(0o750);
		const target = onDisk("docs/plan.md").toString();
		expect((await write("plan-link.md", "# Linked\n", target)).outcome).toBe("saved");
		expect(lstatSync(join(linked, "plan-link.md")).isSymbolicLink()).toBe(true);
		expect(readlinkSync(join(linked, "plan-link.md"))).toBe("docs/plan.md");
		expect(onDisk("docs/plan.md").toString()).toBe("# Linked\n");
	});

	test("writes nothing when the file changed since it was read, and says what it holds now", async () => {
		writeFileSync(join(linked, "agent.md"), "agent wrote this\n");
		const answer = await write("agent.md", "my edit\n", "what I read\n");
		expect(answer).toMatchObject({ outcome: "changed", path: "agent.md", content: { kind: "text", text: "agent wrote this\n" } });
		expect(onDisk("agent.md").toString()).toBe("agent wrote this\n");
		// Saving anyway is asked for with no expected text.
		expect((await write("agent.md", "my edit\n", null)).outcome).toBe("saved");
		expect(onDisk("agent.md").toString()).toBe("my edit\n");
	});

	test("never creates a file, and refuses folders, pipes, links out, and paths out, leaving every file as it was", async () => {
		const before = [fingerprint(linked), fingerprint(primary), readFileSync(outside, "utf8")];
		expect(await write("new.md", "hello\n", null)).toMatchObject({ outcome: "missing" });
		expect(await write("docs/new/deeper.md", "hello\n", null)).toMatchObject({ outcome: "missing" });
		expect(await write("dangling.md", "hello\n", null)).toMatchObject({ outcome: "missing", message: "dangling.md is a link to a file that is not there." });
		expect(await write("docs", "hello\n", null)).toMatchObject({ outcome: "not-a-file" });
		expect(await write("pipe.md", "hello\n", null)).toMatchObject({ outcome: "not-a-file" });
		expect(await write("escape.md", "hello\n", null)).toMatchObject({ outcome: "outside" });
		expect(await write("../outside.md", "hello\n", null)).toMatchObject({ outcome: "outside" });
		expect(await write(outside, "hello\n", null)).toMatchObject({ outcome: "outside" });
		expect(await write("notes.md", "hello\n", null, join(root, "elsewhere"))).toMatchObject({ outcome: "not-listed" });
		expect(await files().write({ repository: join(root, "nope"), worktree: linked, path: "notes.md", text: "hello\n", expected: null })).toMatchObject({ outcome: "not-listed" });
		expect(await write("notes.md", "x".repeat(MAX_FILE_BYTES + 1), null)).toMatchObject({ outcome: "too-large" });
		expect(await write("image.bin", "hello\n", "\u0000\u0001")).toMatchObject({ outcome: "changed", content: { kind: "binary" } });
		expect([fingerprint(linked), fingerprint(primary), readFileSync(outside, "utf8")]).toEqual(before);
		expect(readdirSync(linked)).not.toContain("new.md");
	});
});
