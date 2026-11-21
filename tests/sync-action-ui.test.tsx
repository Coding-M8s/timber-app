import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SyncActionDialogView, type SyncActionDialogViewProps } from "../src/mainview/components/SyncActionDialog";
import { WorktreeRow } from "../src/mainview/components/WorktreeRow";
import { createMockEngine, sampleRepositories, sampleTimberStatuses } from "../src/mainview/engine/mock";
import type { SyncEnding } from "../src/mainview/engine/mock-sync";
import { createAppStore } from "../src/mainview/store/store";
import { describeSyncCommands, describeSyncControls, describeSyncRefusalNote, presentSyncResult } from "../src/mainview/sync-action-format";
import { worktreeMenuChoice, worktreeMenuItems } from "../src/mainview/worktree-menu-format";
import { BEING_REMOVED_REASON } from "../src/mainview/done-format";
import type { SyncState, Worktree } from "../src/shared/model";
import type { SyncActionResult } from "../src/shared/sync-actions";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};

const target = { remote: "origin", upstreamRef: "refs/remotes/origin/feat/x" };
const tracking = (ahead: number, behind: number, extra: Partial<Extract<SyncState, { kind: "tracking" }>> = {}): SyncState =>
	({ kind: "tracking", upstream: "origin/feat/x", ahead, behind, ...target, ...extra });

const behind: Worktree = {
	id: "/work/app/.git\0verified\0/work/app-worktrees/feat-x",
	path: "/work/app-worktrees/feat-x",
	canonicalPath: "/work/app-worktrees/feat-x",
	branch: "feat/x",
	head: "1234567890abcdef1234567890abcdef12345678",
	primary: false,
	detached: false,
	locked: false,
	prunable: false,
	pathExists: true,
	changes: { kind: "known", modified: [], untracked: [] },
	base: null,
	issue: null,
	sync: tracking(0, 3),
};

const renderRow = (worktree: Worktree, withAction = true, removing = false) => renderToStaticMarkup(
	<WorktreeRow
		worktree={worktree}
		selected={false}
		onSelect={() => {}}
		removal={removing ? { kind: "running" } as never : null}
		{...(withAction ? { onSyncAction: () => {} } : {})}
	/>,
);

describe("the Pull control on a row", () => {
	test("a branch that is behind and not ahead gets a Pull control with its count, beside the row's button, not inside it", () => {
		const markup = renderRow(behind);
		const control = /<span class="row-sync"><button type="button" class="sync behind row-sync-button" aria-haspopup="dialog" aria-label="([^"]+)" title="([^"]+)">(.*?)<\/button><\/span>/.exec(markup);
		expect(control).not.toBeNull();
		expect(control![1]).toBe("Pull 3 commits into feat/x from origin/feat/x");
		expect(control![3]!.replace(/<svg.*?<\/svg>/, "")).toBe("3");
		// The row's own button ends before the control starts: a button is never inside another.
		const rowButton = markup.indexOf("<button type=\"button\" class=\"row\"");
		const rowEnd = markup.indexOf("</button>", rowButton);
		expect(markup.indexOf("row-sync")).toBeGreaterThan(rowEnd);
		// The count is drawn once: the marker it replaces is not drawn inside the row, and its sentence stays in the description.
		expect(markup.match(/class="sync behind/g)?.length).toBe(1);
		expect(markup).toContain("3 commits to pull from origin/feat/x, as of the last fetch.");
		expect(markup).toContain("row-item with-sync");
	});

	test("without a way to act, the behind count stays a marker", () => {
		const markup = renderRow(behind, false);
		expect(markup).not.toContain("row-sync");
		expect(markup).toContain("<span class=\"sync behind\"");
	});

	test("is not offered for a diverged, ahead, level, force-pushed, gone, unpublished, or detached branch, nor while Timber removes the worktree", () => {
		const cases: Worktree[] = [
			{ ...behind, sync: tracking(1, 3) },
			{ ...behind, sync: tracking(2, 0) },
			{ ...behind, sync: tracking(0, 0) },
			{ ...behind, sync: tracking(0, 3, { forcePushed: { at: 5 } }) },
			{ ...behind, sync: { kind: "gone", upstream: "origin/feat/x" } },
			{ ...behind, sync: { kind: "unpublished" } },
			{ ...behind, branch: null, detached: true, sync: null },
		];
		for (const worktree of cases) {
			expect(describeSyncControls(worktree)).toEqual([]);
			expect(renderRow(worktree)).not.toContain("row-sync");
		}
		expect(renderRow(behind, true, true)).not.toContain("row-sync");
	});
});

describe("Pull in the worktree menu", () => {
	test("comes before Done while it applies, and opens the dialog for the row's worktree", () => {
		expect(worktreeMenuItems(behind).map(item => item.id)).toEqual(["sync:pull", "done"]);
		expect(worktreeMenuItems(behind)[0]).toMatchObject({ label: "Pull", disabled: false, note: null });
		expect(worktreeMenuChoice("/work/app", behind, "sync:pull")).toEqual({ kind: "sync-action", action: "pull", repository: "/work/app", worktree: behind.id });
	});

	test("is not listed when it does not apply, and is off while Timber removes the worktree", () => {
		const diverged = { ...behind, sync: tracking(1, 3) };
		expect(worktreeMenuItems(diverged).map(item => item.id)).toEqual(["done"]);
		expect(worktreeMenuChoice("/work/app", diverged, "sync:pull")).toBeNull();
		expect(worktreeMenuItems(behind, true)[0]).toMatchObject({ id: "sync:pull", disabled: true, note: BEING_REMOVED_REASON });
		expect(worktreeMenuChoice("/work/app", behind, "sync:pull", true)).toBeNull();
	});
});

describe("the Pull dialog", () => {
	const view = (props: Partial<SyncActionDialogViewProps> = {}) => renderToStaticMarkup(
		<SyncActionDialogView action="pull" worktree={behind} path={behind.path} result={null} submission={{ running: false, failure: null }} onSubmit={() => {}} onClose={() => {}} {...props} />,
	);

	test("shows both commands before they run, and says the second runs even when the fetch fails", () => {
		expect(describeSyncCommands("pull", target)).toEqual({
			command: "git fetch origin",
			followUps: [{ note: "Then, even when the fetch fails, on the commits fetched last:", command: "git merge --ff-only --no-autostash refs/remotes/origin/feat/x" }],
		});
		const markup = view();
		expect(markup).toContain("Pull feat/x");
		expect(markup).toContain("<pre class=\"dialog-command\" aria-label=\"Command that will run\">git fetch origin</pre>");
		expect(markup).toContain("git merge --ff-only --no-autostash refs/remotes/origin/feat/x");
		expect(markup).toContain(`Both commands run in ${behind.path}.`);
		expect(markup).toContain("never makes a merge commit");
	});

	test("a diverged branch's refusal shows Git's words and points to Rebase", () => {
		const refused: SyncActionResult = {
			outcome: "refused", action: "pull", reason: "diverged", fetchFailure: null,
			failure: { command: "git merge --ff-only --no-autostash refs/remotes/origin/feat/x", diagnostic: "fatal: Not possible to fast-forward, aborting.", output: null },
		};
		const markup = view({ result: refused, submission: { running: false, failure: refused.failure } });
		expect(markup).toContain("fatal: Not possible to fast-forward, aborting.");
		expect(markup).toContain("Rebase it onto its upstream");
		expect(describeSyncRefusalNote({ ...refused, reason: "local-changes" })).toContain("your files are as they were");
	});

	test("a worktree that left the list, or lost its upstream, runs nothing", () => {
		expect(view({ worktree: null })).toContain("Nothing was run.");
		expect(view({ worktree: { ...behind, sync: { kind: "unpublished" } } })).toContain("Nothing to run");
	});

	test("a pull that worked closes with a toast, which says when the fetch failed and is then marked as a problem", () => {
		expect(presentSyncResult("pull", "feat/x", "origin/feat/x", { outcome: "done", action: "pull", moved: true, fetchFailure: null }))
			.toEqual({ ok: true, toast: "Pulled origin/feat/x into feat/x.", problem: false });
		const offline = presentSyncResult("pull", "feat/x", "origin/feat/x", { outcome: "done", action: "pull", moved: true, fetchFailure: { kind: "offline", message: "Could not resolve host: example.com", at: 1 } });
		expect(offline).toMatchObject({ ok: true, problem: true });
		if (!offline.ok) throw new Error("unreachable");
		expect(offline.toast).toContain("The fetch failed, so these are the commits fetched last. Git said: Could not resolve host: example.com");
	});
});

describe("a pull through the store and the mock engine", () => {
	const TIMBER = "/work/timber";
	const main = sampleRepositories[0]!.worktrees.find(worktree => worktree.primary)!;

	async function started(ending: SyncEnding = "pulled") {
		const engine = createMockEngine(structuredClone(sampleRepositories), sampleTimberStatuses.ready);
		engine.endSyncActions(ending);
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		return { store, engine };
	}
	const listed = (store: Awaited<ReturnType<typeof started>>["store"]) => store.getState().repositories[0]!.worktrees.find(worktree => worktree.id === main.id)!;

	test("the sample's main branch is behind, so it offers Pull", () => {
		expect(main.sync).toMatchObject({ kind: "tracking", behind: 2, ahead: 0, remote: "origin", upstreamRef: "refs/remotes/origin/main" });
		expect(describeSyncControls(main).map(control => control.action)).toEqual(["pull"]);
	});

	test("the row's counts follow a pull without a manual refresh", async () => {
		const { store, engine } = await started();
		const request = { action: "pull" as const, repository: TIMBER, worktree: main.path, target: { remote: "origin", upstreamRef: "refs/remotes/origin/main" } };
		expect(await store.runSyncAction(request)).toEqual({ outcome: "done", action: "pull", moved: true, fetchFailure: null });
		expect(listed(store).sync).toMatchObject({ behind: 0, ahead: 0 });
		expect(describeSyncControls(listed(store))).toEqual([]);
		expect(engine.syncActionRequests()).toEqual([request]);
	});

	test("each ending the mock acts out", async () => {
		const request = { action: "pull" as const, repository: TIMBER, worktree: main.path, target: { remote: "origin", upstreamRef: "refs/remotes/origin/main" } };
		const fetchFailed = await started("fetch-failed");
		expect(await fetchFailed.store.runSyncAction(request)).toMatchObject({ outcome: "done", fetchFailure: { kind: "offline" } });
		expect(listed(fetchFailed.store).sync).toMatchObject({ behind: 0 });
		for (const ending of ["diverged", "local-changes"] as const) {
			const { store } = await started(ending);
			expect(await store.runSyncAction(request)).toMatchObject({ outcome: "refused", reason: ending });
			expect(listed(store).sync).toMatchObject({ behind: 2 });
		}
		const failed = await started("failed");
		expect(await failed.store.runSyncAction(request)).toMatchObject({ outcome: "failed", ran: true });
		// The upstream the commands named is not the branch's now: nothing runs.
		const moved = await started();
		expect(await moved.store.runSyncAction({ ...request, target: { remote: "origin", upstreamRef: "refs/remotes/origin/other" } })).toMatchObject({ outcome: "failed", ran: false });
		expect(listed(moved.store).sync).toMatchObject({ behind: 2 });
	});
});
