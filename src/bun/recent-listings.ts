import type { Repository } from "../shared/model";
import type { RepositoryReader } from "./repository-reader";

/** A listing is reused for at most this long, even when no change was heard, in case a watch is not working. */
export const REUSE_MILLISECONDS = 10_000;
/**
 * A launch answers from a listing at most this old. Only a guard for a watch
 * that stopped hearing without saying so: a change it hears forgets the
 * listing at once, whatever its age.
 */
export const LAUNCH_REUSE_MILLISECONDS = 600_000;

export interface RecentListingsOptions {
	/** Run one read of a repository, such as through the pace (see ./listing-pace.ts). Runs it as it is by default. */
	listing?: <T>(path: string, task: () => Promise<T>) => Promise<T>;
	now?: () => number;
	reuseMilliseconds?: number;
	launchReuseMilliseconds?: number;
	/**
	 * Which watch of the repository is hearing its changes now, or null when
	 * none is (see `RepositoryWatcher.watching`). Only `known` asks. Null for
	 * every repository when left out, so `known` always reads.
	 */
	watching?: (path: string) => number | null;
}

/**
 * A reader that keeps the last listing of each repository, for the read-only
 * views that only need to know which worktrees Timber lists and their saved
 * bases: the Changes view and chops. A background reload of the sidebar is
 * followed by those reads at once, and each would otherwise run the whole
 * `timber ls` again.
 *
 * - `reload` always reads again, and is what the sidebar and every command
 *   that changes a repository use.
 * - `recent` answers with the last listing when no change of that repository
 *   was heard since it began and it is not older than `reuseMilliseconds`,
 *   joins one that is running, and reads again otherwise.
 * - `known` is for opening a session or the external editor. It answers with
 *   the last listing, or joins one that is running, on the same terms as
 *   `recent` but with the much longer `launchReuseMilliseconds`, and only
 *   while the watch that was hearing the repository when the listing began
 *   still is, so a change that nothing could hear is never missed. Otherwise
 *   it is null and reads nothing: the launch then reads as `find` does. It
 *   does not change what `recent` means for the Changes view and chops.
 * - `forget` is called for every change the watcher or a fetch hears, before
 *   the window is told, so the reload that follows is never answered from
 *   before the change.
 */
export interface RecentListings extends RepositoryReader {
	recent(path: string): Promise<Repository | null>;
	known(path: string): Promise<Repository | null> | null;
	forget(path: string): void;
}

interface Kept {
	/** The number of changes heard when this read began. */
	epoch: number;
	began: number;
	/** The watch hearing the repository when this read began, or null for none. */
	watch: number | null;
	answer: Promise<Repository | null>;
	settled: boolean;
}

export function createRecentListings(reader: RepositoryReader, options: RecentListingsOptions = {}): RecentListings {
	const {
		listing = (_path, task) => task(),
		now = () => performance.now(),
		reuseMilliseconds = REUSE_MILLISECONDS,
		launchReuseMilliseconds = LAUNCH_REUSE_MILLISECONDS,
		watching = () => null,
	} = options;
	const epochs = new Map<string, number>();
	const kept = new Map<string, Kept>();

	const epochOf = (path: string) => epochs.get(path) ?? 0;

	function read(path: string): Promise<Repository | null> {
		const entry: Kept = { epoch: epochOf(path), began: now(), watch: watching(path), answer: listing(path, () => reader.reload(path)), settled: false };
		kept.set(path, entry);
		entry.answer.then(
			answer => {
				entry.settled = true;
				// A repository that could not be listed is asked again next time, so a retry reaches Timber.
				if ((answer === null || answer.failure !== null) && kept.get(path) === entry) kept.delete(path);
			},
			() => {
				// A read that failed is never reused.
				if (kept.get(path) === entry) kept.delete(path);
			},
		);
		return entry.answer;
	}

	return {
		find: folder => reader.find(folder),
		reload: read,
		recent(path) {
			const entry = kept.get(path);
			if (entry && entry.epoch === epochOf(path) && (!entry.settled || now() - entry.began < reuseMilliseconds)) return entry.answer;
			return read(path);
		},
		known(path) {
			const entry = kept.get(path);
			const watch = watching(path);
			if (entry && entry.epoch === epochOf(path) && watch !== null && entry.watch === watch
				&& (!entry.settled || now() - entry.began < launchReuseMilliseconds)) return entry.answer;
			return null;
		},
		forget(path) {
			epochs.set(path, epochOf(path) + 1);
		},
	};
}
