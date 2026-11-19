import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { type SessionMenuItem, describeSessionProblemTitle, describeStarting, menuIndexAfterKey, sessionMenuChoice, sessionMenuItems } from "../agent-format";
import type { Repository, Worktree } from "../../shared/model";
import { SESSION_NAME_LIMIT, type TerminalSession } from "../../shared/terminal";
import { estimateTerminalCells } from "../../shared/terminal-appearance";
import { agentBrand, hasStatusMark, shownStatus } from "../../shared/session-status";
import { AgentIcon } from "./AgentIcon";
import { StatusGlyph } from "./StatusGlyph";
import { terminalAppearance } from "../terminal-look";
import { useAppState, useStore } from "../store/react";
import { isBeingRemoved, sessionsOf, shownSession } from "../store/state";
import { BEING_REMOVED_REASON } from "../done-format";
import { dropTerminalFocus, onTerminalFocusWish, takeTerminalFocus, wantTerminalFocus } from "../terminal-focus";
import {
	chipAfterKey, chipCommand, closeTerminalLabel, describeSessionChip, describeTerminalState, sessionChipId, shellName, shortExit,
} from "../terminal-format";

/** The drawn terminals load with xterm.js, the first time one shows, and stay loaded. */
type Views = typeof import("../terminal-view");
let views: Views | null = null;
let loading: Promise<Views> | null = null;
function loadViews(): Promise<Views> {
	// The font is there before the first terminal opens, because xterm measures its cells with it.
	loading ??= import("../terminal-view").then(module => module.terminalFontReady().then(() => (views = module)));
	return loading;
}

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

/** Roughly how many cells fit in an element, at the text size chosen in Settings. 80 by 24 when it has no size. */
export function estimateTerminalSize(element: HTMLElement | null): { cols: number; rows: number } {
	return estimateTerminalCells(element?.clientWidth ?? 0, element?.clientHeight ?? 0, terminalAppearance().fontSize);
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
			// or when it was asked for (./terminal-focus.ts): a click on its chip or its worktree's row, or a session the app started there.
			// Moving through the sidebar by keyboard keeps the keyboard there, and arrows on the chips keep it on the chips.
			const active = document.activeElement;
			const chosen = takeTerminalFocus(session.worktree);
			const free = active === null || active === document.body || active.id === ADD_SESSION_ID;
			if (chosen || free) view.focus();
			// Asked for while it shows, such as by a click on the row of the worktree already selected.
			const stopListening = onTerminalFocusWish(() => {
				if (takeTerminalFocus(session.worktree)) view.focus();
			});
			// The pane changes size with the window, the sidebar, and the header's notes. A drag would resize on every frame, so wait for it to rest.
			let timer: ReturnType<typeof setTimeout> | undefined;
			const observer = new ResizeObserver(() => {
				clearTimeout(timer);
				timer = setTimeout(() => view.fit(), RESIZE_MILLISECONDS);
			});
			observer.observe(container);
			cleanup = () => {
				stopListening();
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
}

interface SessionControlsProps {
	session: TerminalSession;
	onRename: () => void;
}

/**
 * The shown session's shell, state, Rename, and Close, at the right end of
 * the row of chips, so the terminal below gets the whole height of the pane.
 */
function SessionControls({ session, onRename }: SessionControlsProps) {
	const store = useStore();
	return (
		<div className="session-controls">
			<span className="session-shell" title={session.command}>{shellName(session.shell)}</span>
			<span className="session-state" role="status">{describeTerminalState(session)}</span>
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
	);
}

/** The shown session's terminal, and a note once it ended. It is the panel of its chip. */
function Session({ session, renaming }: SessionProps) {
	const store = useStore();
	const running = session.state.kind === "running";
	return (
		<section
			className={session.kind === "agent" ? "session agent" : "session"}
			role="tabpanel"
			id={SESSION_PANEL_ID}
			aria-labelledby={renaming ? undefined : sessionChipId(session.id)}
			aria-label={renaming ? session.name : undefined}
		>
			<TerminalScreen session={session} />
			{!running && (
				<div className="session-ended">
					<p className="session-ended-text">{describeTerminalState(session)}. What it printed stays above until it is dismissed.</p>
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
 * Delete closes and F2 renames, and the row of chips has both as buttons.
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
						wantTerminalFocus(session.worktree);
						store.showSession(session.id);
					}
				}}
				onDoubleClick={onRename}
				onKeyDown={onKeyDown}
			>
				{hasStatusMark(session)
					// An agent's status, or a program's that reported one, as a shape and a color. The words are in its description.
					? <StatusGlyph status={shownStatus(session)} />
					// A filled dot while it runs, a hollow one once it ended: the shape says it, not only the color.
					: <span className="session-dot" aria-hidden="true" />}
				{agentBrand(session) !== null
					? <span className="session-kind branded" aria-hidden="true"><AgentIcon brand={agentBrand(session)!} /></span>
					: <span className="session-kind" aria-hidden="true">{session.kind === "agent" ? "\u2726" : ">_"}</span>}
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

/** Why a session did not start in this worktree, with the command that failed, until dismissed. */
function TerminalProblemNote({ worktree }: { worktree: Worktree }) {
	const store = useStore();
	const state = useAppState();
	const problem = state.terminalProblem?.worktree === worktree.id ? state.terminalProblem : null;
	if (problem === null) return null;
	return (
		<div className="sidebar-error terminal-problem" role="alert">
			<p className="sidebar-error-title">{describeSessionProblemTitle(problem)}</p>
			<p className="sidebar-error-text">{problem.message}</p>
			{problem.command !== null && <pre className="dialog-command" aria-label="Command that failed">{problem.command}</pre>}
			<button type="button" className="text-button" onClick={() => store.dismissTerminalProblem()}>Dismiss</button>
		</div>
	);
}

const SET_UP_AGENTS = "Set up agents";
/** The widest the "+" menu gets, in pixels, as in the styles. */
const MENU_WIDTH = 440;

interface SessionMenuProps {
	items: readonly SessionMenuItem[];
	disabled: boolean;
	title: string;
	onStart: (agent: string | null) => void;
	onSetUp: () => void;
}

/**
 * "+" at the end of the chips: a menu of what can start, the shell and every
 * agent from Settings, each with what it runs, then a way to Settings,
 * Agents. The arrows, Home, and End move through it and wrap; Escape closes
 * it and Tab or a click elsewhere puts it away. Choosing an entry gives the
 * keyboard back to "+", so the new session's terminal takes it.
 */
function SessionMenu({ items, disabled, title, onStart, onSetUp }: SessionMenuProps) {
	const menuId = useId();
	const [open, setOpen] = useState(false);
	// "+" follows the last chip, so near the window's right edge the menu hangs to the left of it instead.
	const [alignEnd, setAlignEnd] = useState(false);
	const button = useRef<HTMLButtonElement>(null);
	const menu = useRef<HTMLDivElement>(null);
	const entries = items.length + 1;
	const itemId = (index: number) => `${menuId}-item-${index}`;

	const show = (index: number) => {
		const left = button.current?.getBoundingClientRect().left ?? 0;
		setAlignEnd(typeof window !== "undefined" && left + MENU_WIDTH > window.innerWidth - 8);
		setOpen(true);
		focusSoon(itemId(index));
	};
	const close = (backToButton: boolean) => {
		setOpen(false);
		if (backToButton) button.current?.focus();
	};

	useEffect(() => {
		if (!open) return;
		const away = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (target && !menu.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
		};
		document.addEventListener("pointerdown", away);
		return () => document.removeEventListener("pointerdown", away);
	}, [open]);
	useEffect(() => {
		if (disabled) setOpen(false);
	}, [disabled]);

	const choose = (index: number) => {
		const choice = sessionMenuChoice(items, index);
		close(true);
		if (choice?.kind === "start") onStart(choice.agent);
		else if (choice?.kind === "set-up") onSetUp();
	};

	const onButtonKey = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			show(0);
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			show(entries - 1);
		}
	};

	const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
		// Keys here are the menu's: none of them may reach the chips or a terminal.
		event.stopPropagation();
		const at = Array.from({ length: entries }, (_, index) => itemId(index)).indexOf(document.activeElement?.id ?? "");
		const next = menuIndexAfterKey(entries, at === -1 ? 0 : at, event.key);
		if (next !== null) {
			event.preventDefault();
			document.getElementById(itemId(next))?.focus();
		} else if (event.key === "Escape") {
			event.preventDefault();
			close(true);
		} else if (event.key === "Tab") {
			// The focused entry goes with the menu, so Tab and Shift+Tab move on from "+".
			button.current?.focus();
			setOpen(false);
		}
	};

	return (
		<div className="session-menu-anchor">
			<button
				ref={button}
				type="button"
				className="icon-button session-add"
				id={ADD_SESSION_ID}
				aria-label="New session"
				aria-haspopup="menu"
				aria-expanded={open}
				aria-controls={open ? menuId : undefined}
				title={title}
				disabled={disabled}
				onClick={() => (open ? close(false) : show(0))}
				onKeyDown={onButtonKey}
			>
				<span aria-hidden="true">+</span>
			</button>
			{open && (
				<div ref={menu} className={alignEnd ? "session-menu end" : "session-menu"} role="menu" id={menuId} aria-label="New session" onKeyDown={onMenuKey}>
					{items.map((item, index) => (
						<button
							key={item.agent ?? ""}
							type="button"
							role="menuitem"
							id={itemId(index)}
							className="session-menu-item"
							tabIndex={-1}
							title={item.agent === null ? "Start your shell in this worktree" : `Start ${item.label}: ${item.detail}`}
							onClick={() => choose(index)}
						>
							<span className="session-kind" aria-hidden="true">{item.agent === null ? ">_" : "\u2726"}</span>
							<span className="session-menu-label">{item.label}</span>
							<span className={item.agent === null ? "session-menu-detail" : "session-menu-detail mono"}>{item.detail}</span>
						</button>
					))}
					<div className="session-menu-separator" role="separator" />
					<button type="button" role="menuitem" id={itemId(items.length)} className="session-menu-item" tabIndex={-1} onClick={() => choose(items.length)}>
						<span className="session-menu-label">{SET_UP_AGENTS}</span>
					</button>
				</div>
			)}
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
	const startingOperation = state.operations.find(operation => operation.kind === "open-terminal" && operation.worktree === worktree.id);
	const starting = startingOperation !== undefined;
	// Nothing shows here and nothing is starting, so no terminal will take the keyboard that was asked for.
	useEffect(() => {
		if (!shown && !starting) dropTerminalFocus(worktree.id);
	}, [worktree.id, shown, starting]);
	const startingAgent = startingOperation?.kind === "open-terminal" ? startingOperation.agent : undefined;
	// Nothing starts in a folder that is missing, or that Timber is deleting.
	const unavailable = !worktree.pathExists ? FOLDER_MISSING_TERMINAL : isBeingRemoved(state, repository.path, worktree.path) ? BEING_REMOVED_REASON : null;
	const agents = state.preferences.agents;
	// A guess at the pane's size, so the first prompt fits. The pane fits it exactly as soon as it shows.
	const start = (agent: string | null = null) =>
		void store.openTerminal({ repository: repository.path, worktree: worktree.path, ...estimateTerminalSize(panel.current), ...(agent === null ? {} : { agent }) });
	const setUpAgents = () => store.openDialog({ kind: "settings", section: "agents" });

	if (!shown) {
		return (
			<div className="empty" ref={panel}>
				<p className="empty-title">No session here yet</p>
				<p className="empty-text">
					Start your shell or a coding agent in this worktree's folder. It keeps running while you look at other worktrees, until you close it or quit the app.
				</p>
				<div className="empty-actions">
					<button type="button" className="button" id={ADD_SESSION_ID} disabled={starting || unavailable !== null} title={unavailable !== null ? unavailable : worktree.path} onClick={() => start()}>
						{startingAgent === null ? "Starting" : "Open terminal"}
					</button>
					{sessionMenuItems(agents).slice(1).map(item => (
						<button
							key={item.agent!}
							type="button"
							className="button quiet"
							disabled={starting || unavailable !== null}
							title={unavailable !== null ? unavailable : `Start ${item.label}: ${item.detail}`}
							onClick={() => start(item.agent)}
						>
							{startingAgent === item.agent ? `Starting ${item.label}` : `Start ${item.label}`}
						</button>
					))}
				</div>
				<button type="button" className="text-button" onClick={setUpAgents}>{SET_UP_AGENTS}</button>
				{unavailable !== null && <p className="empty-text">{unavailable}</p>}
				<TerminalProblemNote worktree={worktree} />
			</div>
		);
	}

	const ids = sessions.map(session => session.id);
	const newTitle = unavailable !== null ? unavailable : startingAgent !== undefined ? describeStarting(startingAgent) : `New session in ${worktree.path}`;
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
				<SessionMenu items={sessionMenuItems(agents)} disabled={starting || unavailable !== null} title={newTitle} onStart={start} onSetUp={setUpAgents} />
				<SessionControls session={shown} onRename={() => setRenaming(shown.id)} />
			</div>
			<TerminalProblemNote worktree={worktree} />
			<Session key={shown.id} session={shown} renaming={renaming === shown.id} />
		</div>
	);
}
