import type { SavedBase, TimberFailure } from "./model";
import { type Fields, isFields, readBase } from "./timber-ls";
import { type TimberRun, failureOf } from "./timber-result";

/**
 * `timber base --set` with a result file, and what its record means to the
 * interface. Pure: the interface words the command from the same function the
 * main process runs it from (see src/bun/worktree-commands.ts), so the command
 * shown is the command that runs.
 *
 * Timber owns every rule about which base may be saved. Nothing here repeats
 * one: the record says how the command ended, and this reads it. The command
 * changes only Timber's saved base, never the branch, the index, or files.
 */

/** Save a base for one worktree. */
export interface SetBaseRequest {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. It is the selector given to Timber. */
	worktree: string;
	/** The base to save, given to Timber as `--set`, in any form Timber takes. */
	base: string;
}

/** What was typed as the base, with the spaces around it left off. Null when nothing is left, which cannot run. */
export function baseFromText(text: string): string | null {
	const base = text.trim();
	return base === "" ? null : base;
}

/**
 * Everything after `timber`: the options first, then `--`, then the
 * worktree's registered path as one argument, so a path that starts with a
 * dash is never read as an option. `resultFile` is put in as it is.
 */
export function setBaseResultArguments(request: Pick<SetBaseRequest, "worktree" | "base">, resultFile: string): string[] {
	return ["base", "--set", request.base, "--result-file", resultFile, "--", request.worktree];
}

/** How one `timber base --set` ended, as the record says. */
export type SetBaseResult =
	/** Timber saved the base. `current` is the base read back after, a ref or a commit, and `previous` the one before. */
	| { outcome: "set"; previous: SavedBase; current: SavedBase & { kind: "assigned" | "commit" } }
	/** Timber declined, and changed nothing. */
	| { outcome: "refused"; failure: TimberFailure }
	/** The command failed. `ran` is false only when the app refused before it ran anything. */
	| { outcome: "failed"; ran: boolean; failure: TimberFailure };

type Kind = "set" | "cleared" | "refused" | "failed";

const KINDS: readonly string[] = ["set", "cleared", "refused", "failed"];

interface BaseChangeFields {
	result: Kind;
	previous: SavedBase | null;
	current: SavedBase | null;
}

/** A base as the record gives it: null, or one of the three kinds. Anything else cannot be used. */
function readRecordedBase(value: unknown): SavedBase | null | "unreadable" {
	if (value === null) return null;
	// A missing field is not allowed here, unlike in a listing, where it means a Timber from before bases.
	if (value === undefined) return "unreadable";
	return readBase(value);
}

/** The `baseChange` object of a record, or why it cannot be used. */
function readFields(value: unknown): BaseChangeFields | string {
	if (!isFields(value)) return "it has no baseChange object";
	const { action, result } = value as Fields;
	if (action !== "set") return "it is not a record of setting a base";
	if (typeof result !== "string" || !KINDS.includes(result)) return "its base change result is not one this app knows";
	const previous = readRecordedBase(value.previous);
	const current = readRecordedBase(value.current);
	if (previous === "unreadable" || current === "unreadable") return "its previous or current base is not a saved base";
	return { result: result as Kind, previous, current };
}

/**
 * What one run of `timber base --set --result-file` came to. `worktreePath`
 * is the registered path the base was asked for: a record about another
 * worktree is not used. A record counts only when its `baseChange` object is
 * complete and goes with Timber's outcome and exit code, and a base that was
 * set reads back as a ref or a commit. Anything else is a failure that ran, because
 * what the command did is then unknown. What Timber printed is passed on for
 * the details area and never read here.
 */
export function readSetBaseResult(run: TimberRun, worktreePath: string): SetBaseResult {
	const { result } = run;
	if (result.outcome === "failed" && result.record === null) {
		return { outcome: "failed", ran: true, failure: failureOf(run)! };
	}
	const { record } = result;
	const unreadable = (detail: string) => unknownResult(run, detail, record?.fields.exitCode as number | undefined);
	if (record === null) return unreadable("there is no record");
	if (result.outcome === "cancelled") return unreadable("it says it was cancelled, which setting a base never is");

	if (record.worktree !== null && record.worktree.path !== worktreePath) {
		return {
			outcome: "failed",
			ran: true,
			failure: {
				command: run.command,
				diagnostic: `Timber answered with a result for ${record.worktree.path}, not for ${worktreePath}. It was not used, so what was saved is unknown. Check the worktree's base before trying again.`,
				output: run.output,
			},
		};
	}
	const fields = readFields(record.fields.baseChange);
	if (typeof fields === "string") return unreadable(fields);

	const { result: kind } = fields;
	const succeeded = result.outcome === "succeeded";
	if (kind === "cleared") return unreadable("it says the base was cleared, which --set never does");
	if ((kind === "set") !== succeeded) return unreadable(`its result "${kind}" does not go with its outcome "${result.outcome}"`);

	switch (kind) {
		case "set": {
			const { previous, current } = fields;
			if (previous === null || (current?.kind !== "assigned" && current?.kind !== "commit")) return unreadable("it says the base was set but does not report the saved base");
			return { outcome: "set", previous, current };
		}
		case "refused":
			return { outcome: "refused", failure: failureOf(run)! };
		case "failed":
			return { outcome: "failed", ran: true, failure: failureOf(run)! };
	}
}

/** A record this app cannot use, in the voice of `readTimberResult`: what the command did is unknown. */
function unknownResult(run: TimberRun, detail: string, exitCode: number | undefined): SetBaseResult {
	const exited = exitCode === undefined ? "ended" : `exited with code ${exitCode}`;
	return {
		outcome: "failed",
		ran: true,
		failure: {
			command: run.command,
			diagnostic: `timber base ${exited} and left a result this app cannot read (${detail}), so what it did is unknown. The details below show what it printed.`,
			output: run.output,
		},
	};
}
