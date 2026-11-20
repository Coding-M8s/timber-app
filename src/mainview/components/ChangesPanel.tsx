import { type KeyboardEvent, useEffect, useId, useRef } from "react";
import type { DiffSection, FileChange, FileChangeTarget, FileDiffResult } from "../../shared/file-changes";
import { sameFileChange } from "../../shared/file-changes";
import type { Repository, Worktree } from "../../shared/model";
import {
	AREA_TITLES, COMPARISONS, COMPARISON_LABELS, KIND_LABELS, KIND_LETTERS, MORE_FILES_NOTE, baseUnavailable, describeComparison, describeDiffNotice, describeFileArea,
	describeFileCounts, describeNoChanges, fileAfterKey, groupFileChanges, kindTone, listedOrder, splitPath,
} from "../changes-format";
import { chosenComparison } from "../../shared/layout";
import { ModeSwitch } from "./worktree-modes/ModeSwitch";
import { OPEN_IN_EDITOR } from "../editor-format";
import { useAppState, useStore } from "../store/react";
import { type ChangesView, isRunning } from "../store/state";
import { EditorIcon, useOpenInEditor } from "./OpenInEditor";

export const FOLDER_MISSING_CHANGES = "The worktree's folder is missing, so there are no changes to read.";

const fileKey = (file: FileChangeTarget) => `${file.area}\0${file.path}\0${file.previousPath ?? ""}`;

function KindLetter({ file }: { file: FileChange }) {
	return (
		<span className={`change-letter ${kindTone(file.kind)}`} title={KIND_LABELS[file.kind]} aria-hidden="true">
			{KIND_LETTERS[file.kind]}
		</span>
	);
}

/** The list of changed files, grouped as `git status` groups them. Only the selected file is a tab stop; the arrows reach the others. */
function FileList({ view }: { view: ChangesView & { files: readonly FileChange[] } }) {
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
		<div className="change-groups" onKeyDown={onKey}>
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

function Section({ section }: { section: DiffSection }) {
	return (
		<div className="diff-section">
			{section.header.length > 0 && (
				<div className="diff-header">
					{section.header.map((line, index) => <div key={index}>{line}</div>)}
				</div>
			)}
			{section.hunks.map((hunk, index) => (
				<div key={index} className="diff-hunk">
					<div className="diff-hunk-header">{hunk.header}</div>
					{hunk.lines.map((line, lineIndex) => (
						<div key={lineIndex} className={`diff-line ${line.kind}`}>
							<span className="diff-number">{line.oldLine ?? ""}</span>
							<span className="diff-number">{line.newLine ?? ""}</span>
							<span className="diff-marker" aria-hidden="true">{line.kind === "added" ? "+" : line.kind === "removed" ? "-" : ""}</span>
							<span className="diff-text">{line.text}</span>
						</div>
					))}
				</div>
			))}
		</div>
	);
}

function DiffBody({ file, result, commit }: { file: FileChange; result: FileDiffResult | null; commit: string | null }) {
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
	return (
		<>
			{notice !== null && (
				<div className="diff-notice">
					<p className="empty-title">{notice.title}</p>
					<p className="empty-text">{notice.text}</p>
				</div>
			)}
			{result.diff.kind === "text" && result.diff.sections.map((section, index) => <Section key={index} section={section} />)}
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

/** The diff of the selected file, under a line that names it. */
function DiffPane({ repository, worktree, view }: { repository: string; worktree: Worktree; view: ChangesView }) {
	const selected = view.selected;
	const file = selected === null ? undefined : view.files?.find(candidate => sameFileChange(candidate, selected));
	if (!file) {
		return (
			<section className="changes-diff empty" aria-label="Diff">
				<p className="empty-text">{view.files !== null && view.files.length > 0 ? "Select a file to see its changes." : ""}</p>
			</section>
		);
	}
	// A deleted file is not on disk, so there is nothing to open.
	const onDisk = file.kind !== "deleted";
	return (
		<section className="changes-diff" aria-label={`Diff of ${file.path}`}>
			<div className="diff-title">
				<KindLetter file={file} />
				<span className="diff-path" title={file.path}>
					{file.previousPath !== null && <span className="diff-previous">{file.previousPath} → </span>}
					{file.path}
				</span>
				<span className="diff-area">{describeFileArea(file)}</span>
				{onDisk && <OpenFileButton repository={repository} worktree={worktree} file={file} />}
			</div>
			<div className="diff-body" tabIndex={0} aria-label={`Changes of ${file.path}`}>
				<DiffBody file={file} result={view.diff} commit={view.compared === "base" && view.base?.usable ? view.base.commit : null} />
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

	// `worktree` is a new object after every reload of its repository, so this follows the rest of the status.
	useEffect(() => {
		if (!missing) void store.readChanges(repository.path, worktree.id);
	}, [store, repository.path, worktree, missing]);

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
	const reading = state.operations.some(operation => operation.kind === "read-changes" && operation.worktree === worktree.id);
	const reloading = isRunning(state, "reload-all") || state.operations.some(operation => operation.kind === "reload-repository" && operation.repository === repository.path);
	const files = view?.files ?? null;

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
				</div>
				{unavailable !== null && <p className="changes-base-note" id={baseNote}>{unavailable}</p>}
				<div className="changes-bar">
					<span className="changes-count" role="status">{files === null ? "Reading changes" : describeFileCounts(files, view?.more ?? false)}</span>
					<button
						type="button"
						className="text-button"
						disabled={reading || reloading}
						title="Read this repository's worktrees and their changes again"
						onClick={() => void store.reloadRepository(repository.path)}
					>
						{reading || reloading ? "Refreshing" : "Refresh"}
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
						<div className="changes-clean">
							<p className="empty-title">No changes</p>
							<p className="empty-text">{describeNoChanges(compared, base)}</p>
						</div>
					)
					: <FileList view={{ ...view, files }} />)}
				{view?.more === true && <p className="changes-more">{MORE_FILES_NOTE}</p>}
			</div>
			{view !== null && <DiffPane repository={repository.path} worktree={worktree} view={view} />}
		</div>
	);
}
