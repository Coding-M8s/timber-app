import { SESSION_NAME_LIMIT, cleanSessionName } from "./terminal";

/**
 * Chops: saved, named things to run in a worktree. A command chop is shell
 * text, such as `bun test`. A prompt chop is text for an agent. Pure, so the
 * rules can be tested without a window: the main process reads the
 * repository's file (src/bun/chops.ts), and the preferences keep the
 * person's own.
 *
 * Chops come from two places. Personal chops are saved in the app's
 * settings, for every repository or for one. A repository may share chops in
 * `.timber/chops.json`, committed with its code. The app reads that file and
 * never writes it, and never creates its folder. When names clash, ignoring
 * case, a personal chop for this repository wins over a personal chop for
 * every repository, which wins over the file's.
 *
 * The text is kept exactly as saved, apart from Windows line endings, which
 * become `\n`. It may hold line breaks and tabs but no other control
 * characters, and no bidirectional overrides, because it is shown before it
 * runs and sent to a terminal as a bracketed paste: an escape sequence in it
 * could end the paste early, and an override could hide what it says.
 */

export const CHOP_KINDS = ["command", "prompt"] as const;
export type ChopKind = typeof CHOP_KINDS[number];

export interface Chop {
	/** Clean as a session name (`cleanSessionName`), since it names the session it starts. Unique among its group, ignoring case. */
	name: string;
	kind: ChopKind;
	/** What runs or is sent, as saved. Never empty, at most `CHOP_TEXT_LIMIT` characters. */
	text: string;
	/** One line that says what it does, or "" for none. */
	description: string;
	/**
	 * For a prompt, the name of the agent from Settings, Agents that gets it,
	 * or null for the first saved agent. A name the person has no agent for
	 * is still a valid chop: running it says so, and never falls back to
	 * another agent. Always null for a command.
	 */
	agent: string | null;
}

export interface PersonalChop extends Chop {
	/** The primary checkout of the repository it is for, or null for every repository. */
	repository: string | null;
}

/** Where a listed chop comes from. */
export type ChopSource = "personal-every" | "personal-repository" | "repository-file";

export interface ListedChop extends Chop {
	source: ChopSource;
}

/** The repository file, relative to a worktree's folder, with `/` between parts. */
export const CHOPS_FILE = ".timber/chops.json";
export const CHOPS_FILE_VERSION = 1;
/** The most chops the personal list, or the repository file, can hold. */
export const CHOP_LIMIT = 100;
/** The longest text a chop can have, in characters. */
export const CHOP_TEXT_LIMIT = 10_000;
/** The longest description, in characters. */
export const CHOP_DESCRIPTION_LIMIT = 200;
/** The largest repository file the app reads, in bytes. */
export const CHOPS_FILE_BYTES = 256 * 1024;

const KIND_WORDS: Record<ChopKind, string> = { command: "Command", prompt: "Prompt" };

/** "Command" or "Prompt". */
export function chopKindWord(kind: ChopKind): string {
	return KIND_WORDS[kind];
}

// Not the machine's locale: two people, or the main process and the window, must agree on a clash.
const folded = (name: string) => name.normalize("NFC").toLowerCase();

/** Whether two chop names are the same name, ignoring case. */
export function sameChopName(one: string, other: string): boolean {
	return folded(one) === folded(other);
}

/**
 * Line breaks and tabs only: every other control character (C0, DEL, C1),
 * every invisible format character (`\p{Cf}`: bidirectional overrides and
 * isolates, zero-width spaces, tag characters) except the zero-width joiner
 * that emoji are made with, the line and paragraph separators, and lone
 * surrogates. What a chop says must be what the person sees before it runs.
 */
const FORBIDDEN_IN_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]|(?!\u200d)\p{Cf}/u;
/** The same, and no line breaks or tabs either, for a one-line description. */
const FORBIDDEN_IN_LINE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]|(?!\u200d)\p{Cf}/u;

/** The text with Windows line endings made `\n`, as it is kept. */
export function normalizeChopText(text: string): string {
	return text.replace(/\r\n/g, "\n");
}

/**
 * What is wrong with one chop, or null when it can be saved. `others` are the
 * names before it in its group. The name must already be clean, so a name
 * read from a file is never quietly changed.
 */
export function chopProblem(chop: Chop, others: readonly string[]): string | null {
	const name = cleanSessionName(chop.name);
	if (name === null) return "Give the chop a name.";
	if (name !== chop.name) return `The name has extra spaces or characters a name cannot hold, or is longer than ${SESSION_NAME_LIMIT} characters.`;
	if (others.some(other => sameChopName(other, name))) return `Another chop is already called "${name}".`;
	if (!CHOP_KINDS.includes(chop.kind)) return "The kind must be command or prompt.";
	if (chop.text.trim() === "") return chop.kind === "command" ? "Type the command." : "Type the prompt.";
	if (chop.text.length > CHOP_TEXT_LIMIT) return `The text is longer than ${CHOP_TEXT_LIMIT} characters.`;
	if (chop.text.includes("\r")) return "The text has a carriage return that is not part of a line break.";
	if (FORBIDDEN_IN_TEXT.test(chop.text) || !chop.text.isWellFormed()) return "The text has a control or invisible character. Only line breaks and tabs are allowed.";
	if (chop.description.length > CHOP_DESCRIPTION_LIMIT) return `The description is longer than ${CHOP_DESCRIPTION_LIMIT} characters.`;
	if (FORBIDDEN_IN_LINE.test(chop.description) || !chop.description.isWellFormed()) return "The description must be one line, with no control characters.";
	if (chop.kind === "command" && chop.agent !== null) return "Only a prompt goes to an agent. Remove the agent from this command.";
	if (chop.agent !== null && cleanSessionName(chop.agent) !== chop.agent) return "The agent name is not one an agent can have.";
	return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * One chop from outside, before its problems are checked: the fields must
 * have the right types, and absent optional ones are filled in. Text has its
 * Windows line endings made `\n`.
 */
function readChopFields(value: unknown): { ok: true; chop: Chop } | { ok: false; message: string } {
	if (!isRecord(value)) return { ok: false, message: "It is not an object with a name, a kind, and a text." };
	const { name, kind, text, description = "", agent = null } = value;
	if (typeof name !== "string") return { ok: false, message: "The name is missing or not text." };
	if (typeof kind !== "string" || !CHOP_KINDS.includes(kind as ChopKind)) return { ok: false, message: "The kind must be \"command\" or \"prompt\"." };
	if (typeof text !== "string") return { ok: false, message: "The text is missing or not text." };
	if (typeof description !== "string") return { ok: false, message: "The description is not text." };
	if (agent !== null && typeof agent !== "string") return { ok: false, message: "The agent is not text." };
	return { ok: true, chop: { name, kind: kind as ChopKind, text: normalizeChopText(text), description, agent } };
}

/** The group a personal chop's name must be unique in: its repository, or every repository. */
const groupOf = (chop: PersonalChop) => chop.repository;

function readPersonalChop(value: unknown, before: readonly PersonalChop[]): PersonalChop | null {
	if (!isRecord(value)) return null;
	const { repository = null } = value;
	if (repository !== null && (typeof repository !== "string" || repository === "")) return null;
	const fields = readChopFields(value);
	if (!fields.ok) return null;
	const chop: PersonalChop = { ...fields.chop, repository };
	const others = before.filter(other => groupOf(other) === repository).map(other => other.name);
	return chopProblem(chop, others) === null ? chop : null;
}

/**
 * The personal chops from a save, or undefined when the value is not a list
 * of them. Taken whole or not at all, so a save never keeps half of what was
 * asked.
 */
export function readPersonalChops(value: unknown): PersonalChop[] | undefined {
	if (!Array.isArray(value) || value.length > CHOP_LIMIT) return undefined;
	const chops: PersonalChop[] = [];
	for (const entry of value) {
		const chop = readPersonalChop(entry, chops);
		if (chop === null) return undefined;
		chops.push(chop);
	}
	return chops;
}

/**
 * The personal chops that can be read from a settings file that `readPersonalChops`
 * refused: every readable entry, up to the limit, so one damaged entry,
 * edited by hand, does not cost the others at the next save.
 */
export function salvagePersonalChops(value: unknown): PersonalChop[] | undefined {
	if (!Array.isArray(value)) return undefined;
	const chops: PersonalChop[] = [];
	for (const entry of value) {
		const chop = readPersonalChop(entry, chops);
		if (chop !== null) chops.push(chop);
		if (chops.length === CHOP_LIMIT) break;
	}
	return chops;
}

/** The personal chops as written to the settings file. Optional fields are left out when empty. */
export function writePersonalChops(chops: readonly PersonalChop[]): Record<string, unknown>[] {
	return chops.map(chop => ({
		name: chop.name,
		kind: chop.kind,
		text: chop.text,
		...(chop.description === "" ? {} : { description: chop.description }),
		...(chop.agent === null ? {} : { agent: chop.agent }),
		...(chop.repository === null ? {} : { repository: chop.repository }),
	}));
}

export function sameChop(one: Chop, other: Chop): boolean {
	return one.name === other.name && one.kind === other.kind && one.text === other.text && one.description === other.description && one.agent === other.agent;
}

export function samePersonalChops(one: readonly PersonalChop[], other: readonly PersonalChop[]): boolean {
	return one.length === other.length && one.every((chop, index) => sameChop(chop, other[index]!) && chop.repository === other[index]!.repository);
}

export type ChopsFileReading = { ok: true; chops: Chop[] } | { ok: false; message: string };

/**
 * The text of a repository's `.timber/chops.json`, read whole or not at all:
 * a file that is not JSON, not this version, or has one entry that cannot be
 * used is damaged, with a reason that names the entry. Keys the app does not
 * know are passed over, so a newer file still reads. The reason never quotes
 * the file, so a file that is something else says nothing of what it holds.
 */
export function parseChopsFile(text: string): ChopsFileReading {
	let value: unknown;
	try {
		value = JSON.parse(text.startsWith("\ufeff") ? text.slice(1) : text);
	} catch {
		return { ok: false, message: "It is not JSON." };
	}
	if (!isRecord(value)) return { ok: false, message: "It is not a JSON object with \"version\" and \"chops\"." };
	if (value.version !== CHOPS_FILE_VERSION) return { ok: false, message: `Its "version" is not ${CHOPS_FILE_VERSION}.` };
	const listed = value.chops;
	if (!Array.isArray(listed)) return { ok: false, message: "Its \"chops\" is not a list." };
	if (listed.length > CHOP_LIMIT) return { ok: false, message: `It has more than ${CHOP_LIMIT} chops.` };
	const chops: Chop[] = [];
	for (const [index, entry] of listed.entries()) {
		const fields = readChopFields(entry);
		const named = isRecord(entry) && typeof entry.name === "string" && cleanSessionName(entry.name) !== null ? ` ("${cleanSessionName(entry.name)}")` : "";
		const which = `Chop ${index + 1}${named}`;
		if (!fields.ok) return { ok: false, message: `${which}: ${fields.message}` };
		const problem = chopProblem(fields.chop, chops.map(chop => chop.name));
		if (problem !== null) return { ok: false, message: `${which}: ${problem}` };
		chops.push(fields.chop);
	}
	return { ok: true, chops };
}

/** A chop from the repository file that a personal chop of the same name takes the place of. */
export interface OverriddenChop extends ListedChop {
	source: "repository-file";
	/** Which personal chop wins. */
	by: "personal-every" | "personal-repository";
}

export interface MergedChops {
	/** What a worktree offers, in order: personal for this repository, personal for every repository, then the file's, each in saved order. */
	chops: ListedChop[];
	/** The file's chops that a personal chop overrides, in the file's order. */
	overridden: OverriddenChop[];
}

/**
 * The chops a worktree of `repository` offers. A personal chop for this
 * repository takes the place of a personal chop for every repository with
 * the same name, which is then left out, and either kind of personal chop
 * takes the place of a file chop with the same name, which is listed in
 * `overridden`. Personal chops for other repositories are left out.
 */
export function mergeChops(personal: readonly PersonalChop[], repository: string, fileChops: readonly Chop[]): MergedChops {
	const strip = ({ repository: _repository, ...chop }: PersonalChop): Chop => chop;
	const forHere = personal.filter(chop => chop.repository === repository).map(chop => ({ ...strip(chop), source: "personal-repository" as const }));
	const forEvery = personal
		.filter(chop => chop.repository === null && !forHere.some(other => sameChopName(other.name, chop.name)))
		.map(chop => ({ ...strip(chop), source: "personal-every" as const }));
	const mine = [...forHere, ...forEvery];
	const chops: ListedChop[] = [...mine];
	const overridden: OverriddenChop[] = [];
	for (const chop of fileChops) {
		const winner = mine.find(other => sameChopName(other.name, chop.name));
		if (winner) overridden.push({ ...chop, source: "repository-file", by: winner.source as OverriddenChop["by"] });
		else chops.push({ ...chop, source: "repository-file" });
	}
	return { chops, overridden };
}

/** How the repository file stood when the chops were listed. */
export type ChopsFileState =
	| { state: "missing" }
	| { state: "read" }
	| { state: "damaged"; message: string };

/** A worktree's chops: the repository file is read anew for every request. */
export interface ChopsRequest {
	/** The primary checkout of a repository in the list. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it, not its id. */
	worktree: string;
}

export type ChopList =
	| ({ outcome: "listed"; file: ChopsFileState; /** The full path of the repository file in this worktree, whether or not it is there. */ path: string } & MergedChops)
	/** The repository or worktree is not one Timber lists right now, or its folder is missing. */
	| { outcome: "not-listed"; message: string }
	| { outcome: "failed"; message: string };
