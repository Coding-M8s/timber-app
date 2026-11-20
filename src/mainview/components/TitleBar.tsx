import logoUrl from "../assets/logo.png";
import { worktreeLabel } from "../format";
import { paletteHint } from "../palette";
import { useAppState, useStore } from "../store/react";
import { selectedWorktree } from "../store/state";

export function TitleBar() {
	const store = useStore();
	const selection = selectedWorktree(useAppState());
	const hint = paletteHint(typeof navigator !== "undefined" && /Mac/.test(navigator.platform));
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
			{/* Opens the palette, as its shortcut does. The tooltip names the shortcut for this platform. */}
			<button type="button" className="icon-button titlebar-palette" aria-label={hint} title={hint} aria-haspopup="dialog" onClick={() => store.openPalette()}>
				<svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
					<circle cx="7" cy="7" r="4.25" />
					<path d="M10.2 10.2 13.5 13.5" />
				</svg>
			</button>
		</header>
	);
}
