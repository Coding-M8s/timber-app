import { CHOP_LIMIT, type ChopKind, type ChopSource, type ChopsFileState, type PersonalChop, chopProblem, normalizeChopText, samePersonalChops } from "../shared/chops";
import { cleanSessionName } from "../shared/terminal";

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

/** The quiet line about the repository file of a worktree: none when it was read, a hint when it is missing, the reason when it is damaged. */
export function describeChopsFile(file: ChopsFileState, path: string): { tone: "hint" | "problem"; text: string } | null {
	switch (file.state) {
		case "read":
			return null;
		case "missing":
			return { tone: "hint", text: `A repository can share chops with everyone who works on it in ${path}. This worktree has none.` };
		case "damaged":
			return { tone: "problem", text: `The app could not use ${path}: ${file.message} Your own chops still work.` };
	}
}
