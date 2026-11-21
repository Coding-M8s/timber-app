import { type KeyboardEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import {
	NOTHING_MATCHES, PALETTE_LABEL, PALETTE_PLACEHOLDER, type PaletteIcon, type PaletteMatch, describeHighlighted, paletteEntries,
	paletteScope, paletteView, pointerMoved, rowAfterKey, rowTarget, type PointerAt,
} from "../palette";
import { runPaletteEntry } from "../palette-run";
import { waitingShortcut } from "../waiting";
import { useAppState, useStore } from "../store/react";
import { StatusGlyph } from "./StatusGlyph";
import { estimateTerminalSize } from "./TerminalPanel";

/** The label with the letters the query matched marked. */
function Label({ match }: { match: PaletteMatch }) {
	const { label } = match.entry;
	if (match.positions.length === 0) return <>{label}</>;
	const marked = new Set(match.positions);
	return (
		<>
			{[...label].map((char, index) => marked.has(index) ? <mark key={index} className="palette-mark">{char}</mark> : char)}
		</>
	);
}

/** Stroke paths on a 24 by 24 grid, drawn in the row's text color. */
const ICON_PATHS: Record<Exclude<PaletteIcon, "worktree">, ReactNode> = {
	"terminal": <><path d="M4 17l6-5-6-5" /><path d="M12 19h8" /></>,
	"agent": <path d="M12 3l1.9 5.6 5.6 1.4-5.6 1.9-1.9 5.6-1.9-5.6-5.6-1.9 5.6-1.4z" />,
	"rebase": <><path d="M6 3v12" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></>,
	"done": <path d="M20 6L9 17l-5-5" />,
	"editor": <><path d="M16 18l6-6-6-6" /><path d="M8 6l-6 6 6 6" /></>,
	"new": <><path d="M12 5v14" /><path d="M5 12h14" /></>,
	"branch": <><circle cx="6" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M6 9v6" /><path d="M15 6h3a2 2 0 0 1 2 2v7" /><circle cx="20" cy="18" r="2" /></>,
	"arena": <><path d="M5 4h4v16H5z" /><path d="M15 4h4v16h-4z" /></>,
	"fetch": <><path d="M12 4v12" /><path d="M7 11l5 5 5-5" /><path d="M5 20h14" /></>,
	"push": <><path d="M12 20V8" /><path d="M7 13l5-5 5 5" /><path d="M5 4h14" /></>,
	"clean-up": <><path d="M4 7h16" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M6 7l1 13h10l1-13" /><path d="M9 7V4h6v3" /></>,
	"next": <><path d="M5 12h14" /><path d="M13 6l6 6-6 6" /></>,
	"settings": <><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" /></>,
	"add-repository": <><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><path d="M12 10v6M9 13h6" /></>,
};

function Icon({ icon, current }: { icon: PaletteIcon; current: boolean }) {
	if (icon === "worktree") return <span className={`palette-dot${current ? " current" : ""}`} aria-hidden="true" />;
	return (
		<svg className="palette-icon" aria-hidden="true" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			{ICON_PATHS[icon]}
		</svg>
	);
}

/**
 * The command palette: one box to type in, and under it the worktrees and
 * actions the typing finds, in sections. With a worktree selected it is
 * scoped to that worktree's repository, shown as a chip in the box;
 * Backspace in the empty box, or the chip's button, widens it to every
 * repository. It adds no way of doing anything: choosing an entry runs what
 * the button for it runs (see ../palette-run.ts). The line under the list
 * says what the highlighted entry does, or why it cannot run.
 */
export function CommandPalette() {
	const store = useStore();
	const state = useAppState();
	const dialog = useRef<HTMLDialogElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const pointer = useRef<PointerAt | null>(null);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const [widened, setWidened] = useState(false);
	const id = useId();
	const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
	const context = useMemo(() => paletteScope(state), [state]);
	const scoped = context !== null && !widened;
	const entries = useMemo(() => paletteEntries(state), [state]);
	const view = useMemo(() => paletteView(entries, query, context, scoped), [entries, query, context, scoped]);
	const { options } = view;
	const current = Math.min(active, options.length - 1);
	const rowId = (index: number) => `${id}-row-${index}`;

	// Opened as a modal, so the rest of the window is inert and focus stays inside.
	useEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
		// showModal focuses the first control, which is the scope chip, so the box takes focus back.
		input.current?.focus();
		return () => element?.close();
	}, []);

	// The highlighted row stays in view as the arrows move it. Headings sit between rows, so rows are found by id.
	useEffect(() => {
		if (current >= 0) document.getElementById(rowId(current))?.scrollIntoView?.({ block: "nearest" });
	}, [current]);

	const widen = () => {
		setWidened(true);
		setActive(0);
		input.current?.focus();
	};
	const choose = (match: PaletteMatch | undefined) => {
		if (match) runPaletteEntry(store, match.entry, () => estimateTerminalSize(document.getElementById("workspace-panel")));
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			choose(options[current]);
			return;
		}
		if (event.key === "Backspace" && query === "" && scoped) {
			event.preventDefault();
			widen();
			return;
		}
		// Home and End move the caret in the box until the box is empty, then they move the list.
		if ((event.key === "Home" || event.key === "End") && query !== "") return;
		const next = rowAfterKey(options.length, current, event.key);
		if (next === null) return;
		event.preventDefault();
		setActive(next);
	};

	let position = -1;
	const highlighted = options[current]?.entry;
	return (
		<dialog
			ref={dialog}
			className="dialog palette"
			aria-label={PALETTE_LABEL}
			onCancel={event => {
				event.preventDefault();
				store.closeDialog();
			}}
			onClick={event => {
				// A click on the backdrop lands on the dialog element itself.
				if (event.target === dialog.current) store.closeDialog();
			}}
		>
			<div className="palette-search">
				{scoped && context && (
					<button
						type="button"
						className="palette-scope"
						title="Search every repository (Backspace)"
						aria-label={`Searching ${context.repositoryName} only. Search every repository`}
						onClick={widen}
					>
						<span>{context.repositoryName}</span>
						<span className="palette-scope-slash" aria-hidden="true">/</span>
						<span className="palette-scope-worktree">{context.worktreeName}</span>
						<svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2 2l6 6M8 2l-6 6" /></svg>
					</button>
				)}
				<input
					ref={input}
					className="palette-input"
					type="text"
					role="combobox"
					aria-expanded="true"
					aria-controls={`${id}-list`}
					aria-activedescendant={options.length > 0 ? rowId(current) : undefined}
					aria-describedby={`${id}-hint`}
					aria-autocomplete="list"
					aria-label={PALETTE_LABEL}
					placeholder={PALETTE_PLACEHOLDER}
					autoFocus
					autoComplete="off"
					spellCheck={false}
					value={query}
					onChange={event => {
						setQuery(event.target.value);
						setActive(0);
					}}
					onKeyDown={onKeyDown}
				/>
			</div>
			<ul className="palette-list" id={`${id}-list`} role="listbox" aria-label="Results">
				{view.groups.map((group, groupIndex) => (
					<li key={groupIndex} role="presentation" className="palette-group">
						{group.heading !== null && <div className="palette-heading" aria-hidden="true">{group.heading}</div>}
						<ul role="group" aria-label={group.heading ?? "Results"} className="palette-group-list">
							{group.matches.map(match => {
								position += 1;
								const index = position;
								const { entry } = match;
								const reason = entry.disabledReason;
								const target = rowTarget(entry, context, scoped, group.heading !== null);
								return (
									<li
										key={entry.id}
										id={rowId(index)}
										role="option"
										aria-selected={index === current}
										aria-disabled={reason === null ? undefined : true}
										className={`palette-row${index === current ? " active" : ""}${reason === null ? "" : " disabled"}`}
										onMouseMove={event => {
											const next = { x: event.screenX, y: event.screenY };
											const moved = pointerMoved(pointer.current, next);
											pointer.current = next;
											if (moved) setActive(index);
										}}
										onClick={() => choose(match)}
									>
										<Icon icon={entry.icon} current={entry.current === true} />
										<span className={`palette-label${entry.kind === "worktree" ? " worktree" : ""}`}><Label match={match} /></span>
										{entry.sessions && entry.sessions.length > 0 && (
											<span className="palette-sessions" title={entry.sessionWords}>
												{entry.sessions.map(mark => <StatusGlyph key={mark.id} status={mark.status} seen={mark.seen} />)}
											</span>
										)}
										{target !== null && <span className="palette-repository">{target}</span>}
										{entry.current && <span className="palette-detail">Current</span>}
										{entry.detail !== "" && <span className="palette-detail">{entry.detail}</span>}
										{entry.action.kind === "next-waiting" && <kbd className="palette-shortcut">{waitingShortcut(mac)}</kbd>}
									</li>
								);
							})}
						</ul>
					</li>
				))}
				{options.length === 0 && <li className="palette-empty" role="presentation">{NOTHING_MATCHES}</li>}
				{view.unavailable !== null && <li className="palette-unavailable" role="presentation">{view.unavailable}</li>}
			</ul>
			<div className={`palette-footer${highlighted?.disabledReason ? " reason" : ""}`}>
				<span className="palette-hint" id={`${id}-hint`}>{describeHighlighted(highlighted)}</span>
				{scoped && <span className="palette-keys">Backspace: all repositories</span>}
			</div>
		</dialog>
	);
}
