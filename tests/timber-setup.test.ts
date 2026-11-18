import { describe, expect, test } from "bun:test";
import type { Repository } from "../src/shared/model";
import { showsSetupPrompt } from "../src/shared/timber-setup";

const repository = (overrides: Partial<Repository> = {}): Repository => ({
	path: "/work/docs-site", name: "docs-site", available: true, failure: null, setup: "none", worktrees: [], ...overrides,
});

describe("the setup prompt", () => {
	test("shows for a repository that was never set up", () => {
		expect(showsSetupPrompt(repository(), [])).toBe(true);
	});

	test("does not show once the repository or the machine has settings, or when that is not known", () => {
		for (const setup of ["repository", "machine", "unknown"] as const) expect(showsSetupPrompt(repository({ setup }), [])).toBe(false);
	});

	test("does not show for a repository that is unavailable or that Timber could not list", () => {
		expect(showsSetupPrompt(repository({ available: false }), [])).toBe(false);
		expect(showsSetupPrompt(repository({ failure: "Invalid TOML in /work/docs-site/.timber.toml" }), [])).toBe(false);
	});

	test("does not show once dismissed for that repository, and still shows for another", () => {
		expect(showsSetupPrompt(repository(), ["/work/docs-site"])).toBe(false);
		expect(showsSetupPrompt(repository(), ["/work/timber"])).toBe(true);
	});
});
