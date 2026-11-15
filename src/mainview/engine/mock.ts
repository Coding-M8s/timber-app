import type { Engine } from "../../shared/engine";
import type { Repository, SyncState, Worktree } from "../../shared/model";

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

export function createMockEngine(repositories: Repository[] = sampleRepositories): Engine {
	return {
		listRepositories: async () => structuredClone(repositories),
	};
}
