import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { describeBackupsProblem } from "../backup-format";
import { describeFetchAction, describeFetchMarker } from "../fetch-format";
import { describeRepositoryPullRequestProblem } from "../pull-request-format";
import { pullRequestOf } from "../../shared/pull-requests";
import type { Repository, Worktree } from "../../shared/model";
import { REMOVE_REPOSITORY_HINT, TIMBER_LIST_FAILURE_TITLE, worktreeLabel } from "../format";
import { describeRepository } from "../shell";
import { MOVE_REPOSITORY_HINT, MOVE_REPOSITORY_SHORTCUTS } from "../repository-drag";
import { mostUrgent, summarizeStatuses } from "../../shared/session-status";
import { unseenStatuses } from "../seen-status";
import { type AppState, isBeingRemoved, removalAt, sessionsOf } from "../store/state";
import type { AppStore } from "../store/store";
import { describeRemovalFailed } from "../done-format";
import { type PortClashMark, describePortClash } from "../ports-format";
import { cleanUpUnavailableReason, describeCleanUpButton, mergedCandidates } from "../clean-up-format";
import { OpenInEditorIconButton } from "./OpenInEditor";
import { wantTerminalFocus } from "../terminal-focus";
import { BackupsSection } from "./BackupsSection";
import { WorktreeRow } from "./WorktreeRow";
import { IssuesRow } from "./IssuesBoard";
import { WORKTREE_MENU_SHORTCUTS, worktreeMenuChoice } from "../worktree-menu-format";
import { WorktreeMenu } from "./WorktreeMenu";
import { ARENA_BETA_NOTE, BETA, describeArenaHeader, groupArenaRows, newMenuChoice, newMenuItems } from "../arena-format";

export interface RepositorySectionProps {
	state: AppState;
	store: AppStore;
	repository: Repository;
	/** The worktrees that match the filter, all of them when none is typed. */
	matches: readonly Worktree[];
	/** Whether the section shows its worktrees: not collapsed, or matching while a filter is typed. */
	open: boolean;
	/** The filter, trimmed and in lower case. */
	query: string;
	now: number;
	/** What the ids that tie the header to its descriptions start with, and the place of the section, so they are unique. */
	idBase: string;
	index: number;
	/** Classes beside `group`, such as the drag marks. */
	marks: readonly string[];
	sectionRef: Ref<HTMLElement>;
	/** Whether the header says it can be moved with the keys. */
	movable: boolean;
	/** The header button's own ref and handlers: dragging, keys, and the click that collapses it. */
	header: Pick<ButtonHTMLAttributes<HTMLButtonElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerCancel" | "onKeyDown" | "onClick"> & { ref: Ref<HTMLButtonElement> };
	/** Whether a fetch of it was asked for and has not answered yet. */
	fetchAsked: boolean;
	/** Whether it is being forgotten. */
	removing: boolean;
	/** The rows that share a host port with another worktree, by worktree path (see ../ports-format.ts). */
	clashMarks: ReadonlyMap<string, readonly PortClashMark[]>;
	/** Where the menu of the "+" is open, a new worktree or a new arena, or null while it is closed. */
	newMenuAt: { left: number; top: number } | null;
	newButtonRef: Ref<HTMLButtonElement>;
	/** Open the menu of the "+" there, or close it when it is open or `at` is null. `backToButton` gives the keyboard back to the "+". */
	onNewMenu: (at: { left: number; top: number } | null, backToButton?: boolean) => void;
	/** The More button, last in the header. */
	more: ReactNode;
	/** A right-click on the header row, which opens the same menu as More. */
	onHeadContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
	/** The identity the list has now for the worktree at this path, which is what the Done dialog is opened with. */
	listedIdAt: (path: string) => string | null;
	selectedId: string | null;
}

/**
 * One repository's section of the sidebar: its header with its controls, and
 * below it its worktrees, backups, and what went wrong. A plain function of
 * its props, with no hooks of its own, so the sidebar draws it in place.
 */
export function RepositorySection({ state, store, repository, matches, open, query, now, idBase, index, marks, sectionRef, movable, header, fetchAsked, removing, clashMarks, newMenuAt, newButtonRef, onNewMenu, more, onHeadContextMenu, listedIdAt, selectedId }: RepositorySectionProps) {
	const fetch = state.fetches[repository.path];
	const fetching = fetch?.fetching === true || fetchAsked;
	const fetchMarker = repository.available ? describeFetchMarker(fetch, now) : null;
	const fetchMarkerId = `${idBase}-fetch-${index}`;
	const pullRequests = state.pullRequests[repository.path];
	const pullProblem = repository.available ? describeRepositoryPullRequestProblem(pullRequests) : null;
	// The merged worktrees Clean up merged would preview, less those a removal has taken already.
	const cleanUpCount = cleanUpUnavailableReason(repository, pullRequests) === null
		? mergedCandidates(repository, pullRequests).filter(worktree => !isBeingRemoved(state, repository.path, worktree.path)).length
		: 0;
	const pullProblemId = `${idBase}-pulls-${index}`;
	const backupProblem = repository.available ? describeBackupsProblem(state.backups[repository.path]) : null;
	const backupProblemId = `${idBase}-backups-${index}`;
	// Only while the group is collapsed, its agents' states are summed up beside its name, Needs you first. Seen ones are left out.
	// A session whose task needs you, or reported an error, counts as that (`alertStatus`), so it is as easy to see as the agent itself.
	const statuses = open ? [] : unseenStatuses(state.terminals.filter(session => session.repository === repository.path), state.seenStatuses);
	const summary = summarizeStatuses(statuses);
	const summaryId = `${idBase}-summary-${index}`;
	const describedBy = [fetchMarker ? fetchMarkerId : "", pullProblem ? pullProblemId : "", backupProblem ? backupProblemId : "", summary ? summaryId : ""].filter(Boolean).join(" ");
	const fetchLabel = describeFetchAction(repository.name, fetching ? { repository: repository.path, fetching: true, lastFetched: null, failure: null } : fetch, now);
	return (
		<section
			ref={sectionRef}
			className={["group", ...marks].join(" ")}
			aria-label={repository.name}
			data-repository={repository.path}
		>
			<div className={repository.available ? "group-head" : "group-head unavailable"} onContextMenu={onHeadContextMenu}>
				<button
					type="button"
					className="group-header"
					aria-expanded={open}
					aria-describedby={describedBy === "" ? undefined : describedBy}
					aria-keyshortcuts={movable ? `${MOVE_REPOSITORY_SHORTCUTS} ${WORKTREE_MENU_SHORTCUTS}` : WORKTREE_MENU_SHORTCUTS}
					title={movable ? `${describeRepository(repository)}. ${MOVE_REPOSITORY_HINT}` : describeRepository(repository)}
					{...header}
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
				{cleanUpCount > 0 && (
					// Shown only while there is something to clean up, so it is visible without pointing at the header.
					<button
						type="button"
						className="icon-button group-clean-up"
						aria-haspopup="dialog"
						aria-label={describeCleanUpButton(repository.name, cleanUpCount)}
						title={describeCleanUpButton(repository.name, cleanUpCount)}
						onClick={() => store.openDialog({ kind: "clean-up-merged", repository: repository.path })}
					>
						<svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
							<path d="M2.5 4.5h11M6 4.5V2.5h4v2M4 4.5l.7 9h6.6l.7-9" />
							<path d="M6.5 9l1.2 1.2L10 8" />
						</svg>
						<span className="group-clean-up-count" aria-hidden="true">{cleanUpCount}</span>
					</button>
				)}
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
						aria-label={`New in ${repository.name}`}
						title={`New worktree or arena in ${repository.name}`}
						aria-haspopup="menu"
						aria-expanded={newMenuAt !== null}
						ref={newButtonRef}
						onClick={event => {
							const box = event.currentTarget.getBoundingClientRect();
							onNewMenu({ left: box.left, top: box.bottom });
						}}
					>
						<svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
							<path d="M5.5 1.5v8M1.5 5.5h8" />
						</svg>
					</button>
				)}
				{newMenuAt && (
					<WorktreeMenu
						label={`New in ${repository.name}`}
						items={newMenuItems(state.arenas[repository.path])}
						at={newMenuAt}
						onClose={backToButton => onNewMenu(null, backToButton)}
						onChoose={id => {
							const request = newMenuChoice(repository.path, id, state.arenas[repository.path]);
							if (request) store.openDialog(request);
						}}
					/>
				)}
				{more}
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
					if (removal.status.kind === "waiting") {
						return <p key={removal.worktree.path} className="sidebar-note removal-running" title={removal.worktree.path}>Waiting to remove {label}</p>;
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
									onClick={() => store.openDialog({ kind: "done-worktree", repository: repository.path, worktree: listedIdAt(removal.worktree.path) ?? removal.worktree.id })}
								>
									Details
								</button>
								<button type="button" className="text-button" aria-label={`Dismiss: ${describeRemovalFailed(label, false)}`} onClick={() => store.dismissRemoval(repository.path, removal.worktree.path)}>Dismiss</button>
							</div>
						</div>
					);
				})}
			{open && repository.available && (() => {
				// Attempts sit together under their arena, matched by path as Timber lists them; the rest as before.
				const grouped = groupArenaRows(matches, state.arenas[repository.path]);
				const row = (worktree: Worktree, label?: string) => {
					const removal = removalAt(state, repository.path, worktree.path);
					return (
					<li key={worktree.id}>
						<WorktreeRow
							worktree={worktree}
							label={label}
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
							seen={state.seenStatuses}
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
								const request = worktreeMenuChoice(repository.path, worktree, id, isBeingRemoved(state, repository.path, worktree.path));
								if (request) store.openDialog(request);
							}}
						/>
					</li>
					);
				};
				return (
					<>
						<ul className="rows">
							{/* The board comes first in each repository. While a filter is typed, only worktrees are searched, so it steps aside. */}
							{query === "" && <li><IssuesRow repository={repository.path} /></li>}
							{grouped.plain.map(worktree => row(worktree))}
						</ul>
						{grouped.arenas.map(arena => {
							const header = describeArenaHeader(arena);
							return (
								<section key={arena.name} className="arena-rows" aria-label={header.title}>
									<button
										type="button"
										className="arena-head"
										aria-haspopup="dialog"
										title={`Compare the attempts of ${arena.name} and keep one. ${ARENA_BETA_NOTE}`}
										onClick={() => store.openDialog({ kind: "arena-compare", repository: repository.path, arena: arena.name })}
									>
										<span className="arena-name">{header.title}</span>
										<span className="arena-beta">{BETA}</span>
										<span className="arena-detail">{header.detail}</span>
										<span className="arena-compare-label">Compare</span>
									</button>
									<ul className="rows">{arena.rows.map(({ worktree, attempt }) => row(worktree, attempt.label))}</ul>
								</section>
							);
						})}
					</>
				);
			})()}
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
						disabled={removing}
						onClick={() => void store.removeRepository(repository.path)}
					>
						Remove
					</button>
				</div>
			)}
		</section>
	);
}
