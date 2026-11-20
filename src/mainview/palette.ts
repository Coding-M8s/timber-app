import { NEW_ARENA_LABEL, arenasUnavailable } from "./arena-format";
import { type EditorAction, OPEN_IN_EDITOR, describeEditorAction } from "./editor-format";
import { CLEAN_UP_LABEL, cleanUpUnavailableReason } from "./clean-up-format";
import { DONE_PRIMARY_NOTE } from "./done-format";
import { worktreeLabel } from "./format";
import { REBASE_FOLDER_MISSING } from "./rebase-format";
import { type AppState, type DialogRequest, isRunning, finishedSessions, selectedWorktree, waitingSessions } from "./store/state";
import { NONE_WAITING, WAITING_LABEL, describeToVisit } from "./waiting";

/**
 * The command palette without React: what it lists for the state of the app,
 * which of it can be done now, how typing narrows it, and the shortcut that
 * opens it. Choosing an entry does what its button does (see palette-run.ts).
 */

/** What choosing an entry does. Each is something a button already does. */
export type PaletteAction =
	| { kind: "select"; worktree: string }
	| { kind: "dialog"; request: DialogRequest }
	| { kind: "fetch"; repository: string }
	| { kind: "add-repository" }
	/** Show the next session that needs the person or is done, as the title bar item does. */
	| { kind: "next-waiting" }
	| { kind: "editor"; repository: string; worktree: string }
	/** Start the shell, or the agent named, in a worktree: `worktree` is its identity, `path` its registered path. */
	| { kind: "terminal"; repository: string; worktree: string; path: string; agent: string | null };

export interface PaletteEntry {
	/** Unique in the list, so rows have a stable key. */
	id: string;
	kind: "worktree" | "action";
	label: string;
	/** What it applies to, for example the repository of a worktree, or the worktree an action is for. */
	detail: string;
	/** Other words that find it, besides the label. */
	keywords: readonly string[];
	/** Why it cannot be chosen now, or null when it can. */
	disabledReason: string | null;
	action: PaletteAction;
}

export const PALETTE_LABEL = "Command palette";
export const PALETTE_PLACEHOLDER = "Type a worktree, branch, repository, or action";
export const NO_WORKTREE_SELECTED = "Select a worktree first.";
export const ADDING_REPOSITORY = "A repository is being added.";
export const STARTING_SESSION = "A session is already starting in this worktree.";
export const FETCHING_NOW = "This repository is being fetched.";
export const OPENING_IN_EDITOR = "The editor is being opened for this worktree.";
export const FOLDER_MISSING_FOR_SESSION = "The worktree's folder is missing, so a terminal cannot start there.";

/** The shortcut that opens the palette, as shown on the title bar button. */
export const PALETTE_SHORTCUT = "Ctrl+Shift+P";
export const PALETTE_SHORTCUT_MAC = "Cmd+Shift+P";

export function paletteHint(mac: boolean): string {
	return `${PALETTE_LABEL} (${mac ? PALETTE_SHORTCUT_MAC : PALETTE_SHORTCUT})`;
}

type Keys = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "shiftKey" | "metaKey" | "altKey">;

/** Ctrl+Shift+P, or Cmd+Shift+P on macOS. Either modifier counts, so the key needs no platform test. */
export function isPaletteShortcut(event: Keys): boolean {
	if (event.type !== "keydown" || event.altKey || !event.shiftKey) return false;
	return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p";
}

/**
 * Every entry for the state: the actions first, then every worktree of every
 * available repository, so a long list of worktrees never pushes the actions
 * out of sight. Actions that need a worktree name the selected one, and are
 * shown with a reason when they cannot run.
 */
export function paletteEntries(state: AppState): PaletteEntry[] {
	return [...actionEntries(state), ...worktreeEntries(state)];
}

function worktreeEntries(state: AppState): PaletteEntry[] {
	const entries: PaletteEntry[] = [];
	for (const repository of state.repositories) {
		if (!repository.available) continue;
		for (const worktree of repository.worktrees) {
			const folder = worktree.path.split(/[\\/]/).filter(Boolean).pop() ?? worktree.path;
			entries.push({
				id: `worktree:${worktree.id}`,
				kind: "worktree",
				label: worktreeLabel(worktree),
				detail: repository.name,
				keywords: [worktree.branch ?? "", folder, repository.name],
				disabledReason: null,
				action: { kind: "select", worktree: worktree.id },
			});
		}
	}
	return entries;
}

function actionEntries(state: AppState): PaletteEntry[] {
	const selection = selectedWorktree(state);
	const entries: PaletteEntry[] = [];
	const add = (id: string, label: string, detail: string, disabledReason: string | null, action: PaletteAction, keywords: readonly string[] = []) =>
		entries.push({ id: `action:${id}`, kind: "action", label, detail, keywords: [label, ...keywords], disabledReason, action });

	if (!selection) {
		const none = NO_WORKTREE_SELECTED;
		// Without a selection none of these can run, so they share a placeholder action that is never taken.
		const idle: PaletteAction = { kind: "dialog", request: { kind: "settings" } };
		add("new", "New worktree", "", none, idle, ["create", "branch"]);
		add("open", "Open existing branch", "", none, idle, ["worktree", "checkout"]);
		add("arena", NEW_ARENA_LABEL, "", none, idle, ["attempts", "agents", "compare"]);
		add("fetch", "Fetch now", "", none, idle, ["pull", "remote"]);
		add("rebase", "Rebase", "", none, idle);
		add("done", "Done", "", none, idle, ["remove", "finish", "delete"]);
		add("editor", OPEN_IN_EDITOR, "", none, idle, ["code"]);
		add("terminal", "Open terminal", "", none, idle, ["shell", "session"]);
		for (const agent of state.preferences.agents) add(`agent:${agent.name}`, `Start ${agent.name}`, "", none, idle, ["agent", "session"]);
	} else {
		const { repository, worktree } = selection;
		const target = `${worktreeLabel(worktree)} in ${repository.name}`;
		const where = `In ${repository.name}`;
		add("new", "New worktree", where, null, { kind: "dialog", request: { kind: "new-worktree", repository: repository.path, mode: "new" } }, ["create", "branch"]);
		add("open", "Open existing branch", where, null, { kind: "dialog", request: { kind: "new-worktree", repository: repository.path, mode: "existing" } }, ["worktree", "checkout"]);
		add("arena", NEW_ARENA_LABEL, where, arenasUnavailable(state.arenas[repository.path]), { kind: "dialog", request: { kind: "new-arena", repository: repository.path } }, ["attempts", "agents", "compare"]);
		const fetching = state.fetches[repository.path]?.fetching === true
			|| state.operations.some(operation => operation.kind === "fetch-repository" && operation.repository === repository.path);
		add("fetch", "Fetch now", where, fetching ? FETCHING_NOW : null, { kind: "fetch", repository: repository.path }, ["pull", "remote"]);
		add("rebase", "Rebase", target, worktree.pathExists ? null : REBASE_FOLDER_MISSING,
			{ kind: "dialog", request: { kind: "rebase-worktree", repository: repository.path, worktree: worktree.id } });
		add("done", "Done", target, worktree.primary ? DONE_PRIMARY_NOTE : null,
			{ kind: "dialog", request: { kind: "done-worktree", repository: repository.path, worktree: worktree.id } }, ["remove", "finish", "delete"]);
		const running = state.operations.some(operation => operation.kind === "open-in-editor" && operation.worktree === worktree.path);
		const editor: EditorAction = describeEditorAction(state.preferences.editor, worktree, running);
		add("editor", OPEN_IN_EDITOR, target, editor.available ? null : editor.reason ?? OPENING_IN_EDITOR,
			{ kind: "editor", repository: repository.path, worktree: worktree.path }, ["code"]);
		const starting = state.operations.some(operation => operation.kind === "open-terminal" && operation.worktree === worktree.id);
		const sessionReason = !worktree.pathExists ? FOLDER_MISSING_FOR_SESSION : starting ? STARTING_SESSION : null;
		const session = (agent: string | null): PaletteAction => ({ kind: "terminal", repository: repository.path, worktree: worktree.id, path: worktree.path, agent });
		add("terminal", "Open terminal", target, sessionReason, session(null), ["shell", "session"]);
		for (const agent of state.preferences.agents) add(`agent:${agent.name}`, `Start ${agent.name}`, target, sessionReason, session(agent.name), ["agent", "session"]);
	}
	// About every repository, whatever is selected.
	const waiting = waitingSessions(state).length;
	const finished = finishedSessions(state).length;
	add("next-waiting", WAITING_LABEL, describeToVisit(waiting, finished), waiting + finished === 0 ? NONE_WAITING : null,
		{ kind: "next-waiting" }, ["needs you", "waiting", "done", "finished", "agent", "jump", "attention"]);
	// One per repository, whatever is selected: it is about the repository, never one worktree.
	for (const repository of state.repositories) {
		if (!repository.available) continue;
		add(`clean-up:${repository.path}`, CLEAN_UP_LABEL, `In ${repository.name}`, cleanUpUnavailableReason(repository, state.pullRequests[repository.path]),
			{ kind: "dialog", request: { kind: "clean-up-merged", repository: repository.path } }, ["remove", "merged", "pull request", "done", "worktrees", repository.name]);
	}
	add("settings", "Settings", "", null, { kind: "dialog", request: { kind: "settings" } }, ["preferences", "options"]);
	add("add-repository", "Add repository", "", isRunning(state, "add-repository") ? ADDING_REPOSITORY : null, { kind: "add-repository" }, ["folder", "project"]);
	return entries;
}

/** An entry that matched the query, with where in its label the query's letters fell. */
export interface PaletteMatch {
	entry: PaletteEntry;
	/** Indexes into `entry.label`, for highlighting. Empty when only a keyword matched. */
	positions: readonly number[];
}

export const PALETTE_LIMIT = 50;

interface Fuzzy {
	score: number;
	positions: number[];
}

const isWordStart = (text: string, index: number) => index === 0 || !/[a-z0-9]/i.test(text[index - 1]!);

/**
 * A case-insensitive subsequence match of `query` in `text`, or null. A run
 * of the query as one piece scores best, then letters that begin words, then
 * letters that follow each other. A shorter text beats a longer one.
 */
function fuzzy(text: string, query: string): Fuzzy | null {
	const haystack = text.toLowerCase();
	const whole = haystack.indexOf(query);
	if (whole >= 0) {
		const positions = Array.from({ length: query.length }, (_, offset) => whole + offset);
		const bonus = (whole === 0 ? 40 : isWordStart(text, whole) ? 25 : 0) + (query.length === text.length ? 20 : 0);
		return { score: 100 + query.length * 3 + bonus - text.length * 0.1, positions };
	}
	const positions: number[] = [];
	let score = 0;
	let from = 0;
	for (const char of query) {
		const found = haystack.indexOf(char, from);
		if (found < 0) return null;
		score += 1 + (isWordStart(text, found) ? 8 : 0) + (positions.length > 0 && found === positions[positions.length - 1]! + 1 ? 5 : 0);
		positions.push(found);
		from = found + 1;
	}
	if (positions[0] === 0) score += 10;
	return { score: score - text.length * 0.1, positions };
}

/**
 * The entries the query finds, best first, at most `limit`. A match in the
 * label beats one in another keyword. An empty query keeps the order given.
 */
export function matchEntries(entries: readonly PaletteEntry[], query: string, limit = PALETTE_LIMIT): PaletteMatch[] {
	const needle = query.trim().toLowerCase().replace(/\s+/g, "");
	if (needle === "") return entries.slice(0, limit).map(entry => ({ entry, positions: [] }));
	const found: { match: PaletteMatch; score: number; order: number }[] = [];
	entries.forEach((entry, order) => {
		const inLabel = fuzzy(entry.label, needle);
		if (inLabel) {
			found.push({ match: { entry, positions: inLabel.positions }, score: inLabel.score + 1000, order });
			return;
		}
		let best: Fuzzy | null = null;
		for (const keyword of entry.keywords) {
			const hit = keyword === "" ? null : fuzzy(keyword, needle);
			if (hit && (!best || hit.score > best.score)) best = hit;
		}
		if (best) found.push({ match: { entry, positions: [] }, score: best.score, order });
	});
	found.sort((a, b) => b.score - a.score || a.order - b.order);
	return found.slice(0, limit).map(item => item.match);
}

/** The entry a key moves to in a list of `count` rows from `index`: the arrows step and wrap, Home and End jump. Null for any other key. */
export function rowAfterKey(count: number, index: number, key: string): number | null {
	if (count === 0) return null;
	switch (key) {
		case "ArrowDown":
			return (index + 1) % count;
		case "ArrowUp":
			return (index + count - 1) % count;
		case "Home":
			return 0;
		case "End":
			return count - 1;
		default:
			return null;
	}
}
