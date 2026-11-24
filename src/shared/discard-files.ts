/**
 * Discarding files' changes from the Changes view: the commands, which both
 * the window and the main process build with these functions, so the dialog
 * shows exactly the command that runs. Pure, so it is tested without Git.
 *
 * Unlike staging, a discard writes files on disk: it puts a file back as
 * the index or the last commit has it, or deletes an untracked file. It
 * never writes a ref or a commit, and only ever the files it names.
 */

import type { ChangeArea, FileChange, FileChangeTarget } from "./file-changes";
import { type GitCommand, type GitWriteResult, type IndexWriteRequest, MAX_ARGUMENT_CHARACTERS } from "./index-writes";

/** Ask to discard files of one group of a worktree's Uncommitted list, as `IndexWriteRequest` asks to stage them. */
export type DiscardRequest = IndexWriteRequest;

/** How a discard ended (see src/bun/git-writes.ts). */
export type DiscardResult = GitWriteResult;

/** The groups whose files can be discarded. A conflict cannot: finish or abort the merge in the terminal. */
export const DISCARDABLE: readonly ChangeArea[] = ["unstaged", "staged", "untracked"];

/**
 * Whether a file of `area` can be discarded. A staged file is put back as
 * HEAD has it, so not before the first commit, when there is no HEAD.
 */
export const canDiscard = (area: ChangeArea, hasCommit: boolean) => DISCARDABLE.includes(area) && (area !== "staged" || hasCommit);

/**
 * Whether the list offers Discard on a file: one of a group that can be
 * discarded, and never a folder, as Git lists an untracked nested repository
 * (`nested/`), since `git clean` without `-d` would leave it anyway.
 */
export const fileDiscardable = (file: Pick<FileChangeTarget, "area" | "path">, hasCommit: boolean) => canDiscard(file.area, hasCommit) && !file.path.endsWith("/");

/**
 * `git clean` takes no paths on standard input, so the untracked files to
 * delete must fit on the command line, which on Windows holds only about
 * 32,000 characters.
 */
export const MAX_CLEAN_CHARACTERS = 30_000;

/** Said when the untracked files named are too many for one `git clean`. */
export const TOO_MANY_TO_DELETE = "These untracked files are too many to delete in one command. Filter the list to fewer and discard those.";

/** The paths a discard names, each once, in order. A staged rename names where it came from too, so that file comes back. */
export function discardPaths(files: readonly FileChangeTarget[]): string[] {
	const paths = new Set<string>();
	for (const file of files) {
		if (file.area === "staged" && file.previousPath !== null) paths.add(file.previousPath);
		paths.add(file.path);
	}
	return [...paths];
}

/** The command, or why the files cannot be discarded together. */
export type DiscardPlan = { ok: true; command: GitCommand } | { ok: false; message: string };

/**
 * The command that discards `files`, all of one group:
 *
 * - Unstaged: `git restore --worktree -- <paths>`, which puts each file back
 *   as it is staged, or as HEAD has it when nothing of it is staged.
 * - Staged: `git restore --staged --worktree --source=HEAD -- <paths>`, with
 *   a rename's old path, which puts each file back as HEAD has it, in the
 *   index and on disk, and deletes one HEAD does not have.
 * - Untracked: `git clean -f -- <paths>`. Without `-d` it never removes a
 *   folder, and without `-x` never an ignored file.
 *
 * The main process runs it with `GIT_LITERAL_PATHSPECS=1`, so a file named
 * `*` means that one file. Many paths go on standard input, as for staging,
 * except to `git clean`, which cannot take them there.
 */
export function discardCommand(files: readonly FileChangeTarget[], hasCommit: boolean): DiscardPlan {
	const area = files[0]?.area;
	if (area === undefined) return { ok: false, message: "No file was named." };
	if (files.some(file => file.area !== area)) return { ok: false, message: "Files of different groups are discarded apart." };
	if (!canDiscard(area, hasCommit)) {
		return { ok: false, message: area === "staged" ? "A staged file cannot be put back before the first commit. Unstage it first." : "Only unstaged, staged, and untracked files can be discarded." };
	}
	const verb = area === "unstaged" ? ["restore", "--worktree"] : area === "staged" ? ["restore", "--staged", "--worktree", "--source=HEAD"] : ["clean", "-f"];
	const paths = discardPaths(files);
	const length = paths.reduce((total, path) => total + path.length + 1, 0);
	if (area === "untracked") {
		if (length > MAX_CLEAN_CHARACTERS) return { ok: false, message: TOO_MANY_TO_DELETE };
		return { ok: true, command: { args: [...verb, "--", ...paths], input: null } };
	}
	if (length <= MAX_ARGUMENT_CHARACTERS) return { ok: true, command: { args: [...verb, "--", ...paths], input: null } };
	return { ok: true, command: { args: [...verb, "--pathspec-from-file=-", "--pathspec-file-nul"], input: paths.map(path => `${path}\0`).join("") } };
}

/**
 * The staged files of `files` that also have unstaged changes in `listed`:
 * discarding them from Staged puts back HEAD's version on disk too, so
 * their unstaged changes are lost as well, and the dialog says so.
 */
export function alsoUnstaged(files: readonly FileChangeTarget[], listed: readonly Pick<FileChange, "area" | "path">[]): string[] {
	const unstaged = new Set(listed.filter(file => file.area === "unstaged").map(file => file.path));
	return discardPaths(files.filter(file => file.area === "staged")).filter(path => unstaged.has(path));
}
