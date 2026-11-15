import type { Engine } from "../../shared/engine";
import type { Repository, SyncState, TimberStatus, Worktree } from "../../shared/model";
import { REQUIRED_TIMBER_VERSION } from "../../shared/timber-version";

const inSync = (branch: string): SyncState => ({ kind: "tracking", upstream: `origin/${branch}`, ahead: 0, behind: 0 });

function worktree(repository: string, branch: string, overrides: Partial<Worktree> = {}): Worktree {
	const primary = overrides.primary ?? false;
	return {
		path: primary ? `/work/${repository}` : `/work/${repository}-worktrees/${branch.replaceAll("/", "-")}`,
		branch,
		head: "0000000000000000000000000000000000000000",
		primary,
		locked: false,
		prunable: false,
		status: { modified: 0, untracked: 0, sync: inSync(branch) },
		...overrides,
	};
}

/** Sample data covering every state the sidebar can show. Used in the browser build and in tests. */
export const sampleRepositories: Repository[] = [
	{
		path: "/work/timber",
		name: "timber",
		worktrees: [
			worktree("timber", "main", {
				primary: true,
				status: { modified: 0, untracked: 0, sync: { kind: "tracking", upstream: "origin/main", ahead: 0, behind: 2 } },
			}),
			worktree("timber", "feat/github-issue-lookup", {
				status: { modified: 3, untracked: 1, sync: { kind: "tracking", upstream: "origin/feat/github-issue-lookup", ahead: 2, behind: 0 } },
			}),
			worktree("timber", "fix/macos-portability", {
				status: { modified: 0, untracked: 0, sync: { kind: "tracking", upstream: "origin/fix/macos-portability", ahead: 3, behind: 3 } },
			}),
			worktree("timber", "spike/new-idea", {
				status: { modified: 0, untracked: 2, sync: { kind: "unpublished" } },
			}),
		],
	},
	{
		path: "/work/api-server",
		name: "api-server",
		worktrees: [
			worktree("api-server", "main", { primary: true }),
			worktree("api-server", "feat/rate-limit-headers", {
				status: { modified: 0, untracked: 0, sync: { kind: "gone", upstream: "origin/feat/rate-limit-headers" } },
			}),
			worktree("api-server", "old/removed-folder", { prunable: true, status: null }),
		],
	},
];

/** One sample of each state Timber can be found in. */
export const sampleTimberStatuses = {
	"ready": { state: "ready", path: "/home/sam/.local/bin/timber", version: REQUIRED_TIMBER_VERSION },
	"not-found": { state: "not-found", override: null },
	"too-old": { state: "too-old", path: "/home/sam/.local/bin/timber", found: "0.1.0", required: REQUIRED_TIMBER_VERSION },
} as const satisfies Record<TimberStatus["state"], TimberStatus>;

/**
 * `timber` is the answer to every look for Timber. Pass a function to change
 * the answer between looks, for example to act out an install before Retry.
 */
export function createMockEngine(
	repositories: Repository[] = sampleRepositories,
	timber: TimberStatus | (() => TimberStatus) = sampleTimberStatuses.ready,
): Engine {
	const look = async () => structuredClone(typeof timber === "function" ? timber() : timber);
	return {
		timberStatus: look,
		recheckTimber: look,
		listRepositories: async () => structuredClone(repositories),
	};
}
