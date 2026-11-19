import { describe, expect, test } from "bun:test";
import { TIMBER_INSTALL_COMMAND, TIMBER_LIST_FAILURE_TITLE, describeChanges, describeListNotice, describeReloadError, describeRow, describeRowMarkers, describeSync, describeTimberProblem, describeWorktreeKind, describeWorktreeSync, worktreeLabel } from "../src/mainview/format";
import { browserSampleRepositories, createMockEngine, sampleRepositories, sampleTimberStatuses } from "../src/mainview/engine/mock";
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
	base: null,
	issue: null,
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

	test("says how a worktree's branch stands, and that it is unknown when Git could not say", () => {
		expect(describeWorktreeSync(base)).toBe("Not published yet");
		expect(describeWorktreeSync({ ...linked, sync: null })).toBe("Sync unknown");
		expect(describeWorktreeSync({ ...linked, branch: null, detached: true, sync: null })).toBeNull();
	});

	test("says which kind of checkout a worktree is", () => {
		expect(describeWorktreeKind(base)).toBe("Primary checkout");
		expect(describeWorktreeKind(linked)).toBe("Worktree");
		expect(describeWorktreeKind({ ...missing, primary: true })).toBe("Primary checkout");
	});

	test("names the command that failed", () => {
		expect(TIMBER_LIST_FAILURE_TITLE).toBe("timber ls --json failed");
	});
});

describe("describeRowMarkers", () => {
	const tracking = (ahead: number, behind: number): Worktree => ({ ...linked, sync: { kind: "tracking", upstream: "origin/main", ahead, behind } });
	const level = tracking(0, 0);
	/** Each marker as "kind|place|text", which is everything but the tooltip. */
	const shown = (worktree: Worktree) => describeRowMarkers(worktree).map(marker => `${marker.kind}|${marker.place}|${marker.text}`);
	const tooltips = (worktree: Worktree) => describeRowMarkers(worktree).map(marker => marker.tooltip);

	test("a clean worktree that is level with its upstream has no markers", () => {
		expect(describeRowMarkers(level)).toEqual([]);
		expect(describeRowMarkers({ ...level, primary: true })).toEqual([]);
	});

	test("commits to push", () => {
		expect(describeRowMarkers(tracking(2, 0))).toEqual([
			{ kind: "ahead", place: "branch", text: "2", tooltip: "2 commits to push to origin/main, as of the last fetch." },
		]);
		expect(tooltips(tracking(1, 0))).toEqual(["1 commit to push to origin/main, as of the last fetch."]);
	});

	test("commits to pull", () => {
		expect(describeRowMarkers(tracking(0, 3))).toEqual([
			{ kind: "behind", place: "branch", text: "3", tooltip: "3 commits to pull from origin/main, as of the last fetch." },
		]);
		expect(tooltips(tracking(0, 1))).toEqual(["1 commit to pull from origin/main, as of the last fetch."]);
	});

	test("both, with the commits to pull first", () => {
		expect(shown(tracking(12, 1))).toEqual(["behind|branch|1", "ahead|branch|12"]);
	});

	test("local only, for a branch with no upstream", () => {
		expect(describeRowMarkers({ ...linked, sync: { kind: "unpublished" } })).toEqual([
			{ kind: "local-only", place: "branch", text: "local only", tooltip: "This branch has no upstream. It has not been published." },
		]);
	});

	test("upstream gone, for a branch whose upstream was deleted", () => {
		expect(describeRowMarkers({ ...linked, sync: { kind: "gone", upstream: "origin/feat/x" } })).toEqual([
			{ kind: "upstream-gone", place: "branch", text: "upstream gone", tooltip: "The upstream branch origin/feat/x no longer exists, as of the last fetch." },
		]);
	});

	test("sync unknown, for a branch Git could not answer about, so it is not taken for up to date", () => {
		expect(describeRowMarkers({ ...level, sync: null })).toEqual([{
			kind: "sync-unknown",
			place: "branch",
			text: "sync unknown",
			tooltip: "Git could not say how this branch stands against its upstream. It may have commits to push or to pull.",
		}]);
	});

	test("detached HEAD, which has no upstream state to show or to miss", () => {
		expect(describeRowMarkers({ ...level, branch: null, detached: true, sync: null })).toEqual([
			{ kind: "detached", place: "state", text: "detached HEAD", tooltip: "No branch is checked out here. The folder is at commit 1234567." },
		]);
		expect(tooltips({ ...level, branch: null, detached: true, head: null, sync: null })).toEqual(["No branch is checked out here."]);
	});

	test("locked", () => {
		expect(describeRowMarkers({ ...level, locked: true })).toEqual([
			{ kind: "locked", place: "state", text: "locked", tooltip: "Locked: Git will not prune, move, or remove this worktree until it is unlocked." },
		]);
	});

	test("prunable, for a worktree whose folder is still there", () => {
		expect(describeRowMarkers({ ...level, prunable: true })).toEqual([{
			kind: "prunable",
			place: "state",
			text: "prunable",
			tooltip: "Prunable: Git considers the record of this worktree stale, and git worktree prune would remove the record.",
		}]);
	});

	test("folder missing, which says prunable by itself and never shows as clean", () => {
		expect(describeRowMarkers({ ...missing, sync: level.sync })).toEqual([
			{ kind: "folder-missing", place: "state", text: "folder missing", tooltip: "The folder is missing: /work/app. Its status is unknown." },
		]);
		expect(shown({ ...missing, sync: level.sync, locked: true })).toEqual(["folder-missing|state|folder missing", "locked|state|locked"]);
	});

	test("status unknown, with Timber's reason, and never as clean", () => {
		expect(describeRowMarkers({ ...unread, sync: level.sync })).toEqual([{
			kind: "status-unknown",
			place: "state",
			text: "status unknown",
			tooltip: "Timber could not read this worktree, so it may hold changes. Timber says: Cannot inspect worktree; check directory access.",
		}]);
		expect(shown({ ...unread, sync: level.sync, prunable: true })).toEqual(["status-unknown|state|status unknown", "prunable|state|prunable"]);
		// A reason that already ends a sentence is not given a second full stop.
		expect(tooltips({ ...unread, sync: level.sync, changes: { kind: "unknown", reason: "Disk not ready. " } }))
			.toEqual(["Timber could not read this worktree, so it may hold changes. Timber says: Disk not ready."]);
	});

	test("counts of modified and untracked files", () => {
		expect(describeRowMarkers({ ...level, changes: { kind: "known", modified: ["a.ts", "b.ts", "c d.ts"], untracked: ["new.ts"] } })).toEqual([
			{ kind: "modified", place: "changes", text: "3M", tooltip: "3 files with uncommitted changes: modified, added, deleted, or renamed." },
			{ kind: "untracked", place: "changes", text: "1U", tooltip: "1 untracked file: new, and not added to Git." },
		]);
		expect(describeRowMarkers({ ...level, changes: { kind: "known", modified: ["a.ts"], untracked: [] } })).toEqual([
			{ kind: "modified", place: "changes", text: "1M", tooltip: "1 file with uncommitted changes: modified, added, deleted, or renamed." },
		]);
		expect(describeRowMarkers({ ...level, changes: { kind: "known", modified: [], untracked: ["a", "b"] } })).toEqual([
			{ kind: "untracked", place: "changes", text: "2U", tooltip: "2 untracked files: new, and not added to Git." },
		]);
	});

	test("everything at once, in the order the row shows it", () => {
		const busy: Worktree = { ...tracking(1, 14), locked: true, prunable: true, changes: { kind: "known", modified: ["a"], untracked: ["b"] } };
		expect(shown(busy)).toEqual(["behind|branch|14", "ahead|branch|1", "locked|state|locked", "prunable|state|prunable", "modified|changes|1M", "untracked|changes|1U"]);
		expect(shown({ ...unread, sync: null, locked: true })).toEqual(["sync-unknown|branch|sync unknown", "status-unknown|state|status unknown", "locked|state|locked"]);
	});

	test("every marker has a short text and a whole sentence, and the row's description is all the sentences", () => {
		const all = browserSampleRepositories.flatMap(repository => repository.worktrees).flatMap(worktree => describeRowMarkers(worktree));
		expect(all.length).toBeGreaterThan(0);
		for (const marker of all) {
			expect(marker.text).not.toBe("");
			expect(marker.tooltip).toMatch(/^[A-Z0-9].*\.$/);
		}
		const markers = describeRowMarkers({ ...tracking(2, 0), changes: { kind: "known", modified: ["a"], untracked: [] } });
		expect(describeRow(markers)).toBe("2 commits to push to origin/main, as of the last fetch. 1 file with uncommitted changes: modified, added, deleted, or renamed.");
		expect(describeRow([])).toBe("");
	});
});

describe("sample data", () => {
	test("the browser build shows every marker a row can have, and a row with none", () => {
		const worktrees = browserSampleRepositories.flatMap(repository => repository.worktrees);
		const kinds = new Set(worktrees.flatMap(worktree => describeRowMarkers(worktree)).map(marker => marker.kind));
		expect([...kinds].sort()).toEqual([
			"ahead", "base-unknown", "behind", "detached", "folder-missing", "local-only", "locked", "modified", "prunable", "status-unknown", "sync-unknown", "untracked", "upstream-gone",
		]);
		expect(worktrees.some(worktree => describeRowMarkers(worktree).length === 0)).toBe(true);
		expect(new Set(worktrees.map(worktree => worktree.id)).size).toBe(worktrees.length);
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

	test("says Timber is not installed and that the newest release is needed", () => {
		const problem = describeTimberProblem({ state: "not-found", override: null })!;
		expect(problem.title).toBe("Timber is not installed");
		expect(problem.text).toBe("Timber app needs the timber command, the newest release, on your PATH.");
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
		expect(describeListNotice({ kind: "failed", action: "reorder", message: "disk full" }, []))
			.toEqual({ title: "Could not save the order of the repositories", text: "disk full", problem: true });
	});
});

describe("the marker for a saved base Timber cannot use", () => {
	const kinds = (worktree: Worktree) => describeRowMarkers(worktree).map(marker => marker.kind);

	test("invalid metadata is marked, with the reason in its sentence", () => {
		const marker = describeRowMarkers({ ...linked, base: { kind: "invalid", reason: "malformed" } }).find(candidate => candidate.kind === "base-unknown")!;
		expect(marker).toMatchObject({ place: "state", text: "base unknown" });
		expect(marker.tooltip).toContain("it is not in the form Timber expects");
		expect(kinds({ ...linked, base: { kind: "invalid", reason: "stale" } })).toContain("base-unknown");
		expect(kinds({ ...linked, base: { kind: "invalid", reason: "unreadable" } })).toContain("base-unknown");
	});

	test("a saved base, no saved base, and a Timber that reports none are not marked", () => {
		expect(kinds({ ...linked, base: { kind: "assigned", ref: "refs/remotes/origin/main" } })).not.toContain("base-unknown");
		expect(kinds({ ...linked, base: { kind: "unassigned" } })).not.toContain("base-unknown");
		expect(kinds({ ...linked, base: null })).not.toContain("base-unknown");
	});

	test("a worktree Timber could not verify is marked for that once, not again for the stale base that follows from it", () => {
		expect(kinds({ ...missing, base: { kind: "invalid", reason: "stale" } })).toEqual(["local-only", "folder-missing"]);
		expect(kinds({ ...unread, base: { kind: "invalid", reason: "stale" } })).toEqual(["local-only", "status-unknown"]);
		// Metadata that is itself broken is still said.
		expect(kinds({ ...unread, base: { kind: "invalid", reason: "malformed" } })).toContain("base-unknown");
	});
});
