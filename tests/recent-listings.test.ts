import { describe, expect, test } from "bun:test";
import { createRecentListings } from "../src/bun/recent-listings";
import type { RepositoryReader } from "../src/bun/repository-reader";
import type { Repository } from "../src/shared/model";

const A = "/work/a";
const B = "/work/b";

const repository = (path: string, read: number): Repository => ({ path, name: `read ${read}`, available: true, failure: null, setup: "repository", worktrees: [] });

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
	const listings = createRecentListings(reader, {
		now: () => clock,
		listing: (path, task) => {
			paced.push(path);
			return task();
		},
	});
	return {
		listings, reads, paced,
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
});
