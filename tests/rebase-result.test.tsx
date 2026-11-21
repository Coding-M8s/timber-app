import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { RebaseDialogView, type RebaseDialogViewProps, rebaseResultCommandFor } from "../src/mainview/components/RebaseDialog";
import { createMockEngine, sampleRepositories, sampleTimberStatuses } from "../src/mainview/engine/mock";
import { MOCK_CONFLICTS, type RebaseEnding } from "../src/mainview/engine/mock-rebase";
import { REBASE_ONTO_HINT, REBASE_REPORTS_RESULT, describeConflictsAdvice, presentRebase } from "../src/mainview/rebase-format";
import { sessionsOf } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import type { TimberStatus, Worktree } from "../src/shared/model";
import { type RebaseResult, readRebaseResult } from "../src/shared/timber-rebase";
import { type TimberRun, readTimberResult } from "../src/shared/timber-result";
import { recordedRebase } from "./support/timber";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const feature = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === FEATURE)!;
const clean: Worktree = { ...feature, changes: { kind: "known", modified: [], untracked: [] } };

/** The sample repositories, with the feature worktree clean: Timber refuses to rebase one that has files to lose. */
function cleanSamples() {
	const copy = structuredClone(sampleRepositories);
	for (const worktree of copy[0]!.worktrees) if (worktree.path === FEATURE) worktree.changes = { kind: "known", modified: [], untracked: [] };
	return copy;
}
const cleanEngine = (timber: TimberStatus = sampleTimberStatuses.ready) => createMockEngine(cleanSamples(), timber);

async function startedStore(engine = cleanEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	store.select(feature.id);
	return { store, engine };
}

const request = (onto: string | null = "refs/heads/main") => ({ repository: TIMBER, worktree: FEATURE, onto });

/** One recorded record, read as the main process reads it, for the worktree it names. */
function recorded(text: string, exitCode: number): RebaseResult {
	const run: TimberRun = { command: "timber rebase", result: readTimberResult("rebase", text, exitCode), output: { text: "printed\n", truncated: false } };
	return readRebaseResult(run, JSON.parse(text).worktree.path);
}

describe("how the dialog shows each recorded outcome", () => {
	const shown = (text: string, exitCode: number) => presentRebase("feat", recorded(text, exitCode));

	test("rebased and up to date close the dialog with distinct toasts that name the base", () => {
		expect(shown(recordedRebase.rebased, 0).outcome).toEqual({ ok: true, toast: "Rebased feat onto main" });
		expect(shown(recordedRebase.upToDate, 0).outcome).toEqual({ ok: true, toast: "feat is already up to date with main" });
	});

	test("a remote base is named as a person says it", () => {
		const text = JSON.stringify({ ...JSON.parse(recordedRebase.rebased), rebase: { ...JSON.parse(recordedRebase.rebased).rebase, base: "refs/remotes/origin/main" } });
		expect(shown(text, 0).outcome).toEqual({ ok: true, toast: "Rebased feat onto origin/main" });
	});

	test("a commit base, which Timber reports by its full hash, is named by its first seven characters", () => {
		const text = JSON.stringify({ ...JSON.parse(recordedRebase.rebased), rebase: { ...JSON.parse(recordedRebase.rebased).rebase, base: "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432" } });
		expect(shown(text, 0).outcome).toEqual({ ok: true, toast: "Rebased feat onto 9f8e7d6" });
		expect(describeConflictsAdvice("9f8e7d6c5b4a39281706f5e4d3c2b1a098765432")).toContain("rebase onto 9f8e7d6,");
	});

	test("conflicts switch to the conflicts view and keep Timber's failure for the details", () => {
		const result = shown(recordedRebase.conflicts, 1);
		expect(result.conflicts).toMatchObject({ outcome: "conflicts", conflicts: ["a.txt", "my file.txt"] });
		expect(result.outcome).toMatchObject({ ok: false, failure: { output: { text: "printed\n" } } });
		expect(result.failureKind).toBeNull();
	});

	test("a refusal stays open with Timber's reason, and says nothing changed", () => {
		const result = shown(recordedRebase.refused, 1);
		expect(result.failureKind).toBe("refused");
		expect(result.outcome).toMatchObject({ ok: false });
		expect(result.outcome.ok === false && result.outcome.failure.diagnostic).toContain("clean index/worktree");
	});

	test("a failure stays open, and a run that never started has words of its own", () => {
		expect(shown(recordedRebase.failedHook, 1).failureKind).toBe("failed");
		const notRun: RebaseResult = { outcome: "failed", ran: false, failure: { command: null, diagnostic: "Nothing was run.", output: null } };
		expect(presentRebase("feat", notRun).failureKind).toBe("not-run");
	});
});

describe("the store's rebaseWorktree", () => {
	function listsAfter(engine: ReturnType<typeof createMockEngine>) {
		const reads: string[] = [];
		const load = engine.loadRepository.bind(engine);
		engine.loadRepository = path => {
			reads.push(path);
			return load(path);
		};
		return reads;
	}

	for (const ending of ["rebased", "up-to-date", "conflicts", "refused", "failed", "no-result"] as const satisfies RebaseEnding[]) {
		test(`asks the engine once and reads the repository again after "${ending}"`, async () => {
			const engine = cleanEngine();
			engine.endRebaseResults(ending);
			const { store } = await startedStore(engine);
			const reads = listsAfter(engine);
			let asked = 0;
			const rebase = engine.rebaseWorktree.bind(engine);
			engine.rebaseWorktree = given => {
				asked += 1;
				return rebase(given);
			};
			const result = await store.rebaseWorktree({ ...request(), worktree: FEATURE });
			expect(asked).toBe(1);
			expect(reads).toEqual([TIMBER]);
			expect(result.outcome).toBe(ending === "no-result" ? "failed" : ending);
		});
	}

	test("an engine that throws is a failure that says what it did is unknown, and the repository is read again", async () => {
		const engine = cleanEngine();
		const { store } = await startedStore(engine);
		const reads = listsAfter(engine);
		engine.rebaseWorktree = async () => {
			throw new Error("bridge closed");
		};
		const result = await store.rebaseWorktree(request());
		expect(result).toMatchObject({ outcome: "failed", ran: true });
		if (result.outcome !== "failed") throw new Error("unreachable");
		expect(result.failure.diagnostic).toContain("did not hear how the rebase ended");
		expect(result.failure.diagnostic).toContain("so what it did is unknown");
		expect(reads).toEqual([TIMBER]);
	});

	test("openTerminalIn starts a plain shell in the worktree and shows it", async () => {
		const { store } = await startedStore();
		store.showTab("changes");
		store.openTerminalIn(TIMBER, FEATURE);
		await settle();
		const [session] = sessionsOf(store.getState(), feature.id);
		expect(session).toMatchObject({ kind: "terminal", path: FEATURE });
		expect(store.getState().tab).toBe("workspace");
		expect(store.getState().shownSessions[feature.id]).toBe(session!.id);
	});

	test("openTerminalIn for a worktree that is not listed starts nothing", async () => {
		const { store } = await startedStore();
		store.openTerminalIn(TIMBER, "/work/nowhere");
		await settle();
		expect(store.getState().terminals).toEqual([]);
	});
});

describe("the mock engine's rebase endings", () => {
	async function ended(ending: RebaseEnding, worktree = FEATURE, engine = cleanEngine()) {
		engine.endRebaseResults(ending);
		return engine.rebaseWorktree({ repository: TIMBER, worktree, onto: "origin/main" });
	}

	test("each ending is the outcome it names, with the command the dialog shows", async () => {
		expect(await ended("rebased")).toMatchObject({ outcome: "rebased", base: "refs/remotes/origin/main" });
		expect(await ended("up-to-date")).toMatchObject({ outcome: "up-to-date" });
		expect(await ended("conflicts")).toMatchObject({ outcome: "conflicts", conflicts: MOCK_CONFLICTS });
		expect(await ended("failed")).toMatchObject({ outcome: "failed", ran: true });
		const noResult = await ended("no-result");
		expect(noResult).toMatchObject({ outcome: "failed", ran: true });
		const command = noResult.outcome === "failed" ? noResult.failure.command : null;
		expect(command).toBe(`timber rebase --base origin/main --result-file <temporary file> -- ${FEATURE}`);
		expect(command).toBe(rebaseResultCommandFor(FEATURE, "origin/main"));
	});

	test("a full commit hash as Onto is reported back as that commit, in lowercase, as Timber does", async () => {
		const engine = cleanEngine();
		engine.endRebaseResults("rebased");
		expect(await engine.rebaseWorktree({ repository: TIMBER, worktree: FEATURE, onto: "9F8E7D6C5B4A39281706F5E4D3C2B1A098765432" })).toMatchObject({ outcome: "rebased", base: "9f8e7d6c5b4a39281706f5e4d3c2b1a098765432" });
	});

	test("a worktree with modified or untracked files is refused whatever the ending", async () => {
		const dirty = sampleRepositories[0]!.worktrees.find(worktree => worktree.changes.kind === "known" && worktree.changes.modified.length > 0)!;
		for (const ending of ["rebased", "up-to-date", "conflicts", "failed"] as const) {
			const result = await ended(ending, dirty.path, createMockEngine());
			expect(result.outcome).toBe("refused");
			if (result.outcome === "refused") expect(result.failure.diagnostic).toContain("clean index/worktree");
		}
	});

	test("a worktree the list lacks, or a Timber that is not ready, runs nothing", async () => {
		expect(await ended("rebased", "/work/nowhere")).toMatchObject({ outcome: "failed", ran: false });
		const engine = cleanEngine(sampleTimberStatuses["too-old"]);
		expect(await engine.rebaseWorktree(request())).toMatchObject({ outcome: "failed", ran: false });
	});
});

describe("the Rebase dialog's outcomes", () => {
	const props = (change: Partial<RebaseDialogViewProps> = {}): RebaseDialogViewProps => ({
		worktree: clean,
		path: FEATURE,
		bases: [{ selector: "refs/heads/main", kind: "local" }],
		onto: "",
		onOnto: () => {},
		submission: { running: false, failure: null },
		onSubmit: () => {},
		onClose: () => {},
		...change,
	});
	const render = (change: Partial<RebaseDialogViewProps> = {}) => renderToStaticMarkup(<RebaseDialogView {...props(change)} />);
	const failure = { command: "timber rebase", diagnostic: "Timber says no.", output: null };

	test("the footer shows the exact command, with the result file named as a placeholder", () => {
		expect(render()).toContain(`timber rebase --result-file &lt;temporary file&gt; -- ${FEATURE}`);
		expect(render({ onto: " refs/heads/main " })).toContain(`timber rebase --base refs/heads/main --result-file &lt;temporary file&gt; -- ${FEATURE}`);
		expect(rebaseResultCommandFor("/work/my repo", "")).toBe("timber rebase --result-file <temporary file> -- '/work/my repo'");
	});

	test("it says Timber reports how the rebase ended, and keeps the Onto field and the notes", () => {
		const markup = render();
		expect(markup).toContain(">Rebase<");
		expect(markup).toContain("Rebasing");
		expect(markup).toContain(REBASE_REPORTS_RESULT.slice(0, 40));
		expect(markup).toContain(REBASE_ONTO_HINT.slice(0, 40));
		expect(markup).toContain("Onto");
	});

	test("a refusal is shown with Timber's reason, and says nothing was changed", () => {
		const markup = render({ failureKind: "refused", submission: { running: false, failure } });
		expect(markup).toContain("Timber refused the rebase");
		expect(markup).toContain("Timber says no.");
		expect(markup).toContain("Nothing was changed.");
	});

	test("a failure is shown with Timber's reason, and does not claim that nothing changed", () => {
		const markup = render({ failureKind: "failed", submission: { running: false, failure } });
		expect(markup).toContain("The rebase failed");
		expect(markup).toContain("Timber says no.");
		expect(markup).toContain("Check the branch and the worktree");
		expect(markup).not.toContain("Nothing was changed");
	});

	test("conflicts list every path, say the rebase was left as Git left it, and offer a terminal and Close", () => {
		const conflicts = recorded(recordedRebase.conflicts, 1);
		if (conflicts.outcome !== "conflicts") throw new Error("unreachable");
		const markup = render({ conflicts, onto: "refs/heads/main" });
		expect(markup).toContain("stopped on conflicts");
		for (const path of ["a.txt", "my file.txt"]) expect(markup).toContain(`<li>${path}</li>`);
		expect(markup).toContain(describeConflictsAdvice("refs/heads/main").slice(0, 60));
		expect(markup).toContain("git rebase --continue");
		expect(markup).toContain("git rebase --abort");
		expect(markup).toContain("Open a terminal here");
		expect(markup).toContain(">Close<");
		expect(markup).toContain("Rebase paused with conflicts");
	});

	test("conflicts are titled by the branch that was rebased, not by the detached HEAD the list shows afterwards", () => {
		const conflicts = recorded(recordedRebase.conflicts, 1);
		if (conflicts.outcome !== "conflicts") throw new Error("unreachable");
		const markup = render({ conflicts, conflictsLabel: "feat/conflict" });
		expect(markup).toContain("Rebase of feat/conflict stopped on conflicts");
		expect(markup).toContain("<code>git rebase --continue</code>");
		expect(markup).toContain("<code>git rebase --abort</code>");
	});
});
