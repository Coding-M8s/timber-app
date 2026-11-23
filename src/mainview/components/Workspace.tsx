import { Fragment, type KeyboardEvent } from "react";
import { BEING_REMOVED_REASON } from "../done-format";
import { workspaceKindLabel } from "../workspace-actions-format";
import { describeSavedBase } from "../base-format";
import { describeChanges, describeWorktreeSync, worktreeLabel } from "../format";
import { describeOpenPullRequest, describePullRequestMarkers, describeWorktreePullRequestProblem } from "../pull-request-format";
import { pullRequestOf } from "../../shared/pull-requests";
import { TAB_LABELS, tabAfterKey, visibleTabs } from "../shell";
import { fileTabLabel } from "../file-view-format";
import { FileViewer } from "./FileViewer";
import { useAppState, useStore } from "../store/react";
import { type WorkspaceTab, isBeingRemoved, isRunning, selectedWorktree } from "../store/state";
import { DiffTab } from "./DiffTab";
import { DiffLayoutSwitch } from "./DiffView";
import { diffTabLabel, diffTabTitle } from "../changes-panel-format";
import { IssueHeaderLink, issueOf } from "./IssueSummary";
import { IssuesBoard } from "./IssuesBoard";
import { PortsItem } from "./PortsItem";
import { PullRequestPanel } from "./PullRequestPanel";
import { EditorProblemNote, OpenInEditorButton, OpenInEditorReason } from "./OpenInEditor";
import { WorkspaceMore } from "./WorkspaceMore";
import { SetupPrompt } from "./SetupPrompt";
import { TerminalPanel } from "./TerminalPanel";

const tabId = (tab: WorkspaceTab) => `tab-${tab}`;
const PANEL_ID = "workspace-panel";

export function Workspace() {
	const store = useStore();
	const state = useAppState();
	const selection = selectedWorktree(state);
	// A repository's issues board shows in place of the selected worktree, whose sessions keep running.
	if (state.board !== null && state.repositories.some(repository => repository.path === state.board)) {
		return <IssuesBoard key={state.board} repository={state.board} />;
	}
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
	const base = describeSavedBase(worktree.base, worktree.baseCounts);
	const issue = issueOf(state, worktree);
	const pullRequests = state.pullRequests[repository.path];
	const pullRequest = pullRequestOf(pullRequests, worktree.path);
	const pullHost = pullRequests?.ok ? pullRequests.host : undefined;
	const pullMarkers = describePullRequestMarkers(pullRequest, pullHost);
	const pullUrl = pullRequest?.outcome === "found" ? pullRequest.pullRequest.url : null;
	const pullOpenTitle = pullRequest?.outcome === "found" ? describeOpenPullRequest(pullRequest.pullRequest, pullHost) : null;
	const kind = workspaceKindLabel(worktree);
	const pullProblem = describeWorktreePullRequestProblem(pullRequests, pullRequest);
	// While Timber removes the worktree, nothing new starts in it.
	const removing = isBeingRemoved(state, repository.path, worktree.path);
	const file = state.files[worktree.id];
	const diff = state.diffs[worktree.id];
	const tabs = visibleTabs(file !== undefined, diff !== undefined);

	// As in any tab list: the arrows, Home, and End move between tabs, and the tab reached shows at once.
	const onTabKey = (event: KeyboardEvent<HTMLDivElement>) => {
		const next = tabAfterKey(state.tab, event.key, tabs);
		if (next === null) return;
		event.preventDefault();
		store.showTab(next);
		document.getElementById(tabId(next))?.focus();
	};

	return (
		<main className="workspace">
			<header className="workspace-header">
				{/* One action bar on the title line: Open in editor, then More with Rebase (or Pull, for a primary checkout whose base is its upstream) and Done. Each shows its command before it runs. */}
				<div className="workspace-title-line">
					<h1 className="workspace-title" title={label}>{label}</h1>
					{kind !== null && <span className="workspace-kind">{kind}</span>}
					{removing && <span className="workspace-kind" role="status" title={BEING_REMOVED_REASON}>Removing</span>}
					<div className="workspace-actions">
						<OpenInEditorButton repository={repository.path} worktree={worktree} />
						<WorkspaceMore repository={repository} worktree={worktree} removing={removing} />
					</div>
				</div>
				<div className="workspace-meta">
					{sync && <span>{sync}</span>}
					<span>{changes}</span>
					{base && <span className={base.warning ? "saved-base-warning" : undefined} title={base.sentence}>{base.text}</span>}
					{issue && <IssueHeaderLink issue={issue} />}
					{pullMarkers.length > 0 && (
						// The same markers as the row, each with its sentence; the visible words are the short form.
						<span className="workspace-pull" role="group" aria-label={pullMarkers.map(marker => marker.tooltip).join(" ")}>
							{pullMarkers.map(marker =>
								// The pull request's own marker is the link that opens it, as the issue's is.
								marker.kind === "pull-request" && pullUrl !== null && pullOpenTitle !== null ? (
									<button key={marker.kind} type="button" className="issue-link pull-link" title={`${marker.tooltip} ${pullOpenTitle}.`} aria-label={`${marker.tooltip} ${pullOpenTitle}.`} onClick={() => void store.openLink(pullUrl)}>{marker.text}</button>
								) : (
									<span key={marker.kind} className={marker.kind === "checks-failing" || marker.kind === "review-changes" ? "pull-marker failing" : "pull-marker"} title={marker.tooltip} aria-hidden="true">{marker.text}</span>
								),
							)}
						</span>
					)}
					{pullProblem && <span className="pull-problem" title={pullProblem.tooltip} aria-label={pullProblem.tooltip}>{pullProblem.text}</span>}
					{worktree.pathExists && <PortsItem repository={repository} worktree={worktree} />}
					<span className="path">{worktree.path}</span>
				</div>
				<OpenInEditorReason repository={repository.path} worktree={worktree} />
				<EditorProblemNote />
			</header>
			<SetupPrompt repository={repository} />
			<div className="tabs-row">
				<div className="tabs" role="tablist" aria-label="Views of this worktree" onKeyDown={onTabKey}>
					{tabs.map(tab => (
						<Fragment key={tab}>
							<button
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
								{tab === "file"
									? <span title={file?.path}>{fileTabLabel(file)}</span>
									: tab === "diff" && diff
										? (
											<span title={diffTabTitle(diff.file)}>
												<span className="tab-kind" aria-hidden="true">diff</span>
												<span className="visually-hidden">Diff of </span>
												{diffTabLabel(diff.file)}
											</span>
										)
										: TAB_LABELS[tab]}
							</button>
							{/* Beside the tab, not inside it: a button may not hold another. The diff's and the viewer's own Close reach it by keyboard. */}
							{tab === "diff" && diff && (
								<button type="button" className="tab-close" tabIndex={-1} aria-label={`Close the diff of ${diffTabLabel(diff.file)}`} title={`Close the diff of ${diff.file.path}`} onClick={() => store.closeDiff(worktree.id)}>
									<span aria-hidden="true">×</span>
								</button>
							)}
							{tab === "file" && file && (
								<button type="button" className="tab-close" tabIndex={-1} aria-label={`Close ${fileTabLabel(file)}`} title={`Close ${file.path}`} onClick={() => store.closeFile(worktree.id)}>
									<span aria-hidden="true">×</span>
								</button>
							)}
						</Fragment>
					))}
				</div>
				{/* Beside the tabs, not among them: a tab list holds only tabs. */}
				{state.tab === "diff" && diff && <DiffLayoutSwitch />}
			</div>
			<div className="tabpanel workspace-panel" role="tabpanel" id={PANEL_ID} aria-labelledby={tabId(state.tab)}>
				{state.tab === "workspace" && <TerminalPanel repository={repository} worktree={worktree} />}
				{state.tab === "pull-request" && <PullRequestPanel repository={repository} worktree={worktree} />}
				{state.tab === "diff" && diff && <DiffTab key={worktree.id} repository={repository} worktree={worktree} />}
				{state.tab === "file" && file && <FileViewer key={`${worktree.id} ${file.path}`} repository={repository.path} worktree={worktree} view={file} />}
			</div>
		</main>
	);
}
