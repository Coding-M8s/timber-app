import {
	type BaseComparison, type Comparison, type FileChange, type FileChangesResult, type FileDiffResult, MAX_DIFF_BYTES, MAX_LISTED_FILES, type FileDiffRequest,
	baseName, parseDiff, readDiffOutput, relativePathProblem, savedBaseRef,
} from "../../shared/file-changes";
import type { Worktree } from "../../shared/model";

/**
 * A changed file of the pretend disk, with the text `git diff` would print for
 * it. An entry of the "base" area was committed on the branch, so it shows
 * only when comparing with the base. Every other entry shows in both
 * comparisons, as the main process would list it.
 */
export interface MockFileChange {
	change: FileChange;
	/** Exactly what Git would print. Empty for a file that is no longer changed. */
	patch: string;
	/** The whole file on disk, when it holds more than the patch shows: the unchanged lines between its hunks. */
	text?: string;
}

/**
 * A file of `lines` lines, `const lineN = N;`, with the lines at `edits`
 * changed, as `git diff` prints it with three lines of context, and the
 * whole file on disk. Its hunks leave unchanged lines between them.
 */
export function sampleSpreadEdit(path: string, lines: number, edits: readonly number[]): MockFileChange {
	const old = Array.from({ length: lines }, (_, index) => `export const line${index + 1} = ${index + 1};`);
	const now = old.map((line, index) => (edits.includes(index + 1) ? line.replace(/= (\d+);/, "= $1 * 10;") : line));
	const ranges: [number, number][] = [];
	for (const edit of [...edits].sort((a, b) => a - b)) {
		const [from, to] = [Math.max(1, edit - 3), Math.min(lines, edit + 3)];
		const last = ranges.at(-1);
		if (last && from <= last[1] + 1) last[1] = to;
		else ranges.push([from, to]);
	}
	const hunks = ranges.flatMap(([from, to]) => {
		const body: string[] = [];
		for (let number = from; number <= to; number++) {
			if (edits.includes(number)) body.push(`-${old[number - 1]}`, `+${now[number - 1]}`);
			else body.push(` ${old[number - 1]}`);
		}
		const count = to - from + 1;
		return [`@@ -${from},${count} +${from},${count} @@`, ...body];
	});
	const patch = [`diff --git a/${path} b/${path}`, "index 2c3d4e5..6f7a8b9 100644", `--- a/${path}`, `+++ b/${path}`, ...hunks, ""].join("\n");
	return { change: { area: "unstaged", kind: "modified", path, previousPath: null, added: null, removed: null, version: "" }, patch, text: `${now.join("\n")}\n` };
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
	({ change: { area, kind, path, previousPath, added: null, removed: null, version: "" }, patch });

/**
 * The counts Git would give for a pretend patch: its added and removed lines,
 * none for a binary file or a conflict, and as many for a patch too large to
 * show as for any other.
 */
export function mockLineCounts(change: Pick<FileChange, "kind">, patch: string): { added: number | null; removed: number | null } {
	const diff = parseDiff(patch);
	if (diff.kind !== "text" || change.kind === "conflicted") return { added: null, removed: null };
	const lines = diff.sections.flatMap(section => section.hunks.flatMap(hunk => hunk.lines));
	return { added: lines.filter(line => line.kind === "added").length, removed: lines.filter(line => line.kind === "removed").length };
}

/** A short text that changes with the patch, as the main process's version changes with the file. */
function mockVersion(patch: string): string {
	let hash = 5381;
	for (let index = 0; index < patch.length; index++) hash = (hash * 33 + patch.charCodeAt(index)) >>> 0;
	return `${patch.length.toString(36)}-${hash.toString(36)}`;
}

/** A pretend change as the engine answers it: with its counts and version from its patch. */
const answered = (file: MockFileChange): FileChange => ({ ...structuredClone(file.change), ...mockLineCounts(file.change, file.patch), version: mockVersion(file.patch) });

/** Every kind of change the tab shows, for one worktree of the browser build. */
function gallery(): MockFileChange[] {
	const big = Array.from({ length: 6000 }, (_, index) => `export const row${index} = ${index};`);
	return [
		tracked("base", "modified", "src/tax/report.ts", samplePatch("src/tax/report.ts")),
		tracked("base", "added", "docs/tax.md", sampleNewFilePatch("docs/tax.md", ["# Tax rules", "", "Rates come from the finance team."])),
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
		sampleSpreadEdit("src/invoice/lines.ts", 40, [6, 24]),
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

/**
 * What the pretend Git lists for a worktree: its modified and untracked files
 * as small edits and new files, and a worktree with a saved base has a
 * committed edit of README.md on its branch.
 */
export function derivedFileChanges(worktree: Worktree): MockFileChange[] {
	if (worktree.path === GALLERY_WORKTREE) return gallery();
	if (worktree.changes.kind !== "known") return [];
	return [
		...(worktree.base?.kind === "assigned" || worktree.base?.kind === "commit" ? [tracked("base", "modified", "README.md", samplePatch("README.md"))] : []),
		...worktree.changes.modified.map(path => tracked("unstaged", "modified", path, samplePatch(path))),
		...worktree.changes.untracked.map(path => tracked("unstaged", "untracked", path, sampleNewFilePatch(path))),
	];
}

/** The pretend branch point of every worktree with a usable base. */
export const MOCK_BRANCH_POINT = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

/** Whether the pretend worktree can be compared with its base: any saved base the main process would take, at `MOCK_BRANCH_POINT`. */
export function mockBase(worktree: Worktree): BaseComparison {
	const saved = savedBaseRef(worktree.base);
	if (!saved.ok) return { usable: false, reason: saved.reason };
	return { usable: true, ref: saved.ref, name: baseName(saved.ref), commit: MOCK_BRANCH_POINT };
}

/**
 * The pretend files as one comparison lists them. Uncommitted leaves out what
 * was committed. Base keeps conflicts, lists every other tracked change once
 * in the "base" area, and untracked files in their own.
 */
export function compareMockFiles(files: readonly MockFileChange[], compare: Comparison): MockFileChange[] {
	if (compare === "uncommitted") return files.filter(file => file.change.area !== "base" && file.change.area !== "untracked");
	const listed: MockFileChange[] = files.filter(file => file.change.area === "conflicted" || file.change.area === "base");
	const seen = new Set(listed.map(file => file.change.path));
	for (const file of files) {
		if (file.change.kind === "untracked" || (file.change.area !== "staged" && file.change.area !== "unstaged") || seen.has(file.change.path)) continue;
		seen.add(file.change.path);
		listed.push({ ...file, change: { ...file.change, area: "base" } });
	}
	const untracked = files.filter(file => file.change.kind === "untracked").map(file => ({ ...file, change: { ...file.change, area: "untracked" as const } }));
	return [...listed, ...untracked];
}

/** The comparison the main process would answer with: "base" only when the base can be used. */
const comparedFor = (worktree: Worktree, compare: Comparison): { compared: Comparison; base: BaseComparison } => {
	const base = mockBase(worktree);
	return { compared: compare === "base" && base.usable ? "base" : "uncommitted", base };
};

/** Answer a listing from the pretend files, as the main process would. */
export function listMockFileChanges(all: readonly MockFileChange[], worktree: Worktree, compare: Comparison): FileChangesResult {
	const { compared, base } = comparedFor(worktree, compare);
	const files = compareMockFiles(all, compared);
	return {
		outcome: "read",
		files: files.slice(0, MAX_LISTED_FILES).map(answered),
		more: files.length > MAX_LISTED_FILES,
		compared,
		base,
	};
}

/** Answer a diff from the pretend files, as the main process would, through the same parser. */
export function diffMockFileChange(all: readonly MockFileChange[], worktree: Worktree, request: FileDiffRequest): FileDiffResult {
	const { file } = request;
	for (const path of [file.path, file.previousPath]) {
		const problem = path === null ? null : relativePathProblem(path);
		if (problem !== null) return { outcome: "failed", message: `${problem} No changes were read.` };
	}
	const files = compareMockFiles(all, comparedFor(worktree, request.compare).compared);
	const found = files.find(candidate => candidate.change.area === file.area && candidate.change.path === file.path);
	if (!found) return { outcome: "read", file: null, diff: { kind: "unchanged" } };
	const tooLarge = new TextEncoder().encode(found.patch).byteLength > MAX_DIFF_BYTES;
	return { outcome: "read", file: answered(found), diff: readDiffOutput(tooLarge ? "" : found.patch, tooLarge) };
}
