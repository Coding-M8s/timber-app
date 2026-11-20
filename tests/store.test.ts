import { describe, expect, test } from "bun:test";
import { createMockThemeFiles } from "../src/mainview/engine/mock-theme-files";
import { createMockTerminals } from "../src/mainview/engine/mock-terminals";
import { createMockTimberConfig } from "../src/mainview/engine/mock-timber-config";
import { createMockWorkflows } from "../src/mainview/engine/mock-workflows";
import { createMockIssues } from "../src/mainview/engine/mock-issues";
import { createMockBackups } from "../src/mainview/engine/mock-backups";
import { createMockPullRequests } from "../src/mainview/engine/mock-pull-requests";
import type { Engine } from "../src/shared/engine";
import { defaultLayout } from "../src/shared/layout";
import { defaultPreferences } from "../src/shared/preferences";
import type { AddRepositoryResult, RemoveRepositoryResult, ReorderRepositoriesResult, Repository, TimberStatus, WorktreeCommandResult } from "../src/shared/model";
import type { DoneApplyRequest, DoneApplyResult, DonePreviewRequest, DonePreviewResult } from "../src/shared/timber-done";
import { createMockEngine, sampleChanges, samplePickableRepository, sampleRepositories, sampleTimberStatuses, sampleUnavailableRepository } from "../src/mainview/engine/mock";
import { isRunning, selectedWorktree } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const API_SERVER = "/work/api-server";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";

/** The identity of the sample worktree at `path`, which is what the store selects by. */
function idOf(path: string): string {
	for (const repository of [...sampleRepositories, samplePickableRepository]) {
		const worktree = repository.worktrees.find(candidate => candidate.path === path);
		if (worktree) return worktree.id;
	}
	throw new Error(`No sample worktree at ${path}`);
}
const TIMBER_ID = idOf(TIMBER);
const FEATURE_ID = idOf(FEATURE);

const counts = (worktree: Repository["worktrees"][number] | undefined) =>
	worktree?.changes.kind === "known" ? { modified: worktree.changes.modified.length, untracked: worktree.changes.untracked.length } : undefined;

/** A copy of the sample data in which the worktree at `path` has this many modified files. */
function withModified(path: string, modified: number): Repository[] {
	const copy = structuredClone(sampleRepositories);
	for (const repository of copy) {
		for (const worktree of repository.worktrees) {
			if (worktree.path === path) worktree.changes = sampleChanges(modified, counts(worktree)?.untracked ?? 0);
		}
	}
	return copy;
}

function repositoryIn(repositories: Repository[], path: string): Repository {
	return repositories.find(repository => repository.path === path)!;
}

function modifiedCount(store: { getState(): { repositories: readonly Repository[] } }, path: string): number | undefined {
	for (const repository of store.getState().repositories) {
		const worktree = repository.worktrees.find(candidate => candidate.path === path);
		if (worktree) return counts(worktree)?.modified;
	}
	return undefined;
}

interface Pending<Value> {
	path: string | null;
	resolve: (value: Value) => void;
	reject: (error: Error) => void;
}

/** An engine whose reads answer only when the test says so, in whatever order it likes. */
function manualEngine(timber: TimberStatus = sampleTimberStatuses.ready) {
	const lists: Pending<Repository[]>[] = [];
	const loads: Pending<Repository | null>[] = [];
	const adds: Pending<AddRepositoryResult>[] = [];
	const removes: Pending<RemoveRepositoryResult>[] = [];
	const reorders: (Pending<ReorderRepositoriesResult> & { order: string[] })[] = [];
	const commands: (Pending<WorktreeCommandResult> & { kind: "new" | "open"; request: object })[] = [];
	const previews: (Pending<DonePreviewResult> & { request: DonePreviewRequest })[] = [];
	const applies: (Pending<DoneApplyResult> & { request: DoneApplyRequest })[] = [];
	const listeners = new Set<(path: string) => void>();
	const engine: Engine = {
		// Theme files as the mock acts them out. Their own tests are in theme-files.test.ts.
		...createMockThemeFiles(),
		// Terminals as the mock acts them out. Their own tests are in terminal-store.test.ts.
		...createMockTerminals(() => null),
		onShowSession: () => () => {},
		chooseSoundFile: async () => ({ outcome: "cancelled" }),
		playSound: async () => ({ outcome: "played" }),
		// Timber's settings as the mock acts them out. Their own tests are in timber-settings.test.tsx.
		...createMockTimberConfig(() => false),
		// Workflows as the mock acts them out. Their own tests are in workflows.test.ts.
		...createMockWorkflows(() => false, () => timber),
		// Pull requests as the mock acts them out. Their own tests are in pull-requests.test.ts.
		...createMockPullRequests(() => undefined, () => timber),
		...createMockIssues(() => undefined, () => timber),
		// Backups as the mock acts them out. Their own tests are in backups.test.ts.
		...createMockBackups({ listed: () => undefined, timber: () => timber, addWorktree: () => {}, delay: () => 0 }),
		appInfo: async () => ({ version: "1.2.3", rendering: { applies: false } }),
		uninstallPlan: async () => ({ available: false, reason: "Not installed." }),
		uninstall: async () => ({ outcome: "unavailable", message: "Not installed." }),
		restartPlan: async () => ({ available: false, reason: "Runs from source." }),
		restart: async () => ({ outcome: "unavailable", message: "Runs from source." }),
		timberStatus: async () => timber,
		recheckTimber: async () => timber,
		onTimberChanged: () => () => {},
		listRepositories: () => new Promise((resolve, reject) => {
			lists.push({ path: null, resolve, reject });
		}),
		loadRepository: path => new Promise((resolve, reject) => {
			loads.push({ path, resolve, reject });
		}),
		addRepository: () => new Promise((resolve, reject) => {
			adds.push({ path: null, resolve, reject });
		}),
		removeRepository: path => new Promise((resolve, reject) => {
			removes.push({ path, resolve, reject });
		}),
		reorderRepositories: order => new Promise((resolve, reject) => {
			reorders.push({ path: null, order, resolve, reject });
		}),
		listBranches: async () => null,
		newWorktree: request => new Promise((resolve, reject) => {
			commands.push({ kind: "new", request, path: request.repository, resolve, reject });
		}),
		openWorktree: request => new Promise((resolve, reject) => {
			commands.push({ kind: "open", request, path: request.repository, resolve, reject });
		}),
		// Rebasing through a result file has its own tests in rebase-result.test.tsx.
		rebaseWorktree: async () => ({ outcome: "failed", ran: false, failure: { command: null, diagnostic: "Not acted out here.", output: null } }),
		createPullRequest: async () => ({ outcome: "failed", ran: false, published: false, failure: { command: null, diagnostic: "Not acted out here.", output: null } }),
		readHeadSubject: async () => null,
		previewDone: request => new Promise((resolve, reject) => {
			previews.push({ path: request.path, request, resolve, reject });
		}),
		applyDone: request => new Promise((resolve, reject) => {
			applies.push({ path: request.path, request, resolve, reject });
		}),
		attend: () => {},
		windowReady: () => {},
		// Fetching has its own tests in fetch-store.test.ts.
		fetchStatuses: async () => [],
		fetchNow: async repository => ({ outcome: "not-listed", message: `${repository} is not listed.` }),
		onFetchChanged: () => () => {},
		forcePushSeen: () => {},
		onRepositoryChanged(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		loadLayout: async () => defaultLayout(),
		saveLayout: async () => ({ outcome: "saved" }),
		loadPreferences: async () => defaultPreferences(),
		savePreferences: async change => ({ outcome: "saved", preferences: { ...defaultPreferences(), ...change } }),
		openInEditor: async () => ({ outcome: "not-configured" }),
		// The Changes tab has its own tests in file-changes-store.test.ts.
		readFileChanges: async () => ({ outcome: "read", files: [], more: false }),
		readFileDiff: async () => ({ outcome: "read", file: null, diff: { kind: "unchanged" } }),
		listChops: async () => ({ outcome: "listed", file: { state: "missing" }, path: "/work/app/.timber/chops.json", chops: [], overridden: [] }),
		readPorts: async () => ({ outcome: "read", docker: { state: "read", ports: [] }, sessions: { state: "read", ports: [] }, clashes: [] }),
	};
	const push = (path: string) => {
		for (const listener of [...listeners]) listener(path);
	};
	return { engine, lists, loads, adds, removes, reorders, commands, previews, applies, push, listeners };
}

/** A store on a manual engine, started and past its first load of the sample data. */
async function loadedStore() {
	const manual = manualEngine();
	const store = createAppStore(manual.engine);
	store.start();
	await settle();
	manual.lists.shift()!.resolve(structuredClone(sampleRepositories));
	await settle();
	return { store, ...manual };
}

describe("starting", () => {
	test("finds Timber, then loads the repositories and selects the first worktree", async () => {
		const store = createAppStore(createMockEngine());
		expect(store.getState().timber).toBeNull();
		expect(store.getState().loaded).toBe(false);
		store.start();
		expect(isRunning(store.getState(), "find-timber")).toBe(true);
		await settle();
		const state = store.getState();
		expect(state.timber).toEqual({ known: true, status: sampleTimberStatuses.ready });
		expect(state.loaded).toBe(true);
		expect(state.repositories.map(repository => repository.name)).toEqual(["timber", "api-server"]);
		expect(state.selection).toEqual({ repository: TIMBER, worktree: TIMBER_ID });
		expect(state.operations).toEqual([]);
		expect(state.error).toBeNull();
	});

	test("does not read repositories until Timber is ready, and reads them after a retry finds it", async () => {
		let installed = false;
		const engine = createMockEngine(sampleRepositories, () => installed ? sampleTimberStatuses.ready : sampleTimberStatuses["not-found"]);
		const store = createAppStore(engine);
		store.start();
		await settle();
		expect(store.getState().timber).toEqual({ known: true, status: sampleTimberStatuses["not-found"] });
		expect(store.getState().loaded).toBe(false);

		installed = true;
		await store.retryTimber();
		await settle();
		expect(store.getState().loaded).toBe(true);
		expect(store.getState().repositories.length).toBe(2);
	});

	test("records why looking for Timber failed", async () => {
		const engine = createMockEngine();
		engine.timberStatus = async () => {
			throw new Error("bridge closed");
		};
		const store = createAppStore(engine);
		store.start();
		await settle();
		expect(store.getState().timber).toEqual({ known: false, message: "bridge closed" });
		expect(store.getState().loaded).toBe(false);
	});

	test("tells subscribers about changes until they stop listening", async () => {
		const store = createAppStore(createMockEngine());
		let calls = 0;
		const stop = store.subscribe(() => calls++);
		store.start();
		await settle();
		expect(calls).toBeGreaterThan(0);
		stop();
		const before = calls;
		await store.refresh();
		expect(calls).toBe(before);
	});
});

describe("a pushed change", () => {
	test("reloads only the repository it names", async () => {
		const { store, lists, loads, push } = await loadedStore();
		const untouched = store.getState().repositories.find(repository => repository.path === API_SERVER);

		push(TIMBER);
		expect(loads.map(load => load.path)).toEqual([TIMBER]);
		expect(store.getState().operations).toEqual([{ kind: "reload-repository", repository: TIMBER }]);

		loads[0]!.resolve(repositoryIn(withModified(FEATURE, 9), TIMBER));
		await settle();
		expect(modifiedCount(store, FEATURE)).toBe(9);
		// No full reload happened, and the other repository is the very same data as before.
		expect(lists.length).toBe(0);
		expect(store.getState().repositories.find(repository => repository.path === API_SERVER)).toBe(untouched);
		expect(store.getState().operations).toEqual([]);
	});

	test("is ignored for a repository that is not on screen", async () => {
		const { lists, loads, push } = await loadedStore();
		push("/work/unknown");
		await settle();
		expect(loads.length).toBe(0);
		expect(lists.length).toBe(0);
	});

	test("is no longer heard after the store is stopped", async () => {
		const manual = manualEngine();
		const stop = createAppStore(manual.engine).start();
		expect(manual.listeners.size).toBe(1);
		stop();
		expect(manual.listeners.size).toBe(0);
	});
});

describe("overlapping reloads", () => {
	test("of the same repository are merged into one follow-up", async () => {
		const { store, loads, push } = await loadedStore();
		push(TIMBER);
		push(TIMBER);
		push(TIMBER);
		void store.reloadRepository(TIMBER);
		expect(loads.length).toBe(1);

		loads[0]!.resolve(repositoryIn(withModified(FEATURE, 4), TIMBER));
		await settle();
		// One more read, because the first may have started before the later changes.
		expect(loads.length).toBe(2);
		expect(modifiedCount(store, FEATURE)).toBe(4);
		expect(isRunning(store.getState(), "reload-repository")).toBe(true);

		loads[1]!.resolve(repositoryIn(withModified(FEATURE, 5), TIMBER));
		await settle();
		expect(loads.length).toBe(2);
		expect(modifiedCount(store, FEATURE)).toBe(5);
		expect(store.getState().operations).toEqual([]);
	});

	test("of different repositories run side by side", async () => {
		const { loads, push } = await loadedStore();
		push(TIMBER);
		push(API_SERVER);
		expect(loads.map(load => load.path)).toEqual([TIMBER, API_SERVER]);
	});

	test("of everything are merged too", async () => {
		const { store, lists } = await loadedStore();
		void store.refresh();
		void store.refresh();
		const last = store.refresh();
		expect(lists.length).toBe(1);
		lists[0]!.resolve(withModified(FEATURE, 1));
		await settle();
		expect(lists.length).toBe(2);
		lists[1]!.resolve(withModified(FEATURE, 2));
		await last;
		expect(lists.length).toBe(2);
		expect(modifiedCount(store, FEATURE)).toBe(2);
	});
});

describe("stale responses", () => {
	test("a full list that answers late does not overwrite a newer reload of one repository", async () => {
		const { store, lists, loads, push } = await loadedStore();
		void store.refresh();
		push(TIMBER);
		// The single reload was asked for later and answers first.
		loads[0]!.resolve(repositoryIn(withModified(FEATURE, 7), TIMBER));
		await settle();
		expect(modifiedCount(store, FEATURE)).toBe(7);

		const olderList = withModified(FEATURE, 1);
		repositoryIn(olderList, API_SERVER).worktrees[0]!.changes = sampleChanges(0, 6);
		lists[0]!.resolve(olderList);
		await settle();
		// The reloaded repository keeps its newer data. The rest of the list is still applied.
		expect(modifiedCount(store, FEATURE)).toBe(7);
		expect(counts(repositoryIn([...store.getState().repositories], API_SERVER).worktrees[0])?.untracked).toBe(6);
		expect(store.getState().error).toBeNull();
	});

	test("a reload of one repository that answers after a newer full list is dropped", async () => {
		const { store, lists, loads, push } = await loadedStore();
		push(TIMBER);
		void store.refresh();
		lists[0]!.resolve(withModified(FEATURE, 8));
		await settle();
		expect(modifiedCount(store, FEATURE)).toBe(8);

		loads[0]!.resolve(repositoryIn(withModified(FEATURE, 1), TIMBER));
		await settle();
		expect(modifiedCount(store, FEATURE)).toBe(8);
	});

	test("a late failure of an older reload is dropped as well", async () => {
		const { store, lists, loads, push } = await loadedStore();
		push(TIMBER);
		void store.refresh();
		lists[0]!.resolve(withModified(FEATURE, 8));
		await settle();
		loads[0]!.reject(new Error("too late to matter"));
		await settle();
		expect(store.getState().error).toBeNull();
		expect(modifiedCount(store, FEATURE)).toBe(8);
	});

	test("a reload that answers for a repository no longer in the list is dropped", async () => {
		const { store, lists, loads, push } = await loadedStore();
		void store.refresh();
		push(API_SERVER);
		lists[0]!.resolve(structuredClone(sampleRepositories).filter(repository => repository.path !== API_SERVER));
		await settle();
		loads[0]!.resolve(repositoryIn(structuredClone(sampleRepositories), API_SERVER));
		await settle();
		expect(store.getState().repositories.map(repository => repository.path)).toEqual([TIMBER]);
	});
});

describe("selection", () => {
	test("stays on the selected worktree across a full refresh and a single reload", async () => {
		const { store, lists, loads, push } = await loadedStore();
		store.select(FEATURE_ID);
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: FEATURE_ID });

		void store.refresh();
		lists[0]!.resolve(withModified(FEATURE, 2));
		await settle();
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: FEATURE_ID });
		// The selection points at the refreshed data, not a copy from before.
		expect(counts(selectedWorktree(store.getState())?.worktree)?.modified).toBe(2);

		push(TIMBER);
		loads[0]!.resolve(repositoryIn(withModified(FEATURE, 3), TIMBER));
		await settle();
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: FEATURE_ID });
		expect(counts(selectedWorktree(store.getState())?.worktree)?.modified).toBe(3);
	});

	test("moves to the primary checkout when a reload shows the selected worktree is gone", async () => {
		const { store, loads, push } = await loadedStore();
		store.select(FEATURE_ID);
		push(TIMBER);
		const reloaded = repositoryIn(structuredClone(sampleRepositories), TIMBER);
		reloaded.worktrees = reloaded.worktrees.filter(worktree => worktree.path !== FEATURE);
		loads[0]!.resolve(reloaded);
		await settle();
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: TIMBER_ID });
	});

	test("moves to the first worktree when a refresh shows the whole repository is gone", async () => {
		const { store, lists } = await loadedStore();
		store.select(idOf("/work/api-server-worktrees/feat-rate-limit-headers"));
		void store.refresh();
		lists[0]!.resolve(structuredClone(sampleRepositories).filter(repository => repository.path !== API_SERVER));
		await settle();
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: TIMBER_ID });
	});

	test("ignores a path that no repository has", async () => {
		const { store } = await loadedStore();
		store.select("/nowhere");
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: TIMBER_ID });
	});
});

describe("a failed reload", () => {
	test("of everything keeps the last good data and selection, and records the error", async () => {
		const { store, lists } = await loadedStore();
		store.select(FEATURE_ID);
		const before = store.getState().repositories;

		void store.refresh();
		lists[0]!.reject(new Error("Git is busy"));
		await settle();
		const state = store.getState();
		expect(state.error).toEqual({ repository: null, message: "Git is busy" });
		expect(state.repositories).toBe(before);
		expect(state.loaded).toBe(true);
		expect(state.selection).toEqual({ repository: TIMBER, worktree: FEATURE_ID });
		expect(state.operations).toEqual([]);
	});

	test("of one repository names that repository, whether the engine fails or cannot read it", async () => {
		const { store, loads, push } = await loadedStore();
		const before = store.getState().repositories;
		push(TIMBER);
		loads[0]!.reject(new Error("bridge timed out"));
		await settle();
		expect(store.getState().error).toEqual({ repository: TIMBER, message: "bridge timed out" });
		expect(store.getState().repositories).toBe(before);

		push(API_SERVER);
		loads[1]!.resolve(null);
		await settle();
		expect(store.getState().error).toEqual({ repository: API_SERVER, message: `Git could not read ${API_SERVER}` });
		expect(store.getState().repositories).toBe(before);
	});

	test("is cleared by the next reload of the same thing that works", async () => {
		const { store, lists, loads, push } = await loadedStore();
		push(TIMBER);
		loads[0]!.reject(new Error("first try failed"));
		await settle();

		// Another repository reloading fine says nothing about the one that failed.
		push(API_SERVER);
		loads[1]!.resolve(repositoryIn(structuredClone(sampleRepositories), API_SERVER));
		await settle();
		expect(store.getState().error?.repository).toBe(TIMBER);

		push(TIMBER);
		loads[2]!.resolve(repositoryIn(structuredClone(sampleRepositories), TIMBER));
		await settle();
		expect(store.getState().error).toBeNull();

		void store.refresh();
		lists[0]!.reject(new Error("list failed"));
		await settle();
		expect(store.getState().error).toEqual({ repository: null, message: "list failed" });
		void store.refresh();
		lists[1]!.resolve(structuredClone(sampleRepositories));
		await settle();
		expect(store.getState().error).toBeNull();
	});

	test("on the very first load leaves an empty list and the error", async () => {
		const engine = createMockEngine();
		engine.failReads("no repositories could be read");
		const store = createAppStore(engine);
		store.start();
		await settle();
		expect(store.getState().loaded).toBe(false);
		expect(store.getState().repositories).toEqual([]);
		expect(store.getState().error).toEqual({ repository: null, message: "no repositories could be read" });

		engine.failReads(null);
		await store.refresh();
		expect(store.getState().loaded).toBe(true);
		expect(store.getState().error).toBeNull();
	});
});

describe("the mock engine", () => {
	test("acts out a change the way the main process would", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		store.start();
		await settle();
		expect(modifiedCount(store, FEATURE)).toBe(3);

		engine.setRepositories(withModified(FEATURE, 11));
		expect(modifiedCount(store, FEATURE)).toBe(3);
		engine.announceChange(TIMBER);
		await settle();
		expect(modifiedCount(store, FEATURE)).toBe(11);
		expect(await engine.loadRepository("/work/unknown")).toBeNull();
	});
});

describe("adding a repository", () => {
	test("puts it in the list and selects its primary checkout", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		store.start();
		await settle();
		store.select(FEATURE_ID);

		const adding = store.addRepository();
		expect(isRunning(store.getState(), "add-repository")).toBe(true);
		await adding;
		const state = store.getState();
		expect(isRunning(state, "add-repository")).toBe(false);
		expect(state.repositories.map(repository => repository.name)).toEqual(["timber", "api-server", "docs-site"]);
		expect(state.selection).toEqual({ repository: samplePickableRepository.path, worktree: idOf(samplePickableRepository.path) });
		expect(state.notice).toBeNull();
	});

	test("a second time, or through one of its worktrees, adds nothing and says so", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		store.start();
		await settle();
		await store.addRepository();

		store.select(TIMBER_ID);
		await store.addRepository();
		expect(store.getState().repositories.length).toBe(3);
		expect(store.getState().notice).toEqual({ kind: "already-listed", repository: samplePickableRepository.path });
		expect(store.getState().selection?.repository).toBe(samplePickableRepository.path);

		engine.pickFolder(FEATURE);
		await store.addRepository();
		expect(store.getState().repositories.length).toBe(3);
		expect(store.getState().notice).toEqual({ kind: "already-listed", repository: TIMBER });
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: TIMBER_ID });
	});

	test("refuses a folder that is not a Git repository and leaves everything as it was", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		store.start();
		await settle();
		store.select(FEATURE_ID);
		engine.pickFolder("/home/sam/Documents");
		await store.addRepository();
		const state = store.getState();
		expect(state.notice).toEqual({ kind: "not-a-repository", folder: "/home/sam/Documents" });
		expect(state.repositories.length).toBe(2);
		expect(state.selection?.worktree).toBe(FEATURE_ID);
	});

	test("a closed picker changes nothing and keeps an earlier note", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		store.start();
		await settle();
		engine.pickFolder("/nowhere");
		await store.addRepository();
		const before = store.getState();
		engine.pickFolder(null);
		await store.addRepository();
		expect(store.getState().repositories).toBe(before.repositories);
		expect(store.getState().notice).toEqual({ kind: "not-a-repository", folder: "/nowhere" });
	});

	test("only one picker is open at a time", async () => {
		const { store, adds, lists } = await loadedStore();
		const first = store.addRepository();
		const second = store.addRepository();
		await settle();
		expect(adds.length).toBe(1);
		adds.shift()!.resolve({ outcome: "cancelled" });
		await Promise.all([first, second]);
		expect(lists.length).toBe(0);
		expect(isRunning(store.getState(), "add-repository")).toBe(false);
	});

	test("reads the list again after adding, so the screen shows what was saved", async () => {
		const { store, adds, lists } = await loadedStore();
		const adding = store.addRepository();
		await settle();
		adds.shift()!.resolve({ outcome: "added", repository: structuredClone(samplePickableRepository) });
		await settle();
		expect(lists.length).toBe(1);
		lists.shift()!.resolve(structuredClone([...sampleRepositories, samplePickableRepository]));
		await adding;
		expect(store.getState().repositories.map(repository => repository.name)).toEqual(["timber", "api-server", "docs-site"]);
		expect(store.getState().selection?.repository).toBe(samplePickableRepository.path);
	});

	test("records the override, a failed save, and an engine that throws", async () => {
		const { store, adds } = await loadedStore();
		let adding = store.addRepository();
		await settle();
		adds.shift()!.resolve({ outcome: "overridden" });
		await adding;
		expect(store.getState().notice).toEqual({ kind: "overridden" });

		adding = store.addRepository();
		await settle();
		adds.shift()!.resolve({ outcome: "failed", message: "disk full" });
		await adding;
		expect(store.getState().notice).toEqual({ kind: "failed", action: "add", message: "disk full" });

		adding = store.addRepository();
		await settle();
		adds.shift()!.reject(new Error("bridge closed"));
		await adding;
		expect(store.getState().notice).toEqual({ kind: "failed", action: "add", message: "bridge closed" });
		expect(store.getState().repositories.length).toBe(2);

		store.dismissNotice();
		expect(store.getState().notice).toBeNull();
	});
});

describe("removing a repository", () => {
	test("takes it off the list and moves the selection on", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		store.start();
		await settle();
		store.select(FEATURE_ID);

		const removing = store.removeRepository(TIMBER);
		expect(store.getState().operations).toContainEqual({ kind: "remove-repository", repository: TIMBER });
		await removing;
		const state = store.getState();
		expect(state.repositories.map(repository => repository.name)).toEqual(["api-server"]);
		expect(state.selection).toEqual({ repository: API_SERVER, worktree: idOf(API_SERVER) });
		expect(state.operations).toEqual([]);
	});

	test("works for a repository that is unavailable", async () => {
		const engine = createMockEngine([...sampleRepositories, sampleUnavailableRepository]);
		const store = createAppStore(engine);
		store.start();
		await settle();
		expect(store.getState().repositories.map(repository => repository.available)).toEqual([true, true, false]);
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: TIMBER_ID });

		await store.removeRepository(sampleUnavailableRepository.path);
		expect(store.getState().repositories.map(repository => repository.name)).toEqual(["timber", "api-server"]);
	});

	test("removing the last one leaves an empty list and no selection", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		store.start();
		await settle();
		await store.removeRepository(TIMBER);
		await store.removeRepository(API_SERVER);
		expect(store.getState().repositories).toEqual([]);
		expect(store.getState().selection).toBeNull();
		expect(store.getState().loaded).toBe(true);
	});

	test("asks once per repository, and records a failure without touching the list", async () => {
		const { store, removes, lists } = await loadedStore();
		const first = store.removeRepository(TIMBER);
		const second = store.removeRepository(TIMBER);
		await settle();
		expect(removes.map(pending => pending.path)).toEqual([TIMBER]);
		removes.shift()!.resolve({ outcome: "failed", message: "read-only file system" });
		await Promise.all([first, second]);
		expect(lists.length).toBe(0);
		expect(store.getState().notice).toEqual({ kind: "failed", action: "remove", message: "read-only file system" });
		expect(store.getState().repositories.length).toBe(2);

		const third = store.removeRepository(TIMBER);
		await settle();
		removes.shift()!.reject(new Error("bridge closed"));
		await third;
		expect(store.getState().notice).toEqual({ kind: "failed", action: "remove", message: "bridge closed" });
	});
});

describe("moving a repository", () => {
	const paths = (store: { getState(): { repositories: readonly { path: string }[] } }) => store.getState().repositories.map(repository => repository.path);

	test("shows the new order at once, saves it, and a restart keeps it", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		store.start();
		await settle();
		const selection = store.getState().selection;

		const moving = store.moveRepository(API_SERVER, 0);
		expect(paths(store)).toEqual([API_SERVER, TIMBER]);
		await moving;
		expect(paths(store)).toEqual([API_SERVER, TIMBER]);
		expect(store.getState().selection).toEqual(selection);
		expect(store.getState().notice).toBeNull();

		const again = createAppStore(engine);
		again.start();
		await settle();
		expect(paths(again)).toEqual([API_SERVER, TIMBER]);
	});

	test("a move to where it already is, or of a repository not in the list, asks nothing", async () => {
		const { store, reorders } = await loadedStore();
		await store.moveRepository(TIMBER, 0);
		await store.moveRepository("/work/never-listed", 1);
		expect(reorders).toEqual([]);
		expect(paths(store)).toEqual([TIMBER, API_SERVER]);
	});

	test("a list read while the save runs keeps the new order", async () => {
		const { store, reorders, lists } = await loadedStore();
		const moving = store.moveRepository(TIMBER, 1);
		await settle();
		const refreshing = store.refresh();
		await settle();
		lists.shift()!.resolve(structuredClone(sampleRepositories));
		await refreshing;
		expect(paths(store)).toEqual([API_SERVER, TIMBER]);
		reorders.shift()!.resolve({ outcome: "saved" });
		await moving;
		expect(paths(store)).toEqual([API_SERVER, TIMBER]);
	});

	test("saves one move after another, and only the last order when moves overlap", async () => {
		const { store, reorders } = await loadedStore();
		const first = store.moveRepository(TIMBER, 1);
		await settle();
		// The second move waits for the first save, and is overtaken by the third before its turn comes.
		const second = store.moveRepository(TIMBER, 0);
		const third = store.moveRepository(API_SERVER, 0);
		expect(reorders.map(pending => pending.order)).toEqual([[API_SERVER, TIMBER]]);
		reorders.shift()!.resolve({ outcome: "saved" });
		await settle();
		expect(reorders.map(pending => pending.order)).toEqual([[API_SERVER, TIMBER]]);
		reorders.shift()!.resolve({ outcome: "saved" });
		await Promise.all([first, second, third]);
		expect(reorders).toEqual([]);
		expect(paths(store)).toEqual([API_SERVER, TIMBER]);
	});

	test("a save that fails puts the saved order back and says why", async () => {
		const { store, reorders, lists } = await loadedStore();
		const moving = store.moveRepository(TIMBER, 1);
		await settle();
		reorders.shift()!.resolve({ outcome: "failed", message: "read-only file system" });
		await settle();
		expect(store.getState().notice).toEqual({ kind: "failed", action: "reorder", message: "read-only file system" });
		lists.shift()!.resolve(structuredClone(sampleRepositories));
		await moving;
		expect(paths(store)).toEqual([TIMBER, API_SERVER]);

		const thrown = store.moveRepository(TIMBER, 1);
		await settle();
		reorders.shift()!.reject(new Error("bridge closed"));
		await settle();
		lists.shift()!.resolve(structuredClone(sampleRepositories));
		await thrown;
		expect(store.getState().notice).toEqual({ kind: "failed", action: "reorder", message: "bridge closed" });
		expect(paths(store)).toEqual([TIMBER, API_SERVER]);
	});

	test("with the override, the order goes back and the notice says why", async () => {
		const { store, reorders, lists } = await loadedStore();
		const moving = store.moveRepository(API_SERVER, 0);
		await settle();
		reorders.shift()!.resolve({ outcome: "overridden" });
		await settle();
		lists.shift()!.resolve(structuredClone(sampleRepositories));
		await moving;
		expect(store.getState().notice).toEqual({ kind: "overridden" });
		expect(paths(store)).toEqual([TIMBER, API_SERVER]);
	});
});

describe("a repository whose worktrees Timber could not list", () => {
	const diagnostic = "Not a Git repository: /work/timber";

	test("keeps its last good worktrees and the selection, and shows the diagnostic, on a pushed change", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		store.start();
		await settle();
		store.select(FEATURE_ID);
		const before = repositoryIn([...store.getState().repositories], TIMBER).worktrees;

		engine.failTimber(TIMBER, diagnostic);
		engine.announceChange(TIMBER);
		await settle();
		const failed = repositoryIn([...store.getState().repositories], TIMBER);
		expect(failed.failure).toBe(diagnostic);
		expect(failed.worktrees).toBe(before);
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: FEATURE_ID });
		// It is not a failed reload of the app: the other repositories are as fresh as ever.
		expect(store.getState().error).toBeNull();
	});

	test("keeps them across a refresh of everything, and takes the new list once Timber answers again", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		store.start();
		await settle();
		engine.failTimber(TIMBER, diagnostic);
		await store.refresh();
		await store.refresh();
		expect(repositoryIn([...store.getState().repositories], TIMBER)).toMatchObject({ failure: diagnostic });
		expect(repositoryIn([...store.getState().repositories], TIMBER).worktrees.length).toBe(4);
		expect(repositoryIn([...store.getState().repositories], API_SERVER).failure).toBeNull();

		engine.failTimber(TIMBER, null);
		engine.setRepositories(withModified(FEATURE, 6));
		await store.refresh();
		expect(repositoryIn([...store.getState().repositories], TIMBER).failure).toBeNull();
		expect(modifiedCount(store, FEATURE)).toBe(6);
	});

	test("shows no worktrees when there was never a good list", async () => {
		const engine = createMockEngine();
		engine.failTimber(TIMBER, diagnostic);
		const store = createAppStore(engine);
		store.start();
		await settle();
		expect(repositoryIn([...store.getState().repositories], TIMBER)).toMatchObject({ failure: diagnostic, worktrees: [] });
		// The selection starts on the first worktree there is.
		expect(store.getState().selection).toEqual({ repository: API_SERVER, worktree: idOf(API_SERVER) });
	});
});

describe("creating and opening a worktree", () => {
	const NEW_PATH = "/work/timber-worktrees/feat-login";
	const created = { id: `/work/timber/.git\0verified\0${NEW_PATH}`, path: NEW_PATH, branch: "feat/login" };
	const failure = { command: "timber new shown", diagnostic: "Base branch nope is missing or ambiguous. Select an exact branch.", output: { text: "error\n", truncated: false } };
	const request = { repository: TIMBER, name: "feat/login", base: null };

	/** The sample data after Timber made the new worktree. */
	function withCreated(): Repository {
		const repository = structuredClone(repositoryIn(sampleRepositories, TIMBER));
		repository.worktrees.push({ ...structuredClone(repository.worktrees[1]!), ...created, canonicalPath: NEW_PATH });
		return repository;
	}

	const outcomes: [string, WorktreeCommandResult, boolean][] = [
		["succeeded", { outcome: "succeeded", worktree: created, created: true, setupSkipped: false }, true],
		["created, but Timber stopped before setup", { outcome: "failed", failure, worktree: created, created: true, setupSkipped: false }, true],
		["failed before creation", { outcome: "failed", failure, worktree: null, created: false, setupSkipped: false }, false],
		["cancelled", { outcome: "cancelled" }, false],
	];

	for (const [name, result, selects] of outcomes) {
		test(`${name}: asks once, reads the repository again, and ${selects ? "selects the reported worktree" : "keeps the selection"}`, async () => {
			const { store, commands, loads, lists } = await loadedStore();
			store.select(FEATURE_ID);
			const answer = store.newWorktree(request);
			await settle();
			expect(commands.map(command => [command.kind, command.request])).toEqual([["new", request]]);
			// Nothing is read again before the command has ended.
			expect(loads.length).toBe(0);

			commands[0]!.resolve(result);
			await settle();
			expect(loads.map(load => load.path)).toEqual([TIMBER]);
			loads.shift()!.resolve(result.outcome !== "cancelled" && result.worktree ? withCreated() : structuredClone(repositoryIn(sampleRepositories, TIMBER)));

			expect(await answer).toEqual(result);
			expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: selects ? created.id : FEATURE_ID });
			// Once, and only that repository.
			await settle();
			expect(commands.length).toBe(1);
			expect(loads.length).toBe(0);
			expect(lists.length).toBe(0);
		});
	}

	test("a request that throws is a failed result, and the repository is still read again", async () => {
		const { store, commands, loads } = await loadedStore();
		const answer = store.newWorktree(request);
		await settle();
		commands[0]!.reject(new Error("bridge closed"));
		await settle();
		expect(loads.map(load => load.path)).toEqual([TIMBER]);
		loads.shift()!.resolve(withCreated());
		const result = await answer;
		expect(result).toMatchObject({ outcome: "failed", worktree: null, created: false, failure: { command: null, output: null } });
		expect(result.outcome === "failed" && result.failure.diagnostic).toContain("bridge closed");
		expect(result.outcome === "failed" && result.failure.diagnostic).toContain("What it did is unknown");
		// The list shows what is there, even though nobody said what happened.
		expect(repositoryIn([...store.getState().repositories], TIMBER).worktrees.length).toBe(5);
		expect(commands.length).toBe(1);
	});

	test("a reported worktree that the list does not have leaves the selection alone", async () => {
		const { store, commands, loads } = await loadedStore();
		const answer = store.newWorktree(request);
		await settle();
		commands[0]!.resolve({ outcome: "succeeded", worktree: created, created: true, setupSkipped: false });
		await settle();
		loads.shift()!.resolve(structuredClone(repositoryIn(sampleRepositories, TIMBER)));
		await answer;
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: TIMBER_ID });
	});

	test("a reload that fails afterwards still answers with the result, and records the error", async () => {
		const { store, commands, loads } = await loadedStore();
		const answer = store.newWorktree(request);
		await settle();
		commands[0]!.resolve({ outcome: "succeeded", worktree: created, created: true, setupSkipped: false });
		await settle();
		loads.shift()!.reject(new Error("Git is busy"));
		expect(await answer).toMatchObject({ outcome: "succeeded" });
		expect(store.getState().error).toEqual({ repository: TIMBER, message: "Git is busy" });
	});

	test("open: asks once with the request, reads the repository again, and selects the worktree", async () => {
		const { store, commands, loads } = await loadedStore();
		const open = { repository: TIMBER, selector: FEATURE };
		const answer = store.openWorktree(open);
		await settle();
		expect(commands.map(command => [command.kind, command.request])).toEqual([["open", open]]);
		const result: WorktreeCommandResult = { outcome: "failed", failure, worktree: { id: FEATURE_ID, path: FEATURE, branch: "feat/github-issue-lookup" }, created: false, setupSkipped: false };
		commands[0]!.resolve(result);
		await settle();
		expect(loads.map(load => load.path)).toEqual([TIMBER]);
		loads.shift()!.resolve(structuredClone(repositoryIn(sampleRepositories, TIMBER)));
		expect(await answer).toEqual(result);
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: FEATURE_ID });
		expect(commands.length).toBe(1);
	});

	test("the reported worktree is found by its registered path when the list gives it another identity", async () => {
		const { store, commands, loads } = await loadedStore();
		const answer = store.openWorktree({ repository: TIMBER, selector: "feat/login" });
		await settle();
		// Timber could not verify the folder when it wrote the record, and could when it listed.
		commands[0]!.resolve({ outcome: "failed", failure, worktree: { ...created, id: `/work/timber/.git\0registered\0${NEW_PATH}` }, created: false, setupSkipped: false });
		await settle();
		loads.shift()!.resolve(withCreated());
		await answer;
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: created.id });
	});

	test("a reported path that only another repository has is not selected", async () => {
		const { store, commands, loads } = await loadedStore();
		const answer = store.openWorktree({ repository: API_SERVER, selector: "x" });
		await settle();
		commands[0]!.resolve({ outcome: "succeeded", worktree: { id: "unknown", path: FEATURE, branch: "feat/github-issue-lookup" }, created: false, setupSkipped: false });
		await settle();
		loads.shift()!.resolve(structuredClone(repositoryIn(sampleRepositories, API_SERVER)));
		await answer;
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: TIMBER_ID });
	});

	test("with the mock engine: the new worktree is listed in Timber's order and selected", async () => {
		const store = createAppStore(createMockEngine());
		store.start();
		await settle();
		const result = await store.newWorktree({ repository: API_SERVER, name: "Add retry budget", base: null });
		expect(result).toMatchObject({ outcome: "succeeded", created: true, worktree: { branch: "add-retry-budget" } });
		const state = store.getState();
		expect(repositoryIn([...state.repositories], API_SERVER).worktrees.map(worktree => worktree.branch))
			.toEqual(["main", "add-retry-budget", "feat/rate-limit-headers", "old/removed-folder"]);
		expect(selectedWorktree(state)?.worktree.branch).toBe("add-retry-budget");
	});
});

describe("the dialog that is open", () => {
	test("is none at first, opens one at a time, and closes", async () => {
		const { store } = await loadedStore();
		expect(store.getState().dialog).toBeNull();
		let heard = 0;
		store.subscribe(() => heard++);
		store.openDialog({ kind: "new-worktree", repository: TIMBER });
		expect(store.getState().dialog).toEqual({ kind: "new-worktree", repository: TIMBER });
		store.openDialog({ kind: "new-worktree", repository: API_SERVER });
		expect(store.getState().dialog).toEqual({ kind: "new-worktree", repository: API_SERVER });
		store.closeDialog();
		expect(store.getState().dialog).toBeNull();
		expect(heard).toBe(3);
		store.closeDialog();
		expect(heard).toBe(3);
	});
});

describe("the branches to pick from", () => {
	test("come from the engine, for the repository asked about", async () => {
		const store = createAppStore(createMockEngine());
		const branches = await store.listBranches(TIMBER);
		expect(branches).toContainEqual({ selector: "chore/update-deps", kind: "local" });
		expect(branches).toContainEqual({ selector: "origin/feat/config-reload", kind: "remote" });
	});

	test("are null, not an error, when they cannot be read", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		engine.setBranches(TIMBER, null);
		expect(await store.listBranches(TIMBER)).toBeNull();
		engine.failReads("Git is busy");
		expect(await store.listBranches(API_SERVER)).toBeNull();
	});
});

describe("the dialog that is open, for Done", () => {
	test("is none at first, then the one that was opened, then none again", async () => {
		const { store } = await loadedStore();
		expect(store.getState().dialog).toBeNull();
		let heard = 0;
		store.subscribe(() => heard++);
		const request = { kind: "done-worktree", repository: TIMBER, worktree: FEATURE_ID } as const;
		store.openDialog(request);
		expect(store.getState().dialog).toEqual(request);
		store.closeDialog();
		expect(store.getState().dialog).toBeNull();
		store.closeDialog();
		expect(heard).toBe(2);
	});

	test("opening does not ask the engine for anything", async () => {
		const { store, previews, applies, loads } = await loadedStore();
		store.openDialog({ kind: "done-worktree", repository: TIMBER, worktree: FEATURE_ID });
		await settle();
		expect([previews.length, applies.length, loads.length]).toEqual([0, 0, 0]);
	});
});

describe("removing a worktree", () => {
	const request = { repository: TIMBER, path: FEATURE, preview: "preview-1" };
	const failure = { command: "timber __ide-done apply", diagnostic: "Worktree, files, settings or repository changed. Review the updated preview before removing.", output: null };

	/** The sample data without the worktree at `path`. */
	const without = (path: string): Repository => {
		const repository = structuredClone(repositoryIn(sampleRepositories, TIMBER));
		return { ...repository, worktrees: repository.worktrees.filter(worktree => worktree.path !== path) };
	};

	test("a preview is passed on as it is, and reads nothing again", async () => {
		const { store, previews, loads } = await loadedStore();
		const asked = store.previewDone({ repository: TIMBER, path: FEATURE, options: { keepBranch: true, keepIgnored: false, base: null } });
		expect(previews[0]!.request).toEqual({ repository: TIMBER, path: FEATURE, options: { keepBranch: true, keepIgnored: false, base: null } });
		previews[0]!.resolve({ outcome: "failed", failure });
		expect(await asked).toEqual({ outcome: "failed", failure });
		expect(loads.length).toBe(0);
	});

	test("a preview that the engine could not answer is a failed preview, not an error", async () => {
		const { store, previews } = await loadedStore();
		const asked = store.previewDone({ repository: TIMBER, path: FEATURE, options: { keepBranch: false, keepIgnored: false, base: null } });
		previews[0]!.reject(new Error("The request timed out"));
		expect(await asked).toEqual({ outcome: "failed", failure: { command: null, diagnostic: "The preview did not answer: The request timed out", output: null } });
	});

	test("after a removal that worked, the repository is read again before the answer, and the selection moves on", async () => {
		const { store, applies, loads, lists } = await loadedStore();
		store.select(FEATURE_ID);
		let answer: unknown = null;
		const asked = store.applyDone(request).then(result => (answer = result));
		expect(applies.map(apply => apply.request)).toEqual([request]);
		expect(loads.length).toBe(0);

		applies[0]!.resolve({ outcome: "removed" });
		await settle();
		// The list is asked for, and the answer waits for it.
		expect(loads.map(load => load.path)).toEqual([TIMBER]);
		expect(answer).toBeNull();
		loads[0]!.resolve(without(FEATURE));
		await asked;
		expect(answer).toEqual({ outcome: "removed" });
		expect(repositoryIn([...store.getState().repositories], TIMBER).worktrees.some(worktree => worktree.path === FEATURE)).toBe(false);
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: TIMBER_ID });
		// One removal and one reload of that repository, and nothing else.
		expect([applies.length, loads.length, lists.length]).toEqual([1, 1, 0]);
	});

	test("after a removal that failed, the repository is read again all the same, and nothing is tried again", async () => {
		const { store, applies, loads } = await loadedStore();
		const asked = store.applyDone(request);
		applies[0]!.resolve({ outcome: "failed", ran: true, failure });
		await settle();
		expect(loads.map(load => load.path)).toEqual([TIMBER]);
		// The folder is gone although the command failed: the list says so.
		loads[0]!.resolve(without(FEATURE));
		expect(await asked).toEqual({ outcome: "failed", ran: true, failure });
		expect(repositoryIn([...store.getState().repositories], TIMBER).worktrees.some(worktree => worktree.path === FEATURE)).toBe(false);
		await settle();
		expect([applies.length, loads.length]).toEqual([1, 1]);
	});

	test("a removal that was refused before it ran is still followed by a reload", async () => {
		const { store, applies, loads } = await loadedStore();
		const asked = store.applyDone(request);
		applies[0]!.resolve({ outcome: "failed", ran: false, failure });
		await settle();
		expect(loads.length).toBe(1);
		loads[0]!.resolve(structuredClone(repositoryIn(sampleRepositories, TIMBER)));
		expect(await asked).toMatchObject({ outcome: "failed", ran: false });
	});

	test("a removal that the engine could not answer is a failure of unknown extent, followed by a reload and no second try", async () => {
		const { store, applies, loads } = await loadedStore();
		const asked = store.applyDone(request);
		applies[0]!.reject(new Error("The window lost its connection"));
		await settle();
		expect(loads.map(load => load.path)).toEqual([TIMBER]);
		loads[0]!.resolve(without(FEATURE));
		expect(await asked).toEqual({
			outcome: "failed",
			ran: true,
			failure: { command: null, diagnostic: "The removal did not answer, so what it did is unknown: The window lost its connection", output: null },
		});
		expect(repositoryIn([...store.getState().repositories], TIMBER).worktrees.some(worktree => worktree.path === FEATURE)).toBe(false);
		expect(applies.length).toBe(1);
	});

	test("a reload that fails after the removal does not hide how the removal ended", async () => {
		const { store, applies, loads } = await loadedStore();
		const asked = store.applyDone(request);
		applies[0]!.resolve({ outcome: "removed" });
		await settle();
		loads[0]!.reject(new Error("Git is busy"));
		expect(await asked).toEqual({ outcome: "removed" });
		expect(store.getState().error).toEqual({ repository: TIMBER, message: "Git is busy" });
	});
});

describe("telling the engine what the window attends to", () => {
	test("says nothing before start, then the window and the selected worktree, and every change of either", async () => {
		const engine = createMockEngine();
		const store = createAppStore(engine);
		store.windowChanged({ visible: true, focused: false });
		expect(engine.attention()).toBeNull();

		const stop = store.start();
		// Timber is not known yet, so nothing is selected.
		expect(engine.attention()).toEqual({ visible: true, focused: false, selected: null });
		await settle();
		const first = store.getState().selection;
		expect(first).not.toBeNull();
		expect(engine.attention()?.selected).toEqual({ repository: TIMBER, worktree: TIMBER });

		store.select(FEATURE_ID);
		expect(engine.attention()).toEqual({ visible: true, focused: false, selected: { repository: TIMBER, worktree: FEATURE } });

		store.windowChanged({ visible: false, focused: false });
		expect(engine.attention()).toEqual({ visible: false, focused: false, selected: { repository: TIMBER, worktree: FEATURE } });

		stop();
		store.windowChanged({ visible: true, focused: true });
		expect(engine.attention()?.visible).toBe(false);
	});

	test("tells the engine only when something it hears about changed", async () => {
		const engine = createMockEngine();
		const told: unknown[] = [];
		engine.attend = attention => void told.push(attention);
		const store = createAppStore(engine);
		store.start();
		await settle();
		const count = told.length;
		store.select(TIMBER_ID);
		store.windowChanged({ visible: true, focused: true });
		store.showToast("Something else changed");
		expect(told.length).toBe(count);
	});

	test("keeps working when the engine cannot be told, and tells it on the next change", async () => {
		const engine = createMockEngine();
		let broken = true;
		const told: unknown[] = [];
		engine.attend = attention => {
			if (broken) throw new Error("bridge not up");
			told.push(attention);
		};
		const store = createAppStore(engine);
		store.start();
		await settle();
		expect(store.getState().loaded).toBe(true);
		broken = false;
		store.select(FEATURE_ID);
		expect(told).toEqual([{ visible: true, focused: true, selected: { repository: TIMBER, worktree: FEATURE } }]);
	});
});
