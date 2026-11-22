import { relativePathProblem } from "../../shared/file-changes";
import { type FolderEntry, type WorktreeFolderResult, entryPath, folderPathProblem, listedEntries } from "../../shared/worktree-folders";
import { type WorktreeFileResult, type WorktreeFileWriteRequest, type WorktreeFileWriteResult, fileContentOf, textToSaveProblem } from "../../shared/worktree-files";
import type { MockFileChange } from "./mock-file-changes";

/**
 * A file on the pretend disk: its text, bytes that are not text, or a folder.
 * `null` in `setWorktreeFile` removes it.
 */
export type MockWorktreeFile = string | { kind: "bytes"; bytes: number[] } | { kind: "folder" };

/** What every pretend worktree holds, besides its changed files. */
const SAMPLE_FILES: Record<string, MockWorktreeFile> = {
	"README.md": "# Sample\n\nA pretend worktree for trying the app without Git.\n",
	"docs/plan.md": [
		"# Plan",
		"",
		"Written by an agent, to be read in the file viewer.",
		"",
		"1. Read the config with `readConfig`.",
		"2. Retry five times, 250 ms apart.",
		"3. Report what failed in `report.txt`.",
		"",
	].join("\n"),
	"report.txt": Array.from({ length: 120 }, (_, index) => `line ${index + 1}: checked`).join("\n") + "\n",
	// A long file, for trying the editor: typing in it should stay smooth.
	"src/long.ts": Array.from({ length: 10_000 }, (_, index) => `\tconst value${index + 1} = compute(${index + 1}, "a line of the long file");`).join("\n") + "\n",
	"logo.png": { kind: "bytes", bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00] },
	docs: { kind: "folder" },
	".gitignore": "node_modules/\n*.log\n",
	"node_modules/left-pad/index.js": "module.exports = (text, width) => text.padStart(width);\n",
	"debug.log": "checked 120 lines\n",
};

/** Whether the pretend `.gitignore` ignores a path: anything in `node_modules`, and every `.log` file. */
export function mockIgnored(path: string): boolean {
	return path === "node_modules" || path.startsWith("node_modules/") || path.endsWith(".log");
}

/** The new side of a changed file, from the text `git diff` would print for it. Null for a deleted or binary one. */
export function newSideOf(change: MockFileChange): string | null {
	if (change.change.kind === "deleted" || change.patch.includes("Binary files")) return null;
	if (change.text !== undefined) return change.text;
	const lines = change.patch.split("\n");
	const start = lines.findIndex(line => line.startsWith("@@"));
	if (start === -1) return null;
	const kept = lines.slice(start).filter(line => !line.startsWith("@@") && !line.startsWith("-") && !line.startsWith("\\") && line !== "");
	return kept.map(line => line.slice(1)).join("\n") + "\n";
}

export interface MockWorktreeFiles {
	read(worktree: string, path: string, changes: readonly MockFileChange[]): WorktreeFileResult;
	set(worktree: string, path: string, file: MockWorktreeFile | null): void;
	/** Save text over a file that is there, as the main process does, refusing as it does. */
	write(request: Pick<WorktreeFileWriteRequest, "path" | "text" | "expected">, worktree: string, changes: readonly MockFileChange[]): WorktreeFileWriteResult;
	/** One folder of the pretend disk, as the main process lists one (see src/bun/worktree-folders.ts). */
	list(worktree: string, folder: string, changes: readonly MockFileChange[], ignored: boolean): WorktreeFolderResult;
}

/** The pretend disk of the file viewer, with the same refusals as the main process (see src/bun/worktree-files.ts). */
export function createMockWorktreeFiles(): MockWorktreeFiles {
	const set = new Map<string, Map<string, MockWorktreeFile | null>>();
	const fileOf = (worktree: string, path: string, changes: readonly MockFileChange[]): MockWorktreeFile | null => {
		const own = set.get(worktree);
		if (own?.has(path)) return own.get(path)!;
		const changed = changes.find(change => change.change.path === path && change.change.kind !== "deleted");
		if (changed) return newSideOf(changed) ?? { kind: "bytes", bytes: [0, 1, 2] };
		return SAMPLE_FILES[path] ?? null;
	};
	const files: MockWorktreeFiles = {
		read(worktree, path, changes) {
			const problem = relativePathProblem(path);
			if (problem !== null) return { outcome: "outside", path, message: `${problem} The file was not read.` };
			const file = fileOf(worktree, path, changes);
			if (file === null) return { outcome: "missing", path, message: `${path} is not in this worktree. It may have been moved or deleted.` };
			if (typeof file === "string") return { outcome: "read", path, content: fileContentOf(new TextEncoder().encode(file), new TextEncoder().encode(file).length) };
			if (file.kind === "folder") return { outcome: "not-a-file", path, message: `${path} is a folder, not a file.` };
			return { outcome: "read", path, content: fileContentOf(new Uint8Array(file.bytes), file.bytes.length) };
		},
		write({ path, text, expected }, worktree, changes) {
			const tooLarge = textToSaveProblem(text);
			if (tooLarge !== null) return { outcome: "too-large", path, message: `${tooLarge} Nothing was saved.` };
			const read = files.read(worktree, path, changes);
			if (read.outcome !== "read") return read.outcome === "outside" ? { ...read, message: read.message.replace("The file was not read.", "Nothing was saved.") } : read;
			const now = read.content;
			if (expected !== null && (now.kind !== "text" || now.text !== expected)) {
				return { outcome: "changed", path, content: now, message: `${path} changed on disk since it was opened. Nothing was saved.` };
			}
			files.set(worktree, path, text);
			const bytes = new TextEncoder().encode(text);
			return { outcome: "saved", path, content: fileContentOf(bytes, bytes.length) };
		},
		list(worktree, folder, changes, ignored) {
			const problem = folderPathProblem(folder);
			if (problem !== null) return { outcome: "outside", folder, message: `${problem} The folder was not listed.` };
			const paths = new Set<string>(Object.keys(SAMPLE_FILES));
			for (const change of changes) if (change.change.kind !== "deleted") paths.add(change.change.path);
			for (const [path, file] of set.get(worktree) ?? []) {
				if (file === null) paths.delete(path);
				else paths.add(path);
			}
			const present = [...paths].filter(path => fileOf(worktree, path, changes) !== null);
			// A folder is there when it is named as one, or when something is in it.
			const folders = new Set(present.filter(path => {
				const file = fileOf(worktree, path, changes);
				return typeof file !== "string" && file?.kind === "folder";
			}));
			for (const path of present) {
				const parts = path.split("/");
				for (let length = 1; length < parts.length; length++) folders.add(parts.slice(0, length).join("/"));
			}
			if (folder !== "" && !folders.has(folder)) {
				return present.includes(folder)
					? { outcome: "missing", folder, message: `${folder} is a file, not a folder.` }
					: { outcome: "missing", folder, message: `${folder} is not in this worktree. It may have been moved or deleted.` };
			}
			const prefix = folder === "" ? "" : `${folder}/`;
			const names = new Set<string>();
			for (const path of [...present, ...folders]) {
				if (!path.startsWith(prefix) || path === folder) continue;
				names.add(path.slice(prefix.length).split("/")[0]!);
			}
			const entries: FolderEntry[] = [...names].map(name => {
				const path = entryPath(folder, name);
				return { name, path, kind: folders.has(path) ? "folder" : "file", ignored: mockIgnored(path) };
			});
			return { outcome: "listed", folder, ...listedEntries(entries, ignored) };
		},
		set(worktree, path, file) {
			const own = set.get(worktree) ?? new Map<string, MockWorktreeFile | null>();
			own.set(path, file);
			set.set(worktree, own);
		},
	};
	return files;
}
