import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import type { ChildStatus } from "../../shared/program-status";
import { type ChildRow, type ShownStatus, childRows, describeShownStatus, describeTaskCount, shortMessage, shownChildStatus, summarizeChildren } from "../../shared/session-status";
import type { TerminalSession } from "../../shared/terminal";
import { sessionChipId } from "../terminal-format";
import { StatusGlyph } from "./StatusGlyph";

/** The most children the list shows; the rest are counted below it. */
export const CHILD_ROWS_SHOWN = 50;

/**
 * The small count beside a session's mark, on its sidebar row and its chip:
 * the shape of the most urgent state among the children that run or reported
 * an error, and how many they are, such as a diamond and "3" when one of
 * three needs the person. Hidden from
 * assistive technology: the row's and the chip's descriptions say it.
 */
export function ChildBadge({ badge }: { badge: { count: number; status: ShownStatus } }) {
	return (
		<span className={`child-badge status-${badge.status.kind}`} aria-hidden="true">
			<StatusGlyph status={badge.status} />
			{badge.count}
		</span>
	);
}

interface TreeNode {
	row: ChildRow;
	under: TreeNode[];
}

/** The rows as a tree: each row sits under the nearest one before it with a smaller depth, as `childRows` orders them. */
function nest(rows: readonly ChildRow[]): TreeNode[] {
	const top: TreeNode[] = [];
	const path: TreeNode[] = [];
	for (const row of rows) {
		const node: TreeNode = { row, under: [] };
		path.length = row.depth;
		(row.depth === 0 ? top : path[row.depth - 1]!.under).push(node);
		path[row.depth] = node;
	}
	return top;
}

function ChildItem({ node }: { node: TreeNode }) {
	const { child, label } = node.row;
	const status = shownChildStatus(child);
	return (
		<li className="child-task">
			<span className="child-task-line">
				<span className={`child-task-mark status-${status.kind}`}><StatusGlyph status={status} /></span>
				<span className="child-task-name" title={child.id}>{label}</span>
				<span className="child-task-state">{describeShownStatus(status)}</span>
			</span>
			{child.message !== null && <span className="child-task-message">{shortMessage(child.message)}</span>}
			{node.under.length > 0 && <ul className="child-task-list" role="list">{node.under.map(under => <ChildItem key={under.row.child.id} node={under} />)}</ul>}
		</li>
	);
}

/**
 * The rows to list when there are more than `limit`: first every one that
 * needs the person or reported an error, with the rows it sits under, so the
 * task the count points at is always there; then the rest by path, until
 * the limit. They keep their order by path.
 */
export function rowsToShow(rows: readonly ChildRow[], limit: number = CHILD_ROWS_SHOWN): ChildRow[] {
	if (rows.length <= limit) return [...rows];
	const ids = new Set(rows.map(row => row.child.id));
	const chosen = new Set<string>();
	const choose = (id: string) => {
		// The rows a row sits under come with it, so the tree stays whole.
		const segments = id.split("/");
		const wanted = segments.map((_, index) => segments.slice(0, index + 1).join("/")).filter(path => ids.has(path) && !chosen.has(path));
		if (chosen.size + wanted.length > limit) return;
		for (const path of wanted) chosen.add(path);
	};
	for (const row of rows) if (row.child.state === "blocked" || row.child.state === "error") choose(row.child.id);
	for (const row of rows) if (chosen.size < limit) choose(row.child.id);
	return rows.filter(row => chosen.has(row.child.id));
}

/** The children as nested lists by path, at most `CHILD_ROWS_SHOWN` of them, then how many more there are. */
export function ChildTaskList({ tasks }: { tasks: readonly ChildStatus[] }) {
	const rows = childRows(tasks);
	const shown = rowsToShow(rows);
	const more = rows.length - shown.length;
	return (
		<>
			<ul className="child-task-list" role="list">{nest(shown).map(node => <ChildItem key={node.row.child.id} node={node} />)}</ul>
			{more > 0 && <p className="child-tasks-more">and {more} more</p>}
		</>
	);
}

/**
 * The shown session's children, such as its subagents and background tasks:
 * a button beside its state that opens a list of them as a tree by path, each
 * with its state, progress, title, and message, all as text. Escape, the
 * button again, or a click elsewhere puts the list away. The list takes the
 * keyboard when it opens, so a long one scrolls by keys. Nothing for a
 * session with no children, or one that exited.
 */
export function ChildTasks({ session }: { session: TerminalSession }) {
	const listId = useId();
	const [open, setOpen] = useState(false);
	const button = useRef<HTMLButtonElement>(null);
	const list = useRef<HTMLDivElement>(null);
	const children: readonly ChildStatus[] = session.state.kind === "running" ? session.children : [];
	const shown = children.length > 0;

	/** The list has the keyboard, so it goes to the session's chip should the list vanish with the tasks. */
	const focusInside = useRef(false);
	useEffect(() => {
		if (shown) return;
		setOpen(false);
		if (focusInside.current) document.getElementById(sessionChipId(session.id))?.focus();
		focusInside.current = false;
	}, [shown, session.id]);
	useEffect(() => {
		if (!open) return;
		// The list takes the keyboard, so the arrows and Page keys scroll a long one, and Escape gives it back.
		list.current?.focus();
		const away = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (target && !list.current?.contains(target) && !button.current?.contains(target)) setOpen(false);
		};
		document.addEventListener("pointerdown", away);
		return () => {
			document.removeEventListener("pointerdown", away);
			focusInside.current = false;
		};
	}, [open]);

	if (!shown) return null;
	const summary = summarizeChildren(session);
	const label = `${describeTaskCount(children.length)} of ${session.name}, ${summary === "" ? "none running" : summary}`;

	const onListKey = (event: KeyboardEvent<HTMLDivElement>) => {
		// Keys here are the list's: none of them may reach the chips or a terminal.
		event.stopPropagation();
		if (event.key === "Escape") {
			event.preventDefault();
			setOpen(false);
			button.current?.focus();
		}
	};

	return (
		<span className="child-tasks-anchor">
			<button
				ref={button}
				type="button"
				className="text-button child-tasks-button"
				aria-expanded={open}
				aria-controls={open ? listId : undefined}
				title={`${label}. ${open ? "Hide" : "Show"} the list`}
				aria-label={label}
				onClick={() => {
					// WebKit does not focus a clicked button, so it is given the keyboard back here.
					if (open) button.current?.focus();
					setOpen(!open);
				}}
				onKeyDown={event => {
					if (event.key === "Escape" && open) {
						event.preventDefault();
						event.stopPropagation();
						setOpen(false);
					}
				}}
			>
				{describeTaskCount(children.length)}
			</button>
			{open && (
				<div ref={list} className="child-tasks" id={listId} role="group" aria-label={`Tasks of ${session.name}`} tabIndex={-1} onKeyDown={onListKey}
					onFocus={() => (focusInside.current = true)}
					onBlur={event => {
						// Focus going nowhere, as when the list is taken away under it, is not leaving: the chip gets it then.
						const next = event.relatedTarget as Node | null;
						if (next === null) return;
						focusInside.current = false;
						// Tab out of the list puts it away, so it does not stay over the terminal with the keyboard elsewhere.
						if (!list.current?.contains(next) && !button.current?.contains(next)) setOpen(false);
					}}
				>
					<ChildTaskList tasks={children} />
				</div>
			)}
		</span>
	);
}
