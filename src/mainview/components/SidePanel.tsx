import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, useEffect, useRef, useState } from "react";
import { MAX_CHOPS_WIDTH, MIN_CHOPS_WIDTH, type SidePanelView } from "../../shared/layout";
import { CHOPS_BUTTON_ID, CHOPS_PANEL_ID, CHOPS_WIDTH_LABEL } from "../chops-panel-format";
import { FILES_BUTTON_ID, SIDE_PANEL_SWITCH_LABEL, SIDE_PANEL_VIEW_LABELS, sidePanelViewButtonId } from "../files-panel-format";
import { chopsWidthAfterDrag, chopsWidthAfterKey } from "../shell";
import { useAppState, useStore } from "../store/react";
import { chopsEnabled, sidePanelShown, sidePanelView } from "../store/state";
import type { AppStore } from "../store/store";

/*
 * The side panel beside the workspace, which shows the chops or the files
 * (see docs/architecture.md, "Chops panel" and "File explorer"). Each view
 * draws its own panel, with the same `id` and a `data-view`, and this module
 * keeps what they share: the keyboard as the panel shows, switches, and
 * hides, its edge, and the switch in its header.
 *
 * Where the keyboard goes is kept here, as the store knows nothing of the
 * page: the element that had focus when a button or a shortcut showed the
 * panel, and what should take focus once the view asked for is drawn. A
 * panel shown again at start-up, from the saved layout, takes nothing.
 */
let returnTo: HTMLElement | null = null;
let pendingFocus: { view: SidePanelView; on: "panel" | "switch" } | null = null;

function panelElement(): HTMLElement | null {
	return document.getElementById(CHOPS_PANEL_ID);
}

/** Focus what was asked for, once the panel of that view is drawn. Each view's panel calls this as it mounts. */
export function takeSidePanelFocus(view: SidePanelView): void {
	const panel = panelElement();
	if (pendingFocus === null || pendingFocus.view !== view || panel === null || panel.dataset.view !== view) return;
	const on = pendingFocus.on;
	pendingFocus = null;
	(on === "switch" ? document.getElementById(sidePanelViewButtonId(view)) ?? panel : panel).focus();
}

/** Ask a panel that mounts to take focus as it is drawn. */
export function useSidePanelFocus(view: SidePanelView): void {
	useEffect(() => takeSidePanelFocus(view), [view]);
}

function giveFocusBack(view: SidePanelView): void {
	const target = returnTo !== null && returnTo.isConnected ? returnTo : document.getElementById(view === "files" ? FILES_BUTTON_ID : CHOPS_BUTTON_ID);
	returnTo = null;
	pendingFocus = null;
	target?.focus();
}

/**
 * Show the side panel with this view, switch it to this view, or hide it
 * when it shows this view already, from a title bar button or a shortcut.
 * Shown or switched, it takes the keyboard, and remembers where the
 * keyboard came from when it was hidden. Hidden while it had the keyboard,
 * the keyboard goes back there, or to the view's button when that is gone.
 * Hidden while the keyboard is elsewhere, the keyboard stays where it is.
 * Answers whether the panel changed.
 */
export function toggleSidePanel(store: AppStore, view: SidePanelView): boolean {
	const before = store.getState();
	const wasShown = sidePanelShown(before);
	const active = document.activeElement;
	const hadFocus = panelElement()?.contains(active) ?? false;
	if (!store.toggleSidePanel(view)) return false;
	if (!sidePanelShown(store.getState())) {
		if (hadFocus) giveFocusBack(view);
		return true;
	}
	if (!wasShown) returnTo = active instanceof HTMLElement && active !== document.body ? active : null;
	pendingFocus = { view, on: "panel" };
	// Drawn already when React rendered at once; otherwise the panel takes focus as it mounts.
	takeSidePanelFocus(view);
	return true;
}

/** Switch the side panel to this view from the switch in its header. The keyboard stays on the switch. */
export function switchSidePanel(store: AppStore, view: SidePanelView): void {
	if (!store.switchSidePanel(view)) return;
	pendingFocus = { view, on: "switch" };
	takeSidePanelFocus(view);
}

/** Hide the panel from its Close button, which only hides it. The keyboard goes back where it came from. */
export function hideSidePanel(store: AppStore): void {
	const view = sidePanelView(store.getState());
	const hadFocus = panelElement()?.contains(document.activeElement) ?? false;
	store.hideChopsPanel();
	if (hadFocus) giveFocusBack(view);
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
 * The side panel's left edge, between the workspace and the panel. Drag it,
 * or focus it and use the arrow keys, Home, and End, as the sidebar's edge.
 * The width follows at once and is saved when the drag ends or the key is
 * let go. Both views share the width.
 */
export function SidePanelResizer() {
	const store = useStore();
	const state = useAppState();
	const width = state.layout.chopsWidth;
	const files = sidePanelView(state) === "files";
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
			aria-label={files ? "Files panel width" : CHOPS_WIDTH_LABEL}
			aria-controls={CHOPS_PANEL_ID}
			aria-valuemin={MIN_CHOPS_WIDTH}
			aria-valuemax={MAX_CHOPS_WIDTH}
			aria-valuenow={width}
			aria-valuetext={`${width} pixels`}
			title={`Drag to resize the ${files ? "files" : "chops"} panel, or focus this and use the arrow keys`}
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
 * The panel's title, and the switch between the chops and the files. With
 * chops off, only the title: the files are all the panel shows then.
 */
export function SidePanelTitle({ view, titleId, title }: { view: SidePanelView; titleId: string; title: string }) {
	const store = useStore();
	const state = useAppState();
	if (!chopsEnabled(state)) return <h2 id={titleId} className="chops-panel-title">{title}</h2>;
	return (
		<>
			<h2 id={titleId} className="visually-hidden">{title}</h2>
			<div className="side-panel-switch" role="group" aria-label={SIDE_PANEL_SWITCH_LABEL}>
				{(["chops", "files"] as const).map(option => (
					<button
						key={option}
						id={sidePanelViewButtonId(option)}
						type="button"
						className="side-panel-view"
						aria-pressed={option === view}
						onClick={() => switchSidePanel(store, option)}
					>
						{SIDE_PANEL_VIEW_LABELS[option]}
					</button>
				))}
			</div>
		</>
	);
}
