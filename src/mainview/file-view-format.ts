import type { AppState, FileView, WorkspaceTab } from "./store/state";
import type { Worktree } from "../shared/model";
import { MAX_FILE_BYTES, MAX_FILE_LINES, type WorktreeFileResult, worktreeRelativePath } from "../shared/worktree-files";

/**
 * The File tab's rules and words. Pure, so they can be tested without a
 * window.
 */

/** The last part of a path, as the File tab is named. */
export function fileName(path: string): string {
	return path.slice(path.lastIndexOf("/") + 1) || path;
}

/** The File tab's name: the open file's name, or "File" while none is open. */
export function fileTabLabel(view: FileView | undefined): string {
	return view ? fileName(view.path) : "File";
}

const sizeWords = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

/**
 * What the viewer shows in place of the text, or null when it shows the text.
 * Every refusal names the file and what to do instead.
 */
export function describeFileNotice(result: WorktreeFileResult): { title: string; text: string } | null {
	switch (result.outcome) {
		case "read": {
			const { content } = result;
			if (content.kind === "text") return null;
			if (content.kind === "binary") return { title: "Not a text file", text: `${result.path} is binary, so it is not shown here. Open it in your editor or another app.` };
			const limit = content.lines !== null && content.bytes <= MAX_FILE_BYTES
				? `It has ${content.lines.toLocaleString("en-US")} lines; the viewer shows up to ${MAX_FILE_LINES.toLocaleString("en-US")}.`
				: `It is ${sizeWords(content.bytes)}; the viewer shows up to ${sizeWords(MAX_FILE_BYTES)}.`;
			return { title: "Too large to show", text: `${result.path} is too large to show here. ${limit} Open it in your editor.` };
		}
		case "missing":
			return { title: "File not found", text: result.message };
		case "not-a-file":
			return { title: "Not a file", text: result.message };
		case "outside":
			return { title: "Outside this worktree", text: `${result.message} The viewer only reads files inside the worktree.` };
		case "not-listed":
			return { title: "Worktree not available", text: result.message };
		case "failed":
			return { title: "Could not read the file", text: result.message };
	}
}

/**
 * The File tab after a change to the state: open files of worktrees that
 * left the list are forgotten, and when the selected worktree has no open
 * file, the File tab gives way to the Workspace tab, so it never shows
 * empty. Null when nothing needs to change.
 */
export function settleFiles(state: Pick<AppState, "tab" | "selection" | "files" | "repositories">): { tab?: WorkspaceTab; files?: AppState["files"] } | null {
	const change: { tab?: WorkspaceTab; files?: AppState["files"] } = {};
	const ids = Object.keys(state.files);
	if (ids.length > 0) {
		const listed = new Set(state.repositories.flatMap(repository => repository.worktrees.map(worktree => worktree.id)));
		const kept = ids.filter(id => listed.has(id));
		if (kept.length !== ids.length) change.files = Object.fromEntries(kept.map(id => [id, state.files[id]!]));
	}
	const files = change.files ?? state.files;
	if (state.tab === "file" && (state.selection === null || files[state.selection.worktree] === undefined)) change.tab = "workspace";
	return change.tab === undefined && change.files === undefined ? null : change;
}

/**
 * A path to open, relative to the worktree, or null when it is not inside it.
 * An absolute path may start with the worktree's registered path or its real
 * one, since a program may print either, as on macOS under /private.
 */
export function pathInWorktree(worktree: Pick<Worktree, "path" | "canonicalPath">, path: string): string | null {
	const relative = worktreeRelativePath(worktree.path, path);
	if (relative !== null || worktree.canonicalPath === null || worktree.canonicalPath === worktree.path) return relative;
	const absolute = path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:/.test(path);
	return absolute ? worktreeRelativePath(worktree.canonicalPath, path) : null;
}

/** Why the viewer was asked to open something that is not a path inside the worktree. */
export function outsideResult(path: string): WorktreeFileResult {
	return { outcome: "outside", path, message: `${path} is not inside this worktree.` };
}
