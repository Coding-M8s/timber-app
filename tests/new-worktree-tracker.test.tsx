import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { newBranchMode } from "../src/mainview/components/worktree-modes/new-branch";
import { createNewBranchModel } from "../src/mainview/components/worktree-modes/new-branch-model";
import { chosenTracker, defaultTrackerLabel, shownTrackers, trackerOfOption } from "../src/mainview/components/worktree-modes/tracker-choice";
import { type MockEngine, createMockEngine } from "../src/mainview/engine/mock";
import { createAppStore } from "../src/mainview/store/store";
import { createSubmission } from "../src/mainview/store/submission";
import type { IssueTrackers } from "../src/shared/issue-trackers";
import type { NewWorktreeRequest } from "../src/shared/model";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const API = "/work/api-server";
const COMMAND = "timber new --no-setup --result-file <temporary file> --no-editor --no-agent --";

/** The "New branch" mode as the dialog wires it, after the trackers were read. `asked` holds every `timber new` request. */
async function newBranch(path = TIMBER, engine: MockEngine = createMockEngine()) {
	const asked: NewWorktreeRequest[] = [];
	const { newWorktree } = engine;
	engine.newWorktree = request => (asked.push(request), newWorktree(request));
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
	await model.readTrackers();
	const mode = () => newBranchMode(model, model.getState(), repository, submission);
	const fields = () => renderToStaticMarkup(<>{mode().fields}</>);
	const submit = async () => {
		const worked = await submission.submit(async () => (await mode().run()).outcome);
		await settle();
		return worked;
	};
	return { engine, store, model, mode, fields, submit, asked };
}

const both: IssueTrackers = { ok: true, defaultTracker: "github", available: ["github", "jira"], githubRepository: "example/timber" };

describe("which trackers show", () => {
	test("only with two or more set up, and only those", () => {
		expect(shownTrackers(both)).toEqual(["github", "jira"]);
		expect(shownTrackers({ ok: true, defaultTracker: "github", available: ["github", "jira", "linear"], githubRepository: "example/timber" })).toEqual(["github", "jira", "linear"]);
		expect(shownTrackers({ ok: true, defaultTracker: "github", available: ["github"], githubRepository: "example/timber" })).toEqual([]);
		expect(shownTrackers({ ok: true, defaultTracker: null, available: [], githubRepository: null })).toEqual([]);
		expect(shownTrackers({ ok: false, message: "Invalid TOML" })).toEqual([]);
		expect(shownTrackers(undefined)).toEqual([]);
	});

	test("a pick counts only while the field offers it", () => {
		expect(chosenTracker(both, "jira")).toBe("jira");
		expect(chosenTracker(both, null)).toBeNull();
		expect(chosenTracker(both, "linear")).toBeNull();
		expect(chosenTracker({ ok: true, defaultTracker: "github", available: ["jira"], githubRepository: null }, "jira")).toBeNull();
		expect(chosenTracker(undefined, "jira")).toBeNull();
	});

	test("Default names Timber's default tracker when there is one", () => {
		expect(defaultTrackerLabel(both)).toBe("Default (GitHub)");
		expect(defaultTrackerLabel({ ok: true, defaultTracker: "jira", available: ["github", "jira"], githubRepository: "example/timber" })).toBe("Default (Jira)");
		expect(defaultTrackerLabel({ ok: true, defaultTracker: null, available: ["github", "jira"], githubRepository: "example/timber" })).toBe("Default");
	});

	test("the empty option is Default", () => {
		expect(trackerOfOption("")).toBeNull();
		expect(trackerOfOption("jira")).toBe("jira");
		expect(trackerOfOption("gitlab")).toBeNull();
	});
});

describe("the Tracker field with GitHub and Jira set up", () => {
	test("lists Default, GitHub, and Jira, and starts on Default", async () => {
		const { fields, model } = await newBranch();
		expect(model.getState().trackers).toEqual(both);
		const markup = fields();
		expect(markup).toContain('<span class="field-label">Tracker</span><select class="field-input" name="tracker">');
		expect(markup).toContain('<option value="" selected="">Default (GitHub)</option><option value="github">GitHub</option><option value="jira">Jira</option>');
		expect(markup).not.toContain("Linear");
		// It sits right under Name.
		expect(markup.indexOf('name="tracker"')).toBeGreaterThan(markup.indexOf('name="name"'));
		expect(markup.indexOf('name="tracker"')).toBeLessThan(markup.indexOf('name="base"'));
	});

	test("Default passes the name unchanged", async () => {
		const { model, mode } = await newBranch();
		model.edit({ name: "ENG-42" });
		expect(mode().command).toBe(`${COMMAND} ENG-42`);
	});

	test("picking Jira shows the jira: prefix in the footer before it runs, and runs with it", async () => {
		const { model, mode, fields, submit, asked } = await newBranch();
		model.edit({ name: " ENG-42 ", tracker: "jira" });
		expect(fields()).toContain('<option value="jira" selected="">Jira</option>');
		expect(fields()).toContain("An issue key in Name is read as a Jira issue, for this worktree only.");
		expect(mode().command).toBe(`${COMMAND} jira:ENG-42`);
		expect(asked).toEqual([]);
		expect(await submit()).toBe(true);
		expect(asked).toEqual([{ repository: TIMBER, name: "jira:ENG-42", base: null }]);
	});

	test("picking Jira prefixes a lowercase key as typed, shown in the footer before it runs", async () => {
		const { model, mode, submit, asked } = await newBranch();
		model.edit({ name: "eng-42", tracker: "jira" });
		expect(mode().command).toBe(`${COMMAND} jira:eng-42`);
		expect(asked).toEqual([]);
		expect(await submit()).toBe(true);
		expect(asked).toEqual([{ repository: TIMBER, name: "jira:eng-42", base: null }]);
	});

	test("picking GitHub shows the github: prefix for an issue number", async () => {
		const { model, mode, submit, asked } = await newBranch();
		model.edit({ name: "42", tracker: "github" });
		expect(mode().command).toBe(`${COMMAND} github:42`);
		expect(await submit()).toBe(true);
		expect(asked).toEqual([{ repository: TIMBER, name: "github:42", base: null }]);
	});

	test("a name that is not an issue key passes unchanged", async () => {
		const { model, mode } = await newBranch();
		model.edit({ name: "Fix login bug", tracker: "jira" });
		expect(mode().command).toBe(`${COMMAND} 'Fix login bug'`);
		model.edit({ name: "feat/login", tracker: "github" });
		expect(mode().command).toBe(`${COMMAND} feat/login`);
		model.edit({ name: "ENG-42", tracker: "github" });
		expect(mode().command).toBe(`${COMMAND} ENG-42`);
		model.edit({ name: "42", tracker: "jira" });
		expect(mode().command).toBe(`${COMMAND} 42`);
	});

	test("a pick changes no Timber setting", async () => {
		const { engine, model, submit } = await newBranch();
		const read = async () => [await engine.readTimberSettings({ scope: "machine", repository: null }), await engine.readTimberSettings({ scope: "repository", repository: TIMBER })];
		const before = await read();
		model.edit({ name: "ENG-42", tracker: "jira" });
		expect(await submit()).toBe(true);
		expect(await read()).toEqual(before);
		const [machine] = before;
		expect(machine!.outcome === "read" && machine!.settings.effective.default_tracker).toBe("github");
	});
});

describe("the Tracker field in other repositories", () => {
	test("is not shown with only GitHub set up, and the name passes unchanged", async () => {
		const { model, fields, mode } = await newBranch(API);
		expect(model.getState().trackers).toEqual({ ok: true, defaultTracker: "github", available: ["github"], githubRepository: "example/api-server" });
		expect(fields()).not.toContain('name="tracker"');
		// A pick left from before cannot reach the command.
		model.edit({ name: "ENG-42", tracker: "jira" });
		expect(mode().command).toBe(`${COMMAND} ENG-42`);
	});

	test("is not shown when the trackers cannot be read, and creating still works", async () => {
		const engine = createMockEngine();
		engine.breakTimberConfig(TIMBER, "Invalid TOML in /work/timber/.timber.toml");
		const { model, fields, submit, asked } = await newBranch(TIMBER, engine);
		expect(model.getState().trackers).toEqual({ ok: false, message: "Invalid TOML in /work/timber/.timber.toml" });
		expect(fields()).not.toContain('name="tracker"');
		model.edit({ name: "42", tracker: "github" });
		expect(await submit()).toBe(true);
		expect(asked).toEqual([{ repository: TIMBER, name: "42", base: null }]);
	});

	test("is not shown once GitHub is gone and Jira is the only one left", async () => {
		const engine = createMockEngine();
		engine.setGithubRemote(TIMBER, false);
		const { model, fields } = await newBranch(TIMBER, engine);
		expect(model.getState().trackers).toEqual({ ok: true, defaultTracker: "github", available: ["jira"], githubRepository: null });
		expect(fields()).not.toContain('name="tracker"');
	});

	test("lists Linear once a Linear login is saved", async () => {
		const engine = createMockEngine();
		const machine = await engine.readTimberSettings({ scope: "machine", repository: null });
		if (machine.outcome !== "read") throw new Error("the sample machine settings should read");
		const saved = await engine.saveTimberSettings({
			scope: "machine", repository: null, revision: machine.settings.revision, values: machine.settings.values, credentials: { linear: { token: "lin_api_sample" } }, editTracked: false,
		});
		expect(saved.outcome).toBe("saved");
		const { fields, model, mode, submit, asked } = await newBranch(API, engine);
		expect(fields()).toContain('<option value="" selected="">Default (GitHub)</option><option value="github">GitHub</option><option value="linear">Linear</option>');
		model.edit({ name: "ENG-7", tracker: "linear" });
		expect(mode().command).toBe(`${COMMAND} linear:ENG-7`);
		model.edit({ name: "eng-7" });
		expect(mode().command).toBe(`${COMMAND} linear:eng-7`);
		expect(await submit()).toBe(true);
		expect(asked).toEqual([{ repository: API, name: "linear:eng-7", base: null }]);
	});

	test("an engine that throws while reading is no field, not a broken dialog", async () => {
		const engine = createMockEngine();
		engine.readIssueTrackers = async () => {
			throw new Error("the bridge closed");
		};
		const { model, fields } = await newBranch(TIMBER, engine);
		expect(model.getState().trackers).toMatchObject({ ok: false });
		expect(fields()).not.toContain('name="tracker"');
	});

	test("only the latest read counts", async () => {
		const engine = createMockEngine();
		const { model } = await newBranch(TIMBER, engine);
		const answers: ((value: IssueTrackers) => void)[] = [];
		engine.readIssueTrackers = () => new Promise(resolve => answers.push(resolve));
		const first = model.readTrackers();
		const second = model.readTrackers();
		answers[1]!({ ok: true, defaultTracker: null, available: ["github", "linear"], githubRepository: "example/timber" });
		answers[0]!({ ok: false, message: "stale" });
		await Promise.all([first, second]);
		expect(model.getState().trackers).toEqual({ ok: true, defaultTracker: null, available: ["github", "linear"], githubRepository: "example/timber" });
	});
});
