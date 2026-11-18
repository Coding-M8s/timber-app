import { type BranchSuggestion, type NewWorktreeRequest, type OpenWorktreeRequest, type Repository, type Worktree, type WorktreeCommandResult, worktreeId } from "../../shared/model";
import { RESULT_FILE_PLACEHOLDER, type ResultCommand, type TimberRun, describeTimberCommand, readTimberResult } from "../../shared/timber-result";
import { newWorktreeArguments, openWorktreeArguments, worktreeCommandResult } from "../../shared/worktree-commands";

/**
 * Acting out `timber new` and `timber open` for the mock engine. Nothing
 * runs. Each ending writes the record Timber would write, and the record is
 * read exactly as the main process reads a real one, so the interface is
 * tried against the same results it gets in the desktop app.
 */

/** How the acted commands end. */
export const commandEndings = {
	"succeeds": "Timber does what was asked",
	"refused": "Timber refuses before anything is created",
	"ambiguous": "Timber finds several matches for what was typed, and lists them",
	"setup-fails": "The setup script fails, after the worktree was created",
	"no-result": "Timber exits with 0 but leaves no result",
} as const;

export type CommandEnding = keyof typeof commandEndings;

export const isCommandEnding = (value: unknown): value is CommandEnding => typeof value === "string" && Object.hasOwn(commandEndings, value);

/** A worktree as Timber writes it in a record. */
function worktreeRecord(worktree: Worktree): object {
	const { path, canonicalPath, branch, head, detached, pathExists, changes } = worktree;
	return {
		path, canonicalPath, branch, head, detached, pathExists,
		isPrimary: worktree.primary,
		locked: worktree.locked ? { reason: null } : null,
		prunable: worktree.prunable ? { reason: null } : null,
		status: changes.kind === "known" ? { ...changes, ignored: [] } : changes,
	};
}

/** Reads acted results for one command in one repository. */
function stage(command: ResultCommand, repository: Repository, shown: string) {
	const record = (fields: object) => JSON.stringify({
		schemaVersion: 1, command, outcome: "succeeded", exitCode: 0, materialized: false, diagnostic: null, worktree: null,
		repository: { commonGitDir: `${repository.path}/.git`, primaryWorktreeRoot: repository.path, currentWorktreeRoot: repository.path },
		...fields,
	});
	const read = (text: string | null, exitCode: number, printed: string): WorktreeCommandResult => {
		const run: TimberRun = { command: shown, result: readTimberResult(command, text, exitCode), output: { text: printed, truncated: false } };
		return worktreeCommandResult(run);
	};
	return {
		succeeded: (fields: object, printed: string) => read(record(fields), 0, printed),
		failed: (diagnostic: string, fields: object = {}, printed = "") => read(record({ outcome: "failed", exitCode: 1, diagnostic, ...fields }), 1, `${printed}error: ${diagnostic}\n`),
		noResult: (printed: string) => read(null, 0, printed),
	};
}

const setupDiagnostic = (path: string, workflow: string | undefined) =>
	`Setup post_create step 1 failed (exit code 1). The branch/worktree and setup files are retained at "${path}". Fix the hook or its prerequisites, then retry all setup steps with: timber open --setup${workflow === undefined ? "" : ` --workflow ${workflow}`} -- '${path}'`;

/** Timber's words for a workflow its settings do not have, word for word. */
export const UNKNOWN_WORKFLOW_DIAGNOSTIC = "Unknown workflow. Restore its definition or assign another configured workflow with --workflow <name>.";

const SETUP_OUTPUT = "bun install v1.4.4\nerror: lockfile had changes, but lockfile is frozen\n";

/** The branch the mock makes of what was typed. The real Timber has its own rules. */
function branchFor(name: string): string {
	const trimmed = name.trim();
	return /\s/.test(trimmed) ? trimmed.toLowerCase().replaceAll(/\s+/g, "-") : trimmed;
}

/** Timber's guidance when what was typed matches more than one branch. */
const ambiguousDiagnostic = (input: string) =>
	`Input "${input}" matches 2 targets. Did you mean one of these exact branches or paths?\n  fork/${input}\n  origin/${input}`;

/** The base the pretend Timber saves for a new worktree: the one asked for, or `origin/main`, as a canonical ref. */
function savedBaseFor(base: string | null): Worktree["base"] {
	const chosen = base ?? "origin/main";
	return { kind: "assigned", ref: chosen.startsWith("refs/") ? chosen : `refs/remotes/${chosen}` };
}

function newWorktreeIn(repository: Repository, branch: string, base: Worktree["base"], sync: Worktree["sync"] = { kind: "unpublished" }): Worktree {
	const path = `${repository.path}-worktrees/${branch.replaceAll("/", "-")}`;
	return {
		id: worktreeId(`${repository.path}/.git`, { path, canonicalPath: path }),
		path,
		canonicalPath: path,
		branch,
		head: "0000000000000000000000000000000000000000",
		primary: false,
		detached: false,
		locked: false,
		prunable: false,
		pathExists: true,
		changes: { kind: "known", modified: [], untracked: [] },
		base,
		issue: null,
		sync,
	};
}

/**
 * Act out `timber new`. `created` is the worktree to add to the pretend
 * disk, or null when the command made none. A branch that is checked out
 * already is refused whatever the ending, as Timber does, and so is a
 * workflow that is not in `workflows`, the names the repository has.
 */
export function actOutNew(
	repository: Repository,
	request: NewWorktreeRequest,
	ending: CommandEnding,
	workflows: readonly string[] = [],
): { result: WorktreeCommandResult; created: Worktree | null } {
	const acted = stage("new", repository, describeTimberCommand(newWorktreeArguments(request, RESULT_FILE_PLACEHOLDER)));
	const refused = (diagnostic: string) => ({ result: acted.failed(diagnostic), created: null });
	if (request.workflow !== undefined && !workflows.includes(request.workflow)) return refused(UNKNOWN_WORKFLOW_DIAGNOSTIC);
	const branch = branchFor(request.name);
	if (branch === "") return refused("Invalid branch name: branch name must not be blank.");
	const existing = repository.worktrees.find(worktree => worktree.branch === branch);
	if (existing) return refused(`Branch ${branch} is already checked out at ${existing.path}. Use timber open instead.`);
	if (ending === "refused") return refused(`Base branch ${request.base ?? "main"} is missing or ambiguous. Select an exact branch.`);
	if (ending === "ambiguous") return refused(ambiguousDiagnostic(request.name));

	const created = newWorktreeIn(repository, branch, savedBaseFor(request.base));
	const fields = { materialized: true, worktree: worktreeRecord(created) };
	const printed = `Created ${branch} at ${created.path}\n`;
	switch (ending) {
		case "succeeds":
			return { result: acted.succeeded(fields, printed), created };
		case "setup-fails":
			return { result: acted.failed(setupDiagnostic(created.path, request.workflow), fields, printed + SETUP_OUTPUT), created };
		case "no-result":
			return { result: acted.noResult(printed), created };
	}
}

/**
 * Act out `timber open`. The pretend Timber knows a worktree by its branch or
 * its path, and a branch without a worktree by the name `branches` lists it
 * under. `created` is the worktree to add to the pretend disk, or null when
 * the command made none. A workflow that is not in `workflows` is refused.
 */
export function actOutOpen(
	repository: Repository,
	request: OpenWorktreeRequest,
	ending: CommandEnding,
	branches: readonly BranchSuggestion[] = [],
	workflows: readonly string[] = [],
): { result: WorktreeCommandResult; created: Worktree | null } {
	const acted = stage("open", repository, describeTimberCommand(openWorktreeArguments(request, RESULT_FILE_PLACEHOLDER)));
	const { selector } = request;
	const refused = (diagnostic: string) => ({ result: acted.failed(diagnostic), created: null });
	if (request.workflow !== undefined && !workflows.includes(request.workflow)) return refused(UNKNOWN_WORKFLOW_DIAGNOSTIC);
	if (ending === "ambiguous") return refused(ambiguousDiagnostic(selector));

	const found = repository.worktrees.find(worktree => worktree.path === selector || worktree.branch === selector);
	if (found) {
		const fields = { worktree: worktreeRecord(found) };
		const printed = `Opened existing worktree at ${found.path}\n`;
		switch (ending) {
			case "succeeds":
				return { result: acted.succeeded(fields, printed), created: null };
			case "refused":
				return refused(`Worktree ${found.path} is missing or unverifiable. Check it before opening it again.`);
			case "setup-fails":
				// Without --setup an existing worktree runs no setup, so there is nothing to fail.
				return { result: request.setup ? acted.failed(setupDiagnostic(found.path, request.workflow), fields, SETUP_OUTPUT) : acted.succeeded(fields, printed), created: null };
			case "no-result":
				return { result: acted.noResult(printed), created: null };
		}
	}

	const branch = branches.find(candidate => candidate.selector === selector);
	if (!branch || ending === "refused") return refused(`No existing branch or worktree matches "${selector}". Check the exact branch or absolute worktree path.`);
	// A remote-tracking branch becomes a local branch that follows it. A new worktree always gets its setup.
	const name = branch.kind === "remote" ? selector.slice(selector.indexOf("/") + 1) : selector;
	// As Timber does: opening a branch saves no base.
	const created = newWorktreeIn(repository, name, { kind: "unassigned" }, branch.kind === "remote" ? { kind: "tracking", upstream: selector, ahead: 0, behind: 0 } : { kind: "unpublished" });
	const fields = { materialized: true, worktree: worktreeRecord(created) };
	const printed = `Created worktree at ${created.path}\n`;
	switch (ending) {
		case "succeeds":
			return { result: acted.succeeded(fields, printed), created };
		case "setup-fails":
			return { result: acted.failed(setupDiagnostic(created.path, request.workflow), fields, printed + SETUP_OUTPUT), created };
		case "no-result":
			return { result: acted.noResult(printed), created };
	}
}
