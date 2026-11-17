import { useAppState } from "../store/react";
import { SETTINGS_SECTIONS, timberReady } from "../store/state";
import { DoneDialog } from "./DoneDialog";
import { NewWorktreeDialog } from "./NewWorktreeDialog";
import { RebaseDialog } from "./RebaseDialog";
import { SettingsDialog } from "./SettingsDialog";

/**
 * The dialog the store says is open (`state.dialog`), over the window. One
 * at a time. None is shown until Timber is ready: most of them run Timber,
 * and Settings opens from the sidebar, which shows only then.
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
		case "rebase-worktree":
			return <RebaseDialog key={`${dialog.repository}\n${dialog.worktree}`} request={dialog} />;
		case "settings":
			// A key per section asked for, so asking for another one while Settings is open opens it there.
			return <SettingsDialog key={dialog.section ?? ""} initialSection={dialog.section ?? SETTINGS_SECTIONS[0]} />;
	}
}
