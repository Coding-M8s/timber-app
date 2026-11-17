import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { WorktreeDialogFrame } from "../src/mainview/components/NewWorktreeDialog";
import { agentFollowUp, chosenAgent } from "../src/mainview/components/worktree-modes/agent-choice";
import { createWorktreeDialogController, pickOfOption } from "../src/mainview/components/worktree-modes/dialog-controller";
import { existingBranchMode } from "../src/mainview/components/worktree-modes/existing-branch";
import { createExistingBranchForm } from "../src/mainview/components/worktree-modes/existing-branch-form";
import { newBranchMode } from "../src/mainview/components/worktree-modes/new-branch";
import { createNewBranchModel } from "../src/mainview/components/worktree-modes/new-branch-model";
import { type MockEngine, createMockEngine } from "../src/mainview/engine/mock";
import { selectedWorktree } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { createSubmission } from "../src/mainview/store/submission";
import { AGENT_PRESETS } from "../src/shared/agent";
import type { NewWorktreeRequest, OpenWorktreeRequest } from "../src/shared/model";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
/** Has a worktree already. */
const FEATURE_BRANCH = "feat/github-issue-lookup";
/** A local branch with no worktree yet. */
const SPARE_BRANCH = "chore/update-deps";

/**
 * The New worktree dialog on the mock engine, wired as NewWorktreeDialog.tsx
 * wires it, without a window: one submission, both modes, the shared Agent
 * pick, and every run going through `runWithAgent`. `asked` holds every
 * Timber command the engine got.
 */
async function openedDialog(engine: MockEngine = createMockEngine()) {
	const asked: ({ kind: "new" } & NewWorktreeRequest | { kind: "open" } & OpenWorktreeRequest)[] = [];
	const { newWorktree, openWorktree } = engine;
	engine.newWorktree = request => (asked.push({ kind: "new", ...request }), newWorktree(request));
	engine.openWorktree = request => (asked.push({ kind: "open", ...request }), openWorktree(request));
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
	const form = createExistingBranchForm(store, TIMBER, submission);
	const modes = () => [
		newBranchMode(model, model.getState(), repository, submission),
		existingBranchMode(form, form.getState(), TIMBER, submission.getState().running),
	];
	// The wiring NewWorktreeDialog.tsx uses: the mode switch, the agent pick, and the submit that starts the agent.
	const controller = createWorktreeDialogController(store, TIMBER, submission);
	const submit = async () => {
		const worked = await controller.submit(modes()[controller.getState().selected]!);
		await settle();
		return worked;
	};
	const render = () => renderToStaticMarkup(
		<WorktreeDialogFrame
			repository={repository} modes={modes()} selected={controller.getState().selected} submission={submission.getState()}
			agents={store.getState().preferences.agents} agent={controller.agent()}
			onSelect={controller.select} onPickAgent={controller.pickAgent} onSubmit={mode => void controller.submit(mode)} onClose={() => {}}
		/>,
	);
	return {
		engine, store, model, form, asked, submit, render, modes, submission,
		controller,
		select: controller.select,
		pickAgent: controller.pickAgent,
		sessions: () => store.getState().terminals,
		selected: () => selectedWorktree(store.getState())?.worktree,
	};
}

describe("the agent to start", () => {
	test("is the first saved agent until the person picks one, and None is no agent", () => {
		expect(chosenAgent(AGENT_PRESETS, undefined)).toEqual(AGENT_PRESETS[0]!);
		expect(chosenAgent(AGENT_PRESETS, "Codex")).toEqual(AGENT_PRESETS[1]!);
		expect(chosenAgent(AGENT_PRESETS, null)).toBeNull();
	});

	test("falls back to the first agent when the picked one is no longer saved, and is none with no agents", () => {
		expect(chosenAgent(AGENT_PRESETS, "Removed")).toEqual(AGENT_PRESETS[0]!);
		expect(chosenAgent([], undefined)).toBeNull();
		expect(chosenAgent([], "Codex")).toBeNull();
	});

	test("is shown under the Timber command as its own line, worded for when it starts", () => {
		const codex = { name: "Codex", command: `codex --model "big one"` };
		expect(agentFollowUp(codex, "always")).toEqual({ note: "Then starts Codex in the new worktree:", command: "codex --model 'big one'" });
		expect(agentFollowUp(codex, "if-created")).toEqual({ note: "Then, if this creates a worktree, starts Codex in it:", command: "codex --model 'big one'" });
		expect(agentFollowUp(codex, "never")).toBeNull();
		expect(agentFollowUp(null, "always")).toBeNull();
		// A command that cannot be read is shown as typed. The main process refuses it when it would start.
		expect(agentFollowUp({ name: "Odd", command: `odd "open` }, "always")?.command).toBe(`odd "open`);
	});
});

describe("the dialog's wiring", () => {
	test("the real dialog draws the Agent field and the agent command", async () => {
		const { store } = await openedDialog();
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain('<select class="field-input" name="agent"><option value="Claude Code" selected="">Claude Code</option>');
		expect(markup).toContain('<p class="dialog-note">Then starts Claude Code in the new worktree:</p><pre class="dialog-command" aria-label="Command that will start next">claude</pre>');
	});

	test("reads the empty option as None and any other as the agent's name", () => {
		expect(pickOfOption("")).toBeNull();
		expect(pickOfOption("Codex")).toBe("Codex");
	});

	test("switching modes puts the failure away, and is not possible while a command runs", async () => {
		const { engine, model, controller, submit, submission } = await openedDialog();
		engine.endCommands("refused");
		model.edit({ name: "feat/login" });
		expect(await submit()).toBe(false);
		expect(submission.getState().failure).not.toBeNull();
		controller.select(1);
		expect(controller.getState().selected).toBe(1);
		expect(submission.getState().failure).toBeNull();

		let finish = () => {};
		void submission.submit(() => new Promise(resolve => {
			finish = () => resolve({ ok: false, failure: { command: null, diagnostic: "stop", output: null } });
		}));
		controller.select(0);
		expect(controller.getState().selected).toBe(1);
		finish();
	});

	test("starts the agent picked when the person submitted, even if the pick changes while the command runs", async () => {
		const { model, controller, modes, sessions } = await openedDialog();
		controller.pickAgent("Codex");
		model.edit({ name: "feat/login" });
		const running = controller.submit(modes()[0]!);
		controller.pickAgent(null);
		expect(await running).toBe(true);
		await settle();
		expect(sessions()).toHaveLength(1);
		expect(sessions()[0]).toMatchObject({ name: "Codex" });
	});
});

describe("the Agent field", () => {
	test("lists the saved agents, the first one picked, then None, in both modes", async () => {
		const { render, select } = await openedDialog();
		for (const index of [0, 1]) {
			select(index);
			const markup = render();
			expect(markup).toContain('<span class="field-label">Agent</span><select class="field-input" name="agent"><option value="Claude Code" selected="">Claude Code</option><option value="Codex">Codex</option><option value="">None</option></select>');
		}
	});

	test("shows the agent command after the Timber command, which stays as it was", async () => {
		const { render, model, select } = await openedDialog();
		model.edit({ name: "feat/login" });
		const created = render();
		expect(created).toContain('<pre class="dialog-command" aria-label="Command that will run">timber new --result-file &lt;temporary file&gt; --no-editor --no-agent -- feat/login</pre><p class="dialog-note">Then starts Claude Code in the new worktree:</p><pre class="dialog-command" aria-label="Command that will start next">claude</pre>');
		select(1);
		expect(render()).toContain('<p class="dialog-note">Then, if this creates a worktree, starts Claude Code in it:</p>');
	});

	test("with None picked, shows no agent command", async () => {
		const { render, pickAgent } = await openedDialog();
		pickAgent(null);
		const markup = render();
		expect(markup).toContain('<option value="" selected="">None</option>');
		expect(markup).not.toContain("Command that will start next");
	});

	test("with no saved agents, offers only None and says where to add one", async () => {
		const { store, render } = await openedDialog();
		await store.savePreferences({ agents: [] });
		const markup = render();
		expect(markup).toContain('<select class="field-input" name="agent"><option value="" selected="">None</option></select>');
		expect(markup).toContain("No agents are set up. Add one in Settings, Agents.");
		expect(markup).not.toContain("Command that will start next");
	});
});

describe("creating a worktree with an agent picked", () => {
	test("leaves the new worktree selected with that agent's session running, on the Workspace tab", async () => {
		const { store, model, submit, sessions, selected, pickAgent, asked } = await openedDialog();
		store.showTab("changes");
		pickAgent("Codex");
		model.edit({ name: "feat/login" });
		expect(await submit()).toBe(true);
		expect(asked).toEqual([{ kind: "new", repository: TIMBER, name: "feat/login", base: null }]);
		const worktree = selected()!;
		expect(worktree.branch).toBe("feat/login");
		expect(sessions()).toHaveLength(1);
		expect(sessions()[0]).toMatchObject({ kind: "agent", name: "Codex", worktree: worktree.id, path: worktree.path, state: { kind: "running" } });
		expect(store.getState().tab).toBe("workspace");
		expect(store.getState().dialog).toBeNull();
	});

	test("None starts no session", async () => {
		const { model, submit, sessions, selected, pickAgent } = await openedDialog();
		pickAgent(null);
		model.edit({ name: "feat/login" });
		expect(await submit()).toBe(true);
		expect(selected()?.branch).toBe("feat/login");
		expect(sessions()).toEqual([]);
	});

	test("a refused name starts nothing", async () => {
		const { engine, model, submit, sessions } = await openedDialog();
		engine.endCommands("refused");
		model.edit({ name: "feat/login" });
		expect(await submit()).toBe(false);
		expect(sessions()).toEqual([]);
	});

	test("a failed setup starts no agent, and a later Open with setup that works does", async () => {
		const { engine, model, submit, sessions, selected, asked } = await openedDialog();
		engine.endCommands("setup-fails");
		model.edit({ name: "feat/login" });
		expect(await submit()).toBe(false);
		expect(model.getState().step.kind).toBe("setup");
		expect(sessions()).toEqual([]);

		// Fails once more: still nothing.
		expect(await submit()).toBe(false);
		expect(sessions()).toEqual([]);

		engine.endCommands("succeeds");
		expect(await submit()).toBe(true);
		expect(asked.filter(command => command.kind === "new")).toHaveLength(1);
		expect(asked.at(-1)).toMatchObject({ kind: "open", setup: true });
		expect(sessions()).toHaveLength(1);
		expect(sessions()[0]).toMatchObject({ kind: "agent", name: "Claude Code", worktree: selected()!.id });
	});

	test("an agent whose executable is not found shows why in the pane and keeps the worktree", async () => {
		const { engine, store, model, submit, sessions, selected } = await openedDialog();
		engine.missingExecutables(["claude"]);
		model.edit({ name: "feat/login" });
		expect(await submit()).toBe(true);
		const worktree = selected()!;
		expect(worktree.branch).toBe("feat/login");
		expect(sessions()).toEqual([]);
		expect(store.getState().terminalProblem).toMatchObject({ worktree: worktree.id, agent: "Claude Code", command: "claude" });
		expect(store.getState().dialog).toBeNull();
		expect(store.getState().toasts.map(toast => toast.text)).toEqual(["Created worktree feat/login"]);
	});

	test("when the list cannot be read again, starts nothing and the toast says so", async () => {
		const { engine, store, model, submit, sessions } = await openedDialog();
		engine.loadRepository = async () => {
			throw new Error("Git is busy");
		};
		model.edit({ name: "feat/login" });
		expect(await submit()).toBe(true);
		expect(sessions()).toEqual([]);
		expect(store.getState().toasts.map(toast => toast.text)).toEqual([
			"Created worktree feat/login. Claude Code did not start: the worktree is not in the list yet. Refresh, then start it from the worktree.",
		]);
	});
});

describe("opening an existing branch with an agent picked", () => {
	test("starts the agent when Timber created the worktree", async () => {
		const { form, submit, sessions, selected, select } = await openedDialog();
		select(1);
		form.setSelector(SPARE_BRANCH);
		expect(await submit()).toBe(true);
		expect(selected()?.branch).toBe(SPARE_BRANCH);
		expect(sessions()).toHaveLength(1);
		expect(sessions()[0]).toMatchObject({ kind: "agent", name: "Claude Code", worktree: selected()!.id });
	});

	test("starts nothing when the worktree was already there", async () => {
		const { form, submit, sessions, selected, select, store } = await openedDialog();
		select(1);
		form.setSelector(FEATURE_BRANCH);
		expect(await submit()).toBe(true);
		expect(selected()?.branch).toBe(FEATURE_BRANCH);
		expect(sessions()).toEqual([]);
		expect(store.getState().toasts.map(toast => toast.text)).toEqual([`Opened ${FEATURE_BRANCH}. Its worktree was already there.`]);
	});

	test("starts the agent once setup finishes in a worktree it created, even after setup failed twice", async () => {
		const { engine, form, submit, sessions, select, render } = await openedDialog();
		select(1);
		engine.endCommands("setup-fails");
		form.setSelector(SPARE_BRANCH);
		expect(await submit()).toBe(false);
		expect(form.getState().kept?.created).toBe(true);
		expect(render()).toContain('<p class="dialog-note">Then starts Claude Code in the new worktree:</p>');
		expect(await submit()).toBe(false);
		// The second failure still knows this dialog created it.
		expect(form.getState().kept?.created).toBe(true);
		expect(render()).toContain("The worktree was created, but setup failed");
		expect(sessions()).toEqual([]);

		engine.endCommands("succeeds");
		expect(await submit()).toBe(true);
		expect(sessions()).toHaveLength(1);
	});

	test("starts nothing after setup finishes in a worktree that was already there", async () => {
		const { engine, form, submit, sessions, select, render } = await openedDialog();
		select(1);
		engine.endCommands("setup-fails");
		form.setSelector(FEATURE_BRANCH);
		form.setSetup(true);
		expect(await submit()).toBe(false);
		expect(form.getState().kept?.created).toBe(false);
		expect(render()).not.toContain("Command that will start next");

		engine.endCommands("succeeds");
		expect(await submit()).toBe(true);
		expect(sessions()).toEqual([]);
	});

	test("a run in between that names no worktree does not forget that the dialog created it", async () => {
		const { engine, form, submit, sessions, select, render, store } = await openedDialog();
		select(1);
		engine.endCommands("setup-fails");
		form.setSelector(SPARE_BRANCH);
		expect(await submit()).toBe(false);
		for (const ending of ["refused", "no-result"] as const) {
			engine.endCommands(ending);
			expect(await submit()).toBe(false);
			expect(form.getState().kept?.created).toBe(true);
			expect(render()).toContain('<p class="dialog-note">Then starts Claude Code in the new worktree:</p>');
		}
		engine.endCommands("succeeds");
		expect(await submit()).toBe(true);
		expect(sessions()).toHaveLength(1);
		expect(store.getState().toasts.map(toast => toast.text)).toEqual([`Setup finished in ${SPARE_BRANCH}`]);
	});

	test("an edit after a created worktree's failed setup puts away what the dialog knew", async () => {
		const { engine, form, submit, sessions, select } = await openedDialog();
		select(1);
		engine.endCommands("setup-fails");
		form.setSelector(SPARE_BRANCH);
		expect(await submit()).toBe(false);
		const path = form.getState().selector;
		// Typed again, the same text now names a worktree that is already there.
		form.setSelector(path);
		engine.endCommands("succeeds");
		expect(await submit()).toBe(true);
		expect(sessions()).toEqual([]);
	});
});
