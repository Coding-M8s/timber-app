import type { IssueTracker } from "./model";
import type { TimberSettingsSnapshot, TimberValues } from "./timber-config";

/**
 * Which issue trackers a repository has set up, for the New worktree
 * dialog's Tracker field, and how a pick there turns a Name into an issue
 * selector. Pure: the main process reads Timber's settings and the Git
 * remote, and hands them here (see src/bun/issue-trackers.ts).
 *
 * The rules mirror Timber's own (`resolveIssueInput` and
 * `resolveGithubRepository` in Timber), so a prefix is only ever added to a
 * name Timber reads as an issue of that tracker. Anything else passes
 * unchanged, and Timber alone decides what it means.
 */

/** The trackers the app knows, in the order the field lists them. */
export const ISSUE_TRACKERS: readonly IssueTracker[] = ["github", "jira", "linear"];

/**
 * What a repository has set up. `defaultTracker` is the tracker Timber reads
 * a bare issue number or key with, or null when it reads none.
 */
export type IssueTrackers =
	| { ok: true; defaultTracker: IssueTracker | null; available: IssueTracker[] }
	| { ok: false; message: string };

/** The parts of Timber's settings record the trackers come from. */
export type TrackerSettings = Pick<TimberSettingsSnapshot, "effective" | "credentials">;

/** Timber's shape of a GitHub issue number: a positive whole number that fits exactly. */
const GITHUB_NUMBER = /^[1-9][0-9]*$/;
/** Timber's shape of a Jira or Linear key, matched whole. */
const ISSUE_KEY = /^[A-Z][A-Z0-9]*-[0-9]+$/;

function isIssueOf(tracker: IssueTracker, name: string): boolean {
	if (tracker === "github") return GITHUB_NUMBER.test(name) && Number.isSafeInteger(Number(name));
	return ISSUE_KEY.test(name);
}

/**
 * The name `timber new` gets for a Tracker pick: `github:42`, `jira:ENG-42`,
 * or `linear:ENG-42` when the name has the shape of that tracker's issue,
 * and the name unchanged otherwise. Null is the Default pick, which leaves
 * every name to Timber's default tracker.
 */
export function issueSelector(tracker: IssueTracker | null, name: string): string {
	return tracker !== null && isIssueOf(tracker, name) ? `${tracker}:${name}` : name;
}

/** The remote Timber looks up GitHub issues through: the one it is set to, or origin. */
export function githubRemoteName(effective: Pick<TimberValues, "remote">): string {
	return effective.remote ?? "origin";
}

/** The read-only Git query for every fetch URL of a remote. The name follows `--`, so it can never read as an option. */
export function remoteUrlArguments(folder: string, remote: string): string[] {
	return ["-C", folder, "remote", "get-url", "--all", "--", remote];
}

/** Timber's shape of a github.com remote URL. */
const GITHUB_URL = /^(?:https:\/\/github\.com\/|ssh:\/\/git@github\.com\/|git@github\.com:)([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9_.-]+)$/;

/** Whether `git remote get-url --all` printed exactly one URL, of one github.com repository. */
export function isGithubRemote(stdout: string): boolean {
	const urls = stdout.split(/\r?\n/).filter(line => line !== "");
	if (urls.length !== 1) return false;
	const match = GITHUB_URL.exec(urls[0]!);
	if (!match) return false;
	const name = match[2]!.replace(/\.git$/, "");
	return name !== "" && name !== "." && name !== "..";
}

/**
 * The trackers set up for a repository: GitHub when it has a GitHub remote,
 * Jira when a site and a login apply, and Linear when a login applies. A
 * login in the environment counts as one saved, as it does for Timber.
 */
export function issueTrackersOf(settings: TrackerSettings, github: boolean): IssueTrackers {
	const { jira, linear } = settings.credentials;
	const setUp: Record<IssueTracker, boolean> = {
		github,
		jira: jira.configured && (jira.state === "saved" || jira.environmentOverride),
		linear: linear.state === "saved" || linear.environmentOverride,
	};
	return { ok: true, defaultTracker: defaultTrackerOf(settings), available: ISSUE_TRACKERS.filter(tracker => setUp[tracker]) };
}

function defaultTrackerOf({ effective, credentials }: TrackerSettings): IssueTracker | null {
	const chosen = effective.default_tracker;
	if (chosen === "none") return null;
	if (chosen !== undefined) return chosen;
	// With no default set, Timber reads a bare key as Jira when a Jira site applies.
	return credentials.jira.configured ? "jira" : null;
}
