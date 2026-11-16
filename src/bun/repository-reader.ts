import { basename } from "node:path";
import { type Repository, type SyncState, type TimberStatus, type Worktree, worktreeId } from "../shared/model";
import type { ListedWorktree } from "../shared/timber-ls";
import { commonDirectory, readBranchSync } from "./git-engine";
import { describeTimberStatus } from "./timber";
import { listWorktrees } from "./timber-ls";

/** What came of reading the repository that owns a folder. */
export type RepositoryRead =
	| { outcome: "read"; repository: Repository }
	/** Git finds no repository there, or the folder is missing. */
	| { outcome: "not-a-repository" }
	/** It is a repository, but Timber did not list its worktrees. `message` says why. */
	| { outcome: "failed"; message: string };

/**
 * Reads repositories for the sidebar. The worktrees are exactly the ones
 * `timber ls --json` lists, in its order. Git adds only what Timber does not
 * report: how each branch stands against its upstream. Everything is
 * read-only.
 */
export interface RepositoryReader {
	/** Read the repository that owns `folder`: its primary checkout, a linked worktree, or a folder inside either. */
	find(folder: string): Promise<RepositoryRead>;
	/**
	 * Read one known repository again. `path` is its primary checkout, the
	 * identity the interface holds. Null when Git finds no repository there, or
	 * when that folder is no longer its primary checkout. When Timber could not
	 * list the worktrees, the repository comes back with `failure` set and no
	 * worktrees, never with part of a list.
	 */
	reload(path: string): Promise<Repository | null>;
}

function syncOf(listed: ListedWorktree, branches: Map<string, SyncState> | null): SyncState | null {
	if (listed.branch === null || branches === null) return null;
	// A branch with no commit yet has no ref to ask about, and cannot have been published.
	return branches.get(listed.branch) ?? (listed.head === null ? { kind: "unpublished" } : null);
}

/** A repository that Git can read but whose worktrees Timber did not list. */
export function failedRepository(path: string, message: string): Repository {
	return { path, name: basename(path) || path, available: true, failure: message, worktrees: [] };
}

/** `timber` answers where Timber is, as of the last look (see ./timber.ts). */
export function createRepositoryReader(
	timber: () => Promise<TimberStatus>,
	environment: Record<string, string | undefined> = process.env,
): RepositoryReader {
	async function find(folder: string): Promise<RepositoryRead> {
		// Git says whether this is a repository at all, so a missing folder is not mistaken for a Timber failure.
		if (await commonDirectory(folder) === null) return { outcome: "not-a-repository" };

		const status = await timber();
		if (status.state !== "ready") return { outcome: "failed", message: describeTimberStatus(status) };
		const listing = await listWorktrees(status.path, folder, environment);
		if (!listing.ok) return { outcome: "failed", message: listing.message };

		const { commonGitDir, primaryWorktreeRoot } = listing.repository;
		const branches = await readBranchSync(commonGitDir);
		const worktrees: Worktree[] = listing.worktrees.map(listed => ({
			id: worktreeId(commonGitDir, listed),
			...listed,
			sync: syncOf(listed, branches),
		}));
		return {
			outcome: "read",
			repository: { path: primaryWorktreeRoot, name: basename(primaryWorktreeRoot), available: true, failure: null, worktrees },
		};
	}

	return {
		find,
		async reload(path) {
			const read = await find(path);
			switch (read.outcome) {
				case "not-a-repository":
					return null;
				case "failed":
					return failedRepository(path, read.message);
				case "read":
					return read.repository.path === path ? read.repository : null;
			}
		},
	};
}
