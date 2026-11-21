import { isCommitHash } from "../../shared/file-changes";
import type { Repository, Worktree } from "../../shared/model";
import { type RebaseRequest, type RebaseResult, readRebaseResult, rebaseResultArguments } from "../../shared/timber-rebase";
import { RESULT_FILE_PLACEHOLDER, type TimberRun, describeTimberCommand, readTimberResult } from "../../shared/timber-result";

/**
 * Acting out `timber rebase --result-file` for the mock engine. Nothing runs
 * and no branch changes. Each ending writes the record Timber would write, and
 * the record is read exactly as the main process reads a real one, so the
 * interface is tried against the same results it gets in the desktop app.
 */

/** How the acted rebases end. */
export const rebaseEndings = {
	"rebased": "Timber rebases the branch",
	"up-to-date": "The branch already contains its base",
	"conflicts": "Git stops on conflicts, and the rebase is left paused",
	"refused": "Timber refuses before it starts",
	"failed": "Git fails for a reason other than conflicts",
	"no-result": "Timber exits with 1 but leaves no result",
} as const;

export type RebaseEnding = keyof typeof rebaseEndings;

export const isRebaseEnding = (value: unknown): value is RebaseEnding => typeof value === "string" && Object.hasOwn(rebaseEndings, value);

/** The paths the pretend conflicts name. */
export const MOCK_CONFLICTS = ["src/app.ts", "docs/read me.md"];

const TIP = "1111111111111111111111111111111111111111";
const BASE_COMMIT = "2222222222222222222222222222222222222222";

function worktreeRecord(worktree: Worktree): object {
	const { path, canonicalPath, branch, head, detached, pathExists, changes } = worktree;
	return {
		path, canonicalPath, branch, head, detached, pathExists,
		isPrimary: worktree.primary,
		locked: null,
		prunable: null,
		status: changes.kind === "known" ? { ...changes, ignored: [] } : changes,
	};
}

/**
 * Act out one `timber rebase`. The repository is the one from the pretend
 * list and `worktree` is one it lists whose folder is there. A worktree with
 * modified or untracked files is refused whatever the ending, as Timber does.
 * The base is what was typed, or `refs/heads/main` for the saved one. A full
 * commit hash stays a hash, in lowercase, as Timber reports a commit base.
 */
export function actOutRebase(repository: Repository, worktree: Worktree, request: RebaseRequest, ending: RebaseEnding): RebaseResult {
	const shown = describeTimberCommand(rebaseResultArguments(request, RESULT_FILE_PLACEHOLDER));
	const dirty = worktree.changes.kind === "known" && (worktree.changes.modified.length > 0 || worktree.changes.untracked.length > 0);
	const requested = request.onto;
	const base = requested === null ? "refs/heads/main"
		: isCommitHash(requested.toLowerCase()) ? requested.toLowerCase()
		: requested.startsWith("refs/") ? requested : requested.includes("/") ? `refs/remotes/${requested}` : `refs/remotes/origin/${requested}`;
	const baseFields = { base, baseCommit: BASE_COMMIT, originalTip: TIP, conflicts: [] as string[], baseSaved: true };

	const written = (rebase: Record<string, unknown>, outcome: "succeeded" | "failed", diagnostic: string | null, printed: string): RebaseResult => {
		const failed = outcome === "failed";
		const text = JSON.stringify({
			schemaVersion: 1, command: "rebase", outcome, exitCode: failed ? 1 : 0, materialized: false, diagnostic,
			repository: { commonGitDir: `${repository.path}/.git`, primaryWorktreeRoot: repository.path, currentWorktreeRoot: repository.path },
			worktree: worktreeRecord(worktree),
			rebase,
		});
		const run: TimberRun = { command: shown, result: readTimberResult("rebase", text, failed ? 1 : 0), output: { text: printed, truncated: false } };
		return readRebaseResult(run, worktree.path);
	};
	const refused = (diagnostic: string) =>
		written({ result: "refused", base: null, baseCommit: null, originalTip: null, conflicts: [], baseSaved: false }, "failed", diagnostic, `error: ${diagnostic}\n`);

	if (ending === "no-result") {
		const run: TimberRun = { command: shown, result: readTimberResult("rebase", null, 1), output: { text: "error: something went wrong\n", truncated: false } };
		return readRebaseResult(run, worktree.path);
	}
	if (dirty || ending === "refused") {
		return refused(dirty
			? "Rebase requires a clean index/worktree with no staged, unstaged, unmerged or untracked files; preserve them first."
			: `Base ${base} is missing or ambiguous. Select an exact branch.`);
	}
	switch (ending) {
		case "rebased":
			return written({ result: "rebased", ...baseFields }, "succeeded", null, `Rebased ${worktree.branch ?? worktree.path} onto ${base}\n`);
		case "up-to-date":
			return written({ result: "up-to-date", ...baseFields }, "succeeded", null, `${worktree.branch ?? worktree.path} is already up to date with ${base}\n`);
		case "conflicts": {
			const diagnostic = "Rebase paused with conflicts; resolve and stage them, then continue or abort with Git in the worktree.";
			const printed = `error: Rebase paused with conflicts. Workspace retained at ${worktree.path}; branch ${worktree.branch ?? ""}, base ${base}.\n${MOCK_CONFLICTS.map(path => `  "${path}"`).join("\n")}\n`;
			return written({ result: "conflicts", ...baseFields, conflicts: MOCK_CONFLICTS }, "failed", diagnostic, printed);
		}
		default: {
			const diagnostic = "Git rebase failed or was interrupted; inspect the worktree with Git before retrying.";
			return written({ result: "failed", ...baseFields, baseSaved: false }, "failed", diagnostic, "error: Git rebase failed (hook rejection or another non-conflict error).\n");
		}
	}
}
