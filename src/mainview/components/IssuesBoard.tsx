import { useEffect, useState } from "react";
import { type IssueList, isSprintList, listOf, togglesOf } from "../../shared/issue-lists";
import type { SuggestedIssue } from "../../shared/issue-search";
import type { IssueTracker } from "../../shared/model";
import { CHECK_OUT_LABEL, allRefused, checkOutChoice } from "../check-out-format";
import { describeAgo } from "../fetch-format";
import { TRACKER_NAMES, describeOpenIssue, issueKeyLabel } from "../issue-format";
import {
	ISSUES_ROW_LABEL, LIST_NOT_READ, NO_CURRENT_SPRINT, NO_TRACKER, OPEN_TRACKING_SETTINGS, TOGGLE_LABELS,
	boardColumns, boardTrackerChoices, boardTrackerOption, describeBlockedToggle, describeEmptyList, describeHiddenList, describeListFailure,
	describeListSummary, describePartial, describeTruncated, offersTrackingSettings, shownList, sprintLabel,
} from "../issue-board-format";
import { OPEN_WORKTREE_LABEL, START_WORK_LABEL, startWorkChoice } from "../start-work-format";
import { type BoardView, boardToggles, boardView, emptyBoard, hiddenDiagnostic } from "../store/issue-board";
import { useAppState, useStore } from "../store/react";
import { wantTerminalFocus } from "../terminal-focus";

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
	const found = view.list !== null && isSprintList(view.list) && view.good?.result.outcome === "found" ? view.good.result.sprint : null;
	const label = sprintLabel(found);
	return (
		<button
			type="button"
			className={selected ? "row issues-row selected" : "row issues-row"}
			aria-current={selected}
			title="The repository's issues: its open issues, the current sprint, those assigned to you, or yours in the sprint"
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

/** A card's action: what it does, or why it cannot, as its tooltip. */
interface CardAction {
	open: (() => void) | null;
	title: string;
}

function IssueCard({ issue, onOpen, onJump, onCheckOut, onStart }: {
	issue: SuggestedIssue;
	onOpen: () => void;
	onJump: (() => void) | null;
	onCheckOut: CardAction | null;
	onStart: CardAction | null;
}) {
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
			<div className="issue-card-line issue-card-actions">
				<span className={unassigned ? "issue-card-assignee unassigned" : "issue-card-assignee"}>{issue.assignee ?? "Unassigned"}</span>
				{issue.worktree !== null ? (
					<button
						type="button"
						className="issue-card-worktree"
						disabled={onJump === null}
						title={onJump === null ? `The worktree ${issue.worktree.path} is not in the list.` : `Open the worktree ${issue.worktree.branch ?? issue.worktree.path}`}
						onClick={onJump ?? undefined}
					>
						<svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
							<circle cx="2.5" cy="2" r="1.2" /><circle cx="2.5" cy="8" r="1.2" /><circle cx="7.5" cy="3.5" r="1.2" />
							<path d="M2.5 3.2v3.6M7.5 4.7c0 2-5 1.3-5 2.1" />
						</svg>
						<span className="issue-card-label">{OPEN_WORKTREE_LABEL}</span>
					</button>
				) : (
					<>
						{onCheckOut !== null && (
							// The issue has an open pull request and no worktree here: it can be checked out for review.
							<button type="button" className="issue-card-start issue-card-check-out" title={onCheckOut.title} onClick={onCheckOut.open ?? undefined}>{CHECK_OUT_LABEL}</button>
						)}
						{onStart !== null && (
							<button type="button" className="issue-card-start issue-card-start-work" disabled={onStart.open === null} title={onStart.title} onClick={onStart.open ?? undefined}>+ {START_WORK_LABEL}</button>
						)}
					</>
				)}
			</div>
		</li>
	);
}

function Quiet({ title, text, detail, command, onSettings }: {
	title: string;
	text?: string | undefined;
	detail?: string | null | undefined;
	command?: string | null | undefined;
	/** Opens the repository's Issue tracking settings, where what is missing is set. */
	onSettings?: (() => void) | null | undefined;
}) {
	// The button sits beside the status, not in it, so a screen reader announcing the status does not read it as text.
	const status = (
		<div className="board-quiet" role="status">
			<p className="board-quiet-title">{title}</p>
			{text && <p className="board-quiet-text">{text}</p>}
			{detail && <p className="board-quiet-text board-quiet-detail">{detail}</p>}
			{command && <code className="board-quiet-command">{command}</code>}
		</div>
	);
	if (!onSettings) return status;
	return (
		<div className="board-quiet-with-action">
			{status}
			<button type="button" className="button quiet board-settings" onClick={onSettings}>{OPEN_TRACKING_SETTINGS}</button>
		</div>
	);
}

function Columns({ issues, list, tracker, truncated, partial, onOpen, onJump, onCheckOut, onStart }: {
	issues: readonly SuggestedIssue[];
	list: IssueList;
	tracker: IssueTracker;
	truncated: boolean;
	partial: boolean;
	onOpen: (issue: SuggestedIssue) => void;
	onJump: (issue: SuggestedIssue) => (() => void) | null;
	onCheckOut: (issue: SuggestedIssue) => CardAction | null;
	onStart: (issue: SuggestedIssue) => CardAction | null;
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
							{column.issues.map(issue => <IssueCard key={issue.url} issue={issue} onOpen={() => onOpen(issue)} onJump={onJump(issue)} onCheckOut={onCheckOut(issue)} onStart={onStart(issue)} />)}
						</ul>
					</section>
				))}
			</div>
			{truncated && <p className="board-foot">{describeTruncated(list, tracker)}</p>}
			{partial && <p className="board-foot">{describePartial(tracker)}</p>}
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
		return worktree ? () => {
			// Choosing a worktree from the board puts the keyboard in its shown session, as its row does.
			if (state.tab === "workspace") wantTerminalFocus(worktree.id);
			store.select(worktree.id);
		} : null;
	};
	const openIssue = (issue: SuggestedIssue) => void store.openLink(issue.url);
	const githubRepository = trackers?.ok ? trackers.githubRepository : null;
	const checkOut = (issue: SuggestedIssue) => {
		const choice = checkOutChoice(issue, githubRepository);
		if (choice === null) return null;
		const title = allRefused(choice) ? "Its pull requests cannot be opened here: see why" : "Open the pull request's branch in a new worktree";
		return { open: () => store.openDialog({ kind: "check-out-pull-request", repository, issue }), title };
	};
	const startWork = (issue: SuggestedIssue): CardAction | null => {
		const choice = startWorkChoice(issue, githubRepository);
		if (choice === null) return null;
		if (!choice.ok) return { open: null, title: choice.reason };
		return { open: () => store.openDialog({ kind: "start-work", repository, issue }), title: "Create a worktree for this issue, linked to it, and assign it to you" };
	};

	const openTrackingSettings = () => store.openDialog({ kind: "settings", section: "repository", repository, group: "tracking" });

	// The quiet word beside the title: the latest read failed, and the last good list stays on screen.
	let word: { text: string; title: string } | null = null;
	if (good !== null && latest !== null && latest !== good && tracker !== null) {
		if (latest.result.ok && latest.result.outcome === "failed") word = { text: describeListFailure(latest.result.reason, tracker).word, title: latest.result.diagnostic };
		else if (!latest.result.ok) word = { text: LIST_NOT_READ, title: latest.result.message };
	}

	let summary: string | null = null;
	if (good !== null && tracker !== null && list !== null) {
		summary = good.result.outcome === "found"
			? describeListSummary(list, tracker, good.result.sprint, good.result.issues.length, good.result.truncated, good.result.partial === true)
			: isSprintList(list) ? `No current sprint in ${TRACKER_NAMES[tracker]}` : describeListSummary(list, tracker, null, 0, false);
	}

	let body;
	// Whether the body offers Issue tracking itself, so the hints do not offer it a second time.
	let bodyLinks = false;
	if (tracker === null) {
		if (trackers === undefined) body = <BoardLoading />;
		else if (!trackers.ok) body = <Quiet title="The issue trackers could not be read." detail={trackers.message} />;
		else body = <Quiet title={NO_TRACKER.title} text={NO_TRACKER.text} onSettings={openTrackingSettings} />;
	} else if (latest !== null && !latest.result.ok && latest.result.unsupported) {
		const version = state.timber?.known && state.timber.status.state === "ready" ? state.timber.status.version : null;
		body = <Quiet title="The issues board needs a Timber built from its main branch." text={version === null ? undefined : `This Timber is ${version}. No Timber release has timber __app-issues yet.`} />;
	} else if (list === null) {
		const reason = latest?.result.ok && latest.result.outcome === "failed" ? latest.result.diagnostic : null;
		body = <Quiet title={`No list is set up for ${TRACKER_NAMES[tracker]}.`} detail={reason} onSettings={openTrackingSettings} />;
		bodyLinks = true;
	} else if (good !== null) {
		if (good.result.outcome === "none") {
			body = isSprintList(list) ? <Quiet title={NO_CURRENT_SPRINT.title} text={NO_CURRENT_SPRINT.text} /> : <Quiet {...describeEmptyList(list, tracker)} />;
		} else if (good.result.issues.length === 0) {
			const empty = describeEmptyList(list, tracker);
			// Joined from two lists by a Timber without --assigned: an empty board may still be missing some of mine.
			body = <Quiet title={empty.title} text={good.result.partial ? describePartial(tracker) : empty.text} />;
		} else {
			body = <Columns issues={good.result.issues} list={list} tracker={tracker} truncated={good.result.truncated} partial={good.result.partial === true} onOpen={openIssue} onJump={jumpTo} onCheckOut={checkOut} onStart={startWork} />;
		}
	} else if (latest !== null && latest.result.ok && latest.result.outcome === "failed") {
		const failure = describeListFailure(latest.result.reason, tracker);
		bodyLinks = offersTrackingSettings(latest.result.reason);
		body = <Quiet title={failure.title} text={failure.text} detail={latest.result.diagnostic} command={failure.command} onSettings={bodyLinks ? openTrackingSettings : null} />;
	} else if (latest !== null && !latest.result.ok) {
		body = <Quiet title="Timber could not list the issues." detail={latest.result.message} />;
	} else {
		body = <BoardLoading />;
	}

	// Each list that is not set up, in Timber's words on what adds it. The sprint's hint stands for both sprint lists.
	const hints = tracker === null ? [] : hidden.filter(one => one !== "my-sprint").map(one => ({
		list: one,
		id: `board-hint-${one}`,
		text: describeHiddenList(one, tracker, hiddenDiagnostic(board, tracker, one)),
	}));
	// The toggles show the list shown, or, when none is set up, the remembered one. One that would show a list that is not set up is disabled, and points at that list's hint.
	const toggles = tracker === null ? null : boardToggles(list ?? shownList(state.layout.issueLists[repository], []) ?? "sprint", hidden);
	const hintOf = (blocked: IssueList) => hints.find(hint => hint.list === (isSprintList(blocked) ? "sprint" : blocked))?.id;
	const flip = (which: "sprint" | "assigned") => {
		if (list === null) return;
		const now = togglesOf(list);
		void store.pickBoardList(repository, listOf({ ...now, [which]: !now[which] }));
	};
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
						{toggles !== null && (
							<div className="board-toggles" role="group" aria-label="Filter">
								{(["sprint", "assigned"] as const).map(which => {
									const toggle = toggles[which];
									const blocked = list === null || toggle.blockedBy !== null;
									const why = toggle.blockedBy !== null ? describeBlockedToggle(toggle.on, toggle.blockedBy, tracker!) : undefined;
									return (
										<button
											key={which}
											type="button"
											className={toggle.on ? "board-toggle on" : "board-toggle"}
											aria-pressed={toggle.on}
											disabled={blocked}
											title={why}
											aria-describedby={toggle.blockedBy !== null ? hintOf(toggle.blockedBy) : undefined}
											onClick={() => flip(which)}
										>
											<svg className="board-toggle-mark" aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
												<rect x="1" y="1" width="10" height="10" rx="2.5" />
												{toggle.on && <path d="M3.5 6.2l1.8 1.8 3.2-3.6" strokeLinecap="round" strokeLinejoin="round" />}
											</svg>
											{TOGGLE_LABELS[which]}
										</button>
									);
								})}
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
				{hints.map(hint => <p key={hint.id} id={hint.id} className="board-hint">{hint.text}</p>)}
				{hints.length > 0 && !bodyLinks && (
					<div><button type="button" className="button quiet board-settings" onClick={openTrackingSettings}>{OPEN_TRACKING_SETTINGS}</button></div>
				)}
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
