import type { FetchSetting } from "../shared/fetch-setting";
import {
	BRANCH_UPSTREAM_FORMAT, type FetchFailure, type FetchResult, type ForcePushMark, type ForcePushMarks, REMOTE_REF_FORMAT, type RepositoryFetch,
	type StaleMark, type TrackedBranch, parseRemoteRefs, parseTrackedBranches, readFetchFailure, remoteTrackingRefspecs, trackedRemotes,
} from "../shared/git-fetch";
import { type RunGit, batchSshCommand } from "./fetch-git";
import { type Schedule, type WatchTarget, scheduleWithTimer } from "./repository-watcher";

/** The first background fetch of a repository waits this long after the app starts or the repository is added. */
export const FIRST_FETCH_MILLISECONDS = 10_000;
/** Each further repository waits this much longer for its first fetch, so they do not all start at once. */
export const STAGGER_MILLISECONDS = 5_000;
/** After failures the wait doubles each time, up to an hour, or up to the interval when that is longer. */
export const MOST_BACKOFF_MILLISECONDS = 60 * 60_000;
/** At most this many repositories are fetched at the same time. */
export const MOST_AT_ONCE = 2;

export interface FetcherOptions {
	runGit: RunGit;
	/** The remote-tracking refs of this repository changed, or its marks did: its branches may stand differently now. */
	onChanged: (path: string) => void;
	/** Where a repository's fetching stands changed. */
	onStatus: (status: RepositoryFetch) => void;
	/** The marks saved last time, by repository. */
	marks?: ForcePushMarks;
	/** Remember the marks of every repository, called whenever they change. */
	saveMarks?: (marks: ForcePushMarks) => void;
	/** The environment Git runs in, to tell whether the person chose an SSH command. */
	environment?: Record<string, string | undefined>;
	schedule?: Schedule;
	now?: () => number;
	firstFetchMilliseconds?: number;
	staggerMilliseconds?: number;
	mostBackoffMilliseconds?: number;
	mostAtOnce?: number;
}

/**
 * Fetches the repositories in the list, in the background on an interval and
 * when asked, and notices upstreams that were rewritten. This is the only
 * place where the app writes to a repository without Timber, and it writes
 * only remote-tracking refs.
 *
 * - One fetch at a time per repository: asking while one runs waits for it.
 *   At most two repositories are fetched at the same time.
 * - Nothing is fetched in the background until `configure` says to, so with
 *   background fetching off nothing reaches the network until `fetchNow`.
 *   While the window is hidden, background fetches wait, and what came due
 *   runs when it shows again.
 * - After a failure the next background fetch waits longer, doubling each
 *   time up to an hour, and nothing ever prompts (see ./fetch-git.ts).
 * - Only remotes that a local branch tracks are fetched, each with its own
 *   refspecs that write `refs/remotes/...`, given on the command line with an
 *   empty `--refmap`, so a refspec that would write a local branch is never
 *   used. `--prune` then removes only remote-tracking refs whose branch is
 *   gone from the remote. No tags, no submodules, no `FETCH_HEAD`, no
 *   automatic maintenance.
 * - When the upstream of a local branch moved to a commit its previous commit
 *   is not an ancestor of, the branch is marked force-pushed until the person
 *   saw it (`acknowledge`) or it is no longer true (`forget`).
 */
export interface Fetcher {
	/** Fetch exactly these repositories from now on. */
	sync(targets: readonly WatchTarget[]): void;
	/** Fetch in the background, or not, and how often. Until this is called, nothing is fetched in the background. */
	configure(setting: FetchSetting): void;
	/** Whether the window shows. Background fetches wait while it does not. */
	setVisible(visible: boolean): void;
	/** Fetch one repository now, or wait for the fetch that runs. Works whether or not background fetching is on. */
	fetchNow(path: string): Promise<FetchResult>;
	/** Where fetching stands for every repository. */
	statuses(): RepositoryFetch[];
	/** The force-push marks of a repository, by branch. */
	marks(path: string): Readonly<Record<string, ForcePushMark>>;
	/** The force-push marks of every repository. */
	allMarks(): ForcePushMarks;
	/** The person saw this mark. Only the mark of that time goes, so a newer rewrite stays marked. Answers whether one went. */
	acknowledge(path: string, branch: string, at: number): boolean;
	/** These marks are no longer true. Only a mark with the same `at` goes, so a newer one stays. Answers whether any went. */
	forget(path: string, stale: readonly StaleMark[]): boolean;
	/** Forget everything about a repository that left the list, its marks included. */
	remove(path: string): void;
	/** Stop every fetch, running or planned. Git is asked to stop, so it can clean up. */
	stop(): void;
}

interface Entry {
	target: WatchTarget;
	running: Promise<FetchResult> | null;
	failures: number;
	lastFetched: number | null;
	failure: FetchFailure | null;
	cancelTimer: (() => void) | null;
	/** A background fetch came due while the window was hidden. */
	due: boolean;
	/** The person asked for the fetch that is running or waiting its turn, so it runs even when background fetching was turned off meanwhile. */
	asked: boolean;
}

export function createFetcher(options: FetcherOptions): Fetcher {
	const {
		runGit,
		onChanged,
		onStatus,
		saveMarks = () => {},
		environment = process.env,
		schedule = scheduleWithTimer,
		now = Date.now,
		firstFetchMilliseconds = FIRST_FETCH_MILLISECONDS,
		staggerMilliseconds = STAGGER_MILLISECONDS,
		mostBackoffMilliseconds = MOST_BACKOFF_MILLISECONDS,
		mostAtOnce = MOST_AT_ONCE,
	} = options;
	const entries = new Map<string, Entry>();
	// Kept for repositories that are not fetched right now too, such as ones the development override leaves out.
	const marks: ForcePushMarks = structuredClone(options.marks ?? {});
	let setting: FetchSetting | null = null;
	let visible = true;
	const stopping = new AbortController();

	// At most `mostAtOnce` fetches run; the others wait their turn. A slot that is let go passes straight to the
	// next in line, so a fetch started in between cannot take it as well.
	let active = 0;
	const waiting: (() => void)[] = [];
	async function slot(): Promise<() => void> {
		if (active < mostAtOnce) active++;
		else await new Promise<void>(resolve => waiting.push(resolve));
		return () => {
			const next = waiting.shift();
			if (next) next();
			else active--;
		};
	}

	/** Fetches of repositories that left the list while they ran. One added again waits for its old fetch. */
	const draining = new Map<string, Promise<unknown>>();
	function drop(entry: Entry): void {
		cancel(entry);
		entries.delete(entry.target.path);
		if (!entry.running) return;
		const running = entry.running;
		draining.set(entry.target.path, running);
		void running.finally(() => {
			if (draining.get(entry.target.path) === running) draining.delete(entry.target.path);
		});
	}

	const stopped = () => stopping.signal.aborted;
	const statusOf = (entry: Entry): RepositoryFetch => ({
		repository: entry.target.path,
		fetching: entry.running !== null,
		lastFetched: entry.lastFetched,
		failure: entry.failure,
	});
	const current = (entry: Entry) => !stopped() && entries.get(entry.target.path) === entry;
	const tell = (entry: Entry) => {
		if (current(entry)) onStatus(statusOf(entry));
	};

	/** How long to wait before the next background fetch of a repository, from the end of the last one. */
	function waitAfter(entry: Entry): number {
		const interval = (setting?.intervalMinutes ?? 0) * 60_000;
		if (entry.failures === 0) return interval;
		return Math.min(interval * 2 ** entry.failures, Math.max(interval, mostBackoffMilliseconds));
	}

	function cancel(entry: Entry): void {
		entry.cancelTimer?.();
		entry.cancelTimer = null;
	}

	function plan(entry: Entry, delay: number): void {
		cancel(entry);
		entry.due = false;
		if (stopped() || !setting?.background || entry.running !== null) return;
		entry.cancelTimer = schedule(() => {
			entry.cancelTimer = null;
			if (!current(entry) || !setting?.background) return;
			if (visible) void run(entry, false);
			else entry.due = true;
		}, Math.max(0, delay));
	}

	function changeMarks(path: string, change: (branches: Record<string, ForcePushMark>) => boolean): boolean {
		const branches = { ...marks[path] };
		if (!change(branches)) return false;
		if (Object.keys(branches).length > 0) marks[path] = branches;
		else delete marks[path];
		saveMarks(structuredClone(marks));
		return true;
	}

	async function read(args: readonly string[]): Promise<string | null> {
		const answer = await runGit(args, { network: false, signal: stopping.signal });
		return answer.exitCode === 0 ? answer.stdout : null;
	}

	async function remoteRefs(gitDir: string): Promise<Map<string, string> | null> {
		const output = await read(["--git-dir", gitDir, "for-each-ref", `--format=${REMOTE_REF_FORMAT}`, "refs/remotes"]);
		return output === null ? null : parseRemoteRefs(output);
	}

	/** Whether `before` is an ancestor of `after`. Null when Git could not say, for example because a commit is missing. */
	async function fastForward(gitDir: string, before: string, after: string): Promise<boolean | null> {
		const answer = await runGit(["--git-dir", gitDir, "merge-base", "--is-ancestor", before, after], { network: false, signal: stopping.signal });
		return answer.exitCode === 0 ? true : answer.exitCode === 1 ? false : null;
	}

	/**
	 * One fetch of every tracked remote of a repository, and what came of it.
	 * `asked` is true when the person asked for it: a background fetch stops
	 * before the next remote once background fetching is turned off, unless
	 * the person asked for it meanwhile. `cutShort` says that a remote was
	 * left out that way, or because the repository left the list.
	 */
	async function fetchAll(entry: Entry, asked: boolean): Promise<{ failure: FetchFailure | null; cutShort: boolean }> {
		const gitDir = entry.target.commonDir;
		const unreadable = (): FetchFailure => ({ kind: "failed", message: `Git could not read the repository at ${entry.target.path}.`, at: now() });
		const listed = await read(["--git-dir", gitDir, "for-each-ref", `--format=${BRANCH_UPSTREAM_FORMAT}`, "refs/heads"]);
		const before = listed === null ? null : await remoteRefs(gitDir);
		if (listed === null || before === null) return { failure: unreadable(), cutShort: false };
		const branches = parseTrackedBranches(listed);
		// `git config` answers 1 when the key is not set.
		const sshCommand = await runGit(["--git-dir", gitDir, "config", "--get", "core.sshCommand"], { network: false, signal: stopping.signal });
		const env = batchSshCommand(environment, sshCommand.exitCode === 0 ? sshCommand.stdout : null);

		let failure: FetchFailure | null = null;
		let cutShort = false;
		for (const remote of trackedRemotes(branches)) {
			// The repository left the list, or background fetching was turned off, while an earlier remote was fetched.
			if (stopped() || !current(entry) || (!asked && !entry.asked && !setting?.background)) {
				cutShort = true;
				break;
			}
			const configured = await read(["--git-dir", gitDir, "config", "--get-all", `remote.${remote}.fetch`]);
			const refspecs = remoteTrackingRefspecs((configured ?? "").split("\n"));
			if (refspecs.length === 0) continue;
			const answer = await runGit([
				"--git-dir", gitDir, "-c", "credential.interactive=false", "fetch",
				"--prune", "--no-prune-tags", "--no-tags", "--no-write-fetch-head", "--recurse-submodules=no", "--no-auto-gc", "--refmap=",
				"--", remote, ...refspecs,
			], { network: true, signal: stopping.signal, env });
			if (answer.exitCode !== 0 && failure === null) failure = readFetchFailure(answer.stderr, now());
		}
		const after = await remoteRefs(gitDir);
		if (after === null) return { failure: failure ?? unreadable(), cutShort };
		// A repository that left the list meanwhile keeps no marks and reports nothing.
		if (!current(entry)) return { failure, cutShort: true };
		const marked = await noteRewrites(entry, branches, before, after);
		const changed = before.size !== after.size || [...after].some(([ref, object]) => before.get(ref) !== object);
		if ((changed || marked) && current(entry)) onChanged(entry.target.path);
		return { failure, cutShort };
	}

	/**
	 * Mark each branch whose upstream was rewritten, and forget marks that are
	 * no longer true: the branch is gone, tracks another upstream, or its
	 * upstream is gone. Answers whether any mark changed.
	 */
	async function noteRewrites(entry: Entry, branches: readonly TrackedBranch[], before: Map<string, string>, after: Map<string, string>): Promise<boolean> {
		const rewritten = new Map<string, boolean | null>();
		for (const { upstream } of branches) {
			const previous = before.get(upstream);
			const next = after.get(upstream);
			if (previous === undefined || next === undefined || previous === next || rewritten.has(upstream)) continue;
			rewritten.set(upstream, await fastForward(entry.target.commonDir, previous, next) === false);
		}
		// The repository may have left the list while Git answered.
		if (!current(entry)) return false;
		const at = now();
		return changeMarks(entry.target.path, marked => {
			let changed = false;
			for (const [branch, mark] of Object.entries(marked)) {
				const tracked = branches.find(candidate => candidate.branch === branch);
				if (tracked && tracked.upstream === mark.upstream && after.has(mark.upstream)) continue;
				delete marked[branch];
				changed = true;
			}
			for (const { branch, object: branchObject, upstream, upstreamName } of branches) {
				if (rewritten.get(upstream) !== true) continue;
				marked[branch] = { upstream, upstreamName, object: after.get(upstream)!, branchObject, at };
				changed = true;
			}
			return changed;
		});
	}

	/** Start a fetch, or join the one that runs. `asked` is true for Fetch now, false for a background fetch. */
	function run(entry: Entry, asked: boolean): Promise<FetchResult> {
		if (asked) entry.asked = true;
		if (entry.running) return entry.running;
		cancel(entry);
		entry.due = false;
		const running = (async (): Promise<FetchResult> => {
			// The same repository, removed and added again while its fetch ran: one fetch at a time all the same.
			await draining.get(entry.target.path)?.catch(() => {});
			const release = await slot();
			// While it waited its turn, the repository may have left the list, or background fetching been turned off.
			const left = !current(entry);
			if (left || (!entry.asked && !setting?.background)) {
				release();
				entry.running = null;
				entry.asked = false;
				tell(entry);
				return left
					? { outcome: "not-listed", message: `${entry.target.path} is no longer in this app's list. Nothing was fetched.` }
					: { outcome: "not-listed", message: "Background fetching was turned off. Nothing was fetched." };
			}
			const asked = entry.asked;
			entry.asked = false;
			let failure: FetchFailure | null;
			let cutShort = false;
			try {
				({ failure, cutShort } = await fetchAll(entry, asked));
			} catch (error) {
				failure = { kind: "failed", message: error instanceof Error ? error.message : String(error), at: now() };
			} finally {
				release();
			}
			if (cutShort && failure === null) {
				// Not every remote was fetched, so it does not count as a fetch that worked; the last one stands.
				entry.running = null;
				entry.asked = false;
				tell(entry);
				if (current(entry)) plan(entry, waitAfter(entry));
				return { outcome: "not-listed", message: "Fetching stopped before every remote was fetched, because background fetching was turned off or the repository left the list." };
			}
			entry.failure = failure;
			if (failure === null) {
				entry.failures = 0;
				entry.lastFetched = now();
			} else {
				entry.failures++;
			}
			entry.running = null;
			entry.asked = false;
			tell(entry);
			if (current(entry)) plan(entry, waitAfter(entry));
			const fetch = statusOf(entry);
			return failure === null ? { outcome: "fetched", fetch } : { outcome: "failed", fetch };
		})();
		entry.running = running;
		tell(entry);
		return running;
	}

	/** Plan the first background fetch of every repository that has none planned, a little apart. */
	function planAll(): void {
		let first = 0;
		for (const entry of entries.values()) {
			if (entry.running !== null || entry.cancelTimer !== null) continue;
			if (entry.lastFetched === null && entry.failure === null) {
				plan(entry, firstFetchMilliseconds + staggerMilliseconds * first++);
			} else {
				const ended = Math.max(entry.lastFetched ?? 0, entry.failure?.at ?? 0);
				plan(entry, ended + waitAfter(entry) - now());
			}
		}
	}

	return {
		sync(targets) {
			const wanted = new Map(targets.map(target => [target.path, target]));
			for (const entry of [...entries.values()]) {
				const target = wanted.get(entry.target.path);
				if (target && target.commonDir === entry.target.commonDir) continue;
				drop(entry);
			}
			for (const target of wanted.values()) {
				if (entries.has(target.path)) continue;
				entries.set(target.path, { target, running: null, failures: 0, lastFetched: null, failure: null, cancelTimer: null, due: false, asked: false });
			}
			planAll();
		},

		configure(next) {
			const before = setting;
			setting = { ...next };
			if (stopped()) return;
			if (!next.background) {
				for (const entry of entries.values()) {
					cancel(entry);
					entry.due = false;
				}
				return;
			}
			// A new interval counts from the end of the last fetch.
			if (before?.background && before.intervalMinutes !== next.intervalMinutes) {
				for (const entry of entries.values()) cancel(entry);
			}
			planAll();
		},

		setVisible(next) {
			if (visible === next) return;
			visible = next;
			if (!visible || stopped()) return;
			for (const entry of entries.values()) {
				if (entry.due && setting?.background) void run(entry, false);
			}
		},

		async fetchNow(path) {
			const entry = entries.get(path);
			if (!entry || stopped()) return { outcome: "not-listed", message: `${path} is not a repository in this app's list. Nothing was fetched.` };
			return run(entry, true);
		},

		statuses: () => [...entries.values()].map(statusOf),

		marks: path => structuredClone(marks[path] ?? {}),

		allMarks: () => structuredClone(marks),

		acknowledge(path, branch, at) {
			return changeMarks(path, marked => {
				if (marked[branch]?.at !== at) return false;
				delete marked[branch];
				return true;
			});
		},

		forget(path, stale) {
			return changeMarks(path, marked => {
				let changed = false;
				for (const { branch, at } of stale) {
					if (marked[branch]?.at !== at) continue;
					delete marked[branch];
					changed = true;
				}
				return changed;
			});
		},

		remove(path) {
			const entry = entries.get(path);
			if (entry) drop(entry);
			changeMarks(path, marked => {
				const had = Object.keys(marked).length > 0;
				for (const branch of Object.keys(marked)) delete marked[branch];
				return had;
			});
		},

		stop() {
			stopping.abort();
			for (const entry of entries.values()) cancel(entry);
			for (const resolve of waiting.splice(0)) resolve();
		},
	};
}
