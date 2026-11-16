import logoUrl from "../assets/logo.png";
import { worktreeLabel } from "../format";
import { PALETTE_HINT } from "../shell";
import { useAppState } from "../store/react";
import { selectedWorktree } from "../store/state";

export function TitleBar() {
	const selection = selectedWorktree(useAppState());
	const branch = selection && worktreeLabel(selection.worktree);
	return (
		<header className="titlebar">
			<img className="titlebar-logo" src={logoUrl} alt="Timber" width={22} height={22} />
			{/* Long names are cut short here, so each part carries its whole name as a tooltip. */}
			<div className="breadcrumb">
				{selection
					? <span className="titlebar-repo" title={selection.repository.name}>{selection.repository.name}</span>
					: <span className="titlebar-repo">Timber</span>}
				{branch !== null && (
					<>
						<span className="titlebar-sep" aria-hidden="true">/</span>
						<span className="titlebar-branch" title={branch}>{branch}</span>
					</>
				)}
			</div>
			{/* The palette is not built yet, so its button is disabled and says so. */}
			<button type="button" className="icon-button titlebar-palette" aria-label={PALETTE_HINT} title={PALETTE_HINT} disabled>
				<svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
					<circle cx="7" cy="7" r="4.25" />
					<path d="M10.2 10.2 13.5 13.5" />
				</svg>
			</button>
		</header>
	);
}
