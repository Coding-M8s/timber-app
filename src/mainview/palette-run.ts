import type { PaletteEntry } from "./palette";
import type { AppStore } from "./store/store";

/** The size to start a session at: the pane's own estimate, which the pane corrects once it shows. */
export type SessionSize = () => { cols: number; rows: number };

/**
 * Do what an entry says, through the store methods the buttons call. Nothing
 * happens for an entry that cannot run. A dialog replaces the palette; the
 * rest close it first.
 */
export function runPaletteEntry(store: AppStore, entry: PaletteEntry, size: SessionSize): void {
	if (entry.disabledReason !== null) return;
	const { action } = entry;
	if (action.kind === "dialog") {
		store.openDialog(action.request);
		return;
	}
	store.closeDialog();
	switch (action.kind) {
		case "select":
			store.select(action.worktree);
			return;
		case "fetch":
			void store.fetchNow(action.repository);
			return;
		case "add-repository":
			void store.addRepository();
			return;
		case "next-waiting":
			store.jumpToWaiting();
			return;
		case "editor":
			void store.openInEditor({ repository: action.repository, worktree: action.worktree });
			return;
		case "terminal":
			store.select(action.worktree);
			store.showTab("workspace");
			void store.openTerminal({
				repository: action.repository,
				worktree: action.path,
				...size(),
				...(action.agent === null ? {} : { agent: action.agent }),
			});
			return;
		case "chop":
			runChopIn(store, action.repository, action.worktree, action.chop, size);
			return;
	}
}

/**
 * Run a chop of a repository in a worktree, by its identity, as the palette
 * and the chops panel do: through `AppStore.runChop`, which asks before a
 * repository chop's first run, picks or asks for a prompt's agent, and
 * copies a prompt when no agent is saved. With `showSession`, the worktree
 * is selected and its Workspace tab shown first, so the new session, or why
 * it did not start, is in view.
 */
export function runChopIn(store: AppStore, repository: string, worktree: string, chop: string, size: SessionSize, showSession = true): void {
	if (showSession) {
		store.select(worktree);
		store.showTab("workspace");
	}
	void store.runChop(repository, worktree, chop, size());
}
