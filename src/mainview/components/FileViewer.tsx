import { type KeyboardEvent, useEffect, useMemo, useState } from "react";
import type { Worktree } from "../../shared/model";
import { terminalFontStack } from "../../shared/terminal-appearance";
import { editableText, textLines } from "../../shared/worktree-files";
import { OPEN_IN_EDITOR } from "../editor-format";
import { canEditFile, describeFileNotice, fileText, hasUnsavedEdits } from "../file-view-format";
import { useStore } from "../store/react";
import type { FileMode, FileView } from "../store/state";
import { terminalAppearance, watchTerminalAppearance } from "../terminal-look";
import { MarkdownView } from "./MarkdownView";
import { EditorIcon, useOpenInEditor } from "./OpenInEditor";
import { ModeSwitch } from "./worktree-modes/ModeSwitch";

/** The terminal's font and size from Settings, Terminal, following every change. */
function useTerminalFont(): { fontFamily: string; fontSize: number } {
	const [appearance, setAppearance] = useState(terminalAppearance);
	useEffect(() => watchTerminalAppearance(setAppearance), []);
	return { fontFamily: terminalFontStack(appearance.fontFamily), fontSize: appearance.fontSize };
}

const MODES: readonly FileMode[] = ["rendered", "source", "edit"];
const MODE_LABELS = ["Rendered", "Source", "Edit"];

/**
 * The File tab: one file of the worktree, with line numbers, in the
 * terminal's font. A Markdown file shows rendered first, with a switch to
 * its source, and its source can be edited and saved; any other file is
 * read-only. The numbers and the text are two blocks side by side, not an
 * element per line, so a long file draws quickly.
 */
export function FileViewer({ repository, worktree, view }: { repository: string; worktree: Worktree; view: FileView }) {
	const store = useStore();
	const font = useTerminalFont();
	const { action, open } = useOpenInEditor(repository, worktree, view.path);
	const { result } = view;
	const onDisk = fileText(view);
	const editable = canEditFile(view);
	// What shows is the draft while there is one, in every mode, so Rendered previews it.
	const text = view.draft ?? (onDisk === null ? null : editableText(onDisk));
	const mode: FileMode = view.mode === "edit" && view.draft === null ? "source" : view.mode;
	const lines = useMemo(() => text === null ? null : textLines(text), [text]);
	const numbers = useMemo(() => lines === null ? "" : lines.map((_, index) => index + 1).join("\n"), [lines]);
	const notice = result === null || view.draft !== null ? null : describeFileNotice(result);
	const unsaved = hasUnsavedEdits(view);
	const id = worktree.id;

	const onEditorKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
		// Ctrl+S (Cmd+S on macOS) saves, as in an editor.
		if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "s") {
			event.preventDefault();
			if (unsaved && !view.saving) void store.saveFile(id);
		}
	};

	return (
		<section className="file-viewer" aria-label={`File ${view.path}`}>
			<div className="diff-title file-viewer-title">
				<span className="diff-path" title={view.path}>{view.path}</span>
				{editable || view.draft !== null
					? (
						<ModeSwitch
							labels={MODE_LABELS}
							selected={MODES.indexOf(mode)}
							disabled={view.saving}
							label={`How to show ${view.path}`}
							onSelect={index => {
								const next = MODES[index]!;
								if (next === "edit") store.editFile(id);
								else store.showFileAs(id, next);
							}}
						/>
					)
					: <span className="diff-area">Read-only</span>}
				{unsaved && <span className="file-unsaved">Unsaved</span>}
				{view.draft !== null && (
					<>
						<button type="button" className="button primary diff-editor" disabled={!unsaved || view.saving} title="Save (Ctrl+S)" onClick={() => void store.saveFile(id)}>
							{view.saving ? "Saving" : "Save"}
						</button>
						<button type="button" className="button quiet diff-editor" disabled={view.saving} onClick={() => store.discardEdits(id)}>
							{unsaved ? "Discard" : "Done"}
						</button>
					</>
				)}
				<button type="button" className="button quiet diff-editor" disabled={view.saving} onClick={() => store.readFileAgain(id)}>Read again</button>
				{result?.outcome === "read" && (
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
				)}
				<button type="button" className="button quiet diff-editor" onClick={() => store.closeFile(id)}>Close</button>
			</div>
			{view.saveProblem !== null && (
				<div className="file-save-problem" role="alert">
					<p>{view.saveProblem.message}</p>
					{view.saveProblem.kind === "changed" && (
						<p className="file-save-choices">
							<button type="button" className="button danger" disabled={view.saving} onClick={() => void store.saveFile(id, { overwrite: true })}>Save over it</button>
							<span>or copy your edits, then Discard and Read again to see the new text.</span>
						</p>
					)}
				</div>
			)}
			{result === null && <p className="diff-reading" role="status">Reading {view.path}</p>}
			{notice !== null && (
				<div className="diff-notice" role="status">
					<p className="empty-title">{notice.title}</p>
					<p className="empty-text">{notice.text}</p>
				</div>
			)}
			{text !== null && mode === "edit" && (
				<textarea
					className="file-editor"
					aria-label={`Source of ${view.path}`}
					style={font}
					value={text}
					spellCheck={false}
					autoFocus
					readOnly={view.saving}
					onChange={event => store.changeDraft(id, event.target.value)}
					onKeyDown={onEditorKey}
				/>
			)}
			{text !== null && mode === "rendered" && (
				<div className="file-viewer-body file-viewer-rendered" tabIndex={0} aria-label={`${view.path}, rendered`}>
					<MarkdownView text={text} path={view.path} onOpenLink={url => void store.openLink(url)} onOpenFile={path => store.openFile(id, path)} />
				</div>
			)}
			{lines !== null && mode === "source" && (
				<div className="file-viewer-body" tabIndex={0} aria-label={`Text of ${view.path}`} style={font}>
					{lines.length === 0
						? <p className="diff-reading">This file is empty.</p>
						: (
							<div className="file-viewer-lines">
								<pre className="file-viewer-numbers" aria-hidden="true">{numbers}</pre>
								<pre className="file-viewer-text">{lines.join("\n")}</pre>
							</div>
						)}
				</div>
			)}
		</section>
	);
}
