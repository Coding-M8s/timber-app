import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { createMockEngine, samplePickableRepository, sampleRepositories, sampleStatesRepository, sampleTimberStatuses } from "../src/mainview/engine/mock";
import { selectedWorktree } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import { TERMINAL_UNSUPPORTED_REASON, TIMBER_SETUP_SESSION_NAME } from "../src/shared/terminal";

const settle = async () => {
	for (let round = 0; round < 8; round += 1) await Bun.sleep(0);
};

const DOCS = samplePickableRepository.path;
const DOCS_MAIN = samplePickableRepository.worktrees[0]!;
const DOCS_FEATURE = samplePickableRepository.worktrees[1]!;
const PROMPT = "docs-site is not set up for Timber yet";

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

const setUp = (store: Store) => store.setUpRepository(DOCS);
const setupSessions = (store: Store) => store.getState().terminals.filter(session => session.kind === "timber");
const docs = (store: Store) => store.getState().repositories.find(repository => repository.path === DOCS)!;

describe("a repository that was never set up for Timber", () => {
	test("shows the setup prompt with the command it runs, not an error, and its worktrees as usual", async () => {
		const { store } = await withNewRepository();
		expect(selectedWorktree(store.getState())?.repository.path).toBe(DOCS);
		const markup = render(store);
		expect(markup).toContain(PROMPT);
		expect(markup).toMatch(/class="button"[^>]*>Set up Timber</);
		expect(markup).toContain("Not now");
		expect(markup).toContain('<code class="setup-prompt-command">timber setup</code>');
		expect(markup).not.toContain('role="alert"');
		expect(markup).toContain(DOCS_FEATURE.path);
	});

	test("repositories with their own settings or machine defaults show no prompt", async () => {
		const { store } = await startedStore(createMockEngine([...sampleRepositories, sampleStatesRepository]));
		for (const repository of [...sampleRepositories, sampleStatesRepository]) {
			store.select(repository.worktrees[0]!.id);
			expect(render(store)).not.toContain("is not set up for Timber yet");
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
	test("starts timber setup for the right repository in its primary checkout, and shows it", async () => {
		const { store } = await withNewRepository();
		store.showTab("changes");
		await setUp(store);
		const [session] = setupSessions(store);
		expect(session).toMatchObject({
			kind: "timber", name: TIMBER_SETUP_SESSION_NAME, repository: DOCS, worktree: DOCS_MAIN.id, path: DOCS_MAIN.path, command: `${sampleTimberStatuses.ready.path} setup`,
		});
		expect(store.getState().tab).toBe("workspace");
		expect(store.getState().shownSessions[DOCS_MAIN.id]).toBe(session!.id);
		await settle();
		const markup = render(store);
		// While it runs, the prompt stays, and its button shows that session again instead of starting another.
		expect(markup).toContain(PROMPT);
		expect(markup).toContain("Show setup");
	});

	test("the prompt disappears once setup saved the settings", async () => {
		const { engine, store } = await withNewRepository();
		await setUp(store);
		const [session] = setupSessions(store);
		engine.writeTerminal(session!.id, "save\r");
		await settle();
		expect(store.getState().terminals.find(candidate => candidate.id === session!.id)?.state).toEqual({ kind: "exited", exitCode: 0, signal: null });
		expect(docs(store).setup).toBe("repository");
		expect(render(store)).not.toContain(PROMPT);
	});

	test("a cancelled setup ends the same way, so the prompt stays until there are settings", async () => {
		const { engine, store } = await withNewRepository();
		await setUp(store);
		const [session] = setupSessions(store);
		engine.writeTerminal(session!.id, "cancel\r");
		await settle();
		expect(store.getState().terminals.find(candidate => candidate.id === session!.id)?.state.kind).toBe("exited");
		expect(docs(store).setup).toBe("none");
		const markup = render(store);
		expect(markup).toContain(PROMPT);
		expect(markup).toMatch(/class="button"[^>]*>Set up Timber</);
	});

	test("closing a running setup reads the repository again too", async () => {
		const { engine, store } = await withNewRepository();
		await setUp(store);
		const [session] = setupSessions(store);
		// Settings saved some other way while it ran, such as from a terminal outside the app.
		engine.setRepositories(store.getState().repositories.map(repository => repository.path === DOCS ? { ...repository, setup: "repository" } : repository));
		await store.closeTerminal(session!.id);
		await settle();
		expect(docs(store).setup).toBe("repository");
	});

	test("from a linked worktree, setup runs in the primary checkout of the repository it belongs to, as in Settings", async () => {
		const { store } = await withNewRepository();
		store.select(DOCS_FEATURE.id);
		expect(render(store)).toContain(PROMPT);
		await setUp(store);
		expect(setupSessions(store)).toMatchObject([{ repository: DOCS, worktree: DOCS_MAIN.id, path: DOCS_MAIN.path }]);
		expect(selectedWorktree(store.getState())?.worktree.id).toBe(DOCS_MAIN.id);
	});

	test("while setup runs, asking again shows that session and starts no other", async () => {
		const { store } = await withNewRepository();
		await setUp(store);
		const [first] = setupSessions(store);
		store.select(DOCS_FEATURE.id);
		store.showTab("changes");
		await setUp(store);
		expect(setupSessions(store)).toHaveLength(1);
		expect(selectedWorktree(store.getState())?.worktree.id).toBe(DOCS_MAIN.id);
		expect(store.getState().tab).toBe("workspace");
		expect(store.getState().shownSessions[DOCS_MAIN.id]).toBe(first!.id);
	});

	test("when setup cannot start, its worktree's sessions say why with the command, and the repository stays usable", async () => {
		const { engine, store } = await withNewRepository();
		engine.failTerminals({ outcome: "not-found", command: "timber setup", executable: "timber", message: "Timber was not found on PATH. Nothing was started." });
		await setUp(store);
		expect(setupSessions(store)).toEqual([]);
		expect(store.getState().terminalProblem).toMatchObject({ worktree: DOCS_MAIN.id, message: "Timber was not found on PATH. Nothing was started.", command: "timber setup" });
		const markup = render(store);
		expect(markup).toContain("Timber was not found on PATH. Nothing was started.");
		expect(markup).toContain(PROMPT);
		engine.failTerminals(null);
		await setUp(store);
		expect(setupSessions(store)).toHaveLength(1);
	});

	test("a primary checkout whose folder is missing cannot run setup, and the prompt says why", async () => {
		const missing = { ...samplePickableRepository, worktrees: [{ ...DOCS_MAIN, pathExists: false }, DOCS_FEATURE] };
		const engine = createMockEngine();
		const { store } = await startedStore(engine);
		engine.setRepositories([...sampleRepositories, missing]);
		await store.refresh();
		store.select(DOCS_FEATURE.id);
		const markup = render(store);
		expect(markup).toContain(PROMPT);
		expect(markup).toMatch(/class="button" disabled=""[^>]*>Set up Timber</);
		expect(markup).toContain("Setup runs in the primary checkout of docs-site");
	});
});

describe("a setup that ends while the window is away", () => {
	test("ending before the sessions were listed again still reads the repositories again", async () => {
		const engine = createMockEngine();
		const { store } = await withNewRepository(engine);
		await setUp(store);
		const [session] = setupSessions(store);

		// The window reloads: a new store reads the repositories, while its list of sessions has not answered yet.
		let answer: () => void = () => {};
		const held = new Promise<void>(resolve => {
			answer = resolve;
		});
		const listTerminals = engine.listTerminals;
		const reloaded = createAppStore({ ...engine, listTerminals: async () => {
			await held;
			return listTerminals();
		} }, () => () => {});
		reloaded.start();
		await settle();
		reloaded.select(DOCS_MAIN.id);
		expect(render(reloaded)).toContain(PROMPT);

		// Setup saves and ends meanwhile, and only then do the sessions answer.
		engine.writeTerminal(session!.id, "save\r");
		await settle();
		answer();
		await settle();
		expect(reloaded.getState().repositories.find(repository => repository.path === DOCS)?.setup).toBe("repository");
		expect(render(reloaded)).not.toContain(PROMPT);
	});
});

describe("on an operating system without terminals", () => {
	test("the sessions say why, and the repository stays usable", async () => {
		const { engine, store } = await withNewRepository();
		engine.failTerminals({ outcome: "unsupported", message: TERMINAL_UNSUPPORTED_REASON });
		await setUp(store);
		expect(store.getState().terminalProblem).toMatchObject({ worktree: DOCS_MAIN.id, message: TERMINAL_UNSUPPORTED_REASON });
		const markup = render(store);
		expect(markup).toContain(TERMINAL_UNSUPPORTED_REASON);
		expect(markup).toContain(DOCS_FEATURE.path);
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
		expect(markup).not.toContain("is not set up for Timber yet");
	});
});
