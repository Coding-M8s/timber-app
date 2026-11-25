import { type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from "react";
import type { Worktree } from "../../shared/model";
import { DRAG_THRESHOLD, moveStep, worktreeDropPlace, worktreeStaysPut } from "../repository-drag";
import { useStore } from "../store/react";

export interface WorktreeRowsProps {
	/** The path of the repository the rows belong to. They never move out of it. */
	repository: string;
	/** The rows that move among each other, top to bottom as shown. */
	worktrees: readonly Worktree[];
	/** Whether they can be moved: no filter is typed and there are at least two. */
	movable: boolean;
	/** What comes first in the list and never moves: the Issues row. */
	first?: ReactNode;
	/** The row of one worktree. */
	render: (worktree: Worktree) => ReactNode;
}

/** A press on a row that has not moved far enough to be a drag yet, or the drag it became. */
interface Press {
	path: string;
	pointerId: number;
	startY: number;
	dragging: boolean;
}

/**
 * The plain rows of a repository, with the Issues row above them. A row can be
 * dragged to a new place among them, or moved a place with Alt+Up and
 * Alt+Down. The places are the other rows of this list and nothing else, so
 * a row never leaves its repository, the Issues row, or its arena. The ones
 * that came before and after it are only drawn here, never measured.
 */
export function WorktreeRows({ repository, worktrees, movable, first, render }: WorktreeRowsProps) {
	const store = useStore();
	const list = useRef<HTMLUListElement>(null);
	const press = useRef<Press | null>(null);
	// The click that ends a drag must not also select the row. Only that one is swallowed.
	const dragEnded = useRef(false);
	const [drag, setDrag] = useState<{ path: string; before: string | null } | null>(null);

	const rowOf = (path: string) => [...(list.current?.querySelectorAll<HTMLElement>("li[data-row-path]") ?? [])].find(item => item.dataset.rowPath === path);

	/** The row the pointer is at, among the others: the path it would go before, or null for the end. */
	const placeAt = (path: string, y: number): string | null => {
		const slots = worktrees.filter(worktree => worktree.path !== path).flatMap(worktree => {
			const box = rowOf(worktree.path)?.getBoundingClientRect();
			return box ? [{ path: worktree.path, middle: box.top + box.height / 2 }] : [];
		});
		return worktreeDropPlace(slots, y);
	};

	function onPointerDown(path: string, event: PointerEvent<HTMLLIElement>) {
		// Whatever press was left over, such as one released outside the list, is over.
		press.current = null;
		if (event.button !== 0 || !movable) return;
		// A control beside the row's button, such as its pull request or Pull, is pressed, not dragged.
		const control = (event.target as Element).closest("button, a, input");
		if (control && !control.classList.contains("row")) return;
		press.current = { path, pointerId: event.pointerId, startY: event.clientY, dragging: false };
	}

	function onPointerMove(event: PointerEvent<HTMLLIElement>) {
		const current = press.current;
		if (!current || current.pointerId !== event.pointerId) return;
		// The button was let go where this list heard nothing: that was the end of the press.
		if ((event.buttons & 1) === 0) {
			press.current = null;
			if (drag) setDrag(null);
			return;
		}
		if (!current.dragging) {
			if (Math.abs(event.clientY - current.startY) < DRAG_THRESHOLD) return;
			current.dragging = true;
			event.currentTarget.setPointerCapture(event.pointerId);
		}
		const before = placeAt(current.path, event.clientY);
		if (drag?.path !== current.path || drag.before !== before) setDrag({ path: current.path, before });
	}

	function onPointerUp(event: PointerEvent<HTMLLIElement>) {
		const current = press.current;
		if (!current || current.pointerId !== event.pointerId) return;
		press.current = null;
		setDrag(null);
		if (!current.dragging) return;
		dragEnded.current = true;
		setTimeout(() => {
			dragEnded.current = false;
		}, 0);
		void store.moveWorktree(repository, current.path, placeAt(current.path, event.clientY));
	}

	function onPointerCancel() {
		press.current = null;
		setDrag(null);
	}

	function onKeyDown(path: string, event: KeyboardEvent<HTMLLIElement>) {
		// Only the row's own button: a control beside it keeps its keys.
		if (!movable || !(event.target as Element).classList.contains("row")) return;
		const step = moveStep(event);
		if (step === 0) return;
		event.preventDefault();
		void store.stepWorktree(repository, path, step);
		// The row was moved in the page, so give it the keyboard back.
		requestAnimationFrame(() => rowOf(path)?.querySelector<HTMLElement>(".row")?.focus());
	}

	const paths = worktrees.map(worktree => worktree.path);
	const mark = drag && !worktreeStaysPut(paths, drag.path, drag.before) ? drag : null;
	const last = paths[paths.length - 1];
	return (
		<ul className="rows" ref={list}>
			{first}
			{worktrees.map(worktree => {
				const marks = [
					drag?.path === worktree.path ? "dragging" : "",
					mark && mark.before === worktree.path ? "drop-before" : "",
					mark && mark.before === null && worktree.path === last ? "drop-after" : "",
				].filter(Boolean).join(" ");
				return (
					<li
						key={worktree.id}
						data-row-path={worktree.path}
						className={marks === "" ? undefined : marks}
						onPointerDown={event => onPointerDown(worktree.path, event)}
						onPointerMove={onPointerMove}
						onPointerUp={onPointerUp}
						onPointerCancel={onPointerCancel}
						onKeyDown={event => onKeyDown(worktree.path, event)}
						onClickCapture={event => {
							if (!dragEnded.current) return;
							dragEnded.current = false;
							event.preventDefault();
							event.stopPropagation();
						}}
					>
						{render(worktree)}
					</li>
				);
			})}
		</ul>
	);
}
