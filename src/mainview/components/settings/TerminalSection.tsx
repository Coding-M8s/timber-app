import { useId, useState } from "react";
import { DEFAULT_TERMINAL_FONT, MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE, TERMINAL_CURSORS, type TerminalAppearance } from "../../../shared/terminal-appearance";
import { useAppState } from "../../store/react";
import { TERMINAL_CURSOR_HINTS, TERMINAL_CURSOR_LABELS, type TerminalDraft, missingFontNote, terminalDraftModel, terminalDraftOf } from "../../terminal-appearance-format";
import { terminalFontInstalled } from "../../terminal-look";
import { type SectionSave, SettingsSection, useSectionSave } from "./SettingsSection";

export interface TerminalSectionViewProps {
	draft: TerminalDraft;
	saved: TerminalAppearance;
	save: SectionSave;
	/** Whether the typed font is on this computer. */
	fontInstalled: boolean;
	onEdit: (change: Partial<TerminalDraft>) => void;
	onSave: () => void;
}

/** The Terminal section as drawn from its data, so it can be tested without a window. */
export function TerminalSectionView({ draft, saved, save, fontInstalled, onEdit, onSave }: TerminalSectionViewProps) {
	const fontId = useId();
	const fontHintId = useId();
	const sizeId = useId();
	const sizeHintId = useId();
	const model = terminalDraftModel(draft, saved);
	const missing = model.invalid === "font" ? null : missingFontNote(draft.fontFamily, fontInstalled);
	return (
		<SettingsSection
			title="Terminal"
			description="The font, the text size, and the cursor of every terminal. Open terminals change as soon as you save, and the app remembers them in its own settings file."
			save={save}
			canSave={model.canSave}
			onSave={onSave}
		>
			<div className="field">
				<label className="field-label" htmlFor={fontId}>Font</label>
				<input
					id={fontId}
					className="field-input"
					type="text"
					autoComplete="off"
					spellCheck={false}
					placeholder={DEFAULT_TERMINAL_FONT}
					aria-describedby={fontHintId}
					aria-invalid={model.invalid === "font"}
					value={draft.fontFamily}
					onChange={event => onEdit({ fontFamily: event.target.value })}
				/>
				<span id={fontHintId} className={missing === null ? "field-hint" : "field-hint error"}>
					{missing ?? `One installed font's name. Leave it empty for ${DEFAULT_TERMINAL_FONT}, which is built in. Prompt icons that the font lacks come from a Nerd Font symbols font when one is installed.`}
				</span>
			</div>
			<div className="field">
				<label className="field-label" htmlFor={sizeId}>Text size</label>
				<input
					id={sizeId}
					className="field-input"
					type="text"
					inputMode="numeric"
					autoComplete="off"
					aria-describedby={sizeHintId}
					aria-invalid={model.invalid === "size"}
					value={draft.fontSize}
					onChange={event => onEdit({ fontSize: event.target.value })}
				/>
				<span id={sizeHintId} className="field-hint">
					In pixels, from {MIN_TERMINAL_FONT_SIZE} to {MAX_TERMINAL_FONT_SIZE}. A size outside these is saved as the nearest one.
				</span>
			</div>
			<fieldset className="settings-choice">
				<legend className="field-label">Cursor</legend>
				{TERMINAL_CURSORS.map(option => (
					<label key={option} className="check">
						<input type="radio" name="terminal-cursor" value={option} checked={draft.cursor === option} onChange={() => onEdit({ cursor: option })} />
						<span className="check-text">
							{TERMINAL_CURSOR_LABELS[option]}
							<span className="check-hint">{TERMINAL_CURSOR_HINTS[option]}</span>
						</span>
					</label>
				))}
			</fieldset>
			{model.error !== null && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">These settings cannot be saved</p>
					<p className="sidebar-error-text">{model.error}</p>
				</div>
			)}
		</SettingsSection>
	);
}

/** The Terminal section of Settings: the font, the text size, and the cursor's shape, saved with its own Save. */
export function TerminalSection() {
	const saved = useAppState().preferences.terminal;
	// Null follows what is saved, so the fields only ever differ from it by what the person did.
	const [edited, setEdited] = useState<TerminalDraft | null>(null);
	const draft = edited ?? terminalDraftOf(saved);
	const { save, run, reset } = useSectionSave();

	const onEdit = (change: Partial<TerminalDraft>) => {
		setEdited({ ...draft, ...change });
		reset();
	};
	const onSave = async () => {
		const { appearance, canSave } = terminalDraftModel(draft, saved);
		if (!canSave || appearance === null) return;
		if (await run({ terminal: appearance })) setEdited(null);
	};

	return (
		<TerminalSectionView
			draft={draft}
			saved={saved}
			save={save}
			fontInstalled={terminalFontInstalled(draft.fontFamily.trim())}
			onEdit={onEdit}
			onSave={() => void onSave()}
		/>
	);
}
