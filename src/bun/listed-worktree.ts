import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { Repository, Worktree } from "../shared/model";
import { messageOf } from "../shared/error-message";

/**
 * The repository in the app's list whose primary checkout is `path`. Null when
 * the list has no such repository. `RepositoryList.find` reads it again, so its
 * worktrees are the ones Timber lists right now; `RepositoryList.findKnown` may
 * answer with the last listing.
 */
export type FindRepository = (path: string) => Promise<Repository | null>;

/**
 * How a launch finds the repository: `known` answers with the last listing,
 * or null for none, reading nothing (see `RepositoryList.findKnown`), and
 * `fresh` reads it again.
 */
export interface LaunchFinders {
	known: FindRepository;
	fresh: FindRepository;
}

function isFolder(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

/**
 * The worktree to act on, or why nothing may be done there: the path must be
 * absolute, the repository must be in the app's list, Timber must list the
 * worktree's registered path for it right now, and its folder must be there.
 * `consequence` ends every refusal, such as "No editor was started."
 *
 * With `listedOnly`, the path is only looked for in Timber's list, as Done
 * needs: Timber also removes a worktree whose folder is gone.
 *
 * With `LaunchFinders`, the last listing is enough when it lists the worktree.
 * Anything else, such as a worktree made in the app a moment ago and not heard
 * yet, is decided by reading the repository again, so a refusal is the same as
 * with `fresh` alone, and so is every message. A worktree removed since the
 * listing is refused all the same: the watcher's report of its removal forgets
 * that listing, and until it comes, its folder is missing.
 */
export async function findListedWorktree(
	findRepository: FindRepository | LaunchFinders,
	repositoryPath: string,
	worktreePath: string,
	consequence: string,
	{ listedOnly = false }: { listedOnly?: boolean } = {},
): Promise<{ ok: true; worktree: Worktree } | { ok: false; message: string }> {
	const refuse = (message: string) => ({ ok: false as const, message });
	if (!listedOnly && !isAbsolute(worktreePath)) return refuse(`${worktreePath} is not a full path, so it cannot be a worktree Timber lists. ${consequence}`);
	let fresh: FindRepository;
	if (typeof findRepository === "function") fresh = findRepository;
	else {
		fresh = findRepository.fresh;
		const known = await findRepository.known(repositoryPath).catch(() => null);
		const worktree = known?.available && known.failure === null ? known.worktrees.find(candidate => candidate.path === worktreePath) : undefined;
		if (worktree && (listedOnly || isFolder(worktreePath))) return { ok: true, worktree };
	}
	let repository: Repository | null;
	try {
		repository = await fresh(repositoryPath);
	} catch (error) {
		return refuse(`Could not read the repository at ${repositoryPath}: ${messageOf(error)}. ${consequence}`);
	}
	if (repository === null) return refuse(`${repositoryPath} is not a repository in this app's list. ${consequence}`);
	if (!repository.available) return refuse(`Git cannot read the repository at ${repositoryPath}. ${consequence}`);
	if (repository.failure !== null) {
		const ending = consequence.charAt(0).toLowerCase() + consequence.slice(1).replace(/\.$/, "");
		return refuse(`Timber could not list the worktrees of ${repositoryPath}, so ${ending}: ${repository.failure}`);
	}
	const worktree = repository.worktrees.find(candidate => candidate.path === worktreePath);
	if (!worktree) return refuse(`Timber lists no worktree at ${worktreePath} in ${repositoryPath}. ${consequence} Refresh the list.`);
	if (!listedOnly && !isFolder(worktreePath)) return refuse(`The folder ${worktreePath} is missing. ${consequence}`);
	return { ok: true, worktree };
}
