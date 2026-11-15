import { describe, expect, test } from "bun:test";
import { sampleRepositories } from "../src/mainview/engine/mock";
import { initialState, reconcileSelection, selectedWorktree, selectionFor } from "../src/mainview/store/state";

const [timber, apiServer] = sampleRepositories as [typeof sampleRepositories[number], typeof sampleRepositories[number]];
const feature = timber.worktrees[1]!;

describe("reconcileSelection", () => {
	test("starts on the first worktree of the first repository that has one", () => {
		expect(reconcileSelection(sampleRepositories, null)).toEqual({ repository: timber.path, worktree: timber.worktrees[0]!.path });
		const empty = { ...timber, path: "/work/empty", worktrees: [] };
		expect(reconcileSelection([empty, apiServer], null)).toEqual({ repository: apiServer.path, worktree: apiServer.worktrees[0]!.path });
	});

	test("keeps the selected worktree while it exists", () => {
		const selected = { repository: timber.path, worktree: feature.path };
		expect(reconcileSelection(sampleRepositories, selected)).toEqual(selected);
		// Even when the list is reordered or other worktrees come and go.
		const reshuffled = [apiServer, { ...timber, worktrees: [feature, timber.worktrees[0]!] }];
		expect(reconcileSelection(reshuffled, selected)).toEqual(selected);
	});

	test("falls back to the primary checkout of the same repository when the worktree is gone", () => {
		const selected = { repository: apiServer.path, worktree: apiServer.worktrees[1]!.path };
		const without = [timber, { ...apiServer, worktrees: apiServer.worktrees.filter(worktree => worktree.path !== selected.worktree) }];
		expect(reconcileSelection(without, selected)).toEqual({ repository: apiServer.path, worktree: apiServer.path });
	});

	test("falls back to the first worktree in the list when the repository is gone too", () => {
		const selected = { repository: apiServer.path, worktree: apiServer.worktrees[1]!.path };
		expect(reconcileSelection([timber], selected)).toEqual({ repository: timber.path, worktree: timber.worktrees[0]!.path });
	});

	test("selects nothing when there is nothing to select", () => {
		expect(reconcileSelection([], { repository: timber.path, worktree: feature.path })).toBeNull();
		expect(reconcileSelection([], null)).toBeNull();
	});
});

describe("selectionFor and selectedWorktree", () => {
	test("find a worktree in whichever repository has it", () => {
		const selection = selectionFor(sampleRepositories, apiServer.worktrees[1]!.path);
		expect(selection).toEqual({ repository: apiServer.path, worktree: apiServer.worktrees[1]!.path });
		const selected = selectedWorktree({ ...initialState, repositories: sampleRepositories, selection });
		expect(selected?.repository.name).toBe("api-server");
		expect(selected?.worktree.branch).toBe("feat/rate-limit-headers");
	});

	test("answer null for a path no repository has", () => {
		expect(selectionFor(sampleRepositories, "/nowhere")).toBeNull();
		expect(selectedWorktree({ ...initialState, repositories: sampleRepositories, selection: { repository: timber.path, worktree: "/nowhere" } })).toBeNull();
	});
});
