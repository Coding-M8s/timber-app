import type { CapturedOutput, TimberFailure } from "./model";
import { type Fields, type ListedRepository, type ListedWorktree, SUPPORTED_SCHEMA_VERSION, isTextOrNull, readRepository, readWorktree } from "./timber-ls";
import { describeExit, readEnvelope } from "./timber-record";

/**
 * Reading the result file of a Timber command, version 1 of Timber's machine
 * interface (docs/ide-contract.md in the Timber repository). Pure: the main
 * process runs Timber and hands the file's text here (see src/bun/timber-run.ts).
 */

/** The Timber commands that write a result file, as each record names its command. */
export type ResultCommand = "new" | "open" | "done" | "rebase" | "pr" | "config" | "backup-restore" | "backup-delete" | "arena-new" | "arena-pick";

/** How a command is named in messages, as a person would type it. A record names some commands otherwise. */
export function resultCommandName(command: ResultCommand): string {
	switch (command) {
		case "backup-restore":
			return "timber backup restore";
		case "backup-delete":
			return "timber __app-backup delete";
		case "arena-new":
			return "timber arena new";
		case "arena-pick":
			return "timber arena pick";
		default:
			return `timber ${command}`;
	}
}

/** Stands for the result file wherever a command is shown. The real path is a fresh temporary file. */
export const RESULT_FILE_PLACEHOLDER = "<temporary file>";

/**
 * Stands for the approval file of `timber __ide-done apply` wherever that
 * command is shown. The real file is a private temporary one that holds the
 * approval fields from Timber's preview.
 */
export const APPROVAL_FILE_PLACEHOLDER = "<approved preview>";

/**
 * Stands for the input file of `timber __app-config` wherever that command is
 * shown. The real file is a private temporary one that holds the settings
 * draft, and any login typed, so it is never shown or logged.
 */
export const SETTINGS_DRAFT_PLACEHOLDER = "<settings draft>";

/** Shown in place of a worktree's path before Timber has answered, so the path is not known yet. */
export const WORKTREE_PLACEHOLDER = "<worktree>";

/**
 * Stands for the task file of `timber arena new` wherever that command is
 * shown. The real file is a private temporary one that holds the task, which
 * is never shown, logged, or passed as an argument.
 */
export const TASK_FILE_PLACEHOLDER = "<task file>";

const PLACEHOLDERS: readonly string[] = [RESULT_FILE_PLACEHOLDER, APPROVAL_FILE_PLACEHOLDER, SETTINGS_DRAFT_PLACEHOLDER, WORKTREE_PLACEHOLDER, TASK_FILE_PLACEHOLDER];

/** A record that passed every check. */
export interface ResultRecord {
	/** Null when Timber failed before it knew which repository it was in. */
	repository: ListedRepository | null;
	/** The worktree as Timber saw it during the command, not a promise that it is still there. */
	worktree: ListedWorktree | null;
	/** True when this run created a worktree that Timber verified. False does not prove that nothing was created. */
	materialized: boolean;
	/** The whole record, for what only one command reports, such as `rebase`. */
	fields: Fields;
}

/**
 * How a Timber command ended. Succeeded and cancelled always come from a
 * checked record. Failed has `record` null when there was no record to trust:
 * what the command changed is then unknown, so read the list again and never
 * retry by itself.
 */
export type TimberResult =
	| { outcome: "succeeded"; record: ResultRecord }
	/** The person closed Timber's own chooser before anything was changed. */
	| { outcome: "cancelled"; record: ResultRecord }
	| { outcome: "failed"; diagnostic: string; record: ResultRecord | null };

/** One run of a Timber command with a result file. */
export interface TimberRun {
	/** The command for display, with `RESULT_FILE_PLACEHOLDER` for the result file. */
	command: string;
	result: TimberResult;
	output: CapturedOutput;
}

const PLAIN_ARGUMENT = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * A Timber command as one line of text, for showing before it runs and
 * beside a failure. Quoted as a POSIX shell would need, but for reading only:
 * Timber is always run from the argument array, never from this text.
 */
export function describeTimberCommand(timberArguments: readonly string[]): string {
	const shown = timberArguments.map(argument =>
		PLACEHOLDERS.includes(argument) || PLAIN_ARGUMENT.test(argument) ? argument : `'${argument.replaceAll("'", `'\\''`)}'`);
	return ["timber", ...shown].join(" ");
}

/**
 * Read the result file of one run. `text` is what the file held after the
 * process ended, or null when there was no file. `exitCode` is the exit code
 * of that process, or null when it did not exit by itself.
 *
 * A result counts only when the file holds one version 1 record for this
 * command and its exit code is the one the process really had. A missing,
 * empty, or malformed file is a failure whatever the process printed.
 */
export function readTimberResult(command: ResultCommand, text: string | null, exitCode: number | null): TimberResult {
	const name = resultCommandName(command);
	const failed = (diagnostic: string, record: ResultRecord | null = null): TimberResult => ({ outcome: "failed", diagnostic, record });
	const noResult = (detail: string) => failed(
		`${name} ${describeExit(exitCode)} and ${detail}, so what it did is unknown. The details below show what it printed.`,
	);
	const unreadable = (detail: string) => noResult(`left a result this app cannot read (${detail})`);

	if (text === null) return noResult("left no result");
	if (text.trim() === "") return noResult("left an empty result");
	const envelope = readEnvelope(text, name, SUPPORTED_SCHEMA_VERSION, ", so what it did is unknown");
	if (!envelope.ok) {
		if (envelope.problem === "version") return failed(envelope.message);
		return unreadable(envelope.problem === "not-json" ? "it is not valid JSON" : "it is not a JSON object");
	}
	const parsed = envelope.record;

	const { outcome, diagnostic, materialized } = parsed;
	if (parsed.command !== command) return unreadable(`it is not a record for ${command}`);
	if (outcome !== "succeeded" && outcome !== "failed" && outcome !== "cancelled") return unreadable("its outcome is not one this app knows");
	if (typeof parsed.exitCode !== "number" || !Number.isInteger(parsed.exitCode)) return unreadable("it has no exit code");
	if (!isTextOrNull(diagnostic)) return unreadable("its diagnostic is not text");
	if (typeof materialized !== "boolean") return unreadable("it does not say whether a worktree was created");

	if (parsed.exitCode !== exitCode) {
		return failed(`${name} ${describeExit(exitCode)}, but its result says exit code ${parsed.exitCode}. The result was not used, so what it did is unknown.`);
	}
	// The contract ties the two together: succeeded and cancelled exit with 0, and failed never does.
	if ((outcome === "failed") === (parsed.exitCode === 0)) return unreadable(`its outcome "${outcome}" does not go with exit code ${parsed.exitCode}`);

	const repository = parsed.repository === null ? null : readRepository(parsed.repository);
	if (parsed.repository !== null && repository === null) return unreadable("its repository is not a repository record");
	const worktree = parsed.worktree === null ? null : readWorktree(parsed.worktree);
	if (parsed.worktree !== null && worktree === null) return unreadable("its worktree is not a worktree record");

	const record: ResultRecord = { repository, worktree, materialized, fields: parsed };
	if (outcome === "failed") return failed(diagnostic ?? `${name} failed without saying why.`, record);
	return { outcome, record };
}

/** The failure to show for a run, or null when it did not fail. */
export function failureOf(run: TimberRun): TimberFailure | null {
	if (run.result.outcome !== "failed") return null;
	return { command: run.command, diagnostic: run.result.diagnostic, output: run.output };
}
