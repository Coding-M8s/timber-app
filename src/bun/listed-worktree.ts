import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { Repository, Worktree } from "../shared/model";
import { messageOf } from "../shared/error-message";

/**
 * The repository in the app's list whose primary checkout is `path`, read
 * again, so that its worktrees are the ones Timber lists right now. Null when
 * the list has no such repository (see `RepositoryList.find`).
 */
export type FindRepository = (path: string) => Promise<Repository | null>;

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
 */
export async function findListedWorktree(
	findRepository: FindRepository,
	repositoryPath: string,
	worktreePath: string,
	consequence: string,
): Promise<{ ok: true; worktree: Worktree } | { ok: false; message: string }> {
	const refuse = (message: string) => ({ ok: false as const, message });
	if (!isAbsolute(worktreePath)) return refuse(`${worktreePath} is not a full path, so it cannot be a worktree Timber lists. ${consequence}`);
	let repository: Repository | null;
	try {
		repository = await findRepository(repositoryPath);
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
	if (!isFolder(worktreePath)) return refuse(`The folder ${worktreePath} is missing. ${consequence}`);
	return { ok: true, worktree };
}
