import { describe, expect, test } from "bun:test";
import { createListingPace } from "../src/bun/listing-pace";
import { createRefreshPolicy } from "../src/bun/refresh-policy";
import type { Attention } from "../src/shared/attention";
import { manualClock } from "./support/clock";

const settle = () => Bun.sleep(0);
const A = "/work/a";
const B = "/work/b";

function setup() {
	const clock = manualClock();
	const sent: string[] = [];
	const resent: string[] = [];
	const pace = createListingPace({
		send: path => sent.push(path),
		resend: path => {
			resent.push(path);
			pace.announce(path);
		},
		schedule: clock.schedule,
		now: clock.now,
	});
	/** A read of `path` that takes `milliseconds` on the manual clock. */
	async function read(path: string, milliseconds: number): Promise<void> {
		let finish!: () => void;
		const done = pace.listing(path, () => new Promise<void>(resolve => {
			finish = resolve;
		}));
		clock.advance(milliseconds);
		finish();
		await done;
	}
	return { clock, sent, resent, pace, read };
}

describe("createListingPace", () => {
	test("sends a change at once when the repository has not been read lately", () => {
		const { pace, sent } = setup();
		pace.announce(A);
		expect(sent).toEqual([A]);
	});

	test("holds changes while a read runs, and sends them as one, three times the read's length after it ended", async () => {
		const { pace, sent, resent, clock } = setup();
		let finish!: () => void;
		const done = pace.listing(A, () => new Promise<void>(resolve => {
			finish = resolve;
		}));
		pace.announce(A);
		pace.announce(A);
		clock.advance(2000);
		expect(sent).toEqual([]);
		finish();
		await done;
		clock.advance(5999);
		expect(sent).toEqual([]);
		clock.advance(1);
		expect(resent).toEqual([A]);
		expect(sent).toEqual([A]);
	});

	test("holds a change that comes soon after a read, and sends one after it at once", async () => {
		const { pace, sent, clock, read } = setup();
		await read(A, 1000);
		clock.advance(1000);
		pace.announce(A);
		expect(sent).toEqual([]);
		clock.advance(2000);
		expect(sent).toEqual([A]);

		clock.advance(10_000);
		pace.announce(A);
		expect(sent).toEqual([A, A]);
	});

	test("measures overlapping reads of one repository as one busy span", async () => {
		const { pace, sent, clock } = setup();
		let first!: () => void;
		let second!: () => void;
		const one = pace.listing(A, () => new Promise<void>(resolve => {
			first = resolve;
		}));
		clock.advance(500);
		const two = pace.listing(A, () => new Promise<void>(resolve => {
			second = resolve;
		}));
		clock.advance(500);
		first();
		await one;
		pace.announce(A);
		clock.advance(1000);
		expect(sent).toEqual([]);
		second();
		await two;
		// Busy from 0 to 2000, so free at 2000 + 3 x 2000.
		clock.advance(5999);
		expect(sent).toEqual([]);
		clock.advance(1);
		expect(sent).toEqual([A]);
	});

	test("paces each repository on its own", async () => {
		const { pace, sent, read } = setup();
		await read(A, 1000);
		pace.announce(A);
		pace.announce(B);
		expect(sent).toEqual([B]);
	});

	test("a read that fails still counts", async () => {
		const { pace, sent, clock } = setup();
		await expect(pace.listing(A, async () => {
			clock.advance(1000);
			throw new Error("Timber stopped");
		})).rejects.toThrow("Timber stopped");
		pace.announce(A);
		expect(sent).toEqual([]);
		clock.advance(3000);
		expect(sent).toEqual([A]);
	});

	test("a new read while a change is held makes it wait for that read too", async () => {
		const { pace, sent, clock, read } = setup();
		await read(A, 1000);
		pace.announce(A);
		clock.advance(1000);
		await read(A, 1000);
		clock.advance(2999);
		expect(sent).toEqual([]);
		clock.advance(1);
		expect(sent).toEqual([A]);
	});

	test("sends nothing held after it stopped", async () => {
		const { pace, sent, clock, read } = setup();
		await read(A, 1000);
		pace.announce(A);
		pace.stop();
		clock.advance(60_000);
		pace.announce(B);
		expect(sent).toEqual([]);
		expect(clock.waiting()).toBe(0);
	});
});

describe("the pace behind the refresh policy", () => {
	const shown: Attention = { visible: true, focused: true, selected: { repository: A, worktree: A, id: A }, session: null };
	const hidden: Attention = { visible: false, focused: false, selected: { repository: A, worktree: A, id: A }, session: null };

	function wired() {
		const clock = manualClock();
		const sent: string[] = [];
		const stamps: string[] = [];
		const pace = createListingPace({ send: path => sent.push(path), resend: path => policy.changed(path), schedule: clock.schedule, now: clock.now });
		const policy = createRefreshPolicy({
			announce: path => pace.announce(path),
			readStamp: async worktree => {
				stamps.push(worktree.worktree);
				return "clean";
			},
			schedule: clock.schedule,
			now: clock.now,
		});
		return { clock, sent, stamps, pace, policy };
	}

	test("a change held while the window hides is passed on when it shows again, not while hidden", async () => {
		const { clock, sent, pace, policy } = wired();
		policy.attend({ ...shown, selected: null });
		await pace.listing(B, async () => clock.advance(1000));
		policy.changed(B);
		policy.attend({ ...hidden, selected: null });
		clock.advance(10_000);
		await settle();
		expect(sent).toEqual([]);
		policy.attend({ ...shown, selected: null });
		await settle();
		expect(sent).toEqual([B]);
	});

	test("the selected worktree's stamp is read again before a held change of its repository goes out", async () => {
		const { clock, sent, stamps, pace, policy } = wired();
		policy.attend(shown);
		await settle();
		await settle();
		const before = stamps.length;
		await pace.listing(A, async () => clock.advance(1000));
		policy.changed(A);
		await settle();
		await settle();
		const afterFirst = stamps.length;
		expect(afterFirst).toBeGreaterThan(before);
		expect(sent).toEqual([]);
		clock.advance(3000);
		await settle();
		await settle();
		expect(stamps.length).toBeGreaterThan(afterFirst);
		expect(sent).toEqual([A]);
	});
});
