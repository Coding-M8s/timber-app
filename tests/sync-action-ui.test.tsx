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
import type { SyncState, TimberStatus, Worktree } from "../src/shared/model";
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

	test("is not offered for a diverged, level, force-pushed, gone, unpublished, or detached branch, nor while Timber removes the worktree", () => {
		const cases: Worktree[] = [
			{ ...behind, sync: tracking(1, 3) },
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
		expect(describeSyncCommands("pull", target, behind.path)).toEqual({
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

const ahead: Worktree = { ...behind, sync: tracking(2, 0) };

describe("the Push control on a row", () => {
	test("a branch that is ahead and not behind gets a Push control with its count, in place of the ahead marker", () => {
		const markup = renderRow(ahead);
		const control = /<span class="row-sync"><button type="button" class="sync ahead row-sync-button" aria-haspopup="dialog" aria-label="([^"]+)" title="([^"]+)">(.*?)<\/button><\/span>/.exec(markup);
		expect(control).not.toBeNull();
		expect(control![1]).toBe("Push 2 commits from feat/x to origin/feat/x");
		expect(control![2]).toBe("2 commits to push to origin/feat/x. Click to see the Timber command, then push.");
		expect(control![3]!.replace(/<svg.*?<\/svg>/, "")).toBe("2");
		// The ahead count is drawn once, and its sentence stays in the row's description.
		expect(markup.match(/class="sync ahead/g)?.length).toBe(1);
		expect(markup).toContain("2 commits to push to origin/feat/x, as of the last fetch.");
	});

	test("without a way to act, the ahead count stays a marker", () => {
		expect(renderRow(ahead, false)).toContain("<span class=\"sync ahead\"");
	});

	test("is not offered for a behind, diverged, level, force-pushed, gone, unpublished, or detached branch, nor while Timber removes the worktree", () => {
		const cases: Worktree[] = [
			behind,
			{ ...behind, sync: tracking(1, 3) },
			{ ...behind, sync: tracking(0, 0) },
			{ ...behind, sync: tracking(2, 0, { forcePushed: { at: 5 } }) },
			{ ...behind, sync: { kind: "gone", upstream: "origin/feat/x" } },
			{ ...behind, sync: { kind: "unpublished" } },
			{ ...behind, branch: null, detached: true, sync: null },
		];
		for (const worktree of cases) {
			expect(describeSyncControls(worktree).map(control => control.action)).not.toContain("push");
			expect(renderRow(worktree)).not.toContain("sync ahead row-sync-button");
		}
		expect(renderRow(ahead, true, true)).not.toContain("row-sync");
	});
});

describe("Push in the worktree menu", () => {
	test("comes before Done while it applies, and opens the dialog for the row's worktree", () => {
		expect(worktreeMenuItems(ahead).map(item => item.id)).toEqual(["sync:push", "done"]);
		expect(worktreeMenuItems(ahead)[0]).toMatchObject({ label: "Push", disabled: false, note: null });
		expect(worktreeMenuChoice("/work/app", ahead, "sync:push")).toEqual({ kind: "sync-action", action: "push", repository: "/work/app", worktree: ahead.id });
	});

	test("is not listed for a branch that is behind or diverged, and is off while Timber removes the worktree", () => {
		expect(worktreeMenuItems(behind).map(item => item.id)).toEqual(["sync:pull", "done"]);
		expect(worktreeMenuChoice("/work/app", behind, "sync:push")).toBeNull();
		expect(worktreeMenuItems({ ...behind, sync: tracking(1, 3) }).map(item => item.id)).toEqual(["done"]);
		expect(worktreeMenuItems(ahead, true)[0]).toMatchObject({ id: "sync:push", disabled: true, note: BEING_REMOVED_REASON });
		expect(worktreeMenuChoice("/work/app", ahead, "sync:push", true)).toBeNull();
	});
});

describe("the Push dialog", () => {
	const view = (props: Partial<SyncActionDialogViewProps> = {}) => renderToStaticMarkup(
		<SyncActionDialogView action="push" worktree={ahead} path={ahead.path} result={null} submission={{ running: false, failure: null }} onSubmit={() => {}} onClose={() => {}} {...props} />,
	);

	test("shows the timber publish command before it runs", () => {
		expect(describeSyncCommands("push", target, ahead.path)).toEqual({ command: `timber publish --result-file <temporary file> -- ${ahead.path}`, followUps: [] });
		const markup = view();
		expect(markup).toContain("Push feat/x");
		expect(markup).toContain(`<pre class="dialog-command" aria-label="Command that will run">timber publish --result-file &lt;temporary file&gt; -- ${ahead.path}</pre>`);
		expect(markup).toContain("2 commits ahead of origin/feat/x.");
		expect(markup).toContain("never force-pushes, never asks for a password");
	});

	test("a refusal or a failure shows Timber's words", () => {
		const command = `timber publish --result-file <temporary file> -- ${ahead.path}`;
		const refused: SyncActionResult = {
			outcome: "refused", action: "push", reason: "timber-refused", fetchFailure: null,
			failure: { command, diagnostic: "The remote branch origin/feat/x has moved on: it has commits this branch does not contain.", output: null },
		};
		const refusedMarkup = view({ result: refused, submission: { running: false, failure: refused.failure } });
		expect(refusedMarkup).toContain("Could not push");
		expect(refusedMarkup).toContain("has moved on");
		expect(refusedMarkup).toContain("Timber refused, so nothing was pushed and no branch changed.");
		const failed: SyncActionResult = { outcome: "failed", action: "push", ran: true, failure: { command, diagnostic: "Git push to origin/feat/x failed (network, remote, hook or another Git error).", output: null } };
		expect(view({ result: failed, submission: { running: false, failure: failed.failure } })).toContain("Git push to origin/feat/x failed");
		expect(describeSyncRefusalNote(failed)).toBeNull();
	});

	test("a push that worked closes with a toast", () => {
		expect(presentSyncResult("push", "feat/x", "origin/feat/x", { outcome: "done", action: "push", moved: true, fetchFailure: null }))
			.toEqual({ ok: true, toast: "Pushed feat/x to origin/feat/x.", problem: false });
		expect(presentSyncResult("push", "feat/x", "origin/feat/x", { outcome: "done", action: "push", moved: false, fetchFailure: null }))
			.toEqual({ ok: true, toast: "origin/feat/x already has every commit of feat/x.", problem: false });
	});
});

describe("a push through the store and the mock engine", () => {
	const TIMBER = "/work/timber";
	const lookup = sampleRepositories[0]!.worktrees.find(worktree => worktree.branch === "feat/github-issue-lookup")!;
	const request = { action: "push" as const, repository: TIMBER, worktree: lookup.path, target: { remote: "origin", upstreamRef: "refs/remotes/origin/feat/github-issue-lookup" } };

	async function started(ending: SyncEnding = "pushed", timber: TimberStatus = sampleTimberStatuses.ready) {
		const engine = createMockEngine(structuredClone(sampleRepositories), timber);
		engine.endSyncActions(ending);
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		return { store, engine };
	}
	const listed = (store: Awaited<ReturnType<typeof started>>["store"]) => store.getState().repositories[0]!.worktrees.find(worktree => worktree.id === lookup.id)!;

	test("the sample's feat/github-issue-lookup is ahead, so it offers Push", () => {
		expect(lookup.sync).toMatchObject({ kind: "tracking", ahead: 2, behind: 0 });
		expect(describeSyncControls(lookup).map(control => control.action)).toEqual(["push"]);
	});

	test("the row's counts follow a push without a manual refresh, and the control goes", async () => {
		const { store, engine } = await started();
		expect(await store.runSyncAction(request)).toEqual({ outcome: "done", action: "push", moved: true, fetchFailure: null });
		expect(listed(store).sync).toMatchObject({ ahead: 0, behind: 0 });
		expect(describeSyncControls(listed(store))).toEqual([]);
		expect(engine.syncActionRequests()).toEqual([request]);
	});

	test("a refusal or a failure, offline included, leaves the counts as they were", async () => {
		for (const ending of ["remote-moved", "offline", "sign-in", "failed"] as const) {
			const { store } = await started(ending);
			const result = await store.runSyncAction(request);
			expect(result.outcome).toBe(ending === "remote-moved" ? "refused" : "failed");
			if (result.outcome === "done") throw new Error("unreachable");
			expect(result.failure.command).toBe(`timber publish --result-file <temporary file> -- ${lookup.path}`);
			expect(listed(store).sync).toMatchObject({ ahead: 2, behind: 0 });
		}
	});

	test("a pull ending does not decide a push, nor a push ending a pull", async () => {
		const { store } = await started("diverged");
		expect(await store.runSyncAction(request)).toMatchObject({ outcome: "done", action: "push" });
		const main = sampleRepositories[0]!.worktrees.find(worktree => worktree.primary)!;
		const pushEnding = await started("remote-moved");
		expect(await pushEnding.store.runSyncAction({ action: "pull", repository: TIMBER, worktree: main.path, target: { remote: "origin", upstreamRef: "refs/remotes/origin/main" } }))
			.toMatchObject({ outcome: "done", action: "pull" });
	});

	test("runs nothing when Timber is not ready", async () => {
		const { store } = await started("pushed", sampleTimberStatuses["not-found"]);
		expect(await store.runSyncAction(request)).toMatchObject({ outcome: "failed", action: "push", ran: false, failure: { diagnostic: "Timber is not ready. Nothing was run." } });
	});
});

describe("Pull without its dialog", () => {
	const TIMBER = "/work/timber";
	const main = sampleRepositories[0]!.worktrees.find(worktree => worktree.primary)!;
	const pullRequest = { kind: "sync-action" as const, action: "pull" as const, repository: TIMBER, worktree: main.id };

	async function started(pull: { ask: boolean; skip: string[] }, ending: SyncEnding = "pulled") {
		const engine = createMockEngine(structuredClone(sampleRepositories), sampleTimberStatuses.ready);
		engine.endSyncActions(ending);
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		await store.savePreferences({ pull });
		return { store, engine };
	}

	test("the row's control, its menu entry, and the palette say Pull runs at once, and Push still opens its dialog", () => {
		const skipping = { pullAsks: false, pulling: false };
		const [pull] = describeSyncControls(behind, skipping);
		expect(pull).toMatchObject({ opensDialog: false, busy: false, title: "3 commits to pull from origin/feat/x, as of the last fetch. Click to pull now, without asking first." });
		expect(describeSyncControls(behind)[0]).toMatchObject({ opensDialog: true, title: "3 commits to pull from origin/feat/x, as of the last fetch. Click to see the commands, then pull." });
		expect(describeSyncControls(ahead, skipping)[0]).toMatchObject({ action: "push", opensDialog: true });
		const markup = renderToStaticMarkup(<WorktreeRow worktree={behind} selected={false} onSelect={() => {}} onSyncAction={() => {}} syncOptions={skipping} />);
		expect(markup).toContain("class=\"sync behind row-sync-button\"");
		expect(markup).not.toContain("aria-haspopup=\"dialog\"");
	});

	test("while one runs, the control and the menu entry are off", () => {
		const pulling = { pullAsks: false, pulling: true };
		expect(describeSyncControls(behind, pulling)[0]).toMatchObject({ busy: true, title: "Pulling origin/feat/x into feat/x." });
		expect(renderToStaticMarkup(<WorktreeRow worktree={behind} selected={false} onSelect={() => {}} onSyncAction={() => {}} syncOptions={pulling} />)).toContain("aria-disabled=\"true\"");
		expect(worktreeMenuItems(behind, false, pulling)[0]).toMatchObject({ id: "sync:pull", disabled: true, note: "Pulling now." });
		expect(worktreeMenuChoice("/work/app", behind, "sync:pull", false, pulling)).toBeNull();
	});

	test("a repository that skips it pulls at once and says so in a toast, with no dialog", async () => {
		const { store, engine } = await started({ ask: true, skip: [TIMBER] });
		store.openDialog(pullRequest);
		expect(store.getState().dialog).toBeNull();
		expect(store.getState().operations).toContainEqual({ kind: "pull-worktree", repository: TIMBER, worktree: main.path });
		// A second Pull while it runs does nothing.
		store.openDialog(pullRequest);
		await settle();
		expect(engine.syncActionRequests()).toEqual([{ action: "pull", repository: TIMBER, worktree: main.path, target: { remote: "origin", upstreamRef: "refs/remotes/origin/main" } }]);
		expect(store.getState().dialog).toBeNull();
		expect(store.getState().toasts.at(-1)).toMatchObject({ text: "Pulled origin/main into main." });
		expect(store.getState().operations.some(operation => operation.kind === "pull-worktree")).toBe(false);
	});

	test("with Ask before pulling off, every repository pulls at once, and the palette closes", async () => {
		const { store, engine } = await started({ ask: false, skip: [] });
		store.openPalette();
		store.openDialog(pullRequest);
		expect(store.getState().dialog).toBeNull();
		await settle();
		expect(engine.syncActionRequests()).toHaveLength(1);
	});

	test("a repository that asks shows the dialog, and Push always does", async () => {
		const asking = await started({ ask: true, skip: ["/work/other"] });
		asking.store.openDialog(pullRequest);
		expect(asking.store.getState().dialog).toEqual(pullRequest);
		const { store, engine } = await started({ ask: false, skip: [TIMBER] });
		const feature = sampleRepositories[0]!.worktrees.find(worktree => worktree.sync?.kind === "tracking" && worktree.sync.ahead > 0 && worktree.sync.behind === 0)!;
		const push = { kind: "sync-action" as const, action: "push" as const, repository: TIMBER, worktree: feature.id };
		store.openDialog(push);
		expect(store.getState().dialog).toEqual(push);
		await settle();
		expect(engine.syncActionRequests()).toEqual([]);
	});

	test("a refusal or a failure opens the dialog on what Git said", async () => {
		for (const ending of ["diverged", "local-changes", "failed"] as const) {
			const { store } = await started({ ask: true, skip: [TIMBER] }, ending);
			store.openDialog(pullRequest);
			await settle();
			const dialog = store.getState().dialog;
			expect(dialog).toMatchObject({ ...pullRequest, ended: { outcome: ending === "failed" ? "failed" : "refused" } });
			if (dialog?.kind !== "sync-action" || !dialog.ended) throw new Error("unreachable");
			expect(dialog.ended.failure.command).toBe("git merge --ff-only --no-autostash refs/remotes/origin/main");
		}
	});

	test("a refusal while another dialog is open leaves that dialog and says what Git said in a toast", async () => {
		const { store } = await started({ ask: true, skip: [TIMBER] }, "diverged");
		store.openDialog(pullRequest);
		store.openDialog({ kind: "new-worktree", repository: TIMBER });
		await settle();
		expect(store.getState().dialog).toEqual({ kind: "new-worktree", repository: TIMBER });
		expect(store.getState().toasts.at(-1)).toMatchObject({ problem: true });
		expect(store.getState().toasts.at(-1)!.text).toStartWith("Could not pull into main. ");
	});

	test("a refusal for a worktree that left the list says what Git said in a toast", async () => {
		const { store, engine } = await started({ ask: true, skip: [TIMBER] }, "diverged");
		store.openDialog(pullRequest);
		// The list read after the pull no longer has the worktree.
		const without = structuredClone(sampleRepositories);
		without[0]!.worktrees = without[0]!.worktrees.filter(worktree => worktree.id !== main.id);
		engine.setRepositories(without);
		await settle();
		expect(store.getState().dialog).toBeNull();
		expect(store.getState().toasts.at(-1)).toMatchObject({ problem: true });
	});

	test("removing a repository drops its switch, so after adding it again the dialog shows", async () => {
		const { store, engine } = await started({ ask: true, skip: [TIMBER, "/work/other"] });
		await store.removeRepository(TIMBER);
		expect(store.getState().preferences.pull.skip).toEqual(["/work/other"]);
		expect((await engine.loadPreferences()).pull.skip).toEqual(["/work/other"]);
	});
});

describe("the Pull dialog's box", () => {
	const view = (props: Partial<SyncActionDialogViewProps> = {}) => renderToStaticMarkup(
		<SyncActionDialogView action="pull" worktree={behind} path={behind.path} result={null} submission={{ running: false, failure: null }} onSubmit={() => {}} onClose={() => {}} {...props} />,
	);

	test("is offered, unticked, only when asked for", () => {
		const markup = view({ skipChoice: { repository: "app", checked: false, onChange: () => {} } });
		expect(markup).toContain("Don&#x27;t ask before pulling in app");
		expect(markup).toMatch(/<input type="checkbox" aria-describedby="[^"]+"\/>/);
		expect(view()).not.toContain("ask before pulling");
		expect(view({ skipChoice: { repository: "app", checked: true, onChange: () => {} } })).toMatch(/<input type="checkbox" aria-describedby="[^"]+" checked=""\/>/);
	});

	test("after a run, a worktree that went is not said to have run nothing", () => {
		const failed: SyncActionResult = { outcome: "failed", action: "pull", ran: true, failure: { command: null, diagnostic: "Git stopped.", output: null } };
		expect(view({ worktree: null, result: failed })).not.toContain("Nothing was run.");
		expect(view({ worktree: null, result: failed })).toContain("This worktree left the list.");
	});
});
