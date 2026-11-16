import type { Repository, Worktree } from "./model";

/**
 * Fetching: what the main process asks Git for around a background fetch, and
 * how it reads the answers. Pure, so it can be tested without a network. The
 * main process runs Git (see src/bun/fetcher.ts).
 */

/** Where a repository's last fetch stands, for the marker on its header in the sidebar. */
export interface RepositoryFetch {
	/** The path of the repository's primary checkout, as in the app's list. */
	repository: string;
	/** A fetch of this repository runs right now. */
	fetching: boolean;
	/** When a fetch last worked, in milliseconds since 1970. Null when none has worked since the app started. */
	lastFetched: number | null;
	/** Why the latest fetch failed, or null when it worked or none ran yet. Cleared by the next fetch that works. */
	failure: FetchFailure | null;
}

/** Why a fetch did not work, in a few plain words and with what Git said. */
export interface FetchFailure {
	kind: FetchFailureKind;
	/** The end of what Git printed, with any password in a link taken out. Shown, never logged. */
	message: string;
	/** When it failed, in milliseconds since 1970. */
	at: number;
}

/**
 * - `offline`: the remote could not be reached, such as with no network or a
 *   host that does not answer.
 * - `authentication`: the remote wants credentials that are not stored, or
 *   refused the ones that are. The app never asks for them in the background.
 * - `failed`: anything else, such as a remote that does not exist anymore.
 */
export type FetchFailureKind = "offline" | "authentication" | "failed";

/** How asking for a fetch now ended. */
export type FetchResult =
	| { outcome: "fetched"; fetch: RepositoryFetch }
	/** The fetch ran and failed. Its failure is in `fetch.failure`. */
	| { outcome: "failed"; fetch: RepositoryFetch }
	/**
	 * The repository is not in the app's list, so nothing ran, or the fetch
	 * was stopped before every remote was fetched, because the repository
	 * left the list or background fetching was turned off. `message` says which.
	 */
	| { outcome: "not-listed"; message: string };

/** How Git is asked for every remote-tracking ref and the commit it points to: the full name and the object, with a NUL between. */
export const REMOTE_REF_FORMAT = "%(refname)%00%(objectname)";

const remotesPrefix = "refs/remotes/";

/**
 * Parse `git for-each-ref --format=<REMOTE_REF_FORMAT> refs/remotes` into the
 * commit of each remote-tracking ref, by full ref name. A line that does not
 * fit is left out.
 */
export function parseRemoteRefs(output: string): Map<string, string> {
	const refs = new Map<string, string>();
	for (const line of output.split("\n")) {
		const [ref, object, ...rest] = line.split("\0");
		if (ref === undefined || object === undefined || rest.length > 0) continue;
		if (!ref.startsWith(remotesPrefix) || ref.length === remotesPrefix.length || !/^[0-9a-f]{40,64}$/.test(object)) continue;
		refs.set(ref, object);
	}
	return refs;
}

/**
 * The refspecs of one remote that a background fetch may use: those that
 * write only remote-tracking refs (`refs/remotes/...`), and negative ones,
 * which only leave refs out. Anything else, such as a mirror refspec that
 * writes `refs/heads/*`, a tag refspec, or one with no destination, is
 * dropped, so a fetch from the app can never move a local branch or a tag.
 * `refspecs` are the values of `remote.<name>.fetch`, one per line.
 */
export function remoteTrackingRefspecs(refspecs: readonly string[]): string[] {
	const kept: string[] = [];
	for (const raw of refspecs) {
		const refspec = raw.trim();
		if (refspec === "") continue;
		if (refspec.startsWith("^")) {
			kept.push(refspec);
			continue;
		}
		const colon = refspec.indexOf(":");
		if (colon < 0) continue;
		const destination = refspec.slice(colon + 1);
		if (destination.startsWith(remotesPrefix) && destination.length > remotesPrefix.length) kept.push(refspec);
	}
	// Negative refspecs alone fetch nothing, so they only count beside a positive one.
	return kept.some(refspec => !refspec.startsWith("^")) ? kept : [];
}

/** Take the user name and password out of every link in `text`, such as `https://name:token@host/repo`. */
export function withoutCredentials(text: string): string {
	return text.replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1");
}

/** What is kept of what Git printed: its last lines, up to this many characters. */
export const MAX_FAILURE_CHARACTERS = 600;

const OFFLINE_PATTERNS: readonly RegExp[] = [
	/could not resolve host/i,
	/could not resolve hostname/i,
	/name or service not known/i,
	/temporary failure in name resolution/i,
	/connection refused/i,
	/connection timed out/i,
	/operation timed out/i,
	/network is unreachable/i,
	/no route to host/i,
	/failed to connect to/i,
	/unable to access .*: (?:recv|send) failure/i,
	/connection reset by peer/i,
	/connection closed by remote host/i,
	/the remote end hung up unexpectedly/i,
];

const AUTHENTICATION_PATTERNS: readonly RegExp[] = [
	/authentication failed/i,
	/permission denied \(/i,
	/could not read (?:username|password)/i,
	// Newer Git, when it may not ask: "unable to get password from user".
	/unable to get (?:username|password)/i,
	/terminal prompts disabled/i,
	/host key verification failed/i,
	/invalid username or password/i,
	/http basic: access denied/i,
	/the requested url returned error: 40[13]/i,
	/repository not found/i,
];

/**
 * What a failed fetch printed, read as a failure. Authentication is checked
 * first: Git often ends a refused login with "the remote end hung up" too.
 * The message keeps the end of what Git printed, without credentials in
 * links, so it is safe to show.
 */
export function readFetchFailure(stderr: string, at: number): FetchFailure {
	const cleaned = withoutCredentials(stderr).replace(/\r/g, "\n");
	const lines = cleaned.split("\n").map(line => line.trim()).filter(line => line !== "" && !/^(?:hint|remote):?\s*$/i.test(line));
	let message = lines.join("\n");
	if (message.length > MAX_FAILURE_CHARACTERS) message = `...${message.slice(message.length - MAX_FAILURE_CHARACTERS)}`;
	if (message === "") message = "Git stopped without saying why.";
	const kind: FetchFailureKind = AUTHENTICATION_PATTERNS.some(pattern => pattern.test(cleaned))
		? "authentication"
		: OFFLINE_PATTERNS.some(pattern => pattern.test(cleaned)) ? "offline" : "failed";
	return { kind, message, at };
}

/**
 * How Git is asked for every local branch and its upstream, one line each:
 * the branch's full ref, the commit it points to, the upstream's full ref,
 * its short name as the sidebar shows it (`%(upstream:short)`), and the
 * remote it comes from, with a NUL between them.
 */
export const BRANCH_UPSTREAM_FORMAT = "%(refname)%00%(objectname)%00%(upstream)%00%(upstream:short)%00%(upstream:remotename)";

/** A local branch that tracks a remote-tracking branch. */
export interface TrackedBranch {
	/** The branch's name, such as `feat/login`. */
	branch: string;
	/** The commit the branch points to. */
	object: string;
	/** The upstream's full ref, such as `refs/remotes/origin/feat/login`. */
	upstream: string;
	/** The upstream as the sidebar names it, such as `origin/feat/login`. */
	upstreamName: string;
	/** The remote the upstream comes from. */
	remote: string;
}

const headsPrefix = "refs/heads/";

/**
 * Parse `git for-each-ref --format=<BRANCH_UPSTREAM_FORMAT> refs/heads` into
 * the branches that track a remote-tracking branch. A branch with no
 * upstream, or one that tracks another local branch (remote `.`), is left
 * out, and so is a line that does not fit.
 */
export function parseTrackedBranches(output: string): TrackedBranch[] {
	const tracked: TrackedBranch[] = [];
	for (const line of output.split("\n")) {
		const [ref, object, upstream, upstreamName, remote, ...rest] = line.split("\0");
		if (ref === undefined || object === undefined || upstream === undefined || upstreamName === undefined || remote === undefined || rest.length > 0) continue;
		if (!ref.startsWith(headsPrefix) || ref.length === headsPrefix.length || !/^[0-9a-f]{40,64}$/.test(object)) continue;
		if (!upstream.startsWith(remotesPrefix) || upstream.length === remotesPrefix.length || remote === "" || remote === ".") continue;
		tracked.push({ branch: ref.slice(headsPrefix.length), object, upstream, upstreamName, remote });
	}
	return tracked;
}

/** The remotes that at least one local branch tracks, each once, in the order first seen. Only these are fetched. */
export function trackedRemotes(branches: readonly TrackedBranch[]): string[] {
	return [...new Set(branches.map(branch => branch.remote))];
}

/**
 * A local branch whose upstream was rewritten: a fetch moved the upstream to
 * a commit that its previous commit is not an ancestor of. It stays until the
 * person has seen it, or until it is no longer true.
 */
export interface ForcePushMark {
	/** The upstream's full ref when it was rewritten. */
	upstream: string;
	/** The upstream as the sidebar names it, to match the branch's sync state. */
	upstreamName: string;
	/** The commit the upstream was rewritten to. */
	object: string;
	/**
	 * The commit the local branch pointed to when the rewrite was noticed. A
	 * branch that is no longer behind still shows the mark while it is here,
	 * as after a force-push that rewound the upstream: pushing would bring
	 * back what was dropped.
	 */
	branchObject: string;
	/** When the rewrite was noticed, in milliseconds since 1970. Names this mark, so an old "seen" cannot clear a newer one. */
	at: number;
}

/** The marks of every repository, by the path of its primary checkout, then by branch. */
export type ForcePushMarks = Record<string, Record<string, ForcePushMark>>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMark(value: unknown): ForcePushMark | null {
	if (!isRecord(value)) return null;
	const { upstream, upstreamName, object, branchObject, at } = value;
	const isObject = (candidate: unknown): candidate is string => typeof candidate === "string" && /^[0-9a-f]{40,64}$/.test(candidate);
	if (typeof upstream !== "string" || !upstream.startsWith(remotesPrefix) || typeof upstreamName !== "string" || upstreamName === "") return null;
	if (!isObject(object) || !isObject(branchObject) || typeof at !== "number" || !Number.isFinite(at)) return null;
	return { upstream, upstreamName, object, branchObject, at };
}

/**
 * Read saved marks. Like the layout, they are a convenience: an entry that
 * cannot be read is left out, and the rest is kept.
 */
export function readForcePushMarks(value: unknown): ForcePushMarks {
	const marks: ForcePushMarks = {};
	if (!isRecord(value)) return marks;
	for (const [repository, branches] of Object.entries(value)) {
		if (repository === "" || !isRecord(branches)) continue;
		const kept: Record<string, ForcePushMark> = {};
		for (const [branch, mark] of Object.entries(branches)) {
			const read = readMark(mark);
			if (branch !== "" && read) kept[branch] = read;
		}
		if (Object.keys(kept).length > 0) marks[repository] = kept;
	}
	return marks;
}

/** What says that the person saw a branch marked as force-pushed. */
export interface ForcePushSeen {
	/** The path of the repository's primary checkout. */
	repository: string;
	branch: string;
	/** The `at` of the mark that was shown. */
	at: number;
}

/** A mark that is no longer true, named with its `at`, so a newer mark of the same branch is never forgotten in its place. */
export interface StaleMark {
	branch: string;
	at: number;
}

/**
 * A repository as read, with each worktree whose branch has a mark shown as
 * force-pushed. A mark that is no longer true is not shown and is listed in
 * `stale`, to be forgotten: the branch no longer tracks that upstream, the
 * upstream is gone, the branch is level with its upstream, or it moved since
 * the rewrite (a pull, a reset, a rebase) and is no longer behind. A branch
 * that did not move keeps its mark while it is ahead and not behind, as
 * after a rewind. A branch whose state
 * Git could not read keeps its mark.
 */
export function withForcePushes(repository: Repository, marks: Readonly<Record<string, ForcePushMark>> | undefined): { repository: Repository; stale: StaleMark[] } {
	if (!marks || Object.keys(marks).length === 0) return { repository, stale: [] };
	const stale = new Map<string, StaleMark>();
	const worktrees = repository.worktrees.map((worktree): Worktree => {
		const { branch, sync } = worktree;
		const mark = branch === null ? undefined : marks[branch];
		if (branch === null || mark === undefined || sync === null) return worktree;
		const moved = worktree.head !== mark.branchObject;
		// Level with the upstream means nothing is left to look at, whoever moved; ahead and not behind is a rewind only while the branch did not move.
		if (sync.kind !== "tracking" || sync.upstream !== mark.upstreamName || (sync.behind === 0 && (moved || sync.ahead === 0))) {
			stale.set(branch, { branch, at: mark.at });
			return worktree;
		}
		return { ...worktree, sync: { ...sync, forcePushed: { at: mark.at } } };
	});
	return { repository: { ...repository, worktrees }, stale: [...stale.values()] };
}
