import { describe, expect, test } from "bun:test";
import { LAUNCH_REUSE_MILLISECONDS, REUSE_MILLISECONDS, createRecentListings } from "../src/bun/recent-listings";
import type { RepositoryReader } from "../src/bun/repository-reader";
import type { Repository } from "../src/shared/model";

const A = "/work/a";
const B = "/work/b";

const repository = (path: string, read: number): Repository => ({ path, name: `read ${read}`, available: true, failure: null, setup: "repository", fallbackBase: null, worktrees: [] });

function setup() {
	let clock = 0;
	const reads: string[] = [];
	const waiting: (() => void)[] = [];
	let hold = false;
	const reader: RepositoryReader = {
		find: async () => ({ outcome: "not-a-repository" }),
		reload: async path => {
			reads.push(path);
			const read = reads.length;
			if (hold) await new Promise<void>(resolve => waiting.push(resolve));
			return repository(path, read);
		},
	};
	const paced: string[] = [];
	/** Which watch hears each repository now; A and B are watched from the start. */
	const watches = new Map<string, number | null>([[A, 1], [B, 1]]);
	const listings = createRecentListings(reader, {
		now: () => clock,
		watching: path => watches.get(path) ?? null,
		listing: (path, task) => {
			paced.push(path);
			return task();
		},
	});
	return {
		listings, reads, paced, watches,
		advance: (milliseconds: number) => void (clock += milliseconds),
		holdReads: (on: boolean) => void (hold = on),
		release: () => waiting.splice(0).forEach(resolve => resolve()),
	};
}

describe("createRecentListings", () => {
	test("reload always reads again, through the pace", async () => {
		const { listings, reads, paced } = setup();
		await listings.reload(A);
		await listings.reload(A);
		expect(reads).toEqual([A, A]);
		expect(paced).toEqual([A, A]);
	});

	test("recent reuses the last listing while no change was heard", async () => {
		const { listings, reads, advance } = setup();
		await listings.reload(A);
		advance(5000);
		expect((await listings.recent(A))?.name).toBe("read 1");
		expect(reads).toEqual([A]);
	});

	test("recent reads again after a change was heard, or once the listing is too old", async () => {
		const { listings, reads, advance } = setup();
		await listings.reload(A);
		listings.forget(A);
		expect((await listings.recent(A))?.name).toBe("read 2");
		advance(10_000);
		expect((await listings.recent(A))?.name).toBe("read 3");
		expect(reads).toEqual([A, A, A]);
	});

	test("recent joins a read that is running, unless a change was heard after it began", async () => {
		const { listings, reads, holdReads, release } = setup();
		holdReads(true);
		const running = listings.reload(A);
		const joined = listings.recent(A);
		listings.forget(A);
		const fresh = listings.recent(A);
		release();
		await Promise.resolve();
		release();
		expect((await running)?.name).toBe("read 1");
		expect((await joined)?.name).toBe("read 1");
		expect((await fresh)?.name).toBe("read 2");
		expect(reads).toEqual([A, A]);
	});

	test("keeps each repository apart, and never reuses a read that failed", async () => {
		const { listings, reads } = setup();
		await listings.reload(A);
		await listings.recent(B);
		expect(reads).toEqual([A, B]);

		let fail = true;
		const failing = createRecentListings({
			find: async () => ({ outcome: "not-a-repository" }),
			reload: async path => {
				if (fail) throw new Error("Timber stopped");
				return repository(path, 1);
			},
		});
		await expect(failing.reload(A)).rejects.toThrow("Timber stopped");
		fail = false;
		expect((await failing.recent(A))?.name).toBe("read 1");
	});

	test("never reuses a listing that Timber could not make, or a repository Git could not find", async () => {
		const answers: (Repository | null)[] = [{ ...repository(A, 1), failure: "Timber could not list" }, null, repository(A, 3)];
		let asked = 0;
		const listings = createRecentListings({
			find: async () => ({ outcome: "not-a-repository" }),
			reload: async () => answers[asked++] ?? null,
		});
		expect((await listings.reload(A))?.failure).toBe("Timber could not list");
		expect(await listings.recent(A)).toBeNull();
		expect((await listings.recent(A))?.name).toBe("read 3");
		expect((await listings.recent(A))?.name).toBe("read 3");
		expect(asked).toBe(3);
	});

	test("known answers a launch from the last listing for much longer than recent, while no change was heard", async () => {
		const { listings, reads, advance } = setup();
		await listings.reload(A);
		advance(REUSE_MILLISECONDS + 1);
		expect((await listings.known(A))?.name).toBe("read 1");
		// The Changes view and chops still read again after ten seconds.
		expect((await listings.recent(A))?.name).toBe("read 2");
		advance(LAUNCH_REUSE_MILLISECONDS - 1);
		expect((await listings.known(A))?.name).toBe("read 2");
		expect(reads).toEqual([A, A]);
	});

	test("known has nothing, and reads nothing, with no listing yet, after a change was heard, or past the guard age", async () => {
		const { listings, reads, advance } = setup();
		expect(listings.known(A)).toBeNull();
		expect(reads).toEqual([]);
		await listings.reload(A);
		listings.forget(A);
		expect(listings.known(A)).toBeNull();
		await listings.reload(A);
		expect((await listings.known(A))?.name).toBe("read 2");
		advance(LAUNCH_REUSE_MILLISECONDS);
		expect(listings.known(A)).toBeNull();
		expect(reads).toEqual([A, A]);
	});

	test("known has nothing unless the watch that heard the repository when the listing began still does", async () => {
		const { listings, watches } = setup();
		// Read while not watched: not kept for a launch, even once a watch starts.
		watches.set(A, null);
		await listings.reload(A);
		expect(listings.known(A)).toBeNull();
		watches.set(A, 1);
		expect(listings.known(A)).toBeNull();
		await listings.reload(A);
		expect((await listings.known(A))?.name).toBe("read 2");
		// The watch started again, so a change may have gone unheard between the two.
		watches.set(A, 2);
		expect(listings.known(A)).toBeNull();
		// Not watched any more.
		watches.set(A, null);
		expect(listings.known(A)).toBeNull();
	});

	test("known joins a read that is running, unless a change was heard after it began", async () => {
		const { listings, reads, holdReads, release } = setup();
		holdReads(true);
		const running = listings.reload(A);
		const joined = listings.known(A);
		listings.forget(A);
		expect(listings.known(A)).toBeNull();
		release();
		expect((await joined)?.name).toBe("read 1");
		expect((await running)?.name).toBe("read 1");
		expect(reads).toEqual([A]);
	});

	test("known never keeps a listing Timber could not make", async () => {
		const listings = createRecentListings({
			find: async () => ({ outcome: "not-a-repository" }),
			reload: async path => ({ ...repository(path, 1), failure: "Timber could not list" }),
		}, { watching: () => 1 });
		expect((await listings.reload(A))?.failure).toBe("Timber could not list");
		expect(listings.known(A)).toBeNull();
	});

	test("known has nothing when no watch is given", async () => {
		const listings = createRecentListings({
			find: async () => ({ outcome: "not-a-repository" }),
			reload: async path => repository(path, 1),
		});
		await listings.reload(A);
		expect(listings.known(A)).toBeNull();
	});
});
