import { describe, expect, test } from "bun:test";
import type { Engine } from "../src/shared/engine";
import type { Repository, TimberStatus } from "../src/shared/model";
import { createMockEngine, sampleRepositories, sampleTimberStatuses } from "../src/mainview/engine/mock";
import { isRunning, selectedWorktree } from "../src/mainview/store/state";
import { createAppStore } from "../src/mainview/store/store";

const settle = () => Bun.sleep(0);
const TIMBER = "/work/timber";
const API_SERVER = "/work/api-server";
const FEATURE = "/work/timber-worktrees/feat-github-issue-lookup";

/** A copy of the sample data in which the worktree at `path` has this many modified files. */
function withModified(path: string, modified: number): Repository[] {
	const copy = structuredClone(sampleRepositories);
	for (const repository of copy) {
		for (const worktree of repository.worktrees) {
			if (worktree.path === path && worktree.status) worktree.status.modified = modified;
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
		if (worktree) return worktree.status?.modified;
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
	const listeners = new Set<(path: string) => void>();
	const engine: Engine = {
		timberStatus: async () => timber,
		recheckTimber: async () => timber,
		listRepositories: () => new Promise((resolve, reject) => {
			lists.push({ path: null, resolve, reject });
		}),
		loadRepository: path => new Promise((resolve, reject) => {
			loads.push({ path, resolve, reject });
		}),
		onRepositoryChanged(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
	};
	const push = (path: string) => {
		for (const listener of [...listeners]) listener(path);
	};
	return { engine, lists, loads, push, listeners };
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
		expect(state.selection).toEqual({ repository: TIMBER, worktree: TIMBER });
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
		repositoryIn(olderList, API_SERVER).worktrees[0]!.status!.untracked = 6;
		lists[0]!.resolve(olderList);
		await settle();
		// The reloaded repository keeps its newer data. The rest of the list is still applied.
		expect(modifiedCount(store, FEATURE)).toBe(7);
		expect(repositoryIn([...store.getState().repositories], API_SERVER).worktrees[0]!.status!.untracked).toBe(6);
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
		store.select(FEATURE);
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: FEATURE });

		void store.refresh();
		lists[0]!.resolve(withModified(FEATURE, 2));
		await settle();
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: FEATURE });
		// The selection points at the refreshed data, not a copy from before.
		expect(selectedWorktree(store.getState())?.worktree.status?.modified).toBe(2);

		push(TIMBER);
		loads[0]!.resolve(repositoryIn(withModified(FEATURE, 3), TIMBER));
		await settle();
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: FEATURE });
		expect(selectedWorktree(store.getState())?.worktree.status?.modified).toBe(3);
	});

	test("moves to the primary checkout when a reload shows the selected worktree is gone", async () => {
		const { store, loads, push } = await loadedStore();
		store.select(FEATURE);
		push(TIMBER);
		const reloaded = repositoryIn(structuredClone(sampleRepositories), TIMBER);
		reloaded.worktrees = reloaded.worktrees.filter(worktree => worktree.path !== FEATURE);
		loads[0]!.resolve(reloaded);
		await settle();
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: TIMBER });
	});

	test("moves to the first worktree when a refresh shows the whole repository is gone", async () => {
		const { store, lists } = await loadedStore();
		store.select("/work/api-server-worktrees/feat-rate-limit-headers");
		void store.refresh();
		lists[0]!.resolve(structuredClone(sampleRepositories).filter(repository => repository.path !== API_SERVER));
		await settle();
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: TIMBER });
	});

	test("ignores a path that no repository has", async () => {
		const { store } = await loadedStore();
		store.select("/nowhere");
		expect(store.getState().selection).toEqual({ repository: TIMBER, worktree: TIMBER });
	});
});

describe("a failed reload", () => {
	test("of everything keeps the last good data and selection, and records the error", async () => {
		const { store, lists } = await loadedStore();
		store.select(FEATURE);
		const before = store.getState().repositories;

		void store.refresh();
		lists[0]!.reject(new Error("Git is busy"));
		await settle();
		const state = store.getState();
		expect(state.error).toEqual({ repository: null, message: "Git is busy" });
		expect(state.repositories).toBe(before);
		expect(state.loaded).toBe(true);
		expect(state.selection).toEqual({ repository: TIMBER, worktree: FEATURE });
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
