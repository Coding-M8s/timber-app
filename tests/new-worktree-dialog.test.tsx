import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { WorktreeDialogFrame } from "../src/mainview/components/NewWorktreeDialog";
import { ModeSwitch } from "../src/mainview/components/worktree-modes/ModeSwitch";
import { createWorktreeDialogController } from "../src/mainview/components/worktree-modes/dialog-controller";
import type { WorktreeDialogMode } from "../src/mainview/components/worktree-modes/mode";
import { newBranchMode } from "../src/mainview/components/worktree-modes/new-branch";
import { createNewBranchModel } from "../src/mainview/components/worktree-modes/new-branch-model";
import { createMockEngine, sampleRepositories, sampleTimberStatuses, sampleUnavailableRepository } from "../src/mainview/engine/mock";
import { selectedWorktree } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { createSubmission } from "../src/mainview/store/submission";
import type { NewWorktreeRequest, OpenWorktreeRequest } from "../src/shared/model";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "../src/shared/timber-result";
import { newWorktreeArguments } from "../src/shared/worktree-commands";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const NEW_PATH = "/work/timber-worktrees/feat-login";

/** As it appears in markup. */
const escaped = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");

/**
 * The dialog as NewWorktreeDialog.tsx wires it, without a window: the store's
 * dialog opened from the "+", the one submission, and the New branch mode.
 * The engine is the mock, noting every command it is asked for.
 */
async function openedDialog(engine = createMockEngine()) {
	const asked: ({ kind: "new" } & NewWorktreeRequest | { kind: "open" } & OpenWorktreeRequest)[] = [];
	const { newWorktree, openWorktree } = engine;
	engine.newWorktree = request => (asked.push({ kind: "new", ...request }), newWorktree(request));
	engine.openWorktree = request => (asked.push({ kind: "open", ...request }), openWorktree(request));

	const store = createAppStore(engine);
	store.start();
	await settle();
	store.openDialog({ kind: "new-worktree", repository: TIMBER });
	const repository = store.getState().repositories.find(candidate => candidate.path === TIMBER)!;
	const submission = createSubmission(toast => {
		store.showToast(toast);
		store.closeDialog();
	});
	const model = createNewBranchModel(store, TIMBER);
	const mode = () => newBranchMode(model, model.getState(), repository, submission);
	// The wiring NewWorktreeDialog.tsx uses: the agent pick and the submit that starts the agent.
	const controller = createWorktreeDialogController(store, TIMBER, submission);
	return {
		store, engine, asked, model, submission, mode, controller,
		pickAgent: controller.pickAgent,
		submit: () => controller.submit(mode()),
		render: () => renderToStaticMarkup(
			<WorktreeDialogFrame
				repository={repository} modes={[mode()]} selected={0} submission={submission.getState()}
				agents={store.getState().preferences.agents} agent={controller.agent()}
				onSelect={controller.select} onPickAgent={controller.pickAgent} onSubmit={mode => void controller.submit(mode)} onClose={() => {}}
			/>,
		),
		branches: () => store.getState().repositories.find(candidate => candidate.path === TIMBER)!.worktrees.map(worktree => worktree.branch),
		toasts: () => store.getState().toasts.map(toast => toast.text),
	};
}

describe("the + on a repository", () => {
	test("is on every available repository, and not on an unavailable one", async () => {
		const store = createAppStore(createMockEngine([...sampleRepositories, sampleUnavailableRepository]));
		store.start();
		await settle();
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toContain('class="icon-button group-new" aria-label="New worktree in timber" title="New worktree in timber"');
		expect(markup).toContain('aria-label="New worktree in api-server"');
		expect(markup).not.toContain("New worktree in old-prototype");
		expect(markup).not.toContain("<dialog");
	});

	test("opens the dialog for that repository, named in the title", async () => {
		const { store } = await openedDialog();
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).toMatch(/<dialog class="dialog"[^>]*>.*?<h2[^>]*class="dialog-title">New worktree in timber<\/h2>/);
		expect(markup).toContain(">Create worktree</button>");
	});

	test("nothing opens while Timber is not ready, or for a repository that is not there", async () => {
		const missing = createAppStore(createMockEngine(sampleRepositories, sampleTimberStatuses["not-found"]));
		missing.start();
		await settle();
		missing.openDialog({ kind: "new-worktree", repository: TIMBER });
		expect(renderToStaticMarkup(<App store={missing} />)).not.toContain("<dialog");

		const store = createAppStore(createMockEngine([...sampleRepositories, sampleUnavailableRepository]));
		store.start();
		await settle();
		store.openDialog({ kind: "new-worktree", repository: sampleUnavailableRepository.path });
		expect(renderToStaticMarkup(<App store={store} />)).not.toContain("<dialog");
		store.openDialog({ kind: "new-worktree", repository: "/work/unknown" });
		expect(renderToStaticMarkup(<App store={store} />)).not.toContain("<dialog");
	});
});

describe("the New branch form", () => {
	test("has a name, an optional start point, and the agent, and nothing that belongs to other tickets", async () => {
		const { render } = await openedDialog();
		const markup = render();
		expect(markup).toMatch(/<span class="field-label">Name<\/span><input class="field-input" placeholder="Fix login bug"[^>]* name="name" value=""\/>/);
		expect(markup).toMatch(/<span class="field-label">Start from<\/span><input class="field-input" placeholder="Timber&#x27;s configured base"[^>]* name="base" value=""\/>/);
		expect(markup.match(/<input /g)?.length).toBe(2);
		expect(markup).toContain(">Cancel</button>");
		// The one select is the agent. No repository field, no editor checkbox, and with one mode no switch.
		expect(markup.match(/<select /g)?.length).toBe(1);
		expect(markup).toContain('<select class="field-input" name="agent">');
		expect(markup).not.toContain('type="checkbox"');
		expect(markup).not.toContain("radiogroup");
	});

	test("cannot be submitted without a name", async () => {
		const { model, mode, render } = await openedDialog();
		expect(mode().canSubmit).toBe(false);
		expect(render()).toContain('<button type="submit" class="button primary" disabled="">Create worktree</button>');
		model.edit({ base: "develop", name: "   " });
		expect(mode().canSubmit).toBe(false);
		model.edit({ name: " x " });
		expect(mode().canSubmit).toBe(true);
		expect(render()).toContain('<button type="submit" class="button primary">Create worktree</button>');
	});

	test("shows the exact command in the footer as the fields change", async () => {
		const { model, mode, render } = await openedDialog();
		model.edit({ name: "  Fix login bug " });
		expect(mode().command).toBe("timber new --no-setup --result-file <temporary file> --no-editor --no-agent -- 'Fix login bug'");
		model.edit({ base: " origin/develop " });
		expect(mode().command).toBe("timber new --base origin/develop --no-setup --result-file <temporary file> --no-editor --no-agent -- 'Fix login bug'");
		expect(render()).toContain(`<pre class="dialog-command" aria-label="Command that will run">${escaped(mode().command)}</pre>`);
		model.edit({ name: "--editor" });
		expect(mode().command).toBe("timber new --base origin/develop --no-setup --result-file <temporary file> --no-editor --no-agent -- --editor");
	});

	test("editing a field puts an earlier failure away", async () => {
		const { engine, model, mode, submission, submit } = await openedDialog();
		engine.endCommands("refused");
		model.edit({ name: "feat/login" });
		await submit();
		expect(submission.getState().failure).not.toBeNull();
		// What the name field does on every change.
		type Field = { props: { children: { props: { onChange(event: object): void } }[] } };
		const [nameField] = (mode().fields as { props: { children: Field[] } }).props.children;
		nameField!.props.children[1]!.props.onChange({ target: { value: "feat/login-2" } });
		expect(model.getState().fields.name).toBe("feat/login-2");
		expect(submission.getState()).toEqual({ running: false, failure: null });
	});
});

describe("creating a worktree", () => {
	test("the command shown is the command that runs", async () => {
		const { model, mode, submit, asked } = await openedDialog();
		model.edit({ name: " Fix login bug ", base: " develop " });
		const shown = mode().command;
		await submit();
		expect(asked).toEqual([{ kind: "new", repository: TIMBER, name: "Fix login bug", base: "develop" }]);
		const { kind: _kind, ...request } = asked[0]!;
		// The main process builds its arguments with the same function, from this same request.
		expect(describeTimberCommand(newWorktreeArguments(request as NewWorktreeRequest, RESULT_FILE_PLACEHOLDER))).toBe(shown);
	});

	test("success: the list has the new worktree, it is selected, the dialog closes, and a toast says so", async () => {
		const { store, model, submit, branches, toasts, asked } = await openedDialog();
		model.edit({ name: "feat/login" });
		expect(await submit()).toBe(true);
		expect(branches()).toContain("feat/login");
		expect(selectedWorktree(store.getState())?.worktree.path).toBe(NEW_PATH);
		expect(store.getState().dialog).toBeNull();
		expect(toasts()).toEqual(["Created worktree feat/login"]);
		expect(asked.length).toBe(1);

		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup).not.toContain("<dialog");
		expect(markup).toMatch(/class="row selected" aria-current="true"[^>]*>.*?feat\/login/);
		expect(markup).toContain('class="toast-text">Created worktree feat/login<');
	});

	test("a failure before creation leaves the dialog open with Timber's diagnostic, and creates nothing", async () => {
		const { store, engine, model, mode, submit, render, branches, toasts, asked } = await openedDialog();
		engine.endCommands("refused");
		model.edit({ name: "feat/login", base: "shared" });
		const shown = mode().command;
		const before = branches();
		const selected = store.getState().selection;
		expect(await submit()).toBe(false);

		expect(store.getState().dialog).toEqual({ kind: "new-worktree", repository: TIMBER });
		expect(branches()).toEqual(before);
		expect(store.getState().selection).toEqual(selected);
		expect(toasts()).toEqual([]);
		expect(asked.length).toBe(1);
		expect(model.getState()).toEqual({ fields: { name: "feat/login", base: "shared", workflow: null }, step: { kind: "form" } });

		const markup = render();
		expect(markup).toContain('role="alert"');
		expect(markup).toContain('<p class="failure-title">Could not create the worktree</p>');
		// An ambiguous name or base is explained in Timber's own words.
		expect(markup).toContain('<p class="failure-diagnostic">Base branch shared is missing or ambiguous. Select an exact branch.</p>');
		expect(markup).toContain(`<pre class="failure-command">${escaped(shown)}</pre>`);
		expect(markup).not.toContain("<details open");
		// The form is still there, with what was typed, ready for a correction.
		expect(markup).toContain('name="name" value="feat/login"');
		expect(markup).toContain('name="base" value="shared"');
		expect(markup).toContain('<button type="submit" class="button primary">Create worktree</button>');
		expect(markup).not.toContain("Run setup");
	});

	test("a name that is taken fails the same way, with Timber's guidance", async () => {
		const { model, submit, render, asked } = await openedDialog();
		model.edit({ name: "spike/new-idea" });
		expect(await submit()).toBe(false);
		expect(render()).toContain("Branch spike/new-idea is already checked out at /work/timber-worktrees/spike-new-idea. Use timber open instead.");
		expect(asked.length).toBe(1);
	});

	test("no result: a failure that says what happened is unknown, and the list is read again", async () => {
		const { store, engine, model, submit, render, branches } = await openedDialog();
		engine.endCommands("no-result");
		model.edit({ name: "feat/login" });
		expect(await submit()).toBe(false);
		expect(store.getState().dialog).not.toBeNull();
		expect(model.getState().step).toEqual({ kind: "form" });
		expect(render()).toContain("timber new exited with code 0 and left no result, so what it did is unknown.");
		expect(render()).not.toContain("Run setup");
		// Reading again shows what is really there, although the command did not say.
		expect(branches()).toContain("feat/login");
	});

	test("an engine that throws is a failure in the dialog, and nothing is asked twice", async () => {
		const { engine, model, submit, render, asked } = await openedDialog();
		const { newWorktree } = engine;
		engine.newWorktree = async request => {
			await newWorktree(request);
			throw new Error("bridge closed");
		};
		model.edit({ name: "feat/login" });
		expect(await submit()).toBe(false);
		expect(render()).toContain("bridge closed");
		expect(asked.length).toBe(1);
	});
});

describe("created, then Timber stopped before setup", () => {
	async function afterStopped() {
		const dialog = await openedDialog();
		dialog.engine.endCommands("stops-after-create");
		dialog.model.edit({ name: "feat/login" });
		expect(await dialog.submit()).toBe(false);
		return dialog;
	}

	test("says so, lists and selects the worktree, and keeps the dialog open", async () => {
		const { store, render, branches, toasts, model } = await afterStopped();
		expect(branches()).toContain("feat/login");
		expect(selectedWorktree(store.getState())?.worktree.path).toBe(NEW_PATH);
		expect(store.getState().dialog).not.toBeNull();
		expect(toasts()).toEqual([]);
		expect(model.getState().step).toEqual({ kind: "setup", worktree: { id: expect.any(String), path: NEW_PATH, branch: "feat/login" }, workflow: null });

		const markup = render();
		expect(markup).toContain('<p class="failure-title">Created feat/login, but Timber stopped before setup</p>');
		expect(markup).toContain("Could not save the base association; created worktree retained at");
		expect(markup).toContain("feat/login was created and is in the list, but Timber stopped before its setup.");
		expect(markup).toContain(`<p class="dialog-outcome-text path">${NEW_PATH}</p>`);
		expect(markup).toContain("Nothing is created again.");
		// The form, and with it the offer to create, is gone.
		expect(markup).not.toContain('name="name"');
		expect(markup).not.toContain("Create worktree");

		const app = renderToStaticMarkup(<App store={store} />);
		expect(app).toMatch(/class="row selected" aria-current="true"[^>]*>.*?feat\/login/);
	});

	test("offers Run setup, and shows the setup command for that exact path before it runs", async () => {
		const { mode, render } = await afterStopped();
		expect(mode().submitLabel).toBe("Run setup");
		expect(mode().canSubmit).toBe(true);
		expect(mode().command).toBe(`timber open --setup --no-editor --no-agent -- ${NEW_PATH}`);
		const markup = render();
		expect(markup).toContain(`<pre class="dialog-command" aria-label="Command that will run">${escaped(mode().command)}</pre>`);
		expect(markup).toContain('<button type="submit" class="button primary">Run setup</button>');
	});

	test("Run setup starts setup in a session in the reported worktree, closes the dialog, and never asks Timber again", async () => {
		const { store, submit, asked, toasts, branches } = await afterStopped();
		expect(await submit()).toBe(true);
		await settle();
		expect(asked).toEqual([{ kind: "new", repository: TIMBER, name: "feat/login", base: null }]);
		expect(toasts()).toEqual(["Setup started in feat/login"]);
		expect(store.getState().dialog).toBeNull();
		expect(branches().filter(branch => branch === "feat/login").length).toBe(1);
		const selected = selectedWorktree(store.getState())!.worktree;
		expect(selected.path).toBe(NEW_PATH);
		expect(store.getState().terminals[0]).toMatchObject({ kind: "timber", name: "Setup", worktree: selected.id });
	});

	test("there is a plain way back to the form, which runs nothing", async () => {
		const { model, mode, submission, render, asked } = await afterStopped();
		expect(render()).toContain('<button type="button" class="text-button">Back to the form</button>');
		model.backToForm();
		submission.clearFailure();
		expect(model.getState()).toEqual({ fields: { name: "feat/login", base: "", workflow: null }, step: { kind: "form" } });
		expect(mode().submitLabel).toBe("Create worktree");
		expect(mode().command).toBe("timber new --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/login");
		expect(render()).not.toContain('role="alert"');
		expect(asked.length).toBe(1);
	});
});

describe("setup after a worktree was created", () => {
	test("runs in its own session and never holds the dialog: a script that fails shows there, and the worktree stays", async () => {
		const { store, engine, model, submit, toasts } = await openedDialog();
		engine.endCommands("setup-fails");
		model.edit({ name: "feat/login" });
		expect(await submit()).toBe(true);
		await settle();
		await settle();
		expect(store.getState().dialog).toBeNull();
		expect(toasts()).toEqual(["Created worktree feat/login"]);
		const setup = store.getState().terminals.find(session => session.name === "Setup");
		expect(setup?.state).toEqual({ kind: "exited", exitCode: 1, signal: null });
		expect(selectedWorktree(store.getState())?.worktree.path).toBe(NEW_PATH);
	});
});

describe("while a command runs", () => {
	test("the fields and buttons are disabled, progress shows, and a second submit asks nothing", async () => {
		const engine = createMockEngine();
		let finish!: () => void;
		const held = new Promise<void>(resolve => {
			finish = resolve;
		});
		const { newWorktree } = engine;
		engine.newWorktree = async request => {
			await held;
			return newWorktree(request);
		};
		const { model, submit, render, asked, store } = await openedDialog(engine);
		model.edit({ name: "feat/login" });
		const first = submit();
		expect(await submit()).toBe(false);
		const markup = render();
		expect(markup).toContain('<fieldset class="dialog-fields" disabled="">');
		expect(markup).toContain('<button type="button" class="button quiet" disabled="">Cancel</button>');
		expect(markup).toContain('<button type="submit" class="button primary" disabled="">Running</button>');
		expect(markup).toContain('role="progressbar" aria-label="Creating the worktree"');
		finish();
		expect(await first).toBe(true);
		expect(asked.length).toBe(1);
		expect(store.getState().dialog).toBeNull();
	});
});

describe("the mode switch", () => {
	const fake = (label: string): WorktreeDialogMode => ({
		label,
		fields: <p>{label} fields</p>,
		command: `timber ${label.toLowerCase().replaceAll(" ", "-")}`,
		canSubmit: true,
		submitLabel: `Run ${label}`,
		runningLabel: "Running",
		failureTitle: "Failed",
		agentStart: "always",
		setupStart: "never",
		worktree: null,
		workflow: null,
		run: async () => ({ outcome: { ok: true, toast: "Done" }, created: null, setup: null }),
	});
	const modes = [fake("New branch"), fake("Existing branch")];
	const repository = sampleRepositories[0]!;
	const frame = (selected: number, running = false, shown = modes) => renderToStaticMarkup(
		<WorktreeDialogFrame repository={repository} modes={shown} selected={selected} submission={{ running, failure: null }} agents={[]} agent={null} onSelect={() => {}} onPickAgent={() => {}} onSubmit={() => {}} onClose={() => {}} />,
	);

	test("is a group of radio buttons, one per mode, with the selected one checked", () => {
		const markup = renderToStaticMarkup(<ModeSwitch labels={["New branch", "Existing branch"]} selected={1} disabled={false} onSelect={() => {}} />);
		expect(markup).toContain('<div class="mode-switch" role="radiogroup" aria-label="What to make the worktree from">');
		expect(markup.match(/<input class="mode-radio" type="radio"/g)?.length).toBe(2);
		expect(markup).toMatch(/<label class="mode-option"><input class="mode-radio" type="radio" name="([^"]+)"\/><span class="mode-label">New branch<\/span><\/label>/);
		expect(markup).toMatch(/<label class="mode-option selected"><input class="mode-radio" type="radio" name="[^"]+" checked=""\/><span class="mode-label">Existing branch<\/span><\/label>/);
		// One name, so the arrow keys move between them as one control.
		expect(new Set([...markup.matchAll(/name="([^"]+)"/g)].map(match => match[1])).size).toBe(1);
	});

	test("shows in the dialog's header when there are two modes, and the dialog draws the selected one", () => {
		const first = frame(0);
		expect(first).toMatch(/<header class="dialog-head"><h2[^>]*>New worktree in timber<\/h2><div class="mode-switch" role="radiogroup"/);
		expect(first).toContain("New branch fields");
		expect(first).not.toContain("Existing branch fields");
		expect(first).toContain(">timber new-branch</pre>");
		expect(first).toContain(">Run New branch</button>");

		const second = frame(1);
		expect(second).toContain("Existing branch fields");
		expect(second).toContain(">timber existing-branch</pre>");
		expect(second).toMatch(/class="mode-option selected"><input[^>]*checked=""\/><span class="mode-label">Existing branch/);
	});

	test("is disabled while a command runs", () => {
		expect(frame(0, true).match(/<input class="mode-radio" type="radio"[^>]* disabled=""[^>]*\/>/g)?.length).toBe(2);
		expect(frame(0).match(/<input class="mode-radio"[^>]*disabled/g)).toBeNull();
	});

	test("is not drawn for a single mode", () => {
		expect(frame(0, false, [modes[0]!])).not.toContain("radiogroup");
	});
});
