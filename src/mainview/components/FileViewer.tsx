import { useEffect, useState } from "react";
import type { Worktree } from "../../shared/model";
import { terminalFontStack } from "../../shared/terminal-appearance";
import { isMarkdownPath } from "../../shared/worktree-files";
import { OPEN_IN_EDITOR } from "../editor-format";
import { canEditFile, describeFileNotice, editRefusal, editableFileText, hasUnsavedEdits } from "../file-view-format";
import { useStore } from "../store/react";
import type { FileMode, FileView } from "../store/state";
import { terminalAppearance, watchTerminalAppearance } from "../terminal-look";
import { MarkdownView } from "./MarkdownView";
import { EditorIcon, useOpenInEditor } from "./OpenInEditor";
import { TextEditor } from "./TextEditor";
import { ModeSwitch } from "./worktree-modes/ModeSwitch";

/** The terminal's font and size from Settings, Terminal, following every change. */
function useTerminalFont(): { fontFamily: string; fontSize: number } {
	const [appearance, setAppearance] = useState(terminalAppearance);
	useEffect(() => watchTerminalAppearance(setAppearance), []);
	return { fontFamily: terminalFontStack(appearance.fontFamily), fontSize: appearance.fontSize };
}

const MARKDOWN_MODES: readonly FileMode[] = ["rendered", "source", "edit"];
const MARKDOWN_LABELS = ["Rendered", "Source", "Edit"];

/**
 * The File tab: one file of the worktree, in the terminal's font. Any text
 * file shows in the small editor (`TextEditor`), ready to type, or read-only
 * with the reason when its line endings could not be saved as they were. A
 * Markdown file shows rendered first, with a switch to its source, read-only,
 * and to Edit.
 */
export function FileViewer({ repository, worktree, view }: { repository: string; worktree: Worktree; view: FileView }) {
	const store = useStore();
	const font = useTerminalFont();
	const { action, open } = useOpenInEditor(repository, worktree, view.path);
	const { result } = view;
	const onDisk = editableFileText(view);
	const editable = canEditFile(view);
	const refusal = editRefusal(view);
	const markdown = isMarkdownPath(view.path);
	// What shows is the draft while there is one, in every mode, so Rendered previews it.
	const text = view.draft ?? onDisk;
	// Any file but Markdown is always in the editor; Markdown's Edit waits for its draft.
	const mode: FileMode = !markdown ? "edit" : view.mode === "edit" && view.draft === null ? "source" : view.mode;
	const notice = result === null || view.draft !== null ? null : describeFileNotice(result);
	const unsaved = hasUnsavedEdits(view);
	const id = worktree.id;
	// A new memory, after Discard or Read again, makes a new editor, from the file as it is now.
	const memory = text === null ? null : store.fileEditMemory(id, view.path);

	// Ctrl+S (Cmd+S on macOS) saves, as in an editor. The editor has put its text in the store first.
	const save = () => {
		const now = store.getState().files[id];
		if (now && hasUnsavedEdits(now) && !now.saving) void store.saveFile(id);
	};

	return (
		<section className="file-viewer" aria-label={`File ${view.path}`}>
			<div className="diff-title file-viewer-title">
				<span className="diff-path" title={view.path}>{view.path}</span>
				{markdown && (editable || view.draft !== null)
					? (
						<ModeSwitch
							labels={MARKDOWN_LABELS}
							selected={MARKDOWN_MODES.indexOf(mode)}
							disabled={view.saving}
							label={`How to show ${view.path}`}
							onSelect={index => {
								const next = MARKDOWN_MODES[index]!;
								if (next === "edit") store.editFile(id);
								else store.showFileAs(id, next);
							}}
						/>
					)
					: onDisk !== null && !editable && view.draft === null && <span className="diff-area" title={refusal ?? undefined}>Read-only</span>}
				{unsaved && <span className="file-unsaved">Unsaved</span>}
				{!markdown && (editable || view.draft !== null) && (
					<>
						<button type="button" className="button primary diff-editor" disabled={!unsaved || view.saving} title="Save (Ctrl+S)" onClick={() => void store.saveFile(id)}>
							{view.saving ? "Saving" : "Save"}
						</button>
						{unsaved && <button type="button" className="button quiet diff-editor" disabled={view.saving} onClick={() => store.discardEdits(id)}>Discard</button>}
					</>
				)}
				{markdown && view.draft !== null && (
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
			{refusal !== null && view.draft === null && <p className="file-edit-refusal">Read-only here. {refusal}</p>}
			{result === null && <p className="diff-reading" role="status">Reading {view.path}</p>}
			{notice !== null && (
				<div className="diff-notice" role="status">
					<p className="empty-title">{notice.title}</p>
					<p className="empty-text">{notice.text}</p>
				</div>
			)}
			{text !== null && memory !== null && (mode === "edit" || mode === "source") && (
				<TextEditor
					// Source and Edit are each their own editor; a new memory is a new one too.
					key={`${mode}:${memory.id}`}
					worktreeId={id}
					path={view.path}
					draft={text}
					base={onDisk ?? ""}
					editable={mode === "edit" && (editable || view.draft !== null)}
					saving={view.saving}
					font={font}
					onSave={save}
				/>
			)}
			{text !== null && mode === "rendered" && (
				<div className="file-viewer-body file-viewer-rendered" tabIndex={0} aria-label={`${view.path}, rendered`}>
					<MarkdownView text={text} path={view.path} onOpenLink={url => void store.openLink(url)} onOpenFile={path => store.openFile(id, path)} />
				</div>
			)}
		</section>
	);
}
