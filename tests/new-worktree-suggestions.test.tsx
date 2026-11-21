import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SUGGEST_DEBOUNCE_MS, createIssueSuggestions, suggestionTracker } from "../src/mainview/components/worktree-modes/issue-suggestions";
import { newBranchMode } from "../src/mainview/components/worktree-modes/new-branch";
import { createNewBranchModel } from "../src/mainview/components/worktree-modes/new-branch-model";
import { type MockEngine, createMockEngine } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import { createSubmission } from "../src/mainview/store/submission";
import type { NewWorktreeRequest } from "../src/shared/model";
import { manualClock } from "./support/clock";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";

/**
 * The "New branch" mode wired as the dialog wires it, with suggestions on a
 * clock the test moves. `type` does what the Name field and the hook do on
 * each change: edit the field, then tell the suggestions.
 */
async function dialog(engine: MockEngine = createMockEngine()) {
	const asked: NewWorktreeRequest[] = [];
	const { newWorktree } = engine;
	engine.newWorktree = request => (asked.push(request), newWorktree(request));
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	store.openDialog({ kind: "new-worktree", repository: TIMBER });
	const submission = createSubmission(toast => {
		store.showToast(toast);
		store.closeDialog();
	});
	const repository = store.getState().repositories.find(candidate => candidate.path === TIMBER)!;
	const model = createNewBranchModel(store, TIMBER);
	await model.readTrackers();
	const clock = manualClock();
	const suggestions = createIssueSuggestions({ search: request => store.searchIssues(request), repository: TIMBER, schedule: clock.schedule });
	const tell = () => {
		const { fields, trackers } = model.getState();
		suggestions.type(fields.name, suggestionTracker(trackers, fields.tracker));
	};
	const mode = () => newBranchMode(model, model.getState(), repository, submission, undefined, { controller: suggestions, state: suggestions.getState() });
	const fields = () => renderToStaticMarkup(<>{mode().fields}</>);
	const type = async (name: string) => {
		model.edit({ name });
		tell();
		clock.advance(SUGGEST_DEBOUNCE_MS);
		await settle();
	};
	const submit = async () => {
		const worked = await submission.submit(async () => (await mode().run()).outcome);
		await settle();
		return worked;
	};
	return { engine, model, suggestions, clock, mode, fields, type, tell, submit, asked };
}

describe("issue suggestions in the New branch form", () => {
	test("typing a key prefix lists close matches from the default tracker, with key, title, and status", async () => {
		const { engine, fields, type } = await dialog();
		await type("TIM-8");
		// The samples' timber repository has GitHub and Jira, with GitHub as Timber's default.
		expect(engine.issueSearches()).toEqual([{ repository: TIMBER, tracker: "github", text: "TIM-8" }]);
		await type("look");
		const markup = fields();
		expect(markup).toContain('role="listbox" aria-label="Issues to pick from"');
		expect(markup).toContain('<span class="suggestion-key">#41</span><span class="suggestion-title">Look up GitHub issues by number</span>');
	});

	test("the picked tracker is searched, title words match, and an issue with a worktree is marked", async () => {
		const { engine, model, fields, type } = await dialog();
		model.edit({ tracker: "jira" });
		await type("macos tools");
		expect(engine.issueSearches().at(-1)).toEqual({ repository: TIMBER, tracker: "jira", text: "macos tools" });
		const markup = fields();
		expect(markup).toContain(">TIM-88</span>");
		expect(markup).toContain('<span class="suggestion-mark" title="/work/timber-worktrees/fix-macos-portability">Has a worktree</span>');
		expect(markup).toContain('<span class="suggestion-status in-progress">In Review</span>');
	});

	test("arrow down and Enter fill the Name with the issue, the footer shows it, and the list closes", async () => {
		const { model, suggestions, mode, fields, type, tell, submit, asked } = await dialog();
		model.edit({ tracker: "jira" });
		await type("TIM-8");
		expect(suggestions.key("ArrowDown")).toBe(true);
		expect(suggestions.key("ArrowDown")).toBe(true);
		const picked = suggestions.key("Enter");
		expect(picked).toMatchObject({ key: "TIM-80" });
		model.edit({ name: suggestions.pick(picked as never) });
		tell();
		expect(model.getState().fields.name).toBe("jira:TIM-80");
		expect(mode().command).toBe("timber new --no-setup --result-file <temporary file> --no-editor --no-agent -- jira:TIM-80");
		expect(fields()).not.toContain('role="listbox"');
		await submit();
		expect(asked.map(request => request.name)).toEqual(["jira:TIM-80"]);
	});

	test("Enter with nothing highlighted is left to the form, which creates from the typed name", async () => {
		const { suggestions, type, submit, asked } = await dialog();
		await type("look");
		expect(suggestions.key("Enter")).toBe(false);
		await submit();
		expect(asked.map(request => request.name)).toEqual(["look"]);
	});

	test("sign-in needed: no list, a quiet hint, and a typed name still creates", async () => {
		const engine = createMockEngine();
		engine.setIssueSearch({ ok: true, outcome: "failed", reason: "sign-in-needed", diagnostic: "No GitHub login." });
		const { fields, type, submit, asked } = await dialog(engine);
		await type("login");
		const markup = fields();
		expect(markup).not.toContain('role="listbox"');
		expect(markup).toContain('<span class="suggestion-hint"> No suggestions: GitHub needs a sign-in. Run timber setup.</span>');
		await submit();
		expect(asked.map(request => request.name)).toEqual(["login"]);
	});

	test("a Timber without search: a quiet hint, and no more searches", async () => {
		const engine = createMockEngine();
		engine.setIssueSearch({ ok: false, unsupported: true, message: "This Timber has no timber __app-issues." });
		const { fields, type } = await dialog(engine);
		await type("login");
		await type("login bug");
		expect(engine.issueSearches()).toHaveLength(1);
		expect(fields()).toContain("Issue suggestions need a Timber built from its main branch.");
	});

	test("a search that never answers holds nothing up: the name, the footer, and Create all work", async () => {
		const engine = createMockEngine();
		engine.searchIssues = () => new Promise(() => {});
		const { model, mode, fields, type, submit, asked } = await dialog(engine);
		await type("Fix login bug");
		expect(model.getState().fields.name).toBe("Fix login bug");
		expect(mode().command).toBe("timber new --no-setup --result-file <temporary file> --no-editor --no-agent -- 'Fix login bug'");
		expect(fields()).not.toContain('role="listbox"');
		expect(mode().canSubmit).toBe(true);
		expect(await submit()).toBe(true);
		expect(asked.map(request => request.name)).toEqual(["Fix login bug"]);
	});
});
