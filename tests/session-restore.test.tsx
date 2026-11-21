import { describe, expect, test } from "bun:test";
import { type MockEngine, type MockEngineOptions, createMockEngine, sampleRepositories } from "../src/mainview/engine/mock";
import { type MockSessionStorage, memorySessionStorage } from "../src/mainview/engine/mock-session-storage";
import { RESTORE_CONCURRENCY, goneSavedWorktrees, restoreJobs, restoreRequest, runLimited } from "../src/mainview/store/restore";
import { sessionsOf, shownSession } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";
import type { Attention } from "../src/shared/attention";
import type { Repository } from "../src/shared/model";
import { type SavedSessions, parseSavedSessions, serializeSavedSessions } from "../src/shared/saved-sessions";

const settle = async (rounds = 8) => {
	for (let round = 0; round < rounds; round += 1) await Bun.sleep(0);
};
const TIMBER = "/work/timber";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";
const timberRepository = sampleRepositories[0]!;
const featureId = timberRepository.worktrees.find(worktree => worktree.path === FEATURE)!.id;
const primaryId = timberRepository.worktrees.find(worktree => worktree.path === TIMBER)!.id;

type Store = ReturnType<typeof createAppStore>;

function run(storage: MockSessionStorage, repositories: Repository[] = sampleRepositories, options: MockEngineOptions = {}, before: (engine: MockEngine) => void = () => {}) {
	const engine = createMockEngine(repositories, undefined, { savedSessions: storage, ...options });
	before(engine);
	const store = createAppStore(engine, () => () => {});
	store.start();
	return { engine, store };
}

/** Wait until a check holds, or a second passed. */
async function until(check: () => boolean, milliseconds = 1000): Promise<void> {
	const end = Date.now() + milliseconds;
	while (!check() && Date.now() < end) await Bun.sleep(1);
	if (!check()) throw new Error("did not happen in time");
}

const open = (store: Store, worktree: string, agent?: string) =>
	store.openTerminal({ repository: TIMBER, worktree, cols: 80, rows: 24, ...(agent ? { agent } : {}) });

const quit = async (engine: MockEngine, store: Store) => {
	if (!engine.requestQuit()) await store.confirmQuit();
	expect(engine.quitConfirmed()).toBe(true);
};

/** A first run with, in FEATURE, a terminal, Claude Code, and Codex, with Claude Code showing, and in TIMBER a terminal; FEATURE selected. */
async function firstRun(storage: MockSessionStorage) {
	const { engine, store } = run(storage);
	await settle();
	store.select(featureId);
	await open(store, FEATURE);
	await open(store, FEATURE, "Claude Code");
	await open(store, FEATURE, "Codex");
	store.select(primaryId);
	await open(store, TIMBER);
	await settle();
	const [terminal, claude, codex] = sessionsOf(store.getState(), featureId);
	store.select(featureId);
	store.showSession(claude!.id);
	await settle();
	return { engine, store, terminal: terminal!, claude: claude!, codex: codex! };
}

const kinds = (store: Store, worktree: string) => sessionsOf(store.getState(), worktree).map(session => [session.kind, session.name, session.state.kind]);

describe("which saved sessions open, and how", () => {
	const saved: SavedSessions = {
		selected: "api",
		worktrees: {
			[featureId]: { shown: 0, sessions: [{ kind: "terminal" }] },
			[primaryId]: { shown: 0, sessions: [{ kind: "terminal" }] },
			api: { shown: 0, sessions: [{ kind: "terminal" }] },
			gone: { shown: 0, sessions: [{ kind: "terminal" }] },
			missing: { shown: 0, sessions: [{ kind: "terminal" }] },
			off: { shown: 0, sessions: [{ kind: "terminal" }] },
		},
	};
	const worktree = (id: string, path: string, pathExists = true) => ({ ...timberRepository.worktrees[1]!, id, path, pathExists });
	const repositories: Repository[] = [
		timberRepository,
		{ ...sampleRepositories[1]!, worktrees: [worktree("api", "/work/api-server"), worktree("missing", "/work/api-server-worktrees/missing", false)] },
		{ ...sampleRepositories[1]!, path: "/work/off", available: false, worktrees: [worktree("off", "/work/off")] },
	];

	test("the saved selected worktree first, then the rest in list order, and only what is listed with its folder there", () => {
		expect(restoreJobs(saved, repositories).map(job => [job.repository, job.worktreeId, job.path])).toEqual([
			["/work/api-server", "api", "/work/api-server"],
			[TIMBER, primaryId, TIMBER],
			[TIMBER, featureId, FEATURE],
		]);
		expect(restoreJobs({ worktrees: {} }, repositories)).toEqual([]);
		expect(restoreJobs({ selected: "gone", worktrees: saved.worktrees }, repositories).map(job => job.worktreeId)).toEqual([primaryId, featureId, "api"]);
	});

	test("only saved worktrees known to be gone are forgotten", () => {
		const id = (common: string, path: string) => [common, "verified", path].join("\0");
		const repo = (path: string, worktrees: { id: string; pathExists?: boolean }[], more: Partial<Repository> = {}): Repository =>
			({ ...timberRepository, path, worktrees: worktrees.map(entry => ({ ...timberRepository.worktrees[0]!, id: entry.id, path: entry.id, pathExists: entry.pathExists ?? true })), ...more });
		const store = { shown: 0, sessions: [{ kind: "terminal" as const }] };
		const saved: SavedSessions = { worktrees: { [id("/a/.git", "/a")]: store, [id("/a/.git", "/a-old")]: store, [id("/b/.git", "/b-old")]: store, [id("/c/.git", "/c")]: store } };
		const a = repo("/a", [{ id: id("/a/.git", "/a") }]);
		const b = repo("/b", [{ id: id("/b/.git", "/b") }]);
		// Every repository read and every folder there: an unlisted worktree is gone, and so is one of a repository no longer listed.
		expect(goneSavedWorktrees(saved, [a, b]).sort()).toEqual([id("/a/.git", "/a-old"), id("/b/.git", "/b-old"), id("/c/.git", "/c")].sort());
		// A repository that cannot be read may hold any of the others.
		expect(goneSavedWorktrees(saved, [a, repo("/b", [], { available: false })])).toEqual([id("/a/.git", "/a-old")]);
		expect(goneSavedWorktrees(saved, [a, repo("/b", [], { failure: "Timber failed" })])).toEqual([id("/a/.git", "/a-old")]);
		// A missing folder changes its worktree's id, so nothing of that repository is forgotten.
		expect(goneSavedWorktrees(saved, [a, repo("/b", [{ id: ["/b/.git", "registered", "/b"].join("\0"), pathExists: false }])])).toEqual([id("/a/.git", "/a-old")]);
	});

	test("the request for a terminal names where it opens and which saved session it is; an agent's names the agent, its conversation, and its name", () => {
		const job = { repository: TIMBER, worktreeId: featureId, path: FEATURE, shown: 0, sessions: [] };
		expect(restoreRequest(job, { kind: "terminal" }, 0)).toEqual({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24, restore: { worktree: featureId, index: 0 } });
		expect(restoreRequest(job, { kind: "terminal", name: "dev" }, 1)).toEqual({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24, restore: { worktree: featureId, index: 1 }, name: "dev" });
		expect(restoreRequest(job, { kind: "agent", agent: "Codex", conversation: "01a17995-a303-7160-8d6d-d7587e0d5d50", name: "review" }, 2))
			.toEqual({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24, restore: { worktree: featureId, index: 2 }, agent: "Codex", resume: "01a17995-a303-7160-8d6d-d7587e0d5d50", name: "review" });
		expect(restoreRequest(job, { kind: "agent", agent: "Aider" }, 3)).toEqual({ repository: TIMBER, worktree: FEATURE, cols: 80, rows: 24, restore: { worktree: featureId, index: 3 }, agent: "Aider" });
	});

	test("at most a few run at once, all run, in order, and one that fails does not stop the rest", async () => {
		let running = 0;
		let most = 0;
		const started: number[] = [];
		const tasks = Array.from({ length: 10 }, (_, at) => async () => {
			started.push(at);
			running += 1;
			most = Math.max(most, running);
			await Bun.sleep(1);
			running -= 1;
			if (at === 2) throw new Error("broken");
		});
		await runLimited(tasks, 3);
		expect(most).toBe(3);
		expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		await runLimited([], 3);
		expect(RESTORE_CONCURRENCY).toBe(3);
	});
});

describe("sessions after a restart", () => {
	test("every worktree has its sessions running again, in order, with the same chip showing and the same worktree selected", async () => {
		const storage = memorySessionStorage();
		const first = await firstRun(storage);
		// Something else is selected in between: the last report of each worktree counts.
		first.store.select(primaryId);
		first.store.select(featureId);
		await quit(first.engine, first.store);
		const ids = [first.terminal.id, first.claude.id, first.codex.id];

		const { store } = run(storage);
		await until(() => sessionsOf(store.getState(), featureId).length === 3 && sessionsOf(store.getState(), primaryId).length === 1);
		await settle();
		expect(kinds(store, featureId)).toEqual([["terminal", "Terminal", "running"], ["agent", "Claude Code", "running"], ["agent", "Codex", "running"]]);
		expect(shownSession(store.getState(), featureId)!.name).toBe("Claude Code");
		expect(store.getState().selection!.worktree).toBe(featureId);
		expect(kinds(store, primaryId)).toEqual([["terminal", "Terminal", "running"]]);
		expect(sessionsOf(store.getState(), featureId).some(session => ids.includes(session.id))).toBe(false);
		expect(store.getState().toasts).toEqual([]);
	});

	test("each agent is back in its own conversation", async () => {
		const storage = memorySessionStorage();
		const first = await firstRun(storage);
		const claudeConversation = first.engine.conversationOf(first.claude.id)!;
		const codexConversation = first.engine.conversationOf(first.codex.id)!;
		expect(claudeConversation).not.toBe(codexConversation);
		await quit(first.engine, first.store);

		const { engine, store } = run(storage);
		await until(() => sessionsOf(store.getState(), featureId).length === 3);
		const [, claude, codex] = sessionsOf(store.getState(), featureId);
		expect(engine.conversationOf(claude!.id)).toBe(claudeConversation);
		expect(engine.conversationOf(codex!.id)).toBe(codexConversation);
		expect(claude!.command.endsWith(`--resume ${claudeConversation}`)).toBe(true);
		expect(codex!.command.endsWith(`resume ${codexConversation}`)).toBe(true);
	});

	test("a conversation that is gone starts the agent fresh and says so", async () => {
		const storage = memorySessionStorage();
		const first = await firstRun(storage);
		const gone = first.engine.conversationOf(first.claude.id)!;
		await quit(first.engine, first.store);

		const { engine, store } = run(storage, sampleRepositories, {}, next => next.missingConversations([gone]));
		await until(() => sessionsOf(store.getState(), featureId).length === 3);
		const claude = sessionsOf(store.getState(), featureId)[1]!;
		expect(claude.state.kind).toBe("running");
		expect(claude.command).toContain("--session-id");
		expect(claude.command).not.toContain(gone);
		expect((await engine.readTerminal(claude.id))!.data).toContain("The saved conversation was not found, so Claude Code started fresh.");
		const codex = sessionsOf(store.getState(), featureId)[2]!;
		expect((await engine.readTerminal(codex.id))!.data).not.toContain("not found");
	});

	test("a renamed chip keeps its name, a default name is made again", async () => {
		const storage = memorySessionStorage();
		const first = await firstRun(storage);
		await first.store.savePreferences({ sessionNames: "branch" });
		await open(first.store, FEATURE, "Codex");
		await first.store.renameTerminal(first.terminal.id, "dev server");
		await settle();
		const names = sessionsOf(first.store.getState(), featureId).map(session => session.name);
		expect(names).toEqual(["dev server", "Claude Code", "Codex", "Codex: feat/github-issue-lookup"]);
		await quit(first.engine, first.store);

		const { store } = run(storage, sampleRepositories, {}, next => void next.savePreferences({ sessionNames: "branch" }));
		await until(() => sessionsOf(store.getState(), featureId).length === 4);
		// The default names are made again by the naming Settings choose now.
		expect(sessionsOf(store.getState(), featureId).map(session => session.name)).toEqual(["dev server", "Claude Code: feat/github-issue-lookup", "Codex: feat/github-issue-lookup", "Codex: feat/github-issue-lookup 2"]);
	});

	test("a closed session does not come back", async () => {
		const storage = memorySessionStorage();
		const first = await firstRun(storage);
		await first.store.closeTerminal(first.codex.id);
		await settle();
		await quit(first.engine, first.store);
		const { store } = run(storage);
		await until(() => sessionsOf(store.getState(), primaryId).length === 1);
		await settle(20);
		expect(kinds(store, featureId)).toEqual([["terminal", "Terminal", "running"], ["agent", "Claude Code", "running"]]);
	});

	test("a session that had ended does not come back", async () => {
		const storage = memorySessionStorage();
		const first = await firstRun(storage);
		first.engine.endTerminal(first.terminal.id, 0);
		await settle();
		await quit(first.engine, first.store);
		const { store } = run(storage);
		await until(() => sessionsOf(store.getState(), featureId).length === 2);
		await settle(20);
		expect(kinds(store, featureId)).toEqual([["agent", "Claude Code", "running"], ["agent", "Codex", "running"]]);
		// The shown chip was the second of three; it is the first of the two now.
		expect(shownSession(store.getState(), featureId)!.name).toBe("Claude Code");
	});

	test("a Timber setup session does not come back", async () => {
		const storage = memorySessionStorage();
		const first = run(storage);
		await settle();
		first.engine.endWorktreeSetups(null);
		const started = await first.engine.openTerminal({ repository: TIMBER, worktree: FEATURE, timberWorktreeSetup: {}, cols: 80, rows: 24 });
		expect(started.outcome).toBe("opened");
		await open(first.store, FEATURE);
		await settle();
		await quit(first.engine, first.store);
		const { store } = run(storage);
		await until(() => sessionsOf(store.getState(), featureId).length === 1);
		await settle(20);
		expect(kinds(store, featureId)).toEqual([["terminal", "Terminal", "running"]]);
	});

	test("a worktree that no longer exists is skipped, and the rest still open", async () => {
		const storage = memorySessionStorage();
		const first = await firstRun(storage);
		await quit(first.engine, first.store);
		const withoutFeature: Repository[] = [{ ...timberRepository, worktrees: timberRepository.worktrees.filter(worktree => worktree.path !== FEATURE) }, sampleRepositories[1]!];
		const second = run(storage, withoutFeature);
		await until(() => sessionsOf(second.store.getState(), primaryId).length === 1);
		await settle(20);
		expect(second.store.getState().terminals.some(session => session.path === FEATURE)).toBe(false);
		expect(second.store.getState().toasts).toEqual([]);
		await quit(second.engine, second.store);
		// The save holds only what ran.
		const read = parseSavedSessions(storage.read()!);
		expect(read.ok && Object.keys(read.saved.worktrees)).toEqual([primaryId]);
	});

	test("a repository removed from the list is skipped", async () => {
		const storage = memorySessionStorage();
		const first = await firstRun(storage);
		await quit(first.engine, first.store);
		const { store } = run(storage, [sampleRepositories[1]!]);
		await until(() => store.getState().loaded);
		await settle(20);
		expect(store.getState().terminals).toEqual([]);
		expect(store.getState().toasts).toEqual([]);
	});

	test("an agent that Settings no longer has is skipped with one toast, and the others open", async () => {
		const storage = memorySessionStorage();
		const first = await firstRun(storage);
		await quit(first.engine, first.store);
		const text = storage.read()!.replace("\"agent\":\"Claude Code\"", "\"agent\":\"Gone\"");
		storage.write(text);
		const { store } = run(storage);
		await until(() => store.getState().toasts.length > 0);
		await settle(20);
		expect(store.getState().toasts.map(toast => toast.text)).toEqual(["Could not open a session from the last time again"]);
		expect(kinds(store, featureId)).toEqual([["terminal", "Terminal", "running"], ["agent", "Codex", "running"]]);
		// The saved chip did not open: the nearest one before it shows.
		expect(shownSession(store.getState(), featureId)!.name).toBe("Terminal");
		// The selected worktree says why.
		expect(store.getState().terminalProblem).toMatchObject({ worktree: featureId, agent: "Gone" });
		expect(store.getState().terminalProblem!.message).toContain("No agent called \"Gone\"");
	});

	test("a repository that is unavailable keeps its saved sessions for a later launch", async () => {
		const storage = memorySessionStorage();
		const first = await firstRun(storage);
		await quit(first.engine, first.store);
		const away: Repository[] = [{ ...timberRepository, available: false, worktrees: [] }, sampleRepositories[1]!];
		const second = run(storage, away);
		await until(() => second.store.getState().loaded);
		await settle(20);
		expect(second.store.getState().terminals).toEqual([]);
		await quit(second.engine, second.store);
		const third = run(storage);
		await until(() => sessionsOf(third.store.getState(), featureId).length === 3 && sessionsOf(third.store.getState(), primaryId).length === 1);
	});

	test("a repository removed from the list keeps its sessions while another worktree's folder is missing, and drops them once every one is read", async () => {
		const storage = memorySessionStorage();
		const first = await firstRun(storage);
		await quit(first.engine, first.store);
		// The api-server sample has a worktree whose folder is missing, so the timber worktrees may still be among its ids.
		const unsure = run(storage, [sampleRepositories[1]!]);
		await until(() => unsure.store.getState().loaded);
		await settle(20);
		await quit(unsure.engine, unsure.store);
		const kept = parseSavedSessions(storage.read()!);
		expect(kept.ok && Object.keys(kept.saved.worktrees).sort()).toEqual([featureId, primaryId].sort());
		const allThere: Repository[] = [{ ...sampleRepositories[1]!, worktrees: sampleRepositories[1]!.worktrees.filter(worktree => worktree.pathExists) }];
		const sure = run(storage, allThere);
		await until(() => sure.store.getState().loaded);
		await settle(20);
		await quit(sure.engine, sure.store);
		const dropped = parseSavedSessions(storage.read()!);
		expect(dropped.ok && dropped.saved.worktrees).toEqual({});
	});

	test("quitting while sessions still open keeps the ones not opened yet, in their order", async () => {
		const storage = memorySessionStorage();
		const first = await firstRun(storage);
		await quit(first.engine, first.store);
		const before = parseSavedSessions(storage.read()!);
		const second = run(storage, sampleRepositories, { terminalMilliseconds: 50 });
		await until(() => second.store.getState().terminals.length >= 1, 2000);
		expect(second.store.getState().terminals.length).toBeLessThan(4);
		await quit(second.engine, second.store);
		const after = parseSavedSessions(storage.read()!);
		expect(after.ok && after.saved).toEqual(before.ok && before.saved);
	});

	test("a worktree not visited after a restart keeps its shown chip over the next restart", async () => {
		const storage = memorySessionStorage();
		storage.write(serializeSavedSessions({
			selected: primaryId,
			worktrees: {
				[primaryId]: { shown: 0, sessions: [{ kind: "terminal" }] },
				[featureId]: { shown: 2, sessions: [{ kind: "terminal", name: "one" }, { kind: "terminal", name: "two" }, { kind: "terminal", name: "three" }] },
			},
		}));
		const second = run(storage);
		await until(() => sessionsOf(second.store.getState(), featureId).length === 3);
		await settle(20);
		expect(second.store.getState().selection!.worktree).toBe(primaryId);
		await quit(second.engine, second.store);
		const read = parseSavedSessions(storage.read()!);
		expect(read.ok && read.saved.worktrees[featureId]!.shown).toBe(2);
		const third = run(storage);
		await until(() => sessionsOf(third.store.getState(), featureId).length === 3);
		await settle(20);
		expect(shownSession(third.store.getState(), featureId)!.name).toBe("three");
	});

	test("the sessions are opened once per run", async () => {
		const storage = memorySessionStorage();
		const first = await firstRun(storage);
		await quit(first.engine, first.store);
		const { engine, store } = run(storage);
		await until(() => sessionsOf(store.getState(), featureId).length === 3);
		// The window reloads: a new store on the same engine.
		const again = createAppStore(engine, () => () => {});
		again.start();
		await until(() => again.getState().loaded);
		await settle(20);
		expect(sessionsOf(again.getState(), featureId)).toHaveLength(3);
		expect((await engine.listTerminals()).length).toBe(4);
		expect(await engine.takeSavedSessions()).toBeNull();
	});

	test("nothing is saved while the app runs", async () => {
		const storage = memorySessionStorage();
		const first = await firstRun(storage);
		await first.store.renameTerminal(first.terminal.id, "dev");
		await first.store.closeTerminal(first.codex.id);
		await settle();
		expect(storage.read()).toBeNull();
		await quit(first.engine, first.store);
		expect(storage.read()).not.toBeNull();
	});

	test("quitting with nothing open saves that", async () => {
		const storage = memorySessionStorage();
		const first = run(storage);
		await settle();
		await open(first.store, FEATURE);
		await first.store.closeTerminal(sessionsOf(first.store.getState(), featureId)[0]!.id);
		await settle();
		expect(first.engine.requestQuit()).toBe(true);
		expect(parseSavedSessions(storage.read()!)).toEqual({ ok: true, saved: { selected: primaryId, worktrees: {} } });
		const { engine, store } = run(storage);
		await until(() => store.getState().loaded);
		await settle(20);
		expect(store.getState().terminals).toEqual([]);
		expect(await engine.takeSavedSessions()).toBeNull();
	});

	test("a crash keeps the older save", async () => {
		const storage = memorySessionStorage();
		const first = run(storage);
		await settle();
		await open(first.store, FEATURE);
		await quit(first.engine, first.store);
		const second = run(storage);
		await until(() => sessionsOf(second.store.getState(), featureId).length === 1);
		await open(second.store, FEATURE);
		await open(second.store, FEATURE);
		await settle();
		expect(sessionsOf(second.store.getState(), featureId)).toHaveLength(3);
		// Dropped without quitting.
		const third = run(storage);
		await until(() => sessionsOf(third.store.getState(), featureId).length === 1);
		await settle(20);
		expect(sessionsOf(third.store.getState(), featureId)).toHaveLength(1);
	});

	test("a damaged or newer save opens nothing and does not throw", async () => {
		for (const text of ["{oops", "{\"version\":2,\"worktrees\":{}}"]) {
			const storage = memorySessionStorage();
			storage.write(text);
			const { store } = run(storage);
			await until(() => store.getState().loaded);
			await settle(20);
			expect(store.getState().terminals).toEqual([]);
			expect(store.getState().toasts).toEqual([]);
		}
	});

	test("the person's own choice of chip during the restore wins", async () => {
		const storage = memorySessionStorage();
		const first = await firstRun(storage);
		await quit(first.engine, first.store);
		const { store } = run(storage, sampleRepositories, { terminalMilliseconds: 20 });
		await until(() => sessionsOf(store.getState(), featureId).length >= 1);
		const chosen = sessionsOf(store.getState(), featureId)[0]!;
		store.showSession(chosen.id);
		await until(() => sessionsOf(store.getState(), featureId).length === 3);
		await Bun.sleep(30);
		expect(shownSession(store.getState(), featureId)!.id).toBe(chosen.id);
	});

	test("restored sessions do not light the new-output dot", async () => {
		const storage = memorySessionStorage();
		const first = await firstRun(storage);
		await quit(first.engine, first.store);
		const { engine, store } = run(storage);
		await until(() => sessionsOf(store.getState(), featureId).length === 3 && sessionsOf(store.getState(), primaryId).length === 1);
		await settle(20);
		for (const session of store.getState().terminals) expect((await engine.readTerminal(session.id))!.data).toContain("A pretend");
		expect(store.getState().unseenSessions).toEqual([]);
		// A session opened as usual, in a worktree not on screen, is marked when it prints.
		expect(store.getState().selection!.worktree).toBe(featureId);
		await open(store, TIMBER);
		const fresh = sessionsOf(store.getState(), primaryId)[1]!;
		engine.writeTerminal(fresh.id, "x");
		await settle();
		expect(store.getState().unseenSessions).toEqual([fresh.id]);
	});

	test("twenty saved sessions open without blocking, three worktrees at a time", async () => {
		const usable = [
			...timberRepository.worktrees,
			...sampleRepositories[1]!.worktrees.filter(worktree => worktree.pathExists),
		].slice(0, 5);
		expect(usable).toHaveLength(5);
		const storage = memorySessionStorage();
		storage.write(serializeSavedSessions({
			selected: usable[4]!.id,
			worktrees: Object.fromEntries(usable.map(worktree => [worktree.id, {
				shown: 2,
				sessions: [{ kind: "terminal" }, { kind: "agent", agent: "Claude Code", conversation: crypto.randomUUID() }, { kind: "agent", agent: "Codex" }, { kind: "terminal", name: "dev" }],
			}])),
		}));
		const engine = createMockEngine(sampleRepositories, undefined, { savedSessions: storage, terminalMilliseconds: 30 });
		const store = createAppStore(engine, () => () => {});
		let gap = 0;
		let last = performance.now();
		const ticker = setInterval(() => {
			const now = performance.now();
			gap = Math.max(gap, now - last);
			last = now;
		}, 5);
		const began = performance.now();
		store.start();
		const startTook = performance.now() - began;
		try {
			await until(() => store.getState().terminals.length >= 1, 2000);
			// The window stays usable: a selection takes effect at once.
			store.select(usable[0]!.id);
			expect(store.getState().selection!.worktree).toBe(usable[0]!.id);
			await until(() => store.getState().terminals.length === 20 && store.getState().terminals.every(session => session.state.kind === "running"), 3000);
			const took = performance.now() - began;
			console.log(`restore of 20 sessions in 5 worktrees: start() ${startTook.toFixed(1)} ms, all running after ${took.toFixed(0)} ms, longest event loop gap ${gap.toFixed(1)} ms, at most ${engine.mostOpeningAtOnce()} opening at once`);
			expect(startTook).toBeLessThan(50);
			expect(gap).toBeLessThan(100);
			expect(engine.mostOpeningAtOnce()).toBe(3);
			expect(took).toBeLessThan(2000);
			// The saved selected worktree went first; every worktree shows its saved chip.
			for (const worktree of usable) expect(shownSession(store.getState(), worktree.id)!.kind).toBe("agent");
		} finally {
			clearInterval(ticker);
		}
	});

	test("what the window tells the engine names the selected worktree's id and its shown chip", async () => {
		const storage = memorySessionStorage();
		const { engine, store } = run(storage);
		const told: Attention[] = [];
		const attend = engine.attend.bind(engine);
		engine.attend = attention => {
			told.push(attention);
			attend(attention);
		};
		await settle();
		store.select(featureId);
		await open(store, FEATURE);
		await open(store, FEATURE);
		const [one] = sessionsOf(store.getState(), featureId);
		store.showSession(one!.id);
		await settle();
		expect(told.at(-1)).toMatchObject({ selected: { repository: TIMBER, worktree: FEATURE, id: featureId }, session: one!.id });
	});
});
