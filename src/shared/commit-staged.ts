/**
 * Committing what is staged from the Changes view: the command, what the
 * window and the main process say to each other about it, and when it may
 * not run. Pure, so the window shows exactly the command the main process
 * runs, and both refuse for the same reasons.
 *
 * A commit is one of the app's own Git writes (see docs/architecture.md): it
 * adds one commit on the worktree's current branch, from the index as it is,
 * and never amends, stages, or pushes.
 */

import { describeCommandLine } from "./command-line";

/**
 * `git commit -F -`: the message comes on standard input, so no editor opens
 * and the command is the same for every message, and the window can show it
 * word for word before it runs. No `--no-verify`: hooks run as in a terminal.
 * No path and no `-a`: only what is staged is committed.
 */
export const COMMIT_ARGUMENTS: readonly string[] = ["commit", "-F", "-"];

/** The command as the window shows it before it runs. */
export const COMMIT_COMMAND_LINE = `${describeCommandLine(["git", ...COMMIT_ARGUMENTS])}, with the message on standard input`;

/** Ends every refusal. */
export const NOT_COMMITTED = "Nothing was committed.";

/** A Git operation that stops part way and waits for the person: committing then would be part of it. */
export type GitOperation = "merge" | "rebase" | "cherry-pick" | "revert";

const OPERATION_WORDS: Record<GitOperation, string> = { "merge": "A merge", "rebase": "A rebase", "cherry-pick": "A cherry-pick", "revert": "A revert" };

/** Ask to commit what is staged in a worktree. */
export interface CommitRequest {
	/** The path of the repository's primary checkout, as in the app's list. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. */
	worktree: string;
	/** The commit message, as typed. */
	message: string;
	/** The arguments the window showed (`COMMIT_ARGUMENTS`). When the command would be another, nothing runs. */
	shown: string[];
}

export type CommitResult =
	/** A commit was made. `commit` is its full hash and `short` the abbreviated one Git gives. */
	| { outcome: "committed"; command: string; commit: string; short: string }
	/** Nothing ran: the worktree is not listed, nothing is staged, the message is empty, or an operation is in progress. */
	| { outcome: "refused"; message: string }
	/** Git ran and made no commit, such as when a hook or signing failed. `message` is what Git and the hooks printed. */
	| { outcome: "failed"; command: string; message: string };

/** Whether a message is empty, as Git would take it: only spaces and line ends. */
export const emptyMessage = (message: string) => message.trim() === "";

/** What decides whether Commit may run. */
export interface CommitState {
	/** How many files are staged. */
	staged: number;
	/** The operation in progress, or null. */
	operation: GitOperation | null;
	/** Whether HEAD is detached, so there is no branch to commit on. */
	detached: boolean;
	message: string;
}

/** Why Commit may not run now, as a sentence, or null when it may. The window shows it by the button; the main process refuses with it. */
export function commitBlocker({ staged, operation, detached, message }: CommitState): string | null {
	if (operation !== null) return `${OPERATION_WORDS[operation]} is in progress. Finish it in the terminal, then commit.`;
	if (detached) return "HEAD is detached, so there is no branch to commit on. Commit in the terminal.";
	if (staged === 0) return "Nothing is staged. Stage the files to commit first.";
	if (emptyMessage(message)) return "Write a commit message first.";
	return null;
}

/**
 * The files whose presence in the Git folder means an operation is in
 * progress, in the order `operationOf` reads them. They are asked of Git with
 * `git rev-parse --git-path`, since a linked worktree keeps its own.
 */
export const OPERATION_MARKERS = ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"] as const;

/** The operation in progress from which `OPERATION_MARKERS` are there, in the same order. A rebase that stopped on a cherry-pick is still a rebase. */
export function operationOf(present: readonly boolean[]): GitOperation | null {
	const [merge, cherryPick, revert, rebaseMerge, rebaseApply] = present;
	if (rebaseMerge || rebaseApply) return "rebase";
	if (merge) return "merge";
	if (cherryPick) return "cherry-pick";
	if (revert) return "revert";
	return null;
}
