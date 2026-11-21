import type { AppState, FileMode, FileView, UnsavedFileStep, WorkspaceTab } from "./store/state";
import type { Worktree } from "../shared/model";
import { describeQuitRequest } from "../shared/terminal";
import { MAX_FILE_BYTES, MAX_FILE_LINES, type WorktreeFileResult, type WorktreeFileWriteResult, editableText, isMarkdownPath, lineEndingProblem, worktreeRelativePath } from "../shared/worktree-files";

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

/** The text of the file as last read or saved, or null when it is not text. */
export function fileText(view: Pick<FileView, "result">): string | null {
	const { result } = view;
	return result?.outcome === "read" && result.content.kind === "text" ? result.content.text : null;
}

// Worked out once per read, since the store asks after every change and a file may be 1 MiB.
const editTexts = new WeakMap<object, string>();
const endingProblems = new WeakMap<object, string | null>();

/** The text of the file as last read or saved, as it is edited: with plain new lines. Null when it is not text. */
export function editableFileText(view: Pick<FileView, "result">): string | null {
	const { result } = view;
	if (result?.outcome !== "read" || result.content.kind !== "text") return null;
	let text = editTexts.get(result.content);
	if (text === undefined) {
		text = editableText(result.content.text);
		editTexts.set(result.content, text);
	}
	return text;
}

/**
 * Why a file read as text cannot be edited here, or null when it can, or is
 * not text at all (the viewer says why in place of the text).
 */
export function editRefusal(view: Pick<FileView, "result">): string | null {
	const { result } = view;
	if (result?.outcome !== "read" || result.content.kind !== "text") return null;
	let problem = endingProblems.get(result.content);
	if (problem === undefined) {
		problem = lineEndingProblem(result.content.text);
		endingProblems.set(result.content, problem);
	}
	return problem === null ? null : `${problem} Open it in your editor to change it.`;
}

/** Whether the file can be edited here: any file read as text, unless its line endings could not be saved as they were. */
export function canEditFile(view: Pick<FileView, "result">): boolean {
	return fileText(view) !== null && editRefusal(view) === null;
}

/** The mode a file opens in: Markdown rendered, anything else in the editor, which is how it shows. */
export function initialFileMode(path: string): FileMode {
	return isMarkdownPath(path) ? "rendered" : "edit";
}

/** Whether the file holds edits that are not saved: a draft that differs from the file as read, or any draft once the file is no longer text. */
export function hasUnsavedEdits(view: Pick<FileView, "draft" | "result">): boolean {
	if (view.draft === null) return false;
	const text = editableFileText(view);
	return text === null || text !== view.draft;
}

/** How many open files hold unsaved edits, as quitting asks about. */
export function unsavedFileCount(files: AppState["files"]): number {
	return Object.values(files).filter(hasUnsavedEdits).length;
}

/** The paths of the open files that hold unsaved edits, in a stable order. */
export function unsavedFilePaths(files: AppState["files"]): string[] {
	return Object.values(files).filter(hasUnsavedEdits).map(view => view.path).sort();
}

/** A line about files whose unsaved edits would be lost, or null when there are none. */
export function describeUnsavedFiles(paths: readonly string[]): string | null {
	if (paths.length === 0) return null;
	if (paths.length === 1) return `${fileName(paths[0]!)} has unsaved edits, which will be lost.`;
	return `${paths.length} files have unsaved edits, which will be lost.`;
}

/** The question about one file's unsaved edits, by what would drop them. */
export function describeUnsavedFileQuestion(path: string, then: UnsavedFileStep): { title: string; text: string } {
	const name = fileName(path);
	const what = then.kind === "close" ? "Closing it" : then.kind === "read-again" ? "Reading it again" : `Opening ${fileName(then.path)} in its place`;
	return { title: `Save ${name}?`, text: `${path} has edits that are not saved. ${what} drops them unless you save first.` };
}

/** The view after a save answered: the file as saved, or why it was not. */
export function afterSave(view: FileView, answer: WorktreeFileWriteResult): FileView {
	switch (answer.outcome) {
		case "saved":
			return { ...view, saving: false, saveProblem: null, result: { outcome: "read", path: answer.path, content: answer.content } };
		case "changed":
			return { ...view, saving: false, saveProblem: { kind: "changed", message: answer.message } };
		case "too-large":
			return { ...view, saving: false, saveProblem: { kind: "failed", message: answer.message } };
		case "missing":
		case "not-a-file":
		case "outside":
			// Every refusal says nothing was written, once.
			return { ...view, saving: false, saveProblem: { kind: "failed", message: /\bsaved\b/.test(answer.message) ? answer.message : `${answer.message} Nothing was saved.` } };
		case "not-listed":
		case "failed":
			return { ...view, saving: false, saveProblem: { kind: "failed", message: answer.message } };
	}
}

/**
 * The question before quitting: about the sessions that still run, as the
 * main process counted them, and the files with unsaved edits in the window.
 */
export function describeQuitQuestion(live: number, unsavedPaths: readonly string[]): { title: string; text: string; stay: string } {
	const unsaved = describeUnsavedFiles(unsavedPaths);
	if (live <= 0) return { title: "Quit Timber?", text: unsaved ?? "Nothing is running.", stay: "Keep editing" };
	const sessions = describeQuitRequest(live);
	return { title: sessions.title, text: unsaved === null ? sessions.text : `${sessions.text} ${unsaved}`, stay: "Keep running" };
}
