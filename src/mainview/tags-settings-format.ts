import { MAX_TAGS, type Tag, type TagColor, WORK_TAG_ID, cleanTagName, newTagId, nextTagColor, tagNameProblem } from "../shared/worktree-tags";

/**
 * The Tags section of Settings (issue 409) without React: the tags as the
 * person edits them, names as typed, and what saving them would save. Work
 * is always first and cannot be removed; removing another tag moves its
 * worktrees back to Work when the section is saved.
 */

export interface TagDraft {
	id: string;
	/** As typed, which may not be a name yet. */
	name: string;
	color: TagColor;
}

export const TAGS_SECTION_DESCRIPTION = "A tag names a kind of worktree and tints its row in the sidebar in one of the theme's five tag colors, so your own work, pull requests you review, and experiments stand apart. Work is the default: a worktree with no other tag is a Work worktree. Tags are kept in the app's settings, never in Timber's metadata.";
export const WORK_KEPT_NOTE = "Work is the default tag, so it cannot be removed. It can be renamed and recolored.";
export const REMOVE_TAG_NOTE = "Removing a tag moves its worktrees back to Work when you save.";

export const tagDraftsOf = (tags: readonly Tag[]): TagDraft[] => tags.map(tag => ({ ...tag }));

/**
 * A new tag at the end, with no name yet and the color fewest tags have.
 * Null at the most there can be. Its id is free among the saved tags too, so
 * a tag removed in the same edit never passes its worktrees on to it.
 */
export function addTagDraft(drafts: readonly TagDraft[], saved: readonly Tag[] = []): TagDraft[] | null {
	if (drafts.length >= MAX_TAGS) return null;
	return [...drafts, { id: newTagId([...drafts, ...saved]), name: "", color: nextTagColor(drafts) }];
}

/** The drafts without this tag. Work stays. */
export function removeTagDraft(drafts: readonly TagDraft[], id: string): TagDraft[] {
	return id === WORK_TAG_ID ? [...drafts] : drafts.filter(draft => draft.id !== id);
}

export function editTagDraft(drafts: readonly TagDraft[], id: string, change: Partial<Pick<TagDraft, "name" | "color">>): TagDraft[] {
	return drafts.map(draft => (draft.id === id ? { ...draft, ...change } : draft));
}

export interface TagsDraftModel {
	/** Why each tag's name cannot be saved, by id. Empty when every one can. */
	problems: Record<string, string>;
	/** What Save saves, or null while a name cannot be. */
	tags: Tag[] | null;
	/** Whether the drafts differ from what is saved, and can be saved. */
	canSave: boolean;
	/** The names of saved tags the drafts remove, whose worktrees go back to Work on Save. */
	removed: string[];
}

export function tagsDraftModel(drafts: readonly TagDraft[], saved: readonly Tag[]): TagsDraftModel {
	const problems: Record<string, string> = {};
	const read: Tag[] = [];
	for (const draft of drafts) {
		// Each name is told apart from the names before it, so two that clash mark the later one.
		const problem = tagNameProblem(read, draft.name, draft.id);
		if (problem !== null) problems[draft.id] = problem;
		const name = cleanTagName(draft.name);
		if (name !== null) read.push({ id: draft.id, name, color: draft.color });
	}
	const tags = Object.keys(problems).length === 0 ? read : null;
	const same = tags !== null && tags.length === saved.length && tags.every((tag, index) => tag.id === saved[index]!.id && tag.name === saved[index]!.name && tag.color === saved[index]!.color);
	const removed = saved.filter(tag => !drafts.some(draft => draft.id === tag.id)).map(tag => tag.name);
	return { problems, tags, canSave: tags !== null && !same, removed };
}
