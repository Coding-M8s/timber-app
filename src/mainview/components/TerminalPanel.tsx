import { useEffect, useRef } from "react";
import type { Repository, Worktree } from "../../shared/model";
import type { TerminalSession } from "../../shared/terminal";
import { useAppState, useStore } from "../store/react";
import { terminalFor } from "../store/state";
import { closeTerminalLabel, describeTerminalState, shellName, terminalHint } from "../terminal-format";

/** The drawn terminals load with xterm.js, the first time one shows, and stay loaded. */
type Views = typeof import("../terminal-view");
let views: Views | null = null;
let loading: Promise<Views> | null = null;
function loadViews(): Promise<Views> {
	loading ??= import("../terminal-view").then(module => (views = module));
	return loading;
}

/** How long a pane's size must rest before the terminal follows it. */
const RESIZE_MILLISECONDS = 50;

const isMac = () => typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/** Roughly how many cells fit in an element, for 13 pixel text at 1.2 line height. 80 by 24 when it has no size. */
function estimateTerminalSize(element: HTMLElement | null): { cols: number; rows: number } {
	const width = element?.clientWidth ?? 0;
	const height = element?.clientHeight ?? 0;
	if (width === 0 || height === 0) return { cols: 80, rows: 24 };
	// The session bar takes about 34 pixels above the terminal.
	return { cols: Math.max(20, Math.floor((width - 16) / 7.8)), rows: Math.max(5, Math.floor((height - 50) / 15.6)) };
}

export const FOLDER_MISSING_TERMINAL = "The worktree's folder is missing, so a terminal cannot start there.";

/**
 * Lets go of the drawn terminal of every session that is gone. It draws
 * nothing. Drawn terminals outlive their panes, so that a session keeps its
 * screen while another worktree shows.
 */
export function TerminalViewKeeper() {
	const { terminals } = useAppState();
	useEffect(() => {
		views?.keepTerminalViews(new Set(terminals.map(session => session.id)));
	}, [terminals]);
	return null;
}

/** Where a session's terminal is drawn. It borrows the session's drawn terminal while it shows. */
function TerminalScreen({ session }: { session: TerminalSession }) {
	const store = useStore();
	const place = useRef<HTMLDivElement>(null);
	const running = session.state.kind === "running";

	useEffect(() => {
		const container = place.current;
		if (!container) return;
		let gone = false;
		let cleanup = () => {};
		void loadViews().then(module => {
			// A session closed while xterm.js loaded must not get a drawn terminal again.
			if (gone || !store.getState().terminals.some(candidate => candidate.id === session.id)) return;
			const view = module.terminalView(store, session.id);
			view.attach(container);
			// Only take the keyboard when nothing else has it, such as right after Open terminal. Moving through the sidebar keeps it there.
			const active = document.activeElement;
			if (active === null || active === document.body || container.closest(".workspace")?.contains(active)) view.focus();
			// The pane changes size with the window, the sidebar, and the header's notes. A drag would resize on every frame, so wait for it to rest.
			let timer: ReturnType<typeof setTimeout> | undefined;
			const observer = new ResizeObserver(() => {
				clearTimeout(timer);
				timer = setTimeout(() => view.fit(), RESIZE_MILLISECONDS);
			});
			observer.observe(container);
			cleanup = () => {
				clearTimeout(timer);
				observer.disconnect();
				view.detach();
			};
		});
		return () => {
			gone = true;
			cleanup();
		};
	}, [store, session.id]);

	useEffect(() => {
		let gone = false;
		void loadViews().then(module => {
			if (!gone && store.getState().terminals.some(candidate => candidate.id === session.id)) module.terminalView(store, session.id).setInput(running);
		});
		return () => {
			gone = true;
		};
	}, [store, session.id, running]);

	return <div className="terminal-screen" ref={place} />;
}

function Session({ session }: { session: TerminalSession }) {
	const store = useStore();
	const running = session.state.kind === "running";
	const state = describeTerminalState(session);
	return (
		<section className="session" aria-label={`Terminal in ${session.path}`}>
			<div className="session-bar">
				<span className={running ? "session-chip running" : "session-chip"} title={session.shell}>
					<span className="session-dot" aria-hidden="true" />
					Terminal
					<span className="session-shell">{shellName(session.shell)}</span>
				</span>
				<span className="session-state" role="status">{state}</span>
				<span className="session-hint">{terminalHint(isMac())}</span>
				<button
					type="button"
					className="icon-button session-close"
					aria-label={closeTerminalLabel(session)}
					title={closeTerminalLabel(session)}
					onClick={() => void store.closeTerminal(session.id)}
				>
					<span aria-hidden="true">×</span>
				</button>
			</div>
			<TerminalScreen session={session} />
			{!running && (
				<div className="session-ended">
					<p className="session-ended-text">{state}. What it printed stays above until it is dismissed.</p>
					<button type="button" className="button" onClick={() => void store.closeTerminal(session.id)}>Dismiss</button>
				</div>
			)}
		</section>
	);
}

/** The Workspace tab: the worktree's terminal, or a way to start one. */
export function TerminalPanel({ repository, worktree }: { repository: Repository; worktree: Worktree }) {
	const store = useStore();
	const state = useAppState();
	const panel = useRef<HTMLDivElement>(null);
	const session = terminalFor(state, worktree.id);
	if (session) return <Session key={session.id} session={session} />;

	const starting = state.operations.some(operation => operation.kind === "open-terminal" && operation.worktree === worktree.id);
	const problem = state.terminalProblem?.worktree === worktree.id ? state.terminalProblem.message : null;
	const missing = !worktree.pathExists;
	return (
		<div className="empty" ref={panel}>
			<p className="empty-title">No terminal here yet</p>
			<p className="empty-text">
				Start your shell in this worktree's folder. It keeps running while you look at other worktrees, until you close it or quit the app.
			</p>
			<button
				type="button"
				className="button"
				disabled={starting || missing}
				title={missing ? FOLDER_MISSING_TERMINAL : worktree.path}
				// A guess at the pane's size, so the first prompt fits. The pane fits it exactly as soon as it shows.
				onClick={() => void store.openTerminal({ repository: repository.path, worktree: worktree.path, ...estimateTerminalSize(panel.current) })}
			>
				{starting ? "Starting" : "Open terminal"}
			</button>
			{missing && <p className="empty-text">{FOLDER_MISSING_TERMINAL}</p>}
			{problem !== null && (
				<div className="sidebar-error terminal-problem" role="alert">
					<p className="sidebar-error-title">The terminal did not start</p>
					<p className="sidebar-error-text">{problem}</p>
					<button type="button" className="text-button" onClick={() => store.dismissTerminalProblem()}>Dismiss</button>
				</div>
			)}
		</div>
	);
}
