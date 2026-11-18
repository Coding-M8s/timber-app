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
import { newWorktreeArguments, openWorktreeArguments } from "../src/shared/worktree-commands";

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
			agents={store.getState().preferences.agents} agent={controller.agent()}
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
		expect(mode().command).toBe("timber new --result-file <temporary file> --no-editor --no-agent -- feat/login");
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
		expect(mode().command).toBe("timber new --result-file <temporary file> --no-editor --no-agent -- feat/login");
		model.edit({ workflow: "review" });
		expect(mode().command).toBe("timber new --workflow review --result-file <temporary file> --no-editor --no-agent -- feat/login");
		expect(render()).toContain('<option value="review" selected="">');
		expect(render()).toContain("Runs the setup scripts of review after the ordinary ones.");
		model.edit({ base: "develop" });
		expect(mode().command).toBe("timber new --base develop --workflow review --result-file <temporary file> --no-editor --no-agent -- feat/login");
		model.edit({ workflow: null });
		expect(mode().command).toBe("timber new --base develop --result-file <temporary file> --no-editor --no-agent -- feat/login");
	});

	test("Existing branch: has --workflow <name> exactly when one is picked, before the --", async () => {
		const { form, mode, controller } = await openedDialog();
		controller.select(1);
		form.setSelector("feat/x");
		expect(mode().command).toBe("timber open --result-file <temporary file> --no-editor --no-agent -- feat/x");
		form.setWorkflow("triage");
		form.setSetup(true);
		expect(mode().command).toBe("timber open --setup --workflow triage --result-file <temporary file> --no-editor --no-agent -- feat/x");
		form.setWorkflow(null);
		expect(mode().command).toBe("timber open --setup --result-file <temporary file> --no-editor --no-agent -- feat/x");
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

describe("Open with setup after a failed workflow script", () => {
	test("New branch: repeats --workflow <name>, because Timber does not remember it", async () => {
		const { engine, model, mode, submit, asked, render } = await openedDialog();
		engine.endCommands("setup-fails");
		model.edit({ name: "feat/login", workflow: "review" });
		expect(await submit()).toBe(false);
		expect(model.getState().step).toMatchObject({ kind: "setup", workflow: "review", worktree: { path: NEW_PATH } });
		expect(mode().command).toBe(`timber open --setup --workflow review --result-file <temporary file> --no-editor --no-agent -- ${NEW_PATH}`);
		expect(render()).toContain("from the first one, with the review workflow. Nothing is created again.");
		// Timber's own advice names the same workflow.
		expect(render()).toContain("retry all setup steps with: timber open --setup --workflow review --");

		const shown = mode().command;
		engine.endCommands("succeeds");
		expect(await submit()).toBe(true);
		expect(asked).toEqual([
			{ kind: "new", repository: TIMBER, name: "feat/login", base: null, workflow: "review" },
			{ kind: "open", repository: TIMBER, selector: NEW_PATH, setup: true, workflow: "review" },
		]);
		const { kind: _kind, ...request } = asked[1]!;
		expect(describeTimberCommand(openWorktreeArguments(request as OpenWorktreeRequest, RESULT_FILE_PLACEHOLDER))).toBe(shown);
	});

	test("New branch without a workflow: Open with setup passes none", async () => {
		const { engine, model, mode, submit } = await openedDialog();
		engine.endCommands("setup-fails");
		model.edit({ name: "feat/login" });
		expect(await submit()).toBe(false);
		expect(mode().command).toBe(`timber open --setup --result-file <temporary file> --no-editor --no-agent -- ${NEW_PATH}`);
	});

	test("New branch: the workflow of the failed run is kept, even when the list later loses it", async () => {
		const { engine, model, mode, submit, controller } = await openedDialog();
		engine.endCommands("setup-fails");
		model.edit({ name: "feat/login", workflow: "review" });
		expect(await submit()).toBe(false);
		engine.setWorkflows(TIMBER, { ok: true, workflows: [] });
		await controller.readWorkflows();
		expect(mode().command).toContain("--setup --workflow review --");
	});

	test("Existing branch: the kept worktree is opened with setup and the same workflow", async () => {
		const { engine, form, mode, submit, asked, controller } = await openedDialog();
		controller.select(1);
		await form.readBranches();
		engine.endCommands("setup-fails");
		form.setSelector("chore/update-deps");
		form.setWorkflow("triage");
		expect(await submit()).toBe(false);
		const kept = form.getState().kept;
		expect(kept).not.toBeNull();
		expect(mode().command).toBe(`timber open --setup --workflow triage --result-file <temporary file> --no-editor --no-agent -- ${kept!.worktree.path}`);
		engine.endCommands("succeeds");
		expect(await submit()).toBe(true);
		expect(asked.at(-1)).toEqual({ kind: "open", repository: TIMBER, selector: kept!.worktree.path, setup: true, workflow: "triage" });
	});
});

describe("a workflow removed between listing and creating", () => {
	test("fails with Timber's message as it is, creates nothing, and the dialog stays open", async () => {
		const { engine, model, submit, render, branches, store, controller } = await openedDialog();
		const before = branches();
		model.edit({ name: "feat/login", workflow: "review" });
		engine.setWorkflows(TIMBER, { ok: true, workflows: sampleWorkflows.filter(workflow => workflow.name !== "review") });
		expect(await submit()).toBe(false);
		expect(branches()).toEqual(before);
		expect(store.getState().dialog).not.toBeNull();
		expect(model.getState().step).toEqual({ kind: "form" });
		expect(render()).toContain(`${UNKNOWN_WORKFLOW_DIAGNOSTIC.replace("<name>", "&lt;name&gt;")}`);

		// Read again, the field no longer offers it, and the next command passes none.
		await controller.readWorkflows();
		expect(render()).not.toContain('value="review"');
		expect(render()).toContain("timber new --result-file &lt;temporary file&gt; --no-editor --no-agent -- feat/login");
	});
});
