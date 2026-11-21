import { type BranchSuggestion, type NewWorktreeRequest, type OpenWorktreeRequest, type Repository, type Worktree, type WorktreeCommandResult, worktreeId } from "../../shared/model";
import { isCommitHash } from "../../shared/file-changes";
import { RESULT_FILE_PLACEHOLDER, type ResultCommand, type TimberRun, describeTimberCommand, readTimberResult } from "../../shared/timber-result";
import { newWorktreeArguments, openWorktreeArguments, worktreeCommandResult } from "../../shared/worktree-commands";
import { sampleIssueLink } from "./mock-issue-lists";

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
	"stops-after-create": "Timber creates the worktree, then stops before setup",
	"setup-fails": "Timber creates the worktree, and its setup script then fails in the setup terminal",
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

const stoppedDiagnostic = (path: string) =>
	`Could not save the base association; created worktree retained at ${path}. Setup and launch have not run. Inspect its private Git metadata and permissions, then retry with:\ntimber rebase --base refs/remotes/origin/main -- '${path}'`;

/** Timber's words for a workflow its settings do not have, word for word. */
export const UNKNOWN_WORKFLOW_DIAGNOSTIC = "Unknown workflow. Restore its definition or assign another configured workflow with --workflow <name>.";

/** What Timber prints when `--no-setup` skipped the pretend setup script every mock repository has. */
const skippedNote = (path: string, workflow: string | undefined) =>
	`Setup skipped (--no-setup). Run it with: timber open --setup${workflow === undefined ? "" : ` --workflow ${workflow}`} -- '${path}'\n`;

/** The branch the mock makes of what was typed. The real Timber has its own rules. */
function branchFor(name: string): string {
	const trimmed = name.trim();
	// An issue gets a branch named after its key, as Timber names one after the issue's title.
	const issue = /^(github|jira|linear):(\S+)$/.exec(trimmed);
	if (issue) return issue[1] === "github" ? `GH-${issue[2]}` : issue[2]!;
	return /\s/.test(trimmed) ? trimmed.toLowerCase().replaceAll(/\s+/g, "-") : trimmed;
}

/** Timber's guidance when what was typed matches more than one branch. */
const ambiguousDiagnostic = (input: string) =>
	`Input "${input}" matches 2 targets. Did you mean one of these exact branches or paths?\n  fork/${input}\n  origin/${input}`;

/**
 * The base the pretend Timber saves for a new worktree: the one asked for, or
 * `origin/main`, as a canonical ref. A full commit hash, in any case, is saved
 * as a commit base in lowercase, as Timber does.
 */
function savedBaseFor(base: string | null): Worktree["base"] {
	const chosen = base ?? "origin/main";
	if (isCommitHash(chosen.toLowerCase())) return { kind: "commit", commit: chosen.toLowerCase() };
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
		case "setup-fails":
			// With --no-setup Timber answers before setup, which fails later, in its session.
			return { result: acted.succeeded({ ...fields, setupSkipped: true }, printed + skippedNote(created.path, request.workflow)), created };
		case "stops-after-create":
			return { result: acted.failed(stoppedDiagnostic(created.path), fields, printed), created };
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
): { result: WorktreeCommandResult; created: Worktree | null; replaced?: Worktree } {
	const acted = stage("open", repository, describeTimberCommand(openWorktreeArguments(request, RESULT_FILE_PLACEHOLDER)));
	const { selector } = request;
	const refused = (diagnostic: string) => ({ result: acted.failed(diagnostic), created: null });
	if (request.workflow !== undefined && !workflows.includes(request.workflow)) return refused(UNKNOWN_WORKFLOW_DIAGNOSTIC);
	if (ending === "ambiguous") return refused(ambiguousDiagnostic(selector));
	// As Timber does with --issue: the issue is looked up once, before anything is created.
	const link = request.issue === undefined ? null : sampleIssueLink(request.issue);
	if (request.issue !== undefined && link === null) return refused(`Could not find ${request.issue}. Nothing was changed.`);

	let found = repository.worktrees.find(worktree => worktree.path === selector || worktree.branch === selector);
	let replaced: Worktree | undefined;
	if (found && link !== null) {
		if (found.primary) return refused("The primary worktree cannot be linked to an issue.");
		const before = found.issue;
		if (before?.kind === "linked" && (before.tracker !== link.tracker || before.key !== link.key)) {
			return refused(`This worktree is already linked to ${before.tracker}:${before.key}; nothing was changed. Rerun with --replace-issue to replace the link.`);
		}
		found = { ...found, issue: link };
		replaced = found;
	}
	if (found) {
		const fields = { worktree: worktreeRecord(found) };
		const printed = `Opened existing worktree at ${found.path}\n`;
		const linked = replaced === undefined ? {} : { replaced };
		switch (ending) {
			case "succeeds":
				return { result: acted.succeeded(fields, printed), created: null, ...linked };
			case "refused":
				return refused(`Worktree ${found.path} is missing or unverifiable. Check it before opening it again.`);
			case "setup-fails":
			case "stops-after-create":
				// An existing worktree runs no setup and creates nothing, so there is nothing to fail.
				return { result: acted.succeeded(fields, printed), created: null, ...linked };
			case "no-result":
				return { result: acted.noResult(printed), created: null };
		}
	}

	// As Timber does: an exact local branch, then an exact remote branch, also when named without its remote.
	const branch = branches.find(candidate => candidate.selector === selector)
		?? branches.find(candidate => candidate.kind === "remote" && candidate.selector === `origin/${selector}`);
	if (!branch || ending === "refused") return refused(`No existing branch or worktree matches "${selector}". Check the exact branch or absolute worktree path.`);
	// A remote-tracking branch becomes a local branch that follows it. A new worktree always leaves its setup to the app.
	const name = branch.kind === "remote" ? branch.selector.slice(branch.selector.indexOf("/") + 1) : branch.selector;
	// As Timber does: opening a branch saves no base. With --issue, it saves the link.
	const created = { ...newWorktreeIn(repository, name, { kind: "unassigned" }, branch.kind === "remote" ? { kind: "tracking", upstream: branch.selector, ahead: 0, behind: 0 } : { kind: "unpublished" }), issue: link };
	const fields = { materialized: true, worktree: worktreeRecord(created) };
	const printed = `Created worktree at ${created.path}\n`;
	switch (ending) {
		case "succeeds":
		case "setup-fails":
			return { result: acted.succeeded({ ...fields, setupSkipped: true }, printed + skippedNote(created.path, request.workflow)), created };
		case "stops-after-create":
			return { result: acted.failed(stoppedDiagnostic(created.path), fields, printed), created };
		case "no-result":
			return { result: acted.noResult(printed), created };
	}
}
