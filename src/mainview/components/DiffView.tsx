import { Fragment, type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Comparison, DiffLine, DiffSection, FileChange, FileChangeTarget, FileDiffResult } from "../../shared/file-changes";
import { NOTE_LINE_LIMIT, type NoteDraft, type ReviewNote, chooseNoteLine, notableLine, sameNotedLine } from "../../shared/review";
import { InlineNote, NoteForm } from "./ReviewNotes";
import { type DragStop, describeDraggedRange, dragNoteEnd, rowAtY } from "../review-drag";
import { sameFileChange } from "../../shared/file-changes";
import type { Worktree } from "../../shared/model";
import { describeDiffNotice, describeFileArea } from "../changes-format";
import { OPEN_IN_EDITOR } from "../editor-format";
import { useAppState, useStore } from "../store/react";
import type { ChangesView } from "../store/state";
import { EditorIcon, useOpenInEditor } from "./OpenInEditor";
import { type DiffMarks, DiffText, useDiffMarks } from "./DiffText";
import type { CodeSpan } from "../diff-highlight";
import type { WordRange } from "../diff-words";
import { KindLetter, fileKey } from "./KindLetter";

/*
 * The diff of one changed file, with review notes on its lines: a click or
 * Shift+click on a line number, or a drag of its `+`, starts a note, kept
 * notes show under their lines, and outdated ones say so (see
 * docs/architecture.md, "The Changes view"). The diff tab draws it.
 *
 * Each line is drawn in two parts, so what builds on this plugs in without
 * reworking the tab: `lineTone` gives a line's background, from its kind
 * and how notes mark it, and `LineContent` draws its text, colored as code
 * with its changed words marked (`DiffText`). `layout` says
 * how the lines are laid out; only "unified" is drawn so far.
 */

/** How the lines of a diff are laid out. */
export type DiffLayout = "unified";

/** How long the lines of a chosen reference stay marked in the diff. */
export const SHOWN_LINES_MS = 1500;

/** How notes mark a line, which `lineTone` turns into its background. */
interface LineMarks {
	/** The line can take a note. */
	notable: boolean;
	/** The line is in the range of the note being written, or being dragged over. */
	noting: boolean;
	/** The drag started on this line. */
	dragAnchor: boolean;
	/** The line is one of a chosen reference's, marked for a moment. */
	shown: boolean;
}

/** The class names of a line's row: its kind, which colors it, and how notes mark it. The one place a line's background is chosen. */
export function lineTone(line: Pick<DiffLine, "kind">, marks: LineMarks): string {
	return `diff-line ${line.kind}${marks.notable ? " notable" : ""}${marks.noting ? " noting" : ""}${marks.dragAnchor ? " drag-anchor" : ""}${marks.shown ? " shown" : ""}`;
}

/** The text of a line, after its numbers and marker. The one place a line's content is drawn. */
function LineContent({ line, spans, word }: { line: DiffLine; spans: readonly CodeSpan[] | undefined; word: WordRange | null }) {
	return <DiffText text={line.text} kind={line.kind} spans={spans} word={word} />;
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
	/** The range the `+` of a line is being dragged over, in this file and comparison, if it is. */
	drag: Drag | null;
	/** The `+` of a line was pressed: start dragging a range from it. */
	startDrag(event: PointerEvent<HTMLButtonElement>, section: number, hunk: readonly DiffLine[], hunkIndex: number, line: number): void;
	/** The pointer moved while dragging. */
	moveDrag(event: PointerEvent<HTMLButtonElement>): void;
	/** The pointer was let go: start the note on the line pressed, or on the range dragged over. */
	endDrag(event: PointerEvent<HTMLButtonElement>): void;
	/** The drag was cut short: nothing starts. */
	cancelDrag(): void;
	/** Whether to ignore this click, since letting go of a drag already started the note. */
	afterDrag(): boolean;
}

/** A range the `+` of a line is dragged over, in one hunk of one file and comparison, with the label beside the pointer. */
interface Drag {
	key: string;
	comparison: Comparison;
	section: number;
	hunk: number;
	anchor: number;
	end: number;
	stop: DragStop | null;
	/** Whether the range has reached another line yet. Until then a press is a click, and there is no label. */
	moved: boolean;
	label: string;
}

/** A drag as the pointer events follow it: the hunk's lines as they showed when it started, the button that holds the pointer, and where the pointer is. */
interface LiveDrag {
	drag: Drag;
	lines: readonly DiffLine[];
	button: HTMLButtonElement;
	pointer: number;
	x: number;
	y: number;
}

/** The pointer must press the `+` itself to drag; the rest of the numbers button only clicks. */
const onPlus = (target: EventTarget) => target instanceof Element && target.closest(".diff-note-plus") !== null;

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

function Section({ section, index, noting, marks }: { section: DiffSection; index: number; noting: Noting; marks: DiffMarks }) {
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
				const drag = noting.drag !== null && noting.drag.section === index && noting.drag.hunk === hunkIndex ? noting.drag : null;
				const dragLow = drag === null ? -1 : Math.min(drag.anchor, drag.end);
				const dragHigh = drag === null ? -1 : Math.max(drag.anchor, drag.end);
				return (
					<div key={hunkIndex} className="diff-hunk" data-hunk={`${index}-${hunkIndex}`}>
						<div className="diff-hunk-header">{hunk.header}</div>
						{hunk.lines.map((line, lineIndex) => {
							const notable = notableLine(line);
							const stop = noting.tabStop;
							const tabStop = stop !== null && stop.section === index && stop.hunk === hunkIndex && stop.line === lineIndex;
							const here = noting.notes.filter(note => sameNotedLine(note.lines[note.lines.length - 1]!, line));
							// While the `+` is dragged in this hunk, the bar follows the drag instead of the note being written.
							const chosen = drag !== null ? lineIndex >= dragLow && lineIndex <= dragHigh : drafting && lineIndex >= low && lineIndex <= high;
							const anchored = drag !== null && drag.anchor === lineIndex;
							const shown = noting.shown !== null && noting.shown.lines.some(noted => sameNotedLine(noted, line));
							return (
								<Fragment key={lineIndex}>
									<div className={lineTone(line, { notable, noting: chosen, dragAnchor: anchored, shown })}>
										{notable ? (
											<button
												type="button"
												className="diff-note-target"
												tabIndex={tabStop ? 0 : -1}
												data-line={lineTarget(index, hunkIndex, lineIndex)}
												aria-label={`Add a note on ${lineWords(line)}`}
												title="Add a note. Drag the + over more lines of this hunk, or Shift+click one, for a range."
												onPointerDown={event => {
													if (event.button !== 0 || event.shiftKey || !onPlus(event.target)) return;
													noting.startDrag(event, index, hunk.lines, hunkIndex, lineIndex);
												}}
												onPointerMove={noting.moveDrag}
												onPointerUp={noting.endDrag}
												onPointerCancel={noting.cancelDrag}
												onLostPointerCapture={noting.cancelDrag}
												onClick={event => {
													if (noting.afterDrag()) return;
													noting.choose(index, hunk.lines, hunkIndex, lineIndex, event.shiftKey);
												}}
												onKeyDown={event => {
													if (stepLineTarget(event.currentTarget, event.key)) event.preventDefault();
													else if (event.key === "Enter" && event.shiftKey) {
														event.preventDefault();
														noting.choose(index, hunk.lines, hunkIndex, lineIndex, true);
													}
												}}
											>
												<span className="diff-note-plus" aria-hidden="true">+</span>
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
										<LineContent line={line} spans={marks.colors?.[index]?.[hunkIndex]?.[lineIndex]} word={marks.words[index]?.[hunkIndex]?.[lineIndex] ?? null} />
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

/** A diff with no text, so its marks have nothing to color. */
const NO_SECTIONS: readonly DiffSection[] = [];

function DiffBody({ file, result, commit, noting }: { file: FileChange; result: FileDiffResult | null; commit: string | null; noting: Noting }) {
	const marks = useDiffMarks(file.path, result?.outcome === "read" && result.diff.kind === "text" ? result.diff.sections : NO_SECTIONS);
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
			{result.diff.kind === "text" && result.diff.sections.map((section, index) => <Section key={index} section={section} index={index} noting={withStop} marks={marks} />)}
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

/**
 * The diff of a changed file of `view`, under a line that names it, with
 * View file and Open in editor. `review` goes in that line, before them:
 * the diff tab's Review button, when it shows.
 */
export function DiffView({ repository, worktree, view, file, layout, review, onClose }: {
	repository: string;
	worktree: Worktree;
	view: ChangesView;
	file: FileChange;
	layout: DiffLayout;
	review: ReactNode;
	/** Close the diff, from the Close button at the end of its title line. */
	onClose: () => void;
}) {
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
	// The range the `+` of a line is dragged over. Drawn again only when its end changes, never on every move of the pointer.
	const [drag, setDrag] = useState<Drag | null>(null);
	// The drag as the pointer events see it, with what they need between renders.
	const dragging = useRef<LiveDrag | null>(null);
	const dragLabel = useRef<HTMLDivElement | null>(null);
	// Set when letting go of a drag started a note, or Escape let go of it, so the click that may follow neither starts another nor makes it one line again.
	const dragged = useRef(false);
	const dragActive = drag !== null;

	/** Put the drag's label beside the pointer. Moved here, not through React, so a long diff is not drawn again on every move. */
	function placeDragLabel() {
		const live = dragging.current;
		if (live !== null && dragLabel.current !== null) dragLabel.current.style.transform = `translate(${live.x + 14}px, ${live.y + 16}px)`;
	}

	/** Ignore the click that may follow the pointer being let go: where it lands depends on the engine, and the next click after that counts again. */
	function skipClick() {
		dragged.current = true;
		setTimeout(() => {
			dragged.current = false;
		});
	}

	/**
	 * Stop dragging without starting a note. With `held`, the pointer is still
	 * pressed, as after Escape: the click that comes once it is let go starts
	 * nothing either.
	 */
	function dropDrag(held = false) {
		const live = dragging.current;
		if (live === null) return;
		dragging.current = null;
		setDrag(null);
		if (live.button.hasPointerCapture(live.pointer)) live.button.releasePointerCapture(live.pointer);
		if (held) window.addEventListener("pointerup", skipClick, { capture: true, once: true });
	}

	/** Find the line of the hunk under the pointer and where the range ends, from the rows on screen near the anchor. */
	function measureDrag() {
		const live = dragging.current;
		if (live === null) return;
		const { section, hunk, anchor } = live.drag;
		const rows = [...(body.current?.querySelector(`[data-hunk="${section}-${hunk}"]`)?.querySelectorAll<HTMLElement>(":scope > .diff-line") ?? [])];
		// The hunk was drawn again with other lines since the drag started: it ends.
		if (rows.length !== live.lines.length) return dropDrag();
		const from = Math.max(0, anchor - NOTE_LINE_LIMIT);
		const near = rows.slice(from, anchor + NOTE_LINE_LIMIT + 1).map(row => row.getBoundingClientRect());
		const range = dragNoteEnd(live.lines, anchor, from + rowAtY(near, live.y));
		if (range.end === live.drag.end && range.stop === live.drag.stop) return;
		live.drag = { ...live.drag, ...range, moved: true, label: describeDraggedRange(live.lines, anchor, range) };
		setDrag(live.drag);
	}

	// Escape lets go of a drag before anything else sees it, so it does not cancel the note being written.
	useEffect(() => {
		if (!dragActive) return;
		const onKey = (event: globalThis.KeyboardEvent) => {
			if (event.key !== "Escape") return;
			event.preventDefault();
			event.stopPropagation();
			dropDrag(true);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [dragActive]);

	// The diff read again, or another file or comparison, ends a drag: its lines may be gone.
	useEffect(() => () => dropDrag(), [view.diff, selected, view.compared]);

	// A reference chosen in the Review section comes into view once its file's diff shows, and its lines stay marked for a moment.
	useEffect(() => {
		if (inView === null || inView.worktree !== worktree.id || view.diff === null || scrolled.current === inView) return;
		if (inViewNote !== null && (selected === null || !sameFileChange(selected, inViewNote.file))) return;
		scrolled.current = inView;
		const first = body.current?.querySelector<HTMLElement>(".diff-line.shown") ?? null;
		const note = body.current?.querySelector<HTMLElement>(`[data-note-id="${CSS.escape(inView.id)}"]`) ?? null;
		// An outdated note whose lines all left the diff has nowhere to show: the Review section said so.
		(first ?? note)?.scrollIntoView({ block: "center" });
		(note ?? first?.querySelector<HTMLElement>(".diff-note-target") ?? null)?.focus({ preventScroll: true });
		setTimeout(() => {
			if (store.getState().noteInView === inView) store.reviewNoteShown();
		}, SHOWN_LINES_MS);
	}, [inView, inViewNote, selected, view.diff, worktree.id, store]);

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
		drag: drag !== null && drag.key === fileKey(file) && drag.comparison === comparison ? drag : null,
		startDrag(event, section, lines, hunkIndex, line) {
			// No text selection and no focus on the button: letting go gives the keyboard to the note's field.
			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			dragged.current = false;
			const start: Drag = { key: fileKey(file), comparison, section, hunk: hunkIndex, anchor: line, end: line, stop: null, moved: false, label: describeDraggedRange(lines, line, { end: line, stop: null }) };
			dragging.current = { drag: start, lines, button: event.currentTarget, pointer: event.pointerId, x: event.clientX, y: event.clientY };
			setDrag(start);
		},
		moveDrag(event) {
			const live = dragging.current;
			// Only the pointer that pressed the `+` drags.
			if (live === null || event.pointerId !== live.pointer) return;
			live.x = event.clientX;
			live.y = event.clientY;
			placeDragLabel();
			measureDrag();
		},
		endDrag(event) {
			const live = dragging.current;
			if (live === null || event.pointerId !== live.pointer) return;
			dragging.current = null;
			setDrag(null);
			const { key, section, hunk, anchor, end } = live.drag;
			// The note starts here, also on one line, so it does not wait on a click the engine may send elsewhere.
			skipClick();
			const at = (at: number) => ({ key, comparison, section, hunk, line: at });
			setDraft(current => {
				const here = current !== null && current.key === key && current.comparison === comparison ? current : null;
				// As a click on the first line and a Shift+click on the last: the text typed so far is kept.
				return chooseNoteLine(chooseNoteLine(here, at(anchor), live.lines, false), at(end), live.lines, true);
			});
		},
		cancelDrag: () => dropDrag(),
		afterDrag() {
			if (!dragged.current) return false;
			dragged.current = false;
			return true;
		},
	};
	return (
		<section className="changes-diff" data-layout={layout} aria-label={`Diff of ${file.path}`}>
			<div className="diff-title">
				<KindLetter file={file} />
				<span className="diff-path" title={file.path}>
					{file.previousPath !== null && <span className="diff-previous">{file.previousPath} → </span>}
					{file.path}
				</span>
				<span className="diff-area">{describeFileArea(file)}</span>
				{review}
				{onDisk && (
					<button type="button" className="button quiet diff-editor" title={`Show ${file.path} as it is now, read-only`} onClick={() => store.openFile(worktree.id, file.path)}>
						View file
					</button>
				)}
				{onDisk && <OpenFileButton repository={repository} worktree={worktree} file={file} />}
				<button type="button" className="button quiet diff-close" title={`Close the diff of ${file.path}`} onClick={onClose}>Close</button>
			</div>
			<div
				className={noting.drag === null ? "diff-body" : "diff-body dragging"}
				ref={body}
				tabIndex={0}
				aria-label={`Changes of ${file.path}`}
				// A wheel turned while dragging moves the lines under a pointer that stands still.
				onScroll={measureDrag}
			>
				<DiffBody file={file} result={view.diff} commit={view.compared === "base" && view.base?.usable ? view.base.commit : null} noting={noting} />
			</div>
			{noting.drag?.moved === true && createPortal(
				// Only for the eye: the note's field says the range once the pointer is let go.
				<div
					className="diff-drag-label"
					aria-hidden="true"
					ref={element => {
						dragLabel.current = element;
						placeDragLabel();
					}}
				>
					{noting.drag.label}
				</div>,
				document.body,
			)}
		</section>
	);
}
