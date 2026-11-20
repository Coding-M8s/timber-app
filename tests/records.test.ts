import { describe, expect, test } from "bun:test";
import { keepEntries } from "../src/mainview/store/records";

describe("keepEntries", () => {
	test("keeps the entries the test keeps", () => {
		expect(keepEntries({ a: 1, b: 2, c: 3 }, key => key !== "b")).toEqual({ a: 1, c: 3 });
	});

	test("passes each value to the test", () => {
		expect(keepEntries({ a: 1, b: 2, c: 3 }, (_key, value) => value > 1)).toEqual({ b: 2, c: 3 });
	});

	test("returns the same record when every entry is kept", () => {
		const record = { a: 1, b: 2 };
		expect(keepEntries(record, () => true)).toBe(record);
	});

	test("returns an empty record when none is kept, and leaves the one given alone", () => {
		const record = { a: 1 };
		expect(keepEntries(record, () => false)).toEqual({});
		expect(record).toEqual({ a: 1 });
	});
});
