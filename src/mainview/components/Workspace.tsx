import type { KeyboardEvent } from "react";
import { BEING_REMOVED_REASON, DONE_PRIMARY_NOTE } from "../done-format";
import { REBASE_CONTROL_TITLE, REBASE_FOLDER_MISSING } from "../rebase-format";
import { describeSavedBase } from "../base-format";
import { describeChanges, describeWorktreeSync, worktreeLabel } from "../format";
import { OPEN_PULL_REQUEST, describeOpenPullRequest, describePullRequestMarkers, describeWorktreePullRequestProblem } from "../pull-request-format";
import { pullRequestOf } from "../../shared/pull-requests";
import { TAB_LABELS, tabAfterKey } from "../shell";
import { useAppState, useStore } from "../store/react";
import { WORKSPACE_TABS, type WorkspaceTab, isBeingRemoved, isRunning, selectedWorktree } from "../store/state";
import { ChangesPanel } from "./ChangesPanel";
import { PullRequestPanel } from "./PullRequestPanel";
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
	const base = describeSavedBase(worktree.base);
	const pullRequests = state.pullRequests[repository.path];
	const pullRequest = pullRequestOf(pullRequests, worktree.path);
	const pullMarkers = describePullRequestMarkers(pullRequest);
	const pullProblem = describeWorktreePullRequestProblem(pullRequests, pullRequest);
	// While Timber removes the worktree, nothing new starts in it.
	const removing = isBeingRemoved(state, repository.path, worktree.path);

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
					{base && <span className={base.warning ? "saved-base-warning" : undefined} title={base.sentence}>{base.text}</span>}
					{pullMarkers.length > 0 && (
						// The same markers as the row, each with its sentence; the visible words are the short form.
						<span className="workspace-pull" role="group" aria-label={pullMarkers.map(marker => marker.tooltip).join(" ")}>
							{pullMarkers.map(marker => (
								<span key={marker.kind} className={marker.kind === "checks-failing" || marker.kind === "review-changes" ? "pull-marker failing" : "pull-marker"} title={marker.tooltip} aria-hidden="true">{marker.text}</span>
							))}
						</span>
					)}
					{pullProblem && <span className="pull-problem" title={pullProblem.tooltip} aria-label={pullProblem.tooltip}>{pullProblem.text}</span>}
					<span className="path">{worktree.path}</span>
				</div>
				<div className="workspace-done">
					<OpenInEditorButton repository={repository.path} worktree={worktree} />
					{pullRequest?.outcome === "found" && (
						<button type="button" className="button" title={describeOpenPullRequest(pullRequest.pullRequest)} onClick={() => void store.openLink(pullRequest.pullRequest.url)}>
							{OPEN_PULL_REQUEST}
						</button>
					)}
					{/* Opens the Rebase dialog, which shows the command. Nothing runs before its own button. */}
					<button
						type="button"
						className="button"
						disabled={!worktree.pathExists || removing}
						title={removing ? BEING_REMOVED_REASON : worktree.pathExists ? REBASE_CONTROL_TITLE : REBASE_FOLDER_MISSING}
						onClick={() => store.openDialog({ kind: "rebase-worktree", repository: repository.path, worktree: worktree.id })}
					>
						Rebase
					</button>
					{/* Opens the Done dialog, which asks Timber for a preview. Nothing is removed before its Remove button. */}
					<button
						type="button"
						className="button"
						disabled={worktree.primary || removing}
						title={worktree.primary ? DONE_PRIMARY_NOTE : removing ? BEING_REMOVED_REASON : "Remove this worktree, after a preview of what would be lost"}
						onClick={() => store.openDialog({ kind: "done-worktree", repository: repository.path, worktree: worktree.id })}
					>
						Done
					</button>
					{worktree.primary && <span className="workspace-done-note">{DONE_PRIMARY_NOTE}</span>}
					{removing && <span className="workspace-done-note" role="status">{BEING_REMOVED_REASON}</span>}
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
			<div className="tabpanel workspace-panel" role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(state.tab)}>
				{state.tab === "workspace" && <TerminalPanel repository={repository} worktree={worktree} />}
				{state.tab === "changes" && <ChangesPanel repository={repository} worktree={worktree} />}
				{state.tab === "pull-request" && <PullRequestPanel repository={repository} worktree={worktree} />}
			</div>
		</main>
	);
}
