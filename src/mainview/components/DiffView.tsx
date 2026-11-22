import { Fragment, type PointerEvent, type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Comparison, DiffLine, FileChange, FileChangeTarget, FileDiffResult } from "../../shared/file-changes";
import { NOTE_LINE_LIMIT, type NoteDraft, type ReviewNote, chooseNoteLine, notableLine, sameNotedLine } from "../../shared/review";
import { InlineNote, NoteForm } from "./ReviewNotes";
import { type DragStop, describeDraggedRange, dragNoteEnd, rowAtY } from "../review-drag";
import { sameFileChange } from "../../shared/file-changes";
import type { Worktree } from "../../shared/model";
import { describeDiffNotice, describeFileArea } from "../changes-format";
import { OPEN_IN_EDITOR } from "../editor-format";
import { useAppState, useStore } from "../store/react";
import { type ChangesView, sidePanelShown, sidePanelView } from "../store/state";
import { toggleSidePanel } from "./SidePanel";
import { EditorIcon, useOpenInEditor } from "./OpenInEditor";
import { type DiffMarks, DiffText, useDiffMarks } from "./DiffText";
import type { CodeSpan } from "../diff-highlight";
import { type DiffSide, MIN_SPLIT_WIDTH, SPLIT_TOO_NARROW, shownLayout, splitRows, trackLines } from "../../shared/diff-split";
import { DIFF_LAYOUTS, type DiffLayout } from "../../shared/layout";
import { ModeSwitch } from "./worktree-modes/ModeSwitch";
import type { WordRange } from "../diff-words";
import { KindLetter, fileKey } from "./KindLetter";
import { LineCounts } from "./ChangesList";
import { type ShownSection, type UnchangedGap, describeUnchangedLines, gapHoldsLine, shownSections } from "../diff-unchanged";
import { speakLineCounts } from "../changes-format";

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
 * how the lines are laid out: Unified, one column, or Split, old and new
 * side by side (`splitRows` in src/shared/diff-split.ts). In Split a note
 * or a range is on one side, and takes only that side's lines.
 */

export const HIDE_SIDE_PANEL = "Hide side panel";
export const SHOW_SPLIT_ANYWAY = "Show Split anyway";

/** The labels of the layout switch, in the order of `DIFF_LAYOUTS`. */
const LAYOUT_LABELS: Record<DiffLayout, string> = { unified: "Unified", split: "Split" };

/**
 * The Unified | Split switch, at the end of the worktree's tab row while
 * the diff tab shows, where it has room: the diff's own title line is full.
 * The choice is saved for every worktree.
 */
export function DiffLayoutSwitch() {
	const store = useStore();
	const state = useAppState();
	return (
		<span className="diff-layout">
			<ModeSwitch
				label="Diff layout"
				labels={DIFF_LAYOUTS.map(choice => LAYOUT_LABELS[choice])}
				selected={DIFF_LAYOUTS.indexOf(state.layout.diffLayout)}
				disabled={false}
				onSelect={index => store.chooseDiffLayout(DIFF_LAYOUTS[index]!)}
			/>
		</span>
	);
}

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
	tabStop: { section: number; hunk: number; line: number; side: DiffSide | null } | null;
	/** A line number was chosen, on a side of Split or in Unified (null): start a note there, or with `extend`, stretch the note being written to it. */
	choose(section: number, hunk: readonly DiffLine[], hunkIndex: number, line: number, extend: boolean, side: DiffSide | null): void;
	/** What is typed in the note being written, kept with the draft so that stretching it keeps the text. */
	type(text: string): void;
	/** Put the draft away, and give the keyboard back to the line it ended on. */
	close(): void;
	/** The range the `+` of a line is being dragged over, in this file and comparison, if it is. */
	drag: Drag | null;
	/** The `+` of a line was pressed: start dragging a range from it. */
	startDrag(event: PointerEvent<HTMLButtonElement>, section: number, hunk: readonly DiffLine[], hunkIndex: number, line: number, side: DiffSide | null): void;
	/** The pointer moved while dragging. */
	moveDrag(event: PointerEvent<HTMLButtonElement>): void;
	/** The pointer was let go: start the note on the line pressed, or on the range dragged over. */
	endDrag(event: PointerEvent<HTMLButtonElement>): void;
	/** The drag was cut short: nothing starts. */
	cancelDrag(): void;
	/** Whether to ignore this click, since letting go of a drag already started the note. */
	afterDrag(): boolean;
	/** Show the unchanged lines from new line `from`, in the slot `hunk` of `section`, and give the keyboard to the first of them. */
	expand(from: number, section: number, hunk: number): void;
}

/** A range the `+` of a line is dragged over, in one hunk of one file and comparison, on one side in Split, with the label beside the pointer. */
interface Drag {
	key: string;
	comparison: Comparison;
	section: number;
	hunk: number;
	anchor: number;
	end: number;
	side: DiffSide | null;
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

/** Names a line number button, so the keyboard can be given back to it: in Split, also its side, since a kept line shows on both. */
const lineTarget = (section: number, hunk: number, line: number, side: DiffSide | null) => `${section}-${hunk}-${line}${side === null ? "" : `-${side}`}`;

/** Words for a line, to say what a note goes on. */
function lineWords(line: DiffLine): string {
	if (line.newLine !== null) return `line ${line.newLine}`;
	return `removed line ${line.oldLine}`;
}

/** The next or previous line number button of the diff, for the arrows: in Split, on the same side. */
function stepLineTarget(from: HTMLElement, key: string, altKey: boolean): boolean {
	// Alt+Up and Alt+Down open the previous and next file instead.
	if ((key !== "ArrowDown" && key !== "ArrowUp") || altKey) return false;
	const side = from.getAttribute("data-side");
	const all = [...(from.closest(".diff-body")?.querySelectorAll<HTMLButtonElement>(".diff-note-target") ?? [])].filter(target => target.getAttribute("data-side") === side);
	const at = all.indexOf(from as HTMLButtonElement);
	const next = all[at + (key === "ArrowDown" ? 1 : -1)];
	next?.focus();
	return true;
}

/**
 * How notes mark the lines of one hunk: the note being written there, and
 * whether a line, drawn on a side of Split or in Unified (null), is in its
 * range or the range being dragged over, or is where the drag started. A
 * range on a side takes only that side's lines; one started in Unified
 * takes every line between its ends, on both sides.
 */
function hunkMarks(noting: Noting, section: number, hunkIndex: number, lines: readonly DiffLine[]) {
	const { draft } = noting;
	const drafting = draft !== null && draft.section === section && draft.hunk === hunkIndex ? draft : null;
	const drag = noting.drag !== null && noting.drag.section === section && noting.drag.hunk === hunkIndex ? noting.drag : null;
	const within = (range: { anchor: number; end: number; side: DiffSide | null }) => {
		const low = Math.min(range.anchor, range.end);
		const high = Math.max(range.anchor, range.end);
		const onSide = range.side === null ? null : new Set(trackLines(lines, range.side));
		return (index: number, cell: DiffSide | null) => {
			if (index < low || index > high || onSide === null) return index >= low && index <= high;
			return cell === null ? onSide.has(index) : cell === range.side;
		};
	};
	const inDraft = drafting === null ? () => false : within(drafting);
	const inDrag = drag === null ? null : within(drag);
	return {
		drafting,
		/** The line is in the draft's range. */
		inDraft,
		/** The line shows the range's bar: while the `+` is dragged in this hunk, the bar follows the drag instead of the note being written. */
		chosen: (index: number, cell: DiffSide | null) => inDrag !== null ? inDrag(index, cell) : inDraft(index, cell),
		anchored: (index: number, cell: DiffSide | null) => drag !== null && drag.anchor === index && (drag.side === null || cell === null || cell === drag.side),
	};
}

/** The button of a line's numbers: a click starts a note there, Shift stretches the note being written to it, and its `+` drags a range. */
function NoteTarget({ noting, section, lines, hunkIndex, index, side, numbers }: {
	noting: Noting;
	section: number;
	lines: readonly DiffLine[];
	hunkIndex: number;
	index: number;
	/** The column of Split it is in, or null in Unified. */
	side: DiffSide | null;
	numbers: readonly (number | null)[];
}) {
	const line = lines[index]!;
	const stop = noting.tabStop;
	const tabStop = stop !== null && stop.section === section && stop.hunk === hunkIndex && stop.line === index && stop.side === side;
	return (
		<button
			type="button"
			className="diff-note-target"
			tabIndex={tabStop ? 0 : -1}
			data-line={lineTarget(section, hunkIndex, index, side)}
			data-side={side ?? undefined}
			aria-label={`Add a note on ${lineWords(line)}`}
			title={side === null
				? "Add a note. Drag the + over more lines of this hunk, or Shift+click one, for a range."
				: "Add a note. Drag the + over more lines of this side of the hunk, or Shift+click one, for a range."}
			onPointerDown={event => {
				if (event.button !== 0 || event.shiftKey || !onPlus(event.target)) return;
				noting.startDrag(event, section, lines, hunkIndex, index, side);
			}}
			onPointerMove={noting.moveDrag}
			onPointerUp={noting.endDrag}
			onPointerCancel={noting.cancelDrag}
			onLostPointerCapture={noting.cancelDrag}
			onClick={event => {
				if (noting.afterDrag()) return;
				noting.choose(section, lines, hunkIndex, index, event.shiftKey, side);
			}}
			onKeyDown={event => {
				if (stepLineTarget(event.currentTarget, event.key, event.altKey)) event.preventDefault();
				else if (event.key === "Enter" && event.shiftKey) {
					event.preventDefault();
					noting.choose(section, lines, hunkIndex, index, true, side);
				}
			}}
		>
			<span className="diff-note-plus" aria-hidden="true">+</span>
			{numbers.map((number, at) => <span key={at} className="diff-number">{number ?? ""}</span>)}
		</button>
	);
}

/** The field of the note being written, under the last line of its range. */
function DraftForm({ noting, draft, last }: { noting: Noting; draft: NoteDraft; last: DiffLine }) {
	const store = useStore();
	const count = draft.lines.length;
	return (
		<div className="diff-note">
			<NoteForm
				label={count > 1 ? `Note on ${count} lines, ending at ${lineWords(last)}` : `Note on ${lineWords(last)}`}
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
	);
}

/** What a hunk needs to be drawn, in either layout. */
interface HunkProps {
	lines: readonly DiffLine[];
	header: string;
	section: number;
	hunkIndex: number;
	noting: Noting;
	marks: DiffMarks;
	/** Split shown anyway in a tab too narrow for it: the hunk keeps its readable width, and the diff scrolls sideways. */
	cramped: boolean;
	/** The unchanged lines before a hunk, shown, rather than Git's hunk. */
	unchanged: boolean;
}

/** The row that shows the unchanged lines before a hunk. */
function UnchangedRow({ count, onExpand }: { count: number; onExpand: () => void }) {
	return (
		<button type="button" className="diff-gap" onClick={onExpand}>
			<svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
				<path d="m7 15 5 5 5-5M7 9l5-5 5 5" />
			</svg>
			{describeUnchangedLines(count)}
		</button>
	);
}

const markerOf = (line: DiffLine) => line.kind === "added" ? "+" : line.kind === "removed" ? "-" : "";

/** A hunk in one column: each line with its old and new numbers, removed lines above what they became. */
function UnifiedHunk({ lines, header, section, hunkIndex, noting, marks, unchanged }: HunkProps) {
	const { drafting, inDraft, chosen, anchored } = hunkMarks(noting, section, hunkIndex, lines);
	const high = drafting === null ? -1 : Math.max(drafting.anchor, drafting.end);
	return (
		<div className={unchanged ? "diff-hunk unchanged" : "diff-hunk"} data-hunk={`${section}-${hunkIndex}`}>
			{header !== "" && <div className="diff-hunk-header">{header}</div>}
			{lines.map((line, lineIndex) => {
				const notable = notableLine(line);
				const here = noting.notes.filter(note => sameNotedLine(note.lines[note.lines.length - 1]!, line));
				const shown = noting.shown !== null && noting.shown.lines.some(noted => sameNotedLine(noted, line));
				return (
					<Fragment key={lineIndex}>
						<div className={lineTone(line, { notable, noting: chosen(lineIndex, null), dragAnchor: anchored(lineIndex, null), shown })}>
							{notable ? (
								<NoteTarget noting={noting} section={section} lines={lines} hunkIndex={hunkIndex} index={lineIndex} side={null} numbers={[line.oldLine, line.newLine]} />
							) : (
								<>
									<span className="diff-number">{line.oldLine ?? ""}</span>
									<span className="diff-number">{line.newLine ?? ""}</span>
								</>
							)}
							<span className="diff-marker" aria-hidden="true">{markerOf(line)}</span>
							<LineContent line={line} spans={marks.colors?.[section]?.[hunkIndex]?.[lineIndex]} word={marks.words[section]?.[hunkIndex]?.[lineIndex] ?? null} />
						</div>
						{here.map(note => <InlineNote key={note.id} worktree={noting.worktree} note={note} />)}
						{drafting !== null && lineIndex === high && inDraft(lineIndex, null) && <DraftForm noting={noting} draft={drafting} last={line} />}
					</Fragment>
				);
			})}
		</div>
	);
}

/**
 * A hunk side by side (`splitRows`): old lines on the left with their old
 * numbers, new on the right with their new numbers, an edited line beside
 * what it became, and a hatched empty cell where a side has no line. Notes
 * and the note's field go under the row, across both sides.
 */
function SplitHunk({ lines, header, section, hunkIndex, noting, marks, cramped, unchanged }: HunkProps) {
	const { drafting, inDraft, chosen, anchored } = hunkMarks(noting, section, hunkIndex, lines);
	const rows = useMemo(() => splitRows(lines), [lines]);
	// The note's field goes under the last row with a line of its range.
	let formRow = -1;
	let formLine: DiffLine | null = null;
	if (drafting !== null) {
		const high = Math.max(drafting.anchor, drafting.end);
		rows.forEach((row, at) => {
			for (const side of ["old", "new"] as const) {
				const index = row[side];
				if (index !== null && inDraft(index, side)) {
					formRow = at;
					if (index === high) formLine = lines[index]!;
				}
			}
		});
		formLine ??= lines[high] ?? null;
	}
	const cell = (index: number | null, side: DiffSide) => {
		if (index === null) return <div className="diff-cell-empty" aria-hidden="true" />;
		const line = lines[index]!;
		const notable = notableLine(line);
		const shown = noting.shown !== null && noting.shown.lines.some(noted => sameNotedLine(noted, line));
		const number = side === "old" ? line.oldLine : line.newLine;
		return (
			<div className={`${lineTone(line, { notable, noting: chosen(index, side), dragAnchor: anchored(index, side), shown })} diff-cell`} data-side={side}>
				{notable
					? <NoteTarget noting={noting} section={section} lines={lines} hunkIndex={hunkIndex} index={index} side={side} numbers={[number]} />
					: <span className="diff-number">{number ?? ""}</span>}
				<span className="diff-marker" aria-hidden="true">{markerOf(line)}</span>
				<LineContent line={line} spans={marks.colors?.[section]?.[hunkIndex]?.[index]} word={marks.words[section]?.[hunkIndex]?.[index] ?? null} />
			</div>
		);
	};
	return (
		<div className={unchanged ? "diff-hunk diff-hunk-split unchanged" : "diff-hunk diff-hunk-split"} data-hunk={`${section}-${hunkIndex}`} style={cramped ? { minWidth: MIN_SPLIT_WIDTH } : undefined}>
			{header !== "" && <div className="diff-hunk-header">{header}</div>}
			{rows.map((row, at) => {
				const here = noting.notes.filter(note => {
					const last = note.lines[note.lines.length - 1]!;
					return (row.old !== null && sameNotedLine(last, lines[row.old]!)) || (row.new !== null && sameNotedLine(last, lines[row.new]!));
				});
				return (
					<Fragment key={at}>
						<div className="diff-split-row">
							{cell(row.old, "old")}
							{cell(row.new, "new")}
						</div>
						{here.map(note => <InlineNote key={note.id} worktree={noting.worktree} note={note} />)}
						{drafting !== null && formLine !== null && at === formRow && <DraftForm noting={noting} draft={drafting} last={formLine} />}
					</Fragment>
				);
			})}
		</div>
	);
}

function Section({ section, index, noting, marks, layout, cramped }: { section: ShownSection; index: number; noting: Noting; marks: DiffMarks; layout: DiffLayout; cramped: boolean }) {
	return (
		<div className="diff-section">
			{section.header.length > 0 && (
				<div className="diff-header">
					{section.header.map((line, lineIndex) => <div key={lineIndex}>{line}</div>)}
				</div>
			)}
			{section.hunks.map((hunk, hunkIndex) => {
				const gap = hunk.unchanged;
				if (gap !== null && !gap.shown) return <UnchangedRow key={hunkIndex} count={gap.count} onExpand={() => noting.expand(gap.from, index, hunkIndex)} />;
				// The slot of unchanged lines before a hunk, with nothing to show.
				if (hunk.lines.length === 0 && hunk.header === "") return null;
				const props: HunkProps = { lines: hunk.lines, header: hunk.header, section: index, hunkIndex, noting, marks, cramped, unchanged: gap !== null };
				return layout === "split" ? <SplitHunk key={hunkIndex} {...props} /> : <UnifiedHunk key={hunkIndex} {...props} />;
			})}
		</div>
	);
}

/** A diff with no text, so its marks have nothing to color. */
const NO_SECTIONS: readonly ShownSection[] = [];

const NOTHING_OPENED: readonly number[] = [];

function DiffBody({ file, result, commit, noting, layout, cramped, unchanged, gapShown }: {
	file: FileChange;
	result: FileDiffResult | null;
	commit: string | null;
	noting: Noting;
	layout: DiffLayout;
	cramped: boolean;
	/** The file's lines on disk, when they are its diff's new side. */
	unchanged: readonly string[] | null;
	/** Whether the unchanged lines of a gap show. */
	gapShown: (gap: UnchangedGap) => boolean;
}) {
	const diff = result?.outcome === "read" ? result.diff : null;
	const sections = useMemo(() => (diff === null ? NO_SECTIONS : shownSections(diff, unchanged, gapShown)), [diff, unchanged, gapShown]);
	const marks = useDiffMarks(file.path, sections);
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
	let tabStop: Noting["tabStop"] = null;
	// The first line number button in the order the diff draws them: in Split, row by row, the left one first.
	for (const [section, part] of sections.entries()) {
		for (const [hunk, { lines }] of part.hunks.entries()) {
			if (tabStop !== null) break;
			if (layout === "unified") {
				const line = lines.findIndex(notableLine);
				if (line >= 0) tabStop = { section, hunk, line, side: null };
				continue;
			}
			for (const row of splitRows(lines)) {
				const side = (["old", "new"] as const).find(side => row[side] !== null && notableLine(lines[row[side]]!));
				if (side !== undefined) {
					tabStop = { section, hunk, line: row[side]!, side };
					break;
				}
			}
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
			{sections.map((section, index) => <Section key={index} section={section} index={index} noting={withStop} marks={marks} layout={layout} cramped={cramped} />)}
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
 * its line counts, View file and Open in editor. `steps` goes first in that
 * line: the previous and next file buttons. `review` and `viewed` go before
 * View file: the diff tab's Review button, when it shows, and its Viewed box.
 * `layout` is the layout chosen (`DiffLayoutSwitch`); a tab too narrow for
 * Split, or a conflict's combined diff, shows Unified and says why.
 */
export function DiffView({ repository, worktree, view, file, layout, steps, review, viewed, onClose }: {
	repository: string;
	worktree: Worktree;
	view: ChangesView;
	file: FileChange;
	layout: DiffLayout;
	steps: ReactNode;
	review: ReactNode;
	viewed: ReactNode;
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
	// The gaps of unchanged lines shown in this file and comparison, by their first new line. Another file starts with none.
	const here = `${view.compared ?? ""}\0${fileKey(file)}`;
	const [opened, setOpened] = useState<{ key: string; from: readonly number[] }>({ key: here, from: [] });
	const openedHere = opened.key === here ? opened.from : NOTHING_OPENED;
	const section = useRef<HTMLElement>(null);
	const layoutNote = useId();
	// The tab's width, so a tab too narrow for two columns shows Unified. Null until measured.
	const [width, setWidth] = useState<number | null>(null);
	useEffect(() => {
		const element = section.current;
		if (element === null || typeof ResizeObserver === "undefined") return;
		setWidth(element.getBoundingClientRect().width);
		const observer = new ResizeObserver(entries => setWidth(entries[entries.length - 1]!.contentRect.width));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	const result = view.diff;
	// "Show Split anyway" in a tab too narrow for it: kept while the tab shows, never saved.
	const [forced, setForced] = useState(false);
	const shown = shownLayout(layout, width, result?.outcome === "read" && result.diff.kind === "text" ? result.diff.sections.flatMap(part => part.hunks) : [], forced);
	const narrow = shown.reason === SPLIT_TOO_NARROW;
	const panelShown = sidePanelShown(state);

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
		const { section, hunk, anchor, side } = live.drag;
		const hunkElement = body.current?.querySelector(`[data-hunk="${section}-${hunk}"]`);
		// In Split, the rows of the drag's side, with the empty cells left out: a pointer over one is in the gap under the row above.
		const rows = [...(hunkElement?.querySelectorAll<HTMLElement>(side === null ? ":scope > .diff-line" : `.diff-line[data-side="${side}"]`) ?? [])];
		const track = trackLines(live.lines, side);
		// The hunk was drawn again with other lines, or in the other layout, since the drag started: it ends.
		if (rows.length !== track.length || hunkElement?.classList.contains("diff-hunk-split") !== (side !== null)) return dropDrag();
		const start = track.indexOf(anchor);
		const from = Math.max(0, start - NOTE_LINE_LIMIT);
		const near = rows.slice(from, start + NOTE_LINE_LIMIT + 1).map(row => row.getBoundingClientRect());
		const range = dragNoteEnd(live.lines, anchor, from + rowAtY(near, live.y), side);
		if (range.end === live.drag.end && range.stop === live.drag.stop) return;
		live.drag = { ...live.drag, ...range, moved: true, label: describeDraggedRange(live.lines, anchor, range, side) };
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
	useEffect(() => () => dropDrag(), [view.diff, selected, view.compared, shown.layout]);

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
	// A gap that holds a noted line shows by itself, so the note shows under its line and its reference can mark it.
	const fileNotes = (state.reviews[worktree.id] ?? []).filter(note => note.comparison === comparison && sameFileChange(note.file, file));
	const notedNumbers = fileNotes.flatMap(note => note.lines.map(line => line.newLine).filter((number): number is number => number !== null));
	const openKey = `${openedHere.join(",")}|${notedNumbers.join(",")}`;
	const gapShown = useMemo(() => {
		const open = new Set(openedHere);
		return (gap: UnchangedGap) => open.has(gap.from) || gapHoldsLine(gap, notedNumbers);
		// The key holds both lists, so the check changes only when they do.
	}, [openKey]);
	const noting: Noting = {
		worktree: worktree.id,
		comparison,
		file,
		notes: fileNotes,
		shown: inViewNote !== null && inViewNote.comparison === comparison && sameFileChange(inViewNote.file, file) ? inViewNote : null,
		draft: draft !== null && draft.key === fileKey(file) && draft.comparison === comparison ? draft : null,
		tabStop: null,
		choose(section, hunk, hunkIndex, line, extend, side) {
			setDraft(chooseNoteLine(noting.draft, { key: fileKey(file), comparison, section, hunk: hunkIndex, line, side }, hunk, extend));
		},
		type: text => setDraft(current => current && { ...current, text }),
		close() {
			const ended = noting.draft;
			setDraft(null);
			if (ended === null) return;
			// After the form is gone, the keyboard goes back to the line the note ended on: in Split, on its side, or either for a note started in Unified.
			const targets = shown.layout === "unified" ? [null] : ended.side === null ? ["new", "old"] as const : [ended.side];
			setTimeout(() => {
				const target = targets.map(side => body.current?.querySelector<HTMLElement>(`[data-line="${lineTarget(ended.section, ended.hunk, ended.end, side)}"]`)).find(found => found != null);
				target?.focus();
			});
		},
		drag: drag !== null && drag.key === fileKey(file) && drag.comparison === comparison ? drag : null,
		startDrag(event, section, lines, hunkIndex, line, side) {
			// No text selection and no focus on the button: letting go gives the keyboard to the note's field.
			event.preventDefault();
			event.currentTarget.setPointerCapture(event.pointerId);
			dragged.current = false;
			const start: Drag = { key: fileKey(file), comparison, section, hunk: hunkIndex, anchor: line, end: line, side, stop: null, moved: false, label: describeDraggedRange(lines, line, { end: line, stop: null }, side) };
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
			const { key, section, hunk, anchor, end, side } = live.drag;
			// The note starts here, also on one line, so it does not wait on a click the engine may send elsewhere.
			skipClick();
			const at = (at: number) => ({ key, comparison, section, hunk, line: at, side });
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
		expand(from, section, hunk) {
			setOpened({ key: here, from: [...openedHere, from] });
			// The row goes; the keyboard goes to the first line it showed, on the left in Split.
			setTimeout(() => body.current?.querySelector<HTMLElement>(`[data-line="${lineTarget(section, hunk, 0, shown.layout === "split" ? "old" : null)}"]`)?.focus());
		},
	};
	const counts = speakLineCounts(file);
	return (
		<section className="changes-diff" ref={section} data-layout={shown.layout} aria-label={`Diff of ${file.path}`}>
			<div className="diff-title">
				{steps}
				<KindLetter file={file} />
				<span className="diff-path" title={file.path}>
					{file.previousPath !== null && <span className="diff-previous">{file.previousPath} → </span>}
					{file.path}
				</span>
				<span className="diff-area">{describeFileArea(file)}</span>
				<LineCounts file={file} />
				{counts !== "" && <span className="visually-hidden">{counts}</span>}
				{review}
				{viewed}
				{/* One group at the end of the line, which wraps as a whole where the diff is narrow. */}
				<span className="diff-actions">
					{onDisk && (
						<button type="button" className="button quiet diff-editor" title={`Show ${file.path} as it is now, read-only`} onClick={() => store.openFile(worktree.id, file.path)}>
							View file
						</button>
					)}
					{onDisk && <OpenFileButton repository={repository} worktree={worktree} file={file} />}
					<button type="button" className="button quiet diff-close" title={`Close the diff of ${file.path}`} onClick={onClose}>Close</button>
				</span>
			</div>
			{shown.reason !== null && (
				<div className="diff-layout-note">
					<p id={layoutNote} role="status">{shown.reason}</p>
					{narrow && (
						<span className="diff-layout-actions">
							{panelShown && (
								<button type="button" className="button quiet" title="Hide the side panel, so the diff has room for two columns" onClick={() => void toggleSidePanel(store, sidePanelView(state))}>
									{HIDE_SIDE_PANEL}
								</button>
							)}
							<button type="button" className="button quiet" title="Show old and new side by side in this tab, scrolling sideways where it is too narrow" onClick={() => setForced(true)}>
								{SHOW_SPLIT_ANYWAY}
							</button>
						</span>
					)}
				</div>
			)}
			<div
				className={noting.drag === null ? "diff-body" : "diff-body dragging"}
				ref={body}
				tabIndex={0}
				aria-label={`Changes of ${file.path}`}
				// A wheel turned while dragging moves the lines under a pointer that stands still.
				onScroll={measureDrag}
			>
				<DiffBody
					file={file}
					result={view.diff}
					commit={view.compared === "base" && view.base?.usable ? view.base.commit : null}
					noting={noting}
					layout={shown.layout}
					cramped={shown.cramped}
					unchanged={view.unchanged}
					gapShown={gapShown}
				/>
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
