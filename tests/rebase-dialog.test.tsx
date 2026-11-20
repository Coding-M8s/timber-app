import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { RebaseDialogView, type RebaseDialogViewProps, rebaseResultCommandFor } from "../src/mainview/components/RebaseDialog";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { REBASE_DIRTY_NOTE } from "../src/mainview/rebase-format";
import { createAppStore } from "../src/mainview/store/store";
import type { Worktree } from "../src/shared/model";

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

describe("the Rebase dialog", () => {
	const props = (change: Partial<RebaseDialogViewProps> = {}): RebaseDialogViewProps => ({
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
		expect(render()).toContain(`timber rebase --result-file &lt;temporary file&gt; -- ${FEATURE}`);
		expect(rebaseResultCommandFor(FEATURE, "")).toBe(`timber rebase --result-file <temporary file> -- ${FEATURE}`);
		expect(rebaseResultCommandFor("/work/my repo", " origin/main ")).toBe("timber rebase --base origin/main --result-file <temporary file> -- '/work/my repo'");
		expect(render({ onto: "origin/main" })).toContain(`timber rebase --base origin/main --result-file &lt;temporary file&gt; -- ${FEATURE}`);
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

	test("before it runs, nothing in it says how a rebase went", () => {
		const markup = render().toLowerCase();
		for (const claim of ["succeeded", "success", "completed", "rebased onto"]) expect(markup).not.toContain(claim);
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
		expect(markup).toContain("Rebase</button>");
		expect(markup).toContain(`timber rebase --base origin/main --result-file &lt;temporary file&gt; -- ${FEATURE}`);
	});

	test("while Timber is not ready, no Rebase dialog shows, only the window's Timber notice", async () => {
		const { store } = await startedStore(createMockEngine(sampleRepositories, { state: "too-old", path: "/usr/bin/timber", found: "0.1.1", required: "0.1.3" }));
		store.openDialog({ kind: "rebase-worktree", repository: TIMBER, worktree: feature.id });
		await settle();
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain("0.1.1");
		expect(markup).not.toContain("timber rebase");
		expect(markup).not.toContain("Rebase</button>");
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
		expect(markup).toContain(`timber rebase --result-file &lt;temporary file&gt; -- ${FEATURE}`);
	});

	test("on a Timber that reports no base, the dialog says nothing about one and starts empty", () => {
		const markup = render({ worktree: { ...feature, base: null } });
		expect(markup).not.toContain("saved-base-warning");
		expect(markup).not.toContain("No saved base");
		expect(markup).not.toContain("as the base of this worktree");
		expect(markup).toContain(`timber rebase --result-file &lt;temporary file&gt; -- ${FEATURE}`);
	});
});
