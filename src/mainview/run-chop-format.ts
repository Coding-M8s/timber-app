import type { ArrangedChop } from "../shared/chop-order";
import { type MissingPick, defaultAgent, defaultAgentName, describeMissingPick, whyNoDefaultAgent } from "../shared/agent-lookup";
import { type ChopKind, type ListedChop, chopKindWord, sameChopName } from "../shared/chops";
import { type ShortcutLetter, describeChord, matchesChord, shortcutLetter } from "../shared/shortcuts";
import { promptTarget } from "./agent-sessions";
import { type ChopAction, chopAction } from "./chop-format";
import { chopsPanelModel } from "./chops-panel-format";
import { worktreeLabel } from "./format";
import { chopBlockedReason, chopPlace, fuzzy } from "./palette";
import { type AppState, chopsEnabled, offeredChops, repositoryPick, selectedWorktree } from "./store/state";

/**
 * The chop search without React: a box over every chop of the selected
 * worktree's repository, opened by a shortcut with the chops panel shown or
 * hidden. What it lists for a query, in what order, which kind it shows,
 * what each row says, and its keys. Choosing a chop runs it through the
 * panel's path (`runChopIn` in ./palette-run.ts). Pure, so it can be tested
 * without a window.
 */

export const RUN_CHOP_LABEL = "Run a chop";
export const RUN_CHOP_PLACEHOLDER = "Search chops by name or text";
export const RUN_CHOP_EDIT_LABEL = "Edit before running";

/** Which chops the search shows: every kind, or one. Tab moves through them in this order. */
export type RunChopFilter = "all" | ChopKind;
export const RUN_CHOP_FILTERS: readonly RunChopFilter[] = ["all", "command", "prompt"];

const FILTER_WORDS: Record<RunChopFilter, { chip: string; plural: string }> = {
	all: { chip: "All", plural: "chops" },
	command: { chip: "Commands", plural: "commands" },
	prompt: { chip: "Prompts", plural: "prompts" },
};

export function runChopFilterLabel(filter: RunChopFilter): string {
	return FILTER_WORDS[filter].chip;
}

/** What the box's chip says to a screen reader, and as its tooltip. */
export function describeRunChopFilter(filter: RunChopFilter): string {
	return filter === "all" ? "Showing commands and prompts. Tab shows only commands." : `Showing only ${FILTER_WORDS[filter].plural}. Tab shows ${filter === "command" ? "only prompts" : "every chop"}.`;
}

/** The filter after Tab, or before it with Shift+Tab: All, Commands, Prompts, and around. */
export function runChopFilterAfter(filter: RunChopFilter, back: boolean): RunChopFilter {
	const at = RUN_CHOP_FILTERS.indexOf(filter);
	const step = back ? RUN_CHOP_FILTERS.length - 1 : 1;
	return RUN_CHOP_FILTERS[(at + step) % RUN_CHOP_FILTERS.length]!;
}

/** A chop the query found, with where the query's letters fell in its name and in the line of its text that shows. */
export interface FoundChop {
	chop: ListedChop;
	favorite: boolean;
	/** Whether it is the chop last chosen in this repository. */
	last: boolean;
	/** The first line of its text, which the row shows. */
	line: string;
	/** Indexes into `chop.name`, for highlighting. */
	namePositions: readonly number[];
	/** Indexes into `line`, for highlighting. Empty when the text matched past its first line. */
	linePositions: readonly number[];
}

/** The first line of a chop's text, as a row shows it. */
export function firstLine(text: string): string {
	return text.split("\n", 1)[0] ?? "";
}

interface Hit {
	/** 0 the name has the query, 1 the name has its letters in order, 2 the text has the query, 3 the shown line has its letters in order. Lower is better. */
	tier: number;
	score: number;
	namePositions: number[];
	linePositions: number[];
}

const run = (start: number, length: number) => Array.from({ length }, (_, offset) => start + offset);

/**
 * How well a chop matches. `phrase` is the query in lower case with its
 * spaces kept to one; `letters` the same without spaces. The name matters
 * most. The text matches only as one piece anywhere in it, or letter by
 * letter in its first line, which is what shows: three letters scattered
 * through a long prompt find nothing worth listing.
 */
function hit(chop: ListedChop, line: string, phrase: string, letters: string): Hit | null {
	const name = chop.name.toLowerCase();
	const inName = name.indexOf(phrase);
	if (inName >= 0) return { tier: 0, score: inName === 0 ? 1 : 0, namePositions: run(inName, phrase.length), linePositions: [] };
	const nameLetters = fuzzy(chop.name, letters);
	if (nameLetters) return { tier: 1, score: nameLetters.score, namePositions: nameLetters.positions, linePositions: [] };
	const inText = chop.text.toLowerCase().indexOf(phrase);
	if (inText >= 0) {
		const shown = inText + phrase.length <= line.length;
		return { tier: 2, score: -inText, namePositions: [], linePositions: shown ? run(inText, phrase.length) : [] };
	}
	const lineLetters = fuzzy(line, letters);
	if (lineLetters) return { tier: 3, score: lineLetters.score, namePositions: [], linePositions: lineLetters.positions };
	return null;
}

/**
 * The chops a query finds, best first. `arranged` is every chop of the
 * repository in the panel's order, favorites first (`arrangeChops`); `last`
 * the name of the chop last chosen there, or null.
 *
 * With nothing typed: the last chop on top, then the favorites, then the
 * rest, in the panel's order. With something typed: chops whose name has
 * the query, then those whose name has its letters in order, then those
 * whose text has it, then those whose first line has its letters in order.
 * Within each, the last chop first, then favorites, then the better match,
 * then the panel's order.
 */
export function findChops(arranged: readonly ArrangedChop[], query: string, filter: RunChopFilter, last: string | null): FoundChop[] {
	const phrase = query.trim().toLowerCase().replace(/\s+/g, " ");
	const letters = phrase.replace(/ /g, "");
	const found: { chop: FoundChop; hit: Hit; order: number }[] = [];
	arranged.forEach(({ chop, favorite }, order) => {
		if (filter !== "all" && chop.kind !== filter) return;
		const line = firstLine(chop.text);
		const isLast = last !== null && sameChopName(chop.name, last);
		const matched: Hit | null = phrase === "" ? { tier: 0, score: 0, namePositions: [], linePositions: [] } : hit(chop, line, phrase, letters);
		if (matched === null) return;
		found.push({ chop: { chop, favorite, last: isLast, line, namePositions: matched.namePositions, linePositions: matched.linePositions }, hit: matched, order });
	});
	found.sort((a, b) =>
		a.hit.tier - b.hit.tier
		|| Number(b.chop.last) - Number(a.chop.last)
		|| Number(b.chop.favorite) - Number(a.chop.favorite)
		|| b.hit.score - a.hit.score
		|| a.order - b.order);
	return found.map(item => item.chop);
}

export interface RunChopRow extends FoundChop {
	/** "Command" or "Prompt". */
	kindWord: string;
	action: ChopAction;
	/** For a prompt, where it goes, such as "to Codex"; null for a command, whose row shows its text. */
	target: string | null;
	/** Why a prompt is copied with agents saved: none was found, or the repository's default agent cannot start. Null for any other row. */
	copied: "none-found" | MissingPick | null;
	/** Why it cannot run now, or null. */
	blocked: string | null;
}

export interface RunChopModel {
	/** The selected worktree as the box names it, or null with none selected. */
	worktree: string | null;
	/** The repository whose chops are listed, or null. */
	repository: string | null;
	rows: RunChopRow[];
	/** What shows in place of rows, or null when there are rows. */
	empty: string | null;
}

/**
 * Why a prompt that names no agent is copied now, as the store does
 * (`runChop`), or null when it is not: it would start a new agent in the
 * selected worktree, and every saved agent was looked for and none was
 * found, or the repository's default agent cannot start.
 */
function copiedForNoAgent(state: AppState, chop: ListedChop): "none-found" | MissingPick | null {
	const selection = selectedWorktree(state);
	if (chop.kind !== "prompt" || chop.agent !== null || selection === null) return null;
	const { agents } = state.preferences;
	const pick = repositoryPick(state, selection.repository.path);
	if (defaultAgent(agents, state.agentLocations, pick) !== null || promptTarget(state.terminals, selection.worktree.id).kind !== "new") return null;
	const why = whyNoDefaultAgent(agents, state.agentLocations, pick);
	return why === "none-found" || typeof why === "object" ? why : null;
}

/** Where a prompt goes now, in the few words of its row. */
function promptWords(state: AppState, chop: ListedChop, action: ChopAction): string {
	if (action === "copy") {
		const why = copiedForNoAgent(state, chop);
		if (why === null) return "copied: no agent is saved";
		return why === "none-found" ? "copied: no agent was found" : `copied: ${why.name} ${why.state === "unusable" ? "cannot start" : why.state === "not-saved" ? "is not saved" : "was not found"}`;
	}
	const selection = selectedWorktree(state);
	const repository = selection?.repository.path ?? offeredChops(state)?.repository;
	// The chop's agent, or the default agent: the repository's, or the first saved one found, or, while not known, whichever that turns out to be.
	const found = chop.agent ?? (repository === undefined ? null : defaultAgentName(state.preferences.agents, state.agentLocations, repositoryPick(state, repository)));
	if (selection === null) return found === null ? "to the first agent found" : `to ${found}`;
	const target = promptTarget(state.terminals, selection.worktree.id);
	switch (target.kind) {
		case "session":
			return `to ${state.terminals.find(session => session.id === target.session)?.name ?? found ?? "the agent running"}`;
		case "new":
			return found === null ? "to a new session of the first agent found" : `to a new ${found}`;
		case "ask":
			return "to the agent you pick";
	}
}

/**
 * What the search shows for a query and a filter. The chops are the ones
 * the chops panel lists (`chopsPanelModel`): the selected worktree's
 * repository's, or the ones last read with none selected, when none can
 * run. Each row says why it cannot run, by its own kind (`chopBlockedReason`).
 */
export function runChopModel(state: AppState, query: string, filter: RunChopFilter): RunChopModel {
	const panel = chopsPanelModel(state, "command", "");
	const selection = selectedWorktree(state);
	const place = chopPlace(state);
	const agents = state.preferences.agents.length;
	const last = panel.repository === null ? null : state.lastChops[panel.repository] ?? null;
	const rows = findChops(panel.arranged, query, filter, last).map(found => {
		// With no default agent to start, a prompt that would start it is copied, as the store does.
		const copied = copiedForNoAgent(state, found.chop);
		const action = copied !== null ? "copy" : chopAction(found.chop.kind, agents);
		return {
			...found,
			kindWord: chopKindWord(found.chop.kind),
			action,
			target: found.chop.kind === "prompt" ? promptWords(state, found.chop, action) : null,
			copied,
			blocked: chopBlockedReason(action, place),
		};
	});
	let empty: string | null = null;
	if (panel.failure !== null) empty = panel.failure;
	else if (panel.empty !== null) empty = panel.empty;
	else if (rows.length === 0) {
		const wanted = query.trim();
		empty = wanted === "" ? `No ${FILTER_WORDS[filter].plural} yet. Make one in the chops panel.` : `No ${FILTER_WORDS[filter].plural} match "${wanted}".`;
	}
	return { worktree: selection === null ? null : worktreeLabel(selection.worktree), repository: panel.repository, rows, empty };
}

/** The line under the list for the highlighted row: why it cannot run, or what Enter does. */
export function describeRunChopRow(row: RunChopRow | undefined, worktree: string | null): string {
	if (row === undefined) return "";
	if (row.blocked !== null) return row.blocked;
	switch (row.action) {
		case "run":
			return `Enter runs ${row.chop.name} in a new terminal in ${worktree}.`;
		case "send":
			return `Enter sends ${row.chop.name} ${row.target}.`;
		case "copy":
			if (row.copied !== null && typeof row.copied === "object") return `Enter copies ${row.chop.name}: ${describeMissingPick(row.copied)}.`;
			return row.copied === "none-found"
				? `Enter copies ${row.chop.name}: none of the agents in Settings, Agents was found.`
				: `Enter copies ${row.chop.name}: no agent is saved in Settings, Agents.`;
	}
}

/** The keys the footer names, for this platform. */
export function runChopKeys(mac: boolean): { keys: string; words: string }[] {
	return [
		{ keys: "Enter", words: "run" },
		{ keys: `${mac ? "Cmd" : "Ctrl"}+Enter`, words: "edit before running" },
		{ keys: "Tab", words: "commands or prompts" },
	];
}

/** The keys the footer names while a chop's text is edited. */
export function runChopEditKeys(): { keys: string; words: string }[] {
	return [
		{ keys: "Enter", words: "run once" },
		{ keys: "Shift+Enter", words: "new line" },
		{ keys: "Escape", words: "back to the list" },
	];
}

type Keys = Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "metaKey" | "altKey"> & { isComposing?: boolean; repeat?: boolean };

/** What a key in the search box does: run the highlighted chop, edit it first, or show another kind. Null for any other key. */
export function runChopListKey(event: Keys): "run" | "edit" | "next-filter" | "previous-filter" | null {
	// A held key acts once: a repeat of Ctrl+Enter would reach the edit box and run the text unedited.
	if (event.isComposing === true || event.repeat === true || event.altKey) return null;
	if (event.key === "Enter") {
		if (event.shiftKey) return null;
		return event.ctrlKey || event.metaKey ? "edit" : "run";
	}
	if (event.key === "Tab" && !event.ctrlKey && !event.metaKey) return event.shiftKey ? "previous-filter" : "next-filter";
	return null;
}

/** Whether a key in the edit box runs the edited text: Enter, or Ctrl or Cmd with it. Shift+Enter is a new line. */
export function runsEditedText(event: Keys): boolean {
	return event.isComposing !== true && event.repeat !== true && event.key === "Enter" && !event.shiftKey && !event.altKey;
}

/** What the edit step says above the text. */
export function describeEditStep(chop: Pick<ListedChop, "name" | "kind">, worktree: string | null): string {
	const where = worktree === null ? "" : ` in ${worktree}`;
	return `Edit ${chop.name} for this run only${where}. The saved ${chop.kind} stays as it is.`;
}

/** The search's shortcut for this platform: the key set in Settings, Shortcuts, or Ctrl+Shift+T (Cmd+Shift+T on macOS). */
export function runChopShortcut(state: Pick<AppState, "preferences">, mac: boolean): string {
	return describeChord(shortcutLetter(state.preferences.shortcuts, "run-chop"), mac);
}

type ShortcutKeys = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "shiftKey" | "metaKey" | "altKey">;

/** Whether a key press is the search's shortcut as set, Ctrl+Shift+T until another is. */
export function isRunChopShortcut(event: ShortcutKeys, letter: ShortcutLetter): boolean {
	return matchesChord(event, letter);
}

/**
 * Whether the app takes this key from the page, and from a terminal's
 * program, to open or close the chop search: the chord as set, while chops
 * are in use and no other dialog or the quit question is open. Otherwise
 * the key goes on as if the app had none.
 */
export function takesRunChopKey(event: ShortcutKeys, state: AppState): boolean {
	if (!isRunChopShortcut(event, shortcutLetter(state.preferences.shortcuts, "run-chop"))) return false;
	if (!chopsEnabled(state) || state.quitRequest !== null) return false;
	return state.dialog === null || state.dialog.kind === "run-chop";
}
