import {
	CHOP_LIMIT, type ChopKind, type ChopList, type ChopSource, type ChopsFileState, type ListedChop, type PersonalChop, chopProblem, commandChops, listedChops, normalizeChopText, readPersonalChops,
	sameChopName, samePersonalChops,
} from "../shared/chops";
import { type ChopArrangement, type ChopRename, arrangeChops } from "../shared/chop-order";
import type { SoundChoice } from "../shared/sound-setting";
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
	/** What plays when it starts, or null for none. Settings, Chops keeps it as saved; the chops panel's form chooses it. */
	sound: SoundChoice | null;
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
	return [...drafts, { key: nextKey(), name: "", kind: "command", text: "", description: "", agent: null, repository, sound: null }];
}

export function editChopDraft(drafts: readonly ChopDraft[], key: string, change: ChopDraftChange): ChopDraft[] {
	return drafts.map(draft => draft.key === key ? { ...draft, ...change } : draft);
}

export function removeChopDraft(drafts: readonly ChopDraft[], key: string): ChopDraft[] {
	return drafts.filter(draft => draft.key !== key);
}

/** A row, or the chops panel's form, as it would be saved: the name cleaned as a session name, the description trimmed, the agent only for a prompt. */
export function chopOf(draft: Omit<ChopDraft, "key">): PersonalChop {
	return {
		name: cleanSessionName(draft.name) ?? "",
		kind: draft.kind,
		text: normalizeChopText(draft.text),
		description: draft.description.trim(),
		agent: draft.kind === "prompt" ? draft.agent : null,
		repository: draft.repository,
		sound: draft.sound,
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

/** The switches of Settings, Chops: "Use chops" and "Play each chop's sound". */
export interface ChopsSwitches {
	useChops: boolean;
	playChopSounds: boolean;
}

/**
 * What Settings, Chops saves, from the rows and its switches: each switch
 * that differs from what is saved, and the rows when they differ and can be
 * saved. The switches save on their own while the rows are as saved, so
 * chops, or their sounds, can always be turned off; with rows changed but
 * not savable, nothing is. Null when there is nothing to save.
 */
export function chopsSectionChange(model: Pick<ChopsDraftModel, "chops" | "canSave">, saved: readonly PersonalChop[], switches: ChopsSwitches, savedSwitches: ChopsSwitches): (Partial<ChopsSwitches> & { chops?: PersonalChop[] }) | null {
	const changed: Partial<ChopsSwitches> = {};
	if (switches.useChops !== savedSwitches.useChops) changed.useChops = switches.useChops;
	if (switches.playChopSounds !== savedSwitches.playChopSounds) changed.playChopSounds = switches.playChopSounds;
	if (model.canSave) return { ...changed, chops: model.chops };
	if (Object.keys(changed).length > 0 && samePersonalChops(model.chops, saved)) return changed;
	return null;
}

/**
 * The renames a save of personal chops makes, so each renamed chop keeps
 * its place and star in the chops panel (`renameInArrangements`). Each pair
 * is a chop as saved and as it will be saved; `next` is the whole list as
 * it will be saved. A chop for every repository is not renamed where a
 * chop for one repository in `next` has its old or its new name, since
 * that one is listed there instead.
 */
export function chopRenames(next: readonly PersonalChop[], pairs: readonly { from: Pick<PersonalChop, "name" | "repository">; to: Pick<PersonalChop, "name"> }[]): ChopRename[] {
	return pairs.filter(({ from, to }) => to.name !== "" && from.name !== to.name).map(({ from, to }) => ({
		repository: from.repository,
		from: from.name,
		to: to.name,
		...(from.repository === null ? { shadowed: [...new Set(next.filter(chop => chop.repository !== null && (sameChopName(chop.name, from.name) || sameChopName(chop.name, to.name))).map(chop => chop.repository!))] } : {}),
	}));
}

/**
 * The renames Settings, Chops would save: rows drawn from what is saved
 * (`savedDrafts`, in the order of `saved`) that are still there, by key,
 * with another name.
 */
export function chopsSectionRenames(saved: readonly PersonalChop[], savedDrafts: readonly ChopDraft[], drafts: readonly ChopDraft[]): ChopRename[] {
	const pairs = drafts.flatMap(draft => {
		const index = savedDrafts.findIndex(row => row.key === draft.key);
		return index === -1 || saved[index] === undefined ? [] : [{ from: saved[index]!, to: chopOf(draft) }];
	});
	return chopRenames(drafts.map(chopOf), pairs);
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

/** The most chop buttons an empty session pane shows. */
export const EMPTY_PANE_CHOP_LIMIT = 3;

/** The button in an empty session pane that opens the chops panel when there are more chops than buttons. */
export const ALL_CHOPS_LABEL = "All chops";
export const ALL_CHOPS_HINT = "Show the chops panel, with every chop of this repository";

/**
 * The chops an empty session pane offers: at most `limit`, both kinds, in
 * the chops panel's order for the repository (`arrangeChops`), so the
 * favorites come first, then the rest. `more` says whether some were left
 * out, for "All chops". None until the list was read.
 */
export function emptyPaneChops(list: ChopList | null | undefined, arrangement: ChopArrangement, limit = EMPTY_PANE_CHOP_LIMIT): { chops: ChopEntry[]; more: boolean } {
	const listed = listedChops(list);
	const chops = arrangeChops(listed, arrangement).slice(0, limit).map(({ chop }) => entryOf(chop));
	return { chops, more: listed.length > limit };
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

/*
 * Making, changing, and deleting the person's own chops from the chops
 * panel. The panel saves the whole personal list, as Settings, Chops does,
 * through the same preference, so both show the same list. A chop from
 * `.timber/chops.json` is never a target: the app only reads that file.
 */

/** What the chops panel's form holds: a chop as typed, with its kind and the repository it is for. */
export type ChopForm = Omit<ChopDraft, "key">;

/** One personal chop, by the group it is in (its repository, or null for every repository) and its name, matched ignoring case. */
export interface ChopTarget {
	name: string;
	repository: string | null;
}

/** An empty form of a kind, for the repository given, or for every repository with null. */
export function blankChopForm(kind: ChopKind, repository: string | null): ChopForm {
	return { name: "", kind, text: "", description: "", agent: null, repository, sound: null };
}

/**
 * The saved personal chop a listed chop of `repository` is, or null for a
 * chop from the repository file, which the panel never changes.
 */
export function chopTargetOf(chop: Pick<ListedChop, "name" | "source">, repository: string): ChopTarget | null {
	switch (chop.source) {
		case "personal-repository":
			return { name: chop.name, repository };
		case "personal-every":
			return { name: chop.name, repository: null };
		case "repository-file":
			return null;
	}
}

/** Where a target is in the saved personal chops, or -1. */
export function personalChopIndex(personal: readonly PersonalChop[], target: ChopTarget): number {
	return personal.findIndex(chop => chop.repository === target.repository && sameChopName(chop.name, target.name));
}

/** The form that edits a saved personal chop, or null when it is not saved now. */
export function chopFormOf(personal: readonly PersonalChop[], target: ChopTarget): ChopForm | null {
	const chop = personal[personalChopIndex(personal, target)];
	return chop === undefined ? null : { ...chop };
}

export type ChopSaveCheck = { ok: true; chops: PersonalChop[]; chop: PersonalChop } | { ok: false; problem: string };

/**
 * The personal chops with the form saved: in the place of `original`, so
 * its order is kept, or at the end for a new chop. The rules are the ones
 * Settings and the main process hold: a clean name that no other chop of the
 * same group has, ignoring case, a text within its limit with no control
 * characters, and at most `CHOP_LIMIT` chops. `personal` is what is saved
 * when the save starts, so a change made elsewhere is never undone.
 */
export function chopsWithSaved(personal: readonly PersonalChop[], original: ChopTarget | null, form: ChopForm): ChopSaveCheck {
	const index = original === null ? -1 : personalChopIndex(personal, original);
	if (original !== null && index === -1) return { ok: false, problem: `${original.name} is no longer saved. It may have been changed in Settings. Cancel and open it again.` };
	const chop = chopOf(form);
	const others = personal.filter((other, at) => at !== index && other.repository === chop.repository).map(other => other.name);
	const problem = chopProblem(chop, others);
	if (problem !== null) return { ok: false, problem };
	const chops = index === -1 ? [...personal, chop] : personal.map((other, at) => at === index ? chop : other);
	if (chops.length > CHOP_LIMIT) return { ok: false, problem: `You have ${CHOP_LIMIT} chops, the most the app keeps. Delete one first.` };
	// The main process reads the list whole or not at all: check it as it will.
	if (readPersonalChops(chops) === undefined) return { ok: false, problem: "Your saved chops could not be read as they are. Open Settings, Chops to fix them." };
	return { ok: true, chops, chop };
}

/** The personal chops without the target, or null when it is not saved now. */
export function chopsWithout(personal: readonly PersonalChop[], target: ChopTarget): PersonalChop[] | null {
	const index = personalChopIndex(personal, target);
	return index === -1 ? null : personal.filter((_chop, at) => at !== index);
}

/**
 * What the form says, without stopping the save, about the chops of the same
 * name in the repository it is listed for: a personal chop for this
 * repository takes the place of one for every repository, and either takes
 * the place of the repository file's.
 */
export function chopFormNotes(form: ChopForm, list: ChopList | null | undefined, repository: string, original: ChopTarget | null): string[] {
	const name = cleanSessionName(form.name);
	if (name === null || list?.outcome !== "listed") return [];
	const isOriginal = (chop: ListedChop) => original !== null && sameChopName(chop.name, original.name) && chopTargetOf(chop, repository)?.repository === original.repository;
	const same = list.chops.filter(chop => sameChopName(chop.name, name) && !isOriginal(chop));
	const notes: string[] = [];
	const fromFile = same.some(chop => chop.source === "repository-file") || list.overridden.some(chop => sameChopName(chop.name, name));
	if (fromFile && (form.repository === null || form.repository === repository)) notes.push(`It takes the place of the chop called ${name} in ${list.path} here. That file is not changed.`);
	if (form.repository === repository && same.some(chop => chop.source === "personal-every")) notes.push(`It takes the place of your chop called ${name} for every repository, here.`);
	if (form.repository === null && same.some(chop => chop.source === "personal-repository")) notes.push(`Your chop called ${name} for this repository stays in its place here.`);
	return notes;
}

/** What the panel says before a chop is deleted. */
export function describeChopDelete(target: ChopTarget, repositoryName: string): string {
	const where = target.repository === null ? "every repository" : repositoryName;
	return `Delete ${target.name}? It goes from your chops for ${where}, here and in Settings.`;
}

/** Why the panel cannot change chops now, or null: the saved settings could not be read, so saving would write the defaults over them. */
export function chopEditBlockedReason(preferencesProblem: string | null): string | null {
	return preferencesProblem === null ? null : "The saved settings could not be read, so chops cannot be changed here. Open Settings to see why.";
}

/** The choices of the panel form's "For" field: every repository, or the repository it was opened for. */
export function panelChopScopeOptions(repository: { path: string; name: string }): ChopScopeOption[] {
	return [{ value: repository.path, label: `This repository (${repository.name})` }, { value: "", label: "Every repository" }];
}

/** What the read-only view of a chop from the repository file says. */
export function describeFileChopView(path: string): string {
	return `From ${path}, which the app only reads. To change it here, make your own chop with the same name: it takes the place of this one.`;
}
