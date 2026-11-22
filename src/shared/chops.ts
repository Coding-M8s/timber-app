import type { FileChopSound } from "./chop-sounds";
import { isSafeLine, isSafeText } from "./safe-text";
import { type SoundChoice, defaultSoundChoice, readSoundChoice, sameSoundChoice, writeSoundChoice } from "./sound-setting";
import { type OpenTerminalResult, type PasteResult, SESSION_NAME_LIMIT, type TerminalSession, cleanSessionName } from "./terminal";

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
 * A chop may have a sound, which plays when it starts. It is never read
 * from the repository file: a personal chop keeps its own, and a file
 * chop's is kept in the app's settings (./chop-sounds.ts).
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
	/** What plays when it starts, or null for none. */
	sound: SoundChoice | null;
}

/** Where a listed chop comes from. */
export type ChopSource = "personal-every" | "personal-repository" | "repository-file";

export interface ListedChop extends Chop {
	source: ChopSource;
	/** What plays when it starts, or null for none: a personal chop's own, or the one kept for a file chop (./chop-sounds.ts). */
	sound: SoundChoice | null;
}

/** The repository file, relative to the main checkout's folder, with `/` between parts. */
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
	if (!isSafeText(chop.text)) return "The text has a control or invisible character. Only line breaks and tabs are allowed.";
	if (chop.description.length > CHOP_DESCRIPTION_LIMIT) return `The description is longer than ${CHOP_DESCRIPTION_LIMIT} characters.`;
	if (!isSafeLine(chop.description)) return "The description must be one line, with no control characters.";
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

/**
 * One personal chop, or null when it cannot be read. A missing or null sound
 * is none. A sound that cannot be read refuses the chop, or, to salvage a
 * settings file, plays the chime, since a sound was asked for.
 */
function readPersonalChop(value: unknown, before: readonly PersonalChop[], salvage = false): PersonalChop | null {
	if (!isRecord(value)) return null;
	const { repository = null, sound: savedSound = null } = value;
	if (repository !== null && (typeof repository !== "string" || repository === "")) return null;
	const fields = readChopFields(value);
	if (!fields.ok) return null;
	let sound: SoundChoice | null = null;
	if (savedSound !== null) {
		const read = readSoundChoice(savedSound);
		if (read === undefined && !salvage) return null;
		sound = read ?? defaultSoundChoice();
	}
	const chop: PersonalChop = { ...fields.chop, repository, sound };
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
		const chop = readPersonalChop(entry, chops, true);
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
		...(chop.sound === null ? {} : { sound: writeSoundChoice(chop.sound) }),
	}));
}

export function sameChop(one: Chop, other: Chop): boolean {
	return one.name === other.name && one.kind === other.kind && one.text === other.text && one.description === other.description && one.agent === other.agent;
}

export function samePersonalChops(one: readonly PersonalChop[], other: readonly PersonalChop[]): boolean {
	return one.length === other.length && one.every((chop, index) => sameChop(chop, other[index]!) && chop.repository === other[index]!.repository && sameChopSound(chop.sound, other[index]!.sound));
}

/** Whether two chop sounds are the same, null for none. */
export function sameChopSound(one: SoundChoice | null, other: SoundChoice | null): boolean {
	return one === null || other === null ? one === other : sameSoundChoice(one, other);
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
	/** What a repository offers, in order: personal for this repository, personal for every repository, then the file's, each in saved order. */
	chops: ListedChop[];
	/** The file's chops that a personal chop overrides, in the file's order. */
	overridden: OverriddenChop[];
}

/**
 * The chops `repository` offers, in every worktree. A personal chop for this
 * repository takes the place of a personal chop for every repository with
 * the same name, which is then left out, and either kind of personal chop
 * takes the place of a file chop with the same name, which is listed in
 * `overridden`. Personal chops for other repositories are left out. Each
 * chop has its sound: a personal chop's own, and a file chop's from
 * `fileSounds`, the ones kept for this repository's file.
 */
export function mergeChops(personal: readonly PersonalChop[], repository: string, fileChops: readonly Chop[], fileSounds: readonly FileChopSound[] = []): MergedChops {
	const strip = ({ repository: _repository, ...chop }: PersonalChop): Omit<PersonalChop, "repository"> => chop;
	const forHere = personal.filter(chop => chop.repository === repository).map(chop => ({ ...strip(chop), source: "personal-repository" as const }));
	const forEvery = personal
		.filter(chop => chop.repository === null && !forHere.some(other => sameChopName(other.name, chop.name)))
		.map(chop => ({ ...strip(chop), source: "personal-every" as const }));
	const mine = [...forHere, ...forEvery];
	const chops: ListedChop[] = [...mine];
	const overridden: OverriddenChop[] = [];
	for (const chop of fileChops) {
		const winner = mine.find(other => sameChopName(other.name, chop.name));
		const sound = fileSounds.find(entry => sameChopName(entry.name, chop.name))?.sound ?? null;
		if (winner) overridden.push({ ...chop, source: "repository-file", sound, by: winner.source as OverriddenChop["by"] });
		else chops.push({ ...chop, source: "repository-file", sound });
	}
	return { chops, overridden };
}

/** How the repository file stood when the chops were listed. */
export type ChopsFileState =
	| { state: "missing" }
	| { state: "read" }
	| { state: "damaged"; message: string };

/** A repository's chops: the repository file is read anew from its main checkout for every request. */
export interface ChopsRequest {
	/** The primary checkout of a repository in the list. */
	repository: string;
}

export type ChopList =
	| ({ outcome: "listed"; file: ChopsFileState; /** The full path of the repository file in the main checkout, whether or not it is there. */ path: string } & MergedChops)
	/** The repository is not in the list right now, or its main checkout's folder is missing. */
	| { outcome: "not-listed"; message: string }
	| { outcome: "failed"; message: string };

/** The listed chops "Insert chop" offers: the commands, in listed order. */
export function commandChops(list: ChopList | null | undefined): ListedChop[] {
	return list?.outcome === "listed" ? list.chops.filter(chop => chop.kind === "command") : [];
}

/** The listed chops a "+" menu or the palette offers: commands to run and prompts to send, in listed order. */
export function listedChops(list: ChopList | null | undefined): ListedChop[] {
	return list?.outcome === "listed" ? list.chops : [];
}

/** The chop of a list with this name, ignoring case, or null. */
export function findListedChop(chops: readonly ListedChop[], name: string): ListedChop | null {
	return chops.find(chop => sameChopName(chop.name, name)) ?? null;
}

/**
 * Approvals of repository chops, kept app-side by the primary checkout of
 * the repository: for each, the digests (`chopDigest`) of the texts the
 * person agreed to run. A text that changed has another digest, so it asks
 * again. A digest says nothing of the text.
 */
export type ChopApprovals = Readonly<Record<string, readonly string[]>>;

/** The most approvals kept for one repository. The oldest go first. */
export const CHOP_APPROVAL_LIMIT = 200;

/**
 * What a digest is made of: the kind and the text, so an approved prompt's
 * text never runs unasked as a command, and for a prompt the agent it names,
 * so a file cannot point an approved prompt at another agent without asking
 * again.
 */
export function chopDigestInput(chop: Pick<Chop, "kind" | "text"> & { agent?: string | null }): string {
	return chop.kind === "prompt" ? `${chop.kind}\0${chop.text}\0${chop.agent ?? ""}` : `${chop.kind}\0${chop.text}`;
}

const DIGEST = /^[0-9a-f]{64}$/;

/** Whether a repository chop may run without asking: a personal chop always, a file chop once its digest was approved for this repository. */
export function isChopApproved(approvals: ChopApprovals, repository: string, chop: Pick<ListedChop, "source">, digest: string): boolean {
	if (chop.source !== "repository-file") return true;
	return approvals[repository]?.includes(digest) ?? false;
}

/** The approvals with one more digest for a repository, newest last, at most `CHOP_APPROVAL_LIMIT` for it. Unchanged when it is there. */
export function withChopApproval(approvals: ChopApprovals, repository: string, digest: string): Record<string, string[]> {
	const next: Record<string, string[]> = Object.fromEntries(Object.entries(approvals).map(([key, digests]) => [key, [...digests]]));
	const kept = (next[repository] ?? []).filter(known => known !== digest);
	kept.push(digest);
	next[repository] = kept.slice(-CHOP_APPROVAL_LIMIT);
	return next;
}

/** The approvals from a settings file: every repository with a list of digests, each 64 lowercase hex characters. What cannot be read is dropped. */
export function readChopApprovals(value: unknown): Record<string, string[]> {
	if (!isRecord(value)) return {};
	const approvals: Record<string, string[]> = {};
	for (const [repository, digests] of Object.entries(value)) {
		if (repository === "" || !Array.isArray(digests)) continue;
		const kept = [...new Set(digests.filter((digest): digest is string => typeof digest === "string" && DIGEST.test(digest)))].slice(-CHOP_APPROVAL_LIMIT);
		if (kept.length > 0) approvals[repository] = kept;
	}
	return approvals;
}

/**
 * Run a chop in a worktree. A command chop: the main process starts the
 * person's shell there, named after the chop, and types the chop's text into
 * it. A prompt chop: the main process sends the text to the running agent
 * session `session` names, or, without one, starts the chop's agent (the
 * first saved agent when it names none) and sends it once the agent is
 * ready. The text is looked up by name, from the same list `listChops`
 * answers. A repository chop runs only once its text was approved for the
 * repository: otherwise the answer is `needs-approval` with the text to
 * show, and the request is made again with `approve` set to that exact text.
 */
export interface RunChopRequest {
	/** The primary checkout of a repository in the list. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. */
	worktree: string;
	/** The chop's name, matched ignoring case. */
	chop: string;
	cols: number;
	rows: number;
	/** The text the person saw and confirmed. It is approved, and the chop runs, only when it is still the chop's text. */
	approve?: string;
	/** For a prompt chop only: the id of a running agent session of this worktree to send it to. Left out to start a new agent. */
	session?: string;
	/**
	 * The text to type or send in place of the chop's, as the person edited
	 * it just before this run. It runs once and changes no chop. Left out to
	 * run the chop's own text. A repository chop still runs only once its own
	 * text is approved (`approve`), edited or not.
	 */
	text?: string;
}

/**
 * The text a run types or sends: the request's edited `text`, made to keep
 * `\n` line endings, or the chop's own when there is none. An edited text
 * that is not a string, is blank, or is longer than a chop can be is
 * refused with the reason, and nothing runs.
 */
export function textToRun(request: Pick<RunChopRequest, "text">, chop: Pick<Chop, "kind" | "text">): { ok: true; text: string } | { ok: false; message: string } {
	if (request.text === undefined) return { ok: true, text: chop.text };
	if (typeof request.text !== "string") return { ok: false, message: "The edited text cannot be read. Nothing was started." };
	const text = normalizeChopText(request.text);
	if (text.trim() === "") return { ok: false, message: `The edited ${chop.kind} is empty. Nothing was started.` };
	if (text.length > CHOP_TEXT_LIMIT) return { ok: false, message: `The edited ${chop.kind} is longer than ${CHOP_TEXT_LIMIT} characters. Nothing was started.` };
	return { ok: true, text };
}

export type RunChopResult =
	/** A new session started: a shell running a command, or an agent whose prompt goes once it is ready (`TerminalSession.prompt`). */
	| { outcome: "opened"; session: TerminalSession }
	/** A prompt went to the running agent `session` named, as typed input followed by Enter. */
	| { outcome: "sent"; session: TerminalSession }
	/** A prompt could not go to the session named. Nothing was written, and no agent was started. */
	| Exclude<PasteResult, { outcome: "pasted" }>
	/** A repository chop whose text was not approved. Nothing was started. `path` is the file it comes from. */
	| { outcome: "needs-approval"; chop: ListedChop; path: string }
	/** No chop has that name now, or `session` was given for a command chop. Nothing was started. */
	| { outcome: "no-chop"; message: string }
	| Exclude<OpenTerminalResult, { outcome: "opened" }>;
