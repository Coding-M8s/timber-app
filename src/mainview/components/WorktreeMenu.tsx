import { type KeyboardEvent, type Ref, useEffect, useId, useLayoutEffect, useRef } from "react";
import { type WorktreeMenuItem, type WorktreeMenuItemId, placeMenu, worktreeMenuKeyAction } from "../worktree-menu-format";

/** An entry of a menu drawn here. A worktree's menu has `WorktreeMenuItem`s; a repository's menu has its own ids. */
export type MenuEntry<Id extends string = WorktreeMenuItemId> = Omit<WorktreeMenuItem, "id"> & { id: Id };

export interface WorktreeMenuViewProps<Id extends string = WorktreeMenuItemId> {
	/** The menu's name, such as "Actions for feat-x". */
	label: string;
	items: readonly MenuEntry<Id>[];
	/** Where the menu asked to be, in window pixels. It is moved inside the window once it is drawn. */
	at: { left: number; top: number };
	menuRef?: Ref<HTMLDivElement>;
	idBase: string;
	onChoose?: (id: Id) => void;
	onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export const worktreeMenuItemId = (idBase: string, index: number) => `${idBase}-item-${index}`;

/**
 * How a worktree row's menu looks. Stateless, so it can be drawn without a
 * window. A disabled entry stays focusable, as menus do, and says why under it.
 */
export function WorktreeMenuView<Id extends string = WorktreeMenuItemId>({ label, items, at, menuRef, idBase, onChoose, onKeyDown }: WorktreeMenuViewProps<Id>) {
	return (
		<div
			ref={menuRef}
			className="worktree-menu"
			role="menu"
			aria-label={label}
			style={{ left: at.left, top: at.top }}
			onKeyDown={onKeyDown}
			// The webview's own menu never shows over this one.
			onContextMenu={event => {
				event.preventDefault();
				event.stopPropagation();
			}}
		>
			{items.map((item, index) => {
				const noteId = `${idBase}-note-${index}`;
				return (
					// Only menu items and their notes are inside a menu; the wrapper and the note have no role of their own.
					<div key={item.id} className="worktree-menu-entry" role="none">
						<button
							type="button"
							role="menuitem"
							id={worktreeMenuItemId(idBase, index)}
							className="session-menu-item worktree-menu-item"
							tabIndex={-1}
							title={item.title}
							aria-disabled={item.disabled || undefined}
							aria-describedby={item.note === null ? undefined : noteId}
							onClick={() => onChoose?.(item.id)}
						>
							<span className="session-menu-label">{item.label}</span>
						</button>
						{item.note !== null && <p id={noteId} className="worktree-menu-note" role="none">{item.note}</p>}
					</div>
				);
			})}
		</div>
	);
}

interface WorktreeMenuProps<Id extends string> {
	label: string;
	items: readonly MenuEntry<Id>[];
	at: { left: number; top: number };
	/**
	 * Puts the menu away. `backToRow` gives the keyboard back to the row, as
	 * Escape does and as choosing does before a dialog opens, so the dialog
	 * hands it back to the row when it closes.
	 */
	onClose: (backToRow: boolean) => void;
	/** An enabled entry was chosen. The menu is already closed and the row has the keyboard. */
	onChoose: (id: Id) => void;
	/** The entry that has the keyboard when it opens: the first, unless it was opened with Up. */
	start?: "first" | "last";
}

/**
 * A worktree row's menu, open. The arrows, Home, and End move through it and
 * wrap; Escape closes it and gives the keyboard back to the row; Tab, a click
 * elsewhere, scrolling, resizing, or leaving the window put it away. A
 * disabled entry does nothing and leaves the menu open.
 */
export function WorktreeMenu<Id extends string = WorktreeMenuItemId>({ label, items, at, onClose, onChoose, start = "first" }: WorktreeMenuProps<Id>) {
	const idBase = useId();
	const menu = useRef<HTMLDivElement>(null);
	const close = useRef(onClose);
	close.current = onClose;

	// Kept inside the window, before it shows.
	useLayoutEffect(() => {
		const element = menu.current;
		if (!element) return;
		const box = element.getBoundingClientRect();
		const placed = placeMenu(at, { width: box.width, height: box.height }, { width: window.innerWidth, height: window.innerHeight });
		element.style.left = `${placed.left}px`;
		element.style.top = `${placed.top}px`;
	}, [at]);

	const first = start === "last" ? Math.max(0, items.length - 1) : 0;
	useEffect(() => {
		document.getElementById(worktreeMenuItemId(idBase, first))?.focus();
		// Only on opening: the entries may change while it is open, and the keyboard stays where it is.
	}, [idBase]);

	useEffect(() => {
		const inside = (target: EventTarget | null) => target instanceof Node && menu.current?.contains(target) === true;
		// A click elsewhere puts the keyboard where it clicked, so the menu only goes.
		const away = (event: Event) => {
			if (!inside(event.target)) close.current(false);
		};
		// Anything else that puts the menu away gives the keyboard back to the row, if the menu had it.
		const leave = () => close.current(inside(document.activeElement));
		// Only a scroll that moves the row, of the sidebar, its list, or the page, would leave the menu behind.
		const scrolled = (event: Event) => {
			const target = event.target;
			const moved = target === document || (target instanceof Node && menu.current !== null && target.contains(menu.current));
			if (moved) leave();
		};
		document.addEventListener("pointerdown", away, true);
		window.addEventListener("scroll", scrolled, true);
		window.addEventListener("resize", leave);
		window.addEventListener("blur", leave);
		return () => {
			document.removeEventListener("pointerdown", away, true);
			window.removeEventListener("scroll", scrolled, true);
			window.removeEventListener("resize", leave);
			window.removeEventListener("blur", leave);
		};
	}, []);

	const choose = (id: Id) => {
		if (items.find(item => item.id === id)?.disabled !== false) return;
		close.current(true);
		onChoose(id);
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		// Keys here are the menu's: none of them may reach the row or the sidebar.
		event.stopPropagation();
		const ids = items.map((_, index) => worktreeMenuItemId(idBase, index));
		const at = ids.indexOf(document.activeElement?.id ?? "");
		const action = worktreeMenuKeyAction(items.length, at === -1 ? 0 : at, event.key);
		if (action?.kind === "move") {
			event.preventDefault();
			document.getElementById(ids[action.index]!)?.focus();
		} else if (action?.kind === "close") {
			// The focused entry goes with the menu. Tab keeps its own use, so it moves on from the row.
			if (action.preventDefault) event.preventDefault();
			close.current(true);
		}
	};

	return <WorktreeMenuView label={label} items={items} at={at} menuRef={menu} idBase={idBase} onChoose={choose} onKeyDown={onKeyDown} />;
}
