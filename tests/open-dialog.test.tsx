import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { BranchField, SHOWN_BRANCHES, matchBranches, stepActive } from "../src/mainview/components/BranchField";
import { WorktreeDialogFrame } from "../src/mainview/components/NewWorktreeDialog";
import { createWorktreeDialogController } from "../src/mainview/components/worktree-modes/dialog-controller";
import { existingBranchMode } from "../src/mainview/components/worktree-modes/existing-branch";
import { canOpen, createExistingBranchForm, describeOpened, openRequest } from "../src/mainview/components/worktree-modes/existing-branch-form";
import { newBranchMode } from "../src/mainview/components/worktree-modes/new-branch";
import { createNewBranchModel } from "../src/mainview/components/worktree-modes/new-branch-model";
import { type MockEngine, createMockEngine } from "../src/mainview/engine/mock";
import { selectedWorktree } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { createSubmission } from "../src/mainview/store/submission";
import type { BranchSuggestion, OpenWorktreeRequest, WorktreeCommandResult } from "../src/shared/model";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "../src/shared/timber-result";
import { openWorktreeArguments } from "../src/shared/worktree-commands";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const SPARE = "/work/timber-worktrees/chore-update-deps";

/** The text a command has once it is rendered as markup. */
const escaped = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("'", "&#x27;").replaceAll('"', "&quot;");

const rows = (markup: string) => markup.match(/class="row( selected)?"/g)?.length ?? 0;

describe("the dialog behind the +", () => {
	test("has both modes on its switch, New branch first", async () => {
		const store = createAppStore(createMockEngine());
		store.start();
		await settle();
		store.openDialog({ kind: "new-worktree", repository: TIMBER });
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(markup.match(/<dialog/g)?.length).toBe(1);
		expect([...markup.matchAll(/class="mode-label">([^<]*)</g)].map(match => match[1])).toEqual(["New branch", "Existing branch"]);
		expect(markup).toMatch(/class="mode-option selected"><input[^>]*checked=""\/><span class="mode-label">New branch/);
		expect(markup).toContain(">Create worktree</button>");
	});
});

/**
 * The dialog on the mock engine, wired as NewWorktreeDialog.tsx wires it,
 * without a window: one submission whose success shows the toast and closes
 * the dialog, and both modes in the frame, with "Existing branch" on screen
 * unless `select` says otherwise. `calls` holds every `timber open` request
 * the engine got.
 */
async function openedDialog(engine: MockEngine = createMockEngine()) {
	const calls: OpenWorktreeRequest[] = [];
	const reloads: string[] = [];
	const { openWorktree, loadRepository } = engine;
	engine.openWorktree = request => {
		calls.push(request);
		return openWorktree(request);
	};
	engine.loadRepository = path => {
		reloads.push(path);
		return loadRepository(path);
	};
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	store.openDialog({ kind: "new-worktree", repository: TIMBER });
	const submission = createSubmission(toast => {
		store.showToast(toast);
		store.closeDialog();
	});
	const form = createExistingBranchForm(store, TIMBER, submission);
	await form.readBranches();

	const repository = store.getState().repositories.find(candidate => candidate.path === TIMBER)!;
	const model = createNewBranchModel(store, TIMBER);
	const modes = () => [
		newBranchMode(model, model.getState(), repository, submission),
		existingBranchMode(form, form.getState(), TIMBER, submission.getState().running),
	];
	// The wiring NewWorktreeDialog.tsx uses: the mode switch, the agent pick, and the submit that starts the agent.
	const controller = createWorktreeDialogController(store, TIMBER, submission);
	controller.select(1);
	const { select, pickAgent } = controller;
	const mode = () => modes()[controller.getState().selected]!;
	const render = () => renderToStaticMarkup(
		<WorktreeDialogFrame
			repository={repository} modes={modes()} selected={controller.getState().selected} submission={submission.getState()}
			agents={store.getState().preferences.agents} agent={controller.agent()}
			onSelect={select} onPickAgent={pickAgent} onSubmit={mode => void controller.submit(mode)} onClose={() => {}}
		/>,
	);
	const submit = () => controller.submit(mode());
	const toasts = () => store.getState().toasts.map(toast => toast.text);
	const timberRows = () => store.getState().repositories.find(repository => repository.path === TIMBER)!.worktrees.length;
	return { engine, store, submission, form, model, mode, render, select, pickAgent, submit, calls, reloads, toasts, timberRows };
}

describe("the Existing branch fields", () => {
	test("list the repository's branches for picking, local ones first, each marked local or remote", async () => {
		const { render } = await openedDialog();
		const markup = render();
		expect(markup).toContain('role="combobox"');
		expect(markup).toContain('role="listbox" aria-label="Branches to pick from"');
		const options = [...markup.matchAll(/role="option"[^>]*><span class="branch-name">([^<]*)<\/span><span class="branch-kind">([^<]*)<\/span>/g)].map(match => `${match[1]} (${match[2]})`);
		expect(options).toEqual([
			"chore/update-deps (local)",
			"feat/github-issue-lookup (local)",
			"fix/macos-portability (local)",
			"main (local)",
			"spike/new-idea (local)",
			"origin/feat/config-reload (remote)",
			"origin/feat/github-issue-lookup (remote)",
			"origin/fix/macos-portability (remote)",
			"origin/main (remote)",
			"origin/release/0.2 (remote)",
		]);
	});

	test("typing narrows the list, and text that matches no branch can still be submitted", async () => {
		const { form, render, mode } = await openedDialog();
		form.setSelector("PORT");
		expect([...render().matchAll(/class="branch-name">([^<]*)</g)].map(match => match[1])).toEqual(["fix/macos-portability", "origin/fix/macos-portability"]);

		form.setSelector("GH-123");
		const markup = render();
		expect(markup).not.toContain('role="option"');
		expect(markup).toContain("No listed branch matches. Timber decides what the text means.");
		expect(mode().canSubmit).toBe(true);
		expect(markup).toContain('<button type="submit" class="button primary">Open worktree</button>');
	});

	test("when the branches cannot be read the field still works as plain text", async () => {
		const engine = createMockEngine();
		engine.setBranches(TIMBER, null);
		const { form, render, submit, toasts } = await openedDialog(engine);
		expect(render()).toContain("The branches could not be listed. Type the name instead.");
		form.setSelector("feat/github-issue-lookup");
		expect(await submit()).toBe(true);
		expect(toasts()).toEqual(["Opened feat/github-issue-lookup. Its worktree was already there."]);
	});

	test("says so while the branches are still being read", () => {
		const markup = renderToStaticMarkup(<BranchField label="Branch" value="" branches={undefined} onChange={() => {}} />);
		expect(markup).toContain("Reading branches");
		expect(markup).toContain('aria-expanded="false"');
	});

	test("the footer shows the exact command, and it follows the fields", async () => {
		const { form, mode, render } = await openedDialog();
		form.setSelector("feat/github-issue-lookup");
		expect(mode().command).toBe("timber open --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/github-issue-lookup");
		// Rerun setup does not change what Timber runs: setup follows in a session of its own, shown below it.
		form.setSetup(true);
		expect(mode().command).toBe("timber open --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/github-issue-lookup");
		expect(render()).toContain(`<p class="dialog-note">Then runs setup in a terminal in the worktree, without waiting for it:</p><pre class="dialog-command" aria-label="Command that will start next">${escaped("timber open --setup --no-editor --no-agent -- <new worktree>")}</pre>`);
		form.setSelector("--two words");
		const command = "timber open --no-setup --result-file <temporary file> --no-editor --no-agent -- '--two words'";
		expect(mode().command).toBe(command);
		expect(render()).toContain(`<pre class="dialog-command" aria-label="Command that will run">${escaped(command)}</pre>`);
		expect(render()).toMatch(/<input type="checkbox" checked=""\/>/);
	});

	test("the command shown is the command that runs: the engine gets the request the footer was worded from", async () => {
		const { form, mode, submit, calls } = await openedDialog();
		for (const [typed, selector, setup] of [["feat/github-issue-lookup", "feat/github-issue-lookup", false], ["  two words \t", "two words", true], ["--setup", "--setup", false]] as const) {
			form.setSelector(typed);
			form.setSetup(setup);
			const shown = mode().command;
			await submit();
			const sent = calls.at(-1)!;
			expect(sent).toEqual({ repository: TIMBER, selector });
			expect(describeTimberCommand(openWorktreeArguments(sent, RESULT_FILE_PLACEHOLDER))).toBe(shown);
		}
	});

	test("the spaces around what was typed are left off, and nothing but spaces cannot be submitted", async () => {
		expect(openRequest(TIMBER, { selector: "  feat/login\n" })).toEqual({ repository: TIMBER, selector: "feat/login" });
		expect(openRequest(TIMBER, { selector: "two  words" })).toEqual({ repository: TIMBER, selector: "two  words" });
		expect(canOpen({ selector: "" })).toBe(false);
		expect(canOpen({ selector: " \t " })).toBe(false);
		expect(canOpen({ selector: " x " })).toBe(true);

		const { form, mode, render } = await openedDialog();
		form.setSelector("   ");
		expect(mode().canSubmit).toBe(false);
		expect(render()).toContain('<button type="submit" class="button primary" disabled="">Open worktree</button>');
		form.setSelector("  feat/github-issue-lookup ");
		expect(mode().command).toBe("timber open --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/github-issue-lookup");
		// The field keeps what was typed. Only the request leaves the spaces off.
		expect(form.getState().selector).toBe("  feat/github-issue-lookup ");
	});

	test("the toast says created only when something was created", () => {
		const worktree = { id: "id", path: "/work/timber-worktrees/feat-login", branch: "feat/login" };
		expect(describeOpened(worktree, true)).toBe("Created worktree feat/login");
		expect(describeOpened(worktree, false)).toBe("Opened feat/login. Its worktree was already there.");
		expect(describeOpened({ ...worktree, branch: null }, false)).toBe("Opened feat-login. Its worktree was already there.");
	});
});

describe("opening from the dialog", () => {
	test("a branch that has no worktree gets one, which is selected, and the dialog closes with a toast", async () => {
		const { form, submit, store, toasts, timberRows, calls, reloads } = await openedDialog();
		form.setSelector("chore/update-deps");
		expect(await submit()).toBe(true);
		expect(timberRows()).toBe(5);
		expect(selectedWorktree(store.getState())?.worktree).toMatchObject({ path: SPARE, branch: "chore/update-deps" });
		expect(toasts()).toEqual(["Created worktree chore/update-deps"]);
		expect(store.getState().dialog).toBeNull();
		expect(calls.length).toBe(1);
		expect(reloads).toEqual([TIMBER]);
		const markup = renderToStaticMarkup(<App store={store} />);
		expect(rows(markup)).toBe(8);
		expect(markup).toMatch(/class="row selected" aria-current="true"[^>]*>.*?chore\/update-deps/);
		expect(markup).not.toContain("<dialog");
	});

	test("a remote branch picked from the list opens as its local branch", async () => {
		const { form, submit, store, toasts } = await openedDialog();
		form.setSelector("origin/feat/config-reload");
		expect(await submit()).toBe(true);
		expect(selectedWorktree(store.getState())?.worktree.branch).toBe("feat/config-reload");
		expect(toasts()).toEqual(["Created worktree feat/config-reload"]);
	});

	test("a branch that already has a worktree selects it and creates nothing, and the toast says opened", async () => {
		const { form, submit, store, toasts, timberRows, reloads } = await openedDialog();
		form.setSelector("feat/github-issue-lookup");
		expect(await submit()).toBe(true);
		expect(timberRows()).toBe(4);
		expect(selectedWorktree(store.getState())?.worktree.path).toBe(FEATURE);
		expect(toasts()).toEqual(["Opened feat/github-issue-lookup. Its worktree was already there."]);
		expect(toasts()[0]).not.toContain("created");
		expect(store.getState().dialog).toBeNull();
		expect(reloads).toEqual([TIMBER]);
	});

	test("Rerun setup opens the existing worktree without setup, then runs setup in a session there", async () => {
		const { form, submit, calls, timberRows, store } = await openedDialog();
		form.setSelector(FEATURE);
		form.setSetup(true);
		expect(await submit()).toBe(true);
		await settle();
		expect(calls).toEqual([{ repository: TIMBER, selector: FEATURE }]);
		expect(openWorktreeArguments(calls[0]!, "/tmp/result.json")).not.toContain("--setup");
		expect(timberRows()).toBe(4);
		expect(store.getState().terminals.map(session => [session.name, session.path])).toEqual([["Setup", FEATURE]]);
	});

	test("while the command runs the dialog shows progress, is disabled, and a second submit does nothing", async () => {
		const engine = createMockEngine();
		let release!: (result: WorktreeCommandResult) => void;
		engine.openWorktree = () => new Promise(resolve => {
			release = resolve;
		});
		const { form, submit, render, calls, submission } = await openedDialog(engine);
		form.setSelector("feat/github-issue-lookup");
		const first = submit();
		await settle();
		const markup = render();
		expect(markup).toContain('<fieldset class="dialog-fields" disabled="">');
		expect(markup).toContain('role="progressbar" aria-label="Opening the worktree"');
		expect(markup).toContain('<button type="button" class="button quiet" disabled="">Cancel</button>');
		expect(markup).toContain('<button type="submit" class="button primary" disabled="">Running</button>');
		expect(await submit()).toBe(false);
		expect(calls.length).toBe(1);
		expect(submission.getState().running).toBe(true);
		release({ outcome: "cancelled" });
		expect(await first).toBe(false);
		expect(render()).toContain("timber open was cancelled before anything was changed.");
	});
});

describe("a failure in the dialog", () => {
	test("an unknown selector keeps the dialog open with Timber's guidance, refreshes, and is not tried again", async () => {
		const engine = createMockEngine();
				const { form, submit, render, store, toasts, calls, reloads, timberRows } = await openedDialog(engine);
		form.setSelector("no/such-branch");
		expect(await submit()).toBe(false);
		await settle();
		const markup = render();
		expect(markup).toContain('role="alert"');
		expect(markup).toContain('<p class="failure-title">Could not open the worktree</p>');
		expect(markup).toContain(`<p class="failure-diagnostic">${escaped('No existing branch or worktree matches "no/such-branch". Check the exact branch or absolute worktree path.')}</p>`);
		expect(markup).toContain('<button type="submit" class="button primary">Open worktree</button>');
		expect(markup).toContain('value="no/such-branch"');
		expect(store.getState().dialog).toEqual({ kind: "new-worktree", repository: TIMBER });
		expect(toasts()).toEqual([]);
		expect(calls.length).toBe(1);
		expect(reloads).toEqual([TIMBER]);
		expect(timberRows()).toBe(4);
	});

	test("an ambiguous selector shows Timber's own list of exact names", async () => {
		const engine = createMockEngine();
		engine.endCommands("ambiguous");
		const { form, submit, render, store, calls } = await openedDialog(engine);
		form.setSelector("twice");
		expect(await submit()).toBe(false);
		const markup = render();
		expect(markup).toContain(escaped('Input "twice" matches 2 targets. Did you mean one of these exact branches or paths?\n  fork/twice\n  origin/twice'));
		expect(store.getState().dialog).not.toBeNull();
		expect(calls.length).toBe(1);
	});

	test("Timber stopping after it created the worktree is reported as created, the worktree is selected, and nothing suggests starting over", async () => {
		const engine = createMockEngine();
		engine.endCommands("stops-after-create");
		const { form, submit, render, mode, store, toasts, calls, timberRows } = await openedDialog(engine);
		form.setSelector("chore/update-deps");
		expect(await submit()).toBe(false);
		await settle();

		// The worktree is in the list, selected, and the dialog is still open.
		expect(timberRows()).toBe(5);
		expect(selectedWorktree(store.getState())?.worktree.path).toBe(SPARE);
		expect(store.getState().dialog).not.toBeNull();
		expect(toasts()).toEqual([]);

		const markup = render();
		expect(markup).toContain('<p class="failure-title">The worktree was created, but Timber stopped before setup</p>');
		expect(markup).not.toContain("Could not open the worktree");
		expect(markup).toContain("Could not save the base association; created worktree retained at");
		expect(markup).toContain("chore/update-deps has its worktree, and it is selected in the list. Nothing needs to be created again.");

		// The fields now name exactly that worktree, with setup ticked. Nothing ran by itself.
		expect(form.getState()).toMatchObject({ selector: SPARE, setup: true });
		expect(mode().command).toBe(`timber open --no-setup --result-file <temporary file> --no-editor --no-agent -- ${SPARE}`);
		expect(render()).toContain(`${escaped(`timber open --setup --no-editor --no-agent -- ${SPARE}`)}</pre>`);
		expect(calls.length).toBe(1);
		expect(store.getState().terminals).toEqual([]);

		// The person opens it again: the same worktree, nothing new, and setup starts in its session.
		engine.endCommands("succeeds");
		expect(await submit()).toBe(true);
		await settle();
		expect(calls.at(-1)).toEqual({ repository: TIMBER, selector: SPARE });
		expect(calls.length).toBe(2);
		expect(timberRows()).toBe(5);
		// This dialog created it, so the toast says setup started rather than that it was already there.
		expect(toasts()).toEqual(["Setup started in chore/update-deps"]);
		expect(store.getState().dialog).toBeNull();
		expect(store.getState().terminals.map(session => session.name)).toContain("Setup");
	});

	test("setup that fails on a new worktree fails in its session, after the dialog closed", async () => {
		const engine = createMockEngine();
		engine.endCommands("setup-fails");
		const { form, submit, store, toasts, timberRows } = await openedDialog(engine);
		form.setSelector("chore/update-deps");
		expect(await submit()).toBe(true);
		await settle();
		await settle();
		expect(timberRows()).toBe(5);
		expect(toasts()).toEqual(["Created worktree chore/update-deps"]);
		expect(store.getState().terminals.find(session => session.name === "Setup")?.state).toEqual({ kind: "exited", exitCode: 1, signal: null });
	});

	test("a run that leaves no result is a failure that says what happened is unknown, and the list is read again", async () => {
		const engine = createMockEngine();
		engine.endCommands("no-result");
		const { form, submit, render, reloads, calls, store, timberRows } = await openedDialog(engine);
		form.setSelector("chore/update-deps");
		expect(await submit()).toBe(false);
		const markup = render();
		expect(markup).toContain("timber open exited with code 0 and left no result, so what it did is unknown.");
		expect(markup).toContain('<p class="failure-title">Could not open the worktree</p>');
		expect(reloads).toEqual([TIMBER]);
		expect(calls.length).toBe(1);
		expect(store.getState().dialog).not.toBeNull();
		// Nobody said what happened, and the fresh list shows it: the worktree is there.
		expect(timberRows()).toBe(5);
	});

	test("an engine that throws is a failure in the dialog, after the list was read again", async () => {
		const engine = createMockEngine();
		engine.openWorktree = async () => {
			throw new Error("The request timed out");
		};
		const { form, submit, render, reloads } = await openedDialog(engine);
		form.setSelector("chore/update-deps");
		expect(await submit()).toBe(false);
		expect(render()).toContain("The request timed out");
		expect(reloads).toEqual([TIMBER]);
	});

	test("editing a field puts the failure and its note away, ready for the corrected run", async () => {
		const engine = createMockEngine();
		engine.endCommands("stops-after-create");
		const { form, submit, render, submission } = await openedDialog(engine);
		form.setSelector("chore/update-deps");
		await submit();
		expect(submission.getState().failure).not.toBeNull();
		form.setSetup(false);
		expect(submission.getState().failure).toBeNull();
		const markup = render();
		expect(markup).not.toContain('role="alert"');
		expect(markup).not.toContain("has its worktree");
	});

	test("after a failure the branches are read again, since the command may have made one", async () => {
		const engine = createMockEngine();
		engine.endCommands("stops-after-create");
		const { form, submit } = await openedDialog(engine);
		form.setSelector("origin/feat/config-reload");
		await submit();
		await settle();
		expect(form.getState().branches).toContainEqual({ selector: "feat/config-reload", kind: "local" });
	});
});

describe("matchBranches", () => {
	const branches: BranchSuggestion[] = [
		{ selector: "main", kind: "local" },
		{ selector: "feat/Login", kind: "local" },
		{ selector: "origin/feat/login", kind: "remote" },
	];

	test("is every branch when nothing is typed", () => {
		expect(matchBranches(branches, "")).toEqual(branches);
		expect(matchBranches(branches, "  ")).toEqual(branches);
	});

	test("matches anywhere in the name, whatever the case, and keeps the order", () => {
		expect(matchBranches(branches, "LOGIN").map(branch => branch.selector)).toEqual(["feat/Login", "origin/feat/login"]);
		expect(matchBranches(branches, "origin/").map(branch => branch.selector)).toEqual(["origin/feat/login"]);
		expect(matchBranches(branches, "GH-123")).toEqual([]);
	});

	test("a long list is cut, and says how many more there are", () => {
		const many = Array.from({ length: SHOWN_BRANCHES + 7 }, (_, index): BranchSuggestion => ({ selector: `feat/branch-${index}`, kind: "local" }));
		const markup = renderToStaticMarkup(<BranchField label="Branch" value="" branches={many} onChange={() => {}} />);
		expect(markup.match(/role="option"/g)?.length).toBe(SHOWN_BRANCHES);
		expect(markup).toContain("7 more. Type to narrow the list.");
	});
});

describe("stepActive", () => {
	test("starts at the first or the last option, moves one at a time, and wraps around", () => {
		expect(stepActive(-1, 1, 3)).toBe(0);
		expect(stepActive(-1, -1, 3)).toBe(2);
		expect(stepActive(0, 1, 3)).toBe(1);
		expect(stepActive(2, 1, 3)).toBe(0);
		expect(stepActive(0, -1, 3)).toBe(2);
		expect(stepActive(-1, 1, 0)).toBe(-1);
	});
});

describe("the two modes together", () => {
	test("each mode has its own fields, command, and submit button", async () => {
		const { form, model, render, select } = await openedDialog();
		model.edit({ name: "Fix login bug", base: "origin/main" });
		form.setSelector("feat/github-issue-lookup");
		form.setSetup(true);

		const existing = render();
		expect(existing).toMatch(/class="mode-option selected"><input[^>]*checked=""\/><span class="mode-label">Existing branch/);
		expect(existing).toContain(`>${escaped("timber open --no-setup --result-file <temporary file> --no-editor --no-agent -- feat/github-issue-lookup")}</pre>`);
		expect(existing).toContain(">Open worktree</button>");
		expect(existing).toContain('role="combobox"');
		expect(existing).not.toContain('name="name"');

		select(0);
		const created = render();
		expect(created).toMatch(/class="mode-option selected"><input[^>]*checked=""\/><span class="mode-label">New branch/);
		expect(created).toContain(`>${escaped("timber new --base origin/main --no-setup --result-file <temporary file> --no-editor --no-agent -- 'Fix login bug'")}</pre>`);
		expect(created).toContain(">Create worktree</button>");
		expect(created).toContain('value="Fix login bug"');
		expect(created).not.toContain('role="combobox"');

		// Switching back finds what was typed still there.
		select(1);
		expect(render()).toContain('value="feat/github-issue-lookup"');
		expect(form.getState()).toMatchObject({ selector: "feat/github-issue-lookup", setup: true });
		expect(model.getState().fields).toEqual({ name: "Fix login bug", base: "origin/main", workflow: null });
	});

	test("switching puts a failure away, and it does not show up in the other mode", async () => {
		const { form, submit, render, select, submission } = await openedDialog();
		form.setSelector("no/such-branch");
		expect(await submit()).toBe(false);
		expect(render()).toContain("Could not open the worktree");
		select(0);
		expect(submission.getState().failure).toBeNull();
		expect(render()).not.toContain('role="alert"');
		select(1);
		const markup = render();
		expect(markup).not.toContain('role="alert"');
		expect(markup).toContain('value="no/such-branch"');
	});

	test("the mode cannot change while a command runs, and the switch is disabled", async () => {
		const engine = createMockEngine();
		let release!: (result: WorktreeCommandResult) => void;
		engine.openWorktree = () => new Promise(resolve => {
			release = resolve;
		});
		const { form, submit, render, select, mode } = await openedDialog(engine);
		form.setSelector("feat/github-issue-lookup");
		const first = submit();
		await settle();
		select(0);
		expect(mode().label).toBe("Existing branch");
		expect(render().match(/<input class="mode-radio" type="radio"[^>]* disabled=""[^>]*\/>/g)?.length).toBe(2);
		release({ outcome: "cancelled" });
		await first;
	});

	test("New branch after Timber stopped: Existing branch still works beside it, and the way back finds Run setup", async () => {
		const { engine, model, form, submit, render, select, mode, calls, store, toasts } = await openedDialog();
		engine.endCommands("stops-after-create");
		select(0);
		model.edit({ name: "feat/login" });
		expect(await submit()).toBe(false);
		expect(mode().submitLabel).toBe("Run setup");

		// Over to Existing branch: its own empty form and command, and no failure from the other mode.
		select(1);
		let markup = render();
		expect(markup).not.toContain('role="alert"');
		expect(markup).not.toContain("stopped before its setup");
		expect(mode().submitLabel).toBe("Open worktree");
		expect(mode().canSubmit).toBe(false);
		// The branch that was just created is in the list to pick from once the list is read again.
		await form.readBranches();
		expect(form.getState().branches).toContainEqual({ selector: "feat/login", kind: "local" });

		// Back: the worktree still exists, so the mode still offers setup and not another create.
		select(0);
		markup = render();
		expect(mode().submitLabel).toBe("Run setup");
		expect(mode().command).toBe("timber open --setup --no-editor --no-agent -- /work/timber-worktrees/feat-login");
		expect(markup).toContain("feat/login was created and is in the list, but Timber stopped before its setup.");
		expect(markup).not.toContain('role="alert"');
		expect(markup).not.toContain("Create worktree");

		// Opening that worktree from Existing branch instead closes the dialog as any open does.
		engine.endCommands("succeeds");
		select(1);
		form.setSelector("feat/login");
		expect(await submit()).toBe(true);
		expect(calls).toEqual([{ repository: TIMBER, selector: "feat/login" }]);
		expect(toasts()).toEqual(["Opened feat/login. Its worktree was already there."]);
		expect(store.getState().dialog).toBeNull();
	});

	test("Existing branch after Timber stopped keeps its note and fields through a switch", async () => {
		const engine = createMockEngine();
		engine.endCommands("stops-after-create");
		const { form, submit, render, select, mode } = await openedDialog(engine);
		form.setSelector("chore/update-deps");
		expect(await submit()).toBe(false);
		select(0);
		select(1);
		const markup = render();
		expect(markup).not.toContain('role="alert"');
		expect(markup).toContain("chore/update-deps has its worktree, and it is selected in the list.");
		expect(form.getState()).toMatchObject({ selector: SPARE, setup: true });
		expect(mode().command).toBe(`timber open --no-setup --result-file <temporary file> --no-editor --no-agent -- ${SPARE}`);
	});
});
