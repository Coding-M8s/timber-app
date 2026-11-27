import { type KeyboardEvent, type ReactNode, type Ref, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { tagColorVariable } from "../../shared/worktree-tags";
import { type WorktreeMenuItem, type WorktreeMenuItemId, placeMenu, worktreeMenuKeyAction } from "../worktree-menu-format";

/** An entry of a menu drawn here. A worktree's menu has `WorktreeMenuItem`s; a repository's menu has its own ids. */
export type MenuEntry<Id extends string = WorktreeMenuItemId> = Omit<WorktreeMenuItem, "id" | "submenu"> & {
	id: Id;
	/** The entries of the menu this entry opens beside it. */
	submenu?: { label: string; items: readonly MenuEntry<Id>[] };
};

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
	/** The position of the entry whose menu is open beside it, and that menu, drawn inside this one's entry. */
	open?: { index: number; menu: ReactNode } | null;
	/** Open the menu of the entry at this position, as a click or the pointer resting on it does. */
	onOpen?: (index: number) => void;
	/** The pointer came onto the entry at this position. */
	onPoint?: (index: number) => void;
	/** Drawn as a menu opened beside an entry. */
	inner?: boolean;
}

export const worktreeMenuItemId = (idBase: string, index: number) => `${idBase}-item-${index}`;

/** The mark before an entry's label: a tag color, or an empty ring for No color. Its words are the label. */
function Swatch({ swatch }: { swatch: NonNullable<MenuEntry["swatch"]> }) {
	return <span className={swatch === "none" ? "tag-swatch none" : "tag-swatch"} style={swatch === "none" ? undefined : { background: tagColorVariable(swatch) }} aria-hidden="true" />;
}

/**
 * How a worktree row's menu looks. Stateless, so it can be drawn without a
 * window. A disabled entry stays focusable, as menus do, and says why under it.
 * No entry has a tooltip, which would cover the menu; what an entry does is
 * its description, for assistive technology. An entry with a menu of its own
 * says so, and draws that menu beside it while it is open; an entry of a
 * choice of one, such as a tag, is a radio item that says whether it is chosen.
 */
export function WorktreeMenuView<Id extends string = WorktreeMenuItemId>({ label, items, at, menuRef, idBase, onChoose, onKeyDown, open = null, onOpen, onPoint, inner = false }: WorktreeMenuViewProps<Id>) {
	return (
		<div
			ref={menuRef}
			className={inner ? "worktree-menu worktree-submenu" : "worktree-menu"}
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
				// No tooltip: it would cover the menu. The note shows; the description is for assistive technology only.
				const description = item.note === null ? item.description : null;
				const descriptionId = `${idBase}-description-${index}`;
				const opens = item.submenu !== undefined;
				return (
					// Only menu items and their notes are inside a menu; the wrapper and the note have no role of their own.
					<div key={item.id} className="worktree-menu-entry" role="none">
						<button
							type="button"
							role={item.checked === undefined ? "menuitem" : "menuitemradio"}
							id={worktreeMenuItemId(idBase, index)}
							className={opens ? "session-menu-item worktree-menu-item opens" : "session-menu-item worktree-menu-item"}
							tabIndex={-1}
							aria-disabled={item.disabled || undefined}
							aria-checked={item.checked}
							aria-haspopup={opens ? "menu" : undefined}
							aria-expanded={opens ? open?.index === index : undefined}
							aria-describedby={item.note !== null ? noteId : description !== null ? descriptionId : undefined}
							onClick={() => (opens ? onOpen?.(index) : onChoose?.(item.id))}
							onPointerEnter={() => onPoint?.(index)}
						>
							{item.swatch !== undefined && <Swatch swatch={item.swatch} />}
							<span className="session-menu-label">{item.label}</span>
							{item.checked && <span className="worktree-menu-check" aria-hidden="true">{"\u2713"}</span>}
							{opens && <span className="worktree-menu-more" aria-hidden="true">{"\u203a"}</span>}
						</button>
						{item.note !== null && <p id={noteId} className="worktree-menu-note" role="none">{item.note}</p>}
						{description !== null && <span id={descriptionId} hidden>{description}</span>}
						{open?.index === index && open.menu}
					</div>
				);
			})}
		</div>
	);
}

/** Where a menu opened beside an entry goes: right of its menu, else left of it, and inside the window. */
export function placeSubmenu(menu: { left: number; right: number }, entryTop: number, size: { width: number; height: number }, window: { width: number; height: number }): { left: number; top: number } {
	const right = menu.right - 2;
	const left = right + size.width <= window.width - 4 ? right : menu.left - size.width + 2;
	return placeMenu({ left, top: entryTop - 5 }, size, window);
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
 * disabled entry does nothing and leaves the menu open. An entry with a menu
 * of its own opens it beside it with a click, Enter, Space, Right, or the
 * pointer resting on it; in there, Left and Escape go back to the entry.
 */
export function WorktreeMenu<Id extends string = WorktreeMenuItemId>({ label, items, at, onClose, onChoose, start = "first" }: WorktreeMenuProps<Id>) {
	const idBase = useId();
	const innerBase = useId();
	const menu = useRef<HTMLDivElement>(null);
	const inner = useRef<HTMLDivElement>(null);
	const close = useRef(onClose);
	close.current = onClose;
	// The entry whose menu is open beside it, and whether the keyboard went in with it.
	const [open, setOpen] = useState<{ index: number; keyboard: boolean } | null>(null);

	// Kept inside the window, before it shows.
	useLayoutEffect(() => {
		const element = menu.current;
		if (!element) return;
		const box = element.getBoundingClientRect();
		const placed = placeMenu(at, { width: box.width, height: box.height }, { width: window.innerWidth, height: window.innerHeight });
		element.style.left = `${placed.left}px`;
		element.style.top = `${placed.top}px`;
	}, [at]);

	// The inner menu goes beside its entry, and takes the keyboard when it was opened from the keyboard.
	useLayoutEffect(() => {
		const element = inner.current;
		const owner = menu.current;
		if (!element || !owner || open === null) return;
		const entry = document.getElementById(worktreeMenuItemId(idBase, open.index));
		const box = element.getBoundingClientRect();
		const ownerBox = owner.getBoundingClientRect();
		const placed = placeSubmenu({ left: ownerBox.left, right: ownerBox.right }, entry?.getBoundingClientRect().top ?? ownerBox.top, { width: box.width, height: box.height }, { width: window.innerWidth, height: window.innerHeight });
		element.style.left = `${placed.left}px`;
		element.style.top = `${placed.top}px`;
		if (open.keyboard) {
			const entries = items[open.index]?.submenu?.items ?? [];
			const checked = Math.max(0, entries.findIndex(entry => entry.checked));
			document.getElementById(worktreeMenuItemId(innerBase, checked))?.focus();
		}
	}, [open, idBase, innerBase, items]);

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
		const all = items.flatMap(item => [item, ...(item.submenu?.items ?? [])]);
		const item = all.find(candidate => candidate.id === id);
		if (item?.disabled !== false || item.submenu !== undefined) return;
		close.current(true);
		onChoose(id);
	};

	const openAt = (index: number, keyboard: boolean) => {
		if (items[index]?.submenu === undefined || items[index]?.disabled) return;
		setOpen({ index, keyboard });
	};

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		// Keys here are the menu's: none of them may reach the row or the sidebar.
		event.stopPropagation();
		const ids = items.map((_, index) => worktreeMenuItemId(idBase, index));
		const at = ids.indexOf(document.activeElement?.id ?? "");
		const index = at === -1 ? 0 : at;
		const action = worktreeMenuKeyAction(items.length, index, event.key, { opens: items[index]?.submenu !== undefined });
		if (action?.kind === "move") {
			event.preventDefault();
			setOpen(null);
			document.getElementById(ids[action.index]!)?.focus();
		} else if (action?.kind === "open") {
			event.preventDefault();
			openAt(index, true);
		} else if (action?.kind === "close") {
			// The focused entry goes with the menu. Tab keeps its own use, so it moves on from the row.
			if (action.preventDefault) event.preventDefault();
			close.current(true);
		}
	};

	const entries = open === null ? [] : items[open.index]?.submenu?.items ?? [];
	const onInnerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		// The outer menu never hears these keys too.
		event.stopPropagation();
		if (open === null) return;
		const ids = entries.map((_, index) => worktreeMenuItemId(innerBase, index));
		const at = ids.indexOf(document.activeElement?.id ?? "");
		const action = worktreeMenuKeyAction(entries.length, at === -1 ? 0 : at, event.key, { inner: true });
		if (action?.kind === "move") {
			event.preventDefault();
			document.getElementById(ids[action.index]!)?.focus();
		} else if (action?.kind === "back") {
			event.preventDefault();
			const owner = open.index;
			setOpen(null);
			document.getElementById(worktreeMenuItemId(idBase, owner))?.focus();
		} else if (action?.kind === "close") {
			if (action.preventDefault) event.preventDefault();
			close.current(true);
		}
	};

	const submenu = open === null ? null : items[open.index]?.submenu;
	return (
		<WorktreeMenuView
			label={label}
			items={items}
			at={at}
			menuRef={menu}
			idBase={idBase}
			onChoose={choose}
			onKeyDown={onKeyDown}
			onOpen={index => openAt(index, true)}
			// Resting on an entry with a menu opens it, without taking the keyboard; resting on another closes it.
			onPoint={index => (items[index]?.submenu !== undefined ? openAt(index, false) : setOpen(null))}
			open={open === null || !submenu ? null : {
				index: open.index,
				menu: <WorktreeMenuView label={submenu.label} items={submenu.items} at={{ left: 0, top: 0 }} menuRef={inner} idBase={innerBase} onChoose={choose} onKeyDown={onInnerKeyDown} inner />,
			}}
		/>
	);
}
