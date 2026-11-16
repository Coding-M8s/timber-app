import type { KeyboardEvent } from "react";
import { DONE_PRIMARY_NOTE } from "../done-format";
import { describeChanges, describeWorktreeSync, worktreeLabel } from "../format";
import { TAB_LABELS, tabAfterKey } from "../shell";
import { useAppState, useStore } from "../store/react";
import { WORKSPACE_TABS, type WorkspaceTab, isRunning, selectedWorktree } from "../store/state";
import { ChangesPanel } from "./ChangesPanel";
import { EditorProblemNote, OpenInEditorButton } from "./OpenInEditor";
import { SetupPrompt } from "./SetupPrompt";
import { TerminalPanel } from "./TerminalPanel";

const tabId = (tab: WorkspaceTab) => `tab-${tab}`;
const PANEL_ID = "workspace-panel";

export function Workspace() {
	const store = useStore();
	const state = useAppState();
	const selection = selectedWorktree(state);
	if (!selection) {
		// Before the first answer, and after a first load that failed, the sidebar says what is going on.
		const waiting = !state.loaded;
		const first = state.repositories.length === 0;
		return (
			<main className="workspace">
				<div className="empty">
					{!waiting && (
						<>
							<p className="empty-title">{first ? "No repository yet" : "No worktree to show"}</p>
							<p className="empty-text">
								{first
									? "Start by adding a Git repository. Its worktrees show here, and the app remembers it for next time. If it is new to Timber, the app offers to set it up."
									: "Select a worktree in the sidebar, or add another repository. The app remembers it for next time."}
							</p>
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
					<OpenInEditorButton repository={repository.path} worktree={worktree} />
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
				<EditorProblemNote />
			</header>
			<SetupPrompt repository={repository} />
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
			{state.tab === "workspace" ? (
				<div className="tabpanel workspace-panel" role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(state.tab)}>
					<TerminalPanel repository={repository} worktree={worktree} />
				</div>
			) : (
				<div className="tabpanel workspace-panel" role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(state.tab)}>
					<ChangesPanel repository={repository} worktree={worktree} />
				</div>
			)}
		</main>
	);
}
