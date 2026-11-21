import logoUrl from "../assets/logo.png";
import { worktreeLabel } from "../format";
import { paletteHint } from "../palette";
import { ISSUES_ROW_LABEL } from "../issue-board-format";
import { useAppState, useStore } from "../store/react";
import { chopsEnabled, finishedSessions, selectedWorktree, timberReady, waitingSessions } from "../store/state";
import { describeFinished, describeToVisit, describeWaiting, waitingHint } from "../waiting";
import { StatusGlyph } from "./StatusGlyph";
import { CHOPS_BUTTON_ID, CHOPS_BUTTON_LABEL, CHOPS_PANEL_ID, chopsButtonHint } from "../chops-panel-format";
import { toggleChopsPanel } from "./ChopsPanel";

export function TitleBar() {
	const store = useStore();
	const state = useAppState();
	const selection = selectedWorktree(state);
	const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
	const hint = paletteHint(mac);
	// Hidden while Timber is not ready, as the rest of the window is.
	const ready = timberReady(state);
	const waitingCount = ready ? waitingSessions(state).length : 0;
	const finishedCount = ready ? finishedSessions(state).length : 0;
	const waiting = describeWaiting(waitingCount);
	const finished = describeFinished(finishedCount);
	// While a repository's issues board shows, the title names it and the board instead of the selected worktree.
	const boardRepository = state.board === null ? null : state.repositories.find(repository => repository.path === state.board) ?? null;
	const repository = boardRepository ?? selection?.repository ?? null;
	const branch = boardRepository !== null ? ISSUES_ROW_LABEL : selection && worktreeLabel(selection.worktree);
	return (
		<header className="titlebar">
			<img className="titlebar-logo" src={logoUrl} alt="Timber" width={22} height={22} />
			{/* Long names are cut short here, so each part carries its whole name as a tooltip. */}
			<div className="breadcrumb">
				{repository
					? <span className="titlebar-repo" title={repository.name}>{repository.name}</span>
					: <span className="titlebar-repo">Timber</span>}
				{branch !== null && (
					<>
						<span className="titlebar-sep" aria-hidden="true">/</span>
						<span className="titlebar-branch" title={branch}>{branch}</span>
					</>
				)}
			</div>
			{/* Shows the next session that needs you, or that finished, as its shortcut does. Its words name it, each with its shape so color is not alone. */}
			{(waiting !== "" || finished !== "") && (
				<button type="button" className="titlebar-waiting" aria-label={describeToVisit(waitingCount, finishedCount)} title={waitingHint(mac)} onClick={() => store.jumpToWaiting()}>
					{waiting !== "" && (
						<span className="titlebar-waiting-part status-needs-you">
							<StatusGlyph status={{ kind: "needs-you", reason: null }} />
							{waiting}
						</span>
					)}
					{finished !== "" && (
						<span className="titlebar-waiting-part status-done">
							<StatusGlyph status={{ kind: "done" }} />
							{finished}
						</span>
					)}
				</button>
			)}
			{/* Shows or hides the chops panel, as its shortcut does. Gone, with the panel and the shortcut, while "Use chops" is off. */}
			{chopsEnabled(state) && (
				<button
					type="button"
					id={CHOPS_BUTTON_ID}
					className="titlebar-chops"
					aria-pressed={state.layout.chopsOpen}
					aria-controls={state.layout.chopsOpen ? CHOPS_PANEL_ID : undefined}
					title={chopsButtonHint(state.layout.chopsOpen, mac)}
					onClick={() => void toggleChopsPanel(store)}
				>
					<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
						<rect x="2.5" y="2.5" width="11" height="11" rx="2" />
						<path d="M10 2.5v11" />
					</svg>
					{CHOPS_BUTTON_LABEL}
				</button>
			)}
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
