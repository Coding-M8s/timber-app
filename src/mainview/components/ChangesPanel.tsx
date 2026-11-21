import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { Comparison, DiffLine, DiffSection, FileChange, FileChangeTarget, FileDiffResult } from "../../shared/file-changes";
import { type NoteDraft, type ReviewNote, chooseNoteLine, notableLine, sameNotedLine } from "../../shared/review";
import { InlineNote, NoteForm, ReviewPanel, ReviewToggle } from "./ReviewNotes";
import { sameFileChange } from "../../shared/file-changes";
import type { Repository, Worktree } from "../../shared/model";
import {
	AREA_TITLES, COMPARISONS, COMPARISON_LABELS, KIND_LABELS, KIND_LETTERS, MORE_FILES_NOTE, baseUnavailable, describeComparison, describeDiffNotice, describeFileArea,
	NO_REFRESH, REFRESHING_CHANGES, type RefreshSpan, describeFileCounts, describeNoChanges, fileAfterKey, groupFileChanges, kindTone, listedOrder, nextRefreshSpan, splitPath,
} from "../changes-format";
import { chosenComparison } from "../../shared/layout";
import { BASE_ACTION_TITLE, describeBaseAction } from "../base-change-format";
import { ModeSwitch } from "./worktree-modes/ModeSwitch";
import { OPEN_IN_EDITOR } from "../editor-format";
import { useAppState, useStore } from "../store/react";
import { type ChangesView, changesBusy } from "../store/state";
import { StatusGlyph } from "./StatusGlyph";
import { EditorIcon, useOpenInEditor } from "./OpenInEditor";

/** How long the lines of a chosen reference stay marked in the diff. */
export const SHOWN_LINES_MS = 1500;

export const FOLDER_MISSING_CHANGES = "The worktree's folder is missing, so there are no changes to read.";

/** How long the refresh indicator stays after a read ends, so reads one after another show as one refresh. */
export const REFRESH_HOLD_MS = 300;

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

const fileKey = (file: FileChangeTarget) => `${file.area}\0${file.path}\0${file.previousPath ?? ""}`;

function KindLetter({ file }: { file: FileChange }) {
	return (
		<span className={`change-letter ${kindTone(file.kind)}`} title={KIND_LABELS[file.kind]} aria-hidden="true">
			{KIND_LETTERS[file.kind]}
		</span>
	);
}

/** The list of changed files, grouped as `git status` groups them. Only the selected file is a tab stop; the arrows reach the others. */
function FileList({ view, dimmed }: { view: ChangesView & { files: readonly FileChange[] }; dimmed: string }) {
	const store = useStore();
	const buttons = useRef(new Map<string, HTMLButtonElement>());
	const order = listedOrder(view.files);

	const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
		const next = fileAfterKey(order, view.selected, event.key);
		if (next === null) return;
		event.preventDefault();
		void store.selectChangedFile(next);
		buttons.current.get(fileKey(next))?.focus();
	};

	// With nothing selected yet, the first file takes the tab stop.
	const tabStop = view.selected ?? order[0] ?? null;
	return (
		<div className={`change-groups${dimmed}`} onKeyDown={onKey}>
			{groupFileChanges(view.files).map(group => (
				<section key={group.area} className="change-group" aria-label={AREA_TITLES[group.area]}>
					<h2 className="change-group-title">
						{AREA_TITLES[group.area]}
						<span className="change-group-count">{group.files.length}</span>
					</h2>
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

/** What the diff of one file needs to take notes. */
interface Noting {
	worktree: string;
	comparison: Comparison;
	file: FileChangeTarget;
	/** The kept notes on this file in this comparison. */
	notes: readonly ReviewNote[];
	/** The note whose reference was just chosen: its lines are marked for a moment. */
	shown: ReviewNote | null;
	draft: NoteDraft | null;
	/** The first line that can take a note, the one tab stop among the line numbers; the arrows reach the others. */
	tabStop: { section: number; hunk: number; line: number } | null;
	/** A line number was chosen: start a note there, or with `extend`, stretch the note being written to it. */
	choose(section: number, hunk: readonly DiffLine[], hunkIndex: number, line: number, extend: boolean): void;
	/** What is typed in the note being written, kept with the draft so that stretching it keeps the text. */
	type(text: string): void;
	/** Put the draft away, and give the keyboard back to the line it ended on. */
	close(): void;
}

/** Names a line number button, so the keyboard can be given back to it. */
const lineTarget = (section: number, hunk: number, line: number) => `${section}-${hunk}-${line}`;

/** Words for a line, to say what a note goes on. */
function lineWords(line: DiffLine): string {
	if (line.newLine !== null) return `line ${line.newLine}`;
	return `removed line ${line.oldLine}`;
}

/** The next or previous line number button of the diff, for the arrows. */
function stepLineTarget(from: HTMLElement, key: string): boolean {
	if (key !== "ArrowDown" && key !== "ArrowUp") return false;
	const all = [...(from.closest(".diff-body")?.querySelectorAll<HTMLButtonElement>(".diff-note-target") ?? [])];
	const at = all.indexOf(from as HTMLButtonElement);
	const next = all[at + (key === "ArrowDown" ? 1 : -1)];
	next?.focus();
	return true;
}

function Section({ section, index, noting }: { section: DiffSection; index: number; noting: Noting }) {
	const store = useStore();
	const { draft } = noting;
	return (
		<div className="diff-section">
			{section.header.length > 0 && (
				<div className="diff-header">
					{section.header.map((line, lineIndex) => <div key={lineIndex}>{line}</div>)}
				</div>
			)}
			{section.hunks.map((hunk, hunkIndex) => {
				const drafting = draft !== null && draft.section === index && draft.hunk === hunkIndex;
				const low = drafting ? Math.min(draft.anchor, draft.end) : -1;
				const high = drafting ? Math.max(draft.anchor, draft.end) : -1;
				return (
					<div key={hunkIndex} className="diff-hunk">
						<div className="diff-hunk-header">{hunk.header}</div>
						{hunk.lines.map((line, lineIndex) => {
							const notable = notableLine(line);
							const stop = noting.tabStop;
							const tabStop = stop !== null && stop.section === index && stop.hunk === hunkIndex && stop.line === lineIndex;
							const here = noting.notes.filter(note => sameNotedLine(note.lines[note.lines.length - 1]!, line));
							const chosen = drafting && lineIndex >= low && lineIndex <= high;
							const shown = noting.shown !== null && noting.shown.lines.some(noted => sameNotedLine(noted, line));
							return (
								<Fragment key={lineIndex}>
									<div className={`diff-line ${line.kind}${chosen ? " noting" : ""}${shown ? " shown" : ""}`}>
										{notable ? (
											<button
												type="button"
												className="diff-note-target"
												tabIndex={tabStop ? 0 : -1}
												data-line={lineTarget(index, hunkIndex, lineIndex)}
												aria-label={`Add a note on ${lineWords(line)}`}
												title="Add a note. Shift+click another line of this hunk for a range."
												onClick={event => noting.choose(index, hunk.lines, hunkIndex, lineIndex, event.shiftKey)}
												onKeyDown={event => {
													if (stepLineTarget(event.currentTarget, event.key)) event.preventDefault();
													else if (event.key === "Enter" && event.shiftKey) {
														event.preventDefault();
														noting.choose(index, hunk.lines, hunkIndex, lineIndex, true);
													}
												}}
											>
												<span className="diff-number">{line.oldLine ?? ""}</span>
												<span className="diff-number">{line.newLine ?? ""}</span>
											</button>
										) : (
											<>
												<span className="diff-number">{line.oldLine ?? ""}</span>
												<span className="diff-number">{line.newLine ?? ""}</span>
											</>
										)}
										<span className="diff-marker" aria-hidden="true">{line.kind === "added" ? "+" : line.kind === "removed" ? "-" : ""}</span>
										<span className="diff-text">{line.text}</span>
									</div>
									{here.map(note => <InlineNote key={note.id} worktree={noting.worktree} note={note} />)}
									{drafting && lineIndex === high && (
										<div className="diff-note">
											<NoteForm
												label={high > low ? `Note on ${high - low + 1} lines, ending at ${lineWords(line)}` : `Note on ${lineWords(line)}`}
												initial={draft.text}
												onChange={noting.type}
												onSave={text => {
													// The lines as they showed when chosen, even when the diff was read again since.
													const problem = store.addReviewNote(noting.worktree, { comparison: noting.comparison, file: noting.file, lines: draft.lines, text });
													if (problem === null) noting.close();
													return problem;
												}}
												onCancel={noting.close}
											/>
										</div>
									)}
								</Fragment>
							);
						})}
					</div>
				);
			})}
		</div>
	);
}

function DiffBody({ file, result, commit, noting }: { file: FileChange; result: FileDiffResult | null; commit: string | null; noting: Noting }) {
	if (result === null) return <p className="diff-reading" role="status">Reading the diff</p>;
	if (result.outcome !== "read") {
		return (
			<div className="sidebar-error diff-problem" role="alert">
				<p className="sidebar-error-title">Could not show the changes of {file.path}</p>
				<p className="sidebar-error-text">{result.message}</p>
			</div>
		);
	}
	const shown = result.file ?? file;
	const notice = describeDiffNotice(result.diff, shown, commit);
	const sections = result.diff.kind === "text" ? result.diff.sections : [];
	let tabStop: Noting["tabStop"] = null;
	for (const [section, part] of sections.entries()) {
		for (const [hunk, { lines }] of part.hunks.entries()) {
			const line = lines.findIndex(notableLine);
			if (line >= 0 && tabStop === null) tabStop = { section, hunk, line };
		}
	}
	const withStop = { ...noting, tabStop };
	return (
		<>
			{notice !== null && (
				<div className="diff-notice">
					<p className="empty-title">{notice.title}</p>
					<p className="empty-text">{notice.text}</p>
				</div>
			)}
			{result.diff.kind === "text" && result.diff.sections.map((section, index) => <Section key={index} section={section} index={index} noting={withStop} />)}
		</>
	);
}

function OpenFileButton({ repository, worktree, file }: { repository: string; worktree: Worktree; file: FileChange }) {
	const { action, open } = useOpenInEditor(repository, worktree, file.path);
	return (
		<button
			type="button"
			className="button quiet diff-editor"
			title={action.tooltip}
			aria-haspopup={action.opensSettings ? "dialog" : undefined}
			disabled={!action.available}
			onClick={open}
		>
			<EditorIcon />
			{OPEN_IN_EDITOR}
		</button>
	);
}

/** The diff of the selected file, under a line that names it. `toggle` opens the Review panel in a narrow window. */
function DiffPane({ repository, worktree, view, toggle }: { repository: string; worktree: Worktree; view: ChangesView; toggle: ReactNode }) {
	const store = useStore();
	const state = useAppState();
	const body = useRef<HTMLDivElement>(null);
	const [draft, setDraft] = useState<NoteDraft | null>(null);
	const selected = view.selected;
	const inView = state.noteInView;
	const inViewNote = inView !== null && inView.worktree === worktree.id
		? state.reviews[worktree.id]?.find(note => note.id === inView.id) ?? null
		: null;
	// The note this effect brought into view last, so that reading the diff again does not scroll to it again.
	const scrolled = useRef<object | null>(null);

	// A reference chosen in the Review panel comes into view once its file's diff shows, and its lines stay marked for a moment.
	useEffect(() => {
		if (inView === null || inView.worktree !== worktree.id || view.diff === null || scrolled.current === inView) return;
		if (inViewNote !== null && (selected === null || !sameFileChange(selected, inViewNote.file))) return;
		scrolled.current = inView;
		const first = body.current?.querySelector<HTMLElement>(".diff-line.shown") ?? null;
		const note = body.current?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(inView.id)}"]`) ?? null;
		// An outdated note whose lines all left the diff has nowhere to show: the Review panel said so.
		(first ?? note)?.scrollIntoView({ block: "center" });
		(note ?? first?.querySelector<HTMLElement>(".diff-note-target") ?? null)?.focus({ preventScroll: true });
		setTimeout(() => {
			if (store.getState().noteInView === inView) store.reviewNoteShown();
		}, SHOWN_LINES_MS);
	}, [inView, inViewNote, selected, view.diff, worktree.id, store]);

	const file = selected === null ? undefined : view.files?.find(candidate => sameFileChange(candidate, selected));
	if (!file) {
		return (
			<section className="changes-diff empty" aria-label="Diff">
				{toggle !== null && <div className="diff-title review-toggle-bar">{toggle}</div>}
				<p className="empty-text">{view.files !== null && view.files.length > 0 ? "Select a file to see its changes." : ""}</p>
			</section>
		);
	}
	// A deleted file is not on disk, so there is nothing to open.
	const onDisk = file.kind !== "deleted";
	const comparison = view.compared ?? "uncommitted";
	const noting: Noting = {
		worktree: worktree.id,
		comparison,
		file,
		notes: (state.reviews[worktree.id] ?? []).filter(note => note.comparison === comparison && sameFileChange(note.file, file)),
		shown: inViewNote !== null && inViewNote.comparison === comparison && sameFileChange(inViewNote.file, file) ? inViewNote : null,
		draft: draft !== null && draft.key === fileKey(file) && draft.comparison === comparison ? draft : null,
		tabStop: null,
		choose(section, hunk, hunkIndex, line, extend) {
			setDraft(chooseNoteLine(noting.draft, { key: fileKey(file), comparison, section, hunk: hunkIndex, line }, hunk, extend));
		},
		type: text => setDraft(current => current && { ...current, text }),
		close() {
			const ended = noting.draft;
			setDraft(null);
			if (ended === null) return;
			// After the form is gone, the keyboard goes back to the line the note ended on.
			setTimeout(() => body.current?.querySelector<HTMLElement>(`[data-line="${lineTarget(ended.section, ended.hunk, ended.end)}"]`)?.focus());
		},
	};
	return (
		<section className="changes-diff" aria-label={`Diff of ${file.path}`}>
			<div className="diff-title">
				<KindLetter file={file} />
				<span className="diff-path" title={file.path}>
					{file.previousPath !== null && <span className="diff-previous">{file.previousPath} → </span>}
					{file.path}
				</span>
				<span className="diff-area">{describeFileArea(file)}</span>
				{toggle}
				{onDisk && (
					<button type="button" className="button quiet diff-editor" title={`Show ${file.path} as it is now, read-only`} onClick={() => store.openFile(worktree.id, file.path)}>
						View file
					</button>
				)}
				{onDisk && <OpenFileButton repository={repository} worktree={worktree} file={file} />}
			</div>
			<div className="diff-body" ref={body} tabIndex={0} aria-label={`Changes of ${file.path}`}>
				<DiffBody file={file} result={view.diff} commit={view.compared === "base" && view.base?.usable ? view.base.commit : null} noting={noting} />
			</div>
		</section>
	);
}

/**
 * The Changes tab: what changed in the worktree, read-only. It reads the files
 * again whenever the worktree's status on screen is read again, which is
 * when the repository reloads.
 */
export function ChangesPanel({ repository, worktree }: { repository: Repository; worktree: Worktree }) {
	const store = useStore();
	const state = useAppState();
	const missing = !worktree.pathExists;
	const baseNote = useId();
	const busy = changesBusy(state, repository.path, worktree.id);
	const refreshing = useHeld(busy, REFRESH_HOLD_MS);
	const listed = state.changes?.worktree === worktree.id && state.changes.files !== null;
	const overList = useRefreshSpan(worktree.id, refreshing, listed).overList;
	const panelId = useId();
	const toggleButton = useRef<HTMLButtonElement>(null);
	// The worktree whose panel is open over the diff: another worktree starts with its panel closed.
	const [openFor, setOpenFor] = useState<string | null>(null);
	const noteCount = state.reviews[worktree.id]?.length ?? 0;
	// Over the diff only while there are notes: the next first note does not open it again.
	const open = openFor === worktree.id && noteCount > 0;
	useEffect(() => {
		if (noteCount === 0) setOpenFor(null);
	}, [noteCount]);

	// `worktree` is a new object after every reload of its repository, so this follows the rest of the status.
	useEffect(() => {
		if (!missing) void store.readChanges(repository.path, worktree.id);
	}, [store, repository.path, worktree, missing]);

	/** Close the panel over the diff, and give the keyboard back to the button that opens it, when that shows. */
	function closeReview() {
		setOpenFor(null);
		const button = toggleButton.current;
		if (button !== null && button.offsetParent !== null) button.focus();
	}

	if (missing) {
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
			<div className="changes-files">
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
			{view !== null && (
				<div
					className="changes-main"
					onKeyDown={event => {
						// Escape closes the panel over the diff. A note's field takes Escape first, to cancel.
						// Only while it shows: in a wide window the panel is beside the diff, and Escape is left alone.
						if (event.key !== "Escape" || !open || toggleButton.current?.offsetParent == null) return;
						event.preventDefault();
						closeReview();
					}}
				>
					<DiffPane
						repository={repository.path}
						worktree={worktree}
						view={view}
						toggle={noteCount > 0
							? <ReviewToggle count={noteCount} panel={panelId} open={open} button={toggleButton} onToggle={() => (open ? closeReview() : setOpenFor(worktree.id))} />
							: null}
					/>
					<ReviewPanel
						key={worktree.id}
						worktree={worktree.id}
						id={panelId}
						open={open}
						onClose={closeReview}
						onShown={() => setOpenFor(null)}
						onGone={() => {
							setOpenFor(null);
							// The panel goes with its last note: the keyboard goes to the diff.
							setTimeout(() => (document.querySelector<HTMLElement>(".changes-main .diff-body") ?? document.querySelector<HTMLElement>('.change-file[tabindex="0"]'))?.focus());
						}}
					/>
				</div>
			)}
		</div>
	);
}
