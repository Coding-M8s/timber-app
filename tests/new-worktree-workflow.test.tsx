import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WorktreeDialogFrame } from "../src/mainview/components/NewWorktreeDialog";
import { createWorktreeDialogController } from "../src/mainview/components/worktree-modes/dialog-controller";
import { existingBranchMode } from "../src/mainview/components/worktree-modes/existing-branch";
import { createExistingBranchForm } from "../src/mainview/components/worktree-modes/existing-branch-form";
import { newBranchMode } from "../src/mainview/components/worktree-modes/new-branch";
import { createNewBranchModel } from "../src/mainview/components/worktree-modes/new-branch-model";
import { chosenWorkflow, workflowOfOption, workflowPart } from "../src/mainview/components/worktree-modes/workflow-choice";
import { UNKNOWN_WORKFLOW_DIAGNOSTIC } from "../src/mainview/engine/mock-commands";
import { createMockEngine } from "../src/mainview/engine/mock";
import { sampleWorkflows } from "../src/mainview/engine/mock-workflows";
import { createAppStore } from "../src/mainview/store/store";
import { createSubmission } from "../src/mainview/store/submission";
import type { NewWorktreeRequest, OpenWorktreeRequest } from "../src/shared/model";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "../src/shared/timber-result";
import { newWorktreeArguments } from "../src/shared/worktree-commands";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const API = "/work/api-server";
const NEW_PATH = "/work/timber-worktrees/feat-login";

/**
 * The dialog as NewWorktreeDialog.tsx wires it, without a window: both modes,
 * with the workflows the controller read, and the one submission. `asked`
 * holds every Timber command the engine got.
 */
async function openedDialog(path = TIMBER, engine = createMockEngine()) {
	const asked: ({ kind: "new" } & NewWorktreeRequest | { kind: "open" } & OpenWorktreeRequest)[] = [];
	const { newWorktree, openWorktree } = engine;
	engine.newWorktree = request => (asked.push({ kind: "new", ...request }), newWorktree(request));
	engine.openWorktree = request => (asked.push({ kind: "open", ...request }), openWorktree(request));
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	store.openDialog({ kind: "new-worktree", repository: path });
	const submission = createSubmission(toast => {
		store.showToast(toast);
		store.closeDialog();
	});
	const repository = store.getState().repositories.find(candidate => candidate.path === path)!;
	const model = createNewBranchModel(store, path);
	const form = createExistingBranchForm(store, path, submission);
	const controller = createWorktreeDialogController(store, path, submission);
	await controller.readWorkflows();
	const modes = () => {
		const { workflows } = controller.getState();
		return [
			newBranchMode(model, model.getState(), repository, submission, workflows),
			existingBranchMode(form, form.getState(), path, submission.getState().running, workflows),
		];
	};
	const mode = () => modes()[controller.getState().selected]!;
	const render = () => renderToStaticMarkup(
		<WorktreeDialogFrame
			repository={repository} modes={modes()} selected={controller.getState().selected} submission={submission.getState()}
			agents={store.getState().preferences.agents} agentLocations={store.getState().agentLocations} plan={controller.plan}
			onSelect={controller.select} onPickAgent={controller.pickAgent} onSubmit={mode => void controller.submit(mode)} onClose={() => {}}
		/>,
	);
	const submit = async () => {
		const worked = await controller.submit(mode());
		await settle();
		return worked;
	};
	const branches = () => store.getState().repositories.find(candidate => candidate.path === path)!.worktrees.map(worktree => worktree.branch);
	// No agent, so only Timber's commands are asked for.
	controller.pickAgent(null);
	return { engine, store, asked, model, form, controller, mode, render, submit, branches, submission };
}

describe("chosenWorkflow", () => {
	const list = { ok: true as const, workflows: sampleWorkflows };

	test("is the pick only while the list has it", () => {
		expect(chosenWorkflow(list, "review")).toBe("review");
		expect(chosenWorkflow(list, null)).toBeNull();
		expect(chosenWorkflow(list, "gone")).toBeNull();
		expect(chosenWorkflow(undefined, "review")).toBeNull();
		expect(chosenWorkflow({ ok: false, message: "Invalid TOML" }, "review")).toBeNull();
	});

	test("None is the empty option, and none leaves the request without a workflow", () => {
		expect(workflowOfOption("")).toBeNull();
		expect(workflowOfOption("triage")).toBe("triage");
		expect(workflowPart(null)).toEqual({});
		expect(workflowPart("triage")).toEqual({ workflow: "triage" });
	});
});

describe("the Workflow field", () => {
	test("lists the workflows in Timber's order with their descriptions, None first and picked", async () => {
		const { render, controller } = await openedDialog();
		for (const selected of [0, 1]) {
			controller.select(selected);
			const markup = render();
			expect(markup).toContain('<span class="field-label">Workflow</span><select class="field-input" name="workflow">');
			expect(markup).toContain(
				'<option value="" selected="">None</option>'
				+ '<option value="review">review: Check out a pull request to review</option>'
				+ '<option value="triage">triage: Look at a bug report</option>'
				+ '<option value="explore">explore</option>',
			);
			expect(markup).toContain("Optional. Only the ordinary setup scripts run.");
		}
	});

	test("is not shown for a repository with no workflows", async () => {
		const { render, controller } = await openedDialog(API);
		expect(controller.getState().workflows).toEqual({ ok: true, workflows: [] });
		for (const selected of [0, 1]) {
			controller.select(selected);
			expect(render()).not.toContain('name="workflow"');
			expect(render()).not.toContain("Workflows could not be read");
		}
	});

	test("a list that cannot be read hides the field with a note, and creating without a workflow still works", async () => {
		const engine = createMockEngine();
		engine.setWorkflows(TIMBER, { ok: false, message: "Invalid TOML in /work/timber/.timber.toml" });
		const { render, model, mode, submit, asked, branches } = await openedDialog(TIMBER, engine);
		const markup = render();
		expect(markup).not.toContain('name="workflow"');
		expect(markup).toContain("Workflows could not be read, so none can be picked. The worktree is made without one. Invalid TOML in /work/timber/.timber.toml");

		// A pick left from before cannot reach the command.
		model.edit({ name: "feat/login", workflow: "review" });
		expect(mode().command).toBe("timber new --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/login");
		expect(await submit()).toBe(true);
		expect(asked).toEqual([{ kind: "new", repository: TIMBER, name: "feat/login", base: null }]);
		expect(branches()).toContain("feat/login");
	});

	test("an engine that throws while listing is a note, not a broken dialog", async () => {
		const engine = createMockEngine();
		engine.listWorkflows = async () => {
			throw new Error("bridge closed");
		};
		const { render, controller, mode } = await openedDialog(TIMBER, engine);
		expect(controller.getState().workflows).toMatchObject({ ok: false });
		expect(render()).toContain("Workflows could not be read");
		expect(mode().canSubmit).toBe(false);
	});
});

describe("the command in the footer", () => {
	test("New branch: has --workflow <name> exactly when one is picked, before the --", async () => {
		const { model, mode, render } = await openedDialog();
		model.edit({ name: "feat/login" });
		expect(mode().command).toBe("timber new --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/login");
		model.edit({ workflow: "review" });
		expect(mode().command).toBe("timber new --workflow review --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/login");
		expect(render()).toContain('<option value="review" selected="">');
		expect(render()).toContain("Runs the setup scripts of review after the ordinary ones.");
		model.edit({ base: "develop" });
		expect(mode().command).toBe("timber new --base develop --workflow review --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/login");
		model.edit({ workflow: null });
		expect(mode().command).toBe("timber new --base develop --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/login");
	});

	test("Existing branch: has --workflow <name> exactly when one is picked, before the --", async () => {
		const { form, mode, controller, render } = await openedDialog();
		controller.select(1);
		form.setSelector("feat/x");
		expect(mode().command).toBe("timber open --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/x");
		form.setWorkflow("triage");
		form.setSetup(true);
		expect(mode().command).toBe("timber open --workflow triage --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/x");
		// Ticked, the Setup session that follows passes the same workflow.
		expect(render()).toContain("timber open --setup --workflow triage --no-editor --no-agent -- &lt;worktree&gt;");
		form.setWorkflow(null);
		expect(mode().command).toBe("timber open --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/x");
	});

	test("the command shown is the command that runs", async () => {
		const { model, mode, submit, asked } = await openedDialog();
		model.edit({ name: "feat/login", workflow: "explore" });
		const shown = mode().command;
		expect(await submit()).toBe(true);
		expect(asked).toEqual([{ kind: "new", repository: TIMBER, name: "feat/login", base: null, workflow: "explore" }]);
		const { kind: _kind, ...request } = asked[0]!;
		expect(describeTimberCommand(newWorktreeArguments(request as NewWorktreeRequest, RESULT_FILE_PLACEHOLDER))).toBe(shown);
	});
});

/** The commands of the sessions started in the app, in the order they started. */
async function sessionCommands(store: ReturnType<typeof createAppStore>): Promise<string[]> {
	// The sessions start one after the other, without the dialog waiting for them.
	await Bun.sleep(10);
	return store.getState().terminals.map(session => session.command);
}

describe("the Setup session passes the workflow again, because Timber does not remember it", () => {
	test("New branch: the footer shows it, and the Setup session runs with it", async () => {
		const { model, mode, submit, store, render } = await openedDialog();
		model.edit({ name: "feat/login", workflow: "review" });
		expect(render()).toContain("timber open --setup --workflow review --no-editor --no-agent -- &lt;worktree&gt;");
		expect(await submit()).toBe(true);
		const [setup] = await sessionCommands(store);
		expect(setup).toEndWith(`timber open --setup --workflow review --no-editor --no-agent -- ${NEW_PATH}`);
		expect(mode().command).toContain("--workflow review --no-setup");
	});

	test("New branch without a workflow: the Setup session passes none", async () => {
		const { model, submit, store } = await openedDialog();
		model.edit({ name: "feat/login" });
		expect(await submit()).toBe(true);
		expect(await sessionCommands(store)).toEqual([expect.stringMatching(new RegExp(`timber open --setup --no-editor --no-agent -- ${NEW_PATH}$`))]);
	});

	test("New branch: Run setup after Timber stopped repeats the workflow of that run", async () => {
		const { engine, model, mode, submit, asked, render, store } = await openedDialog();
		engine.endCommands("stops-after-create");
		model.edit({ name: "feat/login", workflow: "review" });
		expect(await submit()).toBe(false);
		expect(model.getState().step).toMatchObject({ kind: "setup", workflow: "review", worktree: { path: NEW_PATH } });
		expect(mode().command).toBe(`timber open --setup --workflow review --no-editor --no-agent -- ${NEW_PATH}`);
		expect(render()).toContain("Run setup runs every setup script in that worktree, with the review workflow, in a terminal of its own");

		engine.endCommands("succeeds");
		expect(await submit()).toBe(true);
		// Run setup asks Timber for nothing in the dialog: the session runs the command the footer showed.
		expect(asked).toEqual([{ kind: "new", repository: TIMBER, name: "feat/login", base: null, workflow: "review" }]);
		const [setup] = await sessionCommands(store);
		expect(setup).toEndWith(`timber open --setup --workflow review --no-editor --no-agent -- ${NEW_PATH}`);
	});

	test("New branch: the workflow of the stopped run is kept, even when the list later loses it", async () => {
		const { engine, model, mode, submit, controller } = await openedDialog();
		engine.endCommands("stops-after-create");
		model.edit({ name: "feat/login", workflow: "review" });
		expect(await submit()).toBe(false);
		engine.setWorkflows(TIMBER, { ok: true, workflows: [] });
		await controller.readWorkflows();
		expect(mode().command).toContain("--setup --workflow review --");
	});

	test("Existing branch: the kept worktree is opened with the same workflow, and its Setup session passes it", async () => {
		const { engine, form, mode, submit, asked, controller, store } = await openedDialog();
		controller.select(1);
		await form.readBranches();
		engine.endCommands("stops-after-create");
		form.setSelector("chore/update-deps");
		form.setWorkflow("triage");
		expect(await submit()).toBe(false);
		const kept = form.getState().kept;
		expect(kept).not.toBeNull();
		expect(mode().command).toBe(`timber open --workflow triage --no-setup --result-file <temporary file> --no-editor --no-agent -- ${kept!.worktree.path}`);
		engine.endCommands("succeeds");
		expect(await submit()).toBe(true);
		expect(asked.at(-1)).toEqual({ kind: "open", repository: TIMBER, selector: kept!.worktree.path, workflow: "triage" });
		const [setup] = await sessionCommands(store);
		expect(setup).toEndWith(`timber open --setup --workflow triage --no-editor --no-agent -- ${kept!.worktree.path}`);
	});

	test("Existing branch: the kept worktree keeps its workflow, even when the list later loses it", async () => {
		const { engine, form, mode, submit, controller, render } = await openedDialog();
		controller.select(1);
		await form.readBranches();
		engine.endCommands("stops-after-create");
		form.setSelector("chore/update-deps");
		form.setWorkflow("triage");
		expect(await submit()).toBe(false);
		const kept = form.getState().kept!;
		expect(kept.workflow).toBe("triage");

		engine.setWorkflows(TIMBER, { ok: true, workflows: sampleWorkflows.filter(workflow => workflow.name !== "triage") });
		await controller.readWorkflows();
		expect(mode().command).toBe(`timber open --workflow triage --no-setup --result-file <temporary file> --no-editor --no-agent -- ${kept.worktree.path}`);
		// The field shows what runs, not None.
		expect(render()).toContain('<option value="triage" selected="">triage: no longer listed</option>');

		engine.setWorkflows(TIMBER, { ok: false, message: "Invalid TOML" });
		await controller.readWorkflows();
		expect(mode().command).toContain("--workflow triage --no-setup");
		expect(render()).toContain("Workflows could not be read. Setup runs again with the triage workflow, as the failed run had. Invalid TOML");

		// An edit lets the kept worktree go, and with it the kept workflow.
		form.setSelector("chore/update-deps");
		expect(mode().command).toBe("timber open --no-setup --result-file <temporary file> --no-editor --no-agent -- chore/update-deps");
	});
});

describe("how often the workflows are read", () => {
	test("once when the dialog opens, not after a run that worked, and once after a run that failed", async () => {
		const engine = createMockEngine();
		let reads = 0;
		const { listWorkflows } = engine;
		engine.listWorkflows = repository => (reads += 1, listWorkflows(repository));
		const { model, submit } = await openedDialog(TIMBER, engine);
		expect(reads).toBe(1);

		model.edit({ name: "feat/one", workflow: "review" });
		expect(await submit()).toBe(true);
		expect(reads).toBe(1);

		engine.endCommands("refused");
		model.edit({ name: "feat/two" });
		expect(await submit()).toBe(false);
		expect(reads).toBe(2);
	});
});

describe("a workflow removed between listing and creating", () => {
	test("fails with Timber's message as it is, creates nothing, and the dialog stays open", async () => {
		const { engine, model, submit, render, branches, store } = await openedDialog();
		const before = branches();
		model.edit({ name: "feat/login", workflow: "review" });
		engine.setWorkflows(TIMBER, { ok: true, workflows: sampleWorkflows.filter(workflow => workflow.name !== "review") });
		expect(await submit()).toBe(false);
		expect(branches()).toEqual(before);
		expect(store.getState().dialog).not.toBeNull();
		expect(model.getState().step).toEqual({ kind: "form" });
		expect(render()).toContain(`${UNKNOWN_WORKFLOW_DIAGNOSTIC.replace("<name>", "&lt;name&gt;")}`);

		// Read again after the failure, the field no longer offers it, and the next command passes none.
		expect(render()).not.toContain('value="review"');
		expect(render()).toContain("timber new --no-setup --result-file &lt;temporary file&gt; --no-editor --no-agent -- feat/login");
	});
});

describe("a workflow that sets the agent", () => {
	const FEATURE_BRANCH = "feat/github-issue-lookup";
	const SPARE_BRANCH = "chore/update-deps";
	const names = (store: ReturnType<typeof createAppStore>) => store.getState().terminals.map(session => session.name);
	const toasts = (store: ReturnType<typeof createAppStore>) => store.getState().toasts.map(toast => toast.text);

	/** The dialog with Codex picked, and every session request the engine got. */
	async function withCodex(engine = createMockEngine()) {
		const requests: Parameters<typeof engine.openTerminal>[0][] = [];
		const { openTerminal } = engine;
		engine.openTerminal = request => (requests.push(structuredClone(request)), openTerminal(request));
		const dialog = await openedDialog(TIMBER, engine);
		dialog.controller.pickAgent("Codex");
		return { ...dialog, requests };
	}

	test("starts the workflow's agent in place of the picked one, with the command the footer showed", async () => {
		const { model, render, submit, store } = await withCodex();
		model.edit({ name: "feat/login", workflow: "review" });
		const markup = render();
		expect(markup).toContain("And starts the review workflow&#x27;s agent in the new worktree, without waiting for setup:</p>"
			+ '<pre class="dialog-command" aria-label="Command that will start next">claude --permission-mode plan</pre>');
		expect(markup).not.toContain(">codex</pre>");
		expect(await submit()).toBe(true);
		await sessionCommands(store);
		expect(names(store)).toEqual(["Setup", "review"]);
		expect(store.getState().terminals[1]).toMatchObject({ kind: "agent", command: "/usr/local/bin/claude --permission-mode plan" });
	});

	test("the request names only the workflow, never its command", async () => {
		const { model, submit, store, requests } = await withCodex();
		model.edit({ name: "feat/login", workflow: "review" });
		expect(await submit()).toBe(true);
		await sessionCommands(store);
		expect(requests.filter(request => request.timberWorktreeSetup === undefined)).toEqual([
			{ repository: TIMBER, worktree: NEW_PATH, cols: 80, rows: 24, workflowAgent: { workflow: "review" } },
		]);
	});

	test("a workflow that turns the agent off starts none, and the field says so, locked", async () => {
		const { model, render, submit, store } = await withCodex();
		model.edit({ name: "feat/login", workflow: "triage" });
		const markup = render();
		expect(markup).toContain('<select class="field-input" name="agent" disabled=""><option value="" selected="">None (set by the workflow)</option></select>');
		expect(markup).toContain("The triage workflow turns the agent off, so none starts. It cannot be changed here.");
		// Only setup follows.
		expect(markup.split("Command that will start next").length).toBe(2);
		expect(await submit()).toBe(true);
		await sessionCommands(store);
		expect(names(store)).toEqual(["Setup"]);
	});

	test("a workflow that sets no agent leaves the pick as it was", async () => {
		const { model, render, submit, store } = await withCodex();
		model.edit({ name: "feat/login", workflow: "explore" });
		const markup = render();
		expect(markup).toContain('<select class="field-input" name="agent"><option value="Claude Code">Claude Code</option><option value="Codex" selected="">Codex</option>');
		expect(await submit()).toBe(true);
		await sessionCommands(store);
		expect(names(store)).toEqual(["Setup", "Codex"]);
	});

	test("the field is locked to the workflow's command, and the pick is back once the workflow is not", async () => {
		const { model, render } = await withCodex();
		model.edit({ name: "feat/login", workflow: "review" });
		const locked = render();
		expect(locked).toContain('<select class="field-input" name="agent" disabled=""><option value="" selected="">claude --permission-mode plan</option></select>');
		expect(locked).toContain("Set by the review workflow, so it cannot be changed here.");
		model.edit({ workflow: null });
		const free = render();
		expect(free).not.toContain("disabled");
		expect(free).toContain('<option value="Codex" selected="">Codex</option>');
	});

	test("a workflow whose command changed after it was picked starts the command Timber reports now", async () => {
		const engine = createMockEngine();
		const { newWorktree } = engine;
		engine.newWorktree = async request => {
			const result = await newWorktree(request);
			engine.setWorkflows(TIMBER, { ok: true, workflows: sampleWorkflows.map(workflow => workflow.name === "review" ? { ...workflow, agent: { kind: "command", command: "codex", args: ["--fresh"] } } : workflow) });
			return result;
		};
		const { model, submit, store } = await withCodex(engine);
		model.edit({ name: "feat/login", workflow: "review" });
		expect(await submit()).toBe(true);
		await sessionCommands(store);
		expect(store.getState().terminals.map(session => [session.name, session.command])).toEqual([
			["Setup", expect.stringContaining("timber open --setup --workflow review")],
			["review", "/usr/local/bin/codex --fresh"],
		]);
	});

	for (const [what, change, words] of [
		["now turns the agent off", (workflow: (typeof sampleWorkflows)[number]) => ({ ...workflow, agent: { kind: "none" as const } }), "agent = false"],
		["no longer sets an agent", (workflow: (typeof sampleWorkflows)[number]) => ({ ...workflow, agent: { kind: "not-set" as const } }), "no longer sets an agent"],
		["is gone", null, 'Timber lists no workflow called "review"'],
	] as const) {
		test(`a workflow that ${what} by the time the agent starts starts none, and the pane says why`, async () => {
			const engine = createMockEngine();
			const { newWorktree } = engine;
			engine.newWorktree = async request => {
				const result = await newWorktree(request);
				engine.setWorkflows(TIMBER, {
					ok: true,
					workflows: change === null ? sampleWorkflows.filter(workflow => workflow.name !== "review") : sampleWorkflows.map(workflow => workflow.name === "review" ? change(workflow) : workflow),
				});
				return result;
			};
			const { model, submit, store } = await withCodex(engine);
			model.edit({ name: "feat/login", workflow: "review" });
			expect(await submit()).toBe(true);
			await sessionCommands(store);
			expect(names(store)).toEqual(["Setup"]);
			const worktree = store.getState().repositories.find(candidate => candidate.path === TIMBER)!.worktrees.find(candidate => candidate.path === NEW_PATH)!;
			expect(store.getState().terminalProblem).toMatchObject({ worktree: worktree.id, agent: "the review workflow's agent", message: expect.stringContaining(words) });
			expect(toasts(store)).toEqual(["Created worktree feat/login"]);
		});
	}

	test("a workflow that leaves the agent to the pick, but sets one by the time it starts, starts the one Timber reports now", async () => {
		const engine = createMockEngine();
		const { newWorktree } = engine;
		engine.newWorktree = async request => {
			const result = await newWorktree(request);
			engine.setWorkflows(TIMBER, {
				ok: true,
				workflows: sampleWorkflows.map(workflow => workflow.name === "explore" ? { ...workflow, agent: { kind: "command" as const, command: "claude", args: ["--resume"] } } : workflow),
			});
			return result;
		};
		const { model, submit, store } = await withCodex(engine);
		model.edit({ name: "feat/login", workflow: "explore" });
		expect(await submit()).toBe(true);
		await sessionCommands(store);
		expect(store.getState().terminals.map(session => [session.name, session.command])).toEqual([
			["Setup", expect.stringContaining("timber open --setup --workflow explore")],
			["explore", "/usr/local/bin/claude --resume"],
		]);
	});

	test("a workflow that still leaves the agent to the pick when it starts starts the pick", async () => {
		const { model, submit, store } = await withCodex();
		model.edit({ name: "feat/login", workflow: "explore" });
		expect(await submit()).toBe(true);
		await sessionCommands(store);
		expect(store.getState().terminals.map(session => [session.name, session.command])).toEqual([
			["Setup", expect.stringContaining("timber open --setup --workflow explore")],
			["Codex", "/usr/local/bin/codex"],
		]);
	});

	test("a run that fails starts no session at all", async () => {
		const { engine, model, submit, store, requests } = await withCodex();
		engine.endCommands("refused");
		model.edit({ name: "feat/login", workflow: "review" });
		expect(await submit()).toBe(false);
		await sessionCommands(store);
		expect(store.getState().terminals).toEqual([]);
		expect(requests).toEqual([]);
	});

	test("a setup script that fails does so in its own session, and the workflow's agent runs anyway", async () => {
		const { engine, model, submit, store } = await withCodex();
		engine.endCommands("setup-fails");
		model.edit({ name: "feat/login", workflow: "review" });
		expect(await submit()).toBe(true);
		await sessionCommands(store);
		expect(store.getState().terminals.map(session => [session.name, session.state])).toEqual([
			["Setup", { kind: "exited", exitCode: 1, signal: null }],
			["review", { kind: "running" }],
		]);
	});

	test("Existing branch: the workflow's agent starts only in a worktree Timber created", async () => {
		const there = await withCodex();
		there.controller.select(1);
		await there.form.readBranches();
		there.form.setSelector(FEATURE_BRANCH);
		there.form.setWorkflow("review");
		expect(await there.submit()).toBe(true);
		await sessionCommands(there.store);
		expect(names(there.store)).toEqual([]);

		const created = await withCodex();
		created.controller.select(1);
		await created.form.readBranches();
		created.form.setSelector(SPARE_BRANCH);
		created.form.setWorkflow("review");
		expect(await created.submit()).toBe(true);
		await sessionCommands(created.store);
		expect(names(created.store)).toEqual(["Setup", "review"]);
	});

	test("a kept workflow the list no longer has leaves the field to the pick, says so, and starts the pick", async () => {
		const { engine, model, submit, store, controller, render } = await withCodex();
		engine.endCommands("stops-after-create");
		model.edit({ name: "feat/login", workflow: "review" });
		expect(await submit()).toBe(false);
		engine.setWorkflows(TIMBER, { ok: true, workflows: sampleWorkflows.filter(workflow => workflow.name !== "review") });
		await controller.readWorkflows();
		const markup = render();
		expect(markup).toContain('<option value="Codex" selected="">Codex</option>');
		expect(markup).not.toContain('name="agent" disabled');
		expect(markup).toContain("The review workflow could not be read yet. If it sets an agent, that one starts instead, once this dialog has created the worktree.");
		engine.endCommands("succeeds");
		expect(await submit()).toBe(true);
		await sessionCommands(store);
		expect(names(store)).toEqual(["Setup", "Codex"]);
	});

	test("a workflow's agent whose executable is not found shows why in the pane and keeps the worktree and its setup", async () => {
		const { engine, model, submit, store } = await withCodex();
		engine.missingExecutables(["claude"]);
		model.edit({ name: "feat/login", workflow: "review" });
		expect(await submit()).toBe(true);
		await sessionCommands(store);
		expect(names(store)).toEqual(["Setup"]);
		expect(store.getState().terminalProblem).toMatchObject({ agent: "the review workflow's agent", command: "claude --permission-mode plan" });
		expect(store.getState().terminalProblem?.message).toContain("Could not start the agent of the review workflow.");
		expect(toasts(store)).toEqual(["Created worktree feat/login"]);
	});
});
