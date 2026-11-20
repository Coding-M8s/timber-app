import { type KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { PALETTE_LABEL, PALETTE_PLACEHOLDER, type PaletteMatch, matchEntries, paletteEntries, rowAfterKey } from "../palette";
import { runPaletteEntry } from "../palette-run";
import { waitingShortcut } from "../waiting";
import { useAppState, useStore } from "../store/react";
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

/**
 * The command palette: one box to type in, and under it the worktrees and
 * actions the typing finds. It adds no way of doing anything: choosing an
 * entry runs what the button for it runs (see ../palette-run.ts), and an
 * entry that cannot run is listed with the reason.
 */
export function CommandPalette() {
	const store = useStore();
	const state = useAppState();
	const dialog = useRef<HTMLDialogElement>(null);
	const list = useRef<HTMLUListElement>(null);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const id = useId();
	const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
	const entries = useMemo(() => paletteEntries(state), [state]);
	const matches = useMemo(() => matchEntries(entries, query), [entries, query]);
	const current = Math.min(active, matches.length - 1);
	const rowId = (index: number) => `${id}-row-${index}`;

	// Opened as a modal, so the rest of the window is inert and focus stays inside.
	useEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
		return () => element?.close();
	}, []);

	// The highlighted row stays in view as the arrows move it.
	useEffect(() => {
		list.current?.children[current]?.scrollIntoView?.({ block: "nearest" });
	}, [current]);

	const choose = (match: PaletteMatch | undefined) => {
		if (match) runPaletteEntry(store, match.entry, () => estimateTerminalSize(document.getElementById("workspace-panel")));
	};
	const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key === "Enter") {
			event.preventDefault();
			choose(matches[current]);
			return;
		}
		// Home and End move the caret in the box until the box is empty, then they move the list.
		if ((event.key === "Home" || event.key === "End") && query !== "") return;
		const next = rowAfterKey(matches.length, current, event.key);
		if (next === null) return;
		event.preventDefault();
		setActive(next);
	};

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
			<div className="palette-body">
				<input
					className="field-input palette-input"
					type="text"
					role="combobox"
					aria-expanded="true"
					aria-controls={`${id}-list`}
					aria-activedescendant={matches.length > 0 ? rowId(current) : undefined}
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
				<ul className="palette-list" id={`${id}-list`} role="listbox" aria-label="Results" ref={list}>
					{matches.map((match, index) => {
						const { entry } = match;
						const reason = entry.disabledReason;
						return (
							<li
								key={entry.id}
								id={rowId(index)}
								role="option"
								aria-selected={index === current}
								aria-disabled={reason === null ? undefined : true}
								className={`palette-row${index === current ? " active" : ""}${reason === null ? "" : " disabled"}`}
								onMouseMove={() => setActive(index)}
								onClick={() => choose(match)}
							>
								<span className="palette-label"><Label match={match} /></span>
								{entry.kind === "worktree" && <span className="palette-kind">Worktree</span>}
								<span className="palette-detail">{reason ?? entry.detail}</span>
								{entry.action.kind === "next-waiting" && <kbd className="palette-shortcut">{waitingShortcut(mac)}</kbd>}
							</li>
						);
					})}
					{matches.length === 0 && <li className="palette-empty" role="presentation">Nothing matches.</li>}
				</ul>
			</div>
		</dialog>
	);
}
