import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { createMockEngine, samplePickableRepository, sampleRepositories, sampleStatesRepository } from "../src/mainview/engine/mock";
import { wizardSaveRequest } from "../src/mainview/setup-wizard-format";
import { selectedWorktree } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { draftsOf } from "../src/mainview/timber-settings-format";
import type { TimberConfigScope } from "../src/shared/timber-config";

const settle = async () => {
	for (let round = 0; round < 8; round += 1) await Bun.sleep(0);
};

const DOCS = samplePickableRepository.path;
const DOCS_MAIN = samplePickableRepository.worktrees[0]!;
const DOCS_FEATURE = samplePickableRepository.worktrees[1]!;
const PROMPT = "docs-site is not set up for Timber. Setup is optional.";
const ANY_PROMPT = "is not set up for Timber.";
const WIZARD = "Set up Timber for docs-site";

type Store = ReturnType<typeof createAppStore>;
const render = (store: Store) => renderToStaticMarkup(<App store={store} />);

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	store.start();
	await settle();
	return { engine, store };
}

/** A store that added the repository that was never set up, as a person would with Add repository. */
async function withNewRepository(engine = createMockEngine()) {
	const started = await startedStore(engine);
	await started.store.addRepository();
	await settle();
	return started;
}

const setUp = (store: Store) => store.openDialog({ kind: "set-up-timber", repository: DOCS });
const docs = (store: Store) => store.getState().repositories.find(repository => repository.path === DOCS)!;

/** What the wizard's last step saves, with the fields as read, or changed by `edit`. */
async function saveFromWizard(store: Store, scope: TimberConfigScope, edit: (drafts: ReturnType<typeof draftsOf>) => void = () => {}) {
	const read = await store.readTimberSettings({ scope, repository: scope === "repository" ? DOCS : null });
	if (read.outcome !== "read") throw new Error(`Not read: ${JSON.stringify(read)}`);
	const drafts = draftsOf(read.settings.values);
	edit(drafts);
	return store.saveTimberSettings(wizardSaveRequest(scope, DOCS, read.settings, drafts, false));
}

describe("a repository that was never set up for Timber", () => {
	test("shows the setup prompt, not an error, and its worktrees as usual", async () => {
		const { store } = await withNewRepository();
		expect(selectedWorktree(store.getState())?.repository.path).toBe(DOCS);
		const markup = render(store);
		expect(markup).toContain(PROMPT);
		expect(markup).toMatch(/class="button"[^>]*>Set up Timber</);
		expect(markup).toContain("Not now");
		// One sentence shows; the tooltip gives it whole with the longer explanation.
		expect(markup).toContain(`title="${PROMPT} Everything works with Timber&#x27;s defaults. Setup saves your editor, agent, setup scripts, and starting branch for this repository."`);
		expect(markup).not.toContain("timber setup");
		expect(markup).not.toContain('role="alert"');
		expect(markup).toContain(DOCS_FEATURE.path);
	});

	test("repositories with their own settings or machine defaults show no prompt", async () => {
		const { store } = await startedStore(createMockEngine([...sampleRepositories, sampleStatesRepository]));
		for (const repository of [...sampleRepositories, sampleStatesRepository]) {
			store.select(repository.worktrees[0]!.id);
			expect(render(store)).not.toContain(ANY_PROMPT);
		}
	});

	test("the prompt follows the selected repository", async () => {
		const { store } = await withNewRepository();
		store.select(sampleRepositories[0]!.worktrees[0]!.id);
		expect(render(store)).not.toContain(PROMPT);
		store.select(DOCS_FEATURE.id);
		expect(render(store)).toContain(PROMPT);
	});
});

describe("Set up Timber", () => {
	test("opens the setup wizard for the right repository, and starts no terminal session", async () => {
		const { store } = await withNewRepository();
		store.select(DOCS_FEATURE.id);
		setUp(store);
		expect(store.getState().dialog).toEqual({ kind: "set-up-timber", repository: DOCS });
		const markup = render(store);
		expect(markup).toContain(WIZARD);
		expect(markup).toContain("Step 1 of 7: Where to save");
		// The longer explanation the prompt leaves to its tooltip is here too.
		expect(markup).toContain("Everything works with Timber&#x27;s defaults.");
		await settle();
		expect(store.getState().terminals).toEqual([]);
		expect(store.getState().operations.some(operation => operation.kind === "open-terminal")).toBe(false);
	});

	test("the wizard needs a repository that is listed and there", async () => {
		const { store } = await withNewRepository();
		store.openDialog({ kind: "set-up-timber", repository: "/work/not-listed" });
		expect(render(store)).not.toContain("Set up Timber for");
	});

	test("saving through Timber puts the prompt away at once, without the window getting the focus back", async () => {
		const { store } = await withNewRepository();
		setUp(store);
		const saved = await saveFromWizard(store, "repository", drafts => {
			drafts.editor = { ...drafts.editor, mode: "set", command: "zed", args: ["--new"] };
			drafts.git = { ...drafts.git, base_branch: "main" };
		});
		expect(saved.outcome).toBe("saved");
		// Read again by the save itself: no windowChanged, no refresh.
		expect(docs(store).setup).toBe("repository");
		store.closeDialog();
		expect(render(store)).not.toContain(PROMPT);
		const again = await store.readTimberSettings({ scope: "repository", repository: DOCS });
		expect(again.outcome === "read" && again.settings.values).toMatchObject({ editor: { command: "zed", args: ["--new"] }, base_branch: "main" });
	});

	test("with every choice left alone, saving still sets the repository up, as Timber writes the file", async () => {
		const { store } = await withNewRepository();
		expect((await saveFromWizard(store, "repository")).outcome).toBe("saved");
		expect(docs(store).setup).toBe("repository");
	});

	test("machine defaults, as timber setup --global saves them, set the repository up too", async () => {
		const { store } = await withNewRepository();
		expect((await saveFromWizard(store, "machine")).outcome).toBe("saved");
		expect(docs(store).setup).toBe("machine");
		expect(render(store)).not.toContain(PROMPT);
	});

	test("cancelling saves nothing and leaves the prompt in place", async () => {
		const { store } = await withNewRepository();
		setUp(store);
		store.closeDialog();
		await settle();
		expect(store.getState().dialog).toBeNull();
		expect(docs(store).setup).toBe("none");
		const read = await store.readTimberSettings({ scope: "repository", repository: DOCS });
		expect(read.outcome === "read" && read.settings.exists).toBe(false);
		const markup = render(store);
		expect(markup).toContain(PROMPT);
		expect(markup).toMatch(/class="button"[^>]*>Set up Timber</);
	});

	test("a save Timber refuses keeps the prompt", async () => {
		const { store } = await withNewRepository();
		const refused = await saveFromWizard(store, "repository", drafts => {
			drafts.git = { ...drafts.git, base_branch: " " };
		});
		expect(refused).toMatchObject({ outcome: "invalid", invalidFields: ["base_branch is invalid"] });
		expect(docs(store).setup).toBe("none");
		expect(render(store)).toContain(PROMPT);
	});
});

describe("Not now", () => {
	test("puts the prompt away, remembers it for the next run, and the repository works as before", async () => {
		const { engine, store } = await withNewRepository();
		store.dismissSetup(DOCS);
		await settle();
		expect(render(store)).not.toContain(PROMPT);
		expect((await engine.loadLayout()).setupDismissed).toEqual([DOCS]);

		// The repository keeps working: its worktrees are listed and a terminal starts in them.
		expect(docs(store).worktrees.map(worktree => worktree.path)).toEqual([DOCS_MAIN.path, DOCS_FEATURE.path]);
		await store.openTerminal({ repository: DOCS, worktree: DOCS_MAIN.path, cols: 80, rows: 24 });
		expect(store.getState().terminals.filter(session => session.repository === DOCS && session.kind === "terminal")).toHaveLength(1);
		await store.reloadRepository(DOCS);
		expect(store.getState().error).toBeNull();

		// After a restart the prompt stays away.
		const again = createAppStore(engine, () => () => {});
		again.start();
		await settle();
		again.select(DOCS_MAIN.id);
		expect(render(again)).not.toContain(PROMPT);
	});

	test("is forgotten with the repository, so adding it again offers setup again", async () => {
		const { engine, store } = await withNewRepository();
		store.dismissSetup(DOCS);
		await settle();
		await store.removeRepository(DOCS);
		await settle();
		expect((await engine.loadLayout()).setupDismissed).toEqual([]);
		expect(store.getState().layout.setupDismissed).toEqual([]);
		await store.addRepository();
		await settle();
		expect(render(store)).toContain(PROMPT);
	});
});

describe("a fresh install with no repositories", () => {
	test("shows adding a repository as the first step", async () => {
		const { store } = await startedStore(createMockEngine([]));
		const markup = render(store);
		expect(markup).toContain("No repository yet");
		expect(markup).toContain("Start by adding a Git repository.");
		expect(markup).toMatch(/class="button"[^>]*>Add repository</);
		expect(markup).not.toContain(ANY_PROMPT);
	});
});
