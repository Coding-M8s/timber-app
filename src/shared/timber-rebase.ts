import { isCommitHash, shortCommit } from "./file-changes";
import type { TimberFailure } from "./model";
import { type Fields, isFields, isTextOrNull } from "./timber-ls";
import { type TimberRun, failureOf } from "./timber-result";

/**
 * `timber rebase` with a result file, and what its record means to the
 * interface. Pure: the interface words the command from the same function the
 * main process runs it from (see src/bun/worktree-commands.ts), so the command
 * shown is the command that runs.
 *
 * Timber owns every rule about when a rebase may run and what it leaves
 * behind. Nothing here repeats one: the record says how the rebase ended, and
 * this reads it. The app never runs a Git command for a rebase, so a rebase
 * that stopped on conflicts is left exactly as Git left it.
 */

/** Rebase one worktree and report how it ended. */
export interface RebaseRequest {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. It is the selector given to Timber. */
	worktree: string;
	/** What to rebase onto, given to Timber as `--base`. Null for the base Timber saved for the worktree. */
	onto: string | null;
}

/**
 * Everything after `timber`: the options first, then `--`, then the
 * worktree's registered path as one argument, so a path that starts with a
 * dash is never read as an option. `resultFile` is put in as it is.
 */
export function rebaseResultArguments(request: Pick<RebaseRequest, "worktree" | "onto">, resultFile: string): string[] {
	const base = request.onto === null ? [] : ["--base", request.onto];
	return ["rebase", ...base, "--result-file", resultFile, "--", request.worktree];
}

/**
 * How one rebase ended, as the record says. `base` is the canonical ref
 * Timber used, `refs/remotes/<remote>/<branch>` or `refs/heads/<branch>`, or
 * the full hash of a commit base.
 */
export type RebaseResult =
	/** The branch was rebased onto `base`. */
	| { outcome: "rebased"; base: string | null; baseCommit: string | null; originalTip: string | null; baseSaved: boolean }
	/** The branch already contained `base`, so nothing was rewritten. */
	| { outcome: "up-to-date"; base: string | null; baseCommit: string | null; baseSaved: boolean }
	/** Git paused the rebase on these files, and Timber left it as Git left it. */
	| { outcome: "conflicts"; base: string | null; baseCommit: string | null; originalTip: string | null; baseSaved: boolean; conflicts: string[]; failure: TimberFailure }
	/** Timber refused to start, and changed nothing. */
	| { outcome: "refused"; failure: TimberFailure }
	/** The rebase failed. `ran` is false only when the app refused before it ran anything. A failure that ran can have changed the branch. */
	| { outcome: "failed"; ran: boolean; failure: TimberFailure };

type Kind = "rebased" | "up-to-date" | "conflicts" | "refused" | "failed";

const KINDS: readonly string[] = ["rebased", "up-to-date", "conflicts", "refused", "failed"];

interface RebaseFields {
	result: Kind;
	base: string | null;
	baseCommit: string | null;
	originalTip: string | null;
	conflicts: string[];
	baseSaved: boolean;
}

/** The `rebase` object of a record, or why it cannot be used. */
function readFields(value: unknown): RebaseFields | string {
	if (!isFields(value)) return "it has no rebase object";
	const { result, base, baseCommit, originalTip, conflicts, baseSaved } = value as Fields;
	if (typeof result !== "string" || !KINDS.includes(result)) return "its rebase result is not one this app knows";
	if (!isTextOrNull(base) || !isTextOrNull(baseCommit) || !isTextOrNull(originalTip)) return "its base or commits are not text";
	if (!Array.isArray(conflicts) || !conflicts.every((path): path is string => typeof path === "string")) return "its conflicts are not a list of paths";
	if (typeof baseSaved !== "boolean") return "it does not say whether the base was saved";
	return { result: result as Kind, base, baseCommit, originalTip, conflicts, baseSaved };
}

/**
 * What one run of `timber rebase --result-file` came to. `worktreePath` is the
 * registered path the rebase was asked for: a record about another worktree is
 * not used. A record counts only when its rebase object is complete and goes
 * with Timber's outcome and exit code. Anything else is a failure that ran,
 * because what the rebase did is then unknown. What Timber printed is passed on
 * for the details area and never read here.
 */
export function readRebaseResult(run: TimberRun, worktreePath: string): RebaseResult {
	const { result } = run;
	const asFailure = (diagnostic: string): RebaseResult => ({ outcome: "failed", ran: true, failure: { command: run.command, diagnostic, output: run.output } });
	if (result.outcome === "failed" && result.record === null) {
		return { outcome: "failed", ran: true, failure: failureOf(run)! };
	}
	const { record } = result;
	// A checked record has an integer exit code, equal to the one the process really had.
	const unreadable = (detail: string) => unknownResult(run, detail, record?.fields.exitCode as number | undefined);
	if (record === null) return unreadable("there is no record");
	if (result.outcome === "cancelled") return unreadable("it says it was cancelled, which a rebase never is");

	if (record.worktree !== null && record.worktree.path !== worktreePath) {
		return asFailure(`Timber answered with a result for ${record.worktree.path}, not for ${worktreePath}. It was not used, so what the rebase did is unknown. Check the worktree before trying again.`);
	}
	const fields = readFields(record.fields.rebase);
	if (typeof fields === "string") return unreadable(fields);

	const { result: kind } = fields;
	const succeeded = result.outcome === "succeeded";
	if ((kind === "rebased" || kind === "up-to-date") !== succeeded) return unreadable(`its result "${kind}" does not go with its outcome "${result.outcome}"`);
	if ((kind === "conflicts") !== (fields.conflicts.length > 0)) {
		return unreadable(kind === "conflicts" ? "it reports conflicts but lists no file" : `it lists conflicted files for a result of "${kind}"`);
	}

	const failure = succeeded ? null : failureOf(run)!;
	switch (kind) {
		case "rebased":
			return { outcome: "rebased", base: fields.base, baseCommit: fields.baseCommit, originalTip: fields.originalTip, baseSaved: fields.baseSaved };
		case "up-to-date":
			return { outcome: "up-to-date", base: fields.base, baseCommit: fields.baseCommit, baseSaved: fields.baseSaved };
		case "conflicts":
			return { outcome: "conflicts", base: fields.base, baseCommit: fields.baseCommit, originalTip: fields.originalTip, baseSaved: fields.baseSaved, conflicts: fields.conflicts, failure: failure! };
		case "refused":
			return { outcome: "refused", failure: failure! };
		case "failed":
			return { outcome: "failed", ran: true, failure: failure! };
	}
}

/** A record this app cannot use, in the voice of `readTimberResult`: what the rebase did is unknown. */
function unknownResult(run: TimberRun, detail: string, exitCode: number | undefined): RebaseResult {
	const exited = exitCode === undefined ? "ended" : `exited with code ${exitCode}`;
	return {
		outcome: "failed",
		ran: true,
		failure: {
			command: run.command,
			diagnostic: `timber rebase ${exited} and left a result this app cannot read (${detail}), so what it did is unknown. The details below show what it printed.`,
			output: run.output,
		},
	};
}

/**
 * A base ref as a person says it: `refs/remotes/origin/main` is `origin/main`,
 * `refs/heads/main` is `main`, and a commit's full hash is `a1b2c3d`. Null,
 * which means the base Timber saved for the worktree, reads as "its saved
 * base".
 */
export function shortBase(ref: string | null): string {
	if (ref === null) return "its saved base";
	if (isCommitHash(ref)) return shortCommit(ref);
	if (ref.startsWith("refs/remotes/")) return ref.slice("refs/remotes/".length);
	if (ref.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
	return ref;
}
