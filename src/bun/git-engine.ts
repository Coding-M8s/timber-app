import { basename, delimiter } from "node:path";
import { parseStatus, parseWorktreeList } from "../shared/git-parse";
import type { Repository, Worktree, WorktreeStatus } from "../shared/model";

/**
 * Read-only Git queries for the sidebar.
 *
 * Installed Git and its worktree metadata are the source of truth, exactly as
 * in Timber. Git is always invoked as an executable plus an argument array,
 * never through a shell. Nothing here changes a repository: creating,
 * rebasing, and removing worktrees belongs to Timber itself.
 */
async function git(cwd: string, args: readonly string[]): Promise<string | null> {
	try {
		const child = Bun.spawn(["git", "-C", cwd, ...args], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "ignore",
			// Status refreshes run in the background, so they must not take the index lock.
			env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
		});
		const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
		return exitCode === 0 ? stdout : null;
	} catch {
		return null;
	}
}

async function readStatus(path: string): Promise<WorktreeStatus | null> {
	const output = await git(path, ["status", "--porcelain=v2", "--branch", "-z"]);
	return output === null ? null : parseStatus(output);
}

/** The repository that owns `path`, or null when it is not inside a Git worktree. */
export async function loadRepository(path: string): Promise<Repository | null> {
	const output = await git(path, ["worktree", "list", "--porcelain", "-z"]);
	if (output === null) return null;
	const entries = parseWorktreeList(output).filter(entry => !entry.bare);
	const primary = entries[0];
	if (!primary) return null;

	const worktrees: Worktree[] = await Promise.all(entries.map(async (entry, index) => ({
		path: entry.path,
		branch: entry.branch,
		head: entry.head,
		primary: index === 0,
		locked: entry.locked,
		prunable: entry.prunable,
		status: entry.prunable ? null : await readStatus(entry.path),
	})));
	return { path: primary.path, name: basename(primary.path), worktrees };
}

/** Load every configured repository, skipping paths that are not repositories and duplicates. */
export async function listRepositories(paths: readonly string[]): Promise<Repository[]> {
	const loaded = await Promise.all(paths.map(loadRepository));
	const seen = new Set<string>();
	return loaded.filter((repository): repository is Repository => {
		if (!repository || seen.has(repository.path)) return false;
		seen.add(repository.path);
		return true;
	});
}

/**
 * Repositories to show. Until the app keeps its own list, they come from
 * TIMBER_APP_REPOS (paths joined by the platform path separator), falling
 * back to the folder the app was started from.
 */
export function configuredRepositoryPaths(environment: Record<string, string | undefined> = process.env): string[] {
	const configured = (environment.TIMBER_APP_REPOS ?? "").split(delimiter).map(path => path.trim()).filter(Boolean);
	return configured.length > 0 ? configured : [process.cwd()];
}
