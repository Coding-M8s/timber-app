import { APP_PR_COMMAND, type PullRequest, type PullRequestEntry, type PullRequestFailureReason, type PullRequestHost, type PullRequestList } from "../shared/pull-requests";
import type { RowMarker, RowMarkerKind } from "./format";

/**
 * Words for pull requests: the markers on a worktree's row and in the
 * workspace header, and the quiet word when they could not be read. Pure, so
 * they can be tested without a window.
 *
 * Timber reads the pull requests from GitHub or from Bitbucket, after the
 * repository's remote, and says which. The words name that host; with no
 * host said, they are GitHub's, as before Bitbucket.
 */

/** The host by name, for the person. */
export const pullRequestHostName = (host: PullRequestHost | undefined): string => host === "bitbucket" ? "Bitbucket" : "GitHub";

/** The control in the workspace header that opens the pull request in the browser. */
export const OPEN_PULL_REQUEST = "Open pull request";

/** End a text from elsewhere with a full stop, unless it already ends a sentence. */
export const asSentence = (text: string) => /[.!?]$/.test(text.trim()) ? text.trim() : `${text.trim()}.`;

function stateSentence(pull: PullRequest): string {
	const { number, baseBranch } = pull;
	const about = (lead: string) => pull.title === "" ? `${lead}.` : `${lead}: ${asSentence(pull.title)}`;
	switch (pull.state) {
		case "open": return about(`Pull request #${number} into ${baseBranch} is open`);
		case "draft": return about(`Pull request #${number} into ${baseBranch} is a draft`);
		case "merged": return `${about(`Pull request #${number} was merged into ${baseBranch}`)} If nothing else is left in this worktree, it can go.`;
		case "closed": return about(`Pull request #${number} into ${baseBranch} was closed without merging`);
	}
}

function counts(pull: PullRequest): string {
	const { passing, failing, pending } = pull.checks;
	const parts = [failing > 0 ? `${failing} failing` : "", pending > 0 ? `${pending} pending` : "", passing > 0 ? `${passing} passing` : ""].filter(Boolean);
	return parts.length === 0 ? "" : `: ${parts.join(", ")}`;
}

function checksMarker(pull: PullRequest): RowMarker | null {
	const marker = (kind: RowMarkerKind, text: string, tooltip: string): RowMarker => ({ kind, place: "pull-request", text, tooltip });
	switch (pull.checks.summary) {
		case "passing": return marker("checks-passing", "checks pass", `Checks pass on pull request #${pull.number}${counts(pull)}.`);
		case "failing": return marker("checks-failing", "checks fail", `Checks fail on pull request #${pull.number}${counts(pull)}.`);
		case "pending": return marker("checks-pending", "checks running", `Checks still run on pull request #${pull.number}${counts(pull)}.`);
		case "none": return null;
	}
}

/** Bitbucket has no review decision: Timber works it out from the reviewers, and it says nothing about the repository's merge checks. */
function reviewRequiredSentence(pull: PullRequest, host: PullRequestHost | undefined): string {
	return host === "bitbucket"
		? `Pull request #${pull.number} waits for its reviewers: none has approved it yet.`
		: `Pull request #${pull.number} needs an approving review before it can merge.`;
}

function reviewMarker(pull: PullRequest, host: PullRequestHost | undefined): RowMarker | null {
	const marker = (kind: RowMarkerKind, text: string, tooltip: string): RowMarker => ({ kind, place: "pull-request", text, tooltip });
	switch (pull.review) {
		case "approved": return marker("review-approved", "approved", `Pull request #${pull.number} is approved.`);
		case "changes-requested": return marker("review-changes", "changes requested", `A reviewer asked for changes on pull request #${pull.number}.`);
		case "review-required": return marker("review-required", "review required", reviewRequiredSentence(pull, host));
		case "none": return null;
	}
}

/**
 * The markers for a worktree's pull request: its number and state, then its
 * checks and its review decision while it is open or a draft. A merged or
 * closed one has only the first, as nothing about it waits any longer. A
 * branch with no pull request, or one whose pull request could not be read,
 * gets none: the reason is said once, on its repository. `host` is where
 * the repository's pull requests were read from.
 */
export function describePullRequestMarkers(entry: PullRequestEntry | null, host?: PullRequestHost): RowMarker[] {
	if (entry?.outcome !== "found") return [];
	const pull = entry.pullRequest;
	const text = pull.state === "open" ? `#${pull.number}` : `#${pull.number} ${pull.state}`;
	const markers: RowMarker[] = [{ kind: "pull-request", place: "pull-request", text, tooltip: stateSentence(pull) }];
	if (pull.state === "open" || pull.state === "draft") {
		for (const marker of [checksMarker(pull), reviewMarker(pull, host)]) if (marker) markers.push(marker);
	}
	return markers;
}

/** What "Open pull request" does, for its tooltip. */
export function describeOpenPullRequest(pull: PullRequest, host?: PullRequestHost): string {
	return `Open pull request #${pull.number} on ${pullRequestHostName(host)} in the browser`;
}

/** The quiet word when pull requests could not be read, with its sentences for the tooltip. */
export interface PullRequestProblem {
	text: string;
	tooltip: string;
}

/** The quiet word for a reason. Bitbucket's sign-in is named, so it is never taken for GitHub's. */
function failureWord(reason: PullRequestFailureReason, host: PullRequestHost | undefined): string {
	switch (reason) {
		case "offline": return "PRs offline";
		case "sign-in-needed": return host === "bitbucket" ? "PRs need Bitbucket sign-in" : "PRs need sign-in";
		case "not-github": return "not on GitHub";
		case "failed": return "PRs failed";
	}
}

/** Why pull requests could not be read, in a whole sentence for the person. `host` is where Timber read them from. */
export function pullRequestFailureSentence(reason: PullRequestFailureReason, host?: PullRequestHost): string {
	switch (reason) {
		case "offline": return `Pull requests could not be read: ${pullRequestHostName(host)} could not be reached. The app tries again after the next fetch.`;
		case "sign-in-needed": return host === "bitbucket"
			? "Pull requests could not be read: Timber has no Bitbucket login, or Bitbucket refused it. The app never asks: sign in once with timber setup in a terminal, or set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN."
			: "Pull requests could not be read: Timber has no GitHub login, or GitHub refused it. The app never asks: sign in once with gh auth login in a terminal, or set GH_TOKEN.";
		case "not-github": return "Pull requests are read from github.com or bitbucket.org only, and this repository's remote is on neither.";
		case "failed": return "Pull requests could not be read. The app tries again after the next fetch.";
	}
}

function failureProblem(entry: Extract<PullRequestEntry, { outcome: "failed" }>, host: PullRequestHost | undefined): PullRequestProblem {
	return { text: failureWord(entry.reason, host), tooltip: `${pullRequestFailureSentence(entry.reason, host)} Timber says: ${asSentence(entry.diagnostic)}` };
}

function unknownProblem(message: string): PullRequestProblem {
	return { text: "PRs unknown", tooltip: `Pull requests could not be read with ${APP_PR_COMMAND}. ${asSentence(message)}` };
}

/**
 * The quiet word beside a repository's name when its pull requests could
 * not be read, or null when they were, or none were asked for yet. One
 * lookup answers for the whole repository, so it is said once here and not
 * on every row. Never a dialog.
 */
export function describeRepositoryPullRequestProblem(list: PullRequestList | undefined): PullRequestProblem | null {
	if (list === undefined) return null;
	if (!list.ok) return unknownProblem(list.message);
	const failure = list.worktrees.find(entry => entry.outcome === "failed");
	return failure?.outcome === "failed" ? failureProblem(failure, list.host) : null;
}

/** The same word in the workspace header, for the selected worktree only. */
export function describeWorktreePullRequestProblem(list: PullRequestList | undefined, entry: PullRequestEntry | null): PullRequestProblem | null {
	if (list === undefined) return null;
	if (!list.ok) return unknownProblem(list.message);
	return entry?.outcome === "failed" ? failureProblem(entry, list.host) : null;
}
