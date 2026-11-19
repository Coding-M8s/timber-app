import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { BEING_REMOVED_REASON, describeRemovalFailed } from "../src/mainview/done-format";
import { describeRowMarkers } from "../src/mainview/format";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { createDoneSession } from "../src/mainview/store/done-session";
import { type AppStore, createAppStore } from "../src/mainview/store/store";
import { type Removal, reconcileRemovals } from "../src/mainview/store/state";
import type { Repository, Worktree } from "../src/shared/model";
import { DEFAULT_DONE_OPTIONS, type DoneApplyResult, type DonePreview, readDonePreview } from "../src/shared/timber-done";
import { recordedDone } from "./support/timber";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const PORTABILITY = "/work/timber-worktrees/fix-macos-portability";
const SPIKE = "/work/timber-worktrees/spike-new-idea";
/** How long a removal takes in these tests. */
const DELAY = 30;

const sample = (path: string): Worktree => sampleRepositories.flatMap(repository => repository.worktrees).find(worktree => worktree.path === path)!;

async function startedStore(repositories: Repository[] = sampleRepositories) {
	const engine = createMockEngine(repositories);
	engine.setDoneDelay(DELAY);
	// Count what reaches the engine, to show that a second removal of one worktree runs nothing.
	const applied: string[] = [];
	const applyDone = engine.applyDone;
	engine.applyDone = request => {
		applied.push(request.path);
		return applyDone(request);
	};
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { store, engine, applied };
}

const listed = (store: AppStore, path: string) => store.getState().repositories.flatMap(repository => repository.worktrees).find(worktree => worktree.path === path) ?? null;

/** Ask for a preview, then press Remove, as the dialog does. The promise is the removal, which runs in the background. */
async function startRemoval(store: AppStore, path: string): Promise<{ removal: Promise<DoneApplyResult | null> }> {
	const preview = await store.previewDone({ repository: TIMBER, path, options: DEFAULT_DONE_OPTIONS });
	if (preview.outcome !== "previewed") throw new Error(preview.failure.diagnostic);
	const worktree = listed(store, path)!;
	return { removal: store.removeWorktree({ repository: TIMBER, worktree, preview: preview.id, toast: `Removed ${path}` }) };
}

const app = (store: AppStore) => renderToStaticMarkup(<App store={store} />);
const toastTexts = (store: AppStore) => store.getState().toasts.map(toast => toast.text);

describe("a removal that runs in the background", () => {
	test("the rest of the app works meanwhile, the row says so, and the worktree's actions are off", async () => {
		const { store } = await startedStore();
		store.select(sample(FEATURE).id);
		store.openDialog({ kind: "done-worktree", repository: TIMBER, worktree: sample(FEATURE).id });
		const { removal } = await startRemoval(store, FEATURE);
		// The person closes the dialog: the removal goes on.
		store.closeDialog();
		expect(store.getState().removals).toMatchObject([{ repository: TIMBER, worktree: { path: FEATURE }, status: { kind: "running" } }]);

		const markup = app(store);
		expect(markup).toContain('<span class="row-flag removing" title="Timber is removing this worktree. Its actions are off until Timber finishes." aria-hidden="true">removing</span>');
		expect(markup).toContain(`<button type="button" class="button" disabled="" title="${BEING_REMOVED_REASON}">Done</button>`);
		expect(markup).toContain(`disabled="" title="${BEING_REMOVED_REASON}">Rebase</button>`);
		expect(markup).toContain(`<span class="workspace-done-note" role="status">${BEING_REMOVED_REASON}</span>`);
		expect(markup).not.toContain("<dialog");

		// Starting Done or Rebase on it again, or a session in it, does nothing.
		store.openDialog({ kind: "done-worktree", repository: TIMBER, worktree: sample(FEATURE).id });
		expect(store.getState().dialog).toBeNull();
		store.openDialog({ kind: "rebase-worktree", repository: TIMBER, worktree: sample(FEATURE).id });
		expect(store.getState().dialog).toBeNull();
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24 });
		expect(store.getState().terminals).toEqual([]);

		// Every other worktree and dialog keeps working.
		await store.openTerminal({ repository: TIMBER, worktree: SPIKE, cols: 80, rows: 24 });
		expect(store.getState().terminals.map(session => session.path)).toEqual([SPIKE]);
		store.openDialog({ kind: "settings" });
		expect(store.getState().dialog).toEqual({ kind: "settings" });

		expect(await removal).toEqual({ outcome: "removed" });
		expect(listed(store, FEATURE)).toBeNull();
		expect(store.getState().removals).toEqual([]);
		expect(toastTexts(store)).toEqual([`Removed ${FEATURE}`]);
		expect(store.getState().toasts[0]?.problem).toBeUndefined();
		// The dialog that is open now is another one, so it stays.
		expect(store.getState().dialog).toEqual({ kind: "settings" });
	});

	test("the Done dialog of the worktree closes when its removal works while it is open", async () => {
		const { store } = await startedStore();
		const { removal } = await startRemoval(store, SPIKE);
		store.openDialog({ kind: "done-worktree", repository: TIMBER, worktree: sample(FEATURE).id });
		await removal;
		// A dialog for another worktree stays.
		expect(store.getState().dialog).toEqual({ kind: "done-worktree", repository: TIMBER, worktree: sample(FEATURE).id });

		store.closeDialog();
		store.openDialog({ kind: "done-worktree", repository: TIMBER, worktree: sample(PORTABILITY).id });
		const second = await startRemoval(store, PORTABILITY);
		expect(await second.removal).toEqual({ outcome: "removed" });
		expect(store.getState().dialog).toBeNull();
	});

	test("the Done dialog that stays open shows the removal running, with Close", async () => {
		const { store } = await startedStore();
		store.openDialog({ kind: "done-worktree", repository: TIMBER, worktree: sample(FEATURE).id });
		const { removal } = await startRemoval(store, FEATURE);
		const markup = app(store);
		expect(markup).toContain('<p class="dialog-progress-text" role="status">Removing feat/github-issue-lookup. Closing this dialog does not stop it');
		expect(markup).toContain('<button type="button" class="button quiet" autofocus="">Close</button>');
		expect(markup).toContain('<button type="button" class="button danger" disabled="">Running</button>');
		await removal;
		expect(app(store)).not.toContain("<dialog");
	});

	test("two worktrees are removed at once, and the same worktree is never removed twice", async () => {
		const { store, applied } = await startedStore();
		const feature = await startRemoval(store, FEATURE);
		const spike = await startRemoval(store, SPIKE);
		expect(store.getState().removals.map(removal => [removal.worktree.path, removal.status.kind])).toEqual([[FEATURE, "running"], [SPIKE, "running"]]);

		// A second Remove of a worktree that is being removed runs nothing.
		const preview = await store.previewDone({ repository: TIMBER, path: FEATURE, options: DEFAULT_DONE_OPTIONS });
		const again = await store.removeWorktree({ repository: TIMBER, worktree: sample(FEATURE), preview: preview.outcome === "previewed" ? preview.id : "", toast: "again" });
		expect(again).toBeNull();

		expect(await Promise.all([feature.removal, spike.removal])).toEqual([{ outcome: "removed" }, { outcome: "removed" }]);
		expect(applied).toEqual([FEATURE, SPIKE]);
		expect(listed(store, FEATURE)).toBeNull();
		expect(listed(store, SPIKE)).toBeNull();
		expect(toastTexts(store)).toEqual([`Removed ${FEATURE}`, `Removed ${SPIKE}`]);
	});

	test("the row keeps saying so when the worktree's identity changes while its folder is deleted", async () => {
		const { store, engine } = await startedStore();
		const { removal } = await startRemoval(store, FEATURE);
		// The folder cannot be verified for a moment, so the list reads it with its registered identity.
		engine.setRepositories(sampleRepositories.map(repository => ({
			...repository,
			worktrees: repository.worktrees.map(worktree => worktree.path === FEATURE ? { ...worktree, id: `registered ${FEATURE}`, canonicalPath: null } : worktree),
		})));
		await store.refresh();
		expect(listed(store, FEATURE)?.id).toBe(`registered ${FEATURE}`);
		store.select(`registered ${FEATURE}`);
		const markup = app(store);
		expect(markup).toContain(">removing</span>");
		expect(markup).toContain(`<button type="button" class="button" disabled="" title="${BEING_REMOVED_REASON}">Done</button>`);
		store.openDialog({ kind: "done-worktree", repository: TIMBER, worktree: `registered ${FEATURE}` });
		expect(store.getState().dialog).toBeNull();
		await removal;
	});
});

describe("a removal that failed while its dialog was closed", () => {
	test("a change between preview and Remove: the row says so, a toast points there, and the dialog shows the details", async () => {
		const { store, engine } = await startedStore();
		const { removal } = await startRemoval(store, FEATURE);
		engine.setChanges(FEATURE, { untracked: ["late.txt"] });
		const result = await removal;
		expect(result).toMatchObject({ outcome: "failed", ran: true });

		expect(listed(store, FEATURE)).not.toBeNull();
		expect(store.getState().removals).toMatchObject([{ worktree: { path: FEATURE }, status: { kind: "failed", gone: false, failure: { diagnostic: "Worktree, files, settings or repository changed. Review the updated preview before removing." } } }]);
		expect(store.getState().toasts).toMatchObject([{ text: describeRemovalFailed("feat/github-issue-lookup", true), problem: true }]);
		expect(describeRemovalFailed("feat/github-issue-lookup", true)).toBe("Timber did not finish removing feat/github-issue-lookup. The sidebar shows what it said.");

		const markup = app(store);
		expect(markup).toContain('<span class="row-flag failing" title="Timber did not finish removing this worktree. Details shows what it said." aria-hidden="true">removal failed</span>');
		expect(markup).toContain('class="text-button row-removal-details" aria-haspopup="dialog" aria-label="Details: Timber did not finish removing feat/github-issue-lookup." title="What Timber said when it did not finish removing feat/github-issue-lookup">Details</button>');
		expect(markup).toContain('<div class="toast problem">');

		// Details opens the Done dialog with Timber's diagnostic and the command's output.
		store.openDialog({ kind: "done-worktree", repository: TIMBER, worktree: sample(FEATURE).id });
		const dialog = app(store);
		expect(dialog).toContain('<p class="failure-title">Timber did not finish removing feat/github-issue-lookup</p>');
		expect(dialog).toContain("Worktree, files, settings or repository changed.");
		expect(dialog).toContain("The list was read again and shows the real state.");

		// Closing the dialog puts the failure away.
		store.dismissRemoval(TIMBER, FEATURE);
		store.closeDialog();
		expect(store.getState().removals).toEqual([]);
		expect(app(store)).not.toContain("removal failed");
	});

	test("a failure or a removal whose row is hidden by a collapsed group shows in the group", async () => {
		const { store, engine } = await startedStore();
		const feature = await startRemoval(store, FEATURE);
		const spike = await startRemoval(store, SPIKE);
		store.toggleGroup(TIMBER);
		expect(app(store)).toContain(`<p class="sidebar-note removal-running" title="${FEATURE}">Removing feat/github-issue-lookup</p>`);
		engine.setChanges(FEATURE, { untracked: ["late.txt"] });
		await Promise.all([feature.removal, spike.removal]);
		const markup = app(store);
		expect(markup).toContain(`<p class="sidebar-error-title">${describeRemovalFailed("feat/github-issue-lookup", false)}</p>`);
		expect(markup).not.toContain("The worktree is no longer in the list.");
		expect(markup).not.toContain("removal-running");
		// Opened from there, the dialog is for the worktree as it is listed now.
		expect(markup).toContain(`aria-label="Details: ${describeRemovalFailed("feat/github-issue-lookup", false)}"`);
		// With the group open the row says it instead.
		store.toggleGroup(TIMBER);
		expect(app(store)).not.toContain("removal-failure");
		expect(app(store)).toContain(">removal failed</span>");
	});

	test("a removal that is tried again after a failure, and works, leaves no failure behind", async () => {
		const { store, engine } = await startedStore();
		const first = await startRemoval(store, FEATURE);
		engine.setChanges(FEATURE, { untracked: ["late.txt"] });
		await first.removal;
		const second = await startRemoval(store, FEATURE);
		expect(store.getState().removals).toMatchObject([{ status: { kind: "running" } }]);
		expect(await second.removal).toEqual({ outcome: "removed" });
		expect(store.getState().removals).toEqual([]);
	});

	test("no toast while the Done dialog of the worktree is open: the dialog shows the failure itself", async () => {
		const { store, engine } = await startedStore();
		// The dialog stays open from Remove on.
		store.openDialog({ kind: "done-worktree", repository: TIMBER, worktree: sample(FEATURE).id });
		const { removal } = await startRemoval(store, FEATURE);
		engine.setChanges(FEATURE, { untracked: ["late.txt"] });
		await removal;
		expect(store.getState().toasts).toEqual([]);
		expect(store.getState().removals).toMatchObject([{ status: { kind: "failed" } }]);
		expect(store.getState().dialog?.kind).toBe("done-worktree");
	});

	test("a partial failure: the worktree left the list, the failure stays in its repository, and the details are reachable", async () => {
		const { store, engine } = await startedStore();
		engine.failBranchDeletion(true);
		// A session runs in the worktree. Its folder is gone after the partial failure, so the reload ends it with a toast of its own.
		await store.openTerminal({ repository: TIMBER, worktree: SPIKE, cols: 80, rows: 24 });
		const { removal } = await startRemoval(store, SPIKE);
		const result = await removal;
		expect(result?.outcome === "failed" && result.failure.diagnostic).toContain("but local branch spike/new-idea was not deleted");
		expect(listed(store, SPIKE)).toBeNull();
		expect(store.getState().removals).toMatchObject([{ worktree: { path: SPIKE, id: sample(SPIKE).id }, status: { kind: "failed", gone: true } }]);
		expect(store.getState().toasts.filter(toast => toast.problem)).toMatchObject([{ text: describeRemovalFailed("spike/new-idea", true) }]);
		expect(store.getState().toasts).toHaveLength(2);

		// Shown whatever the filter, and with the group collapsed.
		store.toggleGroup(TIMBER);
		const markup = app(store);
		expect(markup).toContain('class="sidebar-error group-failure removal-failure"');
		expect(markup).toContain("The worktree is no longer in the list.");
		expect(markup).toContain(`<p class="sidebar-error-title">${describeRemovalFailed("spike/new-idea", false)}</p>`);
		expect(markup).toContain(`<p class="sidebar-error-text path">${SPIKE}</p>`);
		store.toggleGroup(TIMBER);

		// Details opens the dialog for a worktree that is no longer listed, named as the record has it.
		store.openDialog({ kind: "done-worktree", repository: TIMBER, worktree: sample(SPIKE).id });
		const dialog = app(store);
		expect(dialog).toContain("<dialog");
		expect(dialog).toContain('class="dialog-title">spike/new-idea is no longer in the list</h2>');
		expect(dialog).toContain("but local branch spike/new-idea was not deleted");
		expect(dialog).toContain(">Close</button>");
		expect(dialog).not.toContain("This worktree left the list while the dialog was open");

		store.dismissRemoval(TIMBER, SPIKE);
		store.closeDialog();
		expect(app(store)).not.toContain("removal-failure");
	});
});

describe("which removals are kept", () => {
	const failed = (repository: string, path: string, gone: boolean): Removal => ({
		repository,
		worktree: sample(path),
		toast: "",
		status: { kind: "failed", failure: { command: null, diagnostic: "no", output: null }, gone },
	});

	test("a failure goes with its repository, and a gone one goes when a worktree is listed at its path again", () => {
		const running: Removal = { ...failed("/work/elsewhere", SPIKE, false), status: { kind: "running" } };
		const removals = [failed(TIMBER, FEATURE, false), failed(TIMBER, SPIKE, true), failed("/work/elsewhere", PORTABILITY, false), running];
		expect(reconcileRemovals(sampleRepositories, removals)).toEqual([removals[0]!, removals[3]!]);
		const withoutSpike = sampleRepositories.map(repository => ({ ...repository, worktrees: repository.worktrees.filter(worktree => worktree.path !== SPIKE) }));
		expect(reconcileRemovals(withoutSpike, removals)).toEqual([removals[0]!, removals[1]!, removals[3]!]);
		// A failure whose worktree left the list is kept as gone.
		const withoutFeature = sampleRepositories.map(repository => ({ ...repository, worktrees: repository.worktrees.filter(worktree => worktree.path !== FEATURE) }));
		expect(reconcileRemovals(withoutFeature, [removals[0]!])).toEqual([{ ...removals[0]!, status: { ...removals[0]!.status, gone: true } as Removal["status"] }]);
		// Nothing changed, so the same list comes back.
		const kept = [removals[0]!];
		expect(reconcileRemovals(sampleRepositories, kept)).toBe(kept);
	});

	test("a removal whose repository leaves the app's list while it runs keeps no failure, and the toast points nowhere", async () => {
		const { store, engine } = await startedStore();
		const { removal } = await startRemoval(store, FEATURE);
		engine.setChanges(FEATURE, { untracked: ["late.txt"] });
		await store.removeRepository(TIMBER);
		await removal;
		expect(store.getState().removals).toEqual([]);
		expect(store.getState().toasts.filter(toast => toast.problem)).toMatchObject([{ text: describeRemovalFailed("feat/github-issue-lookup", false) }]);
	});

	test("a failure whose repository leaves the app's list goes with it", async () => {
		const { store, engine } = await startedStore();
		const { removal } = await startRemoval(store, FEATURE);
		engine.setChanges(FEATURE, { untracked: ["late.txt"] });
		await removal;
		expect(store.getState().removals).toHaveLength(1);
		await store.removeRepository(TIMBER);
		expect(store.getState().removals).toEqual([]);
	});

	test("the row's markers say a removal runs or failed, first among its states", () => {
		const worktree = sample(FEATURE);
		expect(describeRowMarkers(worktree, null, { kind: "running" }).filter(marker => marker.place === "state").map(marker => marker.kind)).toEqual(["removing"]);
		const failed = describeRowMarkers({ ...worktree, branch: null }, null, { kind: "failed", failure: { command: null, diagnostic: "no", output: null }, gone: false });
		expect(failed.filter(marker => marker.place === "state").map(marker => marker.kind)).toEqual(["removal-failed", "detached"]);
		expect(failed[0]).toMatchObject({ text: "removal failed" });
		expect(describeRowMarkers(worktree).some(marker => marker.kind === "removing" || marker.kind === "removal-failed")).toBe(false);
	});
});

describe("the Done session of a dialog that closed", () => {
	/** A preview for the default options, as recorded from Timber, that has not expired. */
	const fresh = (): DonePreview => {
		const reading = readDonePreview(recordedDone.previews.clean);
		if (!reading.ok) throw new Error(reading.message);
		return { ...reading.preview, expiresAt: Date.now() + 600_000 };
	};

	test("asks for no new preview when the removal fails after it stopped, and starts again when asked", async () => {
		const previews: string[] = [];
		let finish!: (result: DoneApplyResult) => void;
		const session = createDoneSession({
			repository: TIMBER,
			path: FEATURE,
			async preview() {
				previews.push(FEATURE);
				return { outcome: "previewed", id: `p${previews.length}`, preview: fresh() };
			},
			apply: () => new Promise(resolve => {
				finish = resolve;
			}),
			listed: () => true,
		});
		session.start();
		await settle();
		const removing = session.remove();
		session.stop();
		finish({ outcome: "failed", ran: true, failure: { command: null, diagnostic: "no", output: null } });
		await removing;
		await settle();
		expect(previews).toHaveLength(1);
		expect(session.getState().attempted).toBe(true);

		// A dialog that shows again starts the session again, and a later failure asks again.
		session.start();
		await settle();
		expect(previews).toHaveLength(2);
	});

	test("a removal that was not run leaves the preview on screen and nothing attempted", async () => {
		const session = createDoneSession({
			repository: TIMBER,
			path: FEATURE,
			preview: async () => ({ outcome: "previewed", id: "p", preview: fresh() }),
			apply: async () => null,
			listed: () => true,
			attempted: false,
		});
		session.start();
		await settle();
		expect(await session.remove()).toBeNull();
		expect(session.getState()).toMatchObject({ attempted: false, preview: { kind: "ready", id: "p" } });
		session.stop();
	});

	test("a session for a removal that failed earlier starts as attempted", () => {
		const session = createDoneSession({ repository: TIMBER, path: FEATURE, preview: () => new Promise(() => {}), apply: async () => null, listed: () => true, attempted: true });
		expect(session.getState().attempted).toBe(true);
	});
});
