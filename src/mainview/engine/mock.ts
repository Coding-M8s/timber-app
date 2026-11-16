import type { Engine } from "../../shared/engine";
import { type AddRepositoryResult, type Repository, type SyncState, type TimberStatus, type Worktree, worktreeId } from "../../shared/model";
import { REQUIRED_TIMBER_VERSION } from "../../shared/timber-version";

const inSync = (branch: string): SyncState => ({ kind: "tracking", upstream: `origin/${branch}`, ahead: 0, behind: 0 });

/** Pretend file names, so a sample can say how many files changed. */
const files = (count: number, prefix: string) => Array.from({ length: count }, (_, index) => `${prefix}-${index + 1}.ts`);

/** Sample changes with this many modified and untracked files. */
export const sampleChanges = (modified: number, untracked: number): Worktree["changes"] =>
	({ kind: "known", modified: files(modified, "src/changed"), untracked: files(untracked, "src/new") });

type SampleOverrides = Partial<Omit<Worktree, "id" | "path" | "canonicalPath" | "detached">>;

function worktree(repository: string, branch: string, overrides: SampleOverrides = {}): Worktree {
	const primary = overrides.primary ?? false;
	const path = primary ? `/work/${repository}` : `/work/${repository}-worktrees/${branch.replaceAll("/", "-")}`;
	const sample = {
		path,
		branch: branch as string | null,
		head: "0000000000000000000000000000000000000000",
		primary,
		locked: false,
		prunable: false,
		pathExists: true,
		changes: sampleChanges(0, 0),
		sync: inSync(branch) as SyncState | null,
		...overrides,
	};
	// As Timber does: a canonical path only for a folder whose status it could read.
	const canonicalPath = sample.pathExists && sample.changes.kind === "known" ? path : null;
	return { ...sample, id: worktreeId(`/work/${repository}/.git`, { path, canonicalPath }), canonicalPath, detached: sample.branch === null };
}

/** Sample data covering every state the sidebar can show. Used in the browser build and in tests. */
export const sampleRepositories: Repository[] = [
	{
		path: "/work/timber",
		name: "timber",
		available: true,
		failure: null,
		worktrees: [
			worktree("timber", "main", {
				primary: true,
				sync: { kind: "tracking", upstream: "origin/main", ahead: 0, behind: 2 },
			}),
			worktree("timber", "feat/github-issue-lookup", {
				changes: sampleChanges(3, 1),
				sync: { kind: "tracking", upstream: "origin/feat/github-issue-lookup", ahead: 2, behind: 0 },
			}),
			worktree("timber", "fix/macos-portability", {
				sync: { kind: "tracking", upstream: "origin/fix/macos-portability", ahead: 3, behind: 3 },
			}),
			worktree("timber", "spike/new-idea", {
				changes: sampleChanges(0, 2),
				sync: { kind: "unpublished" },
			}),
		],
	},
	{
		path: "/work/api-server",
		name: "api-server",
		available: true,
		failure: null,
		worktrees: [
			worktree("api-server", "main", { primary: true }),
			worktree("api-server", "feat/rate-limit-headers", {
				sync: { kind: "gone", upstream: "origin/feat/rate-limit-headers" },
			}),
			worktree("api-server", "old/removed-folder", {
				prunable: true,
				pathExists: false,
				changes: { kind: "unknown", reason: "Worktree path is missing" },
				sync: { kind: "unpublished" },
			}),
		],
	},
];

/** A saved repository whose folder is gone. The browser build lists it; most tests do not. */
export const sampleUnavailableRepository: Repository = {
	path: "/work/old-prototype",
	name: "old-prototype",
	available: false,
	failure: null,
	worktrees: [],
};

/** A repository on the pretend disk that is not in the list yet. The mock's folder picker chooses it by default. */
export const samplePickableRepository: Repository = {
	path: "/work/docs-site",
	name: "docs-site",
	available: true,
	failure: null,
	worktrees: [
		worktree("docs-site", "main", { primary: true }),
		worktree("docs-site", "feat/search", {
			changes: sampleChanges(1, 0),
			sync: { kind: "unpublished" },
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
	 * Make Timber fail to list the worktrees of one repository, named by its
	 * primary checkout, with this diagnostic. Pass null to let it work again.
	 */
	failTimber(path: string, diagnostic: string | null): void;
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
	const timberFailures = new Map<string, string>();
	// As the main process does: a failed listing brings the diagnostic and no worktrees.
	const asRead = (repository: Repository): Repository => {
		const diagnostic = timberFailures.get(repository.path);
		return diagnostic === undefined || !repository.available ? repository : { ...repository, failure: diagnostic, worktrees: [] };
	};
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
		listRepositories: () => read(() => current.map(asRead)),
		loadRepository: path => read(() => {
			const found = current.find(repository => repository.path === path && repository.available);
			return found ? asRead(found) : null;
		}),
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
		failTimber(path, diagnostic) {
			if (diagnostic === null) timberFailures.delete(path);
			else timberFailures.set(path, diagnostic);
		},
	};
}
