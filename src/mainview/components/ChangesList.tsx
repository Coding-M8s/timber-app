import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { type FileChange, sameFileChange } from "../../shared/file-changes";
import type { Repository, Worktree } from "../../shared/model";
import {
	AREA_TITLES, COMPARISONS, COMPARISON_LABELS, KIND_LABELS, MORE_FILES_NOTE, NO_REFRESH, REFRESHING_CHANGES, type RefreshSpan, baseUnavailable, describeComparison,
	describeFileCounts, describeNoChanges, fileAfterKey, groupFileChanges, listedOrder, nextRefreshSpan, splitPath,
} from "../changes-format";
import { CHANGES_CLOSE_LABEL, CHANGES_PANEL_TITLE, describeChangesPanelEmpty, takesChangesPanelKey } from "../changes-panel-format";
import { CHOPS_PANEL_ID } from "../chops-panel-format";
import { chosenComparison } from "../../shared/layout";
import { BASE_ACTION_TITLE, describeBaseAction } from "../base-change-format";
import { ModeSwitch } from "./worktree-modes/ModeSwitch";
import { useAppState, useStore } from "../store/react";
import { type ChangesView, changesBusy, changesWanted, selectedWorktree } from "../store/state";
import type { AppStore } from "../store/store";
import { StatusGlyph } from "./StatusGlyph";
import { KindLetter, fileKey } from "./KindLetter";
import { ReviewSection } from "./ReviewNotes";
import { SidePanelTitle, hideSidePanel, toggleSidePanel, useSidePanelFocus } from "./SidePanel";

export const FOLDER_MISSING_CHANGES = "The worktree's folder is missing, so there are no changes to read.";

/** How long the refresh indicator stays after a read ends, so reads one after another show as one refresh. */
export const REFRESH_HOLD_MS = 300;

/** Show the Changes view when it is hidden and hide it when it shows, from the title bar button or the shortcut (see ./SidePanel.tsx). */
export function toggleChangesPanel(store: AppStore): boolean {
	return toggleSidePanel(store, "changes");
}

/**
 * True while `busy`, and for `holdMs` after it ends. A Refresh reloads the
 * repository and then reads the changes; between the two nothing runs for a
 * moment. Held, they show one spinner and make one announcement, and a quick
 * read still shows long enough to be seen.
 */
function useHeld(busy: boolean, holdMs: number): boolean {
	const [held, setHeld] = useState(busy);
	useEffect(() => {
		if (busy) {
			setHeld(true);
			return;
		}
		const timer = setTimeout(() => setHeld(false), holdMs);
		return () => clearTimeout(timer);
	}, [busy, holdMs]);
	return busy || held;
}

/** The refresh this render is part of, kept from render to render (see `nextRefreshSpan`). */
function useRefreshSpan(worktree: string, active: boolean, listShown: boolean): RefreshSpan {
	const [span, setSpan] = useState(() => nextRefreshSpan(NO_REFRESH, worktree, active, listShown));
	const next = nextRefreshSpan(span, worktree, active, listShown);
	// Set while rendering, as React allows for state that follows props: it renders again at once with `next`.
	if (next !== span) setSpan(next);
	return next;
}

/**
 * The list of changed files, grouped as `git status` groups them. Choosing
 * one opens its diff in the diff tab, which marks it here. One file is a tab
 * stop; the arrows move the keyboard to the others without opening them.
 */
function FileList({ view, dimmed }: { view: ChangesView & { files: readonly FileChange[] }; dimmed: string }) {
	const store = useStore();
	const buttons = useRef(new Map<string, HTMLButtonElement>());
	const order = listedOrder(view.files);
	const [focused, setFocused] = useState<string | null>(null);
	const focusedFile = focused === null ? undefined : order.find(file => fileKey(file) === focused);
	// The file the keyboard was on, else the open one, else the first, takes the tab stop.
	const tabStop = focusedFile ?? (view.selected === null ? undefined : order.find(file => sameFileChange(file, view.selected!))) ?? order[0] ?? null;

	const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
		const next = fileAfterKey(order, tabStop, event.key);
		if (next === null) return;
		event.preventDefault();
		setFocused(fileKey(next));
		buttons.current.get(fileKey(next))?.focus();
	};

	return (
		<div className={`change-groups${dimmed}`} onKeyDown={onKey}>
			{groupFileChanges(view.files).map(group => (
				<section key={group.area} className="change-group" aria-label={AREA_TITLES[group.area]}>
					<h3 className="change-group-title">
						{AREA_TITLES[group.area]}
						<span className="change-group-count">{group.files.length}</span>
					</h3>
					<ul className="change-files">
						{group.files.map(file => {
							const key = fileKey(file);
							const selected = view.selected !== null && sameFileChange(view.selected, file);
							const { name, folder } = splitPath(file.path);
							return (
								<li key={key}>
									<button
										type="button"
										className={selected ? "change-file selected" : "change-file"}
										aria-current={selected ? "true" : undefined}
										aria-label={`${file.path}, ${KIND_LABELS[file.kind]}${file.previousPath === null ? "" : ` from ${file.previousPath}`}, ${AREA_TITLES[file.area]}`}
										title={file.previousPath === null ? file.path : `${file.previousPath} → ${file.path}`}
										tabIndex={tabStop !== null && sameFileChange(tabStop, file) ? 0 : -1}
										ref={element => {
											if (element) buttons.current.set(key, element);
											else buttons.current.delete(key);
										}}
										onFocus={() => setFocused(key)}
										onClick={() => void store.selectChangedFile(file)}
									>
										<span className="change-file-name">{name}</span>
										{folder !== "" && <span className="change-file-folder">{folder}</span>}
										<KindLetter file={file} />
									</button>
								</li>
							);
						})}
					</ul>
				</section>
			))}
		</div>
	);
}

/** What the Changes view lists for a worktree: Compare with, the base, the counts and Refresh, the files, and the Review section. */
function WorktreeChanges({ repository, worktree }: { repository: Repository; worktree: Worktree }) {
	const store = useStore();
	const state = useAppState();
	const baseNote = useId();
	const busy = changesBusy(state, repository.path, worktree.id);
	const refreshing = useHeld(busy, REFRESH_HOLD_MS);
	const listed = state.changes?.worktree === worktree.id && state.changes.files !== null;
	const overList = useRefreshSpan(worktree.id, refreshing, listed).overList;
	const list = useRef<HTMLDivElement>(null);

	if (!worktree.pathExists) {
		return (
			<div className="empty">
				<p className="empty-title">No changes to show</p>
				<p className="empty-text">{FOLDER_MISSING_CHANGES}</p>
			</div>
		);
	}

	const view = state.changes?.worktree === worktree.id ? state.changes : null;
	const compared = view?.compared ?? chosenComparison(state.layout, worktree.id);
	const base = view?.base ?? null;
	const unavailable = baseUnavailable(base);
	const shown = describeComparison(compared, base);
	const files = view?.files ?? null;
	// The list on screen stays while it is read again, dimmed, so nothing jumps.
	const dimmed = overList ? " refreshing" : "";

	return (
		<div className="changes">
			<div className="changes-files" ref={list}>
				<div className="changes-compare">
					<span className="changes-compare-label" aria-hidden="true">Compare with</span>
					<ModeSwitch
						label="Compare with"
						labels={COMPARISONS.map(choice => COMPARISON_LABELS[choice])}
						selected={COMPARISONS.indexOf(compared)}
						disabled={false}
						unavailable={COMPARISONS.map(choice => choice === "base" && unavailable !== null)}
						{...(unavailable === null ? {} : { describedBy: baseNote })}
						onSelect={index => void store.compareChanges(COMPARISONS[index]!)}
					/>
				</div>
				<div className="changes-compare">
					{view?.compared != null && <span className="changes-compared" title={shown.title}>{shown.text}</span>}
					<button
						type="button"
						className="text-button changes-base-action"
						title={BASE_ACTION_TITLE}
						aria-haspopup="dialog"
						onClick={() => store.openDialog({ kind: "set-base", repository: repository.path, worktree: worktree.id })}
					>
						{describeBaseAction(worktree.base)}
					</button>
				</div>
				{unavailable !== null && <p className="changes-base-note" id={baseNote}>{unavailable}</p>}
				<div className="changes-bar">
					<span className="changes-state">
						{refreshing && <span className="changes-spinner"><StatusGlyph status={{ kind: "working", progress: null }} /></span>}
						<span className="changes-count" role="status">{files === null ? "Reading changes" : describeFileCounts(files, view?.more ?? false)}</span>
					</span>
					{/* Always there, so it speaks once when a refresh starts; "Reading changes" already speaks for an empty list. */}
					<span className="visually-hidden" role="status">{overList ? REFRESHING_CHANGES : ""}</span>
					<button
						type="button"
						className="text-button"
						disabled={refreshing}
						title="Read this repository's worktrees and their changes again"
						onClick={() => void store.reloadRepository(repository.path)}
					>
						Refresh
					</button>
				</div>
				{view?.problem != null && (
					<div className="sidebar-error" role="alert">
						<p className="sidebar-error-title">Could not read the changes</p>
						<p className="sidebar-error-text">{view.problem}</p>
					</div>
				)}
				{view !== null && files !== null && (files.length === 0
					? (
						<div className={`changes-clean${dimmed}`}>
							<p className="empty-title">No changes</p>
							<p className="empty-text">{describeNoChanges(compared, base)}</p>
						</div>
					)
					: <FileList view={{ ...view, files }} dimmed={dimmed} />)}
				{view?.more === true && <p className="changes-more">{MORE_FILES_NOTE}</p>}
			</div>
			<ReviewSection
				key={worktree.id}
				worktree={worktree.id}
				onGone={() => {
					// The section goes back to its hint with its last note: the keyboard goes to the list.
					setTimeout(() => (list.current?.querySelector<HTMLElement>('.change-file[tabindex="0"]') ?? document.getElementById(CHOPS_PANEL_ID))?.focus());
				}}
			/>
		</div>
	);
}

/**
 * The side panel's Changes view: what changed in the selected worktree,
 * read-only, with the review of its notes at its foot. Choosing a file opens
 * its diff in the diff tab. The changes are read by `ChangesReader`.
 */
export function ChangesList() {
	const store = useStore();
	const state = useAppState();
	const titleId = useId();
	useSidePanelFocus("changes");
	const selected = selectedWorktree(state);
	const empty = describeChangesPanelEmpty(selected !== null);

	return (
		<aside id={CHOPS_PANEL_ID} className="chops-panel changes-panel" data-view="changes" aria-labelledby={titleId} tabIndex={-1}>
			<div className="chops-panel-head">
				<SidePanelTitle view="changes" titleId={titleId} title={CHANGES_PANEL_TITLE} />
				<button type="button" className="icon-button chops-panel-close" aria-label={CHANGES_CLOSE_LABEL} title={CHANGES_CLOSE_LABEL} onClick={() => hideSidePanel(store)}>
					<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
						<path d="M4 4l8 8M12 4l-8 8" />
					</svg>
				</button>
			</div>
			<div className="chops-panel-body changes-panel-body">
				{selected === null || empty !== null
					? <p className="empty-text changes-panel-empty">{empty}</p>
					: <WorktreeChanges key={selected.worktree.id} repository={selected.repository} worktree={selected.worktree} />}
			</div>
		</aside>
	);
}

/**
 * Reads the selected worktree's changes while the Changes view or its diff
 * tab shows, and again whenever its status on screen is read again, which
 * is when the repository reloads. It draws nothing.
 */
export function ChangesReader() {
	const store = useStore();
	const state = useAppState();
	const selected = selectedWorktree(state);
	const wanted = changesWanted(state);
	const repository = selected?.repository.path ?? null;
	// `worktree` is a new object after every reload of its repository, so this follows the rest of the status.
	const worktree = selected?.worktree ?? null;
	useEffect(() => {
		if (wanted && repository !== null && worktree !== null && worktree.pathExists) void store.readChanges(repository, worktree.id);
	}, [store, wanted, repository, worktree]);
	return null;
}

/**
 * Shows or hides the Changes view from the keyboard, as the title bar's
 * Changes button does. It draws nothing. It listens on the window in the
 * capture phase, so it hears the keys of a focused terminal too. The key is
 * taken only when it showed or hid the panel.
 */
export function ChangesShortcut() {
	const store = useStore();
	useEffect(() => {
		const onKeyDown = (event: globalThis.KeyboardEvent) => {
			if (!takesChangesPanelKey(event, store.getState())) return;
			event.preventDefault();
			// A held chord shows or hides the panel once.
			if (!event.repeat) toggleChangesPanel(store);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [store]);
	return null;
}
