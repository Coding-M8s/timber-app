/**
 * Worktree tags and header colors (issue 409) as the mock acts them out, in
 * memory, by the same rules as the main process (see src/bun/sidebar-tags.ts):
 * Work takes a worktree's entry away, a tag that is not saved or a repository
 * not in the list is `unknown`, and a worktree that is gone loses its tag.
 */
import type { Engine } from "../../shared/engine";
import {
	type HeaderTarget,
	type SidebarTags,
	type Tag,
	WORK_TAG_ID,
	emptySidebarTags,
	isTagColor,
	isTaggablePath,
	withWorktreeTag,
} from "../../shared/worktree-tags";

export interface MockSidebarTagOptions {
	/** The tags and colors to start with. None by default. */
	initial?: SidebarTags;
	/** Whether a repository or group is in the list now. */
	knows(target: HeaderTarget): boolean;
	/** The tags saved in the preferences now. */
	savedTags(): readonly Tag[];
}

export interface MockSidebarTags extends Pick<Engine, "listSidebarTags" | "setWorktreeTag" | "setHeaderColor"> {
	/** A worktree was removed: its tag goes, so a worktree made later at its path is Work. */
	forgetWorktree(repository: string, worktree: string): void;
	/** A repository or group left the list: its tags and color go with it. */
	forgetTarget(target: HeaderTarget): void;
	/** Tags were removed in Settings: their worktrees go back to Work. */
	keepOnly(tags: readonly Tag[]): void;
}

export function createMockSidebarTags(options: MockSidebarTagOptions): MockSidebarTags {
	let tags: SidebarTags = structuredClone(options.initial ?? emptySidebarTags());
	const list = (): SidebarTags => {
		// As the main process answers: only tags that are saved.
		const saved = new Set(options.savedTags().map(tag => tag.id));
		const worktrees: SidebarTags["worktrees"] = {};
		for (const [repository, own] of Object.entries(tags.worktrees)) {
			const kept = Object.entries(own).filter(([, tag]) => saved.has(tag));
			if (kept.length > 0) worktrees[repository] = Object.fromEntries(kept);
		}
		return structuredClone({ ...tags, worktrees });
	};
	return {
		listSidebarTags: async () => list(),
		async setWorktreeTag(request) {
			if (typeof request?.repository !== "string" || !isTaggablePath(request.worktree) || typeof request.tag !== "string") return { outcome: "failed", message: "The request for a tag is not complete." };
			const saved = options.savedTags();
			if (!options.knows({ kind: "repository", path: request.repository }) || (request.tag !== WORK_TAG_ID && !saved.some(tag => tag.id === request.tag))) return { outcome: "unknown" };
			const own = withWorktreeTag(tags.worktrees[request.repository], request.worktree, request.tag);
			const worktrees = { ...tags.worktrees, [request.repository]: own };
			if (Object.keys(own).length === 0) delete worktrees[request.repository];
			tags = { ...tags, worktrees };
			return { outcome: "saved", tags: list() };
		},
		async setHeaderColor(target, color) {
			if (color !== null && !isTagColor(color)) return { outcome: "failed", message: "The request for a color is not complete." };
			if (!options.knows(target)) return { outcome: "unknown" };
			const part = target.kind === "repository" ? "repositories" : "groups";
			const key = target.kind === "repository" ? target.path : target.id;
			const next = { ...tags[part] };
			if (color === null) delete next[key];
			else next[key] = color;
			tags = { ...tags, [part]: next };
			return { outcome: "saved", tags: list() };
		},
		forgetWorktree(repository, worktree) {
			if (!Object.hasOwn(tags.worktrees, repository)) return;
			const own = withWorktreeTag(tags.worktrees[repository], worktree, WORK_TAG_ID);
			const worktrees = { ...tags.worktrees, [repository]: own };
			if (Object.keys(own).length === 0) delete worktrees[repository];
			tags = { ...tags, worktrees };
		},
		forgetTarget(target) {
			if (target.kind === "repository") {
				const { [target.path]: _tags, ...worktrees } = tags.worktrees;
				const { [target.path]: _color, ...repositories } = tags.repositories;
				tags = { ...tags, worktrees, repositories };
			} else {
				const { [target.id]: _color, ...groups } = tags.groups;
				tags = { ...tags, groups };
			}
		},
		keepOnly(saved) {
			const ids = new Set(saved.map(tag => tag.id));
			const worktrees: SidebarTags["worktrees"] = {};
			for (const [repository, own] of Object.entries(tags.worktrees)) {
				const kept = Object.entries(own).filter(([, tag]) => ids.has(tag));
				if (kept.length > 0) worktrees[repository] = Object.fromEntries(kept);
			}
			tags = { ...tags, worktrees };
		},
	};
}
