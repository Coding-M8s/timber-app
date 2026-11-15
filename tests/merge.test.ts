import { describe, expect, test } from "bun:test";
import { mergeOverlapping } from "../src/mainview/store/merge";

/** A task whose runs finish only when the test says so. */
function manualTask() {
	const finishers: Array<{ key: string; finish: () => void; fail: (error: Error) => void }> = [];
	const run = (key: string) => new Promise<void>((resolve, reject) => {
		finishers.push({ key, finish: resolve, fail: reject });
	});
	return { run, finishers };
}

const settle = () => Bun.sleep(0);

describe("mergeOverlapping", () => {
	test("starts a run at once when none is in progress", () => {
		const { run, finishers } = manualTask();
		const merged = mergeOverlapping(run);
		void merged("a");
		expect(finishers.map(entry => entry.key)).toEqual(["a"]);
	});

	test("merges every call made during a run into one follow-up run", async () => {
		const { run, finishers } = manualTask();
		const merged = mergeOverlapping(run);
		const settled: string[] = [];
		void merged("a").then(() => settled.push("first"));
		void merged("a").then(() => settled.push("second"));
		void merged("a").then(() => settled.push("third"));
		void merged("a").then(() => settled.push("fourth"));
		expect(finishers.length).toBe(1);

		finishers[0]!.finish();
		await settle();
		// The follow-up has started, and the later callers wait for it, not for the run they overlapped.
		expect(finishers.length).toBe(2);
		expect(settled).toEqual(["first"]);

		finishers[1]!.finish();
		await settle();
		expect(settled).toEqual(["first", "second", "third", "fourth"]);
		expect(finishers.length).toBe(2);
	});

	test("starts fresh once everything has finished", async () => {
		const { run, finishers } = manualTask();
		const merged = mergeOverlapping(run);
		const first = merged("a");
		finishers[0]!.finish();
		await first;
		void merged("a");
		expect(finishers.length).toBe(2);
	});

	test("keeps different keys apart", () => {
		const { run, finishers } = manualTask();
		const merged = mergeOverlapping(run);
		void merged("a");
		void merged("b");
		void merged("a");
		expect(finishers.map(entry => entry.key)).toEqual(["a", "b"]);
	});

	test("still runs the follow-up when the run in progress fails", async () => {
		const { run, finishers } = manualTask();
		const merged = mergeOverlapping(run);
		const first = merged("a");
		const second = merged("a");
		finishers[0]!.fail(new Error("broken"));
		await expect(first).rejects.toThrow("broken");
		await settle();
		expect(finishers.length).toBe(2);
		finishers[1]!.finish();
		await second;
		void merged("a");
		expect(finishers.length).toBe(3);
	});
});
