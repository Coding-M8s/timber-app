import { describe, expect, test } from "bun:test";
import { createRefreshPolicy } from "../src/bun/refresh-policy";
import type { Attention, AttendedWorktree } from "../src/shared/attention";
import { manualClock } from "./support/clock";

const settle = () => Bun.sleep(0);
const A = "/work/a";
const B = "/work/b";
const A_MAIN: AttendedWorktree = { repository: A, worktree: A };
const A_FEAT: AttendedWorktree = { repository: A, worktree: "/work/a-worktrees/feat" };
const B_MAIN: AttendedWorktree = { repository: B, worktree: B };

const shown = (selected: AttendedWorktree | null, focused = true): Attention => ({ visible: true, focused, selected });
const hidden = (selected: AttendedWorktree | null): Attention => ({ visible: false, focused: false, selected });

function setup() {
	const clock = manualClock();
	const announced: string[] = [];
	const stamps = new Map<string, string | null>();
	const reads: string[] = [];
	let returns = 0;
	const policy = createRefreshPolicy({
		announce: path => announced.push(path),
		readStamp: async worktree => {
			reads.push(worktree.worktree);
			return stamps.has(worktree.worktree) ? stamps.get(worktree.worktree)! : "clean";
		},
		onReturn: () => returns++,
		schedule: clock.schedule,
		now: clock.now,
	});
	/** Move the clock, and let every check that came due answer. */
	async function advance(milliseconds: number): Promise<void> {
		clock.advance(milliseconds);
		await settle();
		await settle();
	}
	return { clock, announced, stamps, reads, policy, advance, returns: () => returns };
}

describe("createRefreshPolicy", () => {
	test("passes changes on while the window shows, even before it has said anything", () => {
		const { policy, announced } = setup();
		policy.changed(A);
		expect(announced).toEqual([A]);
	});

	test("collects changes while the window is hidden, and passes each on once when it shows again", async () => {
		const { policy, announced, advance } = setup();
		policy.attend(hidden(null));
		policy.changed(A);
		policy.changed(B);
		policy.changed(A);
		await advance(60_000);
		expect(announced).toEqual([]);
		policy.attend(shown(null));
		await settle();
		expect(announced.sort()).toEqual([A, B]);
	});

	test("checks nothing while the window is hidden", async () => {
		const { policy, reads, advance } = setup();
		policy.attend(hidden(A_MAIN));
		await advance(60_000);
		expect(reads).toEqual([]);
	});

	test("checks the selected worktree every few seconds and announces its repository when the stamp changes", async () => {
		const { policy, announced, stamps, reads, advance } = setup();
		policy.attend(shown(A_FEAT));
		// The first stamp is only the baseline.
		await advance(0);
		expect(reads).toEqual([A_FEAT.worktree]);
		await advance(4000);
		expect(reads.length).toBe(2);
		expect(announced).toEqual([]);

		stamps.set(A_FEAT.worktree, "edited");
		await advance(4000);
		expect(announced).toEqual([A]);
		// The same stamp again is not news.
		await advance(4000);
		expect(announced).toEqual([A]);
	});

	test("reads the stamp before announcing the selected repository, so the next check does not announce it again", async () => {
		const { policy, announced, stamps, advance } = setup();
		policy.attend(shown(A_MAIN));
		await advance(0);
		// A commit: the watcher reports it, and the status changes with it.
		stamps.set(A, "committed");
		policy.changed(A);
		await settle();
		expect(announced).toEqual([A]);
		await advance(4000);
		await advance(4000);
		expect(announced).toEqual([A]);
	});

	test("announces another repository at once, without reading a stamp", async () => {
		const { policy, announced, reads, advance } = setup();
		policy.attend(shown(A_MAIN));
		await advance(0);
		reads.length = 0;
		policy.changed(B);
		expect(announced).toEqual([B]);
		expect(reads).toEqual([]);
	});

	test("starts over with a new baseline when the selection moves", async () => {
		const { policy, announced, stamps, reads, advance } = setup();
		stamps.set(A, "a");
		stamps.set(B, "b");
		policy.attend(shown(A_MAIN));
		await advance(0);
		policy.attend(shown(B_MAIN));
		await advance(0);
		expect(reads).toEqual([A, B]);
		await advance(4000);
		// A different stamp from another worktree is not a change.
		expect(announced).toEqual([]);
	});

	test("does not announce a stamp that cannot be read, and still sees a change across it", async () => {
		const { policy, announced, stamps, advance } = setup();
		policy.attend(shown(A_MAIN));
		await advance(0);
		stamps.set(A, null);
		await advance(4000);
		expect(announced).toEqual([]);
		// Back to what it was: nothing changed.
		stamps.delete(A);
		await advance(4000);
		expect(announced).toEqual([]);
		stamps.set(A, null);
		await advance(4000);
		stamps.set(A, "edited meanwhile");
		await advance(4000);
		expect(announced).toEqual([A]);
	});

	test("gives up on a stamp that never answers, and goes on checking and announcing", async () => {
		const clock = manualClock();
		const announced: string[] = [];
		let calls = 0;
		const policy = createRefreshPolicy({
			announce: path => announced.push(path),
			// The first read hangs for good, as on a stuck network folder. Later ones answer.
			readStamp: () => ++calls === 1 ? new Promise<string>(() => {}) : Promise.resolve("same"),
			schedule: clock.schedule,
			now: clock.now,
		});
		const advance = async (milliseconds: number) => {
			clock.advance(milliseconds);
			await settle();
			await settle();
		};
		policy.attend(shown(A_MAIN));
		await advance(0);
		policy.changed(A);
		await advance(9_999);
		expect(announced).toEqual([]);
		await advance(1);
		expect(announced).toEqual([A]);
		// A check that took the whole limit waits ten times as long before the next one.
		expect(calls).toBe(2);
		await advance(100_000);
		expect(calls).toBe(3);
		policy.stop();
	});

	test("refreshes the selected repository when the focus comes back, at most once in two seconds", async () => {
		const { policy, announced, advance, returns } = setup();
		policy.attend(shown(A_MAIN, false));
		await advance(0);
		announced.length = 0;
		policy.attend(shown(A_MAIN, true));
		await settle();
		expect(announced).toEqual([A]);
		expect(returns()).toBe(1);

		// Switching windows quickly.
		policy.attend(shown(A_MAIN, false));
		policy.attend(shown(A_MAIN, true));
		await settle();
		expect(announced).toEqual([A]);

		await advance(2000);
		policy.attend(shown(A_MAIN, false));
		policy.attend(shown(A_MAIN, true));
		await settle();
		expect(announced).toEqual([A, A]);
	});

	test("showing the window again refreshes the selected repository and what changed meanwhile, once each", async () => {
		const { policy, announced, advance } = setup();
		policy.attend(shown(A_MAIN));
		await advance(0);
		policy.attend(hidden(A_MAIN));
		policy.changed(A);
		policy.changed(B);
		policy.attend(shown(A_MAIN));
		await settle();
		await settle();
		expect(announced.sort()).toEqual([A, B]);
	});

	test("a slow check waits longer before the next one", async () => {
		const clock = manualClock();
		const reads: number[] = [];
		const policy = createRefreshPolicy({
			announce: () => {},
			readStamp: async () => {
				reads.push(clock.now());
				// The status takes a second.
				clock.advance(1000);
				return "same";
			},
			schedule: clock.schedule,
			now: clock.now,
		});
		policy.attend(shown(A_MAIN));
		clock.advance(0);
		await settle();
		await settle();
		clock.advance(9_999);
		await settle();
		expect(reads.length).toBe(1);
		clock.advance(1);
		await settle();
		expect(reads.length).toBe(2);
		policy.stop();
	});

	test("stop ends the checks and drops what was collected", async () => {
		const { policy, announced, reads, clock, advance } = setup();
		policy.attend(shown(A_MAIN));
		await advance(0);
		policy.attend(hidden(A_MAIN));
		policy.changed(B);
		policy.stop();
		policy.attend(shown(A_MAIN));
		policy.changed(A);
		reads.length = 0;
		await advance(60_000);
		expect(announced).toEqual([]);
		expect(reads).toEqual([]);
		expect(clock.waiting()).toBe(0);
	});
});
