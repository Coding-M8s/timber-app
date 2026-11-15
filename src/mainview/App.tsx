import { useCallback, useEffect, useMemo, useState } from "react";
import type { Engine } from "../shared/engine";
import type { Repository } from "../shared/model";
import logoUrl from "./assets/logo.png";
import { Sidebar } from "./components/Sidebar";
import { Workspace } from "./components/Workspace";
import { worktreeLabel } from "./format";

type LoadState =
	| { phase: "loading" }
	| { phase: "ready"; repositories: Repository[] }
	| { phase: "failed"; message: string };

export function App({ engine }: { engine: Engine }) {
	const [state, setState] = useState<LoadState>({ phase: "loading" });
	const [refreshing, setRefreshing] = useState(false);
	const [selectedPath, setSelectedPath] = useState<string | null>(null);

	const load = useCallback(async () => {
		setRefreshing(true);
		try {
			setState({ phase: "ready", repositories: await engine.listRepositories() });
		} catch (error) {
			setState({ phase: "failed", message: error instanceof Error ? error.message : String(error) });
		} finally {
			setRefreshing(false);
		}
	}, [engine]);

	useEffect(() => {
		void load();
	}, [load]);

	const repositories = state.phase === "ready" ? state.repositories : [];
	const selection = useMemo(() => {
		for (const repository of repositories) {
			const worktree = repository.worktrees.find(candidate => candidate.path === selectedPath);
			if (worktree) return { repository, worktree };
		}
		const repository = repositories[0];
		const worktree = repository?.worktrees[0];
		return repository && worktree ? { repository, worktree } : null;
	}, [repositories, selectedPath]);

	return (
		<div className="app">
			<header className="titlebar">
				<img className="titlebar-logo" src={logoUrl} alt="Timber" width={22} height={22} />
				<span className="titlebar-repo">{selection ? selection.repository.name : "Timber"}</span>
				{selection && (
					<>
						<span className="titlebar-sep" aria-hidden="true">/</span>
						<span className="titlebar-branch">{worktreeLabel(selection.worktree)}</span>
					</>
				)}
			</header>
			<div className="body">
				<Sidebar
					repositories={repositories}
					selectedPath={selection?.worktree.path ?? null}
					onSelect={setSelectedPath}
					onRefresh={() => void load()}
					refreshing={refreshing}
					notice={state.phase === "loading" ? "Reading worktrees" : state.phase === "failed" ? state.message : null}
				/>
				<Workspace selection={selection} />
			</div>
		</div>
	);
}
