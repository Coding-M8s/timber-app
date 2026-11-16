import { describeChanges, describeSync, worktreeLabel } from "../format";
import { useAppState, useStore } from "../store/react";
import { isRunning, selectedWorktree } from "../store/state";

export function Workspace() {
	const store = useStore();
	const state = useAppState();
	const selection = selectedWorktree(state);
	if (!selection) {
		// Before the first answer, and after a first load that failed, the sidebar says what is going on.
		const waiting = !state.loaded;
		return (
			<main className="workspace">
				<div className="empty">
					{!waiting && (
						<>
							<p className="empty-title">{state.repositories.length === 0 ? "No repository yet" : "No worktree to show"}</p>
							<p className="empty-text">Add a repository to see its worktrees here. The app remembers it for next time.</p>
							<button type="button" className="button" disabled={isRunning(state, "add-repository")} onClick={() => void store.addRepository()}>
								Add repository
							</button>
						</>
					)}
				</div>
			</main>
		);
	}

	const { worktree } = selection;
	const changes = describeChanges(worktree);
	return (
		<main className="workspace">
			<header className="workspace-header">
				<h1 className="workspace-title">{worktreeLabel(worktree)}</h1>
				<div className="workspace-meta">
					{worktree.sync && <span>{describeSync(worktree.sync)}</span>}
					<span>{changes}</span>
					<span className="path">{worktree.path}</span>
				</div>
			</header>
			<div className="empty">
				<p className="empty-title">Nothing running here yet</p>
				<p className="empty-text">Agent and terminal panes are the next milestone. See docs/architecture.md.</p>
			</div>
		</main>
	);
}
