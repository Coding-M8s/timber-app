import { useAppState } from "../store/react";
import { timberReady } from "../store/state";
import { DoneDialog } from "./DoneDialog";
import { NewWorktreeDialog } from "./NewWorktreeDialog";

/**
 * The dialog the store says is open (`state.dialog`), over the window. One
 * at a time. Every dialog here runs Timber, so none is shown until Timber is ready.
 */
export function Dialogs() {
	const state = useAppState();
	const { dialog } = state;
	if (!dialog || !timberReady(state)) return null;
	switch (dialog.kind) {
		case "new-worktree": {
			// Timber runs in the repository's folder, so the repository has to be listed and there.
			const repository = state.repositories.find(candidate => candidate.path === dialog.repository && candidate.available);
			return repository ? <NewWorktreeDialog key={repository.path} repository={repository} /> : null;
		}
		case "done-worktree":
			// A key per worktree, so a dialog for another one starts from nothing.
			return <DoneDialog key={`${dialog.repository}\n${dialog.worktree}`} request={dialog} />;
	}
}
