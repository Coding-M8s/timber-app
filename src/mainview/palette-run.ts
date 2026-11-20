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
	}
}
