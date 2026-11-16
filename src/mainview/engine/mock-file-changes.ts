import { type FileChange, type FileChangesResult, type FileDiffResult, MAX_DIFF_BYTES, MAX_LISTED_FILES, type FileDiffRequest, readDiffOutput, relativePathProblem } from "../../shared/file-changes";
import type { Worktree } from "../../shared/model";

/** A changed file of the pretend disk, with the text `git diff` would print for it. */
export interface MockFileChange {
	change: FileChange;
	/** Exactly what Git would print. Empty for a file that is no longer changed. */
	patch: string;
}

const header = (path: string, previous = path) => `diff --git a/${previous} b/${path}\n`;

/** A small edit, as `git diff` prints it. */
export function samplePatch(path: string): string {
	return [
		`${header(path).trimEnd()}`,
		"index 3b18e51..a9c5f02 100644",
		`--- a/${path}`,
		`+++ b/${path}`,
		"@@ -1,6 +1,7 @@",
		' import { readConfig } from "./config";',
		" ",
		"-export const retries = 3;",
		"+export const retries = 5;",
		"+export const backoffMilliseconds = 250;",
		" ",
		" export function connect() {",
		" \treturn readConfig();",
		"",
	].join("\n");
}

/** A new file, as `git diff --no-index /dev/null <file>` prints it. */
export function sampleNewFilePatch(path: string, lines: readonly string[] = ["export const enabled = true;", "export const name = \"sample\";"]): string {
	return [
		header(path).trimEnd(),
		"new file mode 100644",
		"index 0000000..5fe505c",
		"--- /dev/null",
		`+++ b/${path}`,
		`@@ -0,0 +1,${lines.length} @@`,
		...lines.map(line => `+${line}`),
		"",
	].join("\n");
}

const tracked = (area: FileChange["area"], kind: FileChange["kind"], path: string, patch: string, previousPath: string | null = null): MockFileChange =>
	({ change: { area, kind, path, previousPath }, patch });

/** Every kind of change the tab shows, for one worktree of the browser build. */
function gallery(): MockFileChange[] {
	const big = Array.from({ length: 6000 }, (_, index) => `export const row${index} = ${index};`);
	return [
		tracked("conflicted", "conflicted", "src/tax/rates.ts", [
			"diff --cc src/tax/rates.ts",
			"index 223b783,f70f10e..0000000",
			"--- a/src/tax/rates.ts",
			"+++ b/src/tax/rates.ts",
			"@@@ -1,1 -1,1 +1,5 @@@",
			"++<<<<<<< HEAD",
			" +export const vat = 0.21;",
			"++=======",
			"+ export const vat = 0.23;",
			"++>>>>>>> origin/main",
			"",
		].join("\n")),
		tracked("staged", "modified", "src/tax/rules.ts", samplePatch("src/tax/rules.ts")),
		tracked("staged", "renamed", "src/tax/brackets.ts", [
			"diff --git a/src/tax/bands.ts b/src/tax/brackets.ts",
			"similarity index 92%",
			"rename from src/tax/bands.ts",
			"rename to src/tax/brackets.ts",
			"index 1a2b3c4..5d6e7f8 100644",
			"--- a/src/tax/bands.ts",
			"+++ b/src/tax/brackets.ts",
			"@@ -1,3 +1,3 @@",
			"-export const bands = [10, 20, 40];",
			"+export const brackets = [10, 20, 40];",
			" ",
			" export default brackets;",
			"",
		].join("\n"), "src/tax/bands.ts"),
		tracked("staged", "added", "src/tax/exemptions.ts", [
			"diff --git a/src/tax/exemptions.ts b/src/tax/exemptions.ts",
			"new file mode 100644",
			"index 0000000..9a8b7c6",
			"--- /dev/null",
			"+++ b/src/tax/exemptions.ts",
			"@@ -0,0 +1,2 @@",
			"+export const exempt = new Set([\"books\", \"food\"]);",
			"+export const isExempt = (kind: string) => exempt.has(kind);",
			"",
		].join("\n")),
		tracked("staged", "deleted", "src/tax/legacy.ts", [
			"diff --git a/src/tax/legacy.ts b/src/tax/legacy.ts",
			"deleted file mode 100644",
			"index 4d5e6f7..0000000",
			"--- a/src/tax/legacy.ts",
			"+++ /dev/null",
			"@@ -1,2 +0,0 @@",
			"-// Kept for the 2019 reports.",
			"-export const legacy = true;",
			"\\ No newline at end of file",
			"",
		].join("\n")),
		tracked("unstaged", "modified", "src/tax/rules.ts", samplePatch("src/tax/rules.ts").replace("retries = 5", "retries = 8")),
		tracked("unstaged", "modified", "src/invoice/total.ts", samplePatch("src/invoice/total.ts")),
		tracked("unstaged", "modified", "assets/logo.png", [
			"diff --git a/assets/logo.png b/assets/logo.png",
			"index 1f2e3d4..5c6b7a8 100644",
			"Binary files a/assets/logo.png and b/assets/logo.png differ",
			"",
		].join("\n")),
		tracked("unstaged", "modified", "src/generated/rows.ts", [
			"diff --git a/src/generated/rows.ts b/src/generated/rows.ts",
			"index 0a0a0a0..1b1b1b1 100644",
			"--- a/src/generated/rows.ts",
			"+++ b/src/generated/rows.ts",
			`@@ -1,0 +1,${big.length} @@`,
			...big.map(line => `+${line}`),
			"",
		].join("\n")),
		tracked("unstaged", "deleted", "docs/old-notes.md", [
			"diff --git a/docs/old-notes.md b/docs/old-notes.md",
			"deleted file mode 100644",
			"index 7e8f9a0..0000000",
			"--- a/docs/old-notes.md",
			"+++ /dev/null",
			"@@ -1 +0,0 @@",
			"-Notes from the first sprint.",
			"",
		].join("\n")),
		tracked("unstaged", "type-changed", "config/current", [
			"diff --git a/config/current b/config/current",
			"deleted file mode 120000",
			"index 7ad106d..0000000",
			"--- a/config/current",
			"+++ /dev/null",
			"@@ -1 +0,0 @@",
			"-config/2024.json",
			"\\ No newline at end of file",
			"diff --git a/config/current b/config/current",
			"new file mode 100644",
			"index 0000000..b9bca01",
			"--- /dev/null",
			"+++ b/config/current",
			"@@ -0,0 +1 @@",
			"+{ \"year\": 2025 }",
			"",
		].join("\n")),
		tracked("unstaged", "modified", "src/invoice/format.ts", samplePatch("src/invoice/format.ts")),
		tracked("unstaged", "untracked", "src/tax/new rules.ts", sampleNewFilePatch("src/tax/new rules.ts")),
		tracked("unstaged", "untracked", "src/tax/zażółć.ts", sampleNewFilePatch("src/tax/zażółć.ts")),
		tracked("unstaged", "untracked", "notes/todo.md", sampleNewFilePatch("notes/todo.md", ["- check rounding", "- ask finance"])),
		tracked("unstaged", "untracked", "notes/empty.txt", [
			"diff --git a/notes/empty.txt b/notes/empty.txt",
			"new file mode 100644",
			"index 0000000..e69de29",
			"",
		].join("\n")),
		tracked("unstaged", "untracked", "assets/icon.ico", [
			"diff --git a/assets/icon.ico b/assets/icon.ico",
			"new file mode 100644",
			"index 0000000..88768ef",
			"Binary files /dev/null and b/assets/icon.ico differ",
			"",
		].join("\n")),
	];
}

/** The worktree of the browser build that shows every kind of change. */
export const GALLERY_WORKTREE = "/work/billing-worktrees/feat-tax-rules";

/** What the pretend Git lists for a worktree: its modified and untracked files as small edits and new files. */
export function derivedFileChanges(worktree: Worktree): MockFileChange[] {
	if (worktree.path === GALLERY_WORKTREE) return gallery();
	if (worktree.changes.kind !== "known") return [];
	return [
		...worktree.changes.modified.map(path => tracked("unstaged", "modified", path, samplePatch(path))),
		...worktree.changes.untracked.map(path => tracked("unstaged", "untracked", path, sampleNewFilePatch(path))),
	];
}

/** Answer a listing from the pretend files, as the main process would. */
export function listMockFileChanges(files: readonly MockFileChange[]): FileChangesResult {
	return {
		outcome: "read",
		files: files.slice(0, MAX_LISTED_FILES).map(file => structuredClone(file.change)),
		more: files.length > MAX_LISTED_FILES,
	};
}

/** Answer a diff from the pretend files, as the main process would, through the same parser. */
export function diffMockFileChange(files: readonly MockFileChange[], request: FileDiffRequest): FileDiffResult {
	const { file } = request;
	for (const path of [file.path, file.previousPath]) {
		const problem = path === null ? null : relativePathProblem(path);
		if (problem !== null) return { outcome: "failed", message: `${problem} No changes were read.` };
	}
	const found = files.find(candidate => candidate.change.area === file.area && candidate.change.path === file.path);
	if (!found) return { outcome: "read", file: null, diff: { kind: "unchanged" } };
	const tooLarge = new TextEncoder().encode(found.patch).byteLength > MAX_DIFF_BYTES;
	return { outcome: "read", file: structuredClone(found.change), diff: readDiffOutput(tooLarge ? "" : found.patch, tooLarge) };
}
