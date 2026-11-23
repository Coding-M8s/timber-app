import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import {
	CHECK_OUT_LABEL, FORK_REFUSAL, allRefused, describeUnlisted, ISSUE_ELSEWHERE_REFUSAL, checkOutChoice, checkOutRequest, describeCheckedOut, describePullRequest, firstOption,
} from "../src/mainview/check-out-format";
import { CheckOutDialogView, runCheckOut } from "../src/mainview/components/CheckOutPullRequestDialog";
import { createMockEngine } from "../src/mainview/engine/mock";
import { selectedWorktree } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import type { LinkedPullRequest, SuggestedIssue } from "../src/shared/issue-search";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "../src/shared/timber-result";
import { openWorktreeArguments } from "../src/shared/worktree-commands";

const TIMBER = "/work/timber";
const HERE = "example/timber";

const settle = async () => {
	for (let round = 0; round < 8; round++) await Bun.sleep(0);
};

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { store, engine };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

/** The text a command has once it is rendered as markup. */
const escaped = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#x27;").replaceAll('"', "&quot;");

const pr = (number: number, branch: string, change: Partial<LinkedPullRequest> = {}): LinkedPullRequest => ({
	number, url: `https://github.com/${HERE}/pull/${number}`, branch, fromFork: false, draft: false, ...change,
});

const issue = (change: Partial<SuggestedIssue> = {}): SuggestedIssue => ({
	tracker: "github", key: "42", url: `https://github.com/${HERE}/issues/42`, title: "Title", status: { name: "Open", category: "open" }, assignee: null,
	worktree: null, pullRequests: [pr(48, "feat/header")], assignedToMe: false, ...change,
});

/** The keys of the cards on screen that offer Check out PR, and those that show a worktree's pill. */
function cards(markup: string) {
	const all = [...markup.matchAll(/<li class="issue-card">([\s\S]*?)<\/li>/g)].map(match => match[1]!);
	const key = (card: string) => /class="issue-card-key">([^<]*)</.exec(card)![1];
	return {
		checkOut: all.filter(card => card.includes("issue-card-check-out")).map(key),
		pill: all.filter(card => card.includes("issue-card-worktree")).map(key),
	};
}

describe("which cards offer Check out PR", () => {
	test("an open issue with an open pull request and no worktree here", () => {
		expect(checkOutChoice(issue(), HERE)).toEqual({ issue: "github:42", options: [{ pullRequest: pr(48, "feat/header"), refused: null }] });
	});

	test("not an issue with a worktree here, a done one, one whose links could not be read, or one with none", () => {
		expect(checkOutChoice(issue({ worktree: { path: "/work/timber-worktrees/x", branch: "x" } }), HERE)).toBeNull();
		expect(checkOutChoice(issue({ status: { name: "Closed", category: "closed" } }), HERE)).toBeNull();
		expect(checkOutChoice(issue({ pullRequests: null }), HERE)).toBeNull();
		expect(checkOutChoice(issue({ pullRequests: [] }), HERE)).toBeNull();
	});

	test("not an issue whose key cannot be named to Timber exactly", () => {
		expect(checkOutChoice(issue({ tracker: "jira", key: "ENG", url: "https://example.atlassian.net/browse/ENG" }), HERE)).toBeNull();
	});

	test("an in-progress Jira issue, whose pull request's fork the tracker cannot tell, is Timber's to judge", () => {
		const bitbucket: LinkedPullRequest = { number: 12, url: "https://bitbucket.org/example/timber/pull-requests/12", branch: "TIM-80-x", fromFork: null, draft: null };
		const jira = issue({ tracker: "jira", key: "TIM-80", url: "https://example.atlassian.net/browse/TIM-80", status: { name: "In Progress", category: "in-progress" }, pullRequests: [bitbucket] });
		expect(checkOutChoice(jira, null)).toEqual({ issue: "jira:TIM-80", options: [{ pullRequest: bitbucket, refused: null }] });
	});

	test("a fork's pull request, or one of another repository, is refused with the reason, and nothing would run", () => {
		const several = issue({ pullRequests: [pr(50, "fix/a", { fromFork: true }), pr(51, "fix/b", { url: "https://github.com/someone/else/pull/51" }), pr(52, "fix/c", { url: "https://github.com/EXAMPLE/Timber/pull/52" })] });
		const choice = checkOutChoice(several, HERE)!;
		expect(choice.options.map(option => option.refused)).toEqual([FORK_REFUSAL, expect.stringContaining("someone/else"), null]);
		expect(firstOption(choice)).toBe(2);
	});

	test("in a repository not on github.com, a github.com pull request is of another repository", () => {
		const jira = issue({ tracker: "jira", key: "TIM-80", url: "https://example.atlassian.net/browse/TIM-80", pullRequests: [pr(5, "TIM-80-x")] });
		const choice = checkOutChoice(jira, null)!;
		expect(choice.options[0]!.refused).toContain(HERE);
		expect(allRefused(choice)).toBe(true);
	});

	test("a GitHub issue of another repository, from a project's sprint, cannot be linked here, so every pull request is refused", () => {
		const elsewhere = issue({ url: "https://github.com/someone/else/issues/42" });
		expect(checkOutChoice(elsewhere, HERE)!.options.map(option => option.refused)).toEqual([ISSUE_ELSEWHERE_REFUSAL]);
		expect(firstOption(checkOutChoice(elsewhere, HERE)!)).toBe(0);
	});

	test("the request opens the head branch exactly as the tracker gave it, after --, and links the issue", () => {
		const odd = issue({ pullRequests: [pr(9, "--force")] });
		const choice = checkOutChoice(odd, HERE)!;
		const request = checkOutRequest(TIMBER, choice, choice.options[0]!.pullRequest);
		expect(request).toEqual({ repository: TIMBER, selector: "--force", issue: "github:42" });
		expect(openWorktreeArguments(request, "/tmp/r.json")).toEqual(["open", "--issue", "github:42", "--no-setup", "--result-file", "/tmp/r.json", "--no-editor", "--no-agent", "--", "--force"]);
	});

	test("the words: number and branch, draft and fork, and a branch Timber opened under another name", () => {
		expect(describePullRequest(pr(48, "feat/a", { draft: true, fromFork: true }))).toEqual({ name: "#48 feat/a", notes: ["draft", "from a fork"] });
		expect(describePullRequest(pr(48, "feat/\u001ba", { draft: null, fromFork: null }))).toEqual({ name: "#48 feat/�a", notes: [] });
		const worktree = { id: "w", path: "/work/timber-worktrees/feat-a", branch: "feat/a" };
		expect(describeCheckedOut(pr(48, "feat/a"), worktree, true)).toBe("Checked out #48 in feat/a.");
		expect(describeCheckedOut(pr(48, "feat/a"), worktree, false)).toBe("Opened feat/a for #48. Its worktree was already there.");
		expect(describeCheckedOut(pr(48, "GH-48"), worktree, true)).toBe("Checked out #48 in feat/a. Timber opened feat/a, not GH-48.");
	});
});

describe("Check out PR on the board", () => {
	test("shows on a card with an open pull request and no worktree, never on a done card or one with a worktree", async () => {
		const { store } = await startedStore();
		store.openBoard(TIMBER);
		await settle();
		const markup = render(store);
		// 41 has a worktree and a pull request: it keeps its pill. 7 is done. 42 and 44 have pull requests.
		expect(cards(markup)).toEqual({ checkOut: ["#42", "#44"], pill: ["#41"] });
		expect(markup).toContain(`>${CHECK_OUT_LABEL}</button>`);
		// Start work stays beside it, so the issue can still be started anew.
		expect(markup.match(/class="issue-card-start issue-card-start-work"/g)?.length).toBe(3);
	});

	test("links that could not be read leave the card as it is", async () => {
		const { store } = await startedStore();
		store.openBoard(TIMBER);
		await settle();
		await store.pickBoardList(TIMBER, "open");
		await settle();
		const markup = render(store);
		// 45 is the issue whose links Timber could not read.
		expect(markup).toContain('class="issue-card-key">#45<');
		expect(cards(markup).checkOut).not.toContain("#45");
	});

	test("the dialog shows the exact timber open command before anything runs", async () => {
		const { store, engine } = await startedStore();
		const calls: unknown[] = [];
		const { openWorktree } = engine;
		engine.openWorktree = request => {
			calls.push(request);
			return openWorktree(request);
		};
		store.openBoard(TIMBER);
		await settle();
		const listed = store.getState().issueBoards[TIMBER]!.good;
		const card = Object.values(listed).flatMap(read => read.result.ok && read.result.outcome === "found" ? read.result.issues : []).find(one => one.key === "42")!;
		store.openDialog({ kind: "check-out-pull-request", repository: TIMBER, issue: card });
		const markup = render(store);
		const command = describeTimberCommand(openWorktreeArguments({ repository: TIMBER, selector: "feat/linked-issue-header", issue: "github:42" }, RESULT_FILE_PLACEHOLDER));
		expect(command).toBe("timber open --issue github:42 --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/linked-issue-header");
		expect(markup).toContain(escaped(command));
		expect(markup).toContain("#48 feat/linked-issue-header");
		expect(calls).toEqual([]);
	});

	test("checking out selects the worktree on its Pull request tab, runs the setup Timber left, and the card then shows its pill", async () => {
		const { store } = await startedStore();
		store.openBoard(TIMBER);
		await settle();
		const choice = checkOutChoice(issue({ url: "https://github.com/example/timber/issues/42", pullRequests: [pr(48, "feat/linked-issue-header")] }), HERE)!;
		const outcome = await runCheckOut(store, checkOutRequest(TIMBER, choice, choice.options[0]!.pullRequest), choice.options[0]!.pullRequest);
		expect(outcome).toEqual({ ok: true, toast: "Checked out #48 in feat/linked-issue-header." });
		const state = store.getState();
		expect(state.board).toBeNull();
		expect(state.tab).toBe("pull-request");
		expect(selectedWorktree(state)?.worktree).toMatchObject({ branch: "feat/linked-issue-header", issue: { kind: "linked", tracker: "github", key: "42" } });
		expect(state.terminals.map(session => session.name)).toEqual(["Setup"]);

		store.openBoard(TIMBER);
		await settle();
		const markup = render(store);
		expect(cards(markup)).toEqual({ checkOut: ["#44"], pill: ["#41", "#42"] });
		expect(markup).toContain('title="Open the worktree feat/linked-issue-header"');
	});

	test("a Jira pull request opens its branch too", async () => {
		const { store } = await startedStore();
		const outcome = await runCheckOut(store, { repository: TIMBER, selector: "TIM-80-saved-base", issue: "jira:TIM-80" }, { number: 12, url: "https://bitbucket.org/example/timber/pull-requests/12", branch: "TIM-80-saved-base", fromFork: null, draft: null });
		expect(outcome).toEqual({ ok: true, toast: "Checked out #12 in TIM-80-saved-base." });
		expect(store.getState().tab).toBe("pull-request");
	});

	test("a branch that cannot be opened keeps Timber's reason in the dialog, and nothing else changes", async () => {
		const { store } = await startedStore();
		store.openBoard(TIMBER);
		await settle();
		const outcome = await runCheckOut(store, { repository: TIMBER, selector: "feat/gone", issue: "github:42" }, pr(48, "feat/gone"));
		expect(outcome).toMatchObject({ ok: false, failure: { diagnostic: expect.stringContaining('No existing branch or worktree matches "feat/gone"') } });
		expect(store.getState().board).toBe(TIMBER);
		expect(store.getState().terminals).toEqual([]);
	});

	test("a worktree the list read afterwards does not show: the toast says so, and no tab or setup starts", async () => {
		const { store, engine } = await startedStore();
		store.openBoard(TIMBER);
		await settle();
		engine.failTimber(TIMBER, "Timber could not list the worktrees.");
		const outcome = await runCheckOut(store, { repository: TIMBER, selector: "feat/linked-issue-header", issue: "github:42" }, pr(48, "feat/linked-issue-header"));
		expect(outcome).toEqual({ ok: true, toast: `Checked out #48 in feat/linked-issue-header. ${describeUnlisted(true)}` });
		expect(store.getState().board).toBe(TIMBER);
		expect(store.getState().tab).not.toBe("pull-request");
		expect(store.getState().terminals).toEqual([]);
	});

	test("a worktree Timber kept although it stopped: the failure stays in the dialog, and the worktree is selected in the list", async () => {
		const { store, engine } = await startedStore();
		store.openBoard(TIMBER);
		await settle();
		engine.endCommands("stops-after-create");
		const outcome = await runCheckOut(store, { repository: TIMBER, selector: "feat/linked-issue-header", issue: "github:42" }, pr(48, "feat/linked-issue-header"));
		expect(outcome).toMatchObject({ ok: false });
		expect(selectedWorktree(store.getState())?.worktree.branch).toBe("feat/linked-issue-header");
		expect(store.getState().tab).not.toBe("pull-request");
		expect(store.getState().terminals).toEqual([]);
	});

	test("a cancelled run is a failure that says nothing changed", async () => {
		const outcome = await runCheckOut({
			openWorktree: async () => ({ outcome: "cancelled" }),
			startSessionsIn: () => { throw new Error("not expected"); },
			showTab: () => { throw new Error("not expected"); },
			getState: () => { throw new Error("not expected"); },
		}, { repository: TIMBER, selector: "x", issue: "github:42" }, pr(48, "x"));
		expect(outcome).toMatchObject({ ok: false, failure: { diagnostic: "timber open was cancelled before anything was changed." } });
	});

	test("a worktree already linked to another issue is refused in Timber's words", async () => {
		const { store } = await startedStore();
		const outcome = await runCheckOut(store, { repository: TIMBER, selector: "fix/macos-portability", issue: "jira:TIM-80" }, pr(12, "fix/macos-portability"));
		expect(outcome).toMatchObject({ ok: false, failure: { diagnostic: expect.stringContaining("already linked to jira:TIM-88") } });
	});

	test("several pull requests are listed by number and branch; a fork's cannot be submitted, with its reason", () => {
		const choice = checkOutChoice(issue({ pullRequests: [pr(50, "fix/explain-arena", { draft: true }), pr(51, "patch-1", { fromFork: true })] }), HERE)!;
		const view = (picked: number) => renderToStaticMarkup(
			<CheckOutDialogView repository={TIMBER} keyLabel="#44" choice={choice} picked={picked} onPick={() => {}} submission={{ running: false, failure: null }} onSubmit={() => {}} onClose={() => {}} />,
		);
		const first = view(0);
		expect([...first.matchAll(/class="review-agent-name">([^<]*)</g)].map(match => match[1])).toEqual(["#50 fix/explain-arena", "#51 patch-1"]);
		expect(first).toContain(">draft<");
		expect(first).toContain(">cannot be opened here, from a fork<");
		expect(first).toContain(escaped("-- fix/explain-arena"));
		const fork = view(1);
		expect(fork).toContain(escaped(FORK_REFUSAL));
		expect(fork).toMatch(/<button type="submit" class="button primary" data-reserve="[^"]*" disabled=""/);
	});
});
