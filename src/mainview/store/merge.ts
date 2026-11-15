interface Slot {
	/** Callers that arrived during the run in progress, all waiting for one run after it. */
	follow: { promise: Promise<void>; resolve: (settled: Promise<void>) => void } | null;
}

/**
 * Wrap `run` so that overlapping calls for the same key are merged.
 *
 * At most one run per key is in progress. A call that arrives meanwhile does
 * not start a second one and does not settle for the run in progress either,
 * because that one may have read its data before whatever prompted the call.
 * Instead every such call shares a single follow-up run that starts when the
 * current one ends. So any number of overlapping calls cost at most two runs,
 * and every caller's promise settles on data read after it asked.
 */
export function mergeOverlapping<Key>(run: (key: Key) => Promise<void>): (key: Key) => Promise<void> {
	const slots = new Map<Key, Slot>();

	async function drive(key: Key, slot: Slot): Promise<void> {
		try {
			await run(key);
		} finally {
			const follow = slot.follow;
			if (follow) {
				slot.follow = null;
				follow.resolve(drive(key, slot));
			} else {
				slots.delete(key);
			}
		}
	}

	return key => {
		const slot = slots.get(key);
		if (!slot) {
			const created: Slot = { follow: null };
			slots.set(key, created);
			return drive(key, created);
		}
		if (!slot.follow) {
			let resolve!: (settled: Promise<void>) => void;
			const promise = new Promise<void>(settle => {
				resolve = settle;
			});
			slot.follow = { promise, resolve };
		}
		return slot.follow.promise;
	};
}
