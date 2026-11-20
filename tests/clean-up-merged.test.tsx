import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import {
	CLEAN_UP_LIMIT, CLEAN_UP_PREVIEWS_AT_ONCE, LIST_OLDER_REASON, NO_MERGED_REASON, OVER_LIMIT_REASON, PULL_REQUESTS_UNREAD_REASON, REPOSITORY_UNAVAILABLE_REASON, SESSIONS_REASON, SESSION_STARTED_DIAGNOSTIC,
	cleanUpUnavailableReason, describeCleanUpButton, describeCleanUpCommands, describeCleanUpEnded, describeReadyWarning, mergedCandidates, skipReason,
} from "../src/mainview/clean-up-format";
import { CleanUpMergedDialogView } from "../src/mainview/components/CleanUpMergedDialog";
import { DONE_EXPIRED_NOTE } from "../src/mainview/done-format";
import { createMockEngine, sampleChanges, sampleMergedRepository, sampleRemovalRefusals, sampleRepositories } from "../src/mainview/engine/mock";
import { paletteEntries } from "../src/mainview/palette";
import { type CleanUpItem, type CleanUpSession, createCleanUpSession, readyRows } from "../src/mainview/store/clean-up-session";
import { type AppStore, createAppStore } from "../src/mainview/store/store";
import { isBeingRemoved, runningSessionCount } from "../src/mainview/store/state";
import { repositoryMenuChoice, repositoryMenuItems } from "../src/mainview/worktree-menu-format";
import type { Repository, Worktree } from "../src/shared/model";
import type { PullRequestList } from "../src/shared/pull-requests";
import { DEFAULT_DONE_OPTIONS, type DonePreview, describeDoneApply } from "../src/shared/timber-done";

const settle = () => Bun.sleep(0);
const STOREFRONT = sampleMergedRepository.path;
const at = (branch: string) => `/work/storefront-worktrees/${branch.replaceAll("/", "-")}`;
const COUPONS = at("feat/coupons");
const CI_CACHE = at("chore/ci-cache");
const CART = at("feat/cart-redesign");
const ROUNDING = at("fix/currency-rounding");
const WISHLIST = at("feat/wishlist");

async function startedStore(repositories: Repository[] = [...sampleRepositories, sampleMergedRepository]) {
	const engine = createMockEngine(repositories);
	// Count what reaches the engine, and how many removals run at once.
	const applied: string[] = [];
	let running = 0;
	let most = 0;
	const applyDone = engine.applyDone;
	engine.applyDone = async request => {
		applied.push(request.path);
		running++;
		most = Math.max(most, running);
		try {
			return await applyDone(request);
		} finally {
			running--;
		}
	};
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	await settle();
	return { store, engine, applied, most: () => most };
}

const storefront = (store: AppStore) => store.getState().repositories.find(repository => repository.path === STOREFRONT)!;
const listed = (store: AppStore, path: string) => storefront(store).worktrees.find(worktree => worktree.path === path) ?? null;

/** A session for the storefront's merged worktrees, as the dialog makes it. */
function sessionFor(store: AppStore, schedule?: (task: () => void, milliseconds: number) => () => void, now?: () => number): { session: CleanUpSession; started: CleanUpItem[][] } {
	const started: CleanUpItem[][] = [];
	const session = createCleanUpSession({
		repository: STOREFRONT,
		candidates: mergedCandidates(storefront(store), store.getState().pullRequests[STOREFRONT]),
		preview: store.previewDone,
		current: path => listed(store, path),
		runningSessions: worktree => runningSessionCount(store.getState(), worktree.id),
		beingRemoved: path => isBeingRemoved(store.getState(), STOREFRONT, path),
		apply: items => {
			started.push([...items]);
			void store.cleanUpMerged({ repository: STOREFRONT, items });
		},
		...(schedule ? { schedule } : {}),
		...(now ? { now } : {}),
	});
	return { session, started };
}

const kinds = (session: CleanUpSession) => Object.fromEntries(session.getState().rows.map(row => [row.worktree.path, row.kind]));

describe("which worktrees Clean up merged is about", () => {
	test("a header button opens it, shown only while the repository has merged worktrees no removal has taken", async () => {
		const { store } = await startedStore();
		const button = (markup: string) => markup.match(/<button[^>]*class="icon-button group-clean-up"[^>]*>/g) ?? [];
		const before = renderToStaticMarkup(<App store={store} />);
		expect(button(before).some(tag => tag.includes(`aria-label="${describeCleanUpButton("storefront", 4)}"`))).toBe(true);
		// timber has no merged worktree, so it has no button.
		expect(button(before).some(tag => tag.includes("in timber "))).toBe(false);
		expect(describeCleanUpButton("storefront", 1)).toBe("Clean up merged: 1 worktree in storefront has a merged pull request. Previews each before anything is removed.");

		// Three of the four are Ready; once Remove queued them, the button counts the one left.
		const { session } = sessionFor(store);
		session.start();
		for (let turn = 0; turn < 10; turn++) await settle();
		expect(readyRows(session.getState()).length).toBe(3);
		expect(session.remove()).toBe(true);
		const during = renderToStaticMarkup(<App store={store} />);
		expect(button(during).some(tag => tag.includes(`aria-label="${describeCleanUpButton("storefront", 1)}"`))).toBe(true);
	});

	test("only linked worktrees of the chosen repository whose pull request merged, for the branch they have now", async () => {
		const { store } = await startedStore();
		const list = store.getState().pullRequests[STOREFRONT];
		expect(mergedCandidates(storefront(store), list).map(worktree => worktree.path)).toEqual([COUPONS, CI_CACHE, CART, ROUNDING]);
		// The open pull request and the primary checkout are never candidates, and api-server's merged worktree is in another repository.
		expect(mergedCandidates(storefront(store), list).map(worktree => worktree.path)).not.toContain(WISHLIST);

		// A pull request for a branch the worktree no longer has is not its own.
		const moved: PullRequestList = list?.ok
			? { ok: true, worktrees: list.worktrees.map(entry => entry.path === COUPONS ? { ...entry, branch: "feat/old-name" } : entry) }
			: { ok: false, message: "" };
		expect(mergedCandidates(storefront(store), moved).map(worktree => worktree.path)).toEqual([CI_CACHE, CART, ROUNDING]);
	});

	test("it is offered only with at least one merged worktree, and says why otherwise", async () => {
		const { store } = await startedStore();
		const { pullRequests } = store.getState();
		const timber = store.getState().repositories.find(repository => repository.path === "/work/timber")!;
		expect(cleanUpUnavailableReason(storefront(store), pullRequests[STOREFRONT])).toBeNull();
		expect(cleanUpUnavailableReason(timber, pullRequests[timber.path])).toBe(NO_MERGED_REASON);
		expect(cleanUpUnavailableReason(storefront(store), undefined)).toBe(PULL_REQUESTS_UNREAD_REASON);
		expect(cleanUpUnavailableReason(storefront(store), { ok: false, message: "offline" })).toBe(PULL_REQUESTS_UNREAD_REASON);
		expect(cleanUpUnavailableReason({ ...storefront(store), available: false }, pullRequests[STOREFRONT])).toBe(REPOSITORY_UNAVAILABLE_REASON);
	});

	test("the repository's menu has it, enabled only when it can run, and it opens the dialog for that repository", async () => {
		const { store } = await startedStore();
		const { pullRequests } = store.getState();
		expect(repositoryMenuItems(storefront(store), pullRequests[STOREFRONT])).toMatchObject([{ id: "clean-up-merged", label: "Clean up merged", disabled: false, note: null }]);
		expect(repositoryMenuChoice(storefront(store), pullRequests[STOREFRONT], "clean-up-merged")).toEqual({ kind: "clean-up-merged", repository: STOREFRONT });
		const timber = store.getState().repositories.find(repository => repository.path === "/work/timber")!;
		expect(repositoryMenuItems(timber, pullRequests[timber.path])).toMatchObject([{ disabled: true, note: NO_MERGED_REASON }]);
		expect(repositoryMenuChoice(timber, pullRequests[timber.path], "clean-up-merged")).toBeNull();
	});

	test("the command palette has one entry per repository, never a global one", async () => {
		const { store } = await startedStore();
		const entries = paletteEntries(store.getState()).filter(entry => entry.label === "Clean up merged");
		expect(entries.map(entry => [entry.detail, entry.disabledReason])).toEqual([
			["In timber", NO_MERGED_REASON],
			["In api-server", null],
			["In storefront", null],
		]);
		expect(entries[2]!.action).toEqual({ kind: "dialog", request: { kind: "clean-up-merged", repository: STOREFRONT } });
	});
});

describe("sorting previews into Ready and Skipped", () => {
	const preview = (changes: DonePreview["worktree"]["changes"], ignored: string[] = []): DonePreview => ({
		snapshot: "0".repeat(64),
		expiresAt: Date.now() + 60_000,
		repository: { commonGitDir: "/r/.git", primaryWorktreeRoot: "/r" },
		worktree: { path: "/r-w/x", canonicalPath: "/r-w/x", branch: "x", head: "0".repeat(40), primary: false, detached: false, locked: false, prunable: false, pathExists: true, changes, base: null, issue: null },
		ignored,
		options: { keepBranch: false, discardIgnored: true, base: null },
	} as DonePreview);
	const clean = sampleChanges(0, 0);
	const HEAD = "0".repeat(40);
	const level = { kind: "tracking", upstream: "origin/x", ahead: 0, behind: 3 } as const;

	test("modified or untracked files, and commits never published or still to push, skip it with the reason", () => {
		expect(skipReason(preview(sampleChanges(2, 1)), { head: HEAD, sync: level })).toBe("It has 2 modified files and 1 untracked file, which would be deleted.");
		expect(skipReason(preview(sampleChanges(0, 1)), { head: HEAD, sync: level })).toBe("It has 1 untracked file, which would be deleted.");
		expect(skipReason(preview(clean), { head: HEAD, sync: { kind: "unpublished" } })).toBe("Its branch was never published, so its commits would be deleted.");
		expect(skipReason(preview(clean), { head: HEAD, sync: { ...level, ahead: 2 } })).toBe("2 commits are not on origin/x as of the last fetch, and would be deleted.");
		expect(skipReason(preview(clean), { head: HEAD, sync: null })).toBe("Git could not say how its branch stands against its upstream.");
		expect(skipReason(preview({ kind: "unknown", reason: "no access" }), { head: HEAD, sync: level })).toBe("Timber could not read its files, so it may hold changes.");
	});

	test("a preview for another commit than the list has skips it, since the list may be missing commits", () => {
		expect(skipReason(preview(clean), { head: "1".repeat(40), sync: level })).toBe(LIST_OLDER_REASON);
	});

	test("ignored files never skip it", () => {
		expect(skipReason(preview(clean, ["node_modules/", ".env.local"]), { head: HEAD, sync: level })).toBeNull();
	});

	test("a deleted upstream, as after a merge, is Ready, and its row says what it means for commits", () => {
		const gone = { kind: "gone", upstream: "origin/x" } as const;
		expect(skipReason(preview(clean), { head: HEAD, sync: gone })).toBeNull();
		expect(describeReadyWarning(preview(clean), { sync: gone })).toBe("Its upstream origin/x was deleted. Commits that are only on this branch are deleted with it.");
		expect(describeReadyWarning(preview(clean), { sync: level })).toBeNull();
	});

	test("the commands are one apply per Ready worktree, and the toast counts every ending", () => {
		expect(describeCleanUpCommands([COUPONS, CI_CACHE])).toBe(`${describeDoneApply(COUPONS)}\n${describeDoneApply(CI_CACHE)}`);
		expect(describeCleanUpCommands([])).toBe("Nothing is ready, so Remove runs nothing.");
		expect(describeCleanUpEnded("storefront", 3, 0)).toBe("Removed 3 merged worktrees from storefront.");
		expect(describeCleanUpEnded("storefront", 2, 1)).toBe("Removed 2 of 3 merged worktrees from storefront. 1 did not finish: the sidebar shows what Timber said.");
		expect(describeCleanUpEnded("storefront", 0, 2)).toBe("No merged worktree was removed from storefront. 2 did not finish: the sidebar shows what Timber said.");
	});
});

describe("the Clean up merged session, against the mock engine", () => {
	test("opening previews each candidate with Timber's defaults and removes nothing", async () => {
		const { store, applied } = await startedStore();
		const previews: string[] = [];
		const previewDone = store.previewDone;
		const { session } = sessionFor({ ...store, previewDone: request => (previews.push(`${request.path} ${JSON.stringify(request.options)}`), previewDone(request)) });
		session.start();
		expect(Object.values(kinds(session))).toEqual(["loading", "loading", "loading", "loading"]);
		await settle();
		expect(previews).toEqual([COUPONS, CI_CACHE, CART, ROUNDING].map(path => `${path} ${JSON.stringify(DEFAULT_DONE_OPTIONS)}`));
		expect(kinds(session)).toEqual({ [COUPONS]: "ready", [CI_CACHE]: "ready", [CART]: "skipped", [ROUNDING]: "ready" });
		const cart = session.getState().rows.find(row => row.worktree.path === CART);
		expect(cart?.kind === "skipped" && cart.reason).toBe("It has 2 modified files and 1 untracked file, which would be deleted.");
		const coupons = readyRows(session.getState()).find(row => row.worktree.path === COUPONS)!;
		expect(coupons.warning).toContain("Its upstream origin/feat/coupons was deleted.");
		// Its ignored files were in the preview, and never made it a skip.
		expect(coupons.preview.ignored).toEqual(["node_modules/", ".env.local"]);
		expect(applied).toEqual([]);
		expect(storefront(store).worktrees).toHaveLength(6);
	});

	test("a worktree with a live session is skipped with the reason, and so is one being removed", async () => {
		const { store } = await startedStore();
		await store.openTerminal({ repository: STOREFRONT, worktree: CI_CACHE, cols: 80, rows: 24 });
		const { session } = sessionFor(store);
		session.start();
		await settle();
		const row = session.getState().rows.find(candidate => candidate.worktree.path === CI_CACHE);
		expect(row?.kind === "skipped" && row.reason).toBe(SESSIONS_REASON);
	});

	test("a preview that expires leaves Ready at once, and Remove never approves it", async () => {
		const { store } = await startedStore();
		let clock = Date.now();
		const timers: { at: number; task: () => void }[] = [];
		const { session, started } = sessionFor(store, (task, milliseconds) => {
			timers.push({ at: clock + milliseconds, task });
			return () => {};
		}, () => clock);
		session.start();
		await settle();
		expect(readyRows(session.getState())).toHaveLength(3);
		clock += 11 * 60_000;
		for (const timer of timers) timer.task();
		expect(readyRows(session.getState())).toHaveLength(0);
		expect(session.getState().rows.filter(row => row.kind === "skipped" && row.reason === DONE_EXPIRED_NOTE)).toHaveLength(3);
		expect(session.remove()).toBe(false);
		expect(started).toEqual([]);
	});

	test("a late timer is caught by Remove, which checks the time itself", async () => {
		const { store } = await startedStore();
		let clock = Date.now();
		const { session, started } = sessionFor(store, () => () => {}, () => clock);
		session.start();
		await settle();
		clock += 11 * 60_000;
		expect(session.remove()).toBe(false);
		expect(started).toEqual([]);
	});

	test("a few previews run at a time, Preview again drops the answers to the round before, and a preview that throws is skipped", async () => {
		const { store } = await startedStore();
		const pending: { path: string; resolve: (result: Awaited<ReturnType<AppStore["previewDone"]>>) => void; reject: (error: Error) => void }[] = [];
		const { session } = sessionFor({
			...store,
			previewDone: request => new Promise((resolve, reject) => pending.push({ path: request.path, resolve, reject })),
		});
		session.start();
		expect(pending).toHaveLength(Math.min(CLEAN_UP_PREVIEWS_AT_ONCE, 4));
		const first = pending.splice(0);
		session.refresh();
		const real = await store.previewDone({ repository: STOREFRONT, path: COUPONS, options: DEFAULT_DONE_OPTIONS });
		// An answer to the first round arrives late: it is dropped.
		first[0]!.resolve(real);
		await settle();
		expect(kinds(session)[COUPONS]).toBe("loading");
		// In the new round, one preview throws.
		pending.find(entry => entry.path === CI_CACHE)!.reject(new Error("the bridge closed"));
		await settle();
		const row = session.getState().rows.find(candidate => candidate.worktree.path === CI_CACHE);
		expect(row?.kind === "skipped" && row.failure?.diagnostic).toBe("the bridge closed");
	});

	test("more candidates than one run previews are listed as skipped, with the reason", async () => {
		const many: Repository = {
			...sampleMergedRepository,
			worktrees: [sampleMergedRepository.worktrees[0]!, ...Array.from({ length: CLEAN_UP_LIMIT + 2 }, (_, index) => ({ ...sampleMergedRepository.worktrees[1]!, path: `/work/storefront-worktrees/many-${index}`, id: `many-${index}` }))],
		};
		const list: PullRequestList = { ok: true, worktrees: many.worktrees.slice(1).map(worktree => ({ path: worktree.path, branch: "feat/coupons", outcome: "found", pullRequest: { state: "merged" } as never })) };
		const session = createCleanUpSession({
			repository: STOREFRONT,
			candidates: mergedCandidates(many, list),
			preview: () => new Promise(() => {}),
			current: path => many.worktrees.find(worktree => worktree.path === path) ?? null,
			runningSessions: () => 0,
			beingRemoved: () => false,
			apply: () => {},
		});
		session.start();
		const rows = session.getState().rows;
		expect(rows.filter(row => row.kind === "loading")).toHaveLength(CLEAN_UP_LIMIT);
		expect(rows.filter(row => row.kind === "skipped" && row.reason === OVER_LIMIT_REASON)).toHaveLength(2);
	});
});

describe("removing the Ready worktrees", () => {
	test("one at a time, each with its own preview; a refusal stays on its own row, and the others are removed", async () => {
		const { store, engine, applied, most } = await startedStore();
		engine.setDoneDelay(20);
		store.openDialog({ kind: "clean-up-merged", repository: STOREFRONT });
		const { session, started } = sessionFor(store);
		session.start();
		await settle();
		expect(session.remove()).toBe(true);
		const items = started[0]!;
		expect(items.map(item => item.worktree.path)).toEqual([COUPONS, CI_CACHE, ROUNDING]);
		expect(new Set(items.map(item => item.preview)).size).toBe(3);

		// The first runs and the rest wait their turn, with their actions off.
		expect(store.getState().removals.map(removal => [removal.worktree.path, removal.status.kind])).toEqual([[COUPONS, "running"], [CI_CACHE, "waiting"], [ROUNDING, "waiting"]]);
		expect(isBeingRemoved(store.getState(), STOREFRONT, ROUNDING)).toBe(true);
		store.openDialog({ kind: "done-worktree", repository: STOREFRONT, worktree: listed(store, ROUNDING)!.id });
		expect(store.getState().dialog).toEqual({ kind: "clean-up-merged", repository: STOREFRONT });
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain(">waiting to be removed</span>");

		while (store.getState().removals.some(removal => removal.status.kind !== "failed")) await Bun.sleep(10);
		expect(most()).toBe(1);
		expect(applied).toEqual([COUPONS, CI_CACHE, ROUNDING]);
		// The sidebar shows the real state: two gone, the refused one and the skipped one still there.
		expect(storefront(store).worktrees.map(worktree => worktree.path)).toEqual([STOREFRONT, CART, ROUNDING, WISHLIST]);
		expect(store.getState().removals).toMatchObject([{ worktree: { path: ROUNDING }, status: { kind: "failed", gone: false, failure: { diagnostic: sampleRemovalRefusals[ROUNDING] } } }]);
		// One toast for the run, pointing at what failed.
		expect(store.getState().toasts).toMatchObject([{ text: describeCleanUpEnded("storefront", 2, 1), problem: true }]);
		const after = renderToStaticMarkup(<App store={store} />);
		expect(after).toContain(">removal failed</span>");
	});

	test("a partial failure is kept as that worktree's record, and the run goes on", async () => {
		const { store, engine } = await startedStore();
		engine.refuseRemovals(ROUNDING, null);
		engine.failBranchDeletion(true);
		const { session } = sessionFor(store);
		session.start();
		await settle();
		session.remove();
		while (store.getState().removals.some(removal => removal.status.kind !== "failed")) await Bun.sleep(5);
		expect(store.getState().removals.map(removal => [removal.worktree.path, removal.status.kind === "failed" && removal.status.gone])).toEqual([[COUPONS, true], [CI_CACHE, true], [ROUNDING, true]]);
		expect(storefront(store).worktrees.map(worktree => worktree.path)).toEqual([STOREFRONT, CART, WISHLIST]);
	});

	test("a session started after the preview, or a preview that expired while others ran, fails only its own row", async () => {
		const { store, engine } = await startedStore();
		engine.refuseRemovals(ROUNDING, null);
		const { session } = sessionFor(store);
		session.start();
		await settle();
		session.remove();
		await store.openTerminal({ repository: STOREFRONT, worktree: CI_CACHE, cols: 80, rows: 24 }).catch(() => null);
		while (store.getState().removals.some(removal => removal.status.kind !== "failed")) await Bun.sleep(5);
		expect(listed(store, COUPONS)).toBeNull();
		expect(listed(store, ROUNDING)).toBeNull();
		// The session never started, because the worktree was queued, so it was removed as well.
		expect(listed(store, CI_CACHE)).toBeNull();

		// A session that runs before its turn makes that row fail, with nothing run.
		const second = await startedStore();
		second.engine.refuseRemovals(ROUNDING, null);
		const { session: again } = sessionFor(second.store);
		again.start();
		await settle();
		const items = readyRows(again.getState()).map(row => ({ worktree: row.worktree, preview: row.id, shown: row.preview }));
		await second.store.openTerminal({ repository: STOREFRONT, worktree: CI_CACHE, cols: 80, rows: 24 });
		await second.store.cleanUpMerged({ repository: STOREFRONT, items });
		expect(second.applied).toEqual([COUPONS, ROUNDING]);
		expect(second.store.getState().removals).toMatchObject([{ worktree: { path: CI_CACHE }, status: { kind: "failed", failure: { diagnostic: SESSION_STARTED_DIAGNOSTIC } } }]);

		// An expired preview is refused by the engine before anything runs, for that row only.
		const third = await startedStore();
		third.engine.refuseRemovals(ROUNDING, null);
		third.engine.expirePreviewsAfter(150);
		const { session: late } = sessionFor(third.store);
		late.start();
		await settle();
		const lateItems = readyRows(late.getState()).map(row => ({ worktree: row.worktree, preview: row.id, shown: row.preview }));
		// The first removal is checked before its preview expires, and takes long enough for the others to expire.
		third.engine.setDoneDelay(100);
		await third.store.cleanUpMerged({ repository: STOREFRONT, items: lateItems });
		expect(listed(third.store, COUPONS)).toBeNull();
		expect(third.store.getState().removals.map(removal => removal.worktree.path)).toEqual([CI_CACHE, ROUNDING]);
		expect(third.store.getState().removals.every(removal => removal.status.kind === "failed" && removal.status.failure.diagnostic.includes("expired"))).toBe(true);
	});

	test("a second run in the same repository waits until the first ended, and its worktrees are queued at once", async () => {
		const { store, engine, applied, most } = await startedStore();
		engine.refuseRemovals(ROUNDING, null);
		engine.setDoneDelay(20);
		const { session } = sessionFor(store);
		session.start();
		await settle();
		const items = readyRows(session.getState()).map(row => ({ worktree: row.worktree, preview: row.id, shown: row.preview }));
		const first = store.cleanUpMerged({ repository: STOREFRONT, items: items.slice(0, 1) });
		const second = store.cleanUpMerged({ repository: STOREFRONT, items: items.slice(1) });
		expect(store.getState().removals.map(removal => removal.status.kind)).toEqual(["running", "waiting", "waiting"]);
		await Promise.all([first, second]);
		expect(most()).toBe(1);
		expect(applied).toEqual([COUPONS, CI_CACHE, ROUNDING]);
		expect(store.getState().toasts.map(toast => toast.text)).toEqual([describeCleanUpEnded("storefront", 1, 0), describeCleanUpEnded("storefront", 2, 0)]);
	});

	test("a worktree that left the list before its turn is passed over, and nothing is left waiting", async () => {
		const { store, applied } = await startedStore();
		const { session } = sessionFor(store);
		session.start();
		await settle();
		const items = readyRows(session.getState()).map(row => ({ worktree: row.worktree, preview: row.id, shown: row.preview }));
		const gone: Worktree = { ...items[1]!.worktree, path: "/work/storefront-worktrees/not-there" };
		await store.cleanUpMerged({ repository: STOREFRONT, items: [items[0]!, { ...items[1]!, worktree: gone }] });
		expect(applied).toEqual([COUPONS]);
		expect(store.getState().removals).toEqual([]);
		expect(store.getState().toasts).toMatchObject([{ text: describeCleanUpEnded("storefront", 1, 0) }]);
	});
});

describe("the Clean up merged dialog", () => {
	async function opened() {
		const { store } = await startedStore();
		const { session } = sessionFor(store);
		session.start();
		await settle();
		const markup = renderToStaticMarkup(
			<CleanUpMergedDialogView repository="storefront" session={session.getState()} beingRemoved={() => false} onRefresh={() => {}} onOpenDone={() => {}} onRemove={() => {}} onClose={() => {}} />,
		);
		return { store, session, markup };
	}

	test("lists Ready and Skipped rows, with each reason and a way to the single Done dialog", async () => {
		const { markup } = await opened();
		expect(markup).toContain("Clean up merged worktrees in storefront");
		expect(markup).toContain("Ready (3)");
		expect(markup).toContain("Skipped (1)");
		expect(markup).toContain("It has 2 modified files and 1 untracked file, which would be deleted.");
		expect(markup).toContain('aria-label="Open Done for feat/cart-redesign"');
		expect(markup).toContain("Its upstream origin/feat/coupons was deleted.");
		// Ignored files are neither listed nor counted.
		expect(markup).not.toContain("node_modules");
		expect(markup).not.toContain("ignored path");
	});

	test("shows every command before anything runs: one preview per candidate and one apply per Ready row", async () => {
		const { markup } = await opened();
		for (const path of [COUPONS, CI_CACHE, ROUNDING]) expect(markup).toContain(describeDoneApply(path).replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
		expect(markup).not.toContain(describeDoneApply(CART).replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
		expect(markup).toContain(`__ide-done preview -- ${CART}`);
		expect(markup).toContain(">Remove 3 worktrees</button>");
	});

	test("a skipped row being removed cannot open its Done dialog", async () => {
		const { session } = await opened();
		const markup = renderToStaticMarkup(
			<CleanUpMergedDialogView repository="storefront" session={session.getState()} beingRemoved={() => true} onRefresh={() => {}} onOpenDone={() => {}} onRemove={() => {}} onClose={() => {}} />,
		);
		expect(markup).toContain('disabled="" title="Timber is removing this worktree."');
	});

	test("opens from the store, and shows nothing for a repository that is not listed", async () => {
		const { store } = await startedStore();
		store.openDialog({ kind: "clean-up-merged", repository: STOREFRONT });
		expect(renderToStaticMarkup(<App store={store} />)).toContain("Clean up merged worktrees in storefront");
		store.openDialog({ kind: "clean-up-merged", repository: "/work/nowhere" });
		expect(renderToStaticMarkup(<App store={store} />)).not.toContain("<dialog");
	});
});
