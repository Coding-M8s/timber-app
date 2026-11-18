import { type NewWorktreeRequest, type OpenWorktreeRequest, type ReportedWorktree, type WorktreeCommandResult, worktreeId } from "./model";
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

/** Everything after `timber` for creating a worktree. `resultFile` is put in as it is. */
export function newWorktreeArguments(request: NewWorktreeRequest, resultFile: string): string[] {
	const base = request.base === null ? [] : ["--base", request.base];
	return ["new", ...base, ...workflowArguments(request.workflow), "--no-setup", "--result-file", resultFile, "--no-editor", "--no-agent", "--", request.name];
}

/** Everything after `timber` for opening a worktree. `resultFile` is put in as it is. */
export function openWorktreeArguments(request: OpenWorktreeRequest, resultFile: string): string[] {
	return ["open", ...workflowArguments(request.workflow), "--no-setup", "--result-file", resultFile, "--no-editor", "--no-agent", "--", request.selector];
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
	switch (result.outcome) {
		case "cancelled":
			return { outcome: "cancelled" };
		case "succeeded":
			if (worktree) return { outcome: "succeeded", worktree, created: result.record.materialized, setupSkipped };
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
		case "failed":
			return {
				outcome: "failed",
				failure: { command: run.command, diagnostic: result.diagnostic, output: run.output },
				worktree,
				created: result.record?.materialized ?? false,
				setupSkipped,
			};
	}
}
