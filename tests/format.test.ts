import { describe, expect, test } from "bun:test";
import { TIMBER_INSTALL_COMMAND, TIMBER_LIST_FAILURE_TITLE, describeChanges, describeListNotice, describeReloadError, describeSync, describeTimberProblem, describeWorktreeDetail, describeWorktreeState, worktreeLabel } from "../src/mainview/format";
import { createMockEngine, sampleRepositories, sampleTimberStatuses } from "../src/mainview/engine/mock";
import type { Worktree } from "../src/shared/model";

const base: Worktree = {
	id: "/work/app/.git\0verified\0/work/app",
	path: "/work/app",
	canonicalPath: "/work/app",
	branch: "main",
	head: "1234567890abcdef1234567890abcdef12345678",
	primary: true,
	detached: false,
	locked: false,
	prunable: false,
	pathExists: true,
	changes: { kind: "known", modified: [], untracked: [] },
	sync: { kind: "unpublished" },
};
const linked: Worktree = { ...base, primary: false };
const missing: Worktree = { ...linked, pathExists: false, prunable: true, canonicalPath: null, changes: { kind: "unknown", reason: "Worktree path is missing" } };
const unread: Worktree = { ...linked, canonicalPath: null, changes: { kind: "unknown", reason: "Cannot inspect worktree; check directory access" } };

describe("describeSync", () => {
	test("covers every state a branch can be in", () => {
		expect(describeSync({ kind: "unpublished" })).toBe("Not published yet");
		expect(describeSync({ kind: "gone", upstream: "origin/x" })).toBe("Upstream origin/x was deleted");
		expect(describeSync({ kind: "tracking", upstream: "origin/x", ahead: 0, behind: 0 })).toBe("In sync with origin/x");
		expect(describeSync({ kind: "tracking", upstream: "origin/x", ahead: 2, behind: 0 })).toBe("2 to push to origin/x");
		expect(describeSync({ kind: "tracking", upstream: "origin/x", ahead: 0, behind: 3 })).toBe("3 to pull from origin/x");
		expect(describeSync({ kind: "tracking", upstream: "origin/x", ahead: 2, behind: 3 })).toBe("2 ahead, 3 behind origin/x");
	});
});

describe("worktree text", () => {
	test("labels a branch by name and a detached HEAD by short commit", () => {
		expect(worktreeLabel(base)).toBe("main");
		expect(worktreeLabel({ ...base, branch: null })).toBe("detached at 1234567");
		expect(worktreeLabel({ ...base, branch: null, head: null })).toBe("detached");
	});

	test("describes changes, and says why when Timber could not read the folder", () => {
		expect(describeChanges(base)).toBe("Clean");
		expect(describeChanges({ ...base, changes: { kind: "known", modified: ["a.ts", "b.ts", "c d.ts"], untracked: ["new.ts"] } })).toBe("3 modified, 1 untracked");
		expect(describeChanges(missing)).toBe("Status unknown: Worktree path is missing");
	});

	test("marks a missing folder, an unknown status, a locked and a prunable worktree", () => {
		expect(describeWorktreeState(base)).toBe("Primary checkout");
		expect(describeWorktreeState(linked)).toBe("Worktree");
		expect(describeWorktreeState({ ...linked, branch: null, detached: true })).toBe("Worktree");
		expect(describeWorktreeState(missing)).toBe("Folder missing");
		expect(describeWorktreeState(unread)).toBe("Status unknown");
		expect(describeWorktreeState({ ...unread, primary: true })).toBe("Status unknown");
		expect(describeWorktreeState({ ...linked, locked: true })).toBe("Locked");
		expect(describeWorktreeState({ ...missing, locked: true })).toBe("Folder missing, locked");
		expect(describeWorktreeState({ ...unread, prunable: true })).toBe("Status unknown, prunable");
	});

	test("explains a worktree in more detail for a tooltip", () => {
		expect(describeWorktreeDetail(base)).toBe("Not published yet");
		expect(describeWorktreeDetail({ ...base, sync: null })).toBe("/work/app");
		expect(describeWorktreeDetail(missing)).toBe("Worktree path is missing: /work/app");
	});

	test("names the command that failed", () => {
		expect(TIMBER_LIST_FAILURE_TITLE).toBe("timber ls --json failed");
	});
});

describe("mock engine", () => {
	test("returns a copy, so the interface cannot change the sample data", async () => {
		const first = await createMockEngine().listRepositories();
		first[0]!.worktrees.length = 0;
		expect((await createMockEngine().listRepositories())[0]!.worktrees.length).toBe(sampleRepositories[0]!.worktrees.length);
	});
});

describe("describeTimberProblem", () => {
	test("has nothing to say when Timber is ready", () => {
		expect(describeTimberProblem(sampleTimberStatuses.ready)).toBeNull();
	});

	test("says Timber is not installed and which version is needed", () => {
		const problem = describeTimberProblem({ state: "not-found", override: null })!;
		expect(problem.title).toBe("Timber is not installed");
		expect(problem.text).toContain("0.1.1 or newer");
		expect(problem.action).toBe("Install it with:");
	});

	test("names the override when it is the one that failed", () => {
		const problem = describeTimberProblem({ state: "not-found", override: "/opt/dev/timber" })!;
		expect(problem.text).toContain("TIMBER_APP_TIMBER_PATH points to /opt/dev/timber");
	});

	test("names the found and required versions for an old Timber", () => {
		const problem = describeTimberProblem({ state: "too-old", path: "/usr/bin/timber", found: "0.1.0", required: "0.1.1" })!;
		expect(problem.title).toBe("Timber is too old");
		expect(problem.text).toBe("Found Timber 0.1.0 at /usr/bin/timber. Timber app needs 0.1.1 or newer.");
		expect(problem.action).toBe("Update it with:");
	});

	test("the install command is Timber's own installer", () => {
		expect(TIMBER_INSTALL_COMMAND).toStartWith("curl -fsSL https://github.com/Coding-M8s/timber/releases/");
	});
});

describe("mock engine and Timber", () => {
	test("is ready by default and can stand in for every state", async () => {
		expect((await createMockEngine().timberStatus()).state).toBe("ready");
		for (const status of Object.values(sampleTimberStatuses)) {
			const engine = createMockEngine(sampleRepositories, status);
			expect(await engine.timberStatus()).toEqual(status);
			expect(await engine.recheckTimber()).toEqual(status);
		}
	});

	test("can act out an install between the first look and Retry", async () => {
		let installed = false;
		const engine = createMockEngine(sampleRepositories, () => installed ? sampleTimberStatuses.ready : sampleTimberStatuses["not-found"]);
		expect((await engine.timberStatus()).state).toBe("not-found");
		installed = true;
		expect((await engine.recheckTimber()).state).toBe("ready");
	});
});

describe("describeReloadError", () => {
	test("names the repository when one was being reloaded", () => {
		expect(describeReloadError({ repository: "/work/timber", message: "Git is busy" }, sampleRepositories))
			.toEqual({ title: "Could not refresh timber", text: "Git is busy" });
	});

	test("stays general for a reload of everything or an unknown repository", () => {
		expect(describeReloadError({ repository: null, message: "Git is busy" }, sampleRepositories).title).toBe("Could not refresh");
		expect(describeReloadError({ repository: "/work/gone", message: "Git is busy" }, sampleRepositories).title).toBe("Could not refresh");
	});
});

describe("describeListNotice", () => {
	test("names the listed repository, falling back to its folder name", () => {
		expect(describeListNotice({ kind: "already-listed", repository: "/work/timber" }, sampleRepositories))
			.toEqual({ title: "timber is already in the list", text: "That folder belongs to it, so nothing was added.", problem: false });
		expect(describeListNotice({ kind: "already-listed", repository: "C:\\work\\other\\" }, sampleRepositories).title)
			.toBe("other is already in the list");
	});

	test("says which folder is not a Git repository and what to pick instead", () => {
		expect(describeListNotice({ kind: "not-a-repository", folder: "/home/sam/Documents" }, [])).toEqual({
			title: "Not a Git repository",
			text: "/home/sam/Documents is not inside a Git repository. Pick a repository folder or one of its worktrees.",
			problem: true,
		});
	});

	test("explains the override and passes a failure on", () => {
		expect(describeListNotice({ kind: "overridden" }, []).title).toBe("The list comes from TIMBER_APP_REPOS");
		expect(describeListNotice({ kind: "failed", action: "add", message: "disk full" }, []))
			.toEqual({ title: "Could not add the repository", text: "disk full", problem: true });
		expect(describeListNotice({ kind: "failed", action: "remove", message: "disk full" }, []).title)
			.toBe("Could not remove the repository");
	});
});
