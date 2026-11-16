import { describe, expect, test } from "bun:test";
import { parseBranchSync } from "../src/shared/git-parse";

const line = (ref: string, upstream = "", track = "") => `${[ref, upstream, track].join("\0")}\n`;

describe("parseBranchSync", () => {
	test("reads ahead, behind, both, and level against a live upstream", () => {
		const output = [
			line("refs/heads/ahead", "origin/ahead", "ahead 2"),
			line("refs/heads/behind", "origin/behind", "behind 3"),
			line("refs/heads/both", "origin/both", "ahead 12, behind 1"),
			line("refs/heads/level", "origin/level"),
		].join("");
		expect([...parseBranchSync(output)]).toEqual([
			["ahead", { kind: "tracking", upstream: "origin/ahead", ahead: 2, behind: 0 }],
			["behind", { kind: "tracking", upstream: "origin/behind", ahead: 0, behind: 3 }],
			["both", { kind: "tracking", upstream: "origin/both", ahead: 12, behind: 1 }],
			["level", { kind: "tracking", upstream: "origin/level", ahead: 0, behind: 0 }],
		]);
	});

	test("reports a branch without an upstream as unpublished", () => {
		expect(parseBranchSync(line("refs/heads/spike")).get("spike")).toEqual({ kind: "unpublished" });
	});

	test("reports a configured upstream whose ref is missing as gone", () => {
		expect(parseBranchSync(line("refs/heads/done", "origin/done", "gone")).get("done")).toEqual({ kind: "gone", upstream: "origin/done" });
	});

	test("keeps slashes, spaces in upstream names, and non-ASCII characters in branch names", () => {
		const branches = parseBranchSync(line("refs/heads/feat/zażółć", "my remote/feat/zażółć", "ahead 1"));
		expect(branches.get("feat/zażółć")).toEqual({ kind: "tracking", upstream: "my remote/feat/zażółć", ahead: 1, behind: 0 });
	});

	test("leaves out lines it cannot read, and returns nothing for empty output", () => {
		const output = [
			line("refs/heads/odd", "origin/odd", "somewhere else"),
			line("refs/tags/v1"),
			"refs/heads/short\n",
			line("refs/heads/fine"),
		].join("");
		expect([...parseBranchSync(output).keys()]).toEqual(["fine"]);
		expect(parseBranchSync("").size).toBe(0);
	});
});
