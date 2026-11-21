import { NEW_ARENA_LABEL, arenasUnavailable } from "./arena-format";
import { chopAction, chopEntries, runChopLabel } from "./chop-format";
import { type EditorAction, OPEN_IN_EDITOR, describeEditorAction } from "./editor-format";
import { CLEAN_UP_LABEL, CLEAN_UP_TITLE, cleanUpUnavailableReason, mergedCandidates } from "./clean-up-format";
import { BEING_REMOVED_REASON, DONE_PRIMARY_NOTE } from "./done-format";
import { worktreeLabel } from "./format";
import { REBASE_FOLDER_MISSING } from "./rebase-format";
import type { Repository } from "../shared/model";
import { type AppState, type DialogRequest, isBeingRemoved, isRunning, finishedSessions, selectedWorktree, sessionsOf, waitingSessions } from "./store/state";
import { type RowSessionMark, describeRowSessions } from "./terminal-format";
import { NONE_WAITING, WAITING_LABEL, describeToVisit } from "./waiting";

/**
 * The command palette without React: what it lists for the state of the app,
 * which of it can be done now, how typing narrows it, how it is scoped to the
 * selected worktree's repository and sorted into sections, and the shortcut
 * that opens it. Choosing an entry does what its button does (see
 * palette-run.ts).
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
	| { kind: "terminal"; repository: string; worktree: string; path: string; agent: string | null }
	/** Run a command chop of the repository in a worktree: `worktree` is its identity. */
	| { kind: "chop"; repository: string; worktree: string; chop: string };

/**
 * Where an entry is listed: actions for the selected worktree, actions for a
 * repository, the worktrees to switch to, and actions about the whole app.
 */
export type PaletteSection = "worktree" | "repository" | "worktrees" | "app";

/** The picture beside an entry's label. */
export type PaletteIcon =
	| "terminal" | "agent" | "rebase" | "done" | "editor" | "new" | "branch" | "arena" | "fetch" | "clean-up"
	| "worktree" | "next" | "settings" | "add-repository";

export interface PaletteEntry {
	/** Unique in the list, so rows have a stable key. */
	id: string;
	kind: "worktree" | "action";
	section: PaletteSection;
	icon: PaletteIcon;
	label: string;
	/** A short note at the end of the row, such as "2 merged", or empty. */
	detail: string;
	/** The path of the repository it belongs to, or null for an entry about the whole app. */
	repository: string | null;
	/** That repository's name, shown when the palette is not scoped to it. Empty for the whole app. */
	repositoryName: string;
	/** What choosing it does, in one sentence, for the line under the list. */
	hint: string;
	/** Other words that find it, besides the label. */
	keywords: readonly string[];
	/** Why it cannot be chosen now, or null when it can. */
	disabledReason: string | null;
	/** For a worktree: whether it is the selected one. */
	current?: boolean;
	/** For a worktree: the marks of its sessions, as its sidebar row shows them. */
	sessions?: readonly RowSessionMark[];
	/** For a worktree: its sessions as one sentence, or empty. */
	sessionWords?: string;
	action: PaletteAction;
}

export const PALETTE_LABEL = "Command palette";
export const PALETTE_PLACEHOLDER = "Search actions and worktrees";
export const NO_WORKTREE_SELECTED = "Select a worktree first.";
export const ADDING_REPOSITORY = "A repository is being added.";
export const STARTING_SESSION = "A session is already starting in this worktree.";
export const FETCHING_NOW = "This repository is being fetched.";
export const OPENING_IN_EDITOR = "The editor is being opened for this worktree.";
export const FOLDER_MISSING_FOR_SESSION = "The worktree's folder is missing, so a terminal cannot start there.";
export const OTHER_REPOSITORIES = "Other repositories";
export const NOTHING_MATCHES = "Nothing matches.";

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
 * Every entry for the state, unscoped: the actions first, then every
 * worktree of every available repository. Actions that need a worktree are
 * for the selected one, and carry a reason when they cannot run. Which of
 * them show, and where, is `paletteView`'s part.
 */
export function paletteEntries(state: AppState): PaletteEntry[] {
	return [...actionEntries(state), ...worktreeEntries(state)];
}

function worktreeEntries(state: AppState): PaletteEntry[] {
	const entries: PaletteEntry[] = [];
	const selected = state.selection?.worktree ?? null;
	for (const repository of state.repositories) {
		if (!repository.available) continue;
		for (const worktree of repository.worktrees) {
			const folder = worktree.path.split(/[\\/]/).filter(Boolean).pop() ?? worktree.path;
			const label = worktreeLabel(worktree);
			const sessions = describeRowSessions(sessionsOf(state, worktree.id), state.seenStatuses);
			entries.push({
				id: `worktree:${worktree.id}`,
				kind: "worktree",
				section: "worktrees",
				icon: "worktree",
				label,
				detail: "",
				repository: repository.path,
				repositoryName: repository.name,
				hint: `Shows ${label} in ${repository.name}.`,
				keywords: [worktree.branch ?? "", folder, repository.name],
				disabledReason: null,
				current: worktree.id === selected,
				sessions: sessions.marks,
				sessionWords: sessions.sentence,
				action: { kind: "select", worktree: worktree.id },
			});
		}
	}
	return entries;
}

interface Owner {
	section: PaletteSection;
	icon: PaletteIcon;
	repository: Repository | null;
}

function actionEntries(state: AppState): PaletteEntry[] {
	const selection = selectedWorktree(state);
	const entries: PaletteEntry[] = [];
	const add = (owner: Owner, id: string, label: string, hint: string, disabledReason: string | null, action: PaletteAction, keywords: readonly string[] = [], detail = "") =>
		entries.push({
			id: `action:${id}`,
			kind: "action",
			section: owner.section,
			icon: owner.icon,
			label,
			detail,
			repository: owner.repository?.path ?? null,
			repositoryName: owner.repository?.name ?? "",
			hint,
			keywords: [label, ...keywords],
			disabledReason,
			action,
		});
	const inWorktree = (icon: PaletteIcon): Owner => ({ section: "worktree", icon, repository: selection?.repository ?? null });
	const inRepository = (icon: PaletteIcon, repository: Repository | null = selection?.repository ?? null): Owner => ({ section: "repository", icon, repository });
	const inApp = (icon: PaletteIcon): Owner => ({ section: "app", icon, repository: null });

	if (!selection) {
		const none = NO_WORKTREE_SELECTED;
		// Without a selection none of these can run, so they share a placeholder action that is never taken.
		const idle: PaletteAction = { kind: "dialog", request: { kind: "settings" } };
		add(inWorktree("terminal"), "terminal", "Open terminal", "", none, idle, ["shell", "session"]);
		for (const agent of state.preferences.agents) add(inWorktree("agent"), `agent:${agent.name}`, `Start ${agent.name}`, "", none, idle, ["agent", "session"]);
		add(inWorktree("rebase"), "rebase", "Rebase", "", none, idle);
		add(inWorktree("editor"), "editor", OPEN_IN_EDITOR, "", none, idle, ["code"]);
		add(inWorktree("done"), "done", "Done", "", none, idle, ["remove", "finish", "delete"]);
		// The chops last read stay listed, so they can be found and say why they cannot run.
		for (const chop of chopEntries(state.chops?.list)) {
			add(inWorktree(chop.kind === "prompt" ? "agent" : "terminal"), `chop:${chop.name}`, runChopLabel(chop.name, chopAction(chop.kind, state.preferences.agents.length)), "", none, idle, [chop.title, "chop", chop.kind]);
		}
		add(inRepository("new"), "new", "New worktree", "", none, idle, ["create", "branch"]);
		add(inRepository("branch"), "open", "Open existing branch", "", none, idle, ["worktree", "checkout"]);
		add(inRepository("arena"), "arena", NEW_ARENA_LABEL, "", none, idle, ["attempts", "agents", "compare"]);
		add(inRepository("fetch"), "fetch", "Fetch now", "", none, idle, ["pull", "remote"]);
	} else {
		const { repository, worktree } = selection;
		const name = worktreeLabel(worktree);
		const starting = state.operations.some(operation => operation.kind === "open-terminal" && operation.worktree === worktree.id);
		const sessionReason = !worktree.pathExists ? FOLDER_MISSING_FOR_SESSION : starting ? STARTING_SESSION : null;
		const session = (agent: string | null): PaletteAction => ({ kind: "terminal", repository: repository.path, worktree: worktree.id, path: worktree.path, agent });
		add(inWorktree("terminal"), "terminal", "Open terminal", `Starts a shell in ${worktree.path}.`, sessionReason, session(null), ["shell", "session"]);
		for (const agent of state.preferences.agents) {
			add(inWorktree("agent"), `agent:${agent.name}`, `Start ${agent.name}`, `Starts ${agent.name} in ${worktree.path}.`, sessionReason, session(agent.name), ["agent", "session"]);
		}
		// A chop runs in the active worktree only, as the "+" menu's do.
		const chopReason = sessionReason ?? (isBeingRemoved(state, repository.path, worktree.path) ? BEING_REMOVED_REASON : null);
		const chops = state.chops?.repository === repository.path ? chopEntries(state.chops.list) : [];
		// A prompt that goes to a running agent waits for no session to start; one that needs a new agent says why in a toast when it cannot.
		const promptReason = !worktree.pathExists ? FOLDER_MISSING_FOR_SESSION : isBeingRemoved(state, repository.path, worktree.path) ? BEING_REMOVED_REASON : null;
		for (const chop of chops) {
			const action = chopAction(chop.kind, state.preferences.agents.length);
			const what = chop.title === "" ? chop.name : chop.title.replace(/\.$/, "");
			const hint = action === "run" ? (chop.title === "" ? `Runs ${chop.name} in ${worktree.path}.` : `${what}. Runs in ${worktree.path}.`) : action === "send" ? `${what}. Goes to an agent in ${worktree.path}.` : `${what}. No agent is saved, so this copies the prompt.`;
			add(inWorktree(chop.kind === "prompt" ? "agent" : "terminal"), `chop:${chop.name}`, runChopLabel(chop.name, action), hint, action === "run" ? chopReason : action === "send" ? promptReason : null,
				{ kind: "chop", repository: repository.path, worktree: worktree.id, chop: chop.name }, [chop.title, "chop", chop.kind]);
		}
		add(inWorktree("rebase"), "rebase", "Rebase", `Opens Rebase for ${name}, which shows the Timber command before it runs.`, worktree.pathExists ? null : REBASE_FOLDER_MISSING,
			{ kind: "dialog", request: { kind: "rebase-worktree", repository: repository.path, worktree: worktree.id } });
		const running = state.operations.some(operation => operation.kind === "open-in-editor" && operation.worktree === worktree.path);
		const editor: EditorAction = describeEditorAction(state.preferences.editor, worktree, running);
		add(inWorktree("editor"), "editor", OPEN_IN_EDITOR, `Opens ${name} in your editor.`, editor.available ? null : editor.reason ?? OPENING_IN_EDITOR,
			{ kind: "editor", repository: repository.path, worktree: worktree.path }, ["code"]);
		add(inWorktree("done"), "done", "Done", `Opens Done for ${name}, which shows the Timber command before it runs.`, worktree.primary ? DONE_PRIMARY_NOTE : null,
			{ kind: "dialog", request: { kind: "done-worktree", repository: repository.path, worktree: worktree.id } }, ["remove", "finish", "delete"]);
		add(inRepository("new"), "new", "New worktree", `Opens New worktree for ${repository.name}.`, null,
			{ kind: "dialog", request: { kind: "new-worktree", repository: repository.path, mode: "new" } }, ["create", "branch"]);
		add(inRepository("branch"), "open", "Open existing branch", `Opens a worktree for a branch ${repository.name} already has.`, null,
			{ kind: "dialog", request: { kind: "new-worktree", repository: repository.path, mode: "existing" } }, ["worktree", "checkout"]);
		add(inRepository("arena"), "arena", NEW_ARENA_LABEL, `Opens New arena for ${repository.name}.`, arenasUnavailable(state.arenas[repository.path]),
			{ kind: "dialog", request: { kind: "new-arena", repository: repository.path } }, ["attempts", "agents", "compare"]);
		const fetching = state.fetches[repository.path]?.fetching === true
			|| state.operations.some(operation => operation.kind === "fetch-repository" && operation.repository === repository.path);
		add(inRepository("fetch"), "fetch", "Fetch now", `Fetches ${repository.name} from its remotes.`, fetching ? FETCHING_NOW : null, { kind: "fetch", repository: repository.path }, ["pull", "remote"]);
	}
	// One per repository, whatever is selected: it is about the repository, never one worktree.
	for (const repository of state.repositories) {
		if (!repository.available) continue;
		const pullRequests = state.pullRequests[repository.path];
		const merged = mergedCandidates(repository, pullRequests).length;
		add(inRepository("clean-up", repository), `clean-up:${repository.path}`, CLEAN_UP_LABEL, `${CLEAN_UP_TITLE}.`, cleanUpUnavailableReason(repository, pullRequests),
			{ kind: "dialog", request: { kind: "clean-up-merged", repository: repository.path } }, ["remove", "merged", "pull request", "done", "worktrees", repository.name],
			merged > 0 ? `${merged} merged` : "");
	}
	// About every repository, whatever is selected.
	const waiting = waitingSessions(state).length;
	const finished = finishedSessions(state).length;
	add(inApp("next"), "next-waiting", WAITING_LABEL, "Shows the session that has waited longest, then the one that finished first.", waiting + finished === 0 ? NONE_WAITING : null,
		{ kind: "next-waiting" }, ["needs you", "waiting", "done", "finished", "agent", "jump", "attention"], describeToVisit(waiting, finished));
	add(inApp("settings"), "settings", "Settings", "Opens Settings.", null, { kind: "dialog", request: { kind: "settings" } }, ["preferences", "options"]);
	add(inApp("add-repository"), "add-repository", "Add repository", "Adds a Git repository's folder to the list.", isRunning(state, "add-repository") ? ADDING_REPOSITORY : null,
		{ kind: "add-repository" }, ["folder", "project"]);
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

/** The selected worktree and its repository, as the palette names them, or null when none is selected. */
export interface PaletteScope {
	repository: string;
	repositoryName: string;
	worktreeName: string;
}

export function paletteScope(state: AppState): PaletteScope | null {
	const selection = selectedWorktree(state);
	if (!selection) return null;
	return { repository: selection.repository.path, repositoryName: selection.repository.name, worktreeName: worktreeLabel(selection.worktree) };
}

/** Entries under one heading. A null heading is a list with no sections, as when typing across every repository. */
export interface PaletteGroup {
	heading: string | null;
	matches: PaletteMatch[];
}

export interface PaletteView {
	groups: PaletteGroup[];
	/** Every listed entry in the order shown, which is the order the arrows move through. */
	options: PaletteMatch[];
	/** The line that names the actions left out because they cannot run now, or null when none was left out. */
	unavailable: string | null;
}

const SECTIONS: readonly PaletteSection[] = ["worktree", "repository", "worktrees", "app"];

/** At most this many left-out actions are named in the line under the list; more are only counted. */
export const UNAVAILABLE_NAMED = 4;

function sectionHeading(section: PaletteSection, context: PaletteScope | null, scoped: boolean): string {
	switch (section) {
		case "worktree":
			return context ? `In ${context.worktreeName}` : "Worktree";
		case "repository":
			return context ? `In ${context.repositoryName}` : "Repository";
		case "worktrees":
			return scoped && context ? `Worktrees in ${context.repositoryName}` : "Worktrees";
		case "app":
			return "App";
	}
}

/** The line for actions left out of an empty search, such as "3 actions are not available here: Done, Open in editor, New arena." */
export function describeUnavailable(labels: readonly string[]): string | null {
	const unique = [...new Set(labels)];
	if (unique.length === 0) return null;
	const count = unique.length === 1 ? "1 action is" : `${unique.length} actions are`;
	const names = unique.length <= UNAVAILABLE_NAMED ? `: ${unique.join(", ")}` : "";
	return `${count} not available here${names}. Type one to see why.`;
}

/**
 * What the palette lists for a query. Scoped to the selected worktree's
 * repository, it lists only that repository's entries and the app's, and
 * once something is typed, other repositories' worktrees that match come
 * after them, never their actions. Unscoped, it lists every repository's.
 *
 * With nothing typed, entries are in sections, and actions that cannot run
 * are left out and named in one line instead. With something typed, they are
 * found like any other entry, and the best match comes first. At most
 * `limit` entries are listed: with nothing typed only the worktrees give
 * way, and with something typed the scoped repository's come first, so
 * other repositories never push them out.
 */
export function paletteView(entries: readonly PaletteEntry[], query: string, context: PaletteScope | null, scoped: boolean, limit = PALETTE_LIMIT): PaletteView {
	const scope = scoped && context ? context.repository : null;
	const inScope = (entry: PaletteEntry) => scope === null || entry.repository === null || entry.repository === scope;
	const typed = query.trim() !== "";
	let groups: PaletteGroup[];
	let unavailable: string | null = null;
	if (!typed) {
		const shown = entries.filter(inScope);
		unavailable = describeUnavailable(shown.filter(entry => entry.disabledReason !== null).map(entry => entry.label));
		const available = shown.filter(entry => entry.disabledReason === null);
		groups = SECTIONS.map(section => ({
			heading: sectionHeading(section, context, scope !== null),
			matches: available.filter(entry => entry.section === section).map(entry => ({ entry, positions: [] })),
		}));
	} else if (scope === null) {
		groups = [{ heading: null, matches: matchEntries(entries, query, Number.POSITIVE_INFINITY) }];
	} else {
		const here = matchEntries(entries.filter(inScope), query, Number.POSITIVE_INFINITY);
		const elsewhere = matchEntries(entries.filter(entry => !inScope(entry) && entry.kind === "worktree"), query, Number.POSITIVE_INFINITY);
		groups = [{ heading: `In ${context!.repositoryName}`, matches: here }, { heading: OTHER_REPOSITORIES, matches: elsewhere }];
	}
	if (!typed) {
		// Only the worktrees are many, so only they give way: the actions and the app's entries always show.
		const fixed = groups.reduce((sum, group, index) => sum + (SECTIONS[index] === "worktrees" ? 0 : group.matches.length), 0);
		groups = groups.map((group, index) => SECTIONS[index] === "worktrees" ? { ...group, matches: group.matches.slice(0, Math.max(0, limit - fixed)) } : group);
	} else {
		let room = limit;
		groups = groups.map(group => {
			const kept = group.matches.slice(0, Math.max(0, room));
			room -= kept.length;
			return { ...group, matches: kept };
		});
	}
	groups = groups.filter(group => group.matches.length > 0);
	return { groups, options: groups.flatMap(group => group.matches), unavailable };
}

/**
 * What a row names at its end so it says what it is for, or null: the
 * repository of a worktree outside the scope, and, with no heading to say
 * it, the worktree or repository an action is for. Unscoped, each
 * repository's Clean up merged names its repository.
 */
export function rowTarget(entry: PaletteEntry, context: PaletteScope | null, scoped: boolean, headed: boolean): string | null {
	if (entry.repository === null) return null;
	if (entry.kind === "worktree") return scoped && entry.repository === context?.repository ? null : entry.repositoryName;
	if (entry.repository !== context?.repository) return entry.repositoryName;
	if (!headed && context) return entry.section === "worktree" ? `${context.worktreeName} in ${context.repositoryName}` : context.repositoryName;
	if (!scoped && entry.action.kind === "dialog" && entry.action.request.kind === "clean-up-merged") return entry.repositoryName;
	return null;
}

/** What the line under the list says for the highlighted entry: why it cannot run, or what it does. */
export function describeHighlighted(entry: PaletteEntry | undefined): string {
	if (!entry) return "";
	return entry.disabledReason ?? entry.hint;
}

/** Where the pointer was, in screen pixels. */
export interface PointerAt {
	x: number;
	y: number;
}

/**
 * Whether a mouse move over the list is the person moving the pointer.
 * After the list scrolls under a pointer that stays still, as when the
 * arrows wrap to the last row, WebKit and Chromium send a move at the same
 * place, which must not take the highlight from the row the keys chose. The
 * first move seen only records where the pointer is.
 */
export function pointerMoved(last: PointerAt | null, next: PointerAt): boolean {
	return last !== null && (last.x !== next.x || last.y !== next.y);
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
