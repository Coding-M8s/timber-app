import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { BASE_REFUSED_NOTE, BASE_REFUSED_TITLE, describeBaseAction, describeBaseDialogTitle, presentSetBase } from "../src/mainview/base-change-format";
import { describeRowTitle } from "../src/mainview/base-format";
import { SetBaseDialogView, setBaseCommandFor } from "../src/mainview/components/SetBaseDialog";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { actOutSetBase } from "../src/mainview/engine/mock-base";
import { MOCK_BRANCH_POINT } from "../src/mainview/engine/mock-file-changes";
import { createAppStore } from "../src/mainview/store/store";
import type { Engine } from "../src/shared/engine";
import { defaultLayout } from "../src/shared/layout";
import type { Worktree } from "../src/shared/model";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const MAIN = sampleRepositories[0]!.worktrees[0]!;
const FEATURE = sampleRepositories[0]!.worktrees[1]!;

async function started(engine: Engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return store;
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);
const escaped = (text: string) => text.replaceAll("&", "&amp;").replaceAll("'", "&#x27;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const worktreeIn = (store: ReturnType<typeof createAppStore>, id: string) => store.getState().repositories.find(repository => repository.path === TIMBER)!.worktrees.find(worktree => worktree.id === id)!;

/** The Changes tab of one sample worktree, read once. */
async function changesOf(id: string, engine: Engine = createMockEngine()) {
	const store = await started(engine);
	store.select(id);
	store.showSidePanel("changes");
	await store.readChanges(TIMBER, id);
	return store;
}

describe("the control beside Compare with", () => {
	test("says Set base with no saved base, or metadata Timber cannot use, and Change base with one", () => {
		expect(describeBaseAction({ kind: "unassigned" })).toBe("Set base…");
		expect(describeBaseAction({ kind: "invalid", reason: "stale" })).toBe("Set base…");
		expect(describeBaseAction(null)).toBe("Set base…");
		expect(describeBaseAction({ kind: "assigned", ref: "refs/remotes/origin/main" })).toBe("Change base…");
		expect(describeBaseAction({ kind: "commit", commit: "17c50618a548be6c58229800883ce5e0cc138b29" })).toBe("Change base…");
		expect(describeBaseDialogTitle("feat/x", { kind: "assigned", ref: "refs/heads/main" })).toBe("Change the base of feat/x");
		expect(describeBaseDialogTitle("feat/x", { kind: "unassigned" })).toBe("Set the base of feat/x");
	});

	test("is offered in the Changes tab with no saved base and with a usable one", async () => {
		expect(render(await changesOf(MAIN.id))).toContain(">Set base…</button>");
		expect(render(await changesOf(FEATURE.id))).toContain(">Change base…</button>");
	});

	test("is offered with a saved base Timber cannot use", async () => {
		const engine = createMockEngine();
		const store = await changesOf(FEATURE.id, engine);
		// The pretend list as Timber would list stale metadata for a worktree that had a usable base.
		const listed = store.getState().repositories.map(repository => ({
			...repository,
			worktrees: repository.worktrees.map(worktree => worktree.id === FEATURE.id ? { ...worktree, base: { kind: "invalid" as const, reason: "stale" as const } } : worktree),
		}));
		const markup = renderToStaticMarkup(<App store={{ ...store, getState: () => ({ ...store.getState(), repositories: listed }) }} />);
		expect(markup).toContain(">Set base…</button>");
		expect(markup).not.toContain(">Change base…</button>");
	});

	test("opens the dialog, filled with the saved base, and the exact command it runs", async () => {
		const store = await changesOf(FEATURE.id);
		store.openDialog({ kind: "set-base", repository: TIMBER, worktree: FEATURE.id });
		const markup = render(store);
		expect(markup).toContain("Change the base of feat/github-issue-lookup");
		expect(markup).toContain('value="origin/main"');
		expect(markup).toContain(escaped(`timber base --set origin/main --result-file <temporary file> -- ${FEATURE.path}`));
	});
});

describe("the command the dialog shows", () => {
	test("is the one that runs, with the spaces left off and a placeholder while empty", () => {
		expect(setBaseCommandFor("/work/a b", "  refs/heads/main ")).toBe("timber base --set refs/heads/main --result-file <temporary file> -- '/work/a b'");
		expect(setBaseCommandFor("/work/feat", "  ")).toBe("timber base --set <base> --result-file <temporary file> -- /work/feat");
	});
});

describe("a refusal in the dialog", () => {
	const view = (worktree: Worktree, base: string, failureKind: "refused" | null, failure: { command: string; diagnostic: string; output: null } | null) => renderToStaticMarkup(
		<SetBaseDialogView
			failureKind={failureKind}
			worktree={worktree}
			path={worktree.path}
			bases={[]}
			base={base}
			onBase={() => {}}
			submission={{ running: false, failure }}
			onSubmit={() => {}}
			onClose={() => {}}
		/>,
	);

	test("shows Timber's reason and keeps what was typed", () => {
		const failure = { command: setBaseCommandFor(FEATURE.path, "refs/heads/nope"), diagnostic: "Local base is missing or invalid; choose a replacement with --set refs/heads/<branch>.", output: null };
		const markup = view(FEATURE, "refs/heads/nope", "refused", failure);
		expect(markup).toContain(BASE_REFUSED_TITLE);
		expect(markup).toContain(BASE_REFUSED_NOTE);
		expect(markup).toContain(escaped(failure.diagnostic));
		expect(markup).toContain('value="refs/heads/nope"');
	});

	test("cannot be submitted with nothing typed", () => {
		expect(view(MAIN, "", null, null)).toMatch(/<button type="submit"[^>]*disabled=""/);
	});

	test("warns about metadata Timber cannot use, without saying Timber will refuse", () => {
		const markup = view({ ...MAIN, base: { kind: "invalid", reason: "stale" } }, "", null, null);
		expect(markup).toContain("Timber decides whether a base given here can replace it.");
	});
});

describe("presentSetBase", () => {
	test("a saved base closes with a toast naming it; the rest stay open", () => {
		expect(presentSetBase("feat/x", { outcome: "set", previous: { kind: "unassigned" }, current: { kind: "assigned", ref: "refs/remotes/origin/main" } }))
			.toEqual({ outcome: { ok: true, toast: "Saved origin/main as the base of feat/x" }, failureKind: null });
		expect(presentSetBase("feat/x", { outcome: "set", previous: { kind: "unassigned" }, current: { kind: "commit", commit: "17c50618a548be6c58229800883ce5e0cc138b29" } }).outcome)
			.toEqual({ ok: true, toast: "Saved 17c5061 as the base of feat/x" });
		const failure = { command: null, diagnostic: "no", output: null };
		expect(presentSetBase("feat/x", { outcome: "refused", failure }).failureKind).toBe("refused");
		expect(presentSetBase("feat/x", { outcome: "failed", ran: true, failure }).failureKind).toBe("failed");
		expect(presentSetBase("feat/x", { outcome: "failed", ran: false, failure }).failureKind).toBe("not-run");
	});
});

describe("the mock engine acts out timber base --set", () => {
	const repository = sampleRepositories[0]!;
	const branches = [{ selector: "main", kind: "local" as const }, { selector: "origin/main", kind: "remote" as const }];
	const act = (worktree: Worktree, base: string) => actOutSetBase(repository, worktree, { repository: repository.path, worktree: worktree.path, base }, branches);

	test("saves a listed branch as its canonical ref", () => {
		expect(act(MAIN, "origin/main")).toMatchObject({ result: { outcome: "set", current: { kind: "assigned", ref: "refs/remotes/origin/main" } }, saved: { base: { kind: "assigned", ref: "refs/remotes/origin/main" } } });
		expect(act(FEATURE, "refs/heads/main").result).toMatchObject({ outcome: "set", previous: { kind: "assigned", ref: "refs/remotes/origin/main" } });
	});

	test("refuses, as Timber does, a branch it does not have, the worktree's own branch, and malformed metadata, and replaces stale metadata", () => {
		expect(act(FEATURE, "refs/heads/nope")).toMatchObject({ result: { outcome: "refused" }, saved: null });
		expect(act(MAIN, "refs/heads/main")).toMatchObject({ result: { outcome: "refused", failure: { diagnostic: "Cannot use the worktree's own branch as its base; select another branch with --set." } } });
		expect(act({ ...FEATURE, base: { kind: "invalid", reason: "malformed" } }, "refs/heads/main").result.outcome).toBe("refused");
		expect(act({ ...FEATURE, base: { kind: "invalid", reason: "stale" } }, "refs/heads/main").result).toMatchObject({ outcome: "set", previous: { kind: "invalid", reason: "stale" } });
	});

	test("saves a full hash, in any case, as a commit base in lowercase", () => {
		expect(act(MAIN, "17C50618A548BE6C58229800883CE5E0CC138B29").result).toMatchObject({ outcome: "set", current: { kind: "commit", commit: "17c50618a548be6c58229800883ce5e0cc138b29" } });
	});

	test("reads a plain name as the one remote branch of that name, and refuses one no remote has, in Timber's words", () => {
		expect(act(MAIN, "main").result).toMatchObject({ outcome: "set", current: { kind: "assigned", ref: "refs/remotes/origin/main" } });
		expect(act(MAIN, "nope").result).toMatchObject({ outcome: "refused", failure: { diagnostic: "Remote base is missing or ambiguous; use --set <remote/branch>." } });
		expect(act(MAIN, "origin/nope").result.outcome).toBe("refused");
	});

	test("runs only for a listed worktree whose folder is there", async () => {
		const engine = createMockEngine();
		expect(await engine.setWorktreeBase({ repository: TIMBER, worktree: "/work/elsewhere", base: "origin/main" })).toMatchObject({ outcome: "failed", ran: false });
		const missing = { ...sampleRepositories[0]!, worktrees: sampleRepositories[0]!.worktrees.map(worktree => worktree.id === FEATURE.id ? { ...worktree, pathExists: false } : worktree) };
		const gone = createMockEngine([missing]);
		const result = await gone.setWorktreeBase({ repository: TIMBER, worktree: FEATURE.path, base: "origin/main" });
		expect(result).toMatchObject({ outcome: "failed", ran: false });
		if (result.outcome === "failed") expect(result.failure.diagnostic).toContain("is missing");
	});
});

describe("the store's setWorktreeBase", () => {
	test("with no saved base: the tab moves to Base, and the Changes header, the workspace header, and the row tooltip name the new base", async () => {
		const engine = createMockEngine();
		await engine.saveLayout({ ...defaultLayout(), uncommittedChanges: [MAIN.id] });
		const store = await changesOf(MAIN.id, engine);
		expect(store.getState().changes?.compared).toBe("uncommitted");

		const result = await store.setWorktreeBase({ repository: TIMBER, worktree: MAIN.path, base: "origin/main" });
		expect(result.outcome).toBe("set");
		expect(store.getState().changes).toMatchObject({ compared: "base", base: { usable: true, name: "origin/main", commit: MOCK_BRANCH_POINT } });
		expect(store.getState().layout.uncommittedChanges).toEqual([]);
		const markup = render(store);
		expect(markup).toContain(`origin/main @ ${MOCK_BRANCH_POINT.slice(0, 7)}`);
		expect(markup).toContain(">Base origin/main</span>");
		expect(markup).toContain(">Change base…</button>");
		expect(describeRowTitle(worktreeIn(store, MAIN.id))).toBe(`${MAIN.path} (Base origin/main)`);
	});

	test("over a saved base already compared with: the list is read again with the new one", async () => {
		const store = await changesOf(FEATURE.id);
		expect(store.getState().changes).toMatchObject({ compared: "base", base: { name: "origin/main" } });
		await store.setWorktreeBase({ repository: TIMBER, worktree: FEATURE.path, base: "refs/heads/main" });
		expect(store.getState().changes).toMatchObject({ compared: "base", base: { usable: true, ref: "refs/heads/main", name: "main" } });
		expect(render(store)).toContain(`main @ ${MOCK_BRANCH_POINT.slice(0, 7)}`);
	});

	test("to a commit: the workspace header and the row tooltip name it by its short hash", async () => {
		const store = await changesOf(MAIN.id);
		const result = await store.setWorktreeBase({ repository: TIMBER, worktree: MAIN.path, base: "17c50618a548be6c58229800883ce5e0cc138b29" });
		expect(result.outcome).toBe("set");
		expect(render(store)).toContain(">Base 17c5061</span>");
		expect(describeRowTitle(worktreeIn(store, MAIN.id))).toBe(`${MAIN.path} (Base 17c5061)`);
		expect(store.getState().changes?.compared).toBe("base");
	});

	test("a refusal changes nothing, and the list is still read again", async () => {
		const engine = createMockEngine();
		await engine.saveLayout({ ...defaultLayout(), uncommittedChanges: [MAIN.id] });
		const store = await changesOf(MAIN.id, engine);
		const result = await store.setWorktreeBase({ repository: TIMBER, worktree: MAIN.path, base: "refs/heads/nope" });
		expect(result.outcome).toBe("refused");
		expect(worktreeIn(store, MAIN.id).base).toEqual({ kind: "unassigned" });
		expect(store.getState().layout.uncommittedChanges).toEqual([MAIN.id]);
	});

	test("with the Changes tab on another worktree: that worktree's choice moves to Base, and the shown list is left alone", async () => {
		const engine = createMockEngine();
		await engine.saveLayout({ ...defaultLayout(), uncommittedChanges: [MAIN.id] });
		const store = await changesOf(FEATURE.id, engine);
		const shown = store.getState().changes;
		await store.setWorktreeBase({ repository: TIMBER, worktree: MAIN.path, base: "origin/main" });
		expect(store.getState().layout.uncommittedChanges).toEqual([]);
		expect(store.getState().changes).toBe(shown);
	});

	/** A store on MAIN's Changes tab, remembered as Uncommitted, whose engine saves the base and then loses the answer. */
	async function lostAnswer(saves: boolean) {
		const engine = createMockEngine();
		await engine.saveLayout({ ...defaultLayout(), uncommittedChanges: [MAIN.id] });
		return changesOf(MAIN.id, {
			...engine,
			setWorktreeBase: async request => {
				if (saves) await engine.setWorktreeBase(request);
				throw new Error("the bridge closed");
			},
		});
	}

	test("an answer that was lost, while the list read again shows a new ref or commit base: the tab moves to Base all the same", async () => {
		for (const base of ["origin/main", "17c50618a548be6c58229800883ce5e0cc138b29"]) {
			const store = await lostAnswer(true);
			const result = await store.setWorktreeBase({ repository: TIMBER, worktree: MAIN.path, base });
			expect(result).toMatchObject({ outcome: "failed", ran: true });
			expect(store.getState().changes?.compared).toBe("base");
			expect(store.getState().layout.uncommittedChanges).toEqual([]);
		}
	});

	test("an answer that was lost, with the base unchanged in the list read again: the tab stays", async () => {
		const store = await lostAnswer(false);
		await store.setWorktreeBase({ repository: TIMBER, worktree: MAIN.path, base: "origin/main" });
		expect(store.getState().changes?.compared).toBe("uncommitted");
		expect(store.getState().layout.uncommittedChanges).toEqual([MAIN.id]);
	});

	test("an engine that throws is a failure that ran, and the repository is read again", async () => {
		const engine = createMockEngine();
		let loads = 0;
		const store = await started({
			...engine,
			loadRepository: path => {
				loads += 1;
				return engine.loadRepository(path);
			},
			setWorktreeBase: async () => {
				throw new Error("the bridge closed");
			},
		});
		const result = await store.setWorktreeBase({ repository: TIMBER, worktree: MAIN.path, base: "origin/main" });
		expect(result).toMatchObject({ outcome: "failed", ran: true });
		if (result.outcome === "failed") expect(result.failure.diagnostic).toContain("whether the base was saved is unknown");
		expect(loads).toBe(1);
	});
});
