import { describe, expect, test } from "bun:test";
import { createChangeFeed } from "../src/bun/changes";

describe("createChangeFeed", () => {
	test("passes each announced path to every listener until it stops listening", () => {
		const feed = createChangeFeed();
		const first: string[] = [];
		const second: string[] = [];
		const stopFirst = feed.subscribe(path => first.push(path));
		feed.subscribe(path => second.push(path));

		feed.announce("/work/a");
		stopFirst();
		feed.announce("/work/b");
		expect(first).toEqual(["/work/a"]);
		expect(second).toEqual(["/work/a", "/work/b"]);
	});

	test("accepts an announcement nobody listens to", () => {
		expect(() => createChangeFeed().announce("/work/a")).not.toThrow();
	});
});
