import { realpath } from "node:fs/promises";
import { delimiter } from "node:path";
import { isCommitHash, savedBaseRef } from "../shared/file-changes";
import { BRANCH_LIST_FORMAT, BRANCH_SYNC_FORMAT, parseBranchList, parseBranchSync, parseLeftRightCount } from "../shared/git-parse";
import { REMOTE_HEADS_FORMAT, REMOTE_HEADS_PATTERN, parseRemoteHeads, parseRemoteNames } from "../shared/fallback-base";
import type { BaseCounts, BranchSuggestion, SavedBase, SyncState } from "../shared/model";
import { readGit } from "./read-git";

/** These queries take well under a second. One this slow is stuck, and answers as if Git could not. */
const GIT_QUERY_TIMEOUT_MS = 30_000;

/**
 * Read-only Git queries.
 *
 * Timber lists the worktrees (see ./timber-ls.ts). Git is asked directly only
 * for what Timber does not report: which repository a folder belongs to, how
 * each branch stands against its upstream, how each worktree stands against
 * its saved base, and which branches there are to offer for picking. Git is always invoked as an
 * executable plus an argument array, never through a shell, and nothing here
 * changes a repository.
 */
async function git(args: readonly string[]): Promise<string | null> {
	// These run in the background, so they must not take the index lock (see ./read-git.ts).
	try {
		const answer = await readGit(args, { timeoutMs: GIT_QUERY_TIMEOUT_MS });
		return answer.started && answer.exitCode === 0 ? answer.stdout : null;
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
 * How a worktree's commit stands against its saved base, counted by Git in
 * the repository's common Git directory, so it needs nothing from the
 * worktree's folder. (Timber reports the base of a missing folder as stale,
 * so the sidebar has no counts for one.)
 * Null when there is nothing to count: no base Git can compare with (see
 * `savedBaseRef`), or a head that is not a full commit hash, as on a branch
 * with no commit yet. "unreadable" when Git could not count, as when the base
 * ref no longer exists. Only a canonical ref or a full hash reaches Git, so
 * neither can be read as an option.
 */
export async function readBaseCounts(commonGitDir: string, base: SavedBase | null, head: string | null): Promise<BaseCounts | null> {
	const ref = savedBaseRef(base);
	if (!ref.ok || head === null || !isCommitHash(head)) return null;
	const output = await git(["--git-dir", commonGitDir, "rev-list", "--left-right", "--count", `${ref.ref}...${head}`, "--"]);
	const counted = output === null ? null : parseLeftRightCount(output);
	return counted === null ? { kind: "unreadable" } : { kind: "counted", ...counted };
}

/**
 * The branches of a repository to offer for picking: local branches, then
 * remote-tracking branches as of the last fetch. `folder` is the primary
 * checkout or any of its worktrees. Null when Git could not answer.
 */
export async function readBranches(folder: string): Promise<BranchSuggestion[] | null> {
	const output = await git(["-C", folder, "for-each-ref", `--format=${BRANCH_LIST_FORMAT}`, "refs/heads", "refs/remotes"]);
	return output === null ? null : parseBranchList(output);
}

/**
 * The subject line of the last commit in a worktree, or null when it has no
 * commit or Git could not answer. `worktree` is the folder of a worktree
 * Timber lists. A subject that is empty reads as null.
 */
export async function readHeadSubject(worktree: string): Promise<string | null> {
	const output = await git(["-C", worktree, "log", "-1", "--format=%s", "HEAD", "--"]);
	const subject = output?.replace(/\r?\n$/, "") ?? "";
	return subject === "" ? null : subject;
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

/**
 * The remotes of a repository and each one's cached default branch (see
 * `parseRemoteHeads`), for telling what a worktree with no saved base is
 * rebased onto. Null when Git could not answer. Read-only, and offline.
 */
export async function readRemoteDefaults(commonGitDir: string): Promise<{ remotes: string[]; heads: Map<string, string> } | null> {
	const [names, refs] = await Promise.all([
		git(["--git-dir", commonGitDir, "remote"]),
		git(["--git-dir", commonGitDir, "for-each-ref", `--format=${REMOTE_HEADS_FORMAT}`, REMOTE_HEADS_PATTERN]),
	]);
	if (names === null || refs === null) return null;
	return { remotes: parseRemoteNames(names), heads: parseRemoteHeads(refs) };
}
