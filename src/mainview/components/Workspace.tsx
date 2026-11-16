import type { KeyboardEvent } from "react";
import { DONE_PRIMARY_NOTE } from "../done-format";
import { describeChanges, describeWorktreeSync, worktreeLabel } from "../format";
import { TAB_EMPTY, TAB_LABELS, tabAfterKey } from "../shell";
import { useAppState, useStore } from "../store/react";
import { WORKSPACE_TABS, type WorkspaceTab, isRunning, selectedWorktree } from "../store/state";

const tabId = (tab: WorkspaceTab) => `tab-${tab}`;
const PANEL_ID = "workspace-panel";

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

	const { repository, worktree } = selection;
	const label = worktreeLabel(worktree);
	const changes = describeChanges(worktree);
	const sync = describeWorktreeSync(worktree);
	const empty = TAB_EMPTY[state.tab];

	// As in any tab list: the arrows, Home, and End move between tabs, and the tab reached shows at once.
	const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
		const next = tabAfterKey(state.tab, event.key);
		if (next === null) return;
		event.preventDefault();
		store.showTab(next);
		document.getElementById(tabId(next))?.focus();
	};

	return (
		<main className="workspace">
			<header className="workspace-header">
				<h1 className="workspace-title" title={label}>{label}</h1>
				<div className="workspace-meta">
					{sync && <span>{sync}</span>}
					<span>{changes}</span>
					<span className="path">{worktree.path}</span>
				</div>
				<div className="workspace-done">
					{/* Opens the Done dialog, which asks Timber for a preview. Nothing is removed before its Remove button. */}
					<button
						type="button"
						className="button"
						disabled={worktree.primary}
						title={worktree.primary ? DONE_PRIMARY_NOTE : "Remove this worktree, after a preview of what would be lost"}
						onClick={() => store.openDialog({ kind: "done-worktree", repository: repository.path, worktree: worktree.id })}
					>
						Done
					</button>
					{worktree.primary && <span className="workspace-done-note">{DONE_PRIMARY_NOTE}</span>}
				</div>
			</header>
			<div className="tabs" role="tablist" aria-label="Views of this worktree" onKeyDown={onTabKey}>
				{WORKSPACE_TABS.map(tab => (
					<button
						key={tab}
						type="button"
						role="tab"
						id={tabId(tab)}
						className={tab === state.tab ? "tab selected" : "tab"}
						aria-selected={tab === state.tab}
						aria-controls={PANEL_ID}
						// Only the tab that shows is a tab stop. The arrows reach the others.
						tabIndex={tab === state.tab ? 0 : -1}
						onClick={() => store.showTab(tab)}
					>
						{TAB_LABELS[tab]}
					</button>
				))}
			</div>
			{/* A tab stop of its own, because an empty state holds nothing else to focus. */}
			<div className="empty tabpanel" role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(state.tab)} tabIndex={0}>
				<p className="empty-title">{empty.title}</p>
				<p className="empty-text">{empty.text}</p>
			</div>
		</main>
	);
}
