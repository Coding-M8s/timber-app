/**
 * Staging and unstaging files from the Changes view: the commands, and what
 * the window and the main process say to each other about them. Pure, so the
 * window shows exactly the command the main process runs, and both build it
 * with these functions.
 *
 * These are the app's own index writes (see docs/architecture.md): they
 * change only the index of a worktree Timber lists, never a ref, a commit, or
 * a file on disk.
 */

import { describeCommandLine } from "./command-line";
import type { ChangeArea, FileChangeTarget } from "./file-changes";

export type IndexAction = "stage" | "unstage";

/**
 * Git's arguments for one write, after `git`, and what it reads on standard
 * input. Paths are taken literally: the main process runs every command with
 * `GIT_LITERAL_PATHSPECS=1`, so a file named `*` means that one file.
 */
export interface GitCommand {
	args: string[];
	/** The paths, each ended by a NUL, when there are too many for the command line. Null otherwise. */
	input: string | null;
}

/** Ask to stage or unstage files of a worktree's Uncommitted list. */
export interface IndexWriteRequest {
	/** The path of the repository's primary checkout, as in the app's list. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. */
	worktree: string;
	/** Files as the list showed them. The main process reads the status again and takes every path from what Git says now. */
	files: FileChangeTarget[];
	/** The arguments the window showed (`GitCommand.args`). When the command would be another now, nothing runs. */
	shown: string[];
}

/** How one of the app's own Git writes ended (see src/bun/git-writes.ts). */
export type GitWriteResult =
	/** Git changed what it writes. `command` is what ran, as shown. */
	| { outcome: "written"; command: string }
	/** Nothing ran: the worktree is not listed, a file is no longer in the list, or the command is not the one shown. */
	| { outcome: "refused"; message: string }
	/** Git ran and failed, so it changed nothing. `message` is Git's own. */
	| { outcome: "failed"; command: string; message: string };

/** How staging or unstaging ended. */
export type IndexWriteResult = GitWriteResult;

/** The groups whose files can be staged: `git add` stages an edit, a new file, and a resolved conflict. */
export const STAGEABLE: readonly ChangeArea[] = ["unstaged", "untracked", "conflicted"];
/** The group whose files can be unstaged. */
export const UNSTAGEABLE: readonly ChangeArea[] = ["staged"];

/** Whether a file of `area` can take `action`. Only Uncommitted's groups can: Base is review only. */
export const canWriteIndex = (action: IndexAction, area: ChangeArea) => (action === "stage" ? STAGEABLE : UNSTAGEABLE).includes(area);

/** The action a file of the Uncommitted list takes: Stage, or Unstage for a staged one. Null in Base's "Changed" group. */
export function indexActionOf(area: ChangeArea): IndexAction | null {
	if (canWriteIndex("stage", area)) return "stage";
	if (canWriteIndex("unstage", area)) return "unstage";
	return null;
}

/**
 * Beyond this many characters of paths, they go on standard input instead,
 * as Windows allows a command line of only about 32,000 characters.
 */
export const MAX_ARGUMENT_CHARACTERS = 8000;

/** The paths a write names, each once, in order. Unstaging a rename names where it came from too, so the old path's deletion is unstaged with it. */
export function indexPaths(action: IndexAction, files: readonly FileChangeTarget[]): string[] {
	const paths = new Set<string>();
	for (const file of files) {
		if (action === "unstage" && file.previousPath !== null) paths.add(file.previousPath);
		paths.add(file.path);
	}
	return [...paths];
}

/**
 * The command that stages or unstages `files`:
 *
 * - Stage: `git add -- <paths>`. For a conflicted file that marks it resolved.
 * - Unstage: `git restore --staged -- <paths>`, which puts back what the last
 *   commit has. With no commit yet (`hasCommit` false) there is nothing to put
 *   back and `git restore` fails, so it is `git rm --cached -f -- <paths>`,
 *   which leaves the files on disk as untracked. `-f` lets it unstage a file
 *   that was edited again after staging, as `git restore --staged` does.
 *
 * Many paths go on standard input, NUL-separated (`--pathspec-from-file=-
 * --pathspec-file-nul`), rather than past the command line's limit.
 */
export function indexCommand(action: IndexAction, files: readonly FileChangeTarget[], hasCommit: boolean): GitCommand {
	const verb = action === "stage" ? ["add"] : hasCommit ? ["restore", "--staged"] : ["rm", "--cached", "-f"];
	const paths = indexPaths(action, files);
	const length = paths.reduce((total, path) => total + path.length + 1, 0);
	if (length <= MAX_ARGUMENT_CHARACTERS) return { args: [...verb, "--", ...paths], input: null };
	return { args: [...verb, "--pathspec-from-file=-", "--pathspec-file-nul"], input: paths.map(path => `${path}\0`).join("") };
}

/** A command as the window shows it before it runs, such as `git add -- src/a.ts`, with how many paths go on standard input. */
export function describeGitCommand(command: GitCommand): string {
	const line = describeCommandLine(["git", ...command.args]);
	if (command.input === null) return line;
	const count = command.input.split("\0").length - 1;
	return `${line}, with ${count} paths on standard input`;
}

/** Whether two argument lists are the same, word for word. */
export const sameArguments = (one: readonly string[], other: readonly string[]) => one.length === other.length && one.every((word, index) => word === other[index]);
