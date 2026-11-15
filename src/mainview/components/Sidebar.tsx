import { useState } from "react";
import { REMOVE_REPOSITORY_HINT, describeListNotice, describeReloadError, worktreeLabel } from "../format";
import { useAppState, useStore } from "../store/react";
import { isRunning } from "../store/state";
import { WorktreeRow } from "./WorktreeRow";

export function Sidebar() {
	const store = useStore();
	const state = useAppState();
	const { repositories, loaded } = state;
	const selectedPath = state.selection?.worktree ?? null;
	const refreshing = isRunning(state, "reload-all");
	const failure = state.error && describeReloadError(state.error, repositories);
	const notice = state.notice && describeListNotice(state.notice, repositories);
	const adding = isRunning(state, "add-repository");
	const removing = (path: string) => state.operations.some(operation => operation.kind === "remove-repository" && operation.repository === path);
	const [filter, setFilter] = useState("");
	const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
	const query = filter.trim().toLowerCase();

	const toggle = (path: string) => setCollapsed(previous => {
		const next = new Set(previous);
		if (!next.delete(path)) next.add(path);
		return next;
	});

	const groups = repositories.map(repository => ({
		repository,
		matches: repository.worktrees.filter(worktree => !query || worktreeLabel(worktree).toLowerCase().includes(query)),
	}));
	const nothingMatches = query !== "" && groups.every(group => group.matches.length === 0);

	return (
		<aside className="sidebar" aria-label="Worktrees">
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
					const open = query ? matches.length > 0 : !collapsed.has(repository.path);
					return (
						<section key={repository.path} className="group" aria-label={repository.name}>
							<div className={repository.available ? "group-head" : "group-head unavailable"}>
								<button
									type="button"
									className="group-header"
									aria-expanded={open}
									title={repository.path}
									onClick={() => toggle(repository.path)}
								>
									<svg className={open ? "chevron open" : "chevron"} aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
										<path d="M3.5 2 6.5 5 3.5 8" />
									</svg>
									<span className="group-name">{repository.name}</span>
									{repository.available
										? <span className="group-count">{repository.worktrees.length}</span>
										: <span className="group-flag">unavailable</span>}
								</button>
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
							{open && repository.available && (
								<ul className="rows">
									{matches.map(worktree => (
										<li key={worktree.path}>
											<WorktreeRow
												worktree={worktree}
												selected={worktree.path === selectedPath}
												onSelect={() => store.select(worktree.path)}
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
		</aside>
	);
}
