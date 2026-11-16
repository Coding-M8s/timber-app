import type { Engine } from "../../shared/engine";
import { type Layout, clampSidebarWidth, forgetRepository, sameLayout, toggleCollapsed } from "../../shared/layout";
import type { BranchSuggestion, NewWorktreeRequest, OpenWorktreeRequest, ReportedWorktree, TimberStatus, WorktreeCommandResult } from "../../shared/model";
import { describeAdded, describeRemoved, folderName } from "../format";
import { mergeOverlapping } from "./merge";
import { type AppState, type DialogRequest, type Operation, type WorkspaceTab, TOAST_MILLISECONDS, initialState, keepLastGood, reconcileSelection, selectionFor, selectionForRepository, timberReady } from "./state";

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
	/**
	 * Open the folder picker and add the picked repository to the saved list.
	 * The added repository, or the one that was already listed, becomes selected.
	 */
	addRepository(): Promise<void>;
	/** Forget a repository in the app. Nothing on disk changes. */
	removeRepository(path: string): Promise<void>;
	/** Put away the note about the latest add or remove. */
	dismissNotice(): void;
	/** Select a worktree by its identity (`Worktree.id`). One that no repository has is ignored. */
	select(worktreeId: string): void;
	/** Say briefly that an operation worked. The toast disappears on its own. */
	showToast(text: string): void;
	/** Put a toast away before its time is up. */
	dismissToast(id: number): void;
	/** Collapse or open the group of a repository, named by the path of its primary checkout, and remember it. */
	toggleGroup(repository: string): void;
	/**
	 * Set the sidebar width on screen, kept within its limits. Nothing is saved:
	 * call `saveLayout` when the resize ends.
	 */
	resizeSidebar(width: number): void;
	/**
	 * Remember the layout on screen for the next run. A save that fails leaves
	 * the screen alone and is noted in `layoutProblem`.
	 */
	saveLayout(): Promise<void>;
	/** Put away the note about the layout. */
	dismissLayoutProblem(): void;
	/** Show one of the views of the selected worktree. */
	showTab(tab: WorkspaceTab): void;
	/**
	 * Create a worktree with `timber new`. Whatever comes of it, the
	 * repository is read again before this answers, and the worktree Timber
	 * reported is selected when the list has it. The command runs once and is
	 * never retried here. A request that did not get through is a failed result.
	 */
	newWorktree(request: NewWorktreeRequest): Promise<WorktreeCommandResult>;
	/** Open a branch or a worktree with `timber open`. Reads the repository again and selects as `newWorktree` does. */
	openWorktree(request: OpenWorktreeRequest): Promise<WorktreeCommandResult>;
	/**
	 * The branches of a repository to offer for picking. Null when they could
	 * not be read, which only means there is nothing to pick from.
	 */
	listBranches(repository: string): Promise<BranchSuggestion[] | null>;
	/** Open a dialog over the window, in place of the one that is open. */
	openDialog(request: DialogRequest): void;
	closeDialog(): void;
}

/** Run `task` after `milliseconds`. Returns a function that calls it off. */
export type Schedule = (task: () => void, milliseconds: number) => () => void;

const scheduleWithTimer: Schedule = (task, milliseconds) => {
	const timer = setTimeout(task, milliseconds);
	return () => clearTimeout(timer);
};

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** `schedule` is how the store waits before it takes a toast away. Tests pass their own clock. */
export function createAppStore(engine: Engine, schedule: Schedule = scheduleWithTimer): AppStore {
	let state = initialState;
	const listeners = new Set<() => void>();
	let lastToast = 0;
	const toastTimers = new Map<number, () => void>();

	function update(change: Partial<AppState>): void {
		state = { ...state, ...change };
		for (const listener of [...listeners]) listener();
	}

	function dismissToast(id: number): void {
		toastTimers.get(id)?.();
		toastTimers.delete(id);
		if (state.toasts.some(toast => toast.id === id)) update({ toasts: state.toasts.filter(toast => toast.id !== id) });
	}

	function showToast(text: string): void {
		const id = ++lastToast;
		update({ toasts: [...state.toasts, { id, text }] });
		toastTimers.set(id, schedule(() => dismissToast(id), TOAST_MILLISECONDS));
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
				const current = state.repositories.find(candidate => candidate.path === repository.path);
				const newer = (repositoryTickets.get(repository.path) ?? 0) > ticket;
				return (newer && current) || keepLastGood(current, repository);
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
			const repositories = state.repositories.map(current => current.path === path ? keepLastGood(current, repository) : current);
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

	/*
	 * The layout as the engine holds it, null until it answered. A change made
	 * before that answer wins over it, because the person made it later.
	 */
	let savedLayout: Layout | null = null;
	let layoutTouched = false;

	async function loadLayout(): Promise<void> {
		try {
			const layout = await engine.loadLayout();
			savedLayout = layout;
			if (!layoutTouched) update({ layout });
		} catch (error) {
			update({ layoutProblem: { action: "read", message: messageOf(error) } });
		}
	}

	function changeLayout(layout: Layout): void {
		layoutTouched = true;
		update({ layout });
	}

	// One save at a time. Saves asked for meanwhile share one follow-up save of whatever is on screen by then.
	const saveLayout = mergeOverlapping<"layout">(async () => {
		if (!layoutTouched) return;
		const layout = state.layout;
		if (savedLayout && sameLayout(savedLayout, layout)) return;
		let failure: string | null = null;
		try {
			const result = await engine.saveLayout(layout);
			if (result.outcome === "failed") failure = result.message;
		} catch (error) {
			failure = messageOf(error);
		}
		if (failure !== null) {
			// One note, however many saves fail: a drag or a held key must not pile them up.
			if (state.layoutProblem?.action !== "save" || state.layoutProblem.message !== failure) {
				update({ layoutProblem: { action: "save", message: failure } });
			}
			return;
		}
		savedLayout = layout;
		if (state.layoutProblem) update({ layoutProblem: null });
	});

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

	function selectRepository(path: string): void {
		const selection = selectionForRepository(state.repositories, path);
		if (selection && selection.worktree !== state.selection?.worktree) update({ selection });
	}

	// One at a time: a second click while the picker is open, or while a repository is being forgotten, does nothing.
	function addRepository(): Promise<void> {
		if (state.operations.some(operation => operation.kind === "add-repository")) return Promise.resolve();
		return track({ kind: "add-repository" }, async () => {
			try {
				const result = await engine.addRepository();
				switch (result.outcome) {
					case "cancelled":
						return;
					case "added":
						update({ notice: null });
						// Read the list again instead of patching it, so it is whatever the engine saved.
						await reloadAll("all");
						selectRepository(result.repository.path);
						showToast(describeAdded(result.repository.name));
						return;
					case "already-listed":
						update({ notice: { kind: "already-listed", repository: result.repository } });
						selectRepository(result.repository);
						return;
					case "not-a-repository":
						update({ notice: { kind: "not-a-repository", folder: result.folder } });
						return;
					case "overridden":
						update({ notice: { kind: "overridden" } });
						return;
					case "failed":
						update({ notice: { kind: "failed", action: "add", message: result.message } });
						return;
				}
			} catch (error) {
				update({ notice: { kind: "failed", action: "add", message: messageOf(error) } });
			}
		});
	}

	function removeRepository(path: string): Promise<void> {
		if (state.operations.some(operation => operation.kind === "remove-repository" && operation.repository === path)) return Promise.resolve();
		return track({ kind: "remove-repository", repository: path }, async () => {
			const name = state.repositories.find(repository => repository.path === path)?.name ?? null;
			try {
				const result = await engine.removeRepository(path);
				switch (result.outcome) {
					case "removed":
						// The engine forgot the repository's collapsed group along with it.
						if (savedLayout) savedLayout = forgetRepository(savedLayout, path);
						update({ notice: null, layout: forgetRepository(state.layout, path) });
						await reloadAll("all");
						showToast(describeRemoved(name ?? folderName(path)));
						return;
					case "overridden":
						update({ notice: { kind: "overridden" } });
						return;
					case "failed":
						update({ notice: { kind: "failed", action: "remove", message: result.message } });
						return;
				}
			} catch (error) {
				update({ notice: { kind: "failed", action: "remove", message: messageOf(error) } });
			}
		});
	}

	function select(worktreeId: string): void {
		const selection = selectionFor(state.repositories, worktreeId);
		if (selection && selection.worktree !== state.selection?.worktree) update({ selection });
	}

	/** Select the worktree a Timber command reported, when the list that was just read has it. */
	function selectReported(repositoryPath: string, reported: ReportedWorktree): void {
		const repository = state.repositories.find(candidate => candidate.path === repositoryPath);
		// By identity first. The registered path stands in when Timber could verify the folder in only one of the two reads.
		const worktree = repository?.worktrees.find(candidate => candidate.id === reported.id)
			?? repository?.worktrees.find(candidate => candidate.path === reported.path);
		if (worktree) select(worktree.id);
	}

	/**
	 * One Timber command that works on a repository's worktrees. The command is
	 * asked for once. The repository is read again after every outcome,
	 * because even a failure can leave a new worktree behind.
	 */
	async function runWorktreeCommand(repository: string, ask: () => Promise<WorktreeCommandResult>): Promise<WorktreeCommandResult> {
		let result: WorktreeCommandResult;
		try {
			result = await ask();
		} catch (error) {
			const diagnostic = `The app did not hear how the command ended: ${messageOf(error)}. What it did is unknown, so check the list before trying again.`;
			result = { outcome: "failed", failure: { command: null, diagnostic, output: null }, worktree: null, created: false };
		}
		await reloadOne(repository);
		if (result.outcome !== "cancelled" && result.worktree) selectReported(repository, result.worktree);
		return result;
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
			void loadLayout();
			void findTimber(() => engine.timberStatus());
			return stop;
		},
		retryTimber: () => findTimber(() => engine.recheckTimber()),
		refresh: () => reloadAll("all"),
		reloadRepository: path => reloadOne(path),
		addRepository,
		removeRepository,
		dismissNotice() {
			if (state.notice) update({ notice: null });
		},
		select,
		showToast,
		dismissToast,
		newWorktree: request => runWorktreeCommand(request.repository, () => engine.newWorktree(request)),
		openWorktree: request => runWorktreeCommand(request.repository, () => engine.openWorktree(request)),
		async listBranches(repository) {
			try {
				return await engine.listBranches(repository);
			} catch {
				return null;
			}
		},
		toggleGroup(repository) {
			changeLayout(toggleCollapsed(state.layout, repository));
			void saveLayout("layout");
		},
		resizeSidebar(width) {
			const sidebarWidth = clampSidebarWidth(width);
			if (sidebarWidth !== state.layout.sidebarWidth) changeLayout({ ...state.layout, sidebarWidth });
		},
		saveLayout: () => saveLayout("layout"),
		dismissLayoutProblem() {
			if (state.layoutProblem) update({ layoutProblem: null });
		},
		showTab(tab) {
			if (tab !== state.tab) update({ tab });
		},
		openDialog(request) {
			update({ dialog: request });
		},
		closeDialog() {
			if (state.dialog) update({ dialog: null });
		},
	};
}
