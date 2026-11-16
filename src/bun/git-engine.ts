import { realpath } from "node:fs/promises";
import { delimiter } from "node:path";
import { BRANCH_SYNC_FORMAT, parseBranchSync } from "../shared/git-parse";
import type { SyncState } from "../shared/model";

/**
 * Read-only Git queries.
 *
 * Timber lists the worktrees (see ./timber-ls.ts). Git is asked directly only
 * for what Timber does not report: which repository a folder belongs to, and
 * how each branch stands against its upstream. Git is always invoked as an
 * executable plus an argument array, never through a shell, and nothing here
 * changes a repository.
 */
async function git(args: readonly string[]): Promise<string | null> {
	try {
		const child = Bun.spawn(["git", ...args], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "ignore",
			// These run in the background, so they must not take the index lock.
			env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
		});
		const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
		return exitCode === 0 ? stdout : null;
	} catch {
		return null;
	}
}

/**
 * The common Git directory of the repository that owns `path`, with links
 * resolved, or null when `path` is not inside a Git repository. Every worktree
 * of one repository answers with the same directory.
 */
export async function commonDirectory(path: string): Promise<string | null> {
	const output = await git(["-C", path, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
	const directory = output?.replace(/\r?\n$/, "");
	if (!directory) return null;
	try {
		return await realpath(directory);
	} catch {
		return directory;
	}
}

/**
 * How every local branch of a repository stands against its upstream, by
 * exact branch name, as of the last fetch. `commonGitDir` is the repository's
 * common Git directory, so this works whatever state its folders are in.
 * Null when Git could not answer.
 */
export async function readBranchSync(commonGitDir: string): Promise<Map<string, SyncState> | null> {
	const output = await git(["--git-dir", commonGitDir, "for-each-ref", `--format=${BRANCH_SYNC_FORMAT}`, "refs/heads"]);
	return output === null ? null : parseBranchSync(output);
}

/**
 * The development override for the repository list: the paths in
 * TIMBER_APP_REPOS, joined by the platform path separator. Null when it is
 * not set, and the app then uses its saved list.
 */
export function overrideRepositoryPaths(environment: Record<string, string | undefined> = process.env): string[] | null {
	const configured = (environment.TIMBER_APP_REPOS ?? "").split(delimiter).map(path => path.trim()).filter(Boolean);
	return configured.length > 0 ? configured : null;
}
