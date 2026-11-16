import { useId, useState } from "react";
import type { EditorSetting } from "../../../shared/editor";
import { PATH_TOKEN, TERMINAL_EDITOR_REASON } from "../../../shared/editor";
import {
	EDITOR_CHOICES, EXAMPLE_WORKTREE, type EditorChoice, type EditorDraft, chooseEditor, draftOf, editEditor, editorDraftModel,
} from "../../editor-format";
import { useAppState } from "../../store/react";
import { type SectionSave, SettingsSection, useSectionSave } from "./SettingsSection";

export interface EditorSectionViewProps {
	draft: EditorDraft;
	saved: EditorSetting | null;
	save: SectionSave;
	onChoose: (choice: EditorChoice) => void;
	onEdit: (change: { command?: string; terminal?: boolean }) => void;
	onSave: () => void;
}

/** The Editor section as drawn from its data, so it can be tested without a window. */
export function EditorSectionView({ draft, saved, save, onChoose, onEdit, onSave }: EditorSectionViewProps) {
	const commandId = useId();
	const hintId = useId();
	const model = editorDraftModel(draft, saved);
	return (
		<SettingsSection
			title="Editor"
			description="The editor that Open in editor starts for a worktree. The app has no editor of its own. It starts this command without a shell, detached, so the editor stays open when the app closes."
			save={save}
			canSave={model.canSave}
			onSave={onSave}
		>
			<fieldset className="settings-choice">
				<legend className="field-label">Editor</legend>
				{EDITOR_CHOICES.map(option => (
					<label key={option.id} className="check">
						<input type="radio" name="editor-choice" value={option.id} checked={draft.choice === option.id} onChange={() => onChoose(option.id)} />
						<span className="check-text">{option.label}</span>
					</label>
				))}
			</fieldset>
			<div className="field">
				<label className="field-label" htmlFor={commandId}>Command</label>
				<input
					id={commandId}
					className="field-input mono"
					type="text"
					spellCheck={false}
					autoComplete="off"
					placeholder="None"
					aria-describedby={hintId}
					aria-invalid={model.error !== null}
					value={draft.command}
					onChange={event => onEdit({ command: event.target.value })}
				/>
				<span id={hintId} className="field-hint">
					The executable first, found on the PATH the app was started with, or a full path. Quotes group words with spaces; nothing else is special.
					The worktree folder is added as the last argument, or goes where you write {PATH_TOKEN}.
				</span>
			</div>
			<label className="check">
				<input type="checkbox" checked={draft.terminal} onChange={event => onEdit({ terminal: event.target.checked })} />
				<span className="check-text">
					Runs in a terminal
					<span className="check-hint">For editors such as Neovim.</span>
				</span>
			</label>
			{model.error !== null && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">This command cannot be read</p>
					<p className="sidebar-error-text">{model.error}</p>
				</div>
			)}
			{model.hint !== null && <p className="dialog-note">{model.hint}</p>}
			{model.warning !== null && (
				<div className="sidebar-error info" role="status">
					<p className="sidebar-error-title">This looks like a terminal editor</p>
					<p className="sidebar-error-text">{model.warning}</p>
				</div>
			)}
			{model.setting?.terminal && <p className="dialog-note">{TERMINAL_EDITOR_REASON} Until then Open in editor is unavailable with this editor.</p>}
			{model.example !== null && (
				<div className="field">
					<span className="field-label">For a worktree at {EXAMPLE_WORKTREE} this runs</span>
					<pre className="dialog-command" aria-label="Example command">{model.example}</pre>
				</div>
			)}
			{draft.choice === "none" && <p className="dialog-note">With no editor, Open in editor brings you here to choose one.</p>}
		</SettingsSection>
	);
}

/** The Editor section of Settings: a preset or a command of one's own, saved with its own Save. */
export function EditorSection() {
	const saved = useAppState().preferences.editor;
	// Null follows what is saved, so the fields only ever differ from it by what the person did.
	const [edited, setEdited] = useState<EditorDraft | null>(null);
	const draft = edited ?? draftOf(saved);
	const { save, run, reset } = useSectionSave();

	const change = (next: EditorDraft) => {
		setEdited(next);
		reset();
	};
	const onSave = async () => {
		const { setting, canSave } = editorDraftModel(draft, saved);
		if (!canSave) return;
		if (await run({ editor: setting })) setEdited(null);
	};

	return (
		<EditorSectionView
			draft={draft}
			saved={saved}
			save={save}
			onChoose={choice => change(chooseEditor(draft, choice))}
			onEdit={edit => change(editEditor(draft, edit))}
			onSave={() => void onSave()}
		/>
	);
}
