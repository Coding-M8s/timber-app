import { lstat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { AttendedWorktree } from "../shared/attention";
import { parseStatus, statusArguments } from "../shared/file-changes";
import { commonDirectory } from "./git-engine";
import { readGit } from "./read-git";
import type { WatchTarget } from "./repository-watcher";

/** A status that takes longer than this is stopped, and the check counts as not answered. */
const STAMP_MILLISECONDS = 5000;
/** The changed files whose size and modification time count, so a file edited again changes the stamp too. */
const STATED_FILES = 200;

export interface WorktreeStampOptions {
	/** The repositories in the app's list, with their common Git directories. */
	targets: () => readonly WatchTarget[];
	/** The Git executable. Tests may pass another. */
	git?: string;
	timeoutMilliseconds?: number;
}

/**
 * A short text that changes when the status of a worktree changes, for the
 * periodic check of the selected worktree. Never shown, never logged.
 */
export type ReadStamp = (worktree: Pick<AttendedWorktree, "repository" | "worktree">) => Promise<string | null>;

/**
 * Reads the stamp of a worktree: `git status` with the same options as the
 * Changes tab, plus the size and modification time of the files it lists, so
 * editing a file that was already modified changes the stamp as well.
 *
 * It runs often, so it does not ask Timber. It answers null, and runs no
 * status, unless the repository is in the app's list and the folder belongs
 * to that repository: Git must name the repository's own common directory
 * for it. Git runs with `GIT_OPTIONAL_LOCKS=0`, so the index is never
 * rewritten, and with `core.fsmonitor` off, so a background check starts no
 * monitor from the repository's configuration. Nothing is changed.
 */
export function createWorktreeStamps(options: WorktreeStampOptions): ReadStamp {
	const { targets, git = "git", timeoutMilliseconds = STAMP_MILLISECONDS } = options;

	async function status(folder: string): Promise<string | null> {
		try {
			const answer = await readGit(["-c", "core.fsmonitor=false", ...statusArguments()], { git, cwd: folder, timeoutMs: timeoutMilliseconds });
			return answer.started && answer.exitCode === 0 ? answer.stdout : null;
		} catch {
			return null;
		}
	}

	async function stated(folder: string, path: string): Promise<string> {
		try {
			const stats = await lstat(join(folder, path));
			return `${stats.size}:${stats.mtimeMs}`;
		} catch {
			return "-";
		}
	}

	return async ({ repository, worktree }) => {
		const target = targets().find(candidate => candidate.path === repository);
		if (!target || !isAbsolute(worktree)) return null;
		if (await commonDirectory(worktree) !== target.commonDir) return null;
		const text = await status(worktree);
		if (text === null) return null;
		const files = parseStatus(text).slice(0, STATED_FILES);
		const stats = await Promise.all(files.map(file => stated(worktree, file.path)));
		return Bun.hash(`${text}\0${stats.join("\n")}`).toString(16);
	};
}
