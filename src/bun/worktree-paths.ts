import { realpathSync, statSync } from "node:fs";
import { isAbsolute, normalize } from "node:path";
import type { PlacedWorktree } from "../shared/ports";
import { readGit } from "./read-git";
import type { WatchTarget } from "./repository-watcher";

/** `git worktree list` is stopped after this long. */
const LIST_MILLISECONDS = 5000;

/** The worktree paths in `git worktree list --porcelain -z` output, in Git's order. */
export function parseWorktreePaths(output: string): string[] {
	return output.split("\0").filter(field => field.startsWith("worktree ")).map(field => field.slice("worktree ".length));
}

export type ListedWorktrees =
	| { ok: true; worktree: PlacedWorktree; worktrees: PlacedWorktree[] }
	| { ok: false; message: string };

/**
 * The worktree to read ports for, and its repository's other worktrees,
 * without asking Timber: reads come on every reload of the repository, and
 * `timber ls` reads the status of every worktree (see issue 138). As the
 * stamp check does, the repository must be in the app's list; the worktree
 * must be one Git lists for it right now, with its folder there. Git runs
 * read-only (see ./read-git.ts).
 */
export function createWorktreePaths(options: { targets: () => readonly WatchTarget[]; git?: string }) {
	const { targets, git = "git" } = options;
	const canonical = (path: string) => {
		try {
			return realpathSync(path);
		} catch {
			return null;
		}
	};
	return async (repository: string, worktree: string): Promise<ListedWorktrees> => {
		const consequence = "No ports were read.";
		if (!isAbsolute(worktree)) return { ok: false, message: `${worktree} is not a full path. ${consequence}` };
		if (!targets().some(target => target.path === repository)) return { ok: false, message: `${repository} is not a repository in this app's list. ${consequence}` };
		const answer = await readGit(["worktree", "list", "--porcelain", "-z"], { git, cwd: repository, timeoutMs: LIST_MILLISECONDS, stderrBytes: 2048 });
		if (!answer.started || answer.timedOut || answer.exitCode !== 0) return { ok: false, message: `Git could not list the worktrees of ${repository}. ${consequence}` };
		const worktrees = parseWorktreePaths(answer.stdout).map(path => ({ path: normalize(path), canonicalPath: canonical(path) }));
		const found = worktrees.find(candidate => candidate.path === normalize(worktree));
		if (!found) return { ok: false, message: `Git lists no worktree at ${worktree} in ${repository}. ${consequence} Refresh the list.` };
		try {
			if (!statSync(worktree).isDirectory()) throw new Error("not a folder");
		} catch {
			return { ok: false, message: `The folder ${worktree} is missing. ${consequence}` };
		}
		// The interface names the worktree by Timber's path, so that is the one kept.
		return { ok: true, worktree: { ...found, path: worktree }, worktrees: worktrees.map(candidate => candidate === found ? { ...found, path: worktree } : candidate) };
	};
}
