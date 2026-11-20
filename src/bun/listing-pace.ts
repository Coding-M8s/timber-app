import { type Schedule, scheduleWithTimer } from "./repository-watcher";

/**
 * After a repository was read, a background change of it is passed on no
 * sooner than this many times as long as the reading took. So with outside
 * tools writing the index all the time, `timber ls` runs for one repository
 * at most a quarter of the time. It may use several cores while it runs.
 */
export const PACE_FACTOR = 3;

export interface ListingPaceOptions {
	/** Tell the window that a repository changed, by its primary checkout. */
	send: (path: string) => void;
	/**
	 * A held change came due. It goes back through the refresh policy, so it is
	 * only noted while the window is hidden, and the selected worktree's stamp
	 * is read again before it is passed on.
	 */
	resend: (path: string) => void;
	schedule?: Schedule;
	now?: () => number;
	factor?: number;
}

/**
 * Paces the background reloads of each repository by what reading it costs.
 *
 * Every read of a repository's worktrees goes through `listing`, which notes
 * how long it kept that repository busy. A change announced while one runs,
 * or sooner than `factor` times its length after the last one ended, is held,
 * and the changes held for one repository become one, sent once that time is
 * over. A change after a quiet spell is sent at once.
 *
 * Only background changes are paced. Reloads the person asks for, by
 * Refresh or a command, read the repository without waiting here.
 */
export interface ListingPace {
	/** A background change of this repository, from the refresh policy. */
	announce(path: string): void;
	/** Run one read of the repository's worktrees, and count the time it takes. */
	listing<T>(path: string, task: () => Promise<T>): Promise<T>;
	stop(): void;
}

interface Pace {
	/** Reads of this repository that have not ended yet. */
	running: number;
	/** When the reads still running began, the first of them. */
	busySince: number;
	/** Before this, a change is held. */
	freeAt: number;
	held: boolean;
	cancel: (() => void) | null;
}

export function createListingPace(options: ListingPaceOptions): ListingPace {
	// A monotonic clock, so a change of the system time cannot hold changes back for long.
	const { send, resend, schedule = scheduleWithTimer, now = () => performance.now(), factor = PACE_FACTOR } = options;
	const paces = new Map<string, Pace>();
	let stopped = false;

	function paceOf(path: string): Pace {
		let pace = paces.get(path);
		if (!pace) {
			pace = { running: 0, busySince: 0, freeAt: Number.NEGATIVE_INFINITY, held: false, cancel: null };
			paces.set(path, pace);
		}
		return pace;
	}

	function arm(path: string, pace: Pace): void {
		if (stopped || pace.cancel !== null || pace.running > 0) return;
		pace.cancel = schedule(() => {
			pace.cancel = null;
			if (stopped || !pace.held || pace.running > 0) return;
			pace.held = false;
			resend(path);
		}, Math.max(0, pace.freeAt - now()));
	}

	return {
		announce(path) {
			if (stopped) return;
			const pace = paceOf(path);
			if (pace.running === 0 && now() >= pace.freeAt) {
				send(path);
				return;
			}
			pace.held = true;
			arm(path, pace);
		},

		async listing(path, task) {
			const pace = paceOf(path);
			if (pace.running === 0) {
				pace.busySince = now();
				// A held change waits for this read to end.
				pace.cancel?.();
				pace.cancel = null;
			}
			pace.running++;
			try {
				return await task();
			} finally {
				pace.running--;
				if (pace.running === 0) {
					const ended = now();
					pace.freeAt = ended + factor * (ended - pace.busySince);
					if (pace.held) arm(path, pace);
				}
			}
		},

		stop() {
			stopped = true;
			for (const pace of paces.values()) {
				pace.cancel?.();
				pace.cancel = null;
				pace.held = false;
			}
		},
	};
}
