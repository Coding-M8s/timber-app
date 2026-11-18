import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { RebaseDialogView, type RebaseDialogViewProps, rebaseCommandFor } from "../src/mainview/components/RebaseDialog";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { REBASE_DIRTY_NOTE, describeRebaseStarted } from "../src/mainview/rebase-format";
import { sessionsOf } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import type { Worktree } from "../src/shared/model";
import { TIMBER_REBASE_SESSION_NAME } from "../src/shared/terminal";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const feature = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === FEATURE)!;

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	store.select(feature.id);
	return { store, engine };
}

const request = (onto: string | null = "origin/main") => ({ repository: TIMBER, worktree: FEATURE, onto, cols: 80, rows: 24 });

describe("rebasing from the store", () => {
	const sessions = (store: Awaited<ReturnType<typeof startedStore>>["store"]) => sessionsOf(store.getState(), feature.id);

	test("a rebase starts in a new Timber session in the worktree, shown in the Workspace tab, with the command it runs", async () => {
		const { store } = await startedStore();
		store.showTab("changes");
		const result = await store.startRebase(request());
		if (result.outcome !== "started") throw new Error(JSON.stringify(result));
		const [session] = sessions(store);
		expect(session).toMatchObject({ kind: "timber", name: TIMBER_REBASE_SESSION_NAME, path: FEATURE });
		expect(session!.command).toContain(`rebase --base origin/main -- ${FEATURE}`);
		expect(store.getState().tab).toBe("workspace");
		expect(store.getState().shownSessions[feature.id]).toBe(session!.id);
	});

	test("the repositories are read again when the session's process ends, however it ended, and not before", async () => {
		const engine = createMockEngine();
		engine.endRebases(null);
		const { store } = await startedStore(engine);
		// Any Timber session that stops reads the whole list again (see `setupStopped` in the store).
		const reads: string[] = [];
		const list = engine.listRepositories.bind(engine);
		engine.listRepositories = () => {
			reads.push("list");
			return list();
		};
		const result = await store.startRebase(request(null));
		if (result.outcome !== "started") throw new Error(JSON.stringify(result));
		await settle();
		expect(reads).toEqual([]);
		engine.endTerminal(result.session.id, 1);
		await settle();
		expect(reads).toEqual(["list"]);
		expect(sessions(store)[0]?.state).toEqual({ kind: "exited", exitCode: 1, signal: null });
	});

	test("a worktree that has a terminal keeps it, and the rebase starts beside it", async () => {
		const { store } = await startedStore();
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24 });
		const result = await store.startRebase(request());
		expect(result.outcome).toBe("started");
		expect(sessions(store).map(session => session.kind)).toEqual(["terminal", "timber"]);
	});

	test("an engine that does not answer is reported as not known, never as not run", async () => {
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		engine.openTerminal = async () => {
			throw new Error("bridge closed");
		};
		const result = await store.startRebase(request());
		expect(result.outcome).toBe("unknown");
	});

	test("a refusal is passed on as not run, with Timber's or the app's reason", async () => {
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		const result = await store.startRebase({ ...request(), worktree: "/work/nowhere" });
		expect(result.outcome).toBe("not-run");
		if (result.outcome === "not-run") expect(result.message).toContain("The rebase was not started");
		expect(sessions(store)).toEqual([]);
	});
});

describe("the Rebase dialog", () => {
	const props = (change: Partial<RebaseDialogViewProps> = {}): RebaseDialogViewProps => ({
		structured: false,
		worktree: feature,
		path: FEATURE,
		bases: [{ selector: "refs/heads/main", kind: "local" }, { selector: "origin/main", kind: "remote" }],
		onto: "",
		onOnto: () => {},
		submission: { running: false, failure: null },
		onSubmit: () => {},
		onClose: () => {},
		...change,
	});
	const render = (change: Partial<RebaseDialogViewProps> = {}) => renderToStaticMarkup(<RebaseDialogView {...props(change)} />);

	test("the footer shows the exact command for what is typed, and nothing typed passes no base", () => {
		expect(render()).toContain(`timber rebase -- ${FEATURE}`);
		expect(rebaseCommandFor(FEATURE, "")).toBe(`timber rebase -- ${FEATURE}`);
		expect(rebaseCommandFor("/work/my repo", " origin/main ")).toBe("timber rebase --base origin/main -- '/work/my repo'");
		expect(render({ onto: "origin/main" })).toContain(`timber rebase --base origin/main -- ${FEATURE}`);
	});

	test("the picker offers local branches by full ref and remote branches by remote name", () => {
		const markup = render();
		expect(markup).toContain("refs/heads/main");
		expect(markup).toContain("origin/main");
		expect(markup).toContain("Onto");
	});

	test("files the list shows get Timber's refusal named beforehand, without blocking", () => {
		const dirty: Worktree = { ...feature, changes: { kind: "known", modified: ["a.ts"], untracked: [] } };
		const clean: Worktree = { ...feature, changes: { kind: "known", modified: [], untracked: [] } };
		expect(render({ worktree: dirty })).toContain(REBASE_DIRTY_NOTE.slice(0, 40));
		expect(render({ worktree: dirty })).not.toMatch(/<button type="submit" class="button primary" disabled="">/);
		expect(render({ worktree: clean })).not.toContain(REBASE_DIRTY_NOTE.slice(0, 40));
	});

	test("nothing in it says how a rebase went", () => {
		const markup = render().toLowerCase();
		for (const claim of ["succeeded", "success", "completed", "rebased onto"]) expect(markup).not.toContain(claim);
		expect(describeRebaseStarted("feat")).toBe("Started timber rebase in a new session in feat");
	});

	test("a worktree that left the list leaves only Close", () => {
		const markup = render({ worktree: null });
		expect(markup).toContain("no longer in the list");
		expect(markup).toContain(">Close<");
	});

	test("the workspace header opens it for the selected worktree", async () => {
		const { store } = await startedStore();
		expect(renderToStaticMarkup(<App store={store} />)).toContain(">Rebase<");
		store.openDialog({ kind: "rebase-worktree", repository: TIMBER, worktree: feature.id });
		await settle();
		const markup = renderToStaticMarkup(<App store={store} />);
		// The mock's Timber is new enough to report the result, so this is the dialog for a result file (see rebase-result.test.tsx).
		expect(markup).toContain("Rebase</button>");
		expect(markup).toContain(`timber rebase --base origin/main --result-file &lt;temporary file&gt; -- ${FEATURE}`);
	});

	test("with a Timber too old to report the result, the workspace header opens the interim dialog", async () => {
		const { store } = await startedStore(createMockEngine(sampleRepositories, { state: "ready", path: "/usr/bin/timber", version: "0.1.1" }));
		store.openDialog({ kind: "rebase-worktree", repository: TIMBER, worktree: feature.id });
		await settle();
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain("Rebase in terminal");
		// The sample worktree has origin/main saved, so the dialog starts from it.
		expect(feature.base).toEqual({ kind: "assigned", ref: "refs/remotes/origin/main" });
		expect(markup).toContain(`timber rebase --base origin/main -- ${FEATURE}`);
	});

	/** The dialog as the store opens it for one worktree of the sample repositories. */
	async function opened(path: string, repository = TIMBER) {
		const { store } = await startedStore();
		const worktree = store.getState().repositories.find(candidate => candidate.path === repository)!.worktrees.find(candidate => candidate.path === path)!;
		store.select(worktree.id);
		store.openDialog({ kind: "rebase-worktree", repository, worktree: worktree.id });
		await settle();
		return { worktree, markup: renderToStaticMarkup(<App store={store} />) };
	}
	const ontoValue = (markup: string) => /<input [^>]*role="combobox"[^>]*value="([^"]*)"/.exec(markup)?.[1];

	test("Onto starts as the saved base: a remote one by remote and branch, a local one by its full ref", async () => {
		const remote = await opened(FEATURE);
		expect(ontoValue(remote.markup)).toBe("origin/main");
		expect(remote.markup).toContain("Timber saved origin/main as the base of this worktree");

		const local = await opened("/work/timber-worktrees/spike-new-idea");
		expect(local.worktree.base).toEqual({ kind: "assigned", ref: "refs/heads/main" });
		expect(ontoValue(local.markup)).toBe("refs/heads/main");
		expect(local.markup).toContain("timber rebase --base refs/heads/main --result-file &lt;temporary file&gt; -- /work/timber-worktrees/spike-new-idea");
	});

	test("a worktree with no saved base says so, starts empty, and passes no base", async () => {
		const { worktree, markup } = await opened("/work/timber");
		expect(worktree.base).toEqual({ kind: "unassigned" });
		expect(ontoValue(markup)).toBe("");
		expect(markup).toContain("No saved base");
		expect(markup).toContain("timber rebase --result-file &lt;temporary file&gt; -- /work/timber<");
	});

	test("invalid metadata is a warning, and no base is filled in or guessed", () => {
		const markup = render({ worktree: { ...feature, base: { kind: "invalid", reason: "stale" } } });
		expect(markup).toMatch(/<p class="dialog-note saved-base-warning" role="note">Timber found a saved base for this worktree but cannot use it/);
		expect(markup).toContain(`timber rebase -- ${FEATURE}`);
	});

	test("on a Timber that reports no base, the dialog says nothing about one and starts empty", () => {
		const markup = render({ worktree: { ...feature, base: null } });
		expect(markup).not.toContain("saved-base-warning");
		expect(markup).not.toContain("No saved base");
		expect(markup).not.toContain("as the base of this worktree");
		expect(markup).toContain(`timber rebase -- ${FEATURE}`);
	});
});
