import type { Engine } from "../../shared/engine";
import { type AddRepositoryResult, type BranchSuggestion, type Repository, type SyncState, type TimberStatus, type Worktree, type WorktreeCommandResult, worktreeId } from "../../shared/model";
import { REQUIRED_TIMBER_VERSION } from "../../shared/timber-version";
import { type CommandEnding, actOutNew, actOutOpen, isCommandEnding } from "./mock-commands";

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

/**
 * Sample data for the browser build and for tests. Together with
 * `sampleStatesRepository` it covers every state a row can show.
 */
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

/**
 * A repository with the row states the two above do not have: a detached
 * HEAD, a locked worktree, a prunable one whose folder is still there, a
 * status Timber could not read, an upstream state Git could not read, and a
 * row with everything at once. The browser build lists it; most tests do not.
 */
export const sampleStatesRepository: Repository = {
	path: "/work/billing",
	name: "billing",
	available: true,
	failure: null,
	worktrees: [
		worktree("billing", "main", { primary: true }),
		worktree("billing", "review-build", {
			branch: null,
			head: "4f9c2ab81d3e56f7a0b1c2d3e4f5a6b7c8d9e0f1",
			sync: null,
		}),
		worktree("billing", "release/2.4", { locked: true }),
		worktree("billing", "chore/moved-folder", {
			prunable: true,
			changes: { kind: "unknown", reason: "Path no longer identifies this Git worktree" },
		}),
		worktree("billing", "fix/unreadable", {
			changes: { kind: "unknown", reason: "Cannot inspect worktree; check directory access" },
			sync: { kind: "tracking", upstream: "origin/fix/unreadable", ahead: 1, behind: 0 },
		}),
		worktree("billing", "feat/invoices", {
			changes: sampleChanges(2, 0),
			sync: null,
		}),
		worktree("billing", "feat/tax-rules", {
			locked: true,
			changes: sampleChanges(12, 5),
			sync: { kind: "tracking", upstream: "origin/feat/tax-rules", ahead: 1, behind: 14 },
		}),
	],
};

/** A saved repository whose folder is gone. The browser build lists it; most tests do not. */
export const sampleUnavailableRepository: Repository = {
	path: "/work/old-prototype",
	name: "old-prototype",
	available: false,
	failure: null,
	worktrees: [],
};

/** What `bun run dev:web` lists: every row state, and a repository that is unavailable. */
export const browserSampleRepositories: Repository[] = [...sampleRepositories, sampleStatesRepository, sampleUnavailableRepository];

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

/**
 * Branches on the pretend disk that have no worktree yet, by repository path.
 * The mock's branch list offers them beside the branches of the worktrees.
 */
export const sampleSpareBranches: Record<string, BranchSuggestion[]> = {
	"/work/timber": [
		{ selector: "chore/update-deps", kind: "local" },
		{ selector: "origin/feat/config-reload", kind: "remote" },
		{ selector: "origin/release/0.2", kind: "remote" },
	],
};

const byName = (one: BranchSuggestion, other: BranchSuggestion) => one.selector < other.selector ? -1 : one.selector > other.selector ? 1 : 0;

/** The branches the pretend Git knows in a repository: local ones first, as the real list has them. */
function branchesOf(repository: Repository): BranchSuggestion[] {
	const spare = sampleSpareBranches[repository.path] ?? [];
	const local = new Set(spare.filter(branch => branch.kind === "local").map(branch => branch.selector));
	const remote = new Set(spare.filter(branch => branch.kind === "remote").map(branch => branch.selector));
	for (const { branch, sync } of repository.worktrees) {
		if (branch !== null) local.add(branch);
		if (sync?.kind === "tracking") remote.add(sync.upstream);
	}
	return [
		...[...local].map((selector): BranchSuggestion => ({ selector, kind: "local" })).sort(byName),
		...[...remote].map((selector): BranchSuggestion => ({ selector, kind: "remote" })).sort(byName),
	];
}

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
	/**
	 * Decide how `timber new` and `timber open` end from now on: "succeeds"
	 * (the start), "refused", "ambiguous", "setup-fails", or "no-result". See
	 * ./mock-commands.ts for what each one acts out.
	 */
	endCommands(ending: CommandEnding): void;
	/**
	 * Decide what the branch list of one repository answers from now on: these
	 * branches, or null for a list that cannot be read. Until then it answers
	 * with the branches of the worktrees and the spare sample branches.
	 */
	setBranches(path: string, branches: BranchSuggestion[] | null): void;
}

export interface MockEngineOptions {
	/** How long an acted `timber new` or `timber open` takes. None by default; the browser build waits, so the running state shows. */
	commandMilliseconds?: number;
}

/** A command the mock did not act out, with the reason. */
function notRun(diagnostic: string): WorktreeCommandResult {
	return { outcome: "failed", failure: { command: null, diagnostic: `${diagnostic} Nothing was run.`, output: null }, worktree: null, created: false };
}

/** Timber's order: the primary checkout first, then by path. */
function inTimberOrder(worktrees: Worktree[]): Worktree[] {
	return [...worktrees].sort((a, b) => Number(b.primary) - Number(a.primary) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

/**
 * `timber` is the answer to every look for Timber. Pass a function to change
 * the answer between looks, for example to act out an install before Retry.
 */
export function createMockEngine(
	repositories: Repository[] = sampleRepositories,
	timber: TimberStatus | (() => TimberStatus) = sampleTimberStatuses.ready,
	options: MockEngineOptions = {},
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
	let ending: CommandEnding = "succeeds";
	const branchLists = new Map<string, BranchSuggestion[] | null>();
	const listedBranches = (repository: Repository) =>
		branchLists.has(repository.path) ? branchLists.get(repository.path)! : branchesOf(repository);
	const { commandMilliseconds = 0 } = options;
	// As the main process does: only with a usable Timber, and only in a repository from the list.
	const command = async (path: string, act: (repository: Repository) => { result: WorktreeCommandResult; created: Worktree | null }): Promise<WorktreeCommandResult> => {
		if (commandMilliseconds > 0) await new Promise(resolve => setTimeout(resolve, commandMilliseconds));
		if ((await look()).state !== "ready") return notRun("Timber is not ready.");
		const repository = current.find(candidate => candidate.path === path && candidate.available);
		if (!repository) return notRun(`${path} is not a repository in the app's list.`);
		const { result, created } = act(repository);
		if (created) {
			const changed = { ...repository, worktrees: inTimberOrder([...repository.worktrees, created]) };
			current = current.map(candidate => candidate === repository ? changed : candidate);
			onDisk.set(path, changed);
		}
		return structuredClone(result);
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
		newWorktree: request => command(request.repository, repository => actOutNew(repository, request, ending)),
		openWorktree: request => command(request.repository, repository => actOutOpen(repository, request, ending, listedBranches(repository) ?? [])),
		listBranches: path => read(() => {
			const found = current.find(repository => repository.path === path && repository.available);
			return found ? listedBranches(found) : null;
		}),
		onRepositoryChanged(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		endCommands(next) {
			// Called from the browser console too, where nothing checks the word.
			if (!isCommandEnding(next)) throw new Error(`Unknown ending: ${String(next)}`);
			ending = next;
		},
		setBranches(path, branches) {
			branchLists.set(path, branches);
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
