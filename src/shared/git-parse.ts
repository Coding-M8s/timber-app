import type { SyncState, WorktreeStatus } from "./model";

/** One record of `git worktree list --porcelain -z`. */
export interface WorktreeEntry {
	path: string;
	head: string | null;
	/** Short branch name, or null when detached or bare. */
	branch: string | null;
	bare: boolean;
	locked: boolean;
	prunable: boolean;
}

const branchPrefix = "refs/heads/";

/**
 * Parse `git worktree list --porcelain -z`.
 * Attributes end with NUL and records end with an empty attribute. Git lists
 * the primary worktree first.
 */
export function parseWorktreeList(output: string): WorktreeEntry[] {
	const entries: WorktreeEntry[] = [];
	let current: WorktreeEntry | null = null;
	for (const token of output.split("\0")) {
		if (token === "") {
			if (current) entries.push(current);
			current = null;
			continue;
		}
		const space = token.indexOf(" ");
		const key = space === -1 ? token : token.slice(0, space);
		const value = space === -1 ? "" : token.slice(space + 1);
		if (key === "worktree") {
			if (current) entries.push(current);
			current = { path: value, head: null, branch: null, bare: false, locked: false, prunable: false };
			continue;
		}
		if (!current) continue;
		if (key === "HEAD") current.head = value;
		else if (key === "branch") current.branch = value.startsWith(branchPrefix) ? value.slice(branchPrefix.length) : value;
		else if (key === "bare") current.bare = true;
		else if (key === "locked") current.locked = true;
		else if (key === "prunable") current.prunable = true;
	}
	if (current) entries.push(current);
	return entries;
}

/**
 * Parse `git status --porcelain=v2 --branch -z`.
 *
 * Header records describe the branch and its upstream; Git leaves out
 * `branch.ab` when the configured upstream ref does not exist. A renamed
 * entry is followed by one extra NUL-terminated record holding its old path.
 */
export function parseStatus(output: string): WorktreeStatus {
	let upstream: string | null = null;
	let ahead: number | null = null;
	let behind: number | null = null;
	let modified = 0;
	let untracked = 0;

	const tokens = output.split("\0");
	for (let index = 0; index < tokens.length; index += 1) {
		const token = tokens[index]!;
		if (token.startsWith("# branch.upstream ")) {
			upstream = token.slice("# branch.upstream ".length);
		} else if (token.startsWith("# branch.ab ")) {
			const match = /^\+(\d+) -(\d+)$/.exec(token.slice("# branch.ab ".length));
			if (match) {
				ahead = Number(match[1]);
				behind = Number(match[2]);
			}
		} else if (token.startsWith("1 ") || token.startsWith("u ")) {
			modified += 1;
		} else if (token.startsWith("2 ")) {
			modified += 1;
			index += 1;
		} else if (token.startsWith("? ")) {
			untracked += 1;
		}
	}

	let sync: SyncState;
	if (upstream === null) sync = { kind: "unpublished" };
	else if (ahead === null || behind === null) sync = { kind: "gone", upstream };
	else sync = { kind: "tracking", upstream, ahead, behind };
	return { modified, untracked, sync };
}
