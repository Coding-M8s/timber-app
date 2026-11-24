import type { PaletteEntry } from "./palette";
import type { AppStore } from "./store/store";
import { toggleSidePanel } from "./components/SidePanel";
import { shownSession } from "./store/state";
import { wantTerminalFocus } from "./terminal-focus";

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
			keyboardToTerminal(store, action.worktree);
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
			keyboardToTerminal(store, action.worktree);
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
		case "side-panel":
			toggleSidePanel(store, action.view);
			return;
	}
}

/**
 * Give the keyboard to the worktree's shown terminal once the palette has
 * closed, when the Workspace tab shows. Asked for at once, a terminal already
 * on screen would try while the palette still holds the keyboard, and the
 * palette, closing, would hand it back to where it was opened from.
 */
export function keyboardToTerminal(store: Pick<AppStore, "getState">, worktree: string, later: (run: () => void) => void = run => void setTimeout(run, 0)): void {
	later(() => {
		const state = store.getState();
		// Only while it is still what shows: something chosen since then decides for itself.
		if (state.tab !== "workspace" || state.selection?.worktree !== worktree) return;
		// And only with a terminal there to take it, now or once it starts, so the wish never waits for a later one.
		const starting = state.operations.some(operation => operation.kind === "open-terminal" && operation.worktree === worktree);
		if (shownSession(state, worktree) !== null || starting) wantTerminalFocus(worktree);
	});
}

/**
 * Run a chop of a repository in a worktree, by its identity, as the palette
 * and the chops panel do: through `AppStore.runChop`, which asks before a
 * repository chop's first run, picks or asks for a prompt's agent, and
 * copies a prompt when no agent is saved. With `showSession`, the worktree
 * is selected and its Workspace tab shown first, so the new session, or why
 * it did not start, is in view. `text` is the chop's text as the person
 * edited it for this run, from the chop search.
 */
export function runChopIn(store: AppStore, repository: string, worktree: string, chop: string, size: SessionSize, showSession = true, text?: string): void {
	if (showSession) {
		store.select(worktree);
		store.showTab("workspace");
		keyboardToTerminal(store, worktree);
	}
	void store.runChop(repository, worktree, chop, size(), text === undefined ? {} : { text });
}
