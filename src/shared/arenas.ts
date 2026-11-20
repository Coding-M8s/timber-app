import type { TimberFailure } from "./model";
import { type Fields, isFields, isTextOrNull } from "./timber-ls";
import { TASK_FILE_PLACEHOLDER, type TimberRun, failureOf } from "./timber-result";
import { describeExit, describeFailedRun, displayText, readEnvelope } from "./timber-record";

/**
 * Arenas: two or more attempts at the same task from the same commit, of
 * which the person keeps one. Version 1 of Timber's arena records
 * ("Arenas for app consumers" in docs/ide-contract.md in the Timber
 * repository). Pure: the main process runs Timber and hands what it printed
 * here (see src/bun/arenas.ts).
 *
 * Timber owns every rule about arenas: which attempt is ready, what an
 * agent runs, what counts as work, and what pick may remove. Nothing here
 * repeats those rules; this only reads what Timber says. Arena commands are
 * beta in Timber, and the app says so wherever it offers them.
 *
 * The task text is never part of any record, argument, or message here. It
 * reaches Timber only through a private file (see `arenaNewArguments`).
 */
export const SUPPORTED_ARENA_SCHEMA_VERSION = 1;

export const ARENA_LIST_ARGUMENTS = ["__app-arena", "list"] as const;
export const ARENA_LIST_COMMAND = `timber ${ARENA_LIST_ARGUMENTS.join(" ")}`;

/** Timber's rule for arena names. A name becomes an argument, so nothing else may pass. */
const ARENA_NAME = /^[a-z][a-z0-9_-]{0,47}$/;
/** An attempt's label is a preset or tool name and a number, such as `codex-2`. */
const ATTEMPT_LABEL = /^[a-z][a-z0-9_-]*$/;

/** Whether a value is an arena name in Timber's form, so it can be an argument and never reads as an option. */
export function isArenaName(value: unknown): value is string {
	return typeof value === "string" && ARENA_NAME.test(value);
}

/** Whether a value is an attempt label in Timber's form, so it can be an argument and never reads as an option. */
export function isAttemptLabel(value: unknown): value is string {
	return typeof value === "string" && value.length <= 64 && ATTEMPT_LABEL.test(value);
}

/** One word for where an attempt stands, as Timber recorded it. */
export const ATTEMPT_STATES = ["incomplete", "prepared", "setup-failed", "launched", "picked", "archived"] as const;
export type AttemptState = typeof ATTEMPT_STATES[number];

/**
 * Whether Git still has the worktree Timber created for an attempt, checked
 * live by Timber: `ok` it does, `missing` nothing is at its path, `stale`
 * something else is there, `unknown` it could not be checked.
 */
export const ATTEMPT_GIT_STATES = ["ok", "stale", "missing", "unknown"] as const;
export type AttemptGitState = typeof ATTEMPT_GIT_STATES[number];

/** The pinned commit every attempt of an arena started from, and the ref it was read from. */
export interface ArenaBase {
	ref: string;
	commit: string;
}

/** One attempt of an arena, as `timber __app-arena list` reports it. */
export interface ArenaAttempt {
	/** The exact label for launch and pick, such as `codex-1`. */
	label: string;
	/** `codex`, `claude`, `cursor`, `wrapper`, or `manual`, as Timber names it. */
	tool: string;
	preset: string;
	/** Null when the tool's default was used. */
	model: string | null;
	/** The effort asked for, not proof of the one used. */
	effort: string | null;
	branch: string;
	/** The attempt's worktree, as Timber created it. A row is matched to it by this path, never by its branch. */
	path: string;
	state: AttemptState;
	/** The recorded stage behind `state`, kept as text for showing. */
	stage: string;
	git: AttemptGitState;
	/** Where pick saved the attempt's work, and whether that ref is still there. */
	archive: { ref: string; commit: string; present: boolean } | null;
}

/** One arena: read whole, or the name of one Timber could not read, with its reason. */
export type Arena =
	| {
		name: string;
		outcome: "read";
		base: ArenaBase;
		/** ISO 8601, when the arena was created. Kept as Timber wrote it. */
		createdAt: string | null;
		/** The ticket key the arena was created for, if any. */
		ticket: string | null;
		/** An arena command of Timber holds its lock, or one was interrupted. */
		active: boolean;
		/** The label pick kept, if one was picked. */
		winner: string | null;
		attempts: ArenaAttempt[];
	}
	| { name: string; outcome: "failed"; diagnostic: string };

/**
 * The arenas of a repository, as Timber listed them, or why there is no
 * list. `unsupported` means the Timber found has no `__app-arena`: there is
 * nothing to show, nothing to offer, and nothing is wrong. A list is used
 * only as a whole; an arena that Timber could not read is a failed entry
 * beside the others.
 */
export type ArenaList =
	| { state: "listed"; arenas: Arena[] }
	| { state: "unsupported" }
	| { state: "failed"; message: string };

/**
 * What Commander, which Timber's command line is built on, says about a
 * command or option it does not know. Timber releases before arenas for apps
 * print this and nothing else, with the same version number as the first
 * that has them, so it is the one place the app reads Timber's human output.
 */
const UNKNOWN_TO_TIMBER = /^error: unknown (command '__app-arena'|option '--json'|option '--result-file')/m;

/** Whether what Timber printed says it has no such command: exit 1, nothing on standard output, and Commander's words. */
export function isUnknownToTimber(stdout: string, stderr: string, exitCode: number | null): boolean {
	return exitCode === 1 && stdout.trim() === "" && UNKNOWN_TO_TIMBER.test(stderr);
}

const isFilled = (value: unknown): value is string => typeof value === "string" && value !== "";
const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isOneOf = <Value extends string>(values: readonly Value[], value: unknown): value is Value => typeof value === "string" && (values as readonly string[]).includes(value);

function readAll<Item>(value: unknown, read: (item: unknown) => Item | null): Item[] | null {
	if (!Array.isArray(value)) return null;
	const items: Item[] = [];
	for (const entry of value) {
		const item = read(entry);
		if (item === null) return null;
		items.push(item);
	}
	return items;
}

function readBase(value: unknown): ArenaBase | null {
	if (!isFields(value) || !isFilled(value.ref) || !isFilled(value.commit)) return null;
	return { ref: value.ref, commit: value.commit };
}

/** The parts of an attempt every arena record shares. Null when one is missing or of the wrong kind. */
function readAttemptIdentity(value: Fields) {
	const { label, tool, preset, model, effort, branch, path } = value;
	if (!isAttemptLabel(label) || !isFilled(tool) || !isFilled(preset) || !isTextOrNull(model) || !isTextOrNull(effort)) return null;
	if (!isFilled(branch) || !isFilled(path)) return null;
	return { label, tool, preset, model, effort, branch, path };
}

function readArchive(value: unknown): ArenaAttempt["archive"] | "unreadable" {
	if (value === null) return null;
	if (!isFields(value) || !isFilled(value.ref) || !isFilled(value.commit) || typeof value.present !== "boolean") return "unreadable";
	return { ref: value.ref, commit: value.commit, present: value.present };
}

function readListedAttempt(value: unknown): ArenaAttempt | null {
	if (!isFields(value)) return null;
	const identity = readAttemptIdentity(value);
	if (identity === null) return null;
	const { state, stage, git } = value;
	if (!isOneOf(ATTEMPT_STATES, state) || !isFilled(stage) || !isOneOf(ATTEMPT_GIT_STATES, git)) return null;
	const archive = readArchive(value.archive);
	if (archive === "unreadable") return null;
	return { ...identity, state, stage, git, archive };
}

function readArena(value: unknown): Arena | null {
	if (!isFields(value) || !isFilled(value.name)) return null;
	const { name, outcome } = value;
	if (outcome === "failed") {
		const diagnostic = isFilled(value.diagnostic) ? displayText(value.diagnostic, 300) : "Timber could not read this arena.";
		return { name, outcome: "failed", diagnostic };
	}
	if (outcome !== "read") return null;
	const base = readBase(value.base);
	const { createdAt, ticket, active, winner } = value;
	if (base === null || !isTextOrNull(createdAt) || !isTextOrNull(ticket) || typeof active !== "boolean" || !isTextOrNull(winner)) return null;
	const attempts = readAll(value.attempts, readListedAttempt);
	if (attempts === null) return null;
	return { name, outcome: "read", base, createdAt, ticket, active, winner, attempts };
}

/**
 * Read what one run of `timber __app-arena list` printed. `exitCode` is the
 * exit code of that process, or null when it did not exit by itself.
 *
 * Timber prints its record whether it exits with 0 or 1: 1 when the
 * repository, or any one arena, could not be read. A record whose
 * `diagnostic` is set is a failure, never an empty list. Otherwise every
 * arena is listed, those Timber could not read as failed entries.
 */
export function readArenaList(stdout: string, stderr: string, exitCode: number | null): ArenaList {
	if (isUnknownToTimber(stdout, stderr, exitCode)) return { state: "unsupported" };
	const failed = (message: string): ArenaList => ({ state: "failed", message });
	const unreadable = (detail: string) => failed(`${ARENA_LIST_COMMAND} did not answer with a record this app can read: ${detail}.`);
	const explained = () => failed(describeFailedRun(ARENA_LIST_COMMAND, stderr, exitCode));
	if (exitCode !== 0 && exitCode !== 1) return explained();

	const envelope = readEnvelope(stdout, ARENA_LIST_COMMAND, SUPPORTED_ARENA_SCHEMA_VERSION);
	if (!envelope.ok) {
		if (envelope.problem === "not-json" && exitCode !== 0) return explained();
		return envelope.problem === "version" ? failed(envelope.message) : unreadable(envelope.detail);
	}
	const { record } = envelope;
	if (!isTextOrNull(record.diagnostic)) return unreadable("its diagnostic is not text");
	if (record.diagnostic !== null) return failed(`${ARENA_LIST_COMMAND} could not read the arenas: ${displayText(record.diagnostic, 300)}`);
	const arenas = readAll(record.arenas, readArena);
	if (arenas === null) return unreadable("an arena in it cannot be read");
	// Exit 1 means something could not be read, so a list that says otherwise is not trusted.
	if (exitCode === 1 && !arenas.some(arena => arena.outcome === "failed")) return explained();
	return { state: "listed", arenas };
}

/** The arena of that name in a list, or null. */
export function arenaOf(list: ArenaList | undefined, name: string): Arena | null {
	return list?.state === "listed" ? list.arenas.find(arena => arena.name === name) ?? null : null;
}

/**
 * The attempt whose worktree is at `path`, with its arena, among the arenas
 * read whole. Only an attempt Git still has as Timber created it (`git` is
 * `ok`) counts: a branch or folder name never makes a worktree an attempt.
 */
export function attemptAt(list: ArenaList | undefined, path: string): { arena: string; attempt: ArenaAttempt } | null {
	if (list?.state !== "listed") return null;
	for (const arena of list.arenas) {
		if (arena.outcome !== "read") continue;
		const attempt = arena.attempts.find(candidate => candidate.path === path && candidate.git === "ok");
		if (attempt) return { arena: arena.name, attempt };
	}
	return null;
}

/** Everything after `timber` that asks what an attempt's agent runs. Both names are checked first, so neither reads as an option. */
export function arenaLaunchArguments(arena: string, attempt: string): string[] {
	return ["__app-arena", "launch", arena, "--attempt", attempt];
}

/** What Timber says to run for an attempt's agent, or why nothing runs. */
export type ArenaLaunch =
	/** Start `argv` in `cwd`, with `environment` set on top of the app's and `unset` removed. `argv[0]` is found on the PATH unless it is a whole path. */
	| { outcome: "ready"; argv: string[]; cwd: string; environment: Record<string, string>; unset: string[] }
	/** A manual attempt: there is no agent to start. */
	| { outcome: "no-agent" }
	| { outcome: "failed"; message: string };

function readEnvironment(value: unknown): Record<string, string> | null {
	if (!isFields(value)) return null;
	const environment: Record<string, string> = {};
	for (const [name, text] of Object.entries(value)) {
		if (name === "" || typeof text !== "string") return null;
		environment[name] = text;
	}
	return environment;
}

/**
 * Read what one run of `timber __app-arena launch` printed, for the arena
 * and attempt that were asked about: a record about another one is not used.
 * Exit 0 is ready or no-agent, and exit 1 is failed with Timber's reason.
 * The argv and environment are kept exactly as Timber wrote them and must
 * never be logged: they name private files.
 */
export function readArenaLaunch(stdout: string, stderr: string, exitCode: number | null, arena: string, attempt: string): ArenaLaunch {
	const command = `timber __app-arena launch ${arena} --attempt ${attempt}`;
	const failed = (message: string): ArenaLaunch => ({ outcome: "failed", message });
	const unreadable = (detail: string) => failed(`${command} did not answer with a record this app can read: ${detail}. Nothing was started.`);
	if (isUnknownToTimber(stdout, stderr, exitCode)) return failed("The Timber found cannot start arena attempts. Install a newer Timber. Nothing was started.");
	const explained = () => failed(`${describeFailedRun(command, stderr, exitCode)} Nothing was started.`);
	if (exitCode !== 0 && exitCode !== 1) return explained();
	const envelope = readEnvelope(stdout, command, SUPPORTED_ARENA_SCHEMA_VERSION);
	if (!envelope.ok) {
		if (envelope.problem === "not-json" && exitCode !== 0) return explained();
		return envelope.problem === "version" ? failed(envelope.message) : unreadable(envelope.detail);
	}
	const { record } = envelope;
	if (record.arena !== arena || record.attempt !== attempt) return unreadable("it is about another attempt");
	const { outcome, launch, diagnostic } = record;
	if ((outcome === "failed") !== (exitCode === 1)) return unreadable(`its outcome "${String(outcome)}" does not go with how it exited`);
	switch (outcome) {
		case "failed":
			return failed(`${isFilled(diagnostic) ? displayText(diagnostic, 300) : "Timber did not say why."} Nothing was started.`);
		case "no-agent":
			return launch === null ? { outcome: "no-agent" } : unreadable("it names a command for an attempt with no agent");
		case "ready": {
			if (!isFields(launch)) return unreadable("it names no command");
			const { argv, cwd, unset } = launch;
			const environment = readEnvironment(launch.environment);
			if (!Array.isArray(argv) || argv.length === 0 || !argv.every(part => typeof part === "string") || !isFilled(argv[0])) return unreadable("its command is not a list of arguments");
			if (!isFilled(cwd) || environment === null || !Array.isArray(unset) || !unset.every(isFilled)) return unreadable("its folder or environment cannot be read");
			return { outcome: "ready", argv: [...argv] as string[], cwd, environment, unset: [...unset] as string[] };
		}
		default:
			return unreadable("its outcome is not one this app knows");
	}
}

/** Everything after `timber` that compares an arena's attempts. Read-only: Timber changes nothing. */
export function arenaInspectArguments(arena: string): string[] {
	return ["arena", "pick", arena, "--inspect", "--json"];
}

/** The command that compares an arena's attempts, as it is shown. */
export function arenaInspectCommand(arena: string): string {
	return `timber ${arenaInspectArguments(arena).join(" ")}`;
}

/** Changes counted from one point to another, as Git counts them. */
export interface ChangeCount {
	files: number;
	insertions: number;
	deletions: number;
}

/** How an attempt differs from the arena's base, as Timber counted it. */
export interface AttemptComparison {
	/** Commits on the attempt's HEAD since the base. */
	commits: number;
	/** From the base to HEAD. */
	committed: ChangeCount;
	/** From HEAD to the files in the worktree. Apart from committed, because local edits can undo committed work. */
	uncommitted: ChangeCount;
	untracked: number;
	ignored: number;
}

/** One attempt as `timber arena pick --inspect --json` compared it. */
export interface InspectedAttempt {
	label: string;
	tool: string;
	preset: string;
	model: string | null;
	effort: string | null;
	branch: string;
	path: string;
	state: AttemptState;
	stage: string;
	/** Its worktree is gone. */
	removed: boolean;
	archiveRef: string | null;
	/** Null when it is removed or could not be compared, and `reason` says why. */
	comparison: AttemptComparison | null;
	reason: string | null;
}

/** An arena's attempts as Timber compared them, or why there is no comparison. */
export type ArenaInspection =
	| { state: "inspected"; arena: string; base: ArenaBase | null; winner: string | null; attempts: InspectedAttempt[] }
	| { state: "unsupported" }
	| { state: "failed"; message: string };

function readCount(value: unknown): ChangeCount | null {
	if (!isFields(value) || !isCount(value.files) || !isCount(value.insertions) || !isCount(value.deletions)) return null;
	return { files: value.files, insertions: value.insertions, deletions: value.deletions };
}

function readComparison(value: unknown): AttemptComparison | null | "unreadable" {
	if (value === null) return null;
	if (!isFields(value)) return "unreadable";
	const committed = readCount(value.committed);
	const uncommitted = readCount(value.uncommitted);
	if (!isCount(value.commits) || committed === null || uncommitted === null || !isCount(value.untracked) || !isCount(value.ignored)) return "unreadable";
	return { commits: value.commits, committed, uncommitted, untracked: value.untracked, ignored: value.ignored };
}

function readInspectedAttempt(value: unknown): InspectedAttempt | null {
	if (!isFields(value)) return null;
	const identity = readAttemptIdentity(value);
	if (identity === null) return null;
	const { state, stage, removed, archiveRef, reason } = value;
	if (!isOneOf(ATTEMPT_STATES, state) || !isFilled(stage) || typeof removed !== "boolean" || !isTextOrNull(archiveRef) || !isTextOrNull(reason)) return null;
	const comparison = readComparison(value.comparison);
	if (comparison === "unreadable") return null;
	return { ...identity, state, stage, removed, archiveRef, comparison, reason: reason === null ? null : displayText(reason, 300) };
}

/**
 * Read what one run of `timber arena pick <arena> --inspect --json` printed,
 * for the arena that was asked about. Exit 0 is a comparison; exit 1 has
 * Timber's diagnostic and no attempts.
 */
export function readArenaInspection(stdout: string, stderr: string, exitCode: number | null, arena: string): ArenaInspection {
	const command = arenaInspectCommand(arena);
	if (isUnknownToTimber(stdout, stderr, exitCode)) return { state: "unsupported" };
	const failed = (message: string): ArenaInspection => ({ state: "failed", message });
	const unreadable = (detail: string) => failed(`${command} did not answer with a record this app can read: ${detail}.`);
	const explained = () => failed(describeFailedRun(command, stderr, exitCode));
	if (exitCode !== 0 && exitCode !== 1) return explained();
	const envelope = readEnvelope(stdout, command, SUPPORTED_ARENA_SCHEMA_VERSION);
	if (!envelope.ok) {
		if (envelope.problem === "not-json" && exitCode !== 0) return explained();
		return envelope.problem === "version" ? failed(envelope.message) : unreadable(envelope.detail);
	}
	const { record } = envelope;
	if (record.arena !== arena) return unreadable("it is about another arena");
	if (!isTextOrNull(record.diagnostic) || !isTextOrNull(record.winner)) return unreadable("its diagnostic or winner is not text");
	if ((record.diagnostic !== null) !== (exitCode === 1)) return unreadable(`it ${record.diagnostic === null ? "has no diagnostic" : "has a diagnostic"}, but the process ${describeExit(exitCode)}`);
	if (record.diagnostic !== null) return failed(`${command} could not compare the attempts: ${displayText(record.diagnostic, 300)}`);
	const base = record.base === null ? null : readBase(record.base);
	if (record.base !== null && base === null) return unreadable("its base cannot be read");
	const attempts = readAll(record.attempts, readInspectedAttempt);
	if (attempts === null) return unreadable("an attempt in it cannot be read");
	return { state: "inspected", arena, base, winner: record.winner, attempts };
}

/** The coding tools an attempt group can name. A saved preset names its own. */
export const ARENA_GROUP_TOOLS = ["codex", "claude", "cursor", "manual"] as const;
export type ArenaGroupTool = typeof ARENA_GROUP_TOOLS[number];

/** The most runs one group may ask for. Each is a worktree and, mostly, an agent. */
export const MAX_ARENA_RUNS = 8;

/**
 * One group of attempts, in the order given: a tool with an optional model
 * and effort, or a saved preset, each run `runs` times. A manual group has
 * no model or effort.
 */
export type ArenaGroup =
	| { kind: "tool"; tool: ArenaGroupTool; model: string | null; effort: string | null; runs: number }
	| { kind: "preset"; preset: string; runs: number };

/** What `timber arena new` creates. */
export interface NewArenaRequest {
	/** The path of the repository's primary checkout. Timber runs there. */
	repository: string;
	/** A name or a ticket key, as typed. Timber decides the arena's name from it. */
	name: string;
	/** The task. It goes to Timber in a private file only, never as an argument, and is never logged or shown in a command. */
	task: string;
	groups: ArenaGroup[];
	/** The branch or ref every attempt starts from, or null for Timber's default. */
	base: string | null;
}

/** Whether a value is a model, effort, or base the person typed: one line of text with no control characters. */
function isPlainValue(value: unknown): value is string {
	return typeof value === "string" && value.trim() !== "" && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value);
}

/** Why a request cannot become a command, or null when it can. Pure, so the dialog and the main process agree. */
export function newArenaProblem(request: Pick<NewArenaRequest, "name" | "task" | "groups" | "base">): string | null {
	if (!isPlainValue(request.name)) return "Give the arena a name or a ticket key.";
	if (typeof request.task !== "string" || request.task.trim() === "") return "Write the task the attempts work on.";
	if (!Array.isArray(request.groups) || request.groups.length === 0) return "Add at least one group of attempts.";
	let runs = 0;
	for (const group of request.groups) {
		if (!isFields(group) || !Number.isInteger(group.runs) || group.runs < 1 || group.runs > MAX_ARENA_RUNS) return `Each group runs from 1 to ${MAX_ARENA_RUNS} times.`;
		runs += group.runs;
		if (group.kind === "preset") {
			if (!isArenaName(group.preset)) return "A preset is named as Timber names it, such as fast-codex.";
		} else if (group.kind === "tool") {
			if (!isOneOf(ARENA_GROUP_TOOLS, group.tool)) return "Choose codex, claude, cursor, or manual.";
			if ((group.model !== null && !isPlainValue(group.model)) || (group.effort !== null && !isPlainValue(group.effort))) return "A model or effort is one line of text.";
			if (group.tool === "manual" && (group.model !== null || group.effort !== null)) return "Manual attempts have no model or effort.";
		} else {
			return "A group is a tool or a saved preset.";
		}
	}
	if (runs < 2) return "An arena has at least 2 attempts.";
	if (request.base !== null && !isPlainValue(request.base)) return "The base is one line of text, such as main.";
	return null;
}

/**
 * Everything after `timber` for creating an arena: each group's flags in
 * order, since a model, effort, or runs count belongs to the tool or preset
 * before it; then the base, the task file, the flags the app always passes,
 * and the name after `--`. Every value the person typed is joined to its
 * option with `=`, so none can read as an option. The task file and result
 * file are put in as they are.
 */
export function arenaNewArguments(request: Pick<NewArenaRequest, "name" | "groups" | "base">, taskFile: string, resultFile: string): string[] {
	const groups = request.groups.flatMap(group => group.kind === "preset"
		? [`--preset=${group.preset}`, `--runs=${group.runs}`]
		: [
			`--tool=${group.tool}`,
			...(group.model === null ? [] : [`--model=${group.model.trim()}`]),
			...(group.effort === null ? [] : [`--effort=${group.effort.trim()}`]),
			`--runs=${group.runs}`,
		]);
	return [
		"arena", "new", ...groups,
		...(request.base === null ? [] : [`--base=${request.base.trim()}`]),
		"--prompt-file", taskFile, "--no-editor", "--no-agent", "--result-file", resultFile,
		"--", request.name.trim(),
	];
}

/** The placeholder for the private task file, wherever the command is shown. */
export { TASK_FILE_PLACEHOLDER };

/** One attempt as `arena new` reported it. */
export interface CreatedAttempt {
	label: string;
	tool: string;
	preset: string;
	model: string | null;
	effort: string | null;
	branch: string;
	path: string;
	/** The worktree was created and bound. */
	created: boolean;
	/** `ready` is the end with `--no-agent`. */
	stage: string;
	failedStage: string | null;
}

/** What `arena new` reported, once the arena was reserved. */
export interface ArenaCreation {
	/** The arena's name as Timber made it, which can differ from what was typed, as for a ticket key. */
	name: string;
	base: ArenaBase;
	/** Where creation stopped, or null when every attempt is ready. */
	failure: { stage: string; attempt: string | null } | null;
	attempts: CreatedAttempt[];
}

/** How `timber arena new` ended. */
export type NewArenaResult =
	| { outcome: "created"; arena: ArenaCreation }
	/**
	 * `arena` is what Timber reserved before it stopped, or null when nothing
	 * was. A reserved arena keeps its name: recover it with Timber, never by
	 * creating it again. `ran` is false only when the app refused before it
	 * ran anything.
	 */
	| { outcome: "failed"; ran: boolean; arena: ArenaCreation | null; failure: TimberFailure };

function readCreatedAttempt(value: unknown): CreatedAttempt | null {
	if (!isFields(value)) return null;
	const identity = readAttemptIdentity(value);
	const { created, stage, failedStage } = value;
	if (identity === null || typeof created !== "boolean" || !isFilled(stage) || !isTextOrNull(failedStage)) return null;
	return { ...identity, created, stage, failedStage };
}

function readCreation(value: unknown): ArenaCreation | null {
	if (!isFields(value) || !isArenaName(value.name)) return null;
	const base = readBase(value.base);
	if (base === null) return null;
	let failure: ArenaCreation["failure"] = null;
	if (value.failure !== null) {
		if (!isFields(value.failure) || !isFilled(value.failure.stage) || !isTextOrNull(value.failure.attempt)) return null;
		failure = { stage: value.failure.stage, attempt: value.failure.attempt };
	}
	const attempts = readAll(value.attempts, readCreatedAttempt);
	if (attempts === null) return null;
	return { name: value.name, base, failure, attempts };
}

/** A record this app cannot use: what the command did is unknown, so the list must be read again. */
function unknownRun(run: TimberRun, name: string, detail: string): TimberFailure {
	const exitCode = run.result.record?.fields.exitCode;
	const exited = typeof exitCode === "number" ? `exited with code ${exitCode}` : "ended";
	return { command: run.command, diagnostic: `${name} ${exited} and left a result this app cannot read (${detail}), so what it did is unknown. The details below show what it printed.`, output: run.output };
}

/**
 * What one run of `timber arena new --result-file` came to. What Timber
 * printed is passed on for the details area and never read here.
 */
export function readNewArenaResult(run: TimberRun): NewArenaResult {
	const name = "timber arena new";
	const { result } = run;
	const unknown = (detail: string): NewArenaResult => ({ outcome: "failed", ran: true, arena: null, failure: unknownRun(run, name, detail) });
	if (result.record === null) return { outcome: "failed", ran: true, arena: null, failure: failureOf(run)! };
	if (result.outcome === "cancelled") return unknown("it says it was cancelled, which this command never is with --no-agent");
	const fields = result.record.fields.arenaNew;
	const arena = fields === undefined ? null : readCreation(fields);
	if (fields !== undefined && arena === null) return unknown("its arenaNew object cannot be read");
	if (result.outcome === "succeeded") {
		if (arena === null) return unknown("it says it succeeded but names no arena");
		if (arena.failure !== null) return unknown("it says it succeeded but names where creation stopped");
		return { outcome: "created", arena };
	}
	return { outcome: "failed", ran: true, arena, failure: failureOf(run)! };
}

/** Pick one attempt of an arena as the winner. */
export interface PickArenaRequest {
	repository: string;
	arena: string;
	winner: string;
}

/** Everything after `timber` for a pick. Both names are checked first, so neither reads as an option. */
export function arenaPickArguments(request: Pick<PickArenaRequest, "arena" | "winner">, resultFile: string): string[] {
	return ["arena", "pick", request.arena, "--winner", request.winner, "--result-file", resultFile];
}

export const PICK_OUTCOMES = ["winner", "removed", "archived", "kept", "partly-removed", "already-removed"] as const;
export type PickOutcome = typeof PICK_OUTCOMES[number];

/** What pick did to one attempt. `reason` is Timber's, for kept and partly removed. */
export interface PickedAttempt {
	label: string;
	outcome: PickOutcome;
	/** `refs/timber/arena/...` holding its work, when pick saved it. */
	archiveRef: string | null;
	reason: string | null;
}

export interface ArenaPick {
	name: string;
	winner: string;
	attempts: PickedAttempt[];
}

/** How `timber arena pick` ended. */
export type PickArenaResult =
	| { outcome: "picked"; pick: ArenaPick }
	/**
	 * `pick` is set once the winner was chosen: some attempts may be removed
	 * and others kept, each with Timber's reason. Fix the reason and run the
	 * same pick again. `ran` is false only when the app refused before it ran
	 * anything, as while one of the app's sessions runs in an attempt.
	 */
	| { outcome: "failed"; ran: boolean; pick: ArenaPick | null; failure: TimberFailure };

function readPickedAttempt(value: unknown): PickedAttempt | null {
	if (!isFields(value) || !isAttemptLabel(value.label) || !isOneOf(PICK_OUTCOMES, value.outcome)) return null;
	const { archiveRef, reason } = value;
	if (!isTextOrNull(archiveRef) || !isTextOrNull(reason)) return null;
	return { label: value.label, outcome: value.outcome, archiveRef, reason: reason === null ? null : displayText(reason, 300) };
}

/** What one run of `timber arena pick --winner --result-file` came to, for the arena and winner that were asked for. */
export function readPickArenaResult(run: TimberRun, request: Pick<PickArenaRequest, "arena" | "winner">): PickArenaResult {
	const name = "timber arena pick";
	const { result } = run;
	const unknown = (detail: string): PickArenaResult => ({ outcome: "failed", ran: true, pick: null, failure: unknownRun(run, name, detail) });
	if (result.record === null) return { outcome: "failed", ran: true, pick: null, failure: failureOf(run)! };
	if (result.outcome === "cancelled") return unknown("it says it was cancelled, which this command never is");
	const fields = result.record.fields.arenaPick;
	let pick: ArenaPick | null = null;
	if (fields !== undefined) {
		const attempts = isFields(fields) ? readAll(fields.attempts, readPickedAttempt) : null;
		if (!isFields(fields) || attempts === null || fields.name !== request.arena || fields.winner !== request.winner) return unknown("its arenaPick object cannot be read, or is about another arena or winner");
		pick = { name: request.arena, winner: request.winner, attempts };
	}
	if (result.outcome === "succeeded") {
		if (pick === null) return unknown("it says it succeeded but names no winner");
		if (pick.attempts.some(attempt => attempt.outcome === "kept" || attempt.outcome === "partly-removed")) return unknown("it says it succeeded but kept an attempt");
		return { outcome: "picked", pick };
	}
	return { outcome: "failed", ran: true, pick, failure: failureOf(run)! };
}

/** A saved arena preset of a repository: its name, and the tool Timber says it runs. Its command and arguments stay with Timber. */
export interface ArenaPreset {
	name: string;
	tool: string;
}

/** A repository's arena presets, in Timber's order, or why there is no list. */
export type ArenaPresetList =
	| { ok: true; presets: ArenaPreset[] }
	| { ok: false; message: string };

/**
 * The arena presets in what `timber __app-config read --scope repository`
 * printed, merged by Timber from the machine defaults and `.timber.toml`.
 * Only each preset's name and tool are kept: its command and arguments can
 * hold tokens, and the app never builds a command from them.
 */
export function readArenaPresets(stdout: string, stderr: string, exitCode: number | null): ArenaPresetList {
	const command = "timber __app-config read --scope repository";
	const failed = (message: string): ArenaPresetList => ({ ok: false, message });
	const unreadable = (detail: string) => failed(`${command} did not answer with a record this app can read: ${detail}.`);
	if (exitCode !== 0) return failed(describeFailedRun(command, stderr, exitCode));
	const envelope = readEnvelope(stdout, command, 1);
	if (!envelope.ok) return envelope.problem === "version" ? failed(envelope.message) : unreadable(envelope.detail);
	const { record } = envelope;
	if (record.scope !== "repository" || !isFields(record.effective)) return unreadable("it has no effective settings for the repository");
	const arena = record.effective.arena;
	if (arena === undefined) return { ok: true, presets: [] };
	if (!isFields(arena)) return unreadable("its arena settings are not a table");
	if (arena.agents === undefined) return { ok: true, presets: [] };
	if (!isFields(arena.agents)) return unreadable("its arena presets are not a table");
	const presets: ArenaPreset[] = [];
	for (const [name, value] of Object.entries(arena.agents)) {
		if (!isArenaName(name) || !isFields(value) || !isFilled(value.tool)) return unreadable(`arena preset ${presets.length + 1} cannot be read`);
		presets.push({ name, tool: value.tool });
	}
	return { ok: true, presets };
}
