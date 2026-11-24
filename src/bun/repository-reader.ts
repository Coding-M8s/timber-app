import { basename } from "node:path";
import { NOTHING_CONFIGURED, fallbackBaseOf, mayFallBackToUpstream } from "../shared/fallback-base";
import { type BaseCounts, type Repository, type SetupState, type SyncState, type TimberStatus, type Worktree, worktreeId } from "../shared/model";
import type { ListedWorktree } from "../shared/timber-ls";
import { type ConfiguredBaseReader, createConfiguredBaseReader } from "./configured-base";
import { commonDirectory, readBaseCounts, readBranchSync, readRemoteDefaults, readUnpushedCount } from "./git-engine";
import { readSetupState } from "./setup-state";
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
 * report: how each branch stands against its upstream, how many commits of
 * an unpublished branch no remote has, how each worktree stands against its
 * saved base, and the remotes' cached default branches.
 * Timber's settings are read only for `fallbackBase`. Everything is read-only.
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

/**
 * The upstream state of one listed worktree. `branches` is what Git said
 * about every branch, or null when it did not answer. Null on a detached
 * HEAD, and on a branch whose state is not known. The interface tells the two
 * apart by the branch, and says "sync unknown" for the second.
 */
export function syncOf(listed: Pick<ListedWorktree, "branch" | "head">, branches: Map<string, SyncState> | null): SyncState | null {
	if (listed.branch === null || branches === null) return null;
	// A branch with no commit yet has no ref to ask about, and cannot have been published.
	return branches.get(listed.branch) ?? (listed.head === null ? { kind: "unpublished" } : null);
}

/** How many counts against a base run at once for one repository, so many worktrees do not start as many Git processes. */
export const BASE_COUNTS_AT_ONCE = 4;

/**
 * Ask `count` once for each distinct key, in the order given, with at most
 * `atOnce` asks at the same time, and give every item its key's answer.
 */
async function countEach<Item, Answer>(items: readonly Item[], keyOf: (item: Item) => string, count: (item: Item) => Promise<Answer>, atOnce: number): Promise<Answer[]> {
	const keys = items.map(keyOf);
	const distinct = [...new Map(items.map((item, index) => [keys[index]!, item])).entries()];
	const answers = new Map<string, Answer>();
	let next = 0;
	const work = async () => {
		while (next < distinct.length) {
			const [key, item] = distinct[next++]!;
			answers.set(key, await count(item));
		}
	};
	await Promise.all(Array.from({ length: Math.min(atOnce, distinct.length) }, work));
	return keys.map(key => answers.get(key)!);
}

/**
 * Count every listed worktree against its saved base, in the order listed.
 * Worktrees with the same base and head are counted once, and at most
 * `atOnce` counts run at the same time.
 */
export async function countAgainstBases(
	commonGitDir: string,
	listed: readonly Pick<ListedWorktree, "base" | "head">[],
	count: typeof readBaseCounts = readBaseCounts,
	atOnce = BASE_COUNTS_AT_ONCE,
): Promise<(BaseCounts | null)[]> {
	return countEach(listed, ({ base, head }) => JSON.stringify([base, head]), ({ base, head }) => count(commonGitDir, base, head), atOnce);
}

/**
 * The sync states with each unpublished branch's commits that no remote has
 * counted (`unpushed`), in the order given. Only a branch with no upstream
 * and a commit is counted; one Git could not count stays as it was, with no
 * Push. Branches at the same commit are counted once, and at most `atOnce`
 * counts run at the same time.
 */
export async function countUnpushed(
	commonGitDir: string,
	listed: readonly { head: string | null; sync: SyncState | null }[],
	count: typeof readUnpushedCount = readUnpushedCount,
	atOnce = BASE_COUNTS_AT_ONCE,
): Promise<(SyncState | null)[]> {
	const counted = (item: { head: string | null; sync: SyncState | null }) => item.sync?.kind === "unpublished" && item.head !== null;
	const toCount = listed.filter(counted);
	const answers = await countEach(toCount, item => item.head!, item => count(commonGitDir, item.head), atOnce);
	const byHead = new Map(toCount.map((item, index) => [item.head!, answers[index] ?? null]));
	return listed.map(item => {
		const unpushed = counted(item) ? byHead.get(item.head!) ?? null : null;
		return unpushed === null ? item.sync : { kind: "unpublished", unpushed };
	});
}

/** Where the fallback base of one repository is read from. */
export interface FallbackBaseSources {
	commonGitDir: string;
	primaryRoot: string;
	setup: SetupState;
	/** The Timber executable, for reading its settings. */
	timber: string;
	configuredBase: ConfiguredBaseReader;
	remoteDefaults?: typeof readRemoteDefaults;
}

/**
 * The repository's `fallbackBase`: read only when its primary checkout may
 * fall back to its own upstream (`mayFallBackToUpstream`), so most reads run
 * nothing more. Git gives the remotes and their cached default branches.
 * Timber's settings, which may name the base, are read only when one of its
 * settings files exists ("none" means nothing is configured), and an
 * unknown setup gives null.
 */
export async function readFallbackBase(worktrees: readonly Worktree[], sources: FallbackBaseSources): Promise<string | null> {
	const primary = worktrees.find(worktree => worktree.primary);
	if (primary === undefined || !mayFallBackToUpstream(primary) || sources.setup === "unknown") return null;
	const defaults = await (sources.remoteDefaults ?? readRemoteDefaults)(sources.commonGitDir);
	if (defaults === null) return null;
	if (sources.setup === "none") return fallbackBaseOf(defaults.remotes, defaults.heads, NOTHING_CONFIGURED);
	const configured = await sources.configuredBase(sources.timber, sources.primaryRoot);
	return fallbackBaseOf(defaults.remotes, defaults.heads, configured);
}

/** A repository that Git can read but whose worktrees Timber did not list. Its setup is not told apart then. */
export function failedRepository(path: string, message: string): Repository {
	return { path, name: basename(path) || path, available: true, failure: message, setup: "unknown", fallbackBase: null, worktrees: [] };
}

/** `timber` answers where Timber is, as of the last look (see ./timber.ts). */
export function createRepositoryReader(
	timber: () => Promise<TimberStatus>,
	environment: Record<string, string | undefined> = process.env,
	configuredBase: ConfiguredBaseReader = createConfiguredBaseReader(environment),
): RepositoryReader {
	async function find(folder: string): Promise<RepositoryRead> {
		// Git says whether this is a repository at all, so a missing folder is not mistaken for a Timber failure.
		if (await commonDirectory(folder) === null) return { outcome: "not-a-repository" };

		const status = await timber();
		if (status.state !== "ready") return { outcome: "failed", message: describeTimberStatus(status) };
		const listing = await listWorktrees(status.path, folder, environment);
		if (!listing.ok) return { outcome: "failed", message: listing.message };

		const { commonGitDir, primaryWorktreeRoot } = listing.repository;
		// Timber reads its settings with the same environment it lists with, so the same machine defaults count.
		const [branches, setup, baseCounts] = await Promise.all([
			readBranchSync(commonGitDir),
			readSetupState(primaryWorktreeRoot, environment),
			countAgainstBases(commonGitDir, listing.worktrees),
		]);
		const syncs = await countUnpushed(commonGitDir, listing.worktrees.map(listed => ({ head: listed.head, sync: syncOf(listed, branches) })));
		const worktrees: Worktree[] = listing.worktrees.map((listed, index) => ({
			id: worktreeId(commonGitDir, listed),
			...listed,
			sync: syncs[index] ?? null,
			baseCounts: baseCounts[index] ?? null,
		}));
		const fallbackBase = await readFallbackBase(worktrees, { commonGitDir, primaryRoot: primaryWorktreeRoot, setup, timber: status.path, configuredBase });
		return {
			outcome: "read",
			repository: { path: primaryWorktreeRoot, name: basename(primaryWorktreeRoot), available: true, failure: null, setup, fallbackBase, worktrees },
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
