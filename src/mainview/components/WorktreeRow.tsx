import type { SyncState, Worktree } from "../../shared/model";
import { describeSync, worktreeLabel } from "../format";

function Arrow({ direction }: { direction: "up" | "down" }) {
	return (
		<svg aria-hidden="true" width="9" height="10" viewBox="0 0 9 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
			<path d={direction === "down" ? "M4.5 1.5v7M1.5 5.5l3 3 3-3" : "M4.5 8.5v-7M1.5 4.5l3-3 3 3"} />
		</svg>
	);
}

/** Arrows and counts against the upstream, in the spirit of the VS Code status bar. */
function SyncBadge({ sync }: { sync: SyncState }) {
	if (sync.kind === "unpublished") return <span className="sync-note">local only</span>;
	if (sync.kind === "gone") return <span className="sync-note">upstream gone</span>;
	return (
		<>
			{sync.behind > 0 && <span className="sync behind"><Arrow direction="down" />{sync.behind}</span>}
			{sync.ahead > 0 && <span className="sync ahead"><Arrow direction="up" />{sync.ahead}</span>}
		</>
	);
}

function subtitle(worktree: Worktree): string {
	if (worktree.prunable) return "Folder missing";
	if (worktree.primary) return "Primary checkout";
	if (worktree.locked) return "Locked";
	return "Worktree";
}

interface WorktreeRowProps {
	worktree: Worktree;
	selected: boolean;
	onSelect: () => void;
}

export function WorktreeRow({ worktree, selected, onSelect }: WorktreeRowProps) {
	const status = worktree.status;
	return (
		<button
			type="button"
			className={selected ? "row selected" : "row"}
			aria-current={selected}
			title={status ? describeSync(status.sync) : worktree.path}
			onClick={onSelect}
		>
			<span className="row-line">
				<span className="row-name">{worktreeLabel(worktree)}</span>
				{status && <SyncBadge sync={status.sync} />}
			</span>
			<span className="row-line row-meta">
				<span className="row-sub">{subtitle(worktree)}</span>
				{status && status.modified > 0 && <span className="count modified">{status.modified}M</span>}
				{status && status.untracked > 0 && <span className="count untracked">{status.untracked}U</span>}
			</span>
		</button>
	);
}
