import type { Engine } from "../../shared/engine";
import type { AddRepositoryResult, Repository, SyncState, TimberStatus, Worktree } from "../../shared/model";
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
		available: true,
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
		available: true,
		worktrees: [
			worktree("api-server", "main", { primary: true }),
			worktree("api-server", "feat/rate-limit-headers", {
				status: { modified: 0, untracked: 0, sync: { kind: "gone", upstream: "origin/feat/rate-limit-headers" } },
			}),
			worktree("api-server", "old/removed-folder", { prunable: true, status: null }),
		],
	},
];

/** A saved repository whose folder is gone. The browser build lists it; most tests do not. */
export const sampleUnavailableRepository: Repository = {
	path: "/work/old-prototype",
	name: "old-prototype",
	available: false,
	worktrees: [],
};

/** A repository on the pretend disk that is not in the list yet. The mock's folder picker chooses it by default. */
export const samplePickableRepository: Repository = {
	path: "/work/docs-site",
	name: "docs-site",
	available: true,
	worktrees: [
		worktree("docs-site", "main", { primary: true }),
		worktree("docs-site", "feat/search", {
			status: { modified: 1, untracked: 0, sync: { kind: "unpublished" } },
		}),
	],
};

/** One sample of each state Timber can be found in. */
export const sampleTimberStatuses = {
	"ready": { state: "ready", path: "/home/sam/.local/bin/timber", version: REQUIRED_TIMBER_VERSION },
	"not-found": { state: "not-found", override: null },
	"too-old": { state: "too-old", path: "/home/sam/.local/bin/timber", found: "0.1.0", required: REQUIRED_TIMBER_VERSION },
} as const satisfies Record<TimberStatus["state"], TimberStatus>;

/** The mock engine, plus the controls a test or the browser build uses to act out changes. */
export interface MockEngine extends Engine {
	/** Replace the data, without telling the interface. */
	setRepositories(repositories: Repository[]): void;
	/** Report that a repository changed, as the main process would. */
	announceChange(path: string): void;
	/** Make every later read of repositories fail with this message, or pass null to let them work again. */
	failReads(message: string | null): void;
	/**
	 * Decide what the folder picker answers from now on: a folder, or null for
	 * a picker closed without a choice. A folder counts as a repository when it
	 * is the path of a known repository or of one of its worktrees.
	 */
	pickFolder(folder: string | null): void;
}

/**
 * `timber` is the answer to every look for Timber. Pass a function to change
 * the answer between looks, for example to act out an install before Retry.
 */
export function createMockEngine(
	repositories: Repository[] = sampleRepositories,
	timber: TimberStatus | (() => TimberStatus) = sampleTimberStatuses.ready,
): MockEngine {
	let current = repositories;
	let failure: string | null = null;
	let picked: string | null = samplePickableRepository.path;
	// Everything on the pretend disk: whatever was ever listed, plus one repository to add.
	const onDisk = new Map<string, Repository>([samplePickableRepository, ...repositories].map(repository => [repository.path, repository]));
	const owns = (repository: Repository, folder: string) =>
		repository.path === folder || repository.worktrees.some(candidate => candidate.path === folder);
	const add = (): AddRepositoryResult => {
		const folder = picked;
		if (folder === null) return { outcome: "cancelled" };
		const listed = current.find(repository => owns(repository, folder));
		if (listed) return { outcome: "already-listed", repository: listed.path };
		const found = [...onDisk.values()].find(repository => repository.available && owns(repository, folder));
		if (!found) return { outcome: "not-a-repository", folder };
		current = [...current, found];
		return { outcome: "added", repository: found };
	};
	const listeners = new Set<(path: string) => void>();
	const look = async () => structuredClone(typeof timber === "function" ? timber() : timber);
	const read = async <Result>(result: () => Result): Promise<Result> => {
		if (failure !== null) throw new Error(failure);
		return structuredClone(result());
	};
	return {
		timberStatus: look,
		recheckTimber: look,
		listRepositories: () => read(() => current),
		loadRepository: path => read(() => current.find(repository => repository.path === path && repository.available) ?? null),
		addRepository: async () => structuredClone(add()),
		async removeRepository(path) {
			current = current.filter(repository => repository.path !== path);
			return { outcome: "removed" };
		},
		onRepositoryChanged(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		setRepositories(next) {
			current = next;
			for (const repository of next) onDisk.set(repository.path, repository);
		},
		pickFolder(folder) {
			picked = folder;
		},
		announceChange(path) {
			for (const listener of [...listeners]) listener(path);
		},
		failReads(message) {
			failure = message;
		},
	};
}
