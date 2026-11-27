import { useId } from "react";
import { MAX_TAG_NAME, MAX_TAGS, TAG_COLOR_NUMBERS, type Tag, WORK_TAG_ID, describeTagColor } from "../../../shared/worktree-tags";
import { useAppState } from "../../store/react";
import { REMOVE_TAG_NOTE, TAGS_SECTION_DESCRIPTION, type TagDraft, WORK_KEPT_NOTE, addTagDraft, editTagDraft, removeTagDraft, tagDraftsOf, tagsDraftModel } from "../../tags-settings-format";
import { TagSwatch } from "../TagField";
import { type SectionSave, SettingsSection, useDraftSection } from "./SettingsSection";

export interface TagsSectionViewProps {
	drafts: readonly TagDraft[];
	saved: readonly Tag[];
	save: SectionSave;
	onChange: (drafts: TagDraft[]) => void;
	onSave: () => void;
}

/** One tag in the section: its color, its name, and Remove. */
function TagRow({ draft, problem, onEdit, onRemove }: { draft: TagDraft; problem: string | undefined; onEdit: (change: Partial<TagDraft>) => void; onRemove: () => void }) {
	const nameId = useId();
	const problemId = useId();
	const work = draft.id === WORK_TAG_ID;
	const label = draft.name.trim() === "" ? "the new tag" : draft.name.trim();
	return (
		<li className="tag-row">
			<div className="tag-colors" role="radiogroup" aria-label={`Color of ${label}`}>
				{TAG_COLOR_NUMBERS.map(color => (
					<label key={color} className="tag-color" title={describeTagColor(color)}>
						<input type="radio" name={`${nameId}-color`} checked={draft.color === color} aria-label={describeTagColor(color)} onChange={() => onEdit({ color })} />
						<TagSwatch color={color} />
					</label>
				))}
			</div>
			<input
				id={nameId}
				className="field-input tag-name"
				aria-label={work ? "Name of the default tag" : `Name of ${label}`}
				aria-invalid={problem !== undefined}
				aria-describedby={problem === undefined ? undefined : problemId}
				value={draft.name}
				maxLength={MAX_TAG_NAME}
				autoComplete="off"
				spellCheck={false}
				onChange={event => onEdit({ name: event.target.value })}
			/>
			{work
				? <span className="field-hint tag-default">Default</span>
				: <button type="button" className="button quiet" aria-label={`Remove ${label}`} onClick={onRemove}>Remove</button>}
			{problem !== undefined && <span id={problemId} className="field-hint error tag-problem" role="alert">{problem}</span>}
		</li>
	);
}

/** The Tags section as drawn from its data, so it can be tested without a window. */
export function TagsSectionView({ drafts, saved, save, onChange, onSave }: TagsSectionViewProps) {
	const model = tagsDraftModel(drafts, saved);
	const added = addTagDraft(drafts, saved);
	return (
		<SettingsSection title="Tags" description={TAGS_SECTION_DESCRIPTION} save={save} canSave={model.canSave} onSave={onSave}>
			<ul className="tag-rows">
				{drafts.map(draft => (
					<TagRow
						key={draft.id}
						draft={draft}
						problem={model.problems[draft.id]}
						onEdit={change => onChange(editTagDraft(drafts, draft.id, change))}
						onRemove={() => onChange(removeTagDraft(drafts, draft.id))}
					/>
				))}
			</ul>
			<div className="tag-actions">
				<button type="button" className="button" disabled={added === null} onClick={() => added && onChange(added)}>Add tag</button>
				<span className="field-hint">{added === null ? `There can be at most ${MAX_TAGS} tags.` : WORK_KEPT_NOTE}</span>
			</div>
			{model.removed.length > 0 && <p className="dialog-note" role="status">{`${REMOVE_TAG_NOTE} Removed: ${model.removed.join(", ")}.`}</p>}
		</SettingsSection>
	);
}

/** The Tags section of Settings: the tags, Work first, saved with their own Save. */
export function TagsSection() {
	const saved = useAppState().preferences.tags;
	const { draft, save, change, commit } = useDraftSection(tagDraftsOf(saved));
	const onSave = async () => {
		const { tags, canSave } = tagsDraftModel(draft, saved);
		if (!canSave || tags === null) return;
		await commit({ tags });
	};
	return <TagsSectionView drafts={draft} saved={saved} save={save} onChange={change} onSave={() => void onSave()} />;
}
