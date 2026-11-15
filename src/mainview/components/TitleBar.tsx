import logoUrl from "../assets/logo.png";
import { worktreeLabel } from "../format";
import { useAppState } from "../store/react";
import { selectedWorktree } from "../store/state";

export function TitleBar() {
	const selection = selectedWorktree(useAppState());
	return (
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
	);
}
