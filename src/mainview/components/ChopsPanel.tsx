import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, useEffect, useId, useRef, useState } from "react";
import { MAX_CHOPS_WIDTH, MIN_CHOPS_WIDTH } from "../../shared/layout";
import { chopKindWord, listedChops } from "../../shared/chops";
import { describeChopSource } from "../chop-format";
import {
	CHOPS_BUTTON_ID, CHOPS_CLOSE_LABEL, CHOPS_PANEL_ID, CHOPS_PANEL_TITLE, CHOPS_WIDTH_LABEL, describeChopsPanelEmpty, takesChopsPanelKey,
} from "../chops-panel-format";
import { chopsWidthAfterDrag, chopsWidthAfterKey } from "../shell";
import { useAppState, useStore } from "../store/react";
import { selectedWorktree } from "../store/state";
import type { AppStore } from "../store/store";

/*
 * Where the keyboard goes as the panel shows and hides. The store knows
 * nothing of the page, so this is kept here: the element that had focus
 * when the button or the shortcut showed the panel, and whether the panel
 * should take focus once it is drawn. A panel shown again at start-up,
 * from the saved layout, takes nothing.
 */
let returnTo: HTMLElement | null = null;
let focusOnShow = false;

function panelElement(): HTMLElement | null {
	return document.getElementById(CHOPS_PANEL_ID);
}

/**
 * Show the chops panel when it is hidden and hide it when it shows, from the
 * title bar button or the shortcut. Shown, it takes the keyboard and
 * remembers where it came from. Hidden while it had the keyboard, the
 * keyboard goes back there, or to the Chops button when that is gone.
 * Hidden while the keyboard is elsewhere, the keyboard stays where it is.
 * Answers whether the panel showed or hid.
 */
export function toggleChopsPanel(store: AppStore): boolean {
	const wasOpen = store.getState().layout.chopsOpen;
	if (!wasOpen) {
		const active = document.activeElement;
		if (!store.toggleChopsPanel()) return false;
		returnTo = active instanceof HTMLElement && active !== document.body ? active : null;
		focusOnShow = true;
		// Drawn already when React rendered at once; otherwise the panel takes focus as it mounts.
		takeFocus();
		return true;
	}
	const hadFocus = panelElement()?.contains(document.activeElement) ?? false;
	if (!store.toggleChopsPanel()) return false;
	if (hadFocus) giveFocusBack();
	return true;
}

/** Hide the panel from its Close button, which only hides it. The keyboard goes back where it came from. */
export function hideChopsPanel(store: AppStore): void {
	const hadFocus = panelElement()?.contains(document.activeElement) ?? false;
	store.hideChopsPanel();
	if (hadFocus) giveFocusBack();
}

function takeFocus(): void {
	const panel = panelElement();
	if (!focusOnShow || panel === null) return;
	focusOnShow = false;
	panel.focus();
}

function giveFocusBack(): void {
	const target = returnTo !== null && returnTo.isConnected ? returnTo : document.getElementById(CHOPS_BUTTON_ID);
	returnTo = null;
	focusOnShow = false;
	target?.focus();
}

/**
 * The panel's width as drawn, which the stylesheet keeps under a third of
 * the window, or the saved width when it is not drawn. A resize steps from
 * this, so a key or a drag always changes what is on screen.
 */
function drawnWidth(saved: number): number {
	const drawn = panelElement()?.getBoundingClientRect().width;
	return drawn === undefined || drawn <= 0 ? saved : Math.min(saved, Math.round(drawn));
}

/**
 * The chops panel's left edge, between the workspace and the panel. Drag it,
 * or focus it and use the arrow keys, Home, and End, as the sidebar's edge.
 * The width follows at once and is saved when the drag ends or the key is
 * let go.
 */
export function ChopsResizer() {
	const store = useStore();
	const width = useAppState().layout.chopsWidth;
	const drag = useRef<{ x: number; width: number } | null>(null);
	const [dragging, setDragging] = useState(false);

	const startDrag = (event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		// From the width on screen: a narrow window can draw the panel narrower than the saved width.
		drag.current = { x: event.clientX, width: drawnWidth(store.getState().layout.chopsWidth) };
		setDragging(true);
	};
	const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
		const start = drag.current;
		if (start) store.resizeChopsPanel(chopsWidthAfterDrag(start.width, event.clientX - start.x));
	};
	const endDrag = () => {
		if (!drag.current) return;
		drag.current = null;
		setDragging(false);
		void store.saveLayout();
	};
	const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		// From the store, not from the last render: keys can arrive faster than the window is drawn again.
		const next = chopsWidthAfterKey(drawnWidth(store.getState().layout.chopsWidth), event.key);
		if (next === null) return;
		event.preventDefault();
		store.resizeChopsPanel(next);
	};

	return (
		<div
			className={dragging ? "resizer chops-resizer dragging" : "resizer chops-resizer"}
			role="separator"
			aria-orientation="vertical"
			aria-label={CHOPS_WIDTH_LABEL}
			aria-controls={CHOPS_PANEL_ID}
			aria-valuemin={MIN_CHOPS_WIDTH}
			aria-valuemax={MAX_CHOPS_WIDTH}
			aria-valuenow={width}
			aria-valuetext={`${width} pixels`}
			title="Drag to resize the chops panel, or focus this and use the arrow keys"
			tabIndex={0}
			onPointerDown={startDrag}
			onPointerMove={moveDrag}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			onLostPointerCapture={endDrag}
			onKeyDown={onKeyDown}
			onKeyUp={() => void store.saveLayout()}
			onBlur={() => void store.saveLayout()}
		/>
	);
}

/**
 * The chops panel, on the right of the workspace. For now it lists the
 * chops of the selected worktree's repository by name; running, making,
 * and ordering them come with the panel's later work. Its Close button only
 * hides it: the saved chops and "Use chops" stay as they are.
 */
export function ChopsPanel() {
	const store = useStore();
	const state = useAppState();
	const titleId = useId();
	// Shown by the button or the shortcut before React drew it: take the keyboard now.
	useEffect(() => takeFocus(), []);
	const selected = selectedWorktree(state);
	const repository = selected?.repository.path ?? null;
	const list = state.chops !== null && state.chops.repository === repository ? state.chops.list : null;
	const chops = listedChops(list);
	const failure = list !== null && list.outcome !== "listed" ? list.message : null;
	const empty = failure === null ? describeChopsPanelEmpty(selected !== null, list === null ? null : chops.length) : null;
	return (
		<aside id={CHOPS_PANEL_ID} className="chops-panel" aria-labelledby={titleId} tabIndex={-1}>
			<div className="chops-panel-head">
				<h2 id={titleId} className="chops-panel-title">{CHOPS_PANEL_TITLE}</h2>
				<button type="button" className="icon-button chops-panel-close" aria-label={CHOPS_CLOSE_LABEL} title={CHOPS_CLOSE_LABEL} onClick={() => hideChopsPanel(store)}>
					<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
						<path d="M4 4l8 8M12 4l-8 8" />
					</svg>
				</button>
			</div>
			<div className="chops-panel-body">
				{failure !== null && <p className="dialog-note">{failure}</p>}
				{empty !== null && <p className="dialog-note" role={list === null && selected !== null ? "status" : undefined}>{empty}</p>}
				{chops.length > 0 && (
					<ul className="chops-panel-list" aria-label={`Chops of ${selected?.repository.name ?? "the repository"}`}>
						{chops.map(chop => (
							<li key={chop.name} className="chops-panel-item">
								<p className="chop-item-head">
									<span className="chop-item-name">{chop.name}</span>{" "}
									<span className="chop-item-meta">{chopKindWord(chop.kind)}, {describeChopSource(chop.source)}</span>
								</p>
								<pre className="chops-panel-text">{chop.text}</pre>
							</li>
						))}
					</ul>
				)}
			</div>
		</aside>
	);
}

/**
 * Shows or hides the chops panel from the keyboard, as the title bar's
 * Chops button does. It draws nothing. It listens on the window in the
 * capture phase, so it hears the keys of a focused terminal too. The key is
 * taken from the page only when it showed or hid the panel: with chops off,
 * a dialog open, or Timber not ready, it goes on as if the app had no such
 * key.
 */
export function ChopsShortcut() {
	const store = useStore();
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!takesChopsPanelKey(event, store.getState())) return;
			event.preventDefault();
			// A held chord shows or hides the panel once.
			if (!event.repeat) toggleChopsPanel(store);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [store]);
	return null;
}
