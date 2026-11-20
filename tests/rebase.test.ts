import { describe, expect, test } from "bun:test";
import { ontoFromText, rebaseBases } from "../src/shared/rebase-command";

describe("the Onto field", () => {
	test("typed text loses only the spaces around it, and nothing typed means the saved base", () => {
		expect(ontoFromText("  origin/main ")).toBe("origin/main");
		expect(ontoFromText("   ")).toBeNull();
		expect(ontoFromText("")).toBeNull();
		expect(ontoFromText("refs/heads/a b")).toBe("refs/heads/a b");
	});

	test("a local branch is offered by its full ref, because Timber reads a plain name as a remote branch", () => {
		expect(rebaseBases([{ selector: "main", kind: "local" }, { selector: "origin/main", kind: "remote" }])).toEqual([
			{ selector: "refs/heads/main", kind: "local" },
			{ selector: "origin/main", kind: "remote" },
		]);
	});
});
