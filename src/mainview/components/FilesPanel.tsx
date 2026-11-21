import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { CHOPS_PANEL_ID } from "../chops-panel-format";
import { type TreeRow, keptFocus, treeKeyAction, treeRows } from "../file-tree";
import { FILES_CLOSE_LABEL, FILES_IGNORED_LABEL, FILES_PANEL_TITLE, describeFilesPanelEmpty, takesFilesPanelKey } from "../files-panel-format";
import { worktreeLabel } from "../format";
import { useAppState, useStore } from "../store/react";
import { selectedWorktree } from "../store/state";
import type { AppStore } from "../store/store";
import { SidePanelTitle, hideSidePanel, toggleSidePanel, useSidePanelFocus } from "./SidePanel";

/** Show the file explorer when it is hidden and hide it when it shows, from the title bar button or the shortcut (see ./SidePanel.tsx). */
export function toggleFilesPanel(store: AppStore): boolean {
	return toggleSidePanel(store, "files");
}

function Chevron({ open }: { open: boolean }) {
	return (
		<svg aria-hidden="true" className="files-tree-chevron" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
			<path d={open ? "M3 6l5 5 5-5" : "M6 3l5 5-5 5"} />
		</svg>
	);
}

/**
 * The selected worktree's files, in the side panel: a tree of its folders
 * that opens a file in the File tab. Folders are read as they open, and read
 * again when what is in them changes. It works by keyboard as a WAI-ARIA
 * tree: one row is a tab stop, the arrows move and open, Enter opens.
 */
export function FilesPanel() {
	const store = useStore();
	const state = useAppState();
	const titleId = useId();
	const treeRef = useRef<HTMLUListElement>(null);
	const [focused, setFocused] = useState<string | null>(null);
	useSidePanelFocus("files");

	const selected = selectedWorktree(state);
	const worktreeId = selected?.worktree.id ?? null;
	const tree = worktreeId === null ? undefined : state.fileTree.trees[worktreeId];
	const empty = describeFilesPanelEmpty(selected ? { name: worktreeLabel(selected.worktree), pathExists: selected.worktree.pathExists } : null);
	const root = tree?.listings[""];
	const rows = tree && empty === null ? treeRows(tree) : [];
	const openPath = worktreeId === null ? null : state.files[worktreeId]?.path ?? null;

	// The focused row stays when the rows change, or moves to the nearest one that still shows; the keyboard follows it.
	const lastRows = useRef<TreeRow[]>(rows);
	const current = keptFocus(lastRows.current, rows, focused);
	useEffect(() => {
		const before = lastRows.current;
		lastRows.current = rows;
		if (current !== focused) setFocused(current);
		if (before === rows || current === null) return;
		const list = treeRef.current;
		if (list !== null && list.contains(document.activeElement) && document.activeElement?.getAttribute("data-row") !== current) {
			list.querySelector<HTMLElement>(`[data-row="${CSS.escape(current)}"]`)?.focus();
		}
	});
	// Another worktree selected: start again from its first row.
	useEffect(() => setFocused(null), [worktreeId]);

	const focusRow = (id: string) => {
		setFocused(id);
		treeRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`)?.focus();
	};
	const choose = (row: TreeRow) => {
		if (row.kind !== "entry" || worktreeId === null) return;
		if (row.expanded === null) store.openFile(worktreeId, row.entry.path);
		else store.setFolderOpen(worktreeId, row.entry.path, !row.expanded);
	};
	const onKeyDown = (event: ReactKeyboardEvent<HTMLUListElement>) => {
		if (event.altKey || event.ctrlKey || event.metaKey || worktreeId === null) return;
		const action = treeKeyAction(rows, current, event.key);
		if (action === null) return;
		event.preventDefault();
		if (action.kind === "focus") focusRow(action.id);
		else if (action.kind === "open-file") store.openFile(worktreeId, action.path);
		else store.setFolderOpen(worktreeId, action.path, action.kind === "open-folder");
	};

	const body = () => {
		if (empty !== null) return <p className="dialog-note">{empty}</p>;
		if (!tree || !root || (root.entries === null && root.failure === null)) return <p className="dialog-note" role="status">Reading the files</p>;
		if (root.entries === null) {
			return (
				<>
					<p className="dialog-note" role="alert">{root.failure}</p>
					<button type="button" className="button quiet chops-panel-empty-new" onClick={() => worktreeId !== null && store.readFoldersAgain(worktreeId)}>Try again</button>
				</>
			);
		}
		const name = selected ? worktreeLabel(selected.worktree) : "";
		return (
			<ul ref={treeRef} className="files-tree" role="tree" aria-label={`Files of ${name}`} aria-busy={root.reading} onKeyDown={onKeyDown}>
				{rows.map(row => {
					const tabIndex = row.id === current ? 0 : -1;
					const indent = { paddingInlineStart: `${8 + (row.level - 1) * 14}px` };
					if (row.kind === "note") {
						return (
							<li key={row.id} data-row={row.id} role="treeitem" aria-level={row.level} aria-disabled="true" tabIndex={tabIndex}
								className={row.failure ? "files-tree-row files-tree-note failure" : "files-tree-row files-tree-note"} style={indent}
								onFocus={() => setFocused(row.id)}>
								{row.text}
							</li>
						);
					}
					const { entry } = row;
					const classes = ["files-tree-row", entry.ignored ? "ignored" : "", entry.path === openPath ? "current" : ""].filter(Boolean).join(" ");
					const title = [entry.path, entry.kind === "link" ? "a link" : "", entry.ignored ? "ignored by Git" : ""].filter(Boolean).join(", ");
					return (
						<li
							key={row.id}
							data-row={row.id}
							role="treeitem"
							aria-level={row.level}
							aria-setsize={row.count}
							aria-posinset={row.position}
							aria-expanded={row.expanded ?? undefined}
							aria-current={entry.path === openPath ? "true" : undefined}
							aria-description={entry.ignored ? "Ignored" : undefined}
							tabIndex={tabIndex}
							className={classes}
							style={indent}
							title={title}
							onFocus={() => setFocused(row.id)}
							onClick={() => {
								focusRow(row.id);
								choose(row);
							}}
						>
							<span className="files-tree-mark" aria-hidden="true">{row.expanded === null ? null : <Chevron open={row.expanded} />}</span>
							<span className="files-tree-name">{entry.name}</span>
							{entry.kind === "link" && <span className="files-tree-tag" aria-hidden="true">link</span>}
						</li>
					);
				})}
			</ul>
		);
	};

	return (
		<aside id={CHOPS_PANEL_ID} className="chops-panel files-panel" data-view="files" aria-labelledby={titleId} tabIndex={-1}>
			<div className="chops-panel-head">
				<SidePanelTitle view="files" titleId={titleId} title={FILES_PANEL_TITLE} />
				<button
					type="button"
					className="files-panel-ignored"
					aria-pressed={state.fileTree.showIgnored}
					title={FILES_IGNORED_LABEL}
					onClick={() => store.toggleIgnoredFiles()}
				>
					Ignored
				</button>
				<button type="button" className="icon-button chops-panel-close" aria-label={FILES_CLOSE_LABEL} title={FILES_CLOSE_LABEL} onClick={() => hideSidePanel(store)}>
					<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
						<path d="M4 4l8 8M12 4l-8 8" />
					</svg>
				</button>
			</div>
			<div className="chops-panel-body files-panel-body">{body()}</div>
		</aside>
	);
}

/**
 * Shows or hides the file explorer from the keyboard, as the title bar's
 * Files button does. It draws nothing. It listens on the window in the
 * capture phase, so it hears the keys of a focused terminal too. The key is
 * taken only when it showed or hid the panel.
 */
export function FilesShortcut() {
	const store = useStore();
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!takesFilesPanelKey(event, store.getState())) return;
			event.preventDefault();
			// A held chord shows or hides the panel once.
			if (!event.repeat) toggleFilesPanel(store);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [store]);
	return null;
}
