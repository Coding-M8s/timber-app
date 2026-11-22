import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { WorktreeDialogFrame } from "../src/mainview/components/NewWorktreeDialog";
import { startWorkMode } from "../src/mainview/components/StartWorkDialog";
import { issueMentionHint } from "../src/mainview/pull-request-create-format";
import { createWorktreeDialogController } from "../src/mainview/components/worktree-modes/dialog-controller";
import { createStartWorkModel } from "../src/mainview/components/worktree-modes/start-work-model";
import { createMockEngine } from "../src/mainview/engine/mock";
import {
	START_ELSEWHERE_REFUSAL, START_KEY_REFUSAL, assigneeRefusal, branchPrefix, describeAssignment, describeQuestion, initialQuestion,
	offersCheckOut, startWorkChoice, startWorkRequest, startWorkSubmitLabel,
} from "../src/mainview/start-work-format";
import { selectedWorktree } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { createSubmission } from "../src/mainview/store/submission";
import { ISSUE_LISTS, type IssueList } from "../src/shared/issue-lists";
import { type SuggestedIssue, readListedIssue } from "../src/shared/issue-search";
import type { NewWorktreeRequest, WorktreeCommandResult } from "../src/shared/model";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand, readTimberResult } from "../src/shared/timber-result";
import { newWorktreeArguments, readAssignment, unknownStartWorkOption, worktreeCommandResult } from "../src/shared/worktree-commands";
import { recordedResult } from "./support/timber";

const TIMBER = "/work/timber";
const HERE = "example/timber";

const settle = async () => {
	for (let round = 0; round < 8; round++) await Bun.sleep(0);
};

/** As it appears in markup. */
const escaped = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");

const issue = (change: Partial<SuggestedIssue> = {}): SuggestedIssue => ({
	tracker: "github", key: "42", url: `https://github.com/${HERE}/issues/42`, title: "Show the linked issue", status: { name: "Open", category: "open" }, assignee: null,
	worktree: null, pullRequests: [], assignedToMe: false, ...change,
});
const jira = (change: Partial<SuggestedIssue> = {}) => issue({ tracker: "jira", key: "TIM-91", url: "https://example.atlassian.net/browse/TIM-91", status: { name: "To Do", category: "open" }, ...change });
const linear = (change: Partial<SuggestedIssue> = {}) => issue({ tracker: "linear", key: "API-21", url: "https://linear.app/example/issue/API-21", status: { name: "Backlog", category: "open" }, ...change });

const failedRun = (change: Partial<Extract<WorktreeCommandResult, { outcome: "failed" }>> = {}): WorktreeCommandResult => ({
	outcome: "failed", failure: { command: null, diagnostic: "refused", output: null }, worktree: null, created: false, setupSkipped: false, ...change,
});

describe("newWorktreeArguments for an issue", () => {
	test("--branch, -c, and --assign or --reassign go among the options, and the issue's selector stays after --", () => {
		for (const name of ["github:42", "jira:TIM-91", "linear:API-21"]) {
			const request: NewWorktreeRequest = { repository: TIMBER, name, base: "develop", workflow: "review", branch: "X-1-short", allowClosed: true, assign: "reassign" };
			expect(newWorktreeArguments(request, "/tmp/r.json")).toEqual([
				"new", "--base", "develop", "--workflow", "review", "--branch", "X-1-short", "-c", "--reassign",
				"--no-setup", "--result-file", "/tmp/r.json", "--no-editor", "--no-agent", "--", name,
			]);
		}
		expect(describeTimberCommand(newWorktreeArguments({ repository: TIMBER, name: "jira:TIM-91", base: null, assign: "assign" }, RESULT_FILE_PLACEHOLDER)))
			.toBe("timber new --assign --no-setup --result-file <temporary file> --no-editor --no-agent -- jira:TIM-91");
	});

	test("without them, the command is the one New branch has always run", () => {
		expect(newWorktreeArguments({ repository: TIMBER, name: "feat/x", base: null }, "/tmp/r.json"))
			.toEqual(["new", "--no-setup", "--result-file", "/tmp/r.json", "--no-editor", "--no-agent", "--", "feat/x"]);
	});
});

describe("reading what Timber did about the assignee", () => {
	const run = (fields: object, exitCode = 0, output = "") => {
		const base = JSON.parse(recordedResult.succeeded);
		const text = JSON.stringify({ ...base, ...fields, ...(exitCode === 0 ? {} : { outcome: "failed", exitCode, diagnostic: "GitHub issue GH-42 is assigned to jo-park. Nothing was created.", materialized: false }) });
		return worktreeCommandResult({ command: "timber new", result: readTimberResult("new", text, exitCode), output: { text: output, truncated: false } });
	};

	test("each result is kept, with the names made safe to show", () => {
		for (const result of ["assigned", "reassigned", "already-mine", "failed", "not-attempted"] as const) {
			const read = readAssignment({ tracker: "github", key: "42", result, me: "octo\u0007sam", previous: ["jo-park"], diagnostic: result === "failed" ? "no permission" : null });
			expect(read).toEqual({ result, me: "octo�sam", previous: ["jo-park"], diagnostic: result === "failed" ? "no permission" : null });
		}
		for (const bad of [null, "assigned", { result: "maybe", me: "a", previous: [], diagnostic: null }, { result: "assigned", me: 1, previous: [], diagnostic: null }, { result: "assigned", me: "a", previous: [1], diagnostic: null }]) {
			expect(readAssignment(bad)).toBeUndefined();
		}
	});

	test("a record carries it on success and on Timber's refusal, and a record without it has none", () => {
		const assignment = { tracker: "github", key: "42", result: "assigned", me: "octo-sam", previous: [], diagnostic: null };
		expect(run({ assignment })).toMatchObject({ outcome: "succeeded", assignment: { result: "assigned", me: "octo-sam" } });
		const refused = run({ assignment: { ...assignment, result: "not-attempted", previous: ["jo-park"] }, worktree: null }, 1);
		expect(refused).toMatchObject({ outcome: "failed", created: false, assignment: { result: "not-attempted", previous: ["jo-park"] } });
		expect("assignment" in run({})).toBe(false);
	});

	test("a Timber without the options says Start work needs a newer one", () => {
		for (const option of ["--assign", "--reassign", "--branch"]) {
			const result = worktreeCommandResult({ command: "timber new", result: readTimberResult("new", null, 1), output: { text: `error: unknown option '${option}'\n`, truncated: false } });
			expect(result.outcome === "failed" && result.failure.diagnostic).toBe(unknownStartWorkOption(option));
		}
	});
});

describe("assignedToMe in a listed issue", () => {
	const listed = { tracker: "github", key: "42", url: `https://github.com/${HERE}/issues/42`, title: "T", status: { name: "Open", category: "open" }, assignee: "jo-park", worktree: null, pullRequests: [] };
	test("is read when Timber gives it, and unknown when it is left out or cannot be read", () => {
		expect(readListedIssue({ ...listed, assignedToMe: false })?.assignedToMe).toBe(false);
		expect(readListedIssue({ ...listed, assignedToMe: true })?.assignedToMe).toBe(true);
		expect(readListedIssue(listed)?.assignedToMe).toBeNull();
		expect(readListedIssue({ ...listed, assignedToMe: "yes" })?.assignedToMe).toBeNull();
	});
});

describe("startWorkChoice", () => {
	test("GitHub, Jira, and Linear issues start with their whole selector, a card with a worktree offers Open worktree instead", () => {
		expect(startWorkChoice(issue(), HERE)).toEqual({ ok: true, selector: "github:42" });
		expect(startWorkChoice(jira(), HERE)).toEqual({ ok: true, selector: "jira:TIM-91" });
		expect(startWorkChoice(linear(), null)).toEqual({ ok: true, selector: "linear:API-21" });
		expect(startWorkChoice(jira({ worktree: { path: "/w", branch: "TIM-91-x" } }), HERE)).toBeNull();
	});

	test("a GitHub issue of another repository, or a key Timber cannot be given whole, cannot start here", () => {
		expect(startWorkChoice(issue({ url: "https://github.com/other/repo/issues/42" }), HERE)).toEqual({ ok: false, reason: START_ELSEWHERE_REFUSAL });
		expect(startWorkChoice(issue(), null)).toEqual({ ok: false, reason: START_ELSEWHERE_REFUSAL });
		expect(startWorkChoice(jira({ key: "TIM 91" }), HERE)).toEqual({ ok: false, reason: START_KEY_REFUSAL });
	});

	test("the branch hint names the ID a typed name must start with", () => {
		expect(branchPrefix("github", "42")).toBe("GH-42-");
		expect(branchPrefix("jira", "tim-91")).toBe("TIM-91-");
		expect(branchPrefix("linear", "API-21")).toBe("API-21-");
	});
});

describe("offersCheckOut", () => {
	const pr = (number: number, change: Partial<NonNullable<SuggestedIssue["pullRequests"]>[number]> = {}) => ({ number, url: `https://github.com/${HERE}/pull/${number}`, branch: `b-${number}`, fromFork: false, draft: false, ...change });
	test("only an open pull request Check out PR can open here is offered", () => {
		expect(offersCheckOut(issue({ pullRequests: [pr(48)] }), HERE)).toBe(true);
		expect(offersCheckOut(issue({ pullRequests: [] }), HERE)).toBe(false);
		expect(offersCheckOut(issue({ pullRequests: null }), HERE)).toBe(false);
		expect(offersCheckOut(issue({ pullRequests: [pr(51, { fromFork: true })] }), HERE)).toBe(false);
		expect(offersCheckOut(issue({ pullRequests: [pr(51, { fromFork: true }), pr(48)] }), HERE)).toBe(true);
		expect(offersCheckOut(issue({ pullRequests: [pr(48)], status: { name: "Closed", category: "closed" } }), HERE)).toBe(false);
	});
});

describe("what Start work asks first", () => {
	test("unassigned, already mine, or unknown: nothing, and --assign", () => {
		for (const card of [issue(), jira({ assignee: "Alex Doe", assignedToMe: true }), linear({ assignee: "Sam", assignedToMe: null })]) {
			const question = initialQuestion(card);
			expect(question).toEqual({ replace: null, partial: false, closed: null });
			expect(describeQuestion(question, card.tracker, card.key)).toEqual([]);
			expect(startWorkSubmitLabel(question)).toBe("Start work");
			expect(startWorkRequest(TIMBER, "x:1", { branch: "", base: "" }, question, null).assign).toBe("assign");
		}
	});

	test("someone else's issue names them, offers Replace, and passes --reassign", () => {
		const question = initialQuestion(jira({ assignee: "Sam Okafor", assignedToMe: false }));
		expect(question).toEqual({ replace: ["Sam Okafor"], partial: false, closed: null });
		expect(describeQuestion(question, "jira", "TIM-91")).toEqual([
			"TIM-91 is assigned to Sam Okafor. Starting work replaces that assignee with you (--reassign). Cancel to leave it as it is: nothing is created or assigned.",
		]);
		expect(startWorkSubmitLabel(question)).toBe("Replace Sam Okafor and start work");
		expect(startWorkRequest(TIMBER, "jira:TIM-91", { branch: "", base: "" }, question, null).assign).toBe("reassign");
		// The board lists a GitHub issue's first assignee only.
		const github = initialQuestion(issue({ assignee: "jo-park", assignedToMe: false }));
		expect(github.partial).toBe(true);
		expect(describeQuestion(github, "github", "42")[0]).toContain("GitHub may list others beside them");
	});

	test("a closed issue asks too and passes -c", () => {
		const question = initialQuestion(linear({ status: { name: "Canceled", category: "closed" } }));
		expect(question.closed).toBe("Canceled");
		expect(describeQuestion(question, "linear", "API-21")).toEqual(["API-21 is Canceled in Linear. Start work anyway creates its worktree (-c) and does not reopen it."]);
		expect(startWorkSubmitLabel(question)).toBe("Start work anyway");
		expect(startWorkRequest(TIMBER, "linear:API-21", { branch: "", base: "" }, question, null)).toMatchObject({ allowClosed: true, assign: "assign" });
	});

	test("the request keeps the issue's selector whatever the branch, base, and workflow", () => {
		const question = initialQuestion(jira());
		expect(startWorkRequest(TIMBER, "jira:TIM-91", { branch: " TIM-91-proxy ", base: " develop " }, question, "review"))
			.toEqual({ repository: TIMBER, name: "jira:TIM-91", base: "develop", workflow: "review", branch: "TIM-91-proxy", assign: "assign" });
		expect(startWorkRequest(TIMBER, "jira:TIM-91", { branch: "  ", base: "" }, question, null)).toEqual({ repository: TIMBER, name: "jira:TIM-91", base: null, assign: "assign" });
	});
});

describe("assigneeRefusal", () => {
	const notAttempted = (previous: string[], me = "octo-sam") => ({ result: "not-attempted" as const, me, previous, diagnostic: null });

	test("Timber's refusal of --assign names whom to ask about", () => {
		expect(assigneeRefusal(failedRun({ assignment: notAttempted(["jo-park"]) }), "assign", { assignedToMe: null })).toEqual(["jo-park"]);
	});

	test("anything else is an ordinary failure", () => {
		// Created anyway, already --reassign, the card said it is mine, no names, or another result.
		expect(assigneeRefusal(failedRun({ created: true, assignment: notAttempted(["jo-park"]) }), "assign", { assignedToMe: null })).toBeNull();
		expect(assigneeRefusal(failedRun({ assignment: notAttempted(["jo-park"]) }), "reassign", { assignedToMe: false })).toBeNull();
		expect(assigneeRefusal(failedRun({ assignment: notAttempted(["octo-sam"]) }), "assign", { assignedToMe: true })).toBeNull();
		expect(assigneeRefusal(failedRun({ assignment: notAttempted([]) }), "assign", { assignedToMe: false })).toBeNull();
		expect(assigneeRefusal(failedRun(), "assign", { assignedToMe: false })).toBeNull();
		// A later step failed on an issue that is mine, beside others: Timber did not refuse over the assignee.
		expect(assigneeRefusal(failedRun({ assignment: notAttempted(["Octo-Sam", "jo-park"]) }), "assign", { assignedToMe: null })).toBeNull();
	});
});

describe("describeAssignment", () => {
	test("says what Timber did, and marks a write that failed as a problem", () => {
		const of = (result: "assigned" | "reassigned" | "already-mine" | "failed" | "not-attempted", previous: string[] = [], diagnostic: string | null = null) => ({ result, me: "Alex Doe", previous, diagnostic });
		expect(describeAssignment(of("assigned"), "jira", "TIM-91")).toEqual({ text: "Assigned TIM-91 to Alex Doe.", problem: false });
		expect(describeAssignment(of("reassigned", ["Sam Okafor", "Jo Park"]), "jira", "TIM-91")).toEqual({ text: "Assigned TIM-91 to Alex Doe, replacing Sam Okafor and Jo Park.", problem: false });
		expect(describeAssignment(of("already-mine"), "github", "42")).toEqual({ text: "#42 was already assigned to you.", problem: false });
		expect(describeAssignment(of("failed", [], "The login may not assign issues."), "linear", "API-21")).toEqual({ text: "Could not assign API-21 to you: The login may not assign issues.", problem: true });
		expect(describeAssignment(undefined, "linear", "API-21").problem).toBe(true);
	});
});

/** The board's card for a key, as the mock lists it. */
async function boardIssue(engine: ReturnType<typeof createMockEngine>, tracker: SuggestedIssue["tracker"], key: string, list: IssueList = "sprint"): Promise<SuggestedIssue> {
	const result = await engine.listIssues({ repository: TIMBER, list, tracker });
	if (!result.ok || result.outcome !== "found") throw new Error("no list");
	const found = result.issues.find(candidate => candidate.key === key);
	if (!found) throw new Error(`no ${key}`);
	return found;
}

/** The Start work dialog as StartWorkDialog.tsx wires it, without a window, on the mock engine, noting every `timber new` it asks for. */
async function startWork(pick: (engine: ReturnType<typeof createMockEngine>) => Promise<SuggestedIssue>) {
	const engine = createMockEngine();
	const asked: NewWorktreeRequest[] = [];
	const { newWorktree } = engine;
	engine.newWorktree = request => (asked.push(request), newWorktree(request));
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	const card = await pick(engine);
	const choice = startWorkChoice(card, HERE);
	if (!choice?.ok) throw new Error("cannot start");
	const repository = store.getState().repositories.find(candidate => candidate.path === TIMBER)!;
	const toasts: { toast: string; problem: boolean }[] = [];
	const submission = createSubmission((toast, problem) => toasts.push({ toast, problem: problem === true }));
	const model = createStartWorkModel(store, TIMBER, card, choice.selector);
	const controller = createWorktreeDialogController(store, TIMBER, submission);
	let checkedOut = 0;
	const mode = () => startWorkMode(model, model.getState(), repository, card, choice.selector, submission, undefined, () => void checkedOut++);
	return {
		store, engine, asked, model, toasts, mode, card,
		checkedOut: () => checkedOut,
		submit: () => controller.submit(mode()),
		render: () => renderToStaticMarkup(
			<WorktreeDialogFrame
				title="Start work" repository={repository} modes={[mode()]} selected={0} submission={submission.getState()}
				agents={store.getState().preferences.agents} plan={controller.plan}
				onSelect={() => {}} onPickAgent={() => {}} onSubmit={() => {}} onClose={() => {}}
			/>,
		),
	};
}

describe("Start work in the mock app", () => {
	test("GitHub, unassigned: the footer shows --assign first, and the worktree it creates is linked, selected, and assigned", async () => {
		const dialog = await startWork(engine => boardIssue(engine, "github", "42"));
		const command = "timber new --assign --no-setup --result-file <temporary file> --no-editor --no-agent -- github:42";
		expect(dialog.render()).toContain(escaped(command));
		expect(dialog.render()).not.toContain("start-work-question");
		expect(await dialog.submit()).toBe(true);
		expect(dialog.asked).toEqual([{ repository: TIMBER, name: "github:42", base: null, assign: "assign" }]);
		const worktree = selectedWorktree(dialog.store.getState())?.worktree;
		expect(worktree?.issue).toEqual({ kind: "linked", tracker: "github", key: "42", url: `https://github.com/${HERE}/issues/42` });
		expect(dialog.toasts.at(-1)).toEqual({ toast: `Created worktree ${worktree!.branch}. Assigned #42 to octo-sam.`, problem: false });
	});

	test("Jira, with an edited branch, base, and workflow-free run: the link stays and the Pull request tab names the issue", async () => {
		const dialog = await startWork(engine => boardIssue(engine, "jira", "TIM-91"));
		dialog.model.edit({ branch: "TIM-91-proxy-login", base: "origin/develop" });
		expect(dialog.render()).toContain(escaped("timber new --base origin/develop --branch TIM-91-proxy-login --assign --no-setup"));
		expect(await dialog.submit()).toBe(true);
		const worktree = selectedWorktree(dialog.store.getState())?.worktree!;
		expect(worktree.branch).toBe("TIM-91-proxy-login");
		expect(worktree.issue).toMatchObject({ kind: "linked", tracker: "jira", key: "TIM-91" });
		// Its Pull request tab: the key leads the title, and Timber's Refs line is named under Description.
		dialog.store.showTab("pull-request");
		dialog.store.startPullRequestForm(TIMBER, worktree);
		await settle();
		expect(dialog.store.getState().pullRequestForms[worktree.id]?.title).toStartWith("TIM-91: ");
		expect(issueMentionHint(worktree.issue)).toBe("Timber adds Refs TIM-91 unless the description already mentions it.");
	});

	test("Linear, with an edited branch: the name Timber refuses creates nothing, and a good one keeps the link", async () => {
		// Linear's open list is not set up in the samples: the card is as Timber would list it.
		const dialog = await startWork(async () => linear());
		dialog.model.edit({ branch: "rotate-tokens" });
		expect(await dialog.submit()).toBe(false);
		expect(selectedWorktree(dialog.store.getState())?.worktree?.branch).not.toBe("rotate-tokens");
		dialog.model.edit({ branch: "API-21-rotate-tokens" });
		expect(await dialog.submit()).toBe(true);
		expect(dialog.asked.map(request => request.branch)).toEqual(["rotate-tokens", "API-21-rotate-tokens"]);
		expect(selectedWorktree(dialog.store.getState())?.worktree?.issue).toMatchObject({ kind: "linked", tracker: "linear", key: "API-21" });
	});

	test("someone else's Jira issue: the question names them before anything runs, and Replace passes --reassign", async () => {
		const dialog = await startWork(engine => boardIssue(engine, "jira", "TIM-90"));
		const markup = dialog.render();
		expect(markup).toContain("TIM-90 is assigned to Sam Okafor.");
		expect(markup).toContain("Replace Sam Okafor and start work");
		expect(markup).toContain(escaped("timber new --reassign --no-setup --result-file <temporary file> --no-editor --no-agent -- jira:TIM-90"));
		// No pull request on TIM-90, but the offer is drawn whenever the dialog is given one.
		expect(dialog.asked).toEqual([]);
		expect(await dialog.submit()).toBe(true);
		expect(dialog.asked[0]?.assign).toBe("reassign");
		expect(dialog.toasts.at(-1)?.toast).toEndWith("Assigned TIM-90 to Alex Doe, replacing Sam Okafor.");
	});

	test("someone else's GitHub issue with an open pull request also offers checking it out", async () => {
		const dialog = await startWork(engine => boardIssue(engine, "github", "44"));
		expect(dialog.render()).toContain(">Check out their pull request</button>");
	});

	test("Cancel runs nothing: closing the dialog asks Timber for nothing and assigns nothing", async () => {
		const engine = createMockEngine();
		const asked: NewWorktreeRequest[] = [];
		const { newWorktree } = engine;
		engine.newWorktree = request => (asked.push(request), newWorktree(request));
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		const card = await boardIssue(engine, "jira", "TIM-90");
		store.openDialog({ kind: "start-work", repository: TIMBER, issue: card });
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain("Start work on TIM-90 in timber");
		expect(markup).toContain("TIM-90 is assigned to Sam Okafor.");
		const before = store.getState().repositories.find(repository => repository.path === TIMBER)!.worktrees.length;
		store.closeDialog();
		await settle();
		expect(asked).toEqual([]);
		expect(store.getState().repositories.find(repository => repository.path === TIMBER)!.worktrees.length).toBe(before);
	});

	test("when the board could not tell, Timber's refusal is turned into the question, and nothing was created", async () => {
		const dialog = await startWork(async engine => ({ ...await boardIssue(engine, "github", "44"), assignedToMe: null }));
		expect(dialog.render()).not.toContain("start-work-question");
		expect(await dialog.submit()).toBe(false);
		expect(dialog.asked.map(request => request.assign)).toEqual(["assign"]);
		const markup = dialog.render();
		expect(markup).toContain("#44 is assigned to jo-park.");
		expect(markup).toContain(escaped("timber new --reassign --no-setup"));
		expect(await dialog.submit()).toBe(true);
		expect(dialog.asked.map(request => request.assign)).toEqual(["assign", "reassign"]);
	});

	test("a closed issue asks first and passes -c", async () => {
		const dialog = await startWork(engine => boardIssue(engine, "github", "7"));
		expect(dialog.render()).toContain("#7 is Closed in GitHub.");
		expect(dialog.render()).toContain(escaped("timber new -c --assign --no-setup"));
		expect(await dialog.submit()).toBe(true);
		expect(dialog.asked[0]).toMatchObject({ allowClosed: true, assign: "assign" });
	});
});

describe("Start work when Timber stops before setup", () => {
	test("the Run setup step says the issue was not assigned, and runs setup in the kept worktree", async () => {
		const dialog = await startWork(engine => boardIssue(engine, "jira", "TIM-91"));
		dialog.engine.endCommands("stops-after-create");
		expect(await dialog.submit()).toBe(false);
		const step = dialog.model.getState().step;
		expect(step).toMatchObject({ kind: "setup", assigned: false });
		const markup = dialog.render();
		expect(markup).toContain("so TIM-91 was not assigned to you.");
		expect(markup).toContain(">Run setup</button>");
		expect(await dialog.submit()).toBe(true);
		expect(dialog.asked.length).toBe(1);
	});
});

describe("Start work on the board", () => {
	test("once the worktree exists, the card offers Open worktree on the next read", async () => {
		const dialog = await startWork(engine => boardIssue(engine, "jira", "TIM-91"));
		expect(await dialog.submit()).toBe(true);
		const branch = selectedWorktree(dialog.store.getState())?.worktree.branch;
		dialog.store.openBoard(TIMBER);
		await settle();
		await dialog.store.pickBoardTracker(TIMBER, "jira");
		await settle();
		const markup = renderToStaticMarkup(<App store={dialog.store} />);
		const card = [...markup.matchAll(/<li class="issue-card">([\s\S]*?)<\/li>/g)].map(match => match[1]!).find(one => one.includes(">TIM-91<"))!;
		expect(card).toContain(`title="Open the worktree ${branch}"`);
		expect(card).not.toContain("issue-card-start-work");
	});

	test("every list offers it on cards without a worktree, and it opens the dialog for that issue", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine, () => () => {});
		store.start();
		await settle();
		store.openBoard(TIMBER);
		await settle();
		// Jira's samples have cards without a worktree in every list, both toggles on included.
		await store.pickBoardTracker(TIMBER, "jira");
		await settle();
		for (const list of ISSUE_LISTS) {
			await store.pickBoardList(TIMBER, list);
			await settle();
			const markup = renderToStaticMarkup(<App store={store} />);
			expect(markup).toContain('class="issue-card-start issue-card-start-work"');
		}
		const card = await boardIssue(engine, "jira", "TIM-8", "open");
		store.openDialog({ kind: "start-work", repository: TIMBER, issue: card });
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain("Start work on TIM-8 in timber");
		expect(markup).toContain(escaped("-- jira:TIM-8"));
	});
});
