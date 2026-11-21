import { CHOP_LIMIT, type ChopKind, type ChopList, type ChopSource, type ChopsFileState, type ListedChop, type PersonalChop, chopProblem, commandChops, listedChops, normalizeChopText, samePersonalChops } from "../shared/chops";
import { cleanSessionName } from "../shared/terminal";
import type { WorktreeMenuItem, WorktreeMenuItemId } from "./worktree-menu-format";

/**
 * Words and rules for Settings, Chops. Pure, so they can be tested without a
 * window.
 */

/** One personal chop as typed in Settings, Chops and not saved yet. `key` tells rows apart while they are edited. */
export interface ChopDraft {
	key: string;
	name: string;
	kind: ChopKind;
	text: string;
	description: string;
	/** For a prompt: an agent's name, or null for the first saved agent. Kept while the kind is a command, and left out when saved. */
	agent: string | null;
	/** The primary checkout of the repository it is for, or null for every repository. */
	repository: string | null;
}

export type ChopDraftChange = Partial<Omit<ChopDraft, "key">>;

let lastKey = 0;
const nextKey = () => `chop-${++lastKey}`;

/** The rows that show what is saved. */
export function chopDraftsOf(saved: readonly PersonalChop[]): ChopDraft[] {
	return saved.map(chop => ({ key: nextKey(), ...chop }));
}

/** The rows with an empty command at the end, for the repository given, or for every repository with null. */
export function addChopDraft(drafts: readonly ChopDraft[], repository: string | null = null): ChopDraft[] {
	return [...drafts, { key: nextKey(), name: "", kind: "command", text: "", description: "", agent: null, repository }];
}

export function editChopDraft(drafts: readonly ChopDraft[], key: string, change: ChopDraftChange): ChopDraft[] {
	return drafts.map(draft => draft.key === key ? { ...draft, ...change } : draft);
}

export function removeChopDraft(drafts: readonly ChopDraft[], key: string): ChopDraft[] {
	return drafts.filter(draft => draft.key !== key);
}

/** A row as it would be saved: the name cleaned as a session name, the description trimmed, the agent only for a prompt. */
function chopOf(draft: ChopDraft): PersonalChop {
	return {
		name: cleanSessionName(draft.name) ?? "",
		kind: draft.kind,
		text: normalizeChopText(draft.text),
		description: draft.description.trim(),
		agent: draft.kind === "prompt" ? draft.agent : null,
		repository: draft.repository,
	};
}

export interface ChopRowModel {
	key: string;
	/** Why this row cannot be saved, or null. */
	problem: string | null;
}

export interface ChopsDraftModel {
	rows: ChopRowModel[];
	/** What Save would save. */
	chops: PersonalChop[];
	/** Why the list as a whole cannot be saved, or null. */
	error: string | null;
	canSave: boolean;
}

/**
 * What the rows of Settings, Chops amount to. A name must differ, ignoring
 * case, from the names before it that are for the same repository, or for
 * every repository.
 */
export function chopsDraftModel(drafts: readonly ChopDraft[], saved: readonly PersonalChop[]): ChopsDraftModel {
	const chops: PersonalChop[] = [];
	const rows = drafts.map(draft => {
		const chop = chopOf(draft);
		const others = chops.filter(other => other.repository === chop.repository).map(other => other.name);
		const problem = chopProblem(chop, others);
		chops.push(chop);
		return { key: draft.key, problem };
	});
	const error = drafts.length > CHOP_LIMIT ? `The list can hold ${CHOP_LIMIT} chops at most. Remove ${drafts.length - CHOP_LIMIT}.` : null;
	const valid = error === null && rows.every(row => row.problem === null);
	return { rows, chops, error, canSave: valid && !samePersonalChops(chops, saved) };
}

/**
 * What Settings, Chops saves, from the rows and the "Use chops" switch: the
 * switch when it differs from what is saved, and the rows when they differ
 * and can be saved. The switch saves on its own while the rows are as
 * saved, so chops can always be turned off; with rows changed but not
 * savable, nothing is. Null when there is nothing to save.
 */
export function chopsSectionChange(model: Pick<ChopsDraftModel, "chops" | "canSave">, saved: readonly PersonalChop[], useChops: boolean, savedUseChops: boolean): { useChops?: boolean; chops?: PersonalChop[] } | null {
	const useChanged = useChops !== savedUseChops;
	if (model.canSave) return { ...(useChanged ? { useChops } : {}), chops: model.chops };
	if (useChanged && samePersonalChops(model.chops, saved)) return { useChops };
	return null;
}

/** Whether a row has nothing typed in it yet, so it says what it needs without an alert. */
export function isBlankChopDraft(draft: ChopDraft): boolean {
	return draft.name.trim() === "" && draft.text.trim() === "";
}

/** One choice of the "For" field: every repository, or one by its primary checkout. */
export interface ChopScopeOption {
	/** "" for every repository, otherwise the primary checkout. */
	value: string;
	label: string;
}

/**
 * The choices of a row's "For" field: every repository, then each in the
 * list. A repository that left the list is kept as a choice for the row
 * that names it, so saving never moves the chop, and is marked.
 */
export function chopScopeOptions(repositories: readonly { path: string; name: string }[], chosen: string | null): ChopScopeOption[] {
	const options = [{ value: "", label: "Every repository" }, ...repositories.map(repository => ({ value: repository.path, label: repository.name }))];
	if (chosen !== null && !repositories.some(repository => repository.path === chosen)) options.push({ value: chosen, label: `${chosen} (not in the list)` });
	return options;
}

/** One choice of a prompt's "Agent" field. */
export interface ChopAgentOption {
	/** "" for the first saved agent, otherwise the agent's name. */
	value: string;
	label: string;
}

/**
 * The choices of a prompt's "Agent" field: the first saved agent, then each
 * saved agent. A name no agent has, such as one from another machine, is kept
 * for the row that names it, and marked.
 */
export function chopAgentOptions(agents: readonly { name: string }[], chosen: string | null): ChopAgentOption[] {
	const options = [{ value: "", label: "First saved agent" }, ...agents.map(agent => ({ value: agent.name, label: agent.name }))];
	if (chosen !== null && !agents.some(agent => agent.name === chosen)) options.push({ value: chosen, label: `${chosen} (no such agent)` });
	return options;
}

const SOURCE_WORDS: Record<ChopSource, string> = {
	"personal-every": "Yours, for every repository",
	"personal-repository": "Yours, for this repository",
	"repository-file": "From the repository",
};

/** Where a listed chop comes from, in words. */
export function describeChopSource(source: ChopSource): string {
	return SOURCE_WORDS[source];
}

/** What an overridden repository chop says about the personal chop that takes its place. */
export function describeOverride(by: "personal-every" | "personal-repository"): string {
	return by === "personal-repository" ? "Overridden by your chop for this repository" : "Overridden by your chop for every repository";
}

/** The quiet line about the repository file of a main checkout: none when it was read, a hint when it is missing, the reason when it is damaged. */
export function describeChopsFile(file: ChopsFileState, path: string): { tone: "hint" | "problem"; text: string } | null {
	switch (file.state) {
		case "read":
			return null;
		case "missing":
			return { tone: "hint", text: `A repository can share chops with everyone who works on it in ${path}. Its main checkout has none.` };
		case "damaged":
			return { tone: "problem", text: `The app could not use ${path}: ${file.message} Your own chops still work.` };
	}
}

/** One chop as the "+" menu, the palette, or "Insert chop" offers it. */
export interface ChopEntry {
	/** The chop's name, which the request names. */
	name: string;
	kind: ChopKind;
	/** What its tooltip says: the description, or the text's first line when it has none. */
	title: string;
	source: ChopSource;
}

/** The first line of a chop's text, with an ellipsis when more follows. */
function firstLine(text: string): string {
	const [first = "", ...rest] = text.split("\n");
	return rest.length > 0 ? `${first} ...` : first;
}

const entryOf = (chop: ListedChop): ChopEntry => ({ name: chop.name, kind: chop.kind, title: chop.description !== "" ? chop.description : firstLine(chop.text), source: chop.source });

/** The chops of a list, commands and prompts, in listed order, for the "+" menu and the palette. None until the list was read. */
export function chopEntries(list: ChopList | null | undefined): ChopEntry[] {
	return listedChops(list).map(entryOf);
}

/** The command chops of a list, in listed order, for "Insert chop". */
export function commandChopEntries(list: ChopList | null | undefined): ChopEntry[] {
	return commandChops(list).map(entryOf);
}

/**
 * What choosing a chop does: run a command, send a prompt to an agent, or,
 * with no agent saved in Settings, copy the prompt.
 */
export type ChopAction = "run" | "send" | "copy";

export function chopAction(kind: ChopKind, agentsSaved: number): ChopAction {
	if (kind === "command") return "run";
	return agentsSaved > 0 ? "send" : "copy";
}

/** The label of a chop's palette entry. */
export function runChopLabel(name: string, action: ChopAction = "run"): string {
	switch (action) {
		case "run":
			return `Run chop: ${name}`;
		case "send":
			return `Send prompt: ${name}`;
		case "copy":
			return `Copy prompt: ${name}`;
	}
}

/** The label of a chop's button in an empty session pane. */
export function chopButtonLabel(name: string, action: ChopAction): string {
	switch (action) {
		case "run":
			return `Run ${name}`;
		case "send":
			return `Send ${name}`;
		case "copy":
			return `Copy ${name}`;
	}
}

/** The tooltip of a chop in the "+" menu or an empty session pane. */
export function chopTitle(entry: Pick<ChopEntry, "title">, action: ChopAction): string {
	switch (action) {
		case "run":
			return entry.title;
		case "send":
			return `Prompt for an agent: ${entry.title}`;
		case "copy":
			return `No agent is saved in Settings, Agents, so this copies the prompt: ${entry.title}`;
	}
}

/** The toast after a prompt was put on the clipboard. */
export function describePromptCopied(name: string): string {
	return `${name} copied. Paste it where you want it.`;
}

/** The toast after a prompt went to a running agent, or to a new one once it was ready. */
export function describePromptSent(chop: string | null, session: string): string {
	return chop === null ? `Prompt sent to ${session}.` : `${chop} sent to ${session}.`;
}

/** What the Send prompt dialog says when the picked agent waits on the person. */
export const PROMPT_WAITS_WARNING =
	"This agent is waiting for you, such as for an approval. The prompt and its Enter would go into that answer. Answer it first, or pick another agent.";

/** What the "New agent" choice of the Send prompt dialog says. */
export function describeNewAgentChoice(agent: string | null): string {
	return agent === null ? "A new agent" : `A new ${agent}`;
}

/** The label of a chop in a session's menu. */
export function insertChopLabel(name: string): string {
	return `Insert chop: ${name}`;
}

export const CHOPS_NOT_READ = "The chops of this repository are being read.";
export const SESSION_ENDED_FOR_CHOP = "The session has ended, so nothing can be typed into it.";
export const NO_CHOPS_FOR_SESSION = "This repository has no command chops. Add some in Settings, Chops.";

/** What the dialog before a repository chop runs says. */
export function describeChopApproval(chop: Pick<ListedChop, "name" | "kind"> & { agent?: string | null }, path: string, target: string | null = null): { title: string; text: string; submit: string } {
	if (chop.kind === "prompt") {
		// A new agent is named, since the file picks it: the chop's, or the first saved one.
		const where = target !== null ? target : chop.agent ? `a new ${chop.agent}` : "a new session of your first saved agent";
		return {
			title: `Send ${chop.name} from the repository?`,
			text: `This prompt comes from ${path}, which anyone who can change the repository can change. It goes to ${where} exactly as shown, and is submitted. The app asks the first time a chop's text is used, and again whenever it changes.`,
			submit: "Send",
		};
	}
	return {
		title: `Run ${chop.name} from the repository?`,
		text: `This chop comes from ${path}, which anyone who can change the repository can change. It runs in your shell exactly as shown. The app asks the first time a chop's text runs, and again whenever it changes.`,
		submit: "Run",
	};
}

const INSERT_PREFIX = "insert-chop:";

/**
 * The entries of a session chip's menu: "Insert chop" for each command chop
 * of the session's repository, which types its text into the session with
 * no Enter. Disabled, with the reason, while the session has ended. With no
 * chop to offer, one disabled entry says why.
 */
export function sessionChipMenuItems(running: boolean, list: ChopList | null | undefined): WorktreeMenuItem[] {
	const chops = commandChopEntries(list);
	if (chops.length === 0) {
		const note = list == null ? CHOPS_NOT_READ : list.outcome === "listed" ? NO_CHOPS_FOR_SESSION : list.message;
		return [{ id: `${INSERT_PREFIX}`, label: "Insert chop", disabled: true, note, title: note }];
	}
	return chops.map(chop => ({
		id: `${INSERT_PREFIX}${chop.name}`,
		label: insertChopLabel(chop.name),
		disabled: !running,
		note: running ? null : SESSION_ENDED_FOR_CHOP,
		title: running ? `Type it into the session without running it: ${chop.title}` : SESSION_ENDED_FOR_CHOP,
	}));
}

/** The chop a session chip's menu entry inserts, by name, or null for any other entry. */
export function sessionChipMenuChop(id: WorktreeMenuItemId): string | null {
	return id.startsWith(INSERT_PREFIX) && id.length > INSERT_PREFIX.length ? id.slice(INSERT_PREFIX.length) : null;
}

/** The name of a session chip's menu, for assistive technology. */
export function describeSessionChipMenu(name: string): string {
	return `Actions for ${name}`;
}
