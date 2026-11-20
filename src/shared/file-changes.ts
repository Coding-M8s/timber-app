/**
 * What changed in a worktree, file by file, and the diff of one file, for the
 * Changes tab. Pure: the main process runs Git (see src/bun/file-changes.ts)
 * and parses what it printed with these functions, and the mock engine and
 * the tests use them too.
 */

import type { SavedBase } from "./model";

/**
 * What the Changes tab compares the worktree with:
 *
 * - "base": everything the branch changed since it left its saved base,
 *   committed or not. The diff from `git merge-base <base> HEAD` to the files
 *   on disk, so commits on the base after the branch point do not show.
 * - "uncommitted": what `git status` lists, against the last commit.
 */
export type Comparison = "base" | "uncommitted";

/** Which comparison a change belongs to. */
export type ChangeArea =
	/** Between the last commit and the index: `git diff --cached`. */
	| "staged"
	/** Between the index and the files on disk, untracked files included: `git diff`. */
	| "unstaged"
	/** A file with merge conflicts. Its diff is Git's combined diff. */
	| "conflicted"
	/** Comparing with the base: between the branch point and the files on disk, `git diff <commit>`. */
	| "base"
	/** Comparing with the base: a file Git does not track, listed on its own. */
	| "untracked";

export type ChangeKind = "modified" | "added" | "deleted" | "renamed" | "copied" | "type-changed" | "untracked" | "conflicted";

/** One changed file in one area. A file staged and then edited again is listed once in each. */
export interface FileChange {
	area: ChangeArea;
	kind: ChangeKind;
	/** Relative to the worktree, with `/` between folders, as Git reports it. */
	path: string;
	/** Where a renamed or copied file came from. Null for every other kind. */
	previousPath: string | null;
}

/** Names one file of the list, to ask for its diff. */
export interface FileChangeTarget {
	area: ChangeArea;
	path: string;
	/** As in the list. The main process reads the status again and only uses it to find the entry. */
	previousPath: string | null;
}

/** Ask for the changed files of a worktree in a repository from the app's list. */
export interface FileChangesRequest {
	/** The path of the repository's primary checkout, as in the app's list. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. */
	worktree: string;
	/** What to compare with. "base" falls back to "uncommitted" when the base cannot be used. */
	compare: Comparison;
}

export interface FileDiffRequest extends FileChangesRequest {
	file: FileChangeTarget;
}

/** At most this many files are listed, so a worktree with a huge untracked folder cannot freeze the window. */
export const MAX_LISTED_FILES = 5000;
/** Git's answer is read up to this many bytes. Beyond it, Git is stopped and the diff is too large to show. */
export const MAX_DIFF_BYTES = 512 * 1024;
/** A diff with more lines than this is not drawn. */
export const MAX_DIFF_LINES = 5000;
/** The status is read up to this many bytes, which holds far more than `MAX_LISTED_FILES` files. */
export const MAX_STATUS_BYTES = 8 * 1024 * 1024;

/**
 * Whether the worktree can be compared with its base. The main process works
 * it out from the base Timber saved, never from anything the window sent.
 */
export type BaseComparison =
	/** `ref` as Timber saved it, `name` as the tab shows it (`baseName`), and `commit` the full hash of the branch point. */
	| { usable: true; ref: string; name: string; commit: string }
	/** No saved base, one Timber cannot use, a ref that is not there, or no shared history. `reason` says which. */
	| { usable: false; reason: string };

export type FileChangesResult =
	/**
	 * `more` is true when there were more files than `MAX_LISTED_FILES`, and
	 * only the first are listed. `compared` is the comparison the files come
	 * from: "uncommitted" when "base" was asked for and cannot be used.
	 */
	| { outcome: "read"; files: FileChange[]; more: boolean; compared: Comparison; base: BaseComparison }
	/** The repository is not in the app's list, Timber does not list the worktree, or its folder is gone. */
	| { outcome: "not-listed"; message: string }
	| { outcome: "failed"; message: string };

export type DiffLineKind = "context" | "added" | "removed" | "note";

export interface DiffLine {
	kind: DiffLineKind;
	/** The line without Git's marker column. A note is Git's own words, such as "No newline at end of file". */
	text: string;
	/** Line numbers in the old and the new file. Null where the line is not in that file, and in a combined diff. */
	oldLine: number | null;
	newLine: number | null;
}

export interface DiffHunk {
	/** Git's hunk line, such as `@@ -1,3 +1,4 @@ function name`. */
	header: string;
	lines: DiffLine[];
}

/**
 * One file section of Git's output. Usually there is one. A file that turned
 * from a link into a plain file, for example, comes as a deletion and an
 * addition.
 */
export interface DiffSection {
	/** Git's extended header lines worth showing, such as `new file mode 100644` or `rename from a.txt`. */
	header: string[];
	hunks: DiffHunk[];
}

export type FileDiff =
	| { kind: "text"; sections: DiffSection[] }
	/** Git found the file binary, so there is no text to show. */
	| { kind: "binary" }
	/** More than `MAX_DIFF_BYTES` or `MAX_DIFF_LINES`. `lines` is null when Git was stopped before the end. */
	| { kind: "too-large"; lines: number | null }
	/** The file is no longer changed in that area, for example because it was committed since the list was read. */
	| { kind: "unchanged" };

export type FileDiffResult =
	| { outcome: "read"; file: FileChange | null; diff: FileDiff }
	| { outcome: "not-listed"; message: string }
	| { outcome: "failed"; message: string };

/**
 * Global options for every query: paths are taken as they are, never as
 * patterns, so a file named `*` means that one file.
 */
const LITERAL = ["--literal-pathspecs"];

/**
 * How the status is asked for: machine-readable, NUL-separated, so any file
 * name comes through, and every untracked file on its own instead of its
 * folder. `paths` limits it to those files.
 */
export function statusArguments(paths: readonly string[] = []): string[] {
	return [...LITERAL, "status", "--porcelain=v2", "-z", "--untracked-files=all", ...(paths.length > 0 ? ["--", ...paths] : [])];
}

/**
 * Options for every diff: no colors, no external diff program and no text
 * conversion from the person's configuration, so the output is Git's own
 * patch text.
 */
const PLAIN_DIFF = ["--no-color", "--no-ext-diff", "--no-textconv"];

/** A full commit hash, as Git prints it: SHA-1 or SHA-256. */
const COMMIT = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

/** Whether a text is a full commit hash, safe to give Git as a revision. */
export const isCommitHash = (text: string) => COMMIT.test(text);

/**
 * The Git arguments that print the diff of one listed file, run in the
 * worktree. Exit code 1 means "there are differences" for `--no-index`. A
 * file of the "base" area needs the branch point, `commit`.
 */
export function diffArguments(file: FileChange, commit: string | null = null): { args: string[]; differencesExit: boolean } {
	if (file.kind === "untracked") {
		// Not in the index, so Git compares it with nothing: every line is an addition.
		return { args: ["diff", ...PLAIN_DIFF, "--no-index", "--", "/dev/null", file.path], differencesExit: true };
	}
	let area: string[] = [];
	if (file.area === "staged") area = ["--cached"];
	if (file.area === "base") {
		if (commit === null || !isCommitHash(commit)) throw new Error("A diff with the base needs the full hash of the branch point.");
		area = [commit];
	}
	const paths = file.previousPath === null ? [file.path] : [file.previousPath, file.path];
	const detect = file.kind === "renamed" ? ["-M"] : file.kind === "copied" ? ["-C", "--find-copies-harder"] : [];
	const options = file.area === "base" ? [...detect, ...area] : [...area, ...detect];
	return { args: [...LITERAL, "diff", ...PLAIN_DIFF, ...options, "--", ...paths], differencesExit: false };
}

/**
 * The ref to compare with, from the base Timber saved, or why there is none.
 * Only a canonical ref under `refs/` is taken, so it can never be read as an
 * option.
 */
export function savedBaseRef(base: SavedBase | null): { ok: true; ref: string } | { ok: false; reason: string } {
	if (base === null) return { ok: false, reason: "Timber did not report a base for this worktree." };
	switch (base.kind) {
		case "unassigned":
			return { ok: false, reason: "Timber has no base saved for this worktree." };
		case "invalid":
			return { ok: false, reason: "Timber found a saved base for this worktree but cannot use it, so the base is not known." };
		case "assigned":
			if (!base.ref.startsWith("refs/") || base.ref.includes("\0") || /\s/.test(base.ref)) return { ok: false, reason: `The saved base ${base.ref} is not a ref Git can compare with.` };
			return { ok: true, ref: base.ref };
	}
}

/** A saved base as the Changes tab names it: `origin/main` for a remote branch, `main` for a local one, the ref itself otherwise. */
export function baseName(ref: string): string {
	for (const prefix of ["refs/remotes/", "refs/heads/"]) {
		if (ref.startsWith(prefix) && ref.length > prefix.length) return ref.slice(prefix.length);
	}
	return ref;
}

/** Resolve a revision to a commit: prints its full hash, or nothing and exits 1 when there is no such commit. */
export function commitArguments(revision: string): string[] {
	return ["rev-parse", "--verify", "--quiet", "--end-of-options", `${revision}^{commit}`];
}

/** The files changed since the branch point `commit`, committed or not, as names and kinds. `paths` limits it to those files. */
export function baseNamesArguments(commit: string, paths: readonly string[] = []): string[] {
	return [...LITERAL, "diff", "--no-color", "--no-ext-diff", "--name-status", "-z", "-M", commit, "--", ...paths];
}

const NAME_KINDS: Record<string, ChangeKind> = { M: "modified", A: "added", D: "deleted", T: "type-changed", R: "renamed", C: "copied" };

/**
 * Parse `git diff --name-status -z` (see `baseNamesArguments`) into changes of
 * the "base" area, in Git's order. A rename or copy carries a score and two
 * paths, the original first. An unmerged entry ("U") is left out, since the
 * status lists conflicts, and so is a letter not known here and a record
 * that was cut short.
 */
export function parseNameStatus(output: string): FileChange[] {
	const records = output.split("\0");
	// Complete output ends with a NUL, which leaves an empty last record. Cut output leaves a partial one.
	records.pop();
	const files: FileChange[] = [];
	for (let index = 0; index < records.length; index++) {
		const letter = records[index]!.charAt(0);
		const kind = NAME_KINDS[letter];
		const moved = kind === "renamed" || kind === "copied";
		const previous = moved ? records[++index] : null;
		const path = records[++index];
		if (!kind || path === undefined || path === "" || previous === "" || previous === undefined) continue;
		files.push({ area: "base", kind, path, previousPath: moved ? previous : null });
	}
	return files;
}

/**
 * The list when comparing with the base: conflicts as the status reports
 * them, every other change since the branch point from the base diff, and
 * untracked files from the status in an area of their own, so a file that
 * was deleted from Git and is still on disk is listed once as each.
 */
export function sinceBase(status: readonly FileChange[], since: readonly FileChange[]): FileChange[] {
	const conflicted = status.filter(file => file.area === "conflicted");
	const conflictedPaths = new Set(conflicted.map(file => file.path));
	return [
		...conflicted,
		...since.filter(file => !conflictedPaths.has(file.path)),
		...status.filter(file => file.kind === "untracked").map(file => ({ ...file, area: "untracked" as const })),
	];
}

const KINDS: Record<string, ChangeKind> = {
	M: "modified",
	A: "added",
	D: "deleted",
	R: "renamed",
	C: "copied",
	T: "type-changed",
};

/** A field-separated entry, with the path being everything after the given number of fields. */
function splitEntry(record: string, fields: number): { fields: string[]; path: string } | null {
	const parts: string[] = [];
	let rest = record;
	for (let index = 0; index < fields; index++) {
		const space = rest.indexOf(" ");
		if (space < 0) return null;
		parts.push(rest.slice(0, space));
		rest = rest.slice(space + 1);
	}
	return rest === "" ? null : { fields: parts, path: rest };
}

/**
 * Parse `git status --porcelain=v2 -z` (see `statusArguments`) into changed
 * files, in Git's order. A file with both staged and unstaged changes comes
 * once for each. Untracked files are unstaged additions of the kind
 * "untracked". Ignored files and header lines are left out, and so is a
 * record that does not fit. Output that was cut short loses its last,
 * partial record, and a rename whose original path was cut off.
 */
export function parseStatus(output: string): FileChange[] {
	const records = output.split("\0");
	// Complete output ends with a NUL, which leaves an empty last record. Cut output leaves a partial one.
	records.pop();
	const files: FileChange[] = [];
	for (let index = 0; index < records.length; index++) {
		const record = records[index]!;
		const type = record.charAt(0);
		if (type === "?") {
			const path = record.slice(2);
			if (record.charAt(1) === " " && path !== "") files.push({ area: "unstaged", kind: "untracked", path, previousPath: null });
		} else if (type === "1") {
			const entry = splitEntry(record, 8);
			if (entry) pushTracked(files, entry.fields[1]!, entry.path, null);
		} else if (type === "2") {
			const entry = splitEntry(record, 9);
			// The original path is the next record. Without it the entry cannot be read.
			const previous = records[index + 1];
			index++;
			if (entry && previous !== undefined && previous !== "") pushTracked(files, entry.fields[1]!, entry.path, previous);
		} else if (type === "u") {
			const entry = splitEntry(record, 10);
			if (entry) files.push({ area: "conflicted", kind: "conflicted", path: entry.path, previousPath: null });
		}
	}
	return files;
}

/** One `1` or `2` entry: XY is the index status, then the worktree status, `.` for unchanged. */
function pushTracked(files: FileChange[], xy: string, path: string, previousPath: string | null): void {
	if (xy.length !== 2) return;
	const [staged, unstaged] = [xy.charAt(0), xy.charAt(1)];
	const stagedKind = KINDS[staged];
	if (stagedKind) {
		const moved = stagedKind === "renamed" || stagedKind === "copied";
		files.push({ area: "staged", kind: stagedKind, path, previousPath: moved ? previousPath : null });
	}
	const unstagedKind = KINDS[unstaged];
	if (unstagedKind) {
		// A rename in the work tree only shows for a file added with intent to add. Otherwise the original path belongs to the staged rename.
		const moved = unstagedKind === "renamed" || unstagedKind === "copied";
		files.push({ area: "unstaged", kind: unstagedKind, path, previousPath: moved ? previousPath : null });
	}
}

/** The extended header lines that only repeat what the list already shows, or Git's bookkeeping. */
const SKIPPED_HEADER = /^(diff --git |diff --cc |diff --combined |index |--- |\+\+\+ )/;
const HUNK = /^(@{2,}) /;
const PLAIN_HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * The lines of Git's output, without the line break at the very end. A
 * carriage return is part of a line, as Git prints it.
 */
function linesOf(output: string): string[] {
	const lines = output.split("\n");
	if (lines.at(-1) === "") lines.pop();
	return lines;
}

/**
 * What one diff of Git amounts to (see `diffArguments`). `truncated` says that
 * Git was stopped at `MAX_DIFF_BYTES`. Empty output means the file is no
 * longer changed there.
 */
export function readDiffOutput(output: string, truncated: boolean): FileDiff {
	if (truncated) return { kind: "too-large", lines: null };
	const lines = linesOf(output);
	if (lines.length === 0) return { kind: "unchanged" };
	if (lines.length > MAX_DIFF_LINES) return { kind: "too-large", lines: lines.length };
	return parseDiff(lines);
}

/**
 * Parse Git's patch text into sections, hunks, and lines. Both plain diffs
 * (`@@`) and combined diffs of conflicted files (`@@@`, one marker column per
 * parent) are read. A line is removed when any column says `-`, added when any
 * says `+`, and context otherwise. An empty line in a hunk is context, as
 * `diff.suppressBlankEmpty` prints it.
 */
export function parseDiff(input: string | readonly string[]): FileDiff {
	const lines = typeof input === "string" ? linesOf(input) : input;
	const sections: DiffSection[] = [];
	let section: DiffSection | null = null;
	let hunk: DiffHunk | null = null;
	let columns = 1;
	let oldLine = 0;
	let newLine = 0;
	let numbered = false;

	for (const line of lines) {
		if (line.startsWith("diff ")) {
			section = { header: [], hunks: [] };
			sections.push(section);
			hunk = null;
			continue;
		}
		if (section === null) {
			section = { header: [], hunks: [] };
			sections.push(section);
		}
		const opening = HUNK.exec(line);
		if (opening) {
			columns = opening[1]!.length - 1;
			const plain = columns === 1 ? PLAIN_HUNK.exec(line) : null;
			numbered = plain !== null;
			oldLine = plain ? Number(plain[1]) : 0;
			newLine = plain ? Number(plain[2]) : 0;
			hunk = { header: line, lines: [] };
			section.hunks.push(hunk);
			continue;
		}
		if (hunk === null) {
			if (line.startsWith("Binary files ") || line === "GIT binary patch") return { kind: "binary" };
			if (!SKIPPED_HEADER.test(line)) section.header.push(line);
			continue;
		}
		if (line.startsWith("\\")) {
			hunk.lines.push({ kind: "note", text: line.slice(1).trim(), oldLine: null, newLine: null });
			continue;
		}
		const markers = line.slice(0, columns);
		const text = line.slice(columns);
		if (markers.includes("-")) {
			hunk.lines.push({ kind: "removed", text, oldLine: numbered ? oldLine++ : null, newLine: null });
		} else if (markers.includes("+")) {
			hunk.lines.push({ kind: "added", text, oldLine: null, newLine: numbered ? newLine++ : null });
		} else {
			hunk.lines.push({ kind: "context", text, oldLine: numbered ? oldLine++ : null, newLine: numbered ? newLine++ : null });
		}
	}
	return { kind: "text", sections };
}

/** Whether two entries name the same file in the same area. */
export function sameFileChange(one: FileChangeTarget, other: FileChangeTarget): boolean {
	return one.area === other.area && one.path === other.path && one.previousPath === other.previousPath;
}

/**
 * Why a path from outside cannot name a file in a worktree, or null when it
 * can: it must be relative, with `/` between its parts, and never step out
 * with `..`. Git reports every path that way.
 */
export function relativePathProblem(path: string): string | null {
	if (path === "") return "The file path is empty.";
	if (path.includes("\0")) return "The file path holds a NUL character.";
	if (path.startsWith("/") || path.includes("\\") || /^[A-Za-z]:/.test(path)) return `${path} is not a path inside the worktree.`;
	if (path.split("/").some(part => part === ".." || part === "." || part === "")) return `${path} is not a path inside the worktree.`;
	return null;
}

/**
 * The full path of a file in a worktree, from Git's relative path. On a
 * worktree path written with backslashes, as on Windows, the parts are
 * joined with backslashes too.
 */
export function filePathIn(worktree: string, relative: string): string {
	const backslashes = worktree.includes("\\") && !worktree.includes("/");
	const separator = backslashes ? "\\" : "/";
	const base = worktree.endsWith(separator) ? worktree.slice(0, -1) : worktree;
	return `${base}${separator}${backslashes ? relative.split("/").join("\\") : relative}`;
}
