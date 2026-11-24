import { type KeyboardEvent, useCallback, useEffect, useId, useRef, useState } from "react";
import { type FileChange, sameFileChange } from "../../shared/file-changes";
import type { Repository, Worktree } from "../../shared/model";
import {
	AREA_TITLES, COMPARISONS, COMPARISON_LABELS, INDEX_KEY, INDEX_KEY_NAME, INDEX_WRITE_FAILED, KIND_LABELS, MORE_FILES_NOTE, NO_REFRESH, REFRESHING_CHANGES, type RefreshSpan, baseUnavailable,
	describeComparison, describeFileCounts, describeFilterResult, describeIndexCommand, describeLineCounts, describeNoChanges, fileAfterKey, fileIndexAction, filterFiles, groupFileChanges,
	groupIndexAction, listedOrder, movedEntry, nextRefreshSpan, speakLineCounts, splitPath, totalLineCounts,
} from "../changes-format";
import { type IndexAction, indexCommand } from "../../shared/index-writes";
import { CHANGES_CLOSE_LABEL, CHANGES_PANEL_TITLE, describeChangesPanelEmpty, takesChangesPanelKey } from "../changes-panel-format";
import { CHOPS_PANEL_ID } from "../chops-panel-format";
import { chosenComparison } from "../../shared/layout";
import { BASE_ACTION_TITLE, describeBaseAction } from "../base-change-format";
import { ModeSwitch } from "./worktree-modes/ModeSwitch";
import { useAppState, useStore } from "../store/react";
import { type ChangesView, changesBusy, changesWanted, fileViewed, selectedWorktree } from "../store/state";
import type { AppStore } from "../store/store";
import { StatusGlyph } from "./StatusGlyph";
import { CommitBox, CommitFromBase } from "./CommitBox";
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

/** A file's `+12 -3`, colored, or nothing when Git counted none. Only for the eye: the row's label says it. */
export function LineCounts({ file }: { file: Pick<FileChange, "added" | "removed"> }) {
	const counts = describeLineCounts(file);
	if (counts === null) return null;
	return (
		<span className="change-counts" aria-hidden="true">
			<span className="change-added">{counts.added}</span> <span className="change-removed">{counts.removed}</span>
		</span>
	);
}

/** The check of a file marked Viewed. Only for the eye: the row's label says it. */
function ViewedMark() {
	return (
		<svg className="change-viewed-mark" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
			<path d="M5 12.5 10 17 19 7" />
		</svg>
	);
}

/**
 * The list of changed files, grouped as `git status` groups them, through
 * the filter. Choosing one opens its diff in the diff tab, which marks it
 * here. One file is a tab stop; the arrows move the keyboard to the others
 * without opening them. A file marked Viewed is dimmed and checked.
 *
 * With Uncommitted, each file has Stage, Unstage, or Mark resolved, shown on
 * hover and keyboard focus, and Space on the file does the same; each group
 * has Stage all, Unstage all, or Mark all resolved, for the files it shows.
 * Each button's tooltip is the command it runs. Afterwards the keyboard
 * stays on the file, in its new group.
 */
function FileList({ view, dimmed }: { view: ChangesView & { files: readonly FileChange[] }; dimmed: string }) {
	const store = useStore();
	const state = useAppState();
	const buttons = useRef(new Map<string, HTMLButtonElement>());
	const order = listedOrder(view.files);
	const [focused, setFocused] = useState<string | null>(null);
	// The file the keyboard follows after a stage or unstage, by path, and where it was in the list.
	const following = useRef<{ path: string; index: number; settled: number } | null>(null);
	const focusedFile = focused === null ? undefined : order.find(file => fileKey(file) === focused);
	// The file the keyboard was on, else the open one, else the first, takes the tab stop.
	const tabStop = focusedFile ?? (view.selected === null ? undefined : order.find(file => sameFileChange(file, view.selected!))) ?? order[0] ?? null;
	const writable = view.compared === "uncommitted";

	useEffect(() => {
		const follow = following.current;
		// Only once the list was read again after the write ended.
		if (follow === null || view.settledWrites === follow.settled) return;
		following.current = null;
		// The file in its new group, else whatever took its place.
		const next = movedEntry(view.files, follow.path) ?? order[Math.min(follow.index, order.length - 1)];
		if (!next) return;
		setFocused(fileKey(next));
		buttons.current.get(fileKey(next))?.focus();
	});

	const write = (action: IndexAction, files: readonly FileChange[], follow: FileChange) => {
		if (view.writing) return;
		following.current = { path: follow.path, index: Math.max(0, order.findIndex(file => sameFileChange(file, follow))), settled: view.settledWrites };
		void store.writeIndex(action, files).then(result => {
			if (result === null) following.current = null;
		});
	};

	const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
		// Alt+Up and Alt+Down open the previous and next file (see ./DiffTab.tsx), so they do not move the keyboard here too.
		if (event.altKey || event.ctrlKey || event.metaKey) return;
		const next = fileAfterKey(order, tabStop, event.key);
		if (next === null) return;
		event.preventDefault();
		setFocused(fileKey(next));
		buttons.current.get(fileKey(next))?.focus();
	};

	return (
		<div className={`change-groups${dimmed}`} onKeyDown={onKey}>
			{groupFileChanges(view.files).map(group => {
				const all = writable ? groupIndexAction(group.area) : null;
				return (
					<section key={group.area} className="change-group" aria-label={AREA_TITLES[group.area]}>
						<div className="change-group-head">
							<h3 className="change-group-title">
								{AREA_TITLES[group.area]}
								<span className="change-group-count">{group.files.length}</span>
							</h3>
							{all !== null && (
								<button
									type="button"
									className="change-group-action"
									title={describeIndexCommand(indexCommand(all.action, group.files, view.hasCommit))}
									aria-label={`${all.label}: ${group.files.length} ${group.files.length === 1 ? "file" : "files"} in ${AREA_TITLES[group.area]}`}
									aria-disabled={view.writing || undefined}
									onClick={() => write(all.action, group.files, group.files[0]!)}
								>
									{all.label}
								</button>
							)}
						</div>
						<ul className="change-files">
							{group.files.map(file => {
								const key = fileKey(file);
								const own = writable ? fileIndexAction(file) : null;
								const isTabStop = tabStop !== null && sameFileChange(tabStop, file);
								const selected = view.selected !== null && sameFileChange(view.selected, file);
								const viewed = fileViewed(state, view.worktree, view.compared, file);
								const { name, folder } = splitPath(file.path);
								const counts = speakLineCounts(file);
								return (
									<li key={key} className={`change-row${own === null ? "" : " writable"}`}>
										<button
											type="button"
											className={`change-file${selected ? " selected" : ""}${viewed ? " viewed" : ""}`}
											aria-current={selected ? "true" : undefined}
											aria-label={`${file.path}, ${KIND_LABELS[file.kind]}${file.previousPath === null ? "" : ` from ${file.previousPath}`}${AREA_TITLES[file.area] === KIND_LABELS[file.kind] ? "" : `, ${AREA_TITLES[file.area]}`}${counts === "" ? "" : `, ${counts}`}${viewed ? ", viewed" : ""}`}
											aria-keyshortcuts={own === null ? undefined : INDEX_KEY_NAME}
											title={file.previousPath === null ? file.path : `${file.previousPath} → ${file.path}`}
											tabIndex={isTabStop ? 0 : -1}
											ref={element => {
												if (element) buttons.current.set(key, element);
												else buttons.current.delete(key);
											}}
											onFocus={() => setFocused(key)}
											onClick={() => void store.selectChangedFile(file)}
											onKeyDown={event => {
												if (own === null || event.key !== INDEX_KEY || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
												// Space stages or unstages, where Enter opens the diff.
												event.preventDefault();
												if (!event.repeat) write(own.action, [file], file);
											}}
										>
											<span className="change-file-name">{name}</span>
											{folder !== "" && <span className="change-file-folder">{folder}</span>}
											{viewed && <ViewedMark />}
											<LineCounts file={file} />
											<KindLetter file={file} />
										</button>
										{own !== null && (
											<button
												type="button"
												className="change-file-action"
												title={describeIndexCommand(indexCommand(own.action, [file], view.hasCommit))}
												aria-label={`${own.label} ${file.path}`}
												aria-disabled={view.writing || undefined}
												tabIndex={isTabStop ? 0 : -1}
												onFocus={() => setFocused(key)}
												onClick={() => write(own.action, [file], file)}
											>
												{own.label}
											</button>
										)}
									</li>
								);
							})}
						</ul>
					</section>
				);
			})}
		</div>
	);
}

/** What the Changes view lists for a worktree: Compare with, the base, the commit box (or Base's Commit…), the counts and Refresh, the files, and the Review section. */
function WorktreeChanges({ repository, worktree }: { repository: Repository; worktree: Worktree }) {
	const store = useStore();
	const state = useAppState();
	const baseNote = useId();
	const filterId = useId();
	const busy = changesBusy(state, repository.path, worktree.id);
	const refreshing = useHeld(busy, REFRESH_HOLD_MS);
	const listed = state.changes?.worktree === worktree.id && state.changes.files !== null;
	const overList = useRefreshSpan(worktree.id, refreshing, listed).overList;
	const list = useRef<HTMLDivElement>(null);
	// Base's Commit… asks for the message box, which takes the keyboard once Uncommitted shows.
	const [commitFocus, setCommitFocus] = useState(false);
	const commitFocused = useCallback(() => setCommitFocus(false), []);

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
	const filter = state.changeFilters[worktree.id] ?? "";
	const shownFiles = files === null ? null : filterFiles(files, filter);
	const totals = files === null ? null : totalLineCounts(files);
	const filterResult = files === null ? "" : describeFilterResult(shownFiles!.length, files.length, filter);

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
				{view?.compared != null && files !== null && (view.compared === "uncommitted"
					? <CommitBox repository={repository} worktree={worktree} view={{ ...view, files }} focusWanted={commitFocus} onFocused={commitFocused} />
					: (
						<CommitFromBase
							onChoose={() => {
								setCommitFocus(true);
								void store.compareChanges("uncommitted");
							}}
						/>
					))}
				{files !== null && files.length > 0 && (
					<div className="changes-filter">
						<label htmlFor={filterId} className="visually-hidden">Filter changed files</label>
						<svg className="changes-filter-icon" aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
							<circle cx="11" cy="11" r="7" />
							<path d="m20 20-3.5-3.5" />
						</svg>
						<input
							id={filterId}
							type="text"
							className="changes-filter-input"
							placeholder="Filter files"
							value={filter}
							spellCheck={false}
							autoComplete="off"
							onChange={event => store.setChangesFilter(worktree.id, event.target.value)}
							onKeyDown={event => {
								if (event.key === "Escape" && filter !== "") {
									event.preventDefault();
									event.stopPropagation();
									store.setChangesFilter(worktree.id, "");
								} else if (event.key === "ArrowDown") {
									// Down goes into the list, to the file that takes its tab stop.
									const target = list.current?.querySelector<HTMLElement>('.change-file[tabindex="0"]');
									if (target) {
										event.preventDefault();
										target.focus();
									}
								}
							}}
						/>
						{/* Always there, so a screen reader hears how many files match as the filter changes. */}
						<span className="visually-hidden" role="status">{filterResult}</span>
					</div>
				)}
				<div className="changes-bar">
					<span className="changes-state">
						{refreshing && <span className="changes-spinner"><StatusGlyph status={{ kind: "working", progress: null }} /></span>}
						<span className="changes-count" role="status">
							{files === null ? "Reading changes" : describeFileCounts(files, view?.more ?? false)}
							{totals !== null && files!.length > 0 && <span className="visually-hidden">, {speakLineCounts(totals)}</span>}
						</span>
						{totals !== null && files!.length > 0 && <LineCounts file={totals} />}
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
				{view?.writeProblem != null && (
					<div className="sidebar-error" role="alert">
						<p className="sidebar-error-title">{INDEX_WRITE_FAILED[view.writeProblem.action]}</p>
						{view.writeProblem.command !== null && <p className="sidebar-error-text"><code>{view.writeProblem.command}</code></p>}
						<p className="sidebar-error-text">{view.writeProblem.message}</p>
					</div>
				)}
				{view !== null && files !== null && (files.length === 0
					? (
						<div className={`changes-clean${dimmed}`}>
							<p className="empty-title">No changes</p>
							<p className="empty-text">{describeNoChanges(compared, base)}</p>
						</div>
					)
					: shownFiles!.length === 0
						? <p className="empty-text changes-no-match">{filterResult}</p>
						: <FileList view={{ ...view, files: shownFiles! }} dimmed={dimmed} />)}
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
 * with Stage, Unstage, and Commit in Uncommitted and the review of its notes at its foot. Choosing a file opens
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
