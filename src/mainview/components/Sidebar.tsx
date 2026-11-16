import { useState } from "react";
import { REMOVE_REPOSITORY_HINT, TIMBER_LIST_FAILURE_TITLE, describeListNotice, describeReloadError, worktreeLabel } from "../format";
import { SETTINGS_LABEL, describeLayoutProblem, describeRepository } from "../shell";
import { useAppState, useStore } from "../store/react";
import { isRunning, runningSessionCount } from "../store/state";
import { OpenInEditorIconButton } from "./OpenInEditor";
import { SIDEBAR_ID } from "./SidebarResizer";
import { WorktreeRow } from "./WorktreeRow";

export function Sidebar() {
	const store = useStore();
	const state = useAppState();
	const { repositories, loaded } = state;
	const selectedId = state.selection?.worktree ?? null;
	const refreshing = isRunning(state, "reload-all");
	const failure = state.error && describeReloadError(state.error, repositories);
	const notice = state.notice && describeListNotice(state.notice, repositories);
	const adding = isRunning(state, "add-repository");
	const removing = (path: string) => state.operations.some(operation => operation.kind === "remove-repository" && operation.repository === path);
	const [filter, setFilter] = useState("");
	// Which groups are collapsed is part of the layout the store holds, so it is remembered between runs.
	const { collapsed } = state.layout;
	const layoutProblem = state.layoutProblem && describeLayoutProblem(state.layoutProblem);
	const query = filter.trim().toLowerCase();

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
				{groups.map(({ repository, matches }) => {
					// While filtering, a group opens exactly when it has a match.
					const open = query ? matches.length > 0 : !collapsed.includes(repository.path);
					return (
						<section key={repository.path} className="group" aria-label={repository.name}>
							<div className={repository.available ? "group-head" : "group-head unavailable"}>
								<button
									type="button"
									className="group-header"
									aria-expanded={open}
									title={describeRepository(repository)}
									onClick={() => store.toggleGroup(repository.path)}
								>
									<svg className={open ? "chevron open" : "chevron"} aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
										<path d="M3.5 2 6.5 5 3.5 8" />
									</svg>
									<span className="group-name">{repository.name}</span>
									{repository.available
										? <span className="group-count">{repository.worktrees.length}</span>
										: <span className="group-flag">unavailable</span>}
								</button>
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
							{open && repository.available && (
								<ul className="rows">
									{matches.map(worktree => (
										<li key={worktree.id}>
											<WorktreeRow
												worktree={worktree}
												selected={worktree.id === selectedId}
												onSelect={() => store.select(worktree.id)}
												runningSessions={runningSessionCount(state, worktree.id)}
												actions={<OpenInEditorIconButton repository={repository.path} worktree={worktree} />}
											/>
										</li>
									))}
								</ul>
							)}
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
