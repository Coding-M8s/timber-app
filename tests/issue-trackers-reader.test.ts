import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIssueTrackerReader, hasGithubRemote } from "../src/bun/issue-trackers";
import type { TimberSettingsReadResult, TimberSettingsRequest, TimberValues } from "../src/shared/timber-config";
import { fingerprint, git, makeRepository } from "./support/timber";

let root: string;

beforeAll(() => {
	root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-trackers-")));
});

afterAll(() => {
	rmSync(root, { recursive: true, force: true });
});

/** A real repository with these remotes, each with its fetch URLs. */
function repositoryWith(name: string, remotes: Record<string, string[]>): string {
	const folder = makeRepository(root, name);
	for (const [remote, [first, ...more]] of Object.entries(remotes)) {
		git(folder, "remote", "add", remote, first!);
		for (const url of more) git(folder, "remote", "set-url", "--add", remote, url);
	}
	return folder;
}

/** A stand-in for Timber's settings read: these effective settings, a Jira site with a saved login, and no Linear login. */
function settingsRead(effective: TimberValues, asked: TimberSettingsRequest[] = []) {
	return async (request: TimberSettingsRequest): Promise<TimberSettingsReadResult> => {
		asked.push(request);
		return {
			outcome: "read",
			command: "timber __app-config read --scope repository",
			settings: {
				scope: "repository", path: `${request.repository}/.timber.toml`, exists: false, tracked: false, revision: null, values: {}, effective,
				credentials: { jira: { configured: true, state: "saved", environmentOverride: false }, linear: { state: "none", environmentOverride: false } },
			},
		};
	};
}

describe("hasGithubRemote in a real repository", () => {
	test("is yes for one github.com URL, and leaves files and refs as they were", async () => {
		const folder = repositoryWith("github", { origin: ["git@github.com:Coding-M8s/timber-app.git"] });
		const before = fingerprint(folder);
		expect(await hasGithubRemote(folder, "origin")).toBe(true);
		expect(fingerprint(folder)).toBe(before);
	});

	test("is no for a remote elsewhere, a missing remote, or two URLs", async () => {
		const folder = repositoryWith("mixed", {
			origin: ["https://gitlab.com/group/project.git"],
			both: ["https://github.com/a/b.git", "https://github.com/a/c.git"],
			upstream: ["https://github.com/a/b.git"],
		});
		const before = fingerprint(folder);
		expect(await hasGithubRemote(folder, "origin")).toBe(false);
		expect(await hasGithubRemote(folder, "both")).toBe(false);
		expect(await hasGithubRemote(folder, "missing")).toBe(false);
		expect(await hasGithubRemote(folder, "upstream")).toBe(true);
		expect(fingerprint(folder)).toBe(before);
	});

	test("never reads a remote name as an option", async () => {
		const folder = repositoryWith("option", { origin: ["https://github.com/a/b.git"] });
		expect(await hasGithubRemote(folder, "--help")).toBe(false);
	});

	test("is no when Git cannot be started", async () => {
		const folder = repositoryWith("no-git", { origin: ["https://github.com/a/b.git"] });
		expect(await hasGithubRemote(folder, "origin", join(root, "no-such-git"))).toBe(false);
	});
});

describe("createIssueTrackerReader", () => {
	test("reads the repository's settings, then the remote Timber uses", async () => {
		const folder = repositoryWith("reader", { origin: ["https://gitlab.com/group/project.git"], upstream: ["https://github.com/a/b.git"] });
		const asked: TimberSettingsRequest[] = [];
		const before = fingerprint(folder);
		const reader = createIssueTrackerReader({ readSettings: settingsRead({ remote: "upstream", default_tracker: "github" }, asked) });
		expect(await reader.read(folder)).toEqual({ ok: true, defaultTracker: "github", available: ["github", "jira"] });
		expect(asked).toEqual([{ scope: "repository", repository: folder }]);
		expect(fingerprint(folder)).toBe(before);
	});

	test("uses origin when Timber names no remote", async () => {
		const folder = repositoryWith("origin-only", { origin: ["https://gitlab.com/group/project.git"], upstream: ["https://github.com/a/b.git"] });
		const reader = createIssueTrackerReader({ readSettings: settingsRead({}) });
		expect(await reader.read(folder)).toEqual({ ok: true, defaultTracker: "jira", available: ["jira"] });
	});

	test("answers Timber's diagnostic when its read failed, and runs no Git", async () => {
		const reader = createIssueTrackerReader({
			readSettings: async () => ({ outcome: "failed", failure: { command: null, diagnostic: "/nowhere is not a repository in this app's list. Nothing was run.", output: null } }),
			git: join(root, "no-such-git"),
		});
		expect(await reader.read("/nowhere")).toEqual({ ok: false, message: "/nowhere is not a repository in this app's list. Nothing was run." });
	});

	test("refuses a request that names no repository, without reading", async () => {
		const asked: TimberSettingsRequest[] = [];
		const reader = createIssueTrackerReader({ readSettings: settingsRead({}, asked) });
		expect(await reader.read("")).toMatchObject({ ok: false });
		expect(await reader.read(42 as unknown as string)).toMatchObject({ ok: false });
		expect(asked).toEqual([]);
	});
});
