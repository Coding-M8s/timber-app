import type { Repository } from "../../shared/model";
import type { SavedSession, SavedSessions } from "../../shared/saved-sessions";
import type { OpenTerminalRequest } from "../../shared/terminal";

/**
 * Opening the sessions of the last run again, after a restart. Pure: the
 * store runs the jobs (see ./store.ts), and every check is made where the
 * sessions open, by `openTerminal`.
 */

/** How many worktrees open their sessions at once. Inside one worktree they open one after another, so chips keep their order. */
export const RESTORE_CONCURRENCY = 3;
/** New output of a restored session is not marked unseen for this long after it started, or every worktree would show unread output after a launch. */
export const RESTORE_QUIET_MILLISECONDS = 3000;

/** The saved sessions of one worktree, and where they open. */
export interface RestoreJob {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's identity (`Worktree.id`). */
	worktreeId: string;
	/** The worktree's registered path. */
	path: string;
	/** The index into `sessions` of the chip that showed. */
	shown: number;
	sessions: readonly SavedSession[];
}

/**
 * The saved worktrees that are listed now, in an available repository, with
 * their folder there: the saved selected one first, then in list order. A
 * worktree that is gone, or whose repository was removed, is left out.
 */
export function restoreJobs(saved: SavedSessions, repositories: readonly Repository[]): RestoreJob[] {
	const jobs: RestoreJob[] = [];
	for (const repository of repositories) {
		if (!repository.available) continue;
		for (const worktree of repository.worktrees) {
			const entry = saved.worktrees[worktree.id];
			if (entry === undefined || !worktree.pathExists) continue;
			jobs.push({ repository: repository.path, worktreeId: worktree.id, path: worktree.path, shown: entry.shown, sessions: entry.sessions });
		}
	}
	const selected = jobs.findIndex(job => job.worktreeId === saved.selected);
	if (selected > 0) jobs.unshift(...jobs.splice(selected, 1));
	return jobs;
}

/**
 * The saved worktrees that are gone for good: in a repository that was read
 * well, with every worktree's folder there, and not listed in it; or, when
 * every repository was read well, in none of them, so its repository left
 * the list. A worktree whose folder is missing changes its id (see
 * `worktreeId`), so while any folder is missing, or any repository cannot be
 * read, the saved worktrees it may hold are kept.
 */
export function goneSavedWorktrees(saved: SavedSessions, repositories: readonly Repository[]): string[] {
	const listed = new Set<string>();
	/** The common Git folder of each repository that was read well and has every folder, which starts each of its worktree ids. */
	const settled = new Set<string>();
	let allRead = true;
	for (const repository of repositories) {
		for (const worktree of repository.worktrees) listed.add(worktree.id);
		const read = repository.available && repository.failure === null && repository.worktrees.length > 0;
		if (!read) {
			allRead = false;
			continue;
		}
		const folders = new Set(repository.worktrees.map(worktree => commonFolderOf(worktree.id)));
		if (folders.size !== 1 || repository.worktrees.some(worktree => !worktree.pathExists)) {
			allRead = false;
			continue;
		}
		settled.add([...folders][0]!);
	}
	return Object.keys(saved.worktrees).filter(id => !listed.has(id) && (settled.has(commonFolderOf(id)) || allRead));
}

/** The common Git folder an id starts with (see `worktreeId`). */
function commonFolderOf(id: string): string {
	const end = id.indexOf("\0");
	return end < 0 ? id : id.slice(0, end);
}

/** The request that opens a saved session again, at the size every new session starts with until its pane fits it. */
export function restoreRequest(job: RestoreJob, session: SavedSession, index: number): OpenTerminalRequest {
	const request: OpenTerminalRequest = { repository: job.repository, worktree: job.path, cols: 80, rows: 24, restore: { worktree: job.worktreeId, index } };
	if (session.kind === "agent") {
		request.agent = session.agent;
		if (session.conversation !== undefined) request.resume = session.conversation;
	}
	if (session.name !== undefined) request.name = session.name;
	return request;
}

/**
 * Run the tasks, at most `limit` at a time, each started in order. Resolves
 * when all ended. A task that rejects does not stop the others.
 */
export async function runLimited(tasks: readonly (() => Promise<void>)[], limit: number): Promise<void> {
	let next = 0;
	async function worker(): Promise<void> {
		while (next < tasks.length) {
			const task = tasks[next]!;
			next += 1;
			try {
				await task();
			} catch {
				// Each task says what went wrong itself.
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), tasks.length) }, worker));
}
