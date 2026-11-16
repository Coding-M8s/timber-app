import { type Attention, type AttendedWorktree, assumedAttention, sameAttention } from "../shared/attention";
import { type Schedule, scheduleWithTimer } from "./repository-watcher";
import type { ReadStamp } from "./worktree-stamp";

/** How often the selected worktree is checked for edits that leave Git's own files alone. */
export const POLL_MILLISECONDS = 4000;
/** A check is never repeated sooner than this many times its own duration, so a slow status cannot keep the machine busy. */
const POLL_BACKOFF = 10;
/**
 * A stamp that has not answered after this long counts as not read, so one
 * stuck read, as on a hanging network folder, cannot hold up later checks and
 * announcements.
 */
export const STAMP_LIMIT_MILLISECONDS = 10_000;
/** Getting the focus back refreshes at most once in this long, so switching windows quickly costs one refresh. */
export const RETURN_MILLISECONDS = 2000;

export interface RefreshPolicyOptions {
	/** Tell the window that a repository changed, by its primary checkout. */
	announce: (path: string) => void;
	readStamp: ReadStamp;
	/** Called when the window comes back, to start watches that could not start before. */
	onReturn?: () => void;
	schedule?: Schedule;
	now?: () => number;
	pollMilliseconds?: number;
	returnMilliseconds?: number;
	stampLimitMilliseconds?: number;
}

/**
 * Decides when the window hears that a repository changed.
 *
 * - A change from the watcher is passed on while the window shows. While it
 *   is hidden, changed repositories are only noted, and are passed on once
 *   when it shows again.
 * - While the window shows, the selected worktree is checked every few
 *   seconds (see ./worktree-stamp.ts), and a different answer is passed on as
 *   a change of its repository. Nothing is checked while it is hidden.
 * - Getting the focus back passes on a change of the selected worktree's
 *   repository, for edits made elsewhere in the meantime.
 *
 * Before the selected worktree's repository is announced, its stamp is read
 * again. So a reload always reads data at least as new as the stamp, and the
 * next check does not announce the same change twice.
 */
export interface RefreshPolicy {
	/** The watcher saw a change in this repository. */
	changed(path: string): void;
	/** The window says how it is. Safe to call with the same value again. */
	attend(attention: Attention): void;
	stop(): void;
}

const keyOf = (worktree: AttendedWorktree | null) => worktree === null ? null : `${worktree.repository}\0${worktree.worktree}`;

export function createRefreshPolicy(options: RefreshPolicyOptions): RefreshPolicy {
	const {
		announce,
		readStamp,
		onReturn = () => {},
		schedule = scheduleWithTimer,
		now = Date.now,
		pollMilliseconds = POLL_MILLISECONDS,
		returnMilliseconds = RETURN_MILLISECONDS,
		stampLimitMilliseconds = STAMP_LIMIT_MILLISECONDS,
	} = options;

	let attention = assumedAttention;
	let stopped = false;
	/** Repositories that changed while the window was hidden. */
	const missed = new Set<string>();
	/** The last stamp of the selected worktree, by its key. */
	let baseline: { key: string; stamp: string | null } | null = null;
	let cancelPoll: (() => void) | null = null;
	let lastReturn = Number.NEGATIVE_INFINITY;

	// Stamps are read one at a time, so a check and an announcement never race for the baseline.
	let queue: Promise<void> = Promise.resolve();
	function inTurn(task: () => Promise<void>): Promise<void> {
		const run = queue.then(task);
		queue = run.catch(() => {});
		return queue;
	}

	/**
	 * The baseline after a read. A stamp that could not be read keeps the last
	 * one of the same worktree, so a change across a failed check is still seen.
	 */
	function nextBaseline(read: { key: string; stamp: string | null }): { key: string; stamp: string | null } {
		return read.stamp === null && baseline?.key === read.key ? baseline : read;
	}

	async function readBaseline(): Promise<{ key: string; stamp: string | null } | null> {
		const selected = attention.selected;
		const key = keyOf(selected);
		if (selected === null || key === null) return null;
		let stamp: string | null;
		let cancelLimit = () => {};
		try {
			stamp = await Promise.race([
				readStamp(selected),
				new Promise<null>(resolve => {
					cancelLimit = schedule(() => resolve(null), stampLimitMilliseconds);
				}),
			]);
		} catch {
			stamp = null;
		} finally {
			cancelLimit();
		}
		// The selection moved while Git answered: the answer is about a worktree no longer selected.
		if (keyOf(attention.selected) !== key) return null;
		return { key, stamp };
	}

	function report(paths: Iterable<string>): void {
		const unique = [...new Set(paths)];
		const selected = attention.selected?.repository;
		for (const path of unique) {
			if (path !== selected) announce(path);
		}
		if (selected === undefined || !unique.includes(selected)) return;
		void inTurn(async () => {
			const read = await readBaseline();
			if (stopped) return;
			if (read) baseline = nextBaseline(read);
			announce(selected);
		});
	}

	function startPoll(delay: number): void {
		cancelPoll?.();
		cancelPoll = null;
		if (stopped || !attention.visible || attention.selected === null) return;
		cancelPoll = schedule(check, delay);
	}

	function check(): void {
		cancelPoll = null;
		let next = pollMilliseconds;
		void inTurn(async () => {
			if (stopped || !attention.visible || attention.selected === null) return;
			const selected = attention.selected;
			const started = now();
			const read = await readBaseline();
			next = Math.max(pollMilliseconds, (now() - started) * POLL_BACKOFF);
			if (stopped || read === null || !attention.visible) return;
			const before = baseline?.key === read.key ? baseline.stamp : null;
			baseline = nextBaseline(read);
			if (before !== null && read.stamp !== null && read.stamp !== before) announce(selected.repository);
		}).then(() => {
			// Another poll may have been started meanwhile, by a new selection or by the window coming back.
			if (cancelPoll === null) startPoll(next);
		});
	}

	return {
		changed(path) {
			if (stopped) return;
			if (attention.visible) report([path]);
			else missed.add(path);
		},

		attend(next) {
			if (stopped || sameAttention(attention, next)) return;
			const previous = attention;
			attention = next;
			if (!next.visible) {
				cancelPoll?.();
				cancelPoll = null;
				return;
			}
			const shown = !previous.visible;
			const focused = next.focused && !previous.focused;
			const moved = keyOf(previous.selected) !== keyOf(next.selected);
			if (moved) baseline = null;

			const paths = [...missed];
			missed.clear();
			if ((shown || focused) && now() - lastReturn >= returnMilliseconds) {
				lastReturn = now();
				onReturn();
				if (next.selected) paths.push(next.selected.repository);
			}
			report(paths);

			// A new selection takes its first stamp at once, which is only the baseline for later checks.
			if (moved) startPoll(0);
			else if (shown || cancelPoll === null) startPoll(pollMilliseconds);
		},

		stop() {
			stopped = true;
			cancelPoll?.();
			cancelPoll = null;
			missed.clear();
		},
	};
}
