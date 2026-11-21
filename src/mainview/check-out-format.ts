import type { LinkedPullRequest, SuggestedIssue } from "../shared/issue-search";
import { issueLinkSelector } from "../shared/issue-trackers";
import type { OpenWorktreeRequest, ReportedWorktree } from "../shared/model";
import { displayText } from "../shared/timber-record";
import { reportedLabel } from "./components/worktree-modes/new-branch-model";

/**
 * Check out PR on the issues board: which cards offer it, which of an
 * issue's pull requests can be opened here, and the words for each. Pure.
 *
 * The pull requests are the ones Timber lists from the tracker's own links
 * (`pullRequests` in `__app-issues`), never guessed from branch names. The
 * app opens the head branch with `timber open --issue <issue> -- <branch>`,
 * so Timber also saves the worktree's link to the issue, and the card shows
 * its pill on the next read.
 *
 * `timber open` knows nothing of forks: it resolves a bare branch name
 * against this repository's own branches and remotes. A fork's head branch,
 * or a pull request of another repository, could therefore open an
 * unrelated branch of the same name and link it to the issue. Those the
 * tracker marks as such are refused here, with the reason, and nothing is
 * run. Where the tracker cannot tell (`fromFork` null), Timber is asked. If
 * no branch has the exact name, Timber may still open one by its ticket
 * prefix; the toast then names the branch Timber opened, so the person sees
 * it (`describeCheckedOut`).
 */

export const CHECK_OUT_LABEL = "Check out PR";

/** One pull request the dialog offers, and why it cannot be opened here, if it cannot. */
export interface CheckOutOption {
	pullRequest: LinkedPullRequest;
	/** Null when Timber can be asked to open it. */
	refused: string | null;
}

/** What Check out PR offers for one card: the selector the worktree is linked with, and each pull request. */
export interface CheckOutChoice {
	issue: string;
	options: CheckOutOption[];
}

export const FORK_REFUSAL = "Its branch is in a fork. Timber opens only branches of this repository's remotes, and could open an unrelated branch of the same name, so nothing is run.";
export const ISSUE_ELSEWHERE_REFUSAL = "This issue is in another GitHub repository, so it cannot be linked to a worktree here. Nothing is run.";
const otherRepository = (repository: string) => `It is a pull request of ${repository}, not of this repository. Timber could open an unrelated branch of the same name, so nothing is run.`;

const GITHUB_LINK = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(issues|pull)\/[1-9][0-9]*\/?$/i;

/** The "owner/name" and kind of a github.com issue or pull request address, or null for any other address. */
export function githubLink(url: string): { repository: string; kind: "issues" | "pull" } | null {
	const match = GITHUB_LINK.exec(url);
	return match ? { repository: match[1]!, kind: match[2]!.toLowerCase() as "issues" | "pull" } : null;
}

export const sameRepository = (one: string, other: string) => one.toLowerCase() === other.toLowerCase();

function refusalOf(pullRequest: LinkedPullRequest, githubRepository: string | null): string | null {
	if (pullRequest.fromFork === true) return FORK_REFUSAL;
	// A github.com pull request names its repository: one that is not this repository's, or any when this one is not on github.com, is elsewhere.
	// Jira's and others' addresses do not name it, and Timber's answer stands.
	const link = githubLink(pullRequest.url);
	if (link !== null && (githubRepository === null || !sameRepository(link.repository, githubRepository))) return otherRepository(displayText(link.repository, 100));
	return null;
}

/**
 * What Check out PR offers for a card, or null when the card has no Check
 * out PR: the issue already has a worktree here (its pill shows instead), it
 * is done, its links could not be read, it has no open pull request, or its
 * key cannot be named to Timber exactly. `githubRepository` is the
 * repository's github.com "owner/name", or null (see `IssueTrackers`).
 *
 * A GitHub issue of another repository, which a project's sprint can hold,
 * still gets Check out PR, with every pull request refused: `github:<n>`
 * would name issue n of this repository instead.
 */
export function checkOutChoice(issue: SuggestedIssue, githubRepository: string | null): CheckOutChoice | null {
	if (issue.worktree !== null || issue.status.category === "closed") return null;
	if (issue.pullRequests === null || issue.pullRequests.length === 0) return null;
	const selector = issueLinkSelector(issue.tracker, issue.key);
	if (selector === null) return null;
	if (issue.tracker === "github") {
		const link = githubLink(issue.url);
		const here = link !== null && link.kind === "issues" && githubRepository !== null && sameRepository(link.repository, githubRepository);
		if (!here) return { issue: selector, options: issue.pullRequests.map(pullRequest => ({ pullRequest, refused: ISSUE_ELSEWHERE_REFUSAL })) };
	}
	return { issue: selector, options: issue.pullRequests.map(pullRequest => ({ pullRequest, refused: refusalOf(pullRequest, githubRepository) })) };
}

/** Whether no pull request of the choice can be opened here: the card's button then says why instead of what it does. */
export function allRefused(choice: CheckOutChoice): boolean {
	return choice.options.every(option => option.refused !== null);
}

/** Added to the toast when the list read after `timber open` does not show the worktree. */
export function describeUnlisted(setupSkipped: boolean): string {
	return setupSkipped
		? "The list does not show it yet, so its Pull request tab is not shown and setup did not start. Refresh the list."
		: "The list does not show it yet, so its Pull request tab is not shown. Refresh the list.";
}

/** The pull request the dialog starts on: the first one that can be opened, else the first. */
export function firstOption(choice: CheckOutChoice): number {
	const runnable = choice.options.findIndex(option => option.refused === null);
	return runnable === -1 ? 0 : runnable;
}

/** The `timber open` request for one pull request: its head branch, exactly as the tracker gave it, and the issue to link. */
export function checkOutRequest(repository: string, choice: CheckOutChoice, pullRequest: LinkedPullRequest): OpenWorktreeRequest {
	return { repository, selector: pullRequest.branch, issue: choice.issue };
}

/** A pull request as the dialog names it: "#48 feat/login", with "draft" or "from a fork" when the tracker says so. */
export function describePullRequest(pullRequest: LinkedPullRequest): { name: string; notes: string[] } {
	const notes = [pullRequest.draft === true ? "draft" : null, pullRequest.fromFork === true ? "from a fork" : null].filter(note => note !== null);
	return { name: `#${pullRequest.number} ${displayText(pullRequest.branch, 120)}`, notes };
}

/**
 * The toast once `timber open` worked. A worktree that was already there was
 * only opened and linked. When Timber opened another branch than the pull
 * request's, for example by a ticket prefix, the toast says which.
 */
export function describeCheckedOut(pullRequest: LinkedPullRequest, worktree: ReportedWorktree, created: boolean): string {
	const label = reportedLabel(worktree);
	const opened = created ? `Checked out #${pullRequest.number} in ${label}.` : `Opened ${label} for #${pullRequest.number}. Its worktree was already there.`;
	return worktree.branch !== null && worktree.branch !== pullRequest.branch
		? `${opened} Timber opened ${label}, not ${displayText(pullRequest.branch, 120)}.`
		: opened;
}
