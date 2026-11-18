import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "../src/mainview/App";
import { DoneDialogView } from "../src/mainview/components/DoneDialog";
import { createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { createDoneSession } from "../src/mainview/store/done-session";
import { shownSession } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import type { Draw } from "../src/mainview/terminal-feed";
import { describeDoneSessionsWarning, describeOrphanTerminal } from "../src/mainview/terminal-format";
import type { TerminalSession } from "../src/shared/terminal";

const settle = async () => {
	for (let round = 0; round < 5; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const MISSING = "/work/api-server-worktrees/old-removed-folder";
const featureId = sampleRepositories[0]!.worktrees.find(worktree => worktree.path === FEATURE)!.id;

async function startedStore(engine = createMockEngine()) {
	const store = createAppStore(engine, () => () => {});
	const stop = store.start();
	await settle();
	store.select(featureId);
	return { store, engine, stop };
}

async function withTerminal() {
	const started = await startedStore();
	await started.store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 90, rows: 30 });
	await settle();
	const session = shownSession(started.store.getState(), featureId)!;
	return { ...started, session };
}

const render = (store: ReturnType<typeof createAppStore>) => renderToStaticMarkup(<App store={store} />);

describe("terminals in the store", () => {
	test("opening a terminal shows its session, and opening again starts another that shows", async () => {
		const { store, engine, session } = await withTerminal();
		expect(session).toMatchObject({ kind: "terminal", name: "Terminal", repository: TIMBER, path: FEATURE, worktree: featureId, state: { kind: "running" } });
		expect(engine.terminalSize(session.id)).toEqual({ cols: 90, rows: 30 });
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24 });
		const terminals = store.getState().terminals;
		expect(terminals.map(candidate => candidate.name)).toEqual(["Terminal", "Terminal 2"]);
		expect(shownSession(store.getState(), featureId)!.id).toBe(terminals[1]!.id);
	});

	test("two clicks at once start one session", async () => {
		const { store } = await startedStore();
		await Promise.all([
			store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24 }),
			store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24 }),
		]);
		expect(store.getState().terminals).toHaveLength(1);
	});

	test("a terminal that does not start leaves a problem for that worktree, until one starts", async () => {
		const { store, engine } = await startedStore();
		engine.failTerminals({ outcome: "unsupported", message: "Not on this system." });
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24 });
		expect(store.getState().terminalProblem).toEqual({ worktree: featureId, agent: null, message: "Not on this system.", command: null });
		expect(render(store)).toContain("The terminal did not start");
		engine.failTerminals(null);
		await store.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24 });
		expect(store.getState().terminalProblem).toBeNull();
	});

	test("a pane draws what was kept, then each new part once, and says what it drew", async () => {
		const { store, engine, session } = await withTerminal();
		const draws: Draw[] = [];
		const stop = store.watchTerminal(session.id, (draw, done) => {
			draws.push(draw);
			done();
		});
		await settle();
		expect(draws).toHaveLength(1);
		expect(draws[0]!.reset).toBe(true);
		expect(draws[0]!.data).toContain(`A pretend shell in ${FEATURE}`);
		store.writeTerminal(session.id, "pwd\r");
		await settle();
		expect(engine.typedInto(session.id)).toBe("pwd\r");
		const text = draws.map(draw => draw.data).join("");
		expect(text).toContain(`\r\n${FEATURE}\r\n`);
		expect(draws.slice(1).every(draw => !draw.reset)).toBe(true);
		expect(engine.drawnUpTo(session.id)).toBe(draws.at(-1)!.seq);
		stop();
		store.writeTerminal(session.id, "x");
		await settle();
		// Nobody draws it now, so the store says so at once and the engine never waits.
		expect(draws.map(draw => draw.data).join("")).toBe(text);
		expect(engine.drawnUpTo(session.id)).toBe((await engine.readTerminal(session.id))!.seq);
	});

	test("a session that exits stays with its exit code, and Dismiss takes it away", async () => {
		const { store, engine, session } = await withTerminal();
		engine.endTerminal(session.id, 2);
		await settle();
		expect(shownSession(store.getState(), featureId)!.state).toEqual({ kind: "exited", exitCode: 2, signal: null });
		const markup = render(store);
		expect(markup).toContain("Exited with code 2");
		expect(markup).toContain(">Dismiss</button>");
		await store.closeTerminal(session.id);
		await settle();
		expect(store.getState().terminals).toEqual([]);
		expect(render(store)).toContain(">Open terminal</button>");
	});

	test("selecting another worktree and coming back finds the session as it was", async () => {
		const { store, session } = await withTerminal();
		const primary = sampleRepositories[0]!.worktrees[0]!.id;
		store.select(primary);
		expect(render(store)).toContain(">Open terminal</button>");
		store.select(featureId);
		const markup = render(store);
		expect(markup).toContain(`aria-labelledby="session-chip-${session.id}"`);
		expect(store.getState().terminals.map(candidate => candidate.id)).toEqual([session.id]);
	});

	test("a window that starts while sessions run lists them, with changes heard meanwhile on top", async () => {
		const engine = createMockEngine();
		const first = createAppStore(engine, () => () => {});
		first.start();
		await settle();
		await first.openTerminal({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24 });
		await first.openTerminal({ repository: TIMBER, worktree: "/work/timber", cols: 80, rows: 24 });
		const [one, two] = first.getState().terminals;
		// A second window, as after a reload. One session ends while its list is on its way.
		const listed = engine.listTerminals;
		let answer: (sessions: TerminalSession[]) => void = () => {};
		engine.listTerminals = () => new Promise(resolve => {
			answer = resolve;
		});
		const second = createAppStore(engine, () => () => {});
		second.start();
		engine.endTerminal(one!.id, 0);
		await settle();
		answer(await listed());
		await settle();
		const ids = second.getState().terminals.map(session => [session.id, session.state.kind]);
		expect(ids).toContainEqual([one!.id, "exited"]);
		expect(ids).toContainEqual([two!.id, "running"]);
	});

	test("a terminal whose worktree is no longer listed is ended, with a toast", async () => {
		const { store, engine, session } = await withTerminal();
		engine.setRepositories(sampleRepositories.map(repository => repository.path === TIMBER
			? { ...repository, worktrees: repository.worktrees.filter(worktree => worktree.path !== FEATURE) }
			: repository));
		await store.reloadRepository(TIMBER);
		await settle();
		expect(store.getState().terminals).toEqual([]);
		expect(store.getState().toasts.map(toast => toast.text)).toContain(describeOrphanTerminal(FEATURE));
		expect(await engine.readTerminal(session.id)).toBeNull();
	});

	test("a worktree whose identity changed while its folder could not be verified keeps its terminal", async () => {
		const { store, engine } = await withTerminal();
		engine.setRepositories(sampleRepositories.map(repository => repository.path === TIMBER
			? { ...repository, worktrees: repository.worktrees.map(worktree => worktree.path === FEATURE ? { ...worktree, id: "registered:feature", canonicalPath: null } : worktree) }
			: repository));
		await store.reloadRepository(TIMBER);
		await settle();
		expect(store.getState().terminals).toHaveLength(1);
		expect(store.getState().toasts).toEqual([]);
	});

	test("a repository whose worktrees Timber could not list keeps its terminals", async () => {
		const { store, engine } = await withTerminal();
		engine.failTimber(TIMBER, "Timber is busy");
		await store.reloadRepository(TIMBER);
		await settle();
		expect(store.getState().terminals).toHaveLength(1);
	});

	test("a worktree removed with Done ends its terminal, and the dialog warned first", async () => {
		const { store, engine, session } = await withTerminal();
		const markup = renderToStaticMarkup(
			<DoneDialogView
				repository="timber"
				worktree={sampleRepositories[0]!.worktrees.find(worktree => worktree.id === featureId)!}
				gone={false}
				runningSessions={1}
				session={createDoneSession({ repository: TIMBER, path: FEATURE, preview: store.previewDone, apply: store.applyDone, listed: () => true }).getState()}
				submission={{ running: false, failure: null }}
				baseDraft=""
				onBaseDraft={() => {}}
				onBaseCommit={() => {}}
				onOptions={() => {}}
				onRefresh={() => {}}
				onRemove={() => {}}
				onClose={() => {}}
			/>,
		);
		expect(markup).toContain(describeDoneSessionsWarning(1));
		const preview = await store.previewDone({ repository: TIMBER, path: FEATURE, options: { keepBranch: false, keepIgnored: false, base: null } });
		if (preview.outcome !== "previewed") throw new Error("No preview");
		const result = await store.applyDone({ repository: TIMBER, path: FEATURE, preview: preview.id });
		expect(result.outcome).toBe("removed");
		await settle();
		expect(store.getState().terminals).toEqual([]);
		expect(await engine.readTerminal(session.id)).toBeNull();
	});

	test("quitting while a terminal runs asks first, and Keep running keeps everything", async () => {
		const { store, engine, session } = await withTerminal();
		expect(engine.requestQuit()).toBe(false);
		expect(store.getState().quitRequest).toBe(1);
		const markup = render(store);
		expect(markup).toContain("Quit Timber?");
		expect(markup).toContain("A session is still running. Quitting ends it and everything running in it.");
		expect(markup).toMatch(/<button type="button" class="button quiet"[^>]*>Keep running<\/button>/);
		store.cancelQuit();
		expect(store.getState().quitRequest).toBeNull();
		expect(engine.quitConfirmed()).toBe(false);
		expect(shownSession(store.getState(), featureId)!.id).toBe(session.id);
	});

	test("Quit ends every terminal and quits", async () => {
		const { store, engine } = await withTerminal();
		engine.requestQuit();
		await store.confirmQuit();
		await settle();
		expect(engine.quitConfirmed()).toBe(true);
		expect(store.getState().terminals).toEqual([]);
		expect(store.getState().quitRequest).toBeNull();
	});

	test("with no terminal running, quitting asks nothing", async () => {
		const { store, engine } = await startedStore();
		expect(engine.requestQuit()).toBe(true);
		expect(store.getState().quitRequest).toBeNull();
	});

	test("copy, paste, and links go through the engine; only web links open", async () => {
		const { store, engine } = await startedStore();
		await store.copyText("selected text");
		expect(await store.pasteText()).toBe("selected text");
		await store.openLink("https://example.com/");
		await store.openLink("file:///etc/passwd");
		expect(engine.openedLinks()).toEqual(["https://example.com/"]);
	});
});

describe("the Workspace tab", () => {
	test("offers to open a terminal, and not for a worktree whose folder is missing", async () => {
		const { store } = await startedStore();
		expect(render(store)).toMatch(/<button type="button" class="button" id="session-add" title="[^"]+">Open terminal<\/button>/);
		const missing = createMockEngine();
		const started = await startedStore(missing);
		const repository = (await missing.listRepositories()).find(candidate => candidate.worktrees.some(worktree => worktree.path === MISSING));
		expect(repository).toBeDefined();
		started.store.select(repository!.worktrees.find(worktree => worktree.path === MISSING)!.id);
		expect(render(started.store)).toMatch(/<button type="button" class="button" id="session-add" disabled=""[^>]*>Open terminal<\/button>/);
	});

	test("a running session shows its chip, state, and a close control, and no shortcut hint", async () => {
		const { store } = await withTerminal();
		const markup = render(store);
		// The controls share the row of chips, so no bar of their own takes height above the terminal.
		const stripAt = markup.indexOf('class="session-strip"');
		const strip = markup.slice(stripAt, markup.indexOf(`id="session-panel"`, stripAt));
		expect(strip).toContain('class="session-controls"');
		expect(strip).toContain('role="status">Running</span>');
		expect(strip).toContain(">Rename</button>");
		expect(markup).not.toContain("session-bar");
		expect(markup).toContain('class="session-chip selected running"');
		expect(markup).toContain("mock-shell");
		expect(markup).toContain('role="status">Running</span>');
		expect(markup).not.toContain("session-hint");
		expect(markup).toContain('aria-label="Close Terminal and end its processes"');
		expect(markup).toContain('class="terminal-screen"');
	});
});
