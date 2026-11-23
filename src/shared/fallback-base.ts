import type { Repository, Worktree } from "./model";
import { syncTargetOf } from "./sync-actions";

/**
 * Which action the primary checkout's Rebase place offers: Rebase, or Pull
 * when its base is its own branch's upstream, where a rebase would be a
 * `git pull --rebase` under another name that rewrites local commits. Pure.
 *
 * This only chooses which action to show. Timber keeps every rule about a
 * rebase, and Git every check of a pull. What a worktree with no saved base
 * is rebased onto is read offline (`fallbackBaseOf`), as far as it can be:
 * when it cannot be told, Rebase stays, as before.
 */

/** How Git is asked for the remotes' cached default branches: each remote's HEAD, NUL, and the ref it points at. */
export const REMOTE_HEADS_FORMAT = "%(refname)%00%(symref)";

/** The refs that format is asked for: every remote's HEAD, also of a remote whose name has a slash. */
export const REMOTE_HEADS_PATTERN = "refs/remotes/**/HEAD";

const REMOTES = "refs/remotes/";

/**
 * Parse `git for-each-ref --format=<REMOTE_HEADS_FORMAT> <REMOTE_HEADS_PATTERN>` into
 * each remote's cached default branch, by remote name: the ref its
 * `refs/remotes/<remote>/HEAD` points at, set by `git clone` or
 * `git remote set-head`. A HEAD that points outside its own remote is left out.
 */
export function parseRemoteHeads(output: string): Map<string, string> {
	const heads = new Map<string, string>();
	for (const line of output.split(/\r?\n/)) {
		const [ref, target, ...rest] = line.split("\0");
		if (ref === undefined || target === undefined || rest.length > 0) continue;
		if (!ref.startsWith(REMOTES) || !ref.endsWith("/HEAD")) continue;
		const remote = ref.slice(REMOTES.length, -"/HEAD".length);
		const prefix = `${REMOTES}${remote}/`;
		if (remote === "" || !target.startsWith(prefix) || target.length <= prefix.length || target === ref) continue;
		heads.set(remote, target);
	}
	return heads;
}

/** Parse `git remote`: one remote name per line. */
export function parseRemoteNames(output: string): string[] {
	return output.split(/\r?\n/).map(line => line.trim()).filter(line => line !== "");
}

/** The two Timber settings that choose a base for a worktree with no saved one, as Timber's effective settings give them. Null when unset. */
export interface ConfiguredBase {
	baseBranch: string | null;
	remote: string | null;
}

/** No setting chooses the base, as when neither of Timber's settings files exists. */
export const NOTHING_CONFIGURED: ConfiguredBase = { baseBranch: null, remote: null };

/**
 * The remote-tracking ref Timber falls back to for a worktree with no saved
 * base, as far as can be told offline, or null. As Timber's `remoteBase`
 * does: a configured `base_branch` that starts with a remote's name, as
 * `origin/main` or `refs/remotes/origin/main`, is on that remote; otherwise
 * the remote is the configured one, else the only one, and the branch is
 * the configured `base_branch`, else the remote's default branch. Timber
 * asks the remote for its default live; here it is the one cached at the
 * last fetch (`heads`). Null when Timber's settings are unknown
 * (`configured` null), when no one remote is chosen or the chosen one does
 * not exist, when a `base_branch` is not a plain branch name (Timber checks
 * those itself), and when the remote has no cached default to fall back on.
 */
export function fallbackBaseOf(remotes: readonly string[], heads: ReadonlyMap<string, string>, configured: ConfiguredBase | null): string | null {
	if (configured === null) return null;
	const { baseBranch } = configured;
	const canonical = baseBranch?.startsWith(REMOTES) === true;
	const qualified = baseBranch === null ? undefined
		: [...remotes].sort((a, b) => b.length - a.length).find(name => baseBranch.startsWith(`${canonical ? REMOTES : ""}${name}/`));
	if (canonical && qualified === undefined) return null;
	const remote = qualified ?? configured.remote ?? (remotes.length === 1 ? remotes[0]! : null);
	if (remote === null || !remotes.includes(remote)) return null;
	if (baseBranch === null) return heads.get(remote) ?? null;
	const branch = qualified === undefined ? baseBranch : baseBranch.slice((canonical ? REMOTES.length : 0) + qualified.length + 1);
	if (branch === "" || branch === "HEAD" || branch.startsWith("refs/") || /[\0\s]/.test(branch)) return null;
	return `${REMOTES}${remote}/${branch}`;
}

/**
 * Whether the primary checkout could be one whose base is its upstream with
 * no saved base: on a branch, nothing saved, tracking the remote branch of
 * the same name. Only then is the fallback base worth reading.
 */
export function mayFallBackToUpstream(worktree: Worktree): boolean {
	if (!worktree.primary || worktree.branch === null || worktree.base?.kind !== "unassigned") return false;
	const target = syncTargetOf(worktree.sync);
	return target !== null && target.upstreamRef === `${REMOTES}${target.remote}/${worktree.branch}`;
}

/**
 * Whether the worktree's Rebase is offered as Pull instead: it is the
 * primary checkout, its branch tracks a remote branch, and its base is that
 * upstream, saved so, or with nothing saved and the repository's fallback
 * base (Timber's `base_branch` or the remote's default branch) being that
 * upstream, of the same name. A
 * base Timber does not report (null), a commit, or one it cannot read keeps
 * Rebase.
 */
export function pullsInsteadOfRebase(repository: Pick<Repository, "fallbackBase">, worktree: Worktree): boolean {
	if (!worktree.primary || worktree.branch === null) return false;
	const target = syncTargetOf(worktree.sync);
	if (target === null) return false;
	const { base } = worktree;
	if (base?.kind === "assigned") return base.ref === target.upstreamRef;
	return mayFallBackToUpstream(worktree) && repository.fallbackBase === target.upstreamRef;
}
