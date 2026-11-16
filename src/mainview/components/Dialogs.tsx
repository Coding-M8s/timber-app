import { useAppState } from "../store/react";
import { timberReady } from "../store/state";
import { NewWorktreeDialog } from "./NewWorktreeDialog";

/**
 * The dialog the store says is open (`state.dialog`), over the window. One
 * at a time. Nothing that runs Timber is offered while Timber is not ready.
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
	}
}
