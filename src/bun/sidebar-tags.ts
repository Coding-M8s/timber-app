import { messageOf } from "../shared/error-message";
import type { Repository } from "../shared/model";
import { defaultPreferences } from "../shared/preferences";
import type { Settings } from "../shared/settings";
import {
	type HeaderTarget,
	type SetWorktreeTagRequest,
	type SidebarTags,
	type SidebarTagsResult,
	type TagColor,
	WORK_TAG_ID,
	emptySidebarTags,
	isTagColor,
	isTaggablePath,
	withWorktreeTag,
} from "../shared/worktree-tags";
import { overrideRepositoryPaths } from "./git-engine";
import type { SettingsHolder } from "./settings";

/** The worktree tags and header colors, kept in the settings file. See `Engine.listSidebarTags`. */
export interface SidebarTagStore {
	list(): Promise<SidebarTags>;
	/** See `Engine.setWorktreeTag`. */
	setWorktreeTag(request: SetWorktreeTagRequest): Promise<SidebarTagsResult>;
	/** See `Engine.setHeaderColor`. */
	setHeaderColor(target: HeaderTarget, color: TagColor | null): Promise<SidebarTagsResult>;
	/**
	 * A mark to take before a listing starts. A tag set after it is newer than
	 * what the listing saw, so `forgetRemoved` keeps it.
	 */
	mark(): number;
	/**
	 * Drop the tags of worktrees that listings no longer name, so a worktree
	 * made later at the same path is Work. Only a listing that worked counts:
	 * a repository that is missing or that Timber could not list keeps its
	 * tags. A tag set since `mark` is kept, as its worktree may be newer than
	 * the listing.
	 */
	forgetRemoved(repositories: readonly Repository[], mark: number): Promise<void>;
}

/** The tags as the interface reads them: only tags that are saved, of repositories and groups in the list. */
export function sidebarTagsOf(settings: Settings): SidebarTags {
	const saved = new Set((settings.preferences ?? defaultPreferences()).tags.map(tag => tag.id));
	const tags = emptySidebarTags();
	for (const repository of settings.repositories) {
		const own = Object.entries(repository.worktreeTags ?? {}).filter(([, tag]) => saved.has(tag));
		if (own.length > 0) tags.worktrees[repository.path] = Object.fromEntries(own);
		if (repository.color !== undefined) tags.repositories[repository.path] = repository.color;
	}
	for (const group of settings.groups ?? []) {
		if (group.color !== undefined) tags.groups[group.id] = group.color;
	}
	return tags;
}

/** The request as the bridge sent it, checked: its shape is never assumed. */
function readTagRequest(value: unknown): SetWorktreeTagRequest | null {
	if (typeof value !== "object" || value === null) return null;
	const { repository, worktree, tag } = value as Record<string, unknown>;
	if (typeof repository !== "string" || repository === "" || !isTaggablePath(worktree) || typeof tag !== "string" || tag === "") return null;
	return { repository, worktree, tag };
}

function readHeaderTarget(value: unknown): HeaderTarget | null {
	if (typeof value !== "object" || value === null) return null;
	const { kind, path, id } = value as Record<string, unknown>;
	if (kind === "repository" && typeof path === "string" && path !== "") return { kind, path };
	if (kind === "group" && typeof id === "string" && id !== "") return { kind, id };
	return null;
}

/**
 * Worktree tags and header colors, kept in the settings file beside each
 * saved repository and group. Every change takes its turn with the other
 * changes to the file. Nothing in a repository, its folder, or Timber's
 * metadata is touched.
 */
export function createSidebarTags(holder: SettingsHolder, environment: Record<string, string | undefined> = process.env): SidebarTagStore {
	const overridden = () => overrideRepositoryPaths(environment) !== null;
	// A count of changes, and the count each worktree's tag was last set at in this run. A tag read from the file was set before any listing.
	let changes = 0;
	const setAt = new Map<string, number>();
	const key = (repository: string, worktree: string) => `${repository}\u0000${worktree}`;

	async function save(next: Settings): Promise<SidebarTagsResult> {
		try {
			await holder.save(next);
		} catch (error) {
			return { outcome: "failed", message: `Could not save settings to ${holder.file}: ${messageOf(error)}` };
		}
		return { outcome: "saved", tags: sidebarTagsOf(next) };
	}

	return {
		async list() {
			if (overridden()) return emptySidebarTags();
			return sidebarTagsOf(await holder.current());
		},

		async setWorktreeTag(requested) {
			if (overridden()) return { outcome: "overridden" };
			const request = readTagRequest(requested);
			if (!request) return { outcome: "failed", message: "The request for a tag is not complete." };
			return holder.inTurn(async () => {
				const current = await holder.current();
				const tags = (current.preferences ?? defaultPreferences()).tags;
				const index = current.repositories.findIndex(entry => entry.path === request.repository);
				if (index === -1 || (request.tag !== WORK_TAG_ID && !tags.some(tag => tag.id === request.tag))) return { outcome: "unknown" };
				const entry = current.repositories[index]!;
				const { worktreeTags: _, ...rest } = entry;
				const worktreeTags = withWorktreeTag(entry.worktreeTags, request.worktree, request.tag);
				const repositories = current.repositories.map((known, at) => (at === index ? (Object.keys(worktreeTags).length > 0 ? { ...rest, worktreeTags } : rest) : known));
				setAt.set(key(request.repository, request.worktree), ++changes);
				return save({ ...current, repositories });
			});
		},

		async setHeaderColor(requestedTarget, requestedColor) {
			if (overridden()) return { outcome: "overridden" };
			const target = readHeaderTarget(requestedTarget);
			if (!target || (requestedColor !== null && !isTagColor(requestedColor))) return { outcome: "failed", message: "The request for a color is not complete." };
			const color = requestedColor;
			return holder.inTurn(async () => {
				const current = await holder.current();
				const paint = <Entry extends { color?: TagColor }>(entry: Entry): Entry => {
					const { color: _, ...rest } = entry;
					return (color === null ? rest : { ...rest, color }) as Entry;
				};
				if (target.kind === "repository") {
					if (!current.repositories.some(entry => entry.path === target.path)) return { outcome: "unknown" };
					return save({ ...current, repositories: current.repositories.map(entry => (entry.path === target.path ? paint(entry) : entry)) });
				}
				if (!(current.groups ?? []).some(group => group.id === target.id)) return { outcome: "unknown" };
				return save({ ...current, groups: current.groups!.map(group => (group.id === target.id ? paint(group) : group)) });
			});
		},

		mark: () => changes,

		async forgetRemoved(repositories, mark) {
			if (overridden()) return;
			const read = repositories.filter(repository => repository.available && repository.failure === null);
			if (read.length === 0) return;
			const tidied = (current: Settings) => {
				let changed = false;
				const next = current.repositories.map(entry => {
					const listing = read.find(repository => repository.path === entry.path);
					if (!listing || !entry.worktreeTags) return entry;
					const listed = new Set(listing.worktrees.map(worktree => worktree.path));
					const kept = Object.entries(entry.worktreeTags).filter(([path]) => listed.has(path) || (setAt.get(key(entry.path, path)) ?? 0) > mark);
					if (kept.length === Object.keys(entry.worktreeTags).length) return entry;
					changed = true;
					const { worktreeTags: _, ...rest } = entry;
					return kept.length > 0 ? { ...rest, worktreeTags: Object.fromEntries(kept) } : rest;
				});
				return changed ? next : null;
			};
			// Most listings drop nothing: those never wait for the other changes to the file.
			if (tidied(await holder.current()) === null) return;
			await holder.inTurn(async () => {
				const current = await holder.current();
				const next = tidied(current);
				if (next === null) return;
				try {
					await holder.save({ ...current, repositories: next });
				} catch {
					// Only tidying: the next listing tries again.
				}
			});
		},
	};
}
