import type { Repository, Worktree } from "../../shared/model";
import { describeChanges, describeSync, worktreeLabel } from "../format";

interface WorkspaceProps {
	selection: { repository: Repository; worktree: Worktree } | null;
}

export function Workspace({ selection }: WorkspaceProps) {
	if (!selection) {
		return (
			<main className="workspace">
				<div className="empty">
					<p className="empty-title">No repository yet</p>
					<p className="empty-text">Start the app from inside a Git repository, or list repositories in TIMBER_APP_REPOS.</p>
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
					{worktree.status && <span>{describeSync(worktree.status.sync)}</span>}
					{changes && <span>{changes}</span>}
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
