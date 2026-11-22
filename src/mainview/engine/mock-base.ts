import type { BaseCounts, BranchSuggestion, Repository, SavedBase, Worktree } from "../../shared/model";
import { type SetBaseRequest, type SetBaseResult, readSetBaseResult, setBaseResultArguments } from "../../shared/timber-base";
import { isCommitHash, savedBaseRef } from "../../shared/file-changes";
import { savedBaseSelector } from "../../shared/rebase-command";
import { RESULT_FILE_PLACEHOLDER, type TimberRun, describeTimberCommand, readTimberResult } from "../../shared/timber-result";

/**
 * The counts against a saved base, as the main process reads them: none for a
 * base Git cannot compare with or a worktree with no commit, and otherwise
 * level with the base unless a sample says more.
 */
export function sampleBaseCounts(base: SavedBase | null, head: string | null): BaseCounts | null {
	// The mock keeps no history, so a base it has no sample counts for is shown level with the worktree.
	return savedBaseRef(base).ok && head !== null && isCommitHash(head) ? { kind: "counted", ahead: 0, behind: 0 } : null;
}

/**
 * Acting out `timber base --set --result-file` for the mock engine. Nothing
 * runs: this writes the record Timber would write, and the same code as in the
 * desktop app reads it, so the dialog shows what it would show there.
 */

function worktreeRecord(worktree: Worktree, base: SavedBase): object {
	const { path, canonicalPath, branch, head, detached, pathExists, changes } = worktree;
	return {
		path, canonicalPath, branch, head, detached, pathExists, base,
		isPrimary: worktree.primary,
		locked: null,
		prunable: null,
		status: changes.kind === "known" ? { ...changes, ignored: [] } : changes,
	};
}

/**
 * The base Timber would save for what was typed, a canonical ref or a
 * commit, or why it refuses, in Timber's words. Only branches the pretend
 * repository lists are taken: a local branch as `refs/heads/<name>`, a
 * remote one as `<remote>/<branch>` or by its plain name when exactly one
 * remote has it.
 */
function savedBase(typed: string, worktree: Worktree, branches: readonly BranchSuggestion[]): { ok: true; base: SavedBase & { kind: "assigned" | "commit" } } | { ok: false; diagnostic: string } {
	// A full hash, in any case, is saved as a commit base in lowercase, as Timber does.
	if (isCommitHash(typed.toLowerCase())) return { ok: true, base: { kind: "commit", commit: typed.toLowerCase() } };
	if (typed.startsWith("refs/heads/")) {
		const name = typed.slice("refs/heads/".length);
		if (name === worktree.branch) return { ok: false, diagnostic: "Cannot use the worktree's own branch as its base; select another branch with --set." };
		if (branches.some(branch => branch.kind === "local" && branch.selector === name)) return { ok: true, base: { kind: "assigned", ref: typed } };
		return { ok: false, diagnostic: "Local base is missing or invalid; choose a replacement with --set refs/heads/<branch>." };
	}
	const remotes = branches.filter(branch => branch.kind === "remote").map(branch => branch.selector);
	const named = typed.startsWith("refs/remotes/") ? typed.slice("refs/remotes/".length) : typed;
	// A plain name is a branch on a remote: taken when exactly one remote has it.
	const matches = named.includes("/") ? remotes.filter(remote => remote === named) : remotes.filter(remote => remote.slice(remote.indexOf("/") + 1) === named);
	if (matches.length === 1) return { ok: true, base: { kind: "assigned", ref: `refs/remotes/${matches[0]}` } };
	return { ok: false, diagnostic: "Remote base is missing or ambiguous; use --set <remote/branch>." };
}

/**
 * Act out one `timber base --set`. The repository is the one from the
 * pretend list, `worktree` is one it lists whose folder is there, and
 * `branches` are the branches the pretend repository has. Malformed or
 * unreadable saved metadata is refused whatever was typed, as Timber does,
 * and stale metadata is replaced. The answer carries the worktree as it is
 * after the command, for the mock to keep.
 */
export function actOutSetBase(repository: Repository, worktree: Worktree, request: SetBaseRequest, branches: readonly BranchSuggestion[]): { result: SetBaseResult; saved: Worktree | null } {
	const shown = describeTimberCommand(setBaseResultArguments(request, RESULT_FILE_PLACEHOLDER));
	const previous: SavedBase = worktree.base ?? { kind: "unassigned" };
	const written = (result: "set" | "refused", current: SavedBase, diagnostic: string | null, printed: string): SetBaseResult => {
		const failed = result !== "set";
		const text = JSON.stringify({
			schemaVersion: 1, command: "base", outcome: failed ? "failed" : "succeeded", exitCode: failed ? 1 : 0, materialized: false, diagnostic,
			repository: { commonGitDir: `${repository.path}/.git`, primaryWorktreeRoot: repository.path, currentWorktreeRoot: repository.path },
			worktree: worktreeRecord(worktree, current),
			baseChange: { action: "set", result, previous, current },
		});
		const run: TimberRun = { command: shown, result: readTimberResult("base", text, failed ? 1 : 0), output: { text: printed, truncated: false } };
		return readSetBaseResult(run, worktree.path);
	};
	const refused = (diagnostic: string) => ({ result: written("refused", previous, diagnostic, `error: ${diagnostic}\n`), saved: null });

	// Stale metadata is replaced; metadata that cannot be read at all is refused, as Timber does.
	if (previous.kind === "invalid" && previous.reason !== "stale") return refused("Saved base metadata is malformed or unreadable; inspect the worktree's private Git metadata before changing its base.");
	const chosen = savedBase(request.base, worktree, branches);
	if (!chosen.ok) return refused(chosen.diagnostic);
	const current = chosen.base;
	const said = (base: SavedBase) => base.kind === "assigned" ? savedBaseSelector(base.ref) : base.kind === "commit" ? `commit ${base.commit}` : "none";
	return {
		result: written("set", current, null, `Saved base ${said(current)} for "${worktree.path}" (was ${said(previous)}).\n`),
		saved: { ...worktree, base: current, baseCounts: sampleBaseCounts(current, worktree.head) },
	};
}
