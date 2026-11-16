import { describe, expect, test } from "bun:test";
import { parseBranchList, parseBranchSync } from "../src/shared/git-parse";

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

/** One line of the branch list: a ref and, for a symbolic ref, what it points to. */
const listed = (ref: string, symref = "") => `${[ref, symref].join("\0")}\n`;

describe("parseBranchList", () => {
	test("lists local branches by name, then remote-tracking branches as remote/branch", () => {
		const output = [
			listed("refs/heads/feat/login"),
			listed("refs/heads/main"),
			listed("refs/remotes/fork/main"),
			listed("refs/remotes/origin/feat/login"),
			listed("refs/remotes/origin/main"),
		].join("");
		expect(parseBranchList(output)).toEqual([
			{ selector: "feat/login", kind: "local" },
			{ selector: "main", kind: "local" },
			{ selector: "fork/main", kind: "remote" },
			{ selector: "origin/feat/login", kind: "remote" },
			{ selector: "origin/main", kind: "remote" },
		]);
	});

	test("local branches come first whatever order Git answered in", () => {
		const output = [listed("refs/remotes/origin/a"), listed("refs/heads/b")].join("");
		expect(parseBranchList(output).map(branch => branch.selector)).toEqual(["b", "origin/a"]);
	});

	test("leaves out a symbolic ref such as origin/HEAD, which points to a branch and is not one", () => {
		const output = [listed("refs/remotes/origin/HEAD", "refs/remotes/origin/main"), listed("refs/remotes/origin/main")].join("");
		expect(parseBranchList(output)).toEqual([{ selector: "origin/main", kind: "remote" }]);
	});

	test("leaves out nothing else: a branch that is both local and remote is listed twice, under both names", () => {
		const output = [listed("refs/heads/feat/x"), listed("refs/remotes/origin/feat/x")].join("");
		expect(parseBranchList(output).map(branch => branch.selector)).toEqual(["feat/x", "origin/feat/x"]);
	});

	test("keeps non-ASCII characters and a leading dash exactly", () => {
		const output = [listed("refs/heads/feat/zażółć"), listed("refs/remotes/fork/-odd")].join("");
		expect(parseBranchList(output)).toEqual([
			{ selector: "feat/zażółć", kind: "local" },
			{ selector: "fork/-odd", kind: "remote" },
		]);
	});

	test("skips lines it cannot read and other kinds of refs, and returns nothing for empty output", () => {
		const output = [
			"refs/heads/short\n",
			listed("refs/tags/v1"),
			listed("refs/heads/"),
			`${["refs/heads/long", "", "more"].join("\0")}\n`,
			listed("refs/heads/fine"),
		].join("");
		expect(parseBranchList(output)).toEqual([{ selector: "fine", kind: "local" }]);
		expect(parseBranchList("")).toEqual([]);
	});
});
