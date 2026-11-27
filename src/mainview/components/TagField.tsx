import { useEffect, useId, useRef } from "react";
import { type Tag, type TagColor, describeTag, tagColorVariable, tagOf, worktreeTagId } from "../../shared/worktree-tags";
import { worktreeLabel } from "../format";
import { useAppState, useStore } from "../store/react";

/** A tag color as a small mark, or an empty ring for none. Always beside words that name it: a color is never told alone. */
export function TagSwatch({ color }: { color: TagColor | null }) {
	return <span className={color === null ? "tag-swatch none" : "tag-swatch"} style={color === null ? undefined : { background: tagColorVariable(color) }} aria-hidden="true" />;
}

/** What the Tag field of the worktree dialogs says under its choices. */
export const TAG_FIELD_HINT = "Tints the worktree's row in the sidebar. Change it later from the row's menu.";

/** The Tag field as a mode of the worktree dialog gets it: the saved tags, the one chosen, and how to choose another. */
export interface TagChoice {
	tags: readonly Tag[];
	chosen: string;
	onPick: (tag: string) => void;
}

interface TagFieldProps {
	tags: readonly Tag[];
	/** The id of the tag chosen; one the list does not have shows as Work. */
	chosen: string;
	disabled: boolean;
	onPick: (tag: string) => void;
}

/**
 * The Tag field of New worktree and Start work (issue 409): each saved tag
 * with its color, one chosen. Under the Name field, starting on Work, or on
 * Review for Check out PR. A native radio group, so the arrows move the
 * choice.
 */
export function TagField({ tags, chosen, disabled, onPick }: TagFieldProps) {
	const name = useId();
	const hint = useId();
	const current = tagOf(tags, chosen).id;
	return (
		<fieldset className="field tag-field" aria-describedby={hint} disabled={disabled}>
			<legend className="field-label">Tag</legend>
			<div className="tag-choices">
				{tags.map(tag => (
					<label key={tag.id} className="tag-choice">
						<input type="radio" name={name} value={tag.id} checked={tag.id === current} onChange={() => onPick(tag.id)} />
						<TagSwatch color={tag.color} />
						<span>{tag.name}</span>
					</label>
				))}
			</div>
			<span id={hint} className="field-hint">{TAG_FIELD_HINT}</span>
		</fieldset>
	);
}

export interface SetTagDialogViewProps {
	/** The worktree's name, as the sidebar shows it. */
	name: string;
	tags: readonly Tag[];
	current: string;
	onPick: (tag: string) => void;
	onClose: () => void;
}

/** What Set tag... shows: each tag as a button, the current one pressed. Choosing one sets it and closes. Holds no state. */
export function SetTagDialogView({ name, tags, current, onPick, onClose }: SetTagDialogViewProps) {
	const dialog = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	useEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
		return () => element?.close();
	}, []);
	const chosen = tagOf(tags, current);
	return (
		<dialog
			ref={dialog}
			className="dialog set-tag-dialog"
			aria-labelledby={titleId}
			onCancel={event => {
				event.preventDefault();
				onClose();
			}}
		>
			<div className="dialog-form">
				<header className="dialog-head">
					<h2 id={titleId} className="dialog-title">Tag of {name}</h2>
				</header>
				<p className="dialog-note">{describeTag(chosen)} now. Tags are named and colored in Settings, Tags.</p>
				<div className="tag-choices" role="group" aria-label="Tags">
					{tags.map(tag => (
						<button key={tag.id} type="button" className="button tag-choice" aria-pressed={tag.id === chosen.id} autoFocus={tag.id === chosen.id} onClick={() => onPick(tag.id)}>
							<TagSwatch color={tag.color} />
							<span>{tag.name}</span>
						</button>
					))}
				</div>
				<footer className="dialog-foot">
					<div className="dialog-buttons">
						<button type="button" className="button" onClick={onClose}>Cancel</button>
					</div>
				</footer>
			</div>
		</dialog>
	);
}

/** Set tag... from the palette, for a worktree by its identity. It closes itself when the worktree leaves the list. */
export function SetTagDialog({ repository, worktree }: { repository: string; worktree: string }) {
	const store = useStore();
	const state = useAppState();
	const listed = state.repositories.find(candidate => candidate.path === repository)?.worktrees.find(candidate => candidate.id === worktree);
	useEffect(() => {
		if (!listed) store.closeDialog();
	}, [listed, store]);
	if (!listed) return null;
	const current = worktreeTagId(state.sidebarTags, repository, listed.path);
	return (
		<SetTagDialogView
			name={worktreeLabel(listed)}
			tags={state.preferences.tags}
			current={current}
			onPick={tag => {
				store.closeDialog();
				void store.setWorktreeTag(repository, listed.path, tag);
			}}
			onClose={() => store.closeDialog()}
		/>
	);
}
