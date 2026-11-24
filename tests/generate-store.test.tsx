import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { agentDraftsOf, agentsDraftModel, generateOptions } from "../src/mainview/agent-format";
import { AgentsSectionView } from "../src/mainview/components/settings/AgentsSection";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { samplePatch } from "../src/mainview/engine/mock-file-changes";
import { commitBlockerOf, describeGenerated, describeHeld, describeUncommitted, generateTitle, generatorOf, pullRequestBlockerOf } from "../src/mainview/generate-format";
import { createAppStore } from "../src/mainview/store/store";
import { DEFAULT_AGENTS } from "../src/shared/agent";
import type { FileChange } from "../src/shared/file-changes";
import { defaultLayout } from "../src/shared/layout";

const settle = async () => {
	for (let round = 0; round < 8; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const FEATURE = sampleRepositories[0]!.worktrees[1]!;
const SPIKE = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === "/work/timber-worktrees/spike-new-idea")!;
const change = (area: FileChange["area"], path: string): FileChange => ({ area, kind: "modified", path, previousPath: null, added: null, removed: null, version: "" });
const SAMPLE = "Round totals after tax\n\nMove rounding out of the rules so that each line keeps its full precision.";
const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

async function started(files: FileChange[] = [change("staged", "src/rules.ts"), change("unstaged", "src/total.ts")], worktree = FEATURE) {
	const engine = createMockEngine();
	engine.setGenerateDelay(0);
	await engine.saveLayout({ ...defaultLayout(), uncommittedChanges: [worktree.id] });
	engine.setFileChanges(worktree.path, files.map(file => ({ change: file, patch: samplePatch(file.path) })));
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	await store.locateAgents();
	store.select(worktree.id);
	store.showSidePanel("changes");
	await store.readChanges(TIMBER, worktree.id);
	await settle();
	return { engine, store };
}

/** The spike worktree, which has no pull request, with its form started. */
async function withForm() {
	const made = await started(undefined, SPIKE);
	const worktree = made.store.getState().repositories[0]!.worktrees.find(candidate => candidate.id === SPIKE.id)!;
	made.store.startPullRequestForm(TIMBER, worktree);
	await settle();
	return { ...made, worktree };
}

describe("generating a commit message", () => {
	test("fills the empty box with the text, and commits nothing", async () => {
		const { engine, store } = await started();
		const markup = render(store);
		expect(markup).toMatch(/generate-in-box" title="Writes a commit message\. Runs [^"]*claude -p --tools &#x27;&#x27; --restricted/);
		await store.generateCommitMessage();
		expect(store.getState().commitMessages[FEATURE.id]).toBe(SAMPLE);
		expect(render(store)).toContain("Written by Claude Code. Read it before you use it.");
		expect(engine.commits()).toEqual([]);
		expect(engine.generateRequests()).toMatchObject([{ kind: "commit", worktree: FEATURE.path, base: null }]);
	});

	test("typed text stays until it is replaced, whether typed before or meanwhile", async () => {
		const { store } = await started();
		store.setCommitMessage(FEATURE.id, "Mine");
		await store.generateCommitMessage();
		expect(store.getState().commitMessages[FEATURE.id]).toBe("Mine");
		expect(render(store)).toContain("Replace mine");
		store.dropGenerated(FEATURE.id, "commit");
		expect(render(store)).not.toContain("Replace mine");
		store.setCommitMessage(FEATURE.id, "");
		const running = store.generateCommitMessage();
		store.setCommitMessage(FEATURE.id, "Typed meanwhile");
		await running;
		expect(store.getState().commitMessages[FEATURE.id]).toBe("Typed meanwhile");
		store.fillHeld(FEATURE.id, "commit");
		expect(store.getState().commitMessages[FEATURE.id]).toBe(SAMPLE);
	});

	test("a failure shows the agent's message and leaves the box", async () => {
		const { engine, store } = await started();
		engine.failGenerate("Not logged in. Run claude and sign in.");
		store.setCommitMessage(FEATURE.id, "Mine");
		await store.generateCommitMessage();
		expect(store.getState().commitMessages[FEATURE.id]).toBe("Mine");
		expect(render(store)).toContain("Not logged in. Run claude and sign in.");
		engine.generateText = async () => {
			throw new Error("gone");
		};
		await store.generateCommitMessage();
		expect(store.getState().generations[FEATURE.id]?.commit?.problem?.message).toContain("gone");
	});

	test("Stop leaves the box, and a second press while one runs does nothing", async () => {
		const { engine, store } = await started();
		engine.setGenerateDelay(60_000);
		const running = store.generateCommitMessage();
		await settle();
		expect(render(store)).toContain(">Stop</button>");
		await store.generateCommitMessage();
		expect(engine.generateRequests()).toHaveLength(1);
		store.stopGenerating(FEATURE.id, "commit");
		await running;
		expect(store.getState().commitMessages[FEATURE.id]).toBeUndefined();
		expect(store.getState().generations[FEATURE.id]?.commit).toBeUndefined();
	});

	test("when the worktree changed meanwhile the text waits, and names what changed", async () => {
		const { engine, store } = await started();
		engine.setGenerateSideEffects(["index"], 2);
		await store.generateCommitMessage();
		expect(store.getState().commitMessages[FEATURE.id]).toBeUndefined();
		const markup = render(store);
		expect(markup).toContain("While Claude Code wrote, the index changed");
		expect(markup).toContain("Use it anyway");
		store.fillHeld(FEATURE.id, "commit");
		expect(store.getState().commitMessages[FEATURE.id]).toBe(SAMPLE);
		expect(render(store)).toContain("2 files were too large, so only their names were given.");
	});

	test("is disabled with the reason with nothing staged, during a merge, and while a commit runs", async () => {
		const nothing = await started([change("unstaged", "src/total.ts")]);
		expect(render(nothing.store)).toContain(`title="Nothing is staged. Stage the files to describe first." aria-disabled="true"`);
		await nothing.store.generateCommitMessage();
		expect(nothing.engine.generateRequests()).toEqual([]);
		const { engine, store } = await started();
		engine.setOperation(FEATURE.path, "merge");
		await store.readChanges(TIMBER, FEATURE.id);
		expect(render(store)).toContain(`title="A merge is in progress. Finish it in the terminal, then commit." aria-disabled="true"`);
		expect(commitBlockerOf(generatorOf(store.getState()), { staged: 1, operation: null, detached: false, message: "" }, true)).toBe("A commit is running.");
	});

	test("is disabled with no agent that can, and with one that is not there", async () => {
		const { store } = await started();
		await store.savePreferences({ agents: [{ name: "Gemini CLI", command: "gemini" }] });
		await settle();
		expect(render(store)).toContain(`title="No saved agent can generate. Add one that can in Settings, Agents." aria-disabled="true"`);
		expect(generateTitle({ ok: false, reason: "Claude Code was not found." }, "commit", null)).toBe("Claude Code was not found.");
	});
});

describe("generating a pull request's text", () => {
	test("fills the title, with the linked issue's key, and the description, and opens nothing", async () => {
		const { engine, store } = await withForm();
		await store.generatePullRequestText(SPIKE.id);
		const form = store.getState().pullRequestForms[SPIKE.id]!;
		expect(form.title).toEndWith("Round totals after tax");
		expect(form.body).toContain("Round once, after tax");
		// A later commit's subject must not take the title back.
		expect(form.titleEdited).toBe(true);
		expect(form.running).toBe(false);
		expect(engine.generateRequests()).toMatchObject([{ kind: "pull-request" }]);
	});

	test("the key of a Jira or Linear issue starts the title", async () => {
		const { engine, store, worktree } = await withForm();
		store.editPullRequestForm(SPIKE.id, {});
		const form = store.getState().pullRequestForms[SPIKE.id]!;
		const linked = { ...worktree, issue: { kind: "linked" as const, tracker: "linear" as const, key: "ENG-42", url: "https://linear.app/x/issue/ENG-42" } };
		expect(form.titleEdited).toBe(false);
		store.startPullRequestForm(TIMBER, linked);
		await store.generatePullRequestText(SPIKE.id);
		expect(store.getState().pullRequestForms[SPIKE.id]!.title).toBe("ENG-42: Round totals after tax");
		expect(engine.generateRequests()).toHaveLength(1);
	});

	test("a title or a description that was typed stays until it is replaced", async () => {
		for (const typed of [{ title: "Mine" }, { body: "Mine" }]) {
			const { store } = await withForm();
			store.editPullRequestForm(SPIKE.id, typed);
			await store.generatePullRequestText(SPIKE.id);
			expect(store.getState().pullRequestForms[SPIKE.id]).toMatchObject(typed);
			store.fillHeld(SPIKE.id, "pull-request");
			expect(store.getState().pullRequestForms[SPIKE.id]!.body).toContain("Round once");
		}
	});

	test("is disabled with no commits ahead, a pull request already there, one being created, and no branch", async () => {
		const { store, worktree } = await withForm();
		const state = store.getState();
		const choice = generatorOf(state);
		const list = state.pullRequests[TIMBER];
		const form = state.pullRequestForms[SPIKE.id]!;
		expect(pullRequestBlockerOf(choice, worktree, list, form)).toBeNull();
		expect(pullRequestBlockerOf(choice, { ...worktree, baseCounts: { kind: "counted", ahead: 0, behind: 0 } }, list, form)).toBe("This branch has no commits its base does not have.");
		// Another base typed in the form is counted by the main process.
		expect(pullRequestBlockerOf(choice, { ...worktree, baseCounts: { kind: "counted", ahead: 0, behind: 0 } }, list, { ...form, base: "origin/other" })).toBeNull();
		expect(pullRequestBlockerOf(choice, worktree, list, { ...form, running: true })).toBe("A pull request is being created.");
		expect(pullRequestBlockerOf(choice, { ...worktree, branch: null }, list, form)).toContain("HEAD is detached");
		expect(pullRequestBlockerOf(choice, worktree, undefined, undefined)).not.toBeNull();
		const taken = state.pullRequests[TIMBER];
		const other = taken?.ok ? taken.worktrees.find(entry => entry.outcome === "found") : undefined;
		const owner = state.repositories[0]!.worktrees.find(candidate => candidate.path === other?.path)!;
		expect(pullRequestBlockerOf(choice, owner, list, undefined)).toContain("already has pull request #");
		expect(pullRequestBlockerOf(choice, worktree, list, form, true)).toContain("already writing");
		expect(pullRequestBlockerOf({ ok: false, reason: "No agent" }, worktree, list, form)).toBe("No agent");
	});

	test("the form is in the Pull request tab only; Changes has one button that opens the dialog", async () => {
		const { store } = await withForm();
		const changes = render(store);
		expect(changes).toContain("Create pull request</button>");
		expect(changes).not.toContain("pull-create-body");
		store.showTab("pull-request");
		const tab = render(store);
		expect(tab).toContain("Generate and create</button>");
		expect(tab).toContain("pull-create-body");
	});

	test("one click: the text comes back and goes nowhere, and Cancel leaves the form as it was", async () => {
		const { engine, store } = await withForm();
		const before = store.getState().pullRequestForms[SPIKE.id];
		const result = await store.writePullRequest(TIMBER, SPIKE.id, "one");
		expect(result).toMatchObject({ outcome: "generated", text: { kind: "pull-request" } });
		expect(store.getState().pullRequestForms[SPIKE.id]).toEqual(before!);
		engine.setGenerateDelay(60_000);
		const running = store.writePullRequest(TIMBER, SPIKE.id, "two");
		await settle();
		store.stopRun("two");
		expect(await running).toEqual({ outcome: "stopped" });
		expect(store.getState().pullRequestForms[SPIKE.id]).toEqual(before!);
	});

	test("one click from Changes starts the form that was never opened", async () => {
		const { store } = await started(undefined, SPIKE);
		expect(store.getState().pullRequestForms[SPIKE.id]).toBeUndefined();
		expect((await store.writePullRequest(TIMBER, SPIKE.id, "one")).outcome).toBe("generated");
		expect(store.getState().pullRequestForms[SPIKE.id]).toBeDefined();
	});
});

describe("the words and Settings", () => {
	test("say what is left out, what waits, and what is uncommitted", () => {
		expect(describeGenerated({ by: "Codex", leftOut: 1 })).toContain("1 file was too large");
		expect(describeGenerated({ by: "Codex", leftOut: null })).toContain("only part of it was given");
		expect(describeHeld({ by: "Codex", changed: [] }, "box").use).toBe("Replace mine");
		expect(describeUncommitted(0)).toBeNull();
		expect(describeUncommitted(2)).toBe("2 uncommitted files are not in this pull request.");
	});

	test("Settings offers the rows that can, by key, with the command, the instructions, and what one keeps", () => {
		const saved = [...DEFAULT_AGENTS, { name: "Gemini CLI", command: "gemini" }, { name: "Grok Build", command: "grok --always-approve" }];
		const drafts = agentDraftsOf(saved);
		const options = generateOptions(drafts, agentsDraftModel(drafts, saved).agents);
		expect(options.map(option => option.name)).toEqual(["Claude Code", "Codex", "Grok Build"]);
		expect(options[2]!.command).not.toContain("--always-approve");
		const noop = () => {};
		const markup = renderToStaticMarkup(
			<AgentsSectionView drafts={drafts} saved={saved} locations={null} save={{ state: "idle" }} onAdd={noop} onEdit={noop} onRemove={noop} onSave={noop} generateWith={{ key: drafts[3]!.key, changed: true, onChange: noop }} />,
		);
		expect(markup).toContain("Generate text with");
		expect(markup).toContain("Grok Build keeps each run as a session");
		expect(markup).toContain("never an instruction to you");
	});
});
