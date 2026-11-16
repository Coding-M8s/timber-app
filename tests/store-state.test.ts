import { describe, expect, test } from "bun:test";
import { sampleRepositories } from "../src/mainview/engine/mock";
import { worktreeId } from "../src/shared/model";
import { initialState, keepLastGood, reconcileSelection, selectedWorktree, selectionFor } from "../src/mainview/store/state";

const [timber, apiServer] = sampleRepositories as [typeof sampleRepositories[number], typeof sampleRepositories[number]];
const feature = timber.worktrees[1]!;

describe("reconcileSelection", () => {
	test("starts on the first worktree of the first repository that has one", () => {
		expect(reconcileSelection(sampleRepositories, null)).toEqual({ repository: timber.path, worktree: timber.worktrees[0]!.id });
		const empty = { ...timber, path: "/work/empty", worktrees: [] };
		expect(reconcileSelection([empty, apiServer], null)).toEqual({ repository: apiServer.path, worktree: apiServer.worktrees[0]!.id });
	});

	test("keeps the selected worktree while it exists", () => {
		const selected = { repository: timber.path, worktree: feature.id };
		expect(reconcileSelection(sampleRepositories, selected)).toEqual(selected);
		// Even when the list is reordered or other worktrees come and go.
		const reshuffled = [apiServer, { ...timber, worktrees: [feature, timber.worktrees[0]!] }];
		expect(reconcileSelection(reshuffled, selected)).toEqual(selected);
	});

	test("falls back to the primary checkout of the same repository when the worktree is gone", () => {
		const selected = { repository: apiServer.path, worktree: apiServer.worktrees[1]!.id };
		const without = [timber, { ...apiServer, worktrees: apiServer.worktrees.filter(worktree => worktree.id !== selected.worktree) }];
		expect(reconcileSelection(without, selected)).toEqual({ repository: apiServer.path, worktree: apiServer.worktrees[0]!.id });
	});

	test("falls back to the first worktree in the list when the repository is gone too", () => {
		const selected = { repository: apiServer.path, worktree: apiServer.worktrees[1]!.id };
		expect(reconcileSelection([timber], selected)).toEqual({ repository: timber.path, worktree: timber.worktrees[0]!.id });
	});

	test("selects nothing when there is nothing to select", () => {
		expect(reconcileSelection([], { repository: timber.path, worktree: feature.id })).toBeNull();
		expect(reconcileSelection([], null)).toBeNull();
	});
});

describe("selectionFor and selectedWorktree", () => {
	test("find a worktree in whichever repository has it", () => {
		const selection = selectionFor(sampleRepositories, apiServer.worktrees[1]!.id);
		expect(selection).toEqual({ repository: apiServer.path, worktree: apiServer.worktrees[1]!.id });
		const selected = selectedWorktree({ ...initialState, repositories: sampleRepositories, selection });
		expect(selected?.repository.name).toBe("api-server");
		expect(selected?.worktree.branch).toBe("feat/rate-limit-headers");
	});

	test("answer null for an identity no repository has", () => {
		expect(selectionFor(sampleRepositories, "/nowhere")).toBeNull();
		expect(selectedWorktree({ ...initialState, repositories: sampleRepositories, selection: { repository: timber.path, worktree: "/nowhere" } })).toBeNull();
	});
});

describe("worktree identity", () => {
	test("is the common Git directory plus the canonical path, not the registered path or the branch", () => {
		expect(feature.id).toBe(["/work/timber/.git", "verified", feature.path].join("\0"));
		const viaLink = worktreeId("/work/timber/.git", { path: "/links/feature", canonicalPath: feature.path });
		expect(viaLink).toBe(feature.id);
		expect(worktreeId("/work/other/.git", feature)).not.toBe(feature.id);
	});

	test("a folder Timber could not verify never shares an identity with a verified one", () => {
		const missing = apiServer.worktrees[2]!;
		expect(missing.canonicalPath).toBeNull();
		expect(missing.id).toBe(["/work/api-server/.git", "registered", missing.path].join("\0"));
		expect(missing.id).not.toBe(worktreeId("/work/api-server/.git", { path: "/elsewhere", canonicalPath: missing.path }));
	});

	test("the selection follows a worktree whose branch and registered path changed", () => {
		const selected = { repository: timber.path, worktree: feature.id };
		const renamed = { ...feature, branch: "feat/renamed", path: "/links/feature" };
		expect(reconcileSelection([{ ...timber, worktrees: [timber.worktrees[0]!, renamed] }], selected)).toEqual(selected);
	});
});

describe("keepLastGood", () => {
	const failed = { ...timber, failure: "Not a Git repository: /work/timber", worktrees: [] };

	test("keeps the worktrees listed last beside the diagnostic of a failed read", () => {
		expect(keepLastGood(timber, failed)).toEqual({ ...timber, failure: "Not a Git repository: /work/timber" });
		expect(keepLastGood(timber, failed).worktrees).toBe(timber.worktrees);
	});

	test("shows a failed read as it is when there is no earlier list", () => {
		expect(keepLastGood(undefined, failed)).toBe(failed);
		expect(keepLastGood({ ...failed, failure: "earlier" }, failed)).toBe(failed);
	});

	test("takes a good read as it is, even an empty one", () => {
		const emptied = { ...timber, worktrees: [] };
		expect(keepLastGood(timber, emptied)).toBe(emptied);
		expect(keepLastGood({ ...timber, failure: "earlier" }, timber)).toBe(timber);
	});
});
