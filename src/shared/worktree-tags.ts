/**
 * Worktree tags (issue 409): a name and one of the theme's five tag colors,
 * so the sidebar tells kinds of worktrees apart, such as the person's own
 * work and pull requests they review. Work is the default: a worktree with no
 * other tag is a Work worktree. Repository and group headers take a color of
 * their own, never a tag. Everything is kept in the app's settings, never in
 * Timber's metadata. Everything here is pure.
 */
import type { UiColor } from "./theme";

/** One of the theme's five tag colors, `--tag-1` to `--tag-5`. */
export type TagColor = 1 | 2 | 3 | 4 | 5;
export const TAG_COLOR_NUMBERS: readonly TagColor[] = [1, 2, 3, 4, 5];

export interface Tag {
	/** Stays the same when the tag is renamed or recolored, so a worktree's tag follows it. */
	id: string;
	name: string;
	color: TagColor;
}

/** The default tag, which cannot be removed. */
export const WORK_TAG_ID = "work";
/** The tag a checked-out pull request starts on, while it exists. */
export const REVIEW_TAG_ID = "review";

export const DEFAULT_TAGS: readonly Tag[] = [
	{ id: WORK_TAG_ID, name: "Work", color: 1 },
	{ id: REVIEW_TAG_ID, name: "Review", color: 2 },
];

/** The most tags there can be, and the longest a name can be. Enough for a sidebar; more would not tell rows apart. */
export const MAX_TAGS = 20;
export const MAX_TAG_NAME = 40;

export const isTagColor = (value: unknown): value is TagColor => typeof value === "number" && (TAG_COLOR_NUMBERS as readonly number[]).includes(value);

/** The theme color a tag color is drawn in. */
export const tagUiColor = (color: TagColor): UiColor => `tag${color}`;

/** The custom property a tag color is drawn with. */
export const tagColorVariable = (color: TagColor) => `var(--tag-${color})`;

/** What a tag color is called where it is offered: in Settings, in the Color menu of a header. */
export function describeTagColor(color: TagColor): string {
	return `Color ${color}`;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A tag name with spaces trimmed and runs of spaces as one, or null when it cannot be a name. */
export function cleanTagName(name: string): string | null {
	const clean = name.replace(/\s+/g, " ").trim();
	if (clean === "" || clean.length > MAX_TAG_NAME || /[\u0000-\u001f\u007f]/.test(clean)) return null;
	return clean;
}

const isTagId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9-]{1,40}$/.test(value);

/**
 * Why a name cannot be a tag's, or null when it can. `except` is the tag
 * being renamed. Names are told apart ignoring case.
 */
export function tagNameProblem(tags: readonly Tag[], name: string, except?: string): string | null {
	const clean = cleanTagName(name);
	if (clean === null) return name.trim() === "" ? "Give the tag a name." : `A tag name is one line of at most ${MAX_TAG_NAME} characters.`;
	const taken = tags.find(tag => tag.id !== except && tag.name.toLocaleLowerCase() === clean.toLocaleLowerCase());
	return taken ? `There is a tag named ${taken.name} already.` : null;
}

/** One tag that reads, and that none of `kept` has the id or the name of; else null. */
function readTag(entry: unknown, kept: readonly Tag[]): Tag | null {
	if (!isRecord(entry) || !isTagId(entry.id) || typeof entry.name !== "string" || !isTagColor(entry.color)) return null;
	const name = cleanTagName(entry.name);
	if (name === null || tagNameProblem(kept, name) !== null || kept.some(tag => tag.id === entry.id)) return null;
	return { id: entry.id, name, color: entry.color };
}

/** The tags in order, with Work moved first. */
const workFirst = (tags: readonly Tag[]): Tag[] => [...tags.filter(tag => tag.id === WORK_TAG_ID), ...tags.filter(tag => tag.id !== WORK_TAG_ID)];

/**
 * The tags from a value that came from outside, such as the settings file,
 * or undefined when it is not a whole list: Work first, then each tag once
 * by id and by name. Work cannot be left out.
 */
export function readTags(value: unknown): Tag[] | undefined {
	if (!Array.isArray(value) || value.length > MAX_TAGS) return undefined;
	const tags: Tag[] = [];
	for (const entry of value) {
		const tag = readTag(entry, tags);
		if (tag === null) return undefined;
		tags.push(tag);
	}
	return tags.some(tag => tag.id === WORK_TAG_ID) ? workFirst(tags) : undefined;
}

/**
 * What can be kept of a list that cannot be read whole: each tag that reads,
 * up to the most there can be, and Work, put back when it is missing. A
 * worktree whose tag is dropped shows as Work.
 */
export function salvageTags(value: unknown): Tag[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const kept: Tag[] = [];
	for (const entry of value) {
		const tag = readTag(entry, kept);
		if (tag !== null && kept.length < MAX_TAGS) kept.push(tag);
	}
	if (!kept.some(tag => tag.id === WORK_TAG_ID)) {
		// Work comes back under its own name, unless another tag has taken it.
		const work = { ...DEFAULT_TAGS[0]! };
		if (tagNameProblem(kept, work.name) !== null) return undefined;
		if (kept.length === MAX_TAGS) kept.pop();
		kept.unshift(work);
	}
	return workFirst(kept);
}

export function sameTags(one: readonly Tag[], other: readonly Tag[]): boolean {
	return one.length === other.length && one.every((tag, index) => tag.id === other[index]!.id && tag.name === other[index]!.name && tag.color === other[index]!.color);
}

export function writeTags(tags: readonly Tag[]): Tag[] {
	return tags.map(({ id, name, color }) => ({ id, name, color }));
}

/** An id for a new tag that no tag has. */
export function newTagId(tags: readonly Tag[]): string {
	for (let number = 1; ; number++) {
		const id = `tag-${number}`;
		if (!tags.some(tag => tag.id === id)) return id;
	}
}

/** The color a new tag starts with: the first no tag has yet, else the one fewest tags have. */
export function nextTagColor(tags: readonly Tag[]): TagColor {
	const count = (color: TagColor) => tags.filter(tag => tag.color === color).length;
	return [...TAG_COLOR_NUMBERS].sort((one, other) => count(one) - count(other))[0]!;
}

/** The tag of this id, or Work when no tag has it, as for a worktree whose tag was removed. */
export function tagOf(tags: readonly Tag[], id: string | null | undefined): Tag {
	return tags.find(tag => tag.id === id) ?? tags.find(tag => tag.id === WORK_TAG_ID) ?? DEFAULT_TAGS[0]!;
}

/** The tag a new worktree from a checked-out pull request starts on: Review while it exists, else Work. */
export function reviewTagId(tags: readonly Tag[]): string {
	return tags.some(tag => tag.id === REVIEW_TAG_ID) ? REVIEW_TAG_ID : WORK_TAG_ID;
}

/** What a row's tooltip and description say of its tag, such as "Tag: Review". */
export function describeTag(tag: Pick<Tag, "name">): string {
	return `Tag: ${tag.name}`;
}

/**
 * The tags of worktrees and the colors of headers, as the sidebar draws
 * them. A worktree's tag is by the path of its repository's primary checkout,
 * then by the worktree's path as Git registered it; one that is not named is
 * Work. A header's color is by the repository's primary checkout or by the
 * group's id; one that is not named has none.
 */
export interface SidebarTags {
	worktrees: Record<string, Record<string, string>>;
	repositories: Record<string, TagColor>;
	groups: Record<string, TagColor>;
}

export function emptySidebarTags(): SidebarTags {
	return { worktrees: {}, repositories: {}, groups: {} };
}

/** The id of a worktree's tag, or Work's. Safe for any path, `__proto__` too. */
export function worktreeTagId(tags: SidebarTags, repository: string, worktree: string): string {
	const own = Object.hasOwn(tags.worktrees, repository) ? tags.worktrees[repository]! : null;
	return own !== null && Object.hasOwn(own, worktree) ? own[worktree]! : WORK_TAG_ID;
}

/** What a header's color is for: a repository, by the path of its primary checkout, or a group, by its id. */
export type HeaderTarget = { kind: "repository"; path: string } | { kind: "group"; id: string };

/** The color of a header, or null. */
export function headerColor(tags: SidebarTags, target: HeaderTarget): TagColor | null {
	const part = target.kind === "repository" ? tags.repositories : tags.groups;
	const key = target.kind === "repository" ? target.path : target.id;
	return Object.hasOwn(part, key) ? part[key]! : null;
}

/** A worktree's tag that a request names: Work takes the worktree's entry away. */
export interface SetWorktreeTagRequest {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's path as Git registered it (`Worktree.path`). */
	worktree: string;
	tag: string;
}

/** What came of setting a tag or a color. A refusal or a failure changes nothing on disk. */
export type SidebarTagsResult =
	| { outcome: "saved"; tags: SidebarTags }
	/** The repository or group is not in the list any more, or the tag is not one of the saved tags. */
	| { outcome: "unknown" }
	| { outcome: "failed"; message: string }
	/** The development override is set, so nothing is saved. */
	| { outcome: "overridden" };

/** Whether a value is a path a request can name: absolute, one line, not too long. */
export function isTaggablePath(value: unknown): value is string {
	return typeof value === "string" && value.length > 0 && value.length <= 4096 && (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\")) && !/[\u0000-\u001f]/.test(value);
}

/** A saved repository's worktree tags, read: each worktree path once, each tag id a tag id. Anything else is dropped. */
export function readWorktreeTags(value: unknown): Record<string, string> {
	const read: Record<string, string> = {};
	if (!isRecord(value)) return read;
	for (const [path, tag] of Object.entries(value)) {
		if (isTaggablePath(path) && isTagId(tag) && tag !== WORK_TAG_ID) read[path] = tag;
	}
	return read;
}

/** The tags with one worktree's set: Work, or a tag that is not saved, takes the entry away. */
export function withWorktreeTag(own: Readonly<Record<string, string>> | undefined, worktree: string, tag: string): Record<string, string> {
	const next = { ...own };
	if (tag === WORK_TAG_ID) delete next[worktree];
	else next[worktree] = tag;
	return next;
}

/**
 * Saved repositories with every worktree whose tag is not one of `tags`
 * moved back to Work, as when a tag is removed in Settings. `changed` says
 * whether any was.
 */
export function withoutRemovedTags<Entry extends { worktreeTags?: Record<string, string> }>(entries: readonly Entry[], tags: readonly Pick<Tag, "id">[]): { entries: Entry[]; changed: boolean } {
	const saved = new Set(tags.map(tag => tag.id));
	let changed = false;
	const next = entries.map(entry => {
		if (!entry.worktreeTags) return entry;
		const kept = Object.entries(entry.worktreeTags).filter(([, tag]) => saved.has(tag));
		if (kept.length === Object.keys(entry.worktreeTags).length) return entry;
		changed = true;
		const { worktreeTags: _, ...rest } = entry;
		return (kept.length > 0 ? { ...rest, worktreeTags: Object.fromEntries(kept) } : rest) as Entry;
	});
	return { entries: next, changed };
}

/** What a toast says when a tag or a color was not saved. `what` is "the tag" or "the color". */
export function describeTagsProblem(result: Exclude<SidebarTagsResult, { outcome: "saved" }>, what: string): string {
	switch (result.outcome) {
		case "unknown": return `Could not set ${what}: the repository, group, or tag is no longer there.`;
		case "overridden": return `Could not set ${what}: the repositories come from TIMBER_APP_REPOS, so nothing is saved.`;
		case "failed": return `Could not set ${what}: ${result.message}`;
	}
}
