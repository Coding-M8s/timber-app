import { useEffect, useState } from "react";
import { ISSUE_LISTS, type IssueList } from "../../shared/issue-lists";
import type { SuggestedIssue } from "../../shared/issue-search";
import type { IssueTracker } from "../../shared/model";
import { CHECK_OUT_LABEL, allRefused, checkOutChoice } from "../check-out-format";
import { describeAgo } from "../fetch-format";
import { TRACKER_NAMES, describeOpenIssue, issueKeyLabel } from "../issue-format";
import {
	ISSUES_ROW_LABEL, LIST_LABELS, LIST_NOT_READ, NO_CURRENT_SPRINT, NO_TRACKER, START_WORK_LABEL, START_WORK_PLACEHOLDER,
	boardColumns, boardTrackerChoices, boardTrackerOption, describeEmptyList, describeHiddenList, describeListFailure,
	describeListSummary, describeTruncated, sprintLabel,
} from "../issue-board-format";
import { type BoardView, boardKey, boardView, emptyBoard } from "../store/issue-board";
import { useAppState, useStore } from "../store/react";

/** The view of one repository's board, as the store holds it now. */
function useBoard(repository: string): BoardView {
	const state = useAppState();
	return boardView(state.issueBoards[repository] ?? emptyBoard(), state.layout.issueLists[repository]);
}

/** The board's row in the sidebar, first in each repository. It shows the sprint's name once a read found one. */
export function IssuesRow({ repository }: { repository: string }) {
	const store = useStore();
	const state = useAppState();
	const view = useBoard(repository);
	const selected = state.board === repository;
	const found = view.list === "sprint" && view.good?.result.outcome === "found" ? view.good.result.sprint : null;
	const label = sprintLabel(found);
	return (
		<button
			type="button"
			className={selected ? "row issues-row selected" : "row issues-row"}
			aria-current={selected}
			title="The repository's issues: the current sprint, those assigned to you, and its open issues"
			onClick={() => store.openBoard(repository)}
		>
			<span className="row-line">
				<svg className="issues-row-icon" aria-hidden="true" width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.3">
					<rect x="1.5" y="1.5" width="10" height="10" rx="2" />
					<path d="M5 1.5v10M8 1.5v6" />
				</svg>
				<span className="row-name">{ISSUES_ROW_LABEL}</span>
				{label !== null && <span className="issues-row-sprint" title={label}>{label}</span>}
			</span>
		</button>
	);
}

/** A fresh "Read 2 minutes ago" without reading anything again: only the words are drawn again. */
function useNow(every = 30_000): number {
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = setInterval(() => setNow(Date.now()), every);
		return () => clearInterval(timer);
	}, [every]);
	return now;
}

function IssueCard({ issue, onOpen, onJump, onCheckOut }: { issue: SuggestedIssue; onOpen: () => void; onJump: (() => void) | null; onCheckOut: { open: () => void; title: string } | null }) {
	const unassigned = issue.assignee === null;
	return (
		<li className="issue-card">
			<div className="issue-card-line">
				<span className="issue-card-key">{issueKeyLabel(issue.tracker, issue.key)}</span>
				<span className={`issue-card-status ${issue.status.category}`}>{issue.status.name}</span>
				<button type="button" className="icon-button issue-card-open" aria-label={describeOpenIssue(issue.tracker, issue.key)} title={describeOpenIssue(issue.tracker, issue.key)} onClick={onOpen}>
					<svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round">
						<path d="M6.5 1.5h3v3M9.5 1.5L5 6M8 6.5v2.5a.5.5 0 0 1-.5.5h-6a.5.5 0 0 1-.5-.5v-6a.5.5 0 0 1 .5-.5H4" />
					</svg>
				</button>
			</div>
			<p className="issue-card-title">{issue.title}</p>
			<div className="issue-card-line">
				<span className={unassigned ? "issue-card-assignee unassigned" : "issue-card-assignee"}>{issue.assignee ?? "Unassigned"}</span>
				{issue.worktree !== null ? (
					<button
						type="button"
						className="issue-card-worktree"
						disabled={onJump === null}
						title={onJump === null ? `The worktree ${issue.worktree.path} is not in the list.` : `Show the worktree ${issue.worktree.branch ?? issue.worktree.path}`}
						onClick={onJump ?? undefined}
					>
						<svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
							<circle cx="2.5" cy="2" r="1.2" /><circle cx="2.5" cy="8" r="1.2" /><circle cx="7.5" cy="3.5" r="1.2" />
							<path d="M2.5 3.2v3.6M7.5 4.7c0 2-5 1.3-5 2.1" />
						</svg>
						<span className="issue-card-branch">{issue.worktree.branch ?? issue.worktree.path}</span>
					</button>
				) : onCheckOut !== null ? (
					// The issue has an open pull request and no worktree here: check that out instead of starting anew.
					<button type="button" className="issue-card-start issue-card-check-out" title={onCheckOut.title} onClick={onCheckOut.open}>{CHECK_OUT_LABEL}</button>
				) : (
					// A placeholder until starting work from the board is wired up (issue 156).
					<button type="button" className="issue-card-start" disabled title={START_WORK_PLACEHOLDER}>+ {START_WORK_LABEL}</button>
				)}
			</div>
		</li>
	);
}

function Quiet({ title, text, detail, command }: { title: string; text?: string | undefined; detail?: string | null | undefined; command?: string | null | undefined }) {
	return (
		<div className="board-quiet" role="status">
			<p className="board-quiet-title">{title}</p>
			{text && <p className="board-quiet-text">{text}</p>}
			{detail && <p className="board-quiet-text board-quiet-detail">{detail}</p>}
			{command && <code className="board-quiet-command">{command}</code>}
		</div>
	);
}

function Columns({ issues, list, tracker, truncated, onOpen, onJump, onCheckOut }: {
	issues: readonly SuggestedIssue[];
	list: IssueList;
	tracker: IssueTracker;
	truncated: boolean;
	onOpen: (issue: SuggestedIssue) => void;
	onJump: (issue: SuggestedIssue) => (() => void) | null;
	onCheckOut: (issue: SuggestedIssue) => { open: () => void; title: string } | null;
}) {
	const columns = boardColumns(issues, list, tracker);
	return (
		<>
			<div className="board-columns" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
				{columns.map(column => (
					<section key={column.id} className="board-column" aria-label={`${column.label}, ${column.issues.length}`}>
						<header className="board-column-head">
							<span className="board-column-name">{column.label}</span>
							<span className="board-column-count">{column.issues.length}</span>
							<span className="board-column-statuses" title={column.statuses.join(", ")}>{column.statuses.join(", ")}</span>
						</header>
						<ul className="board-cards">
							{column.issues.map(issue => <IssueCard key={issue.url} issue={issue} onOpen={() => onOpen(issue)} onJump={onJump(issue)} onCheckOut={onCheckOut(issue)} />)}
						</ul>
					</section>
				))}
			</div>
			{truncated && <p className="board-foot">{describeTruncated(list, tracker)}</p>}
		</>
	);
}

/** The issues board of one repository, in place of the workspace. */
export function IssuesBoard({ repository }: { repository: string }) {
	const store = useStore();
	const state = useAppState();
	const view = useBoard(repository);
	const board = state.issueBoards[repository] ?? emptyBoard();
	const now = useNow();
	const listed = state.repositories.find(candidate => candidate.path === repository);
	const { tracker, list, latest, good, reading, hidden } = view;
	const trackers = board.trackers;
	const choices = boardTrackerChoices(trackers);

	const jumpTo = (issue: SuggestedIssue) => {
		const path = issue.worktree?.path;
		const worktree = path === undefined ? undefined : listed?.worktrees.find(candidate => candidate.path === path);
		return worktree ? () => store.select(worktree.id) : null;
	};
	const openIssue = (issue: SuggestedIssue) => void store.openLink(issue.url);
	const githubRepository = trackers?.ok ? trackers.githubRepository : null;
	const checkOut = (issue: SuggestedIssue) => {
		const choice = checkOutChoice(issue, githubRepository);
		if (choice === null) return null;
		const title = allRefused(choice) ? "Its pull requests cannot be opened here: see why" : "Open the pull request's branch in a new worktree";
		return { open: () => store.openDialog({ kind: "check-out-pull-request", repository, issue }), title };
	};

	// The quiet word beside the title: the latest read failed, and the last good list stays on screen.
	let word: { text: string; title: string } | null = null;
	if (good !== null && latest !== null && latest !== good && tracker !== null) {
		if (latest.result.ok && latest.result.outcome === "failed") word = { text: describeListFailure(latest.result.reason, tracker).word, title: latest.result.diagnostic };
		else if (!latest.result.ok) word = { text: LIST_NOT_READ, title: latest.result.message };
	}

	let summary: string | null = null;
	if (good !== null && tracker !== null && list !== null) {
		summary = good.result.outcome === "found"
			? describeListSummary(list, tracker, good.result.sprint, good.result.issues.length, good.result.truncated)
			: list === "sprint" ? `No current sprint in ${TRACKER_NAMES[tracker]}` : describeListSummary(list, tracker, null, 0, false);
	}

	let body;
	if (tracker === null) {
		if (trackers === undefined) body = <BoardLoading />;
		else if (!trackers.ok) body = <Quiet title="The issue trackers could not be read." detail={trackers.message} />;
		else body = <Quiet title={NO_TRACKER.title} text={NO_TRACKER.text} command="timber setup" />;
	} else if (latest !== null && !latest.result.ok && latest.result.unsupported) {
		const version = state.timber?.known && state.timber.status.state === "ready" ? state.timber.status.version : null;
		body = <Quiet title="The issues board needs a Timber built from its main branch." text={version === null ? undefined : `This Timber is ${version}. No Timber release has timber __app-issues yet.`} />;
	} else if (list === null) {
		const reason = latest?.result.ok && latest.result.outcome === "failed" ? latest.result.diagnostic : null;
		body = <Quiet title={`No list is set up for ${TRACKER_NAMES[tracker]}.`} detail={reason} />;
	} else if (good !== null) {
		if (good.result.outcome === "none") {
			body = list === "sprint" ? <Quiet title={NO_CURRENT_SPRINT.title} text={NO_CURRENT_SPRINT.text} /> : <Quiet {...describeEmptyList(list, tracker)} />;
		} else if (good.result.issues.length === 0) {
			body = <Quiet {...describeEmptyList(list, tracker)} />;
		} else {
			body = <Columns issues={good.result.issues} list={list} tracker={tracker} truncated={good.result.truncated} onOpen={openIssue} onJump={jumpTo} onCheckOut={checkOut} />;
		}
	} else if (latest !== null && latest.result.ok && latest.result.outcome === "failed") {
		const failure = describeListFailure(latest.result.reason, tracker);
		body = <Quiet title={failure.title} text={failure.text} detail={latest.result.diagnostic} command={failure.command} />;
	} else if (latest !== null && !latest.result.ok) {
		body = <Quiet title="Timber could not list the issues." detail={latest.result.message} />;
	} else {
		body = <BoardLoading />;
	}

	// Each list that is not set up, in Timber's words on what adds it.
	const hints = tracker === null || list === null ? [] : hidden.map(one => {
		const result = board.latest[boardKey(tracker, one)]?.result;
		return describeHiddenList(one, tracker, result?.ok && result.outcome === "failed" ? result.diagnostic : "");
	});
	return (
		<main className="workspace issues-board" aria-label={`Issues of ${listed?.name ?? repository}`}>
			<header className="board-header">
				<div className="board-title-line">
					<h1 className="workspace-title">{ISSUES_ROW_LABEL}</h1>
					{word && <span className="board-word" title={word.title}>{word.text}</span>}
					<span className="board-read">{reading ? "Reading" : latest !== null ? `Read ${describeAgo(latest.at, now)}` : ""}</span>
					<button type="button" className="button quiet board-refresh" disabled={reading} title="Read the list again" onClick={() => void store.refreshBoard(repository)}>Refresh</button>
				</div>
				{summary !== null && <p className="board-summary">{summary}</p>}
				{tracker !== null && (
					<div className="board-pickers">
						{list !== null && (
							<div className="board-lists" role="group" aria-label="List">
								{ISSUE_LISTS.filter(one => !hidden.includes(one)).map(one => (
									<button key={one} type="button" className={one === list ? "board-list selected" : "board-list"} aria-pressed={one === list} onClick={() => void store.pickBoardList(repository, one)}>
										{LIST_LABELS[one]}
									</button>
								))}
							</div>
						)}
						{choices.length > 0 && (
							<label className="board-tracker">
								<span>Tracker</span>
								<select className="field-input" value={tracker} onChange={event => void store.pickBoardTracker(repository, event.target.value as IssueTracker)}>
									{choices.map(choice => <option key={choice} value={choice}>{boardTrackerOption(trackers, choice)}</option>)}
								</select>
							</label>
						)}
					</div>
				)}
				{hints.map(hint => <p key={hint} className="board-hint">{hint}</p>)}
			</header>
			<div className="board-body">{body}</div>
		</main>
	);
}

function BoardLoading() {
	return (
		<div className="board-loading" role="status" aria-label="Reading the issues">
			{[0, 1, 2].map(column => (
				<div key={column} className="board-loading-column">
					<span className="board-loading-bar" />
					<span className="board-loading-card" />
					{column < 2 && <span className="board-loading-card" />}
				</div>
			))}
		</div>
	);
}
