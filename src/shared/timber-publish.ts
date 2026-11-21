import type { SyncActionResult } from "./sync-actions";
import { type Fields, isFields, isTextOrNull } from "./timber-ls";
import { type TimberRun, failureOf } from "./timber-result";

/**
 * `timber publish` with a result file, the command behind Push, and what its
 * record means to the interface. Pure: the interface words the command from
 * the same function the main process runs it from (see
 * src/bun/sync-actions.ts), so the command shown is the command that runs.
 *
 * Timber owns every rule about what may be pushed and where: it never
 * force-pushes, never asks for a password, and refuses a remote branch that
 * has moved on. Nothing here repeats one. The record says how the push ended,
 * and this reads it.
 */

/**
 * Everything after `timber`: the result file, then `--`, then the worktree's
 * registered path as one argument, so a path that starts with a dash is never
 * read as an option. `resultFile` is put in as it is.
 */
export function publishResultArguments(worktree: string, resultFile: string): string[] {
	return ["publish", "--result-file", resultFile, "--", worktree];
}

type Kind = "published" | "up-to-date" | "refused" | "failed";

const KINDS: readonly string[] = ["published", "up-to-date", "refused", "failed"];

/** The `publish` object of a record, or why it cannot be used. Only `result` is branched on; the rest must be text or null. */
function readKind(value: unknown): Kind | string {
	if (!isFields(value)) return "it has no publish object";
	const { result, remote, upstream, pushedCommit } = value as Fields;
	if (typeof result !== "string" || !KINDS.includes(result)) return "its publish result is not one this app knows";
	if (!isTextOrNull(remote) || !isTextOrNull(upstream) || !isTextOrNull(pushedCommit)) return "its remote, upstream, or commit is not text";
	return result as Kind;
}

/**
 * What one run of `timber publish --result-file` came to, as a sync action's
 * result. `worktreePath` is the registered path the push was asked for: a
 * record about another worktree is not used. A record counts only when its
 * publish object is complete and goes with Timber's outcome.
 *
 * - `published` is done and moved; `up-to-date` is done and did not move.
 * - `refused` is a refusal: Timber says nothing was pushed and no local ref
 *   changed, and its diagnostic says why, such as a remote branch that moved on.
 * - `failed`, or a record this app cannot read, is a failure that ran. Timber's
 *   diagnostic says what broke, such as the network or a sign-in. Whether
 *   anything reached the remote is read from Git again afterwards.
 *
 * What Timber printed is passed on for the details area and never read here.
 */
export function readPublishResult(run: TimberRun, worktreePath: string): SyncActionResult {
	const { result } = run;
	const failed = (diagnostic: string): SyncActionResult => ({ outcome: "failed", action: "push", ran: true, failure: { command: run.command, diagnostic, output: run.output } });
	if (result.outcome === "failed" && result.record === null) return { outcome: "failed", action: "push", ran: true, failure: failureOf(run)! };
	const { record } = result;
	const exitCode = record?.fields.exitCode as number | undefined;
	const unreadable = (detail: string) => failed(
		`timber publish ${exitCode === undefined ? "ended" : `exited with code ${exitCode}`} and left a result this app cannot read (${detail}), so what it did is unknown. The details below show what it printed.`,
	);
	if (record === null) return unreadable("there is no record");
	if (result.outcome === "cancelled") return unreadable("it says it was cancelled, which a push never is");
	if (record.worktree !== null && record.worktree.path !== worktreePath) {
		return failed(`Timber answered with a result for ${record.worktree.path}, not for ${worktreePath}. It was not used, so what the push did is unknown.`);
	}
	const kind = readKind(record.fields.publish);
	if (!KINDS.includes(kind)) return unreadable(kind);
	const succeeded = result.outcome === "succeeded";
	if ((kind === "published" || kind === "up-to-date") !== succeeded) return unreadable(`its result "${kind}" does not go with its outcome "${result.outcome}"`);
	switch (kind as Kind) {
		case "published":
			return { outcome: "done", action: "push", moved: true, fetchFailure: null };
		case "up-to-date":
			return { outcome: "done", action: "push", moved: false, fetchFailure: null };
		case "refused":
			return { outcome: "refused", action: "push", reason: "timber-refused", fetchFailure: null, failure: failureOf(run)! };
		case "failed":
			return { outcome: "failed", action: "push", ran: true, failure: failureOf(run)! };
	}
}
