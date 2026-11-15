import { realpath } from "node:fs/promises";
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
	return { path: primary.path, name: basename(primary.path), available: true, worktrees };
}

/**
 * The common Git directory of the repository that owns `path`, with links
 * resolved, or null when `path` is not inside a Git repository. Every worktree
 * of one repository answers with the same directory.
 */
export async function commonDirectory(path: string): Promise<string | null> {
	const output = await git(path, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
	const directory = output?.replace(/\r?\n$/, "");
	if (!directory) return null;
	try {
		return await realpath(directory);
	} catch {
		return directory;
	}
}

/**
 * Read one known repository again. `path` is its primary checkout, the
 * identity the interface holds. Null when Git cannot read it, or when that
 * folder is no longer the primary checkout of a repository.
 */
export async function reloadRepository(path: string): Promise<Repository | null> {
	const repository = await loadRepository(path);
	return repository?.path === path ? repository : null;
}

/** Load every given repository, skipping paths that are not repositories and duplicates. */
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
 * The development override for the repository list: the paths in
 * TIMBER_APP_REPOS, joined by the platform path separator. Null when it is
 * not set, and the app then uses its saved list.
 */
export function overrideRepositoryPaths(environment: Record<string, string | undefined> = process.env): string[] | null {
	const configured = (environment.TIMBER_APP_REPOS ?? "").split(delimiter).map(path => path.trim()).filter(Boolean);
	return configured.length > 0 ? configured : null;
}
