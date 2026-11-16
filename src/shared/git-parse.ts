import type { SyncState } from "./model";

/**
 * How Git is asked for every local branch and its upstream, one line each:
 * the full ref name, the short upstream name, and the tracking state, with a
 * NUL between them. None of the three can contain a NUL or a line break.
 */
export const BRANCH_SYNC_FORMAT = "%(refname)%00%(upstream:short)%00%(upstream:track,nobracket)";

const branchPrefix = "refs/heads/";

/**
 * Parse `git for-each-ref --format=<BRANCH_SYNC_FORMAT> refs/heads` into the
 * sync state of each branch, by exact branch name.
 *
 * The tracking state is empty when the branch is level with its upstream,
 * "gone" when the upstream ref no longer exists, and otherwise "ahead N",
 * "behind N", or both separated by a comma. A branch with no upstream has an
 * empty upstream name. A line that does not fit is left out, so that branch
 * simply has no known sync state.
 */
export function parseBranchSync(output: string): Map<string, SyncState> {
	const branches = new Map<string, SyncState>();
	for (const line of output.split("\n")) {
		const [ref, upstream, track, ...rest] = line.split("\0");
		if (ref === undefined || upstream === undefined || track === undefined || rest.length > 0) continue;
		if (!ref.startsWith(branchPrefix)) continue;
		const branch = ref.slice(branchPrefix.length);
		if (upstream === "") {
			branches.set(branch, { kind: "unpublished" });
		} else if (track === "gone") {
			branches.set(branch, { kind: "gone", upstream });
		} else {
			const match = /^(?:ahead (\d+))?(?:, )?(?:behind (\d+))?$/.exec(track);
			if (match) branches.set(branch, { kind: "tracking", upstream, ahead: Number(match[1] ?? 0), behind: Number(match[2] ?? 0) });
		}
	}
	return branches;
}
