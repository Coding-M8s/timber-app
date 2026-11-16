import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { Repository, Worktree } from "../../shared/model";
import { SESSION_NAME_LIMIT, type TerminalSession } from "../../shared/terminal";
import { useAppState, useStore } from "../store/react";
import { sessionsOf, shownSession } from "../store/state";
import {
	chipAfterKey, chipCommand, closeTerminalLabel, describeSessionChip, describeTerminalState, sessionChipId, shellName, shortExit, terminalHint,
} from "../terminal-format";

/** The drawn terminals load with xterm.js, the first time one shows, and stay loaded. */
type Views = typeof import("../terminal-view");
let views: Views | null = null;
let loading: Promise<Views> | null = null;
function loadViews(): Promise<Views> {
	loading ??= import("../terminal-view").then(module => (views = module));
	return loading;
}

/**
 * The session whose terminal should take the keyboard once it shows, because
 * the person chose its chip by click, Enter, or Space. Arrow keys on the chips
 * only show a session; the focus stays on the chips.
 */
let focusWhenShown: string | null = null;

const SESSION_PANEL_ID = "session-panel";
const ADD_SESSION_ID = "session-add";

/**
 * Put focus on an element once React drew it. React draws what a key or a
 * click changed before a timer runs; an animation frame would wait for the
 * window to paint, which a hidden window never does.
 */
const focusSoon = (id: string) => void setTimeout(() => document.getElementById(id)?.focus(), 0);

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
			// Only take the keyboard when nothing else has it, such as right after a new session or a switch from inside a terminal,
			// or when its chip was chosen to show it. Moving through the sidebar keeps it there, and arrows on the chips keep it on the chips.
			const active = document.activeElement;
			const chosen = focusWhenShown === session.id;
			// The wish is for this showing only. Left over, it would take the keyboard from the sidebar or the chips later.
			focusWhenShown = null;
			const free = active === null || active === document.body || active.id === ADD_SESSION_ID;
			if (chosen || free) view.focus();
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

interface SessionProps {
	session: TerminalSession;
	/** Its chip is a rename field right now, so the panel is named by the session instead. */
	renaming: boolean;
	onRename: () => void;
}

/** The shown session: its state and controls above its terminal. It is the panel of its chip. */
function Session({ session, renaming, onRename }: SessionProps) {
	const store = useStore();
	const running = session.state.kind === "running";
	const state = describeTerminalState(session);
	return (
		<section
			className="session"
			role="tabpanel"
			id={SESSION_PANEL_ID}
			aria-labelledby={renaming ? undefined : sessionChipId(session.id)}
			aria-label={renaming ? session.name : undefined}
		>
			<div className="session-bar">
				<span className="session-shell" title={session.shell}>{shellName(session.shell)}</span>
				<span className="session-state" role="status">{state}</span>
				<span className="session-hint" title={terminalHint(isMac())}>{terminalHint(isMac())}</span>
				<button type="button" className="text-button" title={`Rename ${session.name} (F2 on its chip)`} onClick={onRename}>Rename</button>
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

/** Where a chip's name is typed. Enter and leaving the field save, Escape keeps the name. */
function RenameField({ session, onDone }: { session: TerminalSession; onDone: () => void }) {
	const store = useStore();
	const [draft, setDraft] = useState(session.name);
	const field = useRef<HTMLInputElement>(null);
	const finished = useRef(false);
	useEffect(() => {
		field.current?.focus();
		field.current?.select();
	}, []);
	const finish = (save: boolean, backToChip: boolean) => {
		if (finished.current) return;
		finished.current = true;
		if (save && draft.trim() !== "" && draft !== session.name) void store.renameTerminal(session.id, draft);
		onDone();
		if (backToChip) focusSoon(sessionChipId(session.id));
	};
	return (
		<input
			ref={field}
			className="session-rename"
			aria-label={`Name of ${session.name}`}
			value={draft}
			maxLength={SESSION_NAME_LIMIT}
			onChange={event => setDraft(event.target.value)}
			// Keys typed here are the field's: none of them may switch or close sessions.
			onKeyDown={event => {
				event.stopPropagation();
				if (event.key === "Enter") {
					event.preventDefault();
					finish(true, true);
				} else if (event.key === "Escape") {
					event.preventDefault();
					finish(false, true);
				}
			}}
			onBlur={() => finish(true, false)}
		/>
	);
}

interface ChipProps {
	session: TerminalSession;
	selected: boolean;
	unseen: boolean;
	ids: readonly string[];
	/** The chosen session of the worktree. */
	shownId: string;
	/** It is being closed, which can take up to two seconds. */
	closing: boolean;
	/** Sessions being closed, never picked to show next. */
	closingIds: readonly string[];
	onRename: () => void;
}

/**
 * One session's chip: a tab of the sessions tablist. The close control sits
 * beside the tab, not inside it, and is for the pointer; on the keyboard,
 * Delete closes and F2 renames, and the session bar has both as buttons.
 */
function Chip({ session, selected, unseen, ids, shownId, closing, closingIds, onRename }: ChipProps) {
	const store = useStore();
	const descriptionId = useId();
	const running = session.state.kind === "running";
	const exit = shortExit(session.state);
	const description = closing ? `${describeSessionChip(session, unseen)}. Closing` : describeSessionChip(session, unseen);

	const close = () => {
		// Closing the chosen chip shows the one beside it, which takes the focus, or "+" when it was the last one.
		if (closing) return;
		const at = ids.indexOf(session.id);
		const open = (id: string | undefined) => id !== undefined && !closingIds.includes(id);
		const after = ids.slice(at + 1).find(open);
		const before = ids.slice(0, at).reverse().find(open);
		const next = selected ? after ?? before : shownId;
		if (selected && next) store.showSession(next);
		focusSoon(next ? sessionChipId(next) : ADD_SESSION_ID);
		void store.closeTerminal(session.id);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		const next = chipAfterKey(ids, session.id, event.key);
		if (next !== null) {
			event.preventDefault();
			store.showSession(next);
			document.getElementById(sessionChipId(next))?.focus();
			return;
		}
		const command = chipCommand(event.key);
		if (command === null) return;
		event.preventDefault();
		if (command === "close") close();
		else onRename();
	};

	const className = ["session-chip", selected ? "selected" : "", running ? "running" : "exited", unseen ? "unseen" : "", closing ? "closing" : ""].filter(Boolean).join(" ");
	return (
		<span className={className} role="presentation">
			<button
				type="button"
				role="tab"
				id={sessionChipId(session.id)}
				className="session-chip-tab"
				aria-selected={selected}
				aria-controls={selected ? SESSION_PANEL_ID : undefined}
				aria-describedby={descriptionId}
				aria-busy={closing || undefined}
				aria-keyshortcuts="Delete F2"
				// Only the chosen chip is a tab stop. The arrows reach the others.
				tabIndex={selected ? 0 : -1}
				title={`${description}. Double-click or F2 renames, Delete closes.`}
				onClick={() => {
					// The chip that shows already has its terminal on screen: hand it the keyboard now.
					if (selected) views?.terminalView(store, session.id).focus();
					else {
						focusWhenShown = session.id;
						store.showSession(session.id);
					}
				}}
				onDoubleClick={onRename}
				onKeyDown={onKeyDown}
			>
				{/* A filled dot while it runs, a hollow one once it ended: the shape says it, not only the color. */}
				<span className="session-dot" aria-hidden="true" />
				<span className="session-kind" aria-hidden="true">&gt;_</span>
				<span className="session-name">{session.name}</span>
				{exit !== null && <span className="session-exit" aria-hidden="true">{exit}</span>}
				{unseen && <span className="session-unseen" aria-hidden="true" />}
				<span id={descriptionId} hidden>{description}</span>
			</button>
			<button type="button" className="session-chip-close" tabIndex={-1} aria-label={closeTerminalLabel(session)} title={closeTerminalLabel(session)} disabled={closing} onClick={close}>
				<span aria-hidden="true">×</span>
			</button>
		</span>
	);
}

/** Why a session did not start in this worktree, until dismissed. */
function TerminalProblemNote({ worktree }: { worktree: Worktree }) {
	const store = useStore();
	const state = useAppState();
	const problem = state.terminalProblem?.worktree === worktree.id ? state.terminalProblem.message : null;
	if (problem === null) return null;
	return (
		<div className="sidebar-error terminal-problem" role="alert">
			<p className="sidebar-error-title">The terminal did not start</p>
			<p className="sidebar-error-text">{problem}</p>
			<button type="button" className="text-button" onClick={() => store.dismissTerminalProblem()}>Dismiss</button>
		</div>
	);
}

/**
 * The Workspace tab: a chip for each of the worktree's sessions, the chosen
 * one's terminal below them, and "+" to start another. Every session keeps
 * running while another shows. With no session yet, a way to start one.
 */
export function TerminalPanel({ repository, worktree }: { repository: Repository; worktree: Worktree }) {
	const store = useStore();
	const state = useAppState();
	const panel = useRef<HTMLDivElement>(null);
	const [renaming, setRenaming] = useState<string | null>(null);
	const sessions = sessionsOf(state, worktree.id);
	const shown = shownSession(state, worktree.id);
	const closingIds = state.operations.flatMap(operation => operation.kind === "close-terminal" ? [operation.session] : []);

	// When the last session goes, its controls go with it. Keep the keyboard in the panel, on the button that starts one.
	const hadSessions = useRef({ worktree: worktree.id, had: sessions.length > 0 });
	useEffect(() => {
		const before = hadSessions.current;
		hadSessions.current = { worktree: worktree.id, had: sessions.length > 0 };
		// Only the sessions of this worktree going counts, not a switch to a worktree with none.
		if (before.worktree !== worktree.id || !before.had || sessions.length > 0) return;
		const active = document.activeElement;
		if (active === null || active === document.body || panel.current?.contains(active)) document.getElementById(ADD_SESSION_ID)?.focus();
	}, [worktree.id, sessions.length]);
	const starting = state.operations.some(operation => operation.kind === "open-terminal" && operation.worktree === worktree.id);
	const missing = !worktree.pathExists;
	// A guess at the pane's size, so the first prompt fits. The pane fits it exactly as soon as it shows.
	const start = () => void store.openTerminal({ repository: repository.path, worktree: worktree.path, ...estimateTerminalSize(panel.current) });

	if (!shown) {
		return (
			<div className="empty" ref={panel}>
				<p className="empty-title">No terminal here yet</p>
				<p className="empty-text">
					Start your shell in this worktree's folder. It keeps running while you look at other worktrees, until you close it or quit the app.
				</p>
				<button type="button" className="button" id={ADD_SESSION_ID} disabled={starting || missing} title={missing ? FOLDER_MISSING_TERMINAL : worktree.path} onClick={start}>
					{starting ? "Starting" : "Open terminal"}
				</button>
				{missing && <p className="empty-text">{FOLDER_MISSING_TERMINAL}</p>}
				<TerminalProblemNote worktree={worktree} />
			</div>
		);
	}

	const ids = sessions.map(session => session.id);
	const newTitle = missing ? FOLDER_MISSING_TERMINAL : starting ? "Starting a terminal" : `New terminal in ${worktree.path}`;
	return (
		<div className="sessions" ref={panel}>
			<div className="session-strip">
				<div className="session-chips" role="tablist" aria-label="Sessions in this worktree">
					{sessions.map(session =>
						renaming === session.id ? (
							<RenameField key={session.id} session={session} onDone={() => setRenaming(null)} />
						) : (
							<Chip
								key={session.id}
								session={session}
								selected={session.id === shown.id}
								unseen={state.unseenSessions.includes(session.id)}
								ids={ids}
								shownId={shown.id}
								closing={closingIds.includes(session.id)}
								closingIds={closingIds}
								onRename={() => setRenaming(session.id)}
							/>
						),
					)}
				</div>
				<button
					type="button"
					className="icon-button session-add"
					id={ADD_SESSION_ID}
					aria-label="New terminal"
					title={newTitle}
					disabled={starting || missing}
					onClick={start}
				>
					<span aria-hidden="true">+</span>
				</button>
			</div>
			<TerminalProblemNote worktree={worktree} />
			<Session key={shown.id} session={shown} renaming={renaming === shown.id} onRename={() => setRenaming(shown.id)} />
		</div>
	);
}
