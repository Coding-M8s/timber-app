import { type PointerEvent, useId, useMemo, useRef, useState } from "react";
import { describeBackupsProblem } from "../backup-format";
import { describeFetchAction, describeFetchMarker } from "../fetch-format";
import { describeRepositoryPullRequestProblem } from "../pull-request-format";
import { pullRequestOf } from "../../shared/pull-requests";
import { REMOVE_REPOSITORY_HINT, TIMBER_LIST_FAILURE_TITLE, describeListNotice, describeReloadError, worktreeLabel } from "../format";
import { SETTINGS_LABEL, describeLayoutProblem, describeRepository } from "../shell";
import { DRAG_THRESHOLD, MOVE_REPOSITORY_HINT, MOVE_REPOSITORY_SHORTCUTS, dropIndex, moveStep } from "../repository-drag";
import { useAppState, useStore } from "../store/react";
import { hasStatusMark, mostUrgent, shownStatus, summarizeStatuses } from "../../shared/session-status";
import { isRunning, removalAt, sessionsOf } from "../store/state";
import { describeRemovalFailed } from "../done-format";
import { clashMarksOf, describePortClash } from "../ports-format";
import { OpenInEditorIconButton } from "./OpenInEditor";
import { wantTerminalFocus } from "../terminal-focus";
import { SIDEBAR_ID } from "./SidebarResizer";
import { BackupsSection } from "./BackupsSection";
import { WorktreeRow } from "./WorktreeRow";
import { worktreeMenuChoice } from "../worktree-menu-format";

export function Sidebar() {
	const store = useStore();
	const state = useAppState();
	// Rows that share a host port with another worktree get a warning (see ../ports-format.ts).
	const clashMarks = useMemo(() => clashMarksOf(state.portClashes, state.repositories), [state.portClashes, state.repositories]);
	const { repositories, loaded } = state;
	const selectedId = state.selection?.worktree ?? null;
	const refreshing = isRunning(state, "reload-all");
	const failure = state.error && describeReloadError(state.error, repositories);
	const notice = state.notice && describeListNotice(state.notice, repositories);
	const adding = isRunning(state, "add-repository");
	const removing = (path: string) => state.operations.some(operation => operation.kind === "remove-repository" && operation.repository === path);
	const [filter, setFilter] = useState("");
	const idBase = useId();
	// Which groups are collapsed is part of the layout the store holds, so it is remembered between runs.
	const { collapsed } = state.layout;
	const layoutProblem = state.layoutProblem && describeLayoutProblem(state.layoutProblem);
	const query = filter.trim().toLowerCase();
	const now = Date.now();
	const fetchAsked = (path: string) => state.operations.some(operation => operation.kind === "fetch-repository" && operation.repository === path);

	// A press on a header that has not moved far enough to be a drag yet, or the drag it became.
	const press = useRef<{ path: string; pointerId: number; startY: number; dragging: boolean } | null>(null);
	const [drag, setDrag] = useState<{ path: string; index: number } | null>(null);
	// The click that ends a drag must not also open or close the group.
	const dragEnded = useRef(false);
	const groupElements = useRef(new Map<string, HTMLElement>());
	const headerButtons = useRef(new Map<string, HTMLButtonElement>());

	/** The identity the list has now for the worktree at this path, which is what the Done dialog is opened with. */
	const listedIdAt = (repositoryPath: string, path: string) =>
		repositories.find(repository => repository.path === repositoryPath)?.worktrees.find(worktree => worktree.path === path)?.id ?? null;

	const othersThan = (path: string) => repositories.filter(repository => repository.path !== path);
	const indexAt = (path: string, y: number) => dropIndex(othersThan(path).map(repository => {
		const box = groupElements.current.get(repository.path)?.getBoundingClientRect();
		return box ? box.top + box.height / 2 : Number.NEGATIVE_INFINITY;
	}), y);

	function onHeaderPointerDown(path: string, event: PointerEvent<HTMLButtonElement>) {
		if (event.button !== 0 || repositories.length < 2) return;
		press.current = { path, pointerId: event.pointerId, startY: event.clientY, dragging: false };
	}

	function onHeaderPointerMove(event: PointerEvent<HTMLButtonElement>) {
		const current = press.current;
		if (!current || current.pointerId !== event.pointerId) return;
		if (!current.dragging) {
			if (Math.abs(event.clientY - current.startY) < DRAG_THRESHOLD) return;
			current.dragging = true;
			event.currentTarget.setPointerCapture(event.pointerId);
		}
		const index = indexAt(current.path, event.clientY);
		if (drag?.path !== current.path || drag.index !== index) setDrag({ path: current.path, index });
	}

	function onHeaderPointerUp(event: PointerEvent<HTMLButtonElement>) {
		const current = press.current;
		if (!current || current.pointerId !== event.pointerId) return;
		press.current = null;
		setDrag(null);
		if (!current.dragging) return;
		dragEnded.current = true;
		void store.moveRepository(current.path, indexAt(current.path, event.clientY));
	}

	function onHeaderPointerCancel() {
		press.current = null;
		setDrag(null);
	}

	function moveByKey(path: string, index: number, step: -1 | 1) {
		const target = index + step;
		if (target < 0 || target >= repositories.length) return;
		void store.moveRepository(path, target);
		// The header was moved in the page, so give it the focus back.
		requestAnimationFrame(() => headerButtons.current.get(path)?.focus());
	}

	// Where the line that shows the drop goes: above the group the dragged one would land before, or below the last.
	const dropMark = (() => {
		if (!drag) return null;
		const others = othersThan(drag.path);
		if (drag.index === repositories.findIndex(repository => repository.path === drag.path)) return null;
		return drag.index < others.length
			? { path: others[drag.index]!.path, side: "before" as const }
			: { path: others[others.length - 1]!.path, side: "after" as const };
	})();

	const groups = repositories.map(repository => ({
		repository,
		matches: repository.worktrees.filter(worktree => !query || worktreeLabel(worktree).toLowerCase().includes(query)),
	}));
	const nothingMatches = query !== "" && groups.every(group => group.matches.length === 0);

	return (
		<aside id={SIDEBAR_ID} className="sidebar" aria-label="Worktrees">
			<div className="sidebar-tools">
				<input
					className="filter"
					type="search"
					aria-label="Filter worktrees"
					placeholder="Filter worktrees"
					value={filter}
					onChange={event => setFilter(event.target.value)}
				/>
				<button
					type="button"
					className="icon-button"
					aria-label="Refresh worktrees"
					title="Refresh worktrees"
					disabled={refreshing}
					onClick={() => void store.refresh()}
				>
					<svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
						<path d="M13 8a5 5 0 1 1-1.5-3.6" />
						<path d="M13 2.6v2.9h-2.9" />
					</svg>
				</button>
			</div>

			{!loaded && !failure && <p className="sidebar-note">Reading worktrees</p>}
			{failure && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">{failure.title}</p>
					<p className="sidebar-error-text">{failure.text}</p>
					{loaded && <p className="sidebar-error-text">Showing what was read last.</p>}
				</div>
			)}

			<div className="groups">
				{groups.map(({ repository, matches }, index) => {
					// While filtering, a group opens exactly when it has a match.
					const open = query ? matches.length > 0 : !collapsed.includes(repository.path);
					const fetch = state.fetches[repository.path];
					const fetching = fetch?.fetching === true || fetchAsked(repository.path);
					const fetchMarker = repository.available ? describeFetchMarker(fetch, now) : null;
					const fetchMarkerId = `${idBase}-fetch-${index}`;
					const pullRequests = state.pullRequests[repository.path];
					const pullProblem = repository.available ? describeRepositoryPullRequestProblem(pullRequests) : null;
					const pullProblemId = `${idBase}-pulls-${index}`;
					const backupProblem = repository.available ? describeBackupsProblem(state.backups[repository.path]) : null;
					const backupProblemId = `${idBase}-backups-${index}`;
					// Only while the group is collapsed, its agents' states are summed up beside its name, Needs you first.
					const statuses = open ? [] : state.terminals
						.filter(session => session.repository === repository.path && hasStatusMark(session))
						.map(shownStatus);
					const summary = summarizeStatuses(statuses);
					const summaryId = `${idBase}-summary-${index}`;
					const describedBy = [fetchMarker ? fetchMarkerId : "", pullProblem ? pullProblemId : "", backupProblem ? backupProblemId : "", summary ? summaryId : ""].filter(Boolean).join(" ");
					const fetchLabel = describeFetchAction(repository.name, fetching ? { repository: repository.path, fetching: true, lastFetched: null, failure: null } : fetch, now);
					return (
						<section
							key={repository.path}
							ref={element => {
								if (element) groupElements.current.set(repository.path, element);
								else groupElements.current.delete(repository.path);
							}}
							className={[
								"group",
								drag?.path === repository.path ? "dragging" : "",
								dropMark?.path === repository.path ? `drop-${dropMark.side}` : "",
							].filter(Boolean).join(" ")}
							aria-label={repository.name}
							data-repository={repository.path}
						>
							<div className={repository.available ? "group-head" : "group-head unavailable"}>
								<button
									type="button"
									className="group-header"
									aria-expanded={open}
									aria-describedby={describedBy === "" ? undefined : describedBy}
									aria-keyshortcuts={repositories.length > 1 ? MOVE_REPOSITORY_SHORTCUTS : undefined}
									title={repositories.length > 1 ? `${describeRepository(repository)}. ${MOVE_REPOSITORY_HINT}` : describeRepository(repository)}
									ref={element => {
										if (element) headerButtons.current.set(repository.path, element);
										else headerButtons.current.delete(repository.path);
									}}
									onPointerDown={event => onHeaderPointerDown(repository.path, event)}
									onPointerMove={onHeaderPointerMove}
									onPointerUp={onHeaderPointerUp}
									onPointerCancel={onHeaderPointerCancel}
									onKeyDown={event => {
										const step = moveStep(event);
										if (step === 0) return;
										event.preventDefault();
										moveByKey(repository.path, index, step);
									}}
									onClick={() => {
										if (dragEnded.current) {
											dragEnded.current = false;
											return;
										}
										store.toggleGroup(repository.path);
									}}
								>
									<svg className={open ? "chevron open" : "chevron"} aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
										<path d="M3.5 2 6.5 5 3.5 8" />
									</svg>
									<span className="group-name">{repository.name}</span>
									{summary && (
										// Its words are the button's description too.
										<span className={`group-status status-${mostUrgent(statuses)}`} aria-hidden="true">{summary}</span>
									)}
									{fetchMarker && (
										// Quiet: a word beside the name, never a dialog. Its sentences are the button's description.
										<span className="group-flag fetch-failed" title={fetchMarker.tooltip} aria-hidden="true">{fetchMarker.text}</span>
									)}
									{pullProblem && (
										// As quiet as a failed fetch: one lookup answers for the whole repository, so it is said here once.
										<span className="group-flag pulls-failed" title={pullProblem.tooltip} aria-hidden="true">{pullProblem.text}</span>
									)}
									{backupProblem && (
										// As quiet as the others: one read answers for the whole repository.
										<span className="group-flag backups-failed" title={backupProblem.tooltip} aria-hidden="true">{backupProblem.text}</span>
									)}
									{repository.available
										? <span className="group-count">{repository.worktrees.length}</span>
										: <span className="group-flag">unavailable</span>}
								</button>
								{fetchMarker && <span id={fetchMarkerId} hidden>{fetchMarker.tooltip}</span>}
								{pullProblem && <span id={pullProblemId} hidden>{pullProblem.tooltip}</span>}
								{backupProblem && <span id={backupProblemId} hidden>{backupProblem.tooltip}</span>}
								{summary && <span id={summaryId} hidden>{`Agents: ${summary}.`}</span>}
								{repository.available && (
									<button
										type="button"
										className={fetching ? "icon-button group-fetch fetching" : "icon-button group-fetch"}
										aria-label={fetchLabel}
										title={fetchLabel}
										aria-busy={fetching}
										aria-disabled={fetching}
										onClick={() => {
											if (!fetching) void store.fetchNow(repository.path);
										}}
									>
										<svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
											<path d="M8 2v8M4.5 6.5 8 10l3.5-3.5" />
											<path d="M2.5 11v2.5h11V11" />
										</svg>
									</button>
								)}
								{repository.available && (
									<button
										type="button"
										className="icon-button group-new"
										aria-label={`New worktree in ${repository.name}`}
										title={`New worktree in ${repository.name}`}
										onClick={() => store.openDialog({ kind: "new-worktree", repository: repository.path })}
									>
										<svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
											<path d="M5.5 1.5v8M1.5 5.5h8" />
										</svg>
									</button>
								)}
								<button
									type="button"
									className="icon-button group-remove"
									aria-label={`Remove ${repository.name} from the list`}
									title={`Remove ${repository.name}. ${REMOVE_REPOSITORY_HINT}`}
									disabled={removing(repository.path)}
									onClick={() => void store.removeRepository(repository.path)}
								>
									<svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
										<path d="M2.5 2.5l6 6M8.5 2.5l-6 6" />
									</svg>
								</button>
							</div>
							{repository.available && repository.failure !== null && (
								<div className="sidebar-error group-failure" role="alert">
									<p className="sidebar-error-title">{TIMBER_LIST_FAILURE_TITLE}</p>
									<p className="sidebar-error-text">{repository.failure}</p>
									<p className="sidebar-error-text">
										{repository.worktrees.length > 0 ? "Showing the worktrees that were listed last." : "No worktrees are shown."}
									</p>
								</div>
							)}
							{state.removals
								// A removal whose row does not show, because the worktree left the list, the group is collapsed, or the filter
								// hides it, is said here in its group instead. The toast that announced it points here.
								.filter(removal => removal.repository === repository.path && !(open && repository.available && matches.some(worktree => worktree.path === removal.worktree.path)))
								.map(removal => {
									const label = worktreeLabel(removal.worktree);
									if (removal.status.kind === "running") {
										return <p key={removal.worktree.path} className="sidebar-note removal-running" title={removal.worktree.path}>Removing {label}</p>;
									}
									return (
										<div key={removal.worktree.path} className="sidebar-error group-failure removal-failure">
											<p className="sidebar-error-title">{describeRemovalFailed(label, false)}</p>
											{removal.status.gone && <p className="sidebar-error-text">The worktree is no longer in the list. What is left of it, such as its branch, is what the list and Git show now.</p>}
											<p className="sidebar-error-text path">{removal.worktree.path}</p>
											<div className="removal-failure-actions">
												<button
													type="button"
													className="text-button"
													aria-haspopup="dialog"
													aria-label={`Details: ${describeRemovalFailed(label, false)}`}
													onClick={() => store.openDialog({ kind: "done-worktree", repository: repository.path, worktree: listedIdAt(repository.path, removal.worktree.path) ?? removal.worktree.id })}
												>
													Details
												</button>
												<button type="button" className="text-button" aria-label={`Dismiss: ${describeRemovalFailed(label, false)}`} onClick={() => store.dismissRemoval(repository.path, removal.worktree.path)}>Dismiss</button>
											</div>
										</div>
									);
								})}
							{open && repository.available && (
								<ul className="rows">
									{matches.map(worktree => {
										const removal = removalAt(state, repository.path, worktree.path);
										return (
										<li key={worktree.id}>
											<WorktreeRow
												worktree={worktree}
												selected={worktree.id === selectedId}
												onSelect={() => {
													// Choosing a worktree, by click, Enter, or Space, puts the keyboard in its shown session, as a chip does.
													if (state.tab === "workspace") wantTerminalFocus(worktree.id);
													store.select(worktree.id);
												}}
												pullRequest={pullRequestOf(pullRequests, worktree.path)}
												issue={state.issues[worktree.id]}
												removal={removal?.status ?? null}
												sessions={sessionsOf(state, worktree.id)}
												portClash={describePortClash(clashMarks.get(worktree.path))}
												actions={(
													<>
														{removal?.status.kind === "failed" && (
															<button
																type="button"
																className="text-button row-removal-details"
																aria-haspopup="dialog"
																aria-label={`Details: ${describeRemovalFailed(worktreeLabel(worktree), false)}`}
																title={`What Timber said when it did not finish removing ${worktreeLabel(worktree)}`}
																onClick={() => store.openDialog({ kind: "done-worktree", repository: repository.path, worktree: worktree.id })}
															>
																Details
															</button>
														)}
														<OpenInEditorIconButton repository={repository.path} worktree={worktree} />
													</>
												)}
												onMenuChoice={id => {
													// For this row's worktree, not the selected one, and without selecting it.
													const request = worktreeMenuChoice(repository.path, worktree, id, removal?.status.kind === "running");
													if (request) store.openDialog(request);
												}}
											/>
										</li>
										);
									})}
								</ul>
							)}
							{/* While a filter is typed, only worktrees are searched, so backups step aside. */}
							{open && repository.available && query === "" && <BackupsSection repository={repository.path} list={state.backups[repository.path]} now={now} />}
							{open && !repository.available && (
								<div className="group-missing">
									<p className="group-missing-text">The folder is missing, or it is no longer a Git repository.</p>
									<p className="group-missing-text path">{repository.path}</p>
									<p className="group-missing-text">{REMOVE_REPOSITORY_HINT}</p>
									<button
										type="button"
										className="text-button"
										disabled={removing(repository.path)}
										onClick={() => void store.removeRepository(repository.path)}
									>
										Remove
									</button>
								</div>
							)}
						</section>
					);
				})}
			</div>

			{nothingMatches && <p className="sidebar-note">No worktree matches that filter.</p>}

			{loaded && (
				<div className="sidebar-foot">
					{notice && (
						<div className={notice.problem ? "sidebar-error" : "sidebar-error info"} role={notice.problem ? "alert" : "status"}>
							<p className="sidebar-error-title">{notice.title}</p>
							<p className="sidebar-error-text">{notice.text}</p>
							<button type="button" className="text-button" onClick={() => store.dismissNotice()}>Dismiss</button>
						</div>
					)}
					<button type="button" className="add-repository" disabled={adding} onClick={() => void store.addRepository()}>
						<svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
							<path d="M5.5 1.5v8M1.5 5.5h8" />
						</svg>
						{adding ? "Choosing a folder" : "Add repository"}
					</button>
				</div>
			)}

			{/* Fixed at the bottom, whatever the list above holds. */}
			<div className="sidebar-bottom">
				{layoutProblem && (
					<div className="sidebar-error layout-problem" role="alert">
						<p className="sidebar-error-title">{layoutProblem.title}</p>
						<p className="sidebar-error-text">{layoutProblem.text}</p>
						<p className="sidebar-error-text">{layoutProblem.consequence}</p>
						<button type="button" className="text-button" onClick={() => store.dismissLayoutProblem()}>Dismiss</button>
					</div>
				)}
				<button
					type="button"
					className="icon-button sidebar-settings"
					aria-label={SETTINGS_LABEL}
					title={SETTINGS_LABEL}
					aria-haspopup="dialog"
					onClick={() => store.openDialog({ kind: "settings" })}
				>
					<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
						<circle cx="8" cy="8" r="4.3" />
						<circle cx="8" cy="8" r="1.5" />
						<path strokeWidth="2.2" d="M8 1.3v2.4M8 12.3v2.4M1.3 8h2.4M12.3 8h2.4M3.26 3.26l1.7 1.7M11.04 11.04l1.7 1.7M12.74 3.26l-1.7 1.7M4.96 11.04l-1.7 1.7" />
					</svg>
				</button>
			</div>
		</aside>
	);
}
