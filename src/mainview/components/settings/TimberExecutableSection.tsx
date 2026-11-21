import { useId } from "react";
import type { TimberChoice } from "../../../shared/timber-choice";
import { TIMBER_CHOICE_OPTIONS, type TimberChoiceDraft, describeTimberInUse, timberDraftModel, timberDraftOf } from "../../timber-choice-format";
import { useAppState } from "../../store/react";
import type { TimberState } from "../../store/state";
import { type SectionSave, SettingsSection, useDraftSection } from "./SettingsSection";

export interface TimberExecutableSectionViewProps {
	draft: TimberChoiceDraft;
	saved: TimberChoice;
	timber: TimberState;
	save: SectionSave;
	onChange: (draft: TimberChoiceDraft) => void;
	onSave: () => void;
}

/** The Executable section as drawn from its data, so it can be tested without a window. */
export function TimberExecutableSectionView({ draft, saved, timber, save, onChange, onSave }: TimberExecutableSectionViewProps) {
	const pathId = useId();
	const hintId = useId();
	const model = timberDraftModel(draft, saved);
	return (
		<SettingsSection
			title="Executable"
			description="Which Timber the app runs for every Timber command. The app looks for it again as soon as this is saved."
			save={save}
			canSave={model.canSave}
			onSave={onSave}
		>
			<fieldset className="settings-choice">
				<legend className="field-label">Timber</legend>
				{TIMBER_CHOICE_OPTIONS.map(option => (
					<label key={option.kind} className="check">
						<input type="radio" name="timber-choice" value={option.kind} checked={draft.kind === option.kind} onChange={() => onChange({ ...draft, kind: option.kind })} />
						<span className="check-text">
							{option.label}
							<span className="check-hint">{option.hint}</span>
						</span>
					</label>
				))}
			</fieldset>
			{draft.kind === "file" && (
				<div className="field">
					<label className="field-label" htmlFor={pathId}>Path</label>
					<input
						id={pathId}
						className="field-input mono"
						type="text"
						spellCheck={false}
						autoComplete="off"
						placeholder="/usr/local/bin/timber"
						aria-describedby={hintId}
						aria-invalid={model.error !== null}
						value={draft.path}
						onChange={event => onChange({ ...draft, path: event.target.value })}
					/>
					<span id={hintId} className="field-hint">The executable itself. Nothing else is tried when it does not answer.</span>
				</div>
			)}
			{model.error !== null && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">This path cannot be used</p>
					<p className="sidebar-error-text">{model.error}</p>
				</div>
			)}
			<p className="dialog-note">{describeTimberInUse(timber)}</p>
		</SettingsSection>
	);
}

/** Settings, Timber, Executable: the bundled Timber, the one on PATH, or a file, saved with its own Save. */
export function TimberExecutableSection() {
	const { preferences, timber } = useAppState();
	const saved = preferences.timber;
	const { draft, save, change, commit } = useDraftSection(timberDraftOf(saved));

	const onSave = async () => {
		const { choice, canSave } = timberDraftModel(draft, saved);
		if (choice === null || !canSave) return;
		await commit({ timber: choice });
	};

	return (
		<TimberExecutableSectionView
			draft={draft}
			saved={saved}
			timber={timber}
			save={save}
			onChange={change}
			onSave={() => void onSave()}
		/>
	);
}
