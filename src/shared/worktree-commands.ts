import { type Assignment, type AssignmentResult, type NewWorktreeRequest, type OpenWorktreeRequest, type ReportedWorktree, type WorktreeCommandResult, worktreeId } from "./model";
import { displayText, isFields } from "./timber-record";
import type { ResultRecord, TimberRun } from "./timber-result";

/**
 * The `timber new` and `timber open` commands the app runs, and what their
 * results mean to the interface. Pure: the interface words a command from the
 * same function the main process runs it from (see src/bun/worktree-commands.ts),
 * so the command shown is the command that runs.
 *
 * Options come first, then `--`, then the person's text as one argument, so
 * text that starts with a dash is never read as an option. Both commands
 * always pass `--no-editor --no-agent`: the app never lets Timber start a
 * launcher, and Timber requires both beside `--result-file`. A picked
 * workflow is `--workflow <name>`, among the options.
 *
 * Both also pass `--no-setup`, so they answer as soon as the worktree exists
 * and never wait for setup scripts. The app runs setup afterwards in a
 * session in the worktree (`worktreeSetupArguments`), where it can be
 * watched, and nothing in the window waits for it. Timber does not remember
 * a worktree's workflow, so the setup session passes the picked one again.
 */

const workflowArguments = (workflow: string | undefined): string[] => (workflow === undefined ? [] : ["--workflow", workflow]);

/**
 * Everything after `timber` for creating a worktree. `resultFile` is put in
 * as it is. Starting work on an issue adds, among the options, the branch
 * picked in place of Timber's (`--branch <name>`), `-c` for a closed issue,
 * and `--assign` or `--reassign`.
 */
export function newWorktreeArguments(request: NewWorktreeRequest, resultFile: string): string[] {
	const base = request.base === null ? [] : ["--base", request.base];
	const branch = request.branch === undefined ? [] : ["--branch", request.branch];
	const closed = request.allowClosed === true ? ["-c"] : [];
	const assign = request.assign === undefined ? [] : [`--${request.assign}`];
	return ["new", ...base, ...workflowArguments(request.workflow), ...branch, ...closed, ...assign, "--no-setup", "--result-file", resultFile, "--no-editor", "--no-agent", "--", request.name];
}

/** Everything after `timber` for opening a worktree. `resultFile` is put in as it is. An issue to link comes first, as `--issue <selector>`. */
export function openWorktreeArguments(request: OpenWorktreeRequest, resultFile: string): string[] {
	const issue = request.issue === undefined ? [] : ["--issue", request.issue];
	return ["open", ...issue, ...workflowArguments(request.workflow), "--no-setup", "--result-file", resultFile, "--no-editor", "--no-agent", "--", request.selector];
}

/**
 * Everything after `timber` for running a worktree's setup scripts, in a
 * session in that worktree: the picked workflow, whose scripts run after the
 * ordinary ones, and the exact registered path as one argument. No result
 * file, because the session shows how it went.
 */
export function worktreeSetupArguments(worktree: string, workflow?: string): string[] {
	return ["open", "--setup", ...workflowArguments(workflow), "--no-editor", "--no-agent", "--", worktree];
}

/** The worktree in a record, or null when the record names none or does not say which repository it is in. */
function reportedWorktree(record: ResultRecord | null): ReportedWorktree | null {
	if (!record?.worktree || !record.repository) return null;
	const { path, branch } = record.worktree;
	return { id: worktreeId(record.repository.commonGitDir, record.worktree), path, branch };
}

const ASSIGNMENT_RESULTS: readonly AssignmentResult[] = ["not-attempted", "assigned", "reassigned", "already-mine", "failed"];
const NAME_LIMIT = 100;

/**
 * The record's `assignment`, or undefined when there is none or it cannot be
 * read. It is an additive field Timber writes only with `--assign` or
 * `--reassign`, so it never makes a record unreadable.
 */
export function readAssignment(value: unknown): Assignment | undefined {
	if (!isFields(value)) return undefined;
	const { result, me, previous, diagnostic } = value;
	if (typeof result !== "string" || !(ASSIGNMENT_RESULTS as readonly string[]).includes(result)) return undefined;
	if (typeof me !== "string" || !Array.isArray(previous) || !previous.every(name => typeof name === "string")) return undefined;
	if (diagnostic !== null && typeof diagnostic !== "string") return undefined;
	return {
		result: result as AssignmentResult,
		me: displayText(me, NAME_LIMIT),
		previous: (previous as string[]).map(name => displayText(name, NAME_LIMIT)),
		diagnostic: diagnostic === null ? null : displayText(diagnostic, 300),
	};
}

/** What an older Timber says about an option it does not have. */
const UNKNOWN_OPTION = /error: unknown option '(--branch|--assign|--reassign)'/;

/** Said in place of Timber's own words when it does not know an option Start work passes. */
export const unknownStartWorkOption = (option: string) =>
	`This Timber does not know ${option}. Starting work on an issue needs a Timber with --branch and --assign, so update Timber or use one built from its main branch. Nothing was created.`;

/**
 * What one run of `timber new` or `timber open` came to. Only a checked
 * record that names a worktree counts as success. What the command printed is
 * passed on for the details area and never read here.
 */
export function worktreeCommandResult(run: TimberRun): WorktreeCommandResult {
	const { result } = run;
	const worktree = reportedWorktree(result.record);
	// Timber says so only when it skipped setup scripts that are configured.
	const setupSkipped = result.record?.fields.setupSkipped === true;
	const read = readAssignment(result.record?.fields.assignment);
	const assignment = read === undefined ? {} : { assignment: read };
	switch (result.outcome) {
		case "cancelled":
			return { outcome: "cancelled" };
		case "succeeded":
			if (worktree) return { outcome: "succeeded", worktree, created: result.record.materialized, setupSkipped, ...assignment };
			return {
				outcome: "failed",
				failure: {
					command: run.command,
					diagnostic: "Timber reported success without saying which worktree, so what happened is unknown. Check the list before trying anything else.",
					output: run.output,
				},
				worktree: null,
				created: result.record.materialized,
				setupSkipped,
			};
		case "failed": {
			// An older Timber stops at an option it does not know, before it writes a record.
			const unknown = result.record === null ? UNKNOWN_OPTION.exec(run.output.text) : null;
			return {
				outcome: "failed",
				failure: { command: run.command, diagnostic: unknown ? unknownStartWorkOption(unknown[1]!) : result.diagnostic, output: run.output },
				worktree,
				created: result.record?.materialized ?? false,
				setupSkipped,
				...assignment,
			};
		}
	}
}
