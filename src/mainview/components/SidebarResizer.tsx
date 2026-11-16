import { type KeyboardEvent, type PointerEvent, useRef, useState } from "react";
import { MAX_SIDEBAR_WIDTH, MIN_SIDEBAR_WIDTH } from "../../shared/layout";
import { sidebarWidthAfterKey } from "../shell";
import { useAppState, useStore } from "../store/react";

/** The `id` of the sidebar, which the handle says it controls. */
export const SIDEBAR_ID = "sidebar";

/**
 * The sidebar's edge. Drag it, or focus it and use the arrow keys, Home, and
 * End. The width follows on screen at once and is saved when the drag ends or
 * the key is let go, never while it moves.
 */
export function SidebarResizer() {
	const store = useStore();
	const width = useAppState().layout.sidebarWidth;
	const drag = useRef<{ x: number; width: number } | null>(null);
	const [dragging, setDragging] = useState(false);

	const startDrag = (event: PointerEvent<HTMLDivElement>) => {
		if (event.button !== 0) return;
		// Keeps the drag from selecting text on the way.
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		drag.current = { x: event.clientX, width };
		setDragging(true);
	};
	const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
		const start = drag.current;
		if (start) store.resizeSidebar(start.width + event.clientX - start.x);
	};
	const endDrag = () => {
		if (!drag.current) return;
		drag.current = null;
		setDragging(false);
		void store.saveLayout();
	};
	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		// From the store, not from the last render: keys can arrive faster than the window is drawn again.
		const next = sidebarWidthAfterKey(store.getState().layout.sidebarWidth, event.key);
		if (next === null) return;
		event.preventDefault();
		store.resizeSidebar(next);
	};

	return (
		<div
			className={dragging ? "resizer dragging" : "resizer"}
			role="separator"
			aria-orientation="vertical"
			aria-label="Sidebar width"
			aria-controls={SIDEBAR_ID}
			aria-valuemin={MIN_SIDEBAR_WIDTH}
			aria-valuemax={MAX_SIDEBAR_WIDTH}
			aria-valuenow={width}
			aria-valuetext={`${width} pixels`}
			title="Drag to resize the sidebar, or focus this and use the arrow keys"
			tabIndex={0}
			onPointerDown={startDrag}
			onPointerMove={moveDrag}
			onPointerUp={endDrag}
			onPointerCancel={endDrag}
			onLostPointerCapture={endDrag}
			onKeyDown={onKeyDown}
			// Saving is a no-op when the width did not change, so every key and every loss of focus may ask.
			onKeyUp={() => void store.saveLayout()}
			onBlur={() => void store.saveLayout()}
		/>
	);
}
