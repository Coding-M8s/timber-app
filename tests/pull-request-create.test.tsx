import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { PullRequestFormView } from "../src/mainview/components/PullRequestPanel";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { actOutPullRequest, pullRequestEndings } from "../src/mainview/engine/mock-pr";
import { sampleAnswer } from "../src/mainview/engine/mock-pull-requests";
import { CREATE_RUNNING, CREATE_SUBMIT, defaultPullRequestTitle, issueMentionHint, presentPullRequestCreation, pullRequestCommandFor, titleKeyOf } from "../src/mainview/pull-request-create-format";
import type { PullRequestForm } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import type { IssueLink, Repository, Worktree } from "../src/shared/model";
import type { PullRequestList } from "../src/shared/pull-requests";
import type { CreatePullRequestRequest, CreatePullRequestResult } from "../src/shared/timber-pr";

const settle = async () => {
	for (let round = 0; round < 8; round++) await Bun.sleep(0);
};

const TIMBER = "/work/timber";
const PORTABILITY = "/work/timber-worktrees/fix-macos-portability";
const SPIKE = "/work/timber-worktrees/spike-new-idea";
const JIRA: IssueLink = { kind: "linked", tracker: "jira", key: "PROJ-123", url: "https://example.atlassian.net/browse/PROJ-123" };
const LINEAR: IssueLink = { kind: "linked", tracker: "linear", key: "ENG-12", url: "https://linear.app/example/issue/ENG-12/add-sign-in" };
const GITHUB: IssueLink = { kind: "linked", tracker: "github", key: "153", url: "https://github.com/example/app/issues/153" };
const FAILURE = { command: "timber pr --title x --result-file <temporary file> -- /w", diagnostic: "Timber's reason.", output: { text: "error: Timber's reason.\n", truncated: false } };

describe("the words and the command", () => {
	test("the title starts as the last commit's subject, else the branch", () => {
		expect(defaultPullRequestTitle("Add login", "feat/login", null)).toBe("Add login");
		expect(defaultPullRequestTitle(null, "feat/login", null)).toBe("feat/login");
		expect(defaultPullRequestTitle(null, null, null)).toBe("");
		expect(defaultPullRequestTitle("Add login", "feat/login", { kind: "none" })).toBe("Add login");
	});

	test("a saved Jira or Linear link starts the title with its key, and a GitHub link or invalid metadata leaves it as it is", () => {
		expect(defaultPullRequestTitle("Add login", "feat/login", JIRA)).toBe("PROJ-123: Add login");
		expect(defaultPullRequestTitle(null, "feat/login", JIRA)).toBe("PROJ-123: feat/login");
		expect(defaultPullRequestTitle("Add login", "feat/login", LINEAR)).toBe("ENG-12: Add login");
		// Timber mentions a GitHub issue in the body, which is what links it.
		expect(defaultPullRequestTitle("Add login", "feat/login", GITHUB)).toBe("Add login");
		expect(defaultPullRequestTitle("Add login", "feat/login", { kind: "invalid", reason: "malformed" })).toBe("Add login");
		// Nothing to prefix: Timber refuses an empty title, and a key alone would be one to submit.
		expect(defaultPullRequestTitle(null, null, JIRA)).toBe("");
		expect(defaultPullRequestTitle("Add login", "feat/login", { ...JIRA, key: " PROJ-123 " })).toBe("PROJ-123: Add login");
		expect(titleKeyOf({ ...JIRA, key: "   " })).toBeNull();
		expect([JIRA, LINEAR, GITHUB, null, { kind: "none" } as const, { kind: "invalid", reason: "malformed" } as const].map(titleKeyOf)).toEqual(["PROJ-123", "ENG-12", null, null, null, null]);
	});

	test("a title that already starts with the key is not prefixed again", () => {
		for (const subject of ["PROJ-123: Add login", "PROJ-123 Add login", "proj-123 add login", "[PROJ-123] Add login", "(PROJ-123) Add login", "PROJ-123"]) {
			expect(defaultPullRequestTitle(subject, "feat/login", JIRA)).toBe(subject);
		}
		// A branch named for the issue is left as it is too.
		expect(defaultPullRequestTitle(null, "proj-123-add-login", JIRA)).toBe("proj-123-add-login");
		// A longer key, or the key later in the subject, is not the key at the start.
		expect(defaultPullRequestTitle("PROJ-1234: Add login", "feat/login", JIRA)).toBe("PROJ-123: PROJ-1234: Add login");
		expect(defaultPullRequestTitle("Add login for PROJ-123", "feat/login", JIRA)).toBe("PROJ-123: Add login for PROJ-123");
		// The key is compared as text, never as a pattern.
		expect(defaultPullRequestTitle("Add login", "feat/login", { ...JIRA, key: "A.B" })).toBe("A.B: Add login");
		expect(defaultPullRequestTitle("AxB Add login", "feat/login", { ...JIRA, key: "A.B" })).toBe("A.B: AxB Add login");
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

describe("the issue Timber mentions in the body", () => {
	test("a saved Jira or Linear link names its key as Timber writes it", () => {
		expect(issueMentionHint(JIRA)).toBe("Timber adds Refs PROJ-123 unless the description already mentions it.");
		expect(issueMentionHint(LINEAR)).toBe("Timber adds Refs ENG-12 unless the description already mentions it.");
	});

	test("a saved GitHub link names #n, and owner/repo#n for a pull request in another repository", () => {
		expect(issueMentionHint(GITHUB)).toBe("Timber adds Refs #153 unless the description already mentions it, or Refs example/app#153 when the pull request opens in another repository.");
		expect(issueMentionHint({ ...GITHUB, url: "not a url" })).toBe("Timber adds Refs #153 unless the description already mentions it.");
	});

	test("no line without a saved link, for invalid metadata, or a blank key", () => {
		expect(issueMentionHint(null)).toBeNull();
		expect(issueMentionHint({ kind: "none" })).toBeNull();
		expect(issueMentionHint({ kind: "invalid", reason: "malformed" })).toBeNull();
		expect(issueMentionHint({ ...JIRA, key: "  " })).toBeNull();
	});
});

const form = (change: Partial<PullRequestForm> = {}): PullRequestForm => ({
	repository: TIMBER, worktree: PORTABILITY, head: null, title: "Run on macOS", body: "", base: "origin/main", draft: false,
	titleKey: null, subject: null, titleEdited: false, running: false, failure: null, reported: null, ...change,
});
const formMarkup = (shown: PullRequestForm, mentionHint: string | null = null) =>
	renderToStaticMarkup(<PullRequestFormView form={shown} afterIssue={false} mentionHint={mentionHint} onChange={() => {}} onSubmit={() => {}} />);

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
		expect(markup).not.toContain("Timber adds Refs");
	});

	test("the mention line shows as a quiet hint under Description", () => {
		const markup = formMarkup(form(), issueMentionHint(LINEAR));
		const description = markup.slice(markup.indexOf("<textarea"), markup.indexOf('name="base"'));
		expect(description).toContain('<span class="field-hint">Timber adds Refs ENG-12 unless the description already mentions it.</span>');
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

async function started(options: { delay?: number; repositories?: Repository[] } = {}) {
	const engine = createMockEngine(options.repositories ?? sampleRepositories, undefined, { commandMilliseconds: options.delay ?? 0 });
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
		// The sample worktree is linked to Jira TIM-88, so the title starts with its key.
		expect(store.getState().pullRequestForms[id]).toMatchObject({ title: "TIM-88: fix/macos-portability", base: "origin/main", body: "", draft: false });
		await settle();
		expect(store.getState().pullRequestForms[id]?.title).toBe("TIM-88: Use POSIX sed");
		expect(panel()).toContain('name="title" value="TIM-88: Use POSIX sed"');
		expect(panel()).toContain("timber pr --title &#x27;TIM-88: Use POSIX sed&#x27; --base origin/main --result-file");
	});

	test("a saved link puts the mention Timber adds under Description", async () => {
		const { open, panel } = await started();
		open(PORTABILITY);
		await settle();
		expect(panel()).toContain('<span class="field-hint">Timber adds Refs TIM-88 unless the description already mentions it.</span>');
	});

	test("without a saved link, no mention line, even on a branch named after an issue", async () => {
		for (const branch of ["GH-154-run-on-macos", "ENG-42-run-on-macos"]) {
			const repositories = sampleRepositories.map(repository => repository.path !== TIMBER ? repository : {
				...repository,
				worktrees: repository.worktrees.map(worktree => worktree.path === PORTABILITY ? { ...worktree, branch, issue: { kind: "none" } as const } : worktree),
			});
			const { open, panel } = await started({ repositories });
			open(PORTABILITY);
			await settle();
			expect(panel()).toContain('name="title"');
			expect(panel()).not.toContain("Timber adds Refs");
		}
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
		expect(store.getState().pullRequestForms[id]?.title).toBe("TIM-88: The base's last commit");

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
		expect(store.getState().pullRequestForms[id]?.title).toBe("TIM-88: Use POSIX sed");

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

	test("a link attached, changed, or removed makes the title again unless one was typed, and a GitHub link adds no key", async () => {
		const { engine, store, open } = await started();
		const linked = (issue: IssueLink | null) => sampleRepositories.map(repository => ({
			...repository,
			worktrees: repository.worktrees.map(worktree => worktree.path === SPIKE ? { ...worktree, issue } : worktree),
		}));
		engine.setHeadSubject(SPIKE, "Try a new idea");
		const id = open(SPIKE);
		await settle();
		expect(store.getState().pullRequestForms[id]?.title).toBe("Try a new idea");

		engine.setRepositories(linked(LINEAR));
		await store.reloadRepository(TIMBER);
		open(SPIKE);
		await settle();
		expect(store.getState().pullRequestForms[id]).toMatchObject({ title: "ENG-12: Try a new idea", titleKey: "ENG-12" });

		for (const [issue, title] of [[GITHUB, "Try a new idea"], [{ kind: "invalid", reason: "malformed" }, "Try a new idea"], [JIRA, "PROJ-123: Try a new idea"], [null, "Try a new idea"]] as const) {
			engine.setRepositories(linked(issue));
			await store.reloadRepository(TIMBER);
			open(SPIKE);
			await settle();
			expect(store.getState().pullRequestForms[id]?.title).toBe(title);
		}

		store.editPullRequestForm(id, { title: "Mine" });
		engine.setRepositories(linked(JIRA));
		await store.reloadRepository(TIMBER);
		open(SPIKE);
		await settle();
		expect(store.getState().pullRequestForms[id]?.title).toBe("Mine");
	});

	test("a link changes the title at once, without reading, and a branch without a commit gets the key on the branch", async () => {
		const { engine, store, open } = await started();
		const linked = (issue: IssueLink | null) => sampleRepositories.map(repository => ({
			...repository,
			worktrees: repository.worktrees.map(worktree => worktree.path === SPIKE ? { ...worktree, issue } : worktree),
		}));
		engine.setHeadSubject(SPIKE, null);
		const id = open(SPIKE);
		await settle();
		let reads = 0;
		engine.readHeadSubject = async () => {
			reads++;
			return null;
		};
		engine.setRepositories(linked(JIRA));
		await store.reloadRepository(TIMBER);
		open(SPIKE);
		// Already there before anything is read, so the form never offers the old key.
		expect(store.getState().pullRequestForms[id]?.title).toBe("PROJ-123: spike/new-idea");
		expect(reads).toBe(0);
	});

	test("a read with no answer keeps the title, and a read that answers after the link changed uses the new key", async () => {
		const { engine, store, open } = await started();
		const changed = (head: string, issue: IssueLink | null) => sampleRepositories.map(repository => ({
			...repository,
			worktrees: repository.worktrees.map(worktree => worktree.path === SPIKE ? { ...worktree, head, issue } : worktree),
		}));
		engine.setHeadSubject(SPIKE, "Try a new idea");
		const id = open(SPIKE);
		await settle();

		// Git could not answer for a new commit: the title read before stays, never the branch.
		engine.setHeadSubject(SPIKE, null);
		engine.setRepositories(changed("1111111111111111111111111111111111111111", JIRA));
		await store.reloadRepository(TIMBER);
		open(SPIKE);
		await settle();
		expect(store.getState().pullRequestForms[id]?.title).toBe("PROJ-123: Try a new idea");

		// A new commit is read slowly, and the link changes before the read answers.
		let answer: (subject: string | null) => void = () => {};
		engine.readHeadSubject = () => new Promise(resolve => {
			answer = resolve;
		});
		engine.setRepositories(changed("2222222222222222222222222222222222222222", JIRA));
		await store.reloadRepository(TIMBER);
		open(SPIKE);
		engine.setRepositories(changed("2222222222222222222222222222222222222222", LINEAR));
		await store.reloadRepository(TIMBER);
		open(SPIKE);
		expect(store.getState().pullRequestForms[id]?.title).toBe("ENG-12: Try a new idea");
		answer("Second idea");
		await settle();
		expect(store.getState().pullRequestForms[id]?.title).toBe("ENG-12: Second idea");
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
