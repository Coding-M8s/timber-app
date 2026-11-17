import { useId, useState } from "react";
import { type FetchSetting, MAX_FETCH_MINUTES, MIN_FETCH_MINUTES } from "../../../shared/fetch-setting";
import { type FetchDraft, fetchDraftModel, fetchDraftOf } from "../../fetch-format";
import { useAppState } from "../../store/react";
import { type SectionSave, SettingsSection, useSectionSave } from "./SettingsSection";

export interface FetchSectionViewProps {
	draft: FetchDraft;
	saved: FetchSetting;
	save: SectionSave;
	onEdit: (change: Partial<FetchDraft>) => void;
	onSave: () => void;
}

/** The Fetching section as drawn from its data, so it can be tested without a window. */
export function FetchSectionView({ draft, saved, save, onEdit, onSave }: FetchSectionViewProps) {
	const intervalId = useId();
	const hintId = useId();
	const model = fetchDraftModel(draft, saved);
	return (
		<SettingsSection
			title="Fetching"
			description="How often the app fetches every repository in the list, so the sidebar shows commits to pull, rewritten upstreams, and deleted upstreams. A fetch only updates remote-tracking branches: it never pulls, merges, rebases, or changes a local branch or a working tree."
			save={save}
			canSave={model.canSave}
			onSave={onSave}
		>
			<label className="check">
				<input type="checkbox" checked={draft.background} onChange={event => onEdit({ background: event.target.checked })} />
				<span className="check-text">
					Fetch in the background
					<span className="check-hint">When this is off, nothing is fetched until you choose Fetch now on a repository.</span>
				</span>
			</label>
			<div className="field">
				<label className="field-label" htmlFor={intervalId}>Minutes between fetches</label>
				<input
					id={intervalId}
					className="field-input"
					type="text"
					inputMode="numeric"
					autoComplete="off"
					aria-describedby={hintId}
					aria-invalid={model.error !== null}
					value={draft.interval}
					onChange={event => onEdit({ interval: event.target.value })}
				/>
				<span id={hintId} className="field-hint">
					A whole number from {MIN_FETCH_MINUTES} to {MAX_FETCH_MINUTES}. After a failed fetch, such as while offline, the app waits longer before it tries again.
				</span>
			</div>
			{model.error !== null && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">This interval cannot be saved</p>
					<p className="sidebar-error-text">{model.error}</p>
				</div>
			)}
		</SettingsSection>
	);
}

/** The Fetching section of Settings: background fetching on or off, and how often, saved with its own Save. */
export function FetchSection() {
	const saved = useAppState().preferences.fetch;
	// Null follows what is saved, so the fields only ever differ from it by what the person did.
	const [edited, setEdited] = useState<FetchDraft | null>(null);
	const draft = edited ?? fetchDraftOf(saved);
	const { save, run, reset } = useSectionSave();

	const onEdit = (change: Partial<FetchDraft>) => {
		setEdited({ ...draft, ...change });
		reset();
	};
	const onSave = async () => {
		const { setting, canSave } = fetchDraftModel(draft, saved);
		if (!canSave || setting === null) return;
		if (await run({ fetch: setting })) setEdited(null);
	};

	return <FetchSectionView draft={draft} saved={saved} save={save} onEdit={onEdit} onSave={() => void onSave()} />;
}
