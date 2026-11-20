import { useAppState } from "../store/react";
import { SETTINGS_SECTIONS, timberReady } from "../store/state";
import { CleanUpMergedDialog } from "./CleanUpMergedDialog";
import { ArenaCompareDialog } from "./ArenaCompareDialog";
import { CommandPalette } from "./CommandPalette";
import { DeleteBackupDialog, RestoreBackupDialog } from "./BackupDialogs";
import { DoneDialog } from "./DoneDialog";
import { NewArenaDialog } from "./NewArenaDialog";
import { NewWorktreeDialog } from "./NewWorktreeDialog";
import { RebaseDialog } from "./RebaseDialog";
import { SendReviewDialog } from "./ReviewNotes";
import { SettingsDialog } from "./SettingsDialog";
import { SetupWizardDialog } from "./SetupWizardDialog";

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
			return repository ? <NewWorktreeDialog key={`${repository.path}\n${dialog.mode ?? "new"}`} repository={repository} initialMode={dialog.mode ?? "new"} /> : null;
		}
		case "done-worktree":
			// A key per worktree, so a dialog for another one starts from nothing.
			return <DoneDialog key={`${dialog.repository}\n${dialog.worktree}`} request={dialog} />;
		case "rebase-worktree":
			return <RebaseDialog key={`${dialog.repository}\n${dialog.worktree}`} request={dialog} />;
		case "clean-up-merged":
			// It closes itself when the repository is not listed or not there, so the request never lingers unseen.
			return <CleanUpMergedDialog key={dialog.repository} request={dialog} />;
		case "palette":
			return <CommandPalette />;
		case "restore-backup":
		case "delete-backup": {
			// Timber runs in the repository's folder, so the repository has to be listed and there. A key per backup, so another one starts from nothing.
			const repository = state.repositories.find(candidate => candidate.path === dialog.repository && candidate.available);
			if (!repository) return null;
			const key = `${dialog.repository}\n${dialog.backup.id}`;
			return dialog.kind === "restore-backup" ? <RestoreBackupDialog key={key} request={dialog} /> : <DeleteBackupDialog key={key} request={dialog} />;
		}
		case "settings":
			// A key per section asked for, so asking for another one while Settings is open opens it there.
			return <SettingsDialog key={dialog.section ?? ""} initialSection={dialog.section ?? SETTINGS_SECTIONS[0]} />;
		case "send-review":
			// A key per worktree, so another review starts from nothing.
			return <SendReviewDialog key={dialog.worktree} worktree={dialog.worktree} />;
		case "new-arena":
		case "arena-compare": {
			// Timber runs in the repository's folder, so the repository has to be listed and there. A key per arena, so another starts from nothing.
			const repository = state.repositories.find(candidate => candidate.path === dialog.repository && candidate.available);
			if (!repository) return null;
			return dialog.kind === "new-arena"
				? <NewArenaDialog key={repository.path} repository={repository} />
				: <ArenaCompareDialog key={`${repository.path}\n${dialog.arena}`} request={dialog} />;
		}
		case "set-up-timber": {
			// Timber reads and saves the repository's settings in its folder, so it has to be listed and there.
			const repository = state.repositories.find(candidate => candidate.path === dialog.repository && candidate.available);
			return repository ? <SetupWizardDialog key={repository.path} repository={repository} /> : null;
		}
	}
}
