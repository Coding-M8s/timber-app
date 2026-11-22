import { useId } from "react";
import { type PullConfirmSetting, samePullConfirmSetting, skipsPullConfirmation, withPullSkipped } from "../../../shared/pull-confirm-setting";
import { useAppState } from "../../store/react";
import { type SectionSave, SettingsSection, useDraftSection } from "./SettingsSection";

/** A repository in the app, as the section lists it. */
export interface PullSectionRepository {
	/** The primary checkout, which the setting is kept by. */
	path: string;
	name: string;
}

export interface PullSectionViewProps {
	draft: PullConfirmSetting;
	saved: PullConfirmSetting;
	repositories: readonly PullSectionRepository[];
	save: SectionSave;
	onEdit: (next: PullConfirmSetting) => void;
	onSave: () => void;
}

/** The Pull section as drawn from its data, so it can be tested without a window. */
export function PullSectionView({ draft, saved, repositories, save, onEdit, onSave }: PullSectionViewProps) {
	const askHintId = useId();
	const listId = useId();
	const listHintId = useId();
	return (
		<SettingsSection
			title="Pull"
			description="Whether Pull shows its dialog, with the Git commands, before it runs. Kept in the app's settings, never in a repository. Push always shows its dialog."
			save={save}
			canSave={!samePullConfirmSetting(draft, saved)}
			onSave={onSave}
		>
			<label className="check">
				<input type="checkbox" role="switch" checked={draft.ask} aria-describedby={askHintId} onChange={event => onEdit({ ...draft, ask: event.target.checked })} />
				<span className="check-text">
					Ask before pulling
					<span id={askHintId} className="check-hint">
						When this is off, Pull runs at once in every repository. A pull that Git refuses, or that fails, still opens the dialog with what Git said.
					</span>
				</span>
			</label>
			<div className="field" role="group" aria-labelledby={listId} aria-describedby={listHintId}>
				<p id={listId} className="field-label">Skip pull confirmation</p>
				<span id={listHintId} className="field-hint">
					{draft.ask
						? "Pull runs at once in each repository turned on here."
						: "Ask before pulling is off, so no repository asks. These take effect when it is on again."}
				</span>
				{repositories.length === 0
					? <p className="dialog-note">No repositories are in the app yet.</p>
					: repositories.map(repository => (
						<label key={repository.path} className="check">
							<input
								type="checkbox"
								role="switch"
								checked={skipsPullConfirmation(draft, repository.path)}
								onChange={event => onEdit(withPullSkipped(draft, repository.path, event.target.checked))}
							/>
							<span className="check-text">
								{repository.name}
								<span className="check-hint">{repository.path}</span>
							</span>
						</label>
					))}
			</div>
		</SettingsSection>
	);
}

/** The Pull section of Settings: "Ask before pulling", and each repository's "Skip pull confirmation", saved with one Save. */
export function PullSection() {
	const state = useAppState();
	const saved = state.preferences.pull;
	const { draft, save, change, commit } = useDraftSection(saved);
	const repositories = state.repositories.map(repository => ({ path: repository.path, name: repository.name }));
	return (
		<PullSectionView
			draft={draft}
			saved={saved}
			repositories={repositories}
			save={save}
			onEdit={change}
			onSave={() => void commit({ pull: draft })}
		/>
	);
}
