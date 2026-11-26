import { useEffect, useId, useRef } from "react";
import { describeUnsavedFileQuestion } from "../file-view-format";
import { useAppState, useStore } from "../store/react";
import type { UnsavedFileStep } from "../store/state";

/**
 * Asked before closing a file, loading it from disk, or opening another in its
 * place while it holds unsaved edits. Nothing is dropped until Discard is
 * pressed. Focus starts on Save; Escape keeps editing.
 */
export function UnsavedFileDialog({ worktree, then }: { worktree: string; then: UnsavedFileStep }) {
	const store = useStore();
	const state = useAppState();
	const view = state.files[worktree];
	const dialog = useRef<HTMLDialogElement>(null);
	const save = useRef<HTMLButtonElement>(null);
	const titleId = useId();
	const textId = useId();

	useEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
		// showModal moves focus to the first button, so Save takes it back.
		save.current?.focus();
		return () => element?.close();
	}, []);

	// The file was closed some other way meanwhile: nothing left to ask about.
	if (!view) return null;
	const { title, text } = describeUnsavedFileQuestion(view.path, then);
	return (
		<dialog
			ref={dialog}
			className="dialog quit-dialog"
			role="alertdialog"
			aria-labelledby={titleId}
			aria-describedby={textId}
			onCancel={event => {
				event.preventDefault();
				void store.answerUnsavedFile("keep");
			}}
		>
			<div className="dialog-form">
				<header className="dialog-head">
					<h2 id={titleId} className="dialog-title">{title}</h2>
				</header>
				<p id={textId} className="dialog-note">{text}</p>
				<footer className="dialog-foot">
					<div className="dialog-buttons">
						<button type="button" className="button quiet" onClick={() => void store.answerUnsavedFile("keep")}>Keep editing</button>
						<button type="button" className="button danger" disabled={view.saving} onClick={() => void store.answerUnsavedFile("discard")}>Discard</button>
						<button ref={save} type="button" className="button primary" autoFocus disabled={view.saving} onClick={() => void store.answerUnsavedFile("save")}>
							{view.saving ? "Saving" : "Save"}
						</button>
					</div>
				</footer>
			</div>
		</dialog>
	);
}
