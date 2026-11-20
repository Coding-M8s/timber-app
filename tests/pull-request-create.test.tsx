import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { PullRequestFormView } from "../src/mainview/components/PullRequestPanel";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { actOutPullRequest, pullRequestEndings } from "../src/mainview/engine/mock-pr";
import { sampleAnswer } from "../src/mainview/engine/mock-pull-requests";
import { CREATE_RUNNING, CREATE_SUBMIT, defaultPullRequestTitle, presentPullRequestCreation, pullRequestCommandFor } from "../src/mainview/pull-request-create-format";
import type { PullRequestForm } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import type { Worktree } from "../src/shared/model";
import type { PullRequestList } from "../src/shared/pull-requests";
import type { CreatePullRequestRequest, CreatePullRequestResult } from "../src/shared/timber-pr";

const settle = async () => {
	for (let round = 0; round < 8; round++) await Bun.sleep(0);
};

const TIMBER = "/work/timber";
const PORTABILITY = "/work/timber-worktrees/fix-macos-portability";
const SPIKE = "/work/timber-worktrees/spike-new-idea";
const FAILURE = { command: "timber pr --title x --result-file <temporary file> -- /w", diagnostic: "Timber's reason.", output: { text: "error: Timber's reason.\n", truncated: false } };

describe("the words and the command", () => {
	test("the title starts as the last commit's subject, else the branch", () => {
		expect(defaultPullRequestTitle("Add login", "feat/login")).toBe("Add login");
		expect(defaultPullRequestTitle(null, "feat/login")).toBe("feat/login");
		expect(defaultPullRequestTitle(null, null)).toBe("");
	});

	test("the command follows every field, and empty ones pass nothing", () => {
		const fields = { title: "Add login", body: "", base: "", draft: false };
		expect(pullRequestCommandFor("/work/w", fields)).toBe("timber pr --title 'Add login' --result-file <temporary file> -- /work/w");
		expect(pullRequestCommandFor("/work/w", { ...fields, body: "Closes #3", base: " origin/main ", draft: true }))
			.toBe("timber pr --title 'Add login' --body 'Closes #3' --base origin/main --draft --result-file <temporary file> -- /work/w");
		expect(pullRequestCommandFor("/work/w", { ...fields, base: "   " })).not.toContain("--base");
	});

	test("created is a toast, and already open is a note that names it", () => {
		expect(presentPullRequestCreation({ outcome: "created", number: 7, url: "https://github.com/a/b/pull/7", base: "main", published: true }))
			.toEqual({ toast: "Pull request #7 opened", failure: null, reported: { outcome: "created", number: 7, url: "https://github.com/a/b/pull/7", note: null } });
		const exists = presentPullRequestCreation({ outcome: "exists", number: 5, url: "https://github.com/a/b/pull/5", base: "main", published: false });
		expect(exists.toast).toBeNull();
		expect(exists.reported?.note).toBe("A pull request from this branch into main was already open, so Timber opened no other: #5.");
	});

	test("refused says nothing was pushed, and a failure says what happened to the branch", () => {
		expect(presentPullRequestCreation({ outcome: "refused", failure: FAILURE }).failure).toEqual({ title: "Timber did not open the pull request", note: "Nothing was pushed, and no ref changed.", failure: FAILURE });
		const failed = (published: boolean | null, ran = true) => presentPullRequestCreation({ outcome: "failed", ran, published, failure: FAILURE }).failure!;
		expect(failed(true).note).toContain("Timber published the branch before this failed");
		expect(failed(false).note).toBe("This run pushed nothing.");
		expect(failed(null).note).toContain("What it did is unknown");
		expect(failed(false, false)).toEqual({ title: "The pull request was not opened", note: null, failure: FAILURE });
		// Never that nothing changed when the branch may have been published.
		expect(failed(true).note).not.toContain("Nothing was pushed");
		expect(failed(null).note).not.toContain("Nothing was pushed");
	});
});

const form = (change: Partial<PullRequestForm> = {}): PullRequestForm => ({
	repository: TIMBER, worktree: PORTABILITY, head: null, title: "Run on macOS", body: "", base: "origin/main", draft: false,
	titleEdited: false, running: false, failure: null, reported: null, ...change,
});
const formMarkup = (shown: PullRequestForm) => renderToStaticMarkup(<PullRequestFormView form={shown} afterIssue={false} onChange={() => {}} onSubmit={() => {}} />);

describe("PullRequestFormView", () => {
	test("title, description, base, and a draft switch, then the exact command", () => {
		const markup = formMarkup(form({ body: "Closes #3", draft: true }));
		expect(markup).toContain('name="title" value="Run on macOS"');
		expect(markup).toContain("<textarea");
		expect(markup).toContain('name="base" value="origin/main"');
		expect(markup).toContain('type="checkbox" role="switch" name="draft" checked=""');
		expect(markup).toContain(`timber pr --title &#x27;Run on macOS&#x27; --body &#x27;Closes #3&#x27; --base origin/main --draft --result-file &lt;temporary file&gt; -- ${PORTABILITY}`);
		expect(markup).toContain(`>${CREATE_SUBMIT}</button>`);
		expect(markup).not.toContain("progressbar");
	});

	test("while it runs: progress, every control disabled, and the button says so", () => {
		const markup = formMarkup(form({ running: true }));
		expect(markup).toContain('aria-busy="true"');
		expect(markup).toContain('<fieldset class="pull-create-fields" disabled="">');
		expect(markup).toContain('role="progressbar"');
		expect(markup).toContain(`<button type="submit" class="button primary" disabled="">${CREATE_RUNNING}</button>`);
	});

	test("a failure keeps Timber's diagnostic in the form, with its output in a details area that starts closed", () => {
		const markup = formMarkup(form({ failure: { title: "Timber did not open the pull request", note: "Nothing was pushed, and no ref changed.", failure: FAILURE } }));
		expect(markup).toContain('<p class="failure-title">Timber did not open the pull request</p>');
		expect(markup).toContain('<p class="failure-diagnostic">Timber&#x27;s reason.</p>');
		expect(markup).toContain('<details class="failure-details"><summary>Details</summary>');
		expect(markup).not.toContain("<details open");
		expect(markup).toContain("Nothing was pushed, and no ref changed.");
		// The fields stay for a retry.
		expect(markup).toContain('name="title" value="Run on macOS"');
	});
});

describe("the mock engine acts out timber pr", () => {
	const repository = sampleRepositories[0]!;
	const worktree = repository.worktrees.find(candidate => candidate.path === PORTABILITY)!;
	const ask = (change: Partial<CreatePullRequestRequest> = {}): CreatePullRequestRequest =>
		({ repository: TIMBER, worktree: PORTABILITY, title: "Run on macOS", body: "", base: null, draft: false, ...change });

	test("every ending reads back through the same reader as the main process", () => {
		const outcomes = Object.keys(pullRequestEndings).map(ending => actOutPullRequest(repository, worktree, ask(), ending as keyof typeof pullRequestEndings).result);
		expect(outcomes.map(result => result.outcome)).toEqual(["created", "exists", "refused", "failed", "failed", "failed"]);
		expect(outcomes.map(result => (result.outcome === "failed" ? result.published : null))).toEqual([null, null, null, false, true, null]);
		for (const result of outcomes) if ("failure" in result) expect(result.failure.command).toBe(`timber pr --title 'Run on macOS' --result-file <temporary file> -- ${PORTABILITY}`);
	});

	test("an empty title is refused whatever the ending, and a draft opens as a draft into the base typed", () => {
		expect(actOutPullRequest(repository, worktree, ask({ title: " " }), "created").result.outcome).toBe("refused");
		const acted = actOutPullRequest(repository, worktree, ask({ draft: true, base: "upstream/release/1.0", body: "Text" }), "created");
		expect(acted.opened).toMatchObject({ state: "draft", baseBranch: "release/1.0", description: "Text", title: "Run on macOS" });
	});
});

/** The sample answer for timber, with no pull request for the portability fix, so its tab offers the form. */
function withoutPortability(): PullRequestList {
	const answer = sampleAnswer(sampleRepositories[0]!);
	if (!answer.ok) throw new Error("sample");
	return { ok: true, worktrees: answer.worktrees.map(entry => entry.path === PORTABILITY ? { path: entry.path, branch: entry.branch, outcome: "none" } : entry) };
}

async function started(options: { delay?: number } = {}) {
	const engine = createMockEngine(sampleRepositories, undefined, { commandMilliseconds: options.delay ?? 0 });
	engine.setPullRequests(TIMBER, withoutPortability());
	const calls: CreatePullRequestRequest[] = [];
	const create = engine.createPullRequest.bind(engine);
	engine.createPullRequest = async request => {
		calls.push(request);
		return create(request);
	};
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	const worktreeAt = (path: string): Worktree => store.getState().repositories.flatMap(repository => repository.worktrees).find(candidate => candidate.path === path)!;
	const open = (path: string) => {
		const worktree = worktreeAt(path);
		store.select(worktree.id);
		store.showTab("pull-request");
		store.startPullRequestForm(TIMBER, worktree);
		return worktree.id;
	};
	const panel = () => {
		const markup = renderToStaticMarkup(<App store={store} />);
		return markup.slice(markup.indexOf('id="workspace-panel"'));
	};
	return { engine, store, calls, open, panel };
}

describe("the Pull request tab's form", () => {
	test("starts with the last commit's subject and the saved remote base, and the tab shows it", async () => {
		const { engine, store, open, panel } = await started();
		engine.setHeadSubject(PORTABILITY, "Use POSIX sed");
		const id = open(PORTABILITY);
		expect(store.getState().pullRequestForms[id]).toMatchObject({ title: "fix/macos-portability", base: "origin/main", body: "", draft: false });
		await settle();
		expect(store.getState().pullRequestForms[id]?.title).toBe("Use POSIX sed");
		expect(panel()).toContain('name="title" value="Use POSIX sed"');
		expect(panel()).toContain("timber pr --title &#x27;Use POSIX sed&#x27; --base origin/main --result-file");
	});

	test("a branch without a commit keeps the branch, a local saved base leaves Base empty, and a typed title is never replaced", async () => {
		const { engine, store, open } = await started();
		engine.setHeadSubject(SPIKE, null);
		const spike = open(SPIKE);
		await settle();
		expect(store.getState().pullRequestForms[spike]).toMatchObject({ title: "spike/new-idea", base: "" });

		engine.setHeadSubject(PORTABILITY, "From Git");
		const id = open(PORTABILITY);
		store.editPullRequestForm(id, { title: "Mine" });
		await settle();
		expect(store.getState().pullRequestForms[id]?.title).toBe("Mine");
	});

	test("created: one run with the fields as typed, a toast, and the tab shows the pull request", async () => {
		const { store, calls, open, panel } = await started();
		const id = open(PORTABILITY);
		await settle();
		store.editPullRequestForm(id, { title: "Run on macOS", body: "- one\n- two", base: " origin/main ", draft: true });
		await store.createPullRequest(id);
		expect(calls).toEqual([{ repository: TIMBER, worktree: PORTABILITY, title: "Run on macOS", body: "- one\n- two", base: "origin/main", draft: true }]);
		const { number } = store.getState().pullRequestForms[id]!.reported!;
		expect(store.getState().toasts.map(toast => toast.text)).toEqual([`Pull request #${number} opened`]);
		const shown = panel();
		expect(shown).toContain('<span class="pull-state draft">Draft</span>');
		expect(shown).toContain(">Run on macOS</h2>");
		expect(shown).not.toContain('name="title"');
	});

	test("while it runs, a second submit does nothing, and the fields cannot change", async () => {
		const { store, calls, open, panel } = await started({ delay: 20 });
		const id = open(PORTABILITY);
		await settle();
		const first = store.createPullRequest(id);
		expect(store.getState().pullRequestForms[id]?.running).toBe(true);
		expect(panel()).toContain('role="progressbar"');
		await store.createPullRequest(id);
		store.editPullRequestForm(id, { title: "Changed meanwhile" });
		await first;
		expect(calls.length).toBe(1);
		expect(calls[0]!.title).not.toBe("Changed meanwhile");
		expect(store.getState().pullRequestForms[id]?.running).toBe(false);
	});

	test("already open: says so above that pull request", async () => {
		const { engine, store, open, panel } = await started();
		engine.endPullRequestResults("exists");
		const id = open(PORTABILITY);
		await settle();
		await store.createPullRequest(id);
		const shown = panel();
		expect(shown).toContain("was already open, so Timber opened no other");
		expect(shown).toContain(">An earlier pull request for this branch</h2>");
		expect(store.getState().toasts).toEqual([]);
	});

	test("created before GitHub lists it: the tab names it with a link until the next read shows it", async () => {
		const { engine, store, open, panel } = await started();
		const id = open(PORTABILITY);
		await settle();
		// GitHub has not listed it yet: the answer keeps saying none.
		const result: CreatePullRequestResult = { outcome: "created", number: 9, url: "https://github.com/example/timber/pull/9", base: "main", published: true };
		engine.createPullRequest = async () => result;
		await store.createPullRequest(id);
		expect(panel()).toContain("Pull request #9 opened.</span> It shows here once GitHub lists it");
	});

	test("refused and failed keep the fields and Timber's diagnostic for a retry; editing puts the failure away", async () => {
		const { engine, store, open, panel } = await started();
		const id = open(PORTABILITY);
		await settle();
		engine.endPullRequestResults("refused");
		await store.createPullRequest(id);
		expect(store.getState().pullRequestForms[id]?.failure?.title).toBe("Timber did not open the pull request");
		expect(panel()).toContain("does not identify one github.com repository");
		expect(panel()).toContain('name="title"');
		store.editPullRequestForm(id, { body: "x" });
		expect(store.getState().pullRequestForms[id]?.failure).toBeNull();

		engine.endPullRequestResults("failed-after-push");
		await store.createPullRequest(id);
		expect(store.getState().pullRequestForms[id]?.failure?.note).toContain("published the branch");
		engine.endPullRequestResults("created");
		await store.createPullRequest(id);
		expect(store.getState().pullRequestForms[id]?.failure).toBeNull();
	});

	test("every run that ran reads the repository and its pull requests again, even a failure", async () => {
		const { engine, store, open } = await started();
		const id = open(PORTABILITY);
		await settle();
		engine.endPullRequestResults("no-result");
		const before = engine.pullRequestReads(TIMBER);
		await store.createPullRequest(id);
		expect(engine.pullRequestReads(TIMBER)).toBe(before + 1);
	});

	test("a new commit reads the title again unless one was typed, and a worktree that left the list forgets its form", async () => {
		const { engine, store, open } = await started();
		engine.setHeadSubject(PORTABILITY, "The base's last commit");
		const id = open(PORTABILITY);
		await settle();
		expect(store.getState().pullRequestForms[id]?.title).toBe("The base's last commit");

		// The person commits on the branch: the list is read again with a new head, and the tab starts the form again.
		const moved = (head: string) => sampleRepositories.map(repository => ({
			...repository,
			worktrees: repository.worktrees.map(worktree => worktree.path === PORTABILITY ? { ...worktree, head } : worktree),
		}));
		engine.setRepositories(moved("1111111111111111111111111111111111111111"));
		engine.setHeadSubject(PORTABILITY, "Use POSIX sed");
		await store.reloadRepository(TIMBER);
		open(PORTABILITY);
		await settle();
		expect(store.getState().pullRequestForms[id]?.title).toBe("Use POSIX sed");

		store.editPullRequestForm(id, { title: "Mine" });
		engine.setRepositories(moved("2222222222222222222222222222222222222222"));
		engine.setHeadSubject(PORTABILITY, "Another commit");
		await store.reloadRepository(TIMBER);
		open(PORTABILITY);
		await settle();
		expect(store.getState().pullRequestForms[id]?.title).toBe("Mine");

		engine.setRepositories(sampleRepositories.map(repository => ({ ...repository, worktrees: repository.worktrees.filter(worktree => worktree.path !== PORTABILITY) })));
		await store.reloadRepository(TIMBER);
		expect(store.getState().pullRequestForms[id]).toBeUndefined();
	});

	test("the note about what the run reported lasts until the next read of the pull requests", async () => {
		const { engine, store, open, panel } = await started();
		const id = open(PORTABILITY);
		await settle();
		// GitHub has not listed it: the tab names it, and once a later read still says none, the form is back.
		engine.createPullRequest = async () => ({ outcome: "created", number: 9, url: "https://github.com/example/timber/pull/9", base: "main", published: true });
		await store.createPullRequest(id);
		expect(store.getState().pullRequestForms[id]?.reported?.number).toBe(9);
		await store.fetchNow(TIMBER);
		await settle();
		expect(store.getState().pullRequestForms[id]?.reported).toBeNull();
		expect(panel()).toContain('name="title"');
	});

	test("an engine that does not answer is a failure whose effect is unknown, never a throw", async () => {
		const { engine, store, open } = await started();
		const id = open(PORTABILITY);
		await settle();
		engine.createPullRequest = async () => {
			throw new Error("bridge closed");
		};
		await store.createPullRequest(id);
		expect(store.getState().pullRequestForms[id]?.failure?.failure.diagnostic).toContain("bridge closed");
		expect(store.getState().pullRequestForms[id]?.failure?.note).toContain("What it did is unknown");
	});
});
