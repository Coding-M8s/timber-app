import type { Engine } from "../../shared/engine";
import type { TimberStatus } from "../../shared/model";
import { mergeOverlapping } from "./merge";
import { type AppState, type Operation, initialState, reconcileSelection, selectionFor, timberReady } from "./state";

/**
 * The single holder of what the interface shows: Timber's status, the
 * repositories and their worktrees, the selection, and operations in progress.
 * Components read it and call its actions. Nothing else keeps a copy.
 */
export interface AppStore {
	getState(): AppState;
	/** Hear about every change of state. Returns a function that stops listening. */
	subscribe(listener: () => void): () => void;
	/**
	 * Look for Timber, load the repositories once it is ready, and reload a
	 * repository whenever the engine reports a change in it. Returns a function
	 * that stops listening to the engine.
	 */
	start(): () => void;
	/** Look for Timber again, for example after the person installed it. */
	retryTimber(): Promise<void>;
	/** Reload everything. */
	refresh(): Promise<void>;
	/** Reload one repository, named by the path of its primary checkout. */
	reloadRepository(path: string): Promise<void>;
	/** Select a worktree by its path. A path that no repository has is ignored. */
	select(worktreePath: string): void;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function createAppStore(engine: Engine): AppStore {
	let state = initialState;
	const listeners = new Set<() => void>();

	function update(change: Partial<AppState>): void {
		state = { ...state, ...change };
		for (const listener of [...listeners]) listener();
	}

	async function track(operation: Operation, task: () => Promise<void>): Promise<void> {
		update({ operations: [...state.operations, operation] });
		try {
			await task();
		} finally {
			update({ operations: state.operations.filter(candidate => candidate !== operation) });
		}
	}

	/*
	 * Every reload takes the next ticket when it asks the engine, so a higher
	 * ticket means data read later. `listTicket` is the ticket of the full list
	 * on screen, and `repositoryTickets` holds the ticket of each repository
	 * that a single reload put on screen. A response is dropped when what is on
	 * screen for that repository carries a higher ticket than the response does.
	 */
	let lastTicket = 0;
	let listTicket = 0;
	const repositoryTickets = new Map<string, number>();

	const reloadAll = mergeOverlapping<"all">(() => track({ kind: "reload-all" }, async () => {
		const ticket = ++lastTicket;
		try {
			const listed = await engine.listRepositories();
			// A repository that was reloaded on its own after this list was asked for keeps that newer data.
			const repositories = listed.map(repository => {
				const newer = (repositoryTickets.get(repository.path) ?? 0) > ticket;
				return (newer && state.repositories.find(current => current.path === repository.path)) || repository;
			});
			listTicket = ticket;
			update({
				repositories,
				loaded: true,
				selection: reconcileSelection(repositories, state.selection),
				error: null,
			});
		} catch (error) {
			update({ error: { repository: null, message: messageOf(error) } });
		}
	}));

	const reloadOne = mergeOverlapping<string>(path => track({ kind: "reload-repository", repository: path }, async () => {
		const ticket = ++lastTicket;
		// A full list asked for after this reload has already answered: it is the newer picture.
		const stale = () => ticket < listTicket;
		try {
			const repository = await engine.loadRepository(path);
			if (stale()) return;
			if (!repository) throw new Error(`Git could not read ${path}`);
			if (!state.repositories.some(current => current.path === path)) return;
			repositoryTickets.set(path, ticket);
			const repositories = state.repositories.map(current => current.path === path ? repository : current);
			update({
				repositories,
				selection: reconcileSelection(repositories, state.selection),
				error: state.error?.repository === path ? null : state.error,
			});
		} catch (error) {
			if (stale()) return;
			update({ error: { repository: path, message: messageOf(error) } });
		}
	}));

	function findTimber(look: () => Promise<TimberStatus>): Promise<void> {
		const wasReady = timberReady(state);
		return track({ kind: "find-timber" }, async () => {
			try {
				update({ timber: { known: true, status: await look() } });
			} catch (error) {
				update({ timber: { known: false, message: messageOf(error) } });
			}
			if (timberReady(state) && !wasReady) void reloadAll("all");
		});
	}

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		start() {
			const stop = engine.onRepositoryChanged(path => {
				// Only a repository on screen can be refreshed. Reload everything to pick up a new one.
				if (state.repositories.some(repository => repository.path === path)) void reloadOne(path);
			});
			void findTimber(() => engine.timberStatus());
			return stop;
		},
		retryTimber: () => findTimber(() => engine.recheckTimber()),
		refresh: () => reloadAll("all"),
		reloadRepository: path => reloadOne(path),
		select(worktreePath) {
			const selection = selectionFor(state.repositories, worktreePath);
			if (selection && selection.worktree !== state.selection?.worktree) update({ selection });
		},
	};
}
