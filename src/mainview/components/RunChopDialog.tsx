import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { CHOP_TEXT_LIMIT } from "../../shared/chops";
import { pointerMoved, rowAfterKey, type PointerAt } from "../palette";
import { runChopIn } from "../palette-run";
import {
	RUN_CHOP_EDIT_LABEL, RUN_CHOP_LABEL, RUN_CHOP_PLACEHOLDER, type RunChopFilter, type RunChopRow, describeEditStep, describeRunChopFilter, describeRunChopRow, runChopEditKeys,
	runChopFilterAfter, runChopFilterLabel, runChopKeys, runChopListKey, runChopModel, runsEditedText, takesRunChopKey,
} from "../run-chop-format";
import { useAppState, useStore } from "../store/react";
import { estimateTerminalSize } from "./TerminalPanel";

/** Text with the letters at `positions` marked, as the palette marks a match. */
function Marked({ text, positions }: { text: string; positions: readonly number[] }) {
	if (positions.length === 0) return <>{text}</>;
	const marked = new Set(positions);
	return <>{[...text].map((char, index) => marked.has(index) ? <mark key={index} className="palette-mark">{char}</mark> : char)}</>;
}

/** The keys the footer names, as in the mock: each key, then what it does. */
function Keys({ keys }: { keys: readonly { keys: string; words: string }[] }) {
	return (
		<span className="run-chop-keys">
			{keys.map(key => <span key={key.keys}><kbd>{key.keys}</kbd> {key.words}</span>)}
		</span>
	);
}

/** The chop whose text is being edited for one run. */
interface Editing {
	row: RunChopRow;
	text: string;
	tried: boolean;
}

/**
 * The chop search: one box over every chop of the selected worktree's
 * repository, opened by its shortcut with the chops panel shown or hidden
 * (`RunChopShortcut`). Typing narrows the list (`findChops`): the last chop
 * chosen on top, then favorites. Each row shows a command's text, or where a
 * prompt goes, and the highlighted chop's whole text shows under the list,
 * so what runs is seen first. Enter runs it through the panel's path
 * (`runChopIn`); Ctrl+Enter, or Cmd+Enter, shows its text to edit for this
 * run only; Tab shows only commands, then only prompts, then all again.
 */
export function RunChopDialog() {
	const store = useStore();
	const state = useAppState();
	const dialog = useRef<HTMLDialogElement>(null);
	const input = useRef<HTMLInputElement>(null);
	const editor = useRef<HTMLTextAreaElement>(null);
	const pointer = useRef<PointerAt | null>(null);
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<RunChopFilter>("all");
	const [active, setActive] = useState(0);
	const [editing, setEditing] = useState<Editing | null>(null);
	const id = useId();
	const mac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);
	const model = useMemo(() => runChopModel(state, query, filter), [state, query, filter]);
	const { rows } = model;
	const current = Math.min(active, rows.length - 1);
	const highlighted = current >= 0 ? rows[current] : undefined;
	const rowId = (index: number) => `${id}-row-${index}`;

	// Opened as a modal, so the rest of the window is inert. Focus goes back where it was when it closes with nothing new to show.
	useEffect(() => {
		const element = dialog.current;
		const opener = document.activeElement;
		if (element && !element.open) element.showModal();
		input.current?.focus();
		return () => {
			element?.close();
			const lost = document.activeElement === null || document.activeElement === document.body;
			if (lost && opener instanceof HTMLElement && opener.isConnected) opener.focus();
		};
	}, []);

	useEffect(() => {
		if (current >= 0 && editing === null) document.getElementById(rowId(current))?.scrollIntoView?.({ block: "nearest" });
	}, [current, editing]);

	useEffect(() => {
		if (editing !== null) editor.current?.focus();
		else input.current?.focus();
	}, [editing === null]);

	const run = (row: RunChopRow | undefined, text?: string) => {
		const selection = store.getState().selection;
		if (row === undefined || row.blocked !== null || model.repository === null || selection === null) return;
		const repository = model.repository;
		store.closeDialog();
		// Copying shows nothing new, so the view the person is on stays, as in the panel.
		runChopIn(store, repository, selection.worktree, row.chop.name, () => estimateTerminalSize(document.getElementById("workspace-panel")), row.action !== "copy", text);
	};
	const changeFilter = (next: RunChopFilter) => {
		setFilter(next);
		setActive(0);
	};

	const onListKey = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		const action = runChopListKey(event.nativeEvent);
		if (action === "run") {
			event.preventDefault();
			run(highlighted);
			return;
		}
		if (action === "edit") {
			event.preventDefault();
			if (highlighted !== undefined && highlighted.blocked === null) setEditing({ row: highlighted, text: highlighted.chop.text, tried: false });
			return;
		}
		if (action === "next-filter" || action === "previous-filter") {
			event.preventDefault();
			changeFilter(runChopFilterAfter(filter, action === "previous-filter"));
			return;
		}
		// Home and End move the caret in the box until the box is empty, then they move the list.
		if ((event.key === "Home" || event.key === "End") && query !== "") return;
		const next = rowAfterKey(rows.length, current, event.key);
		if (next === null) return;
		event.preventDefault();
		setActive(next);
	};

	const onEditKey = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
		if (editing === null || !runsEditedText(event.nativeEvent)) return;
		event.preventDefault();
		if (editing.text.trim() === "") {
			setEditing({ ...editing, tried: true });
			return;
		}
		// Unchanged, it is the chop as saved, and runs as it would from the list.
		run(editing.row, editing.text === editing.row.chop.text ? undefined : editing.text);
	};

	const blank = editing !== null && editing.text.trim() === "";
	return (
		<dialog
			ref={dialog}
			className="dialog palette run-chop"
			aria-label={RUN_CHOP_LABEL}
			onCancel={event => {
				event.preventDefault();
				// Escape while editing goes back to the list; from the list it closes.
				if (editing !== null) setEditing(null);
				else store.closeDialog();
			}}
			onClick={event => {
				if (event.target === dialog.current) store.closeDialog();
			}}
		>
			{editing === null ? (
				<>
					<div className="palette-search">
						<input
							ref={input}
							className="palette-input"
							type="text"
							role="combobox"
							aria-expanded="true"
							aria-controls={`${id}-list`}
							aria-activedescendant={rows.length > 0 && current >= 0 ? rowId(current) : undefined}
							aria-describedby={`${id}-hint`}
							aria-autocomplete="list"
							aria-label={RUN_CHOP_LABEL}
							placeholder={RUN_CHOP_PLACEHOLDER}
							autoComplete="off"
							spellCheck={false}
							value={query}
							onChange={event => {
								setQuery(event.target.value);
								setActive(0);
							}}
							onKeyDown={onListKey}
						/>
						<button
							type="button"
							className="run-chop-filter"
							title={describeRunChopFilter(filter)}
							aria-label={`${runChopFilterLabel(filter)}. ${describeRunChopFilter(filter)}`}
							tabIndex={-1}
							onClick={() => {
								changeFilter(runChopFilterAfter(filter, false));
								input.current?.focus();
							}}
						>
							{runChopFilterLabel(filter)}
						</button>
						{model.worktree !== null && <span className="run-chop-where">in {model.worktree}</span>}
					</div>
					<span className="visually-hidden" aria-live="polite">{describeRunChopFilter(filter)}</span>
					<ul className="palette-list" id={`${id}-list`} role="listbox" aria-label="Chops">
						{rows.map((row, index) => (
							<li
								key={row.chop.name}
								id={rowId(index)}
								role="option"
								aria-selected={index === current}
								aria-disabled={row.blocked === null ? undefined : true}
								className={`palette-row run-chop-row${index === current ? " active" : ""}${row.blocked === null ? "" : " disabled"}`}
								onMouseMove={event => {
									const next = { x: event.screenX, y: event.screenY };
									const moved = pointerMoved(pointer.current, next);
									pointer.current = next;
									if (moved) setActive(index);
								}}
								onClick={() => run(row)}
							>
								<span className="run-chop-kind">{row.kindWord}</span>
								<span className="run-chop-body">
									<span className="palette-label"><Marked text={row.chop.name} positions={row.namePositions} />{row.favorite && <span className="visually-hidden">, favorite</span>}</span>
									{row.target === null
										? <span className="run-chop-text"><Marked text={row.line} positions={row.linePositions} />{row.chop.text.length > row.line.length ? "..." : ""}</span>
										: <span className="run-chop-target">{row.target}</span>}
								</span>
								{index === current && row.blocked === null && <kbd className="palette-shortcut">Enter</kbd>}
							</li>
						))}
						{model.empty !== null && <li className="palette-empty" role="presentation">{model.empty}</li>}
					</ul>
					{highlighted !== undefined && <pre className="run-chop-preview" aria-label={`The text of ${highlighted.chop.name}`}>{highlighted.chop.text}</pre>}
					<div className={`palette-footer${highlighted?.blocked ? " reason" : ""}`}>
						<span className="palette-hint" id={`${id}-hint`}>{describeRunChopRow(highlighted, model.worktree)}</span>
						<Keys keys={runChopKeys(mac)} />
					</div>
				</>
			) : (
				<>
					<div className="run-chop-edit">
						<label className="field-label" htmlFor={`${id}-edit`}>{RUN_CHOP_EDIT_LABEL}: {editing.row.chop.name}</label>
						<p className="field-hint" id={`${id}-edit-hint`}>{describeEditStep(editing.row.chop, model.worktree)}</p>
						<textarea
							ref={editor}
							id={`${id}-edit`}
							className="field-input mono"
							rows={Math.min(10, Math.max(3, editing.text.split("\n").length))}
							spellCheck={editing.row.chop.kind === "prompt"}
							maxLength={CHOP_TEXT_LIMIT}
							aria-describedby={`${id}-edit-hint`}
							aria-invalid={blank && editing.tried}
							value={editing.text}
							onChange={event => setEditing({ ...editing, text: event.target.value })}
							onKeyDown={onEditKey}
						/>
						{blank && editing.tried && <p className="field-error" role="alert">{editing.row.chop.kind === "command" ? "Type the command." : "Type the prompt."}</p>}
					</div>
					<div className="palette-footer">
						<span className="palette-hint">{describeRunChopRow(editing.row, model.worktree)}</span>
						<Keys keys={runChopEditKeys()} />
					</div>
				</>
			)}
		</dialog>
	);
}

/**
 * Opens the chop search from the keyboard, and closes it again, with the
 * chops panel shown or hidden. It draws nothing. It listens on the window
 * in the capture phase, so it hears the keys of a focused terminal too. The
 * key is taken only while chops are in use and no other dialog or the quit
 * question is open (`takesRunChopKey`); otherwise it goes on as if the app
 * had no such key.
 */
export function RunChopShortcut() {
	const store = useStore();
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!takesRunChopKey(event, store.getState())) return;
			event.preventDefault();
			// A held chord opens or closes it once.
			if (!event.repeat) store.toggleRunChop();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [store]);
	return null;
}
