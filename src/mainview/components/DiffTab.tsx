import { sameFileChange } from "../../shared/file-changes";
import type { Repository, Worktree } from "../../shared/model";
import { reviewButtonLabel } from "../changes-panel-format";
import { useAppState, useStore } from "../store/react";
import { changesPanelShown } from "../store/state";
import { FOLDER_MISSING_CHANGES } from "./ChangesList";
import { DiffView } from "./DiffView";
import { toggleSidePanel } from "./SidePanel";

/**
 * A worktree's diff tab: the diff of the changed file chosen in the side
 * panel's Changes view, as the File tab shows a file. While the Changes
 * view is not on screen and the worktree has review notes, its title line
 * has a Review button with their count, which shows the Changes view.
 */
export function DiffTab({ repository, worktree }: { repository: Repository; worktree: Worktree }) {
	const store = useStore();
	const state = useAppState();
	const tab = state.diffs[worktree.id];
	const view = state.changes?.worktree === worktree.id ? state.changes : null;
	const notes = state.reviews[worktree.id]?.length ?? 0;

	if (!worktree.pathExists) {
		return (
			<div className="empty">
				<p className="empty-title">No changes to show</p>
				<p className="empty-text">{FOLDER_MISSING_CHANGES}</p>
			</div>
		);
	}
	const file = tab && view?.files?.find(candidate => sameFileChange(candidate, tab.file));
	if (!view || !file) {
		if (view?.problem != null) {
			return (
				<div className="sidebar-error diff-problem" role="alert">
					<p className="sidebar-error-title">Could not read the changes</p>
					<p className="sidebar-error-text">{view.problem}</p>
				</div>
			);
		}
		return <p className="diff-reading" role="status">Reading the diff</p>;
	}
	const review = notes > 0 && !changesPanelShown(state)
		? (
			<button type="button" className="button quiet review-toggle" aria-label={reviewButtonLabel(notes)} title="Show the review in the Changes view" onClick={() => void toggleSidePanel(store, "changes")}>
				Review
				<span className="change-group-count" aria-hidden="true">{notes}</span>
			</button>
		)
		: null;
	return <DiffView repository={repository.path} worktree={worktree} view={view} file={file} layout="unified" review={review} onClose={() => store.closeDiff(worktree.id)} />;
}
