import { APP_PR_COMMAND, type CheckRunStatus, type PullRequest, type PullRequestEntry, type PullRequestFailureReason, type PullRequestList, type PullRequestState, type ReviewDecision, type Reviewer, type ReviewerState } from "../shared/pull-requests";
import { asSentence, pullRequestFailureSentence } from "./pull-request-format";

/**
 * Words for the Pull request tab: what it shows for the selected worktree,
 * from the pull requests the store last read. Pure, so it can be tested
 * without a window. The tab only reads: it runs no command, and its only
 * control opens links in the browser.
 */

export const OPEN_IN_BROWSER = "Open in browser";
export const NO_DESCRIPTION = "No description.";
export const NO_CHECKS = "No checks were reported for the head commit.";
export const NO_REVIEWERS = "No reviewers were requested, and no one has reviewed it.";

export const STATE_LABELS: Record<PullRequestState, string> = {
	open: "Open",
	draft: "Draft",
	merged: "Merged",
	closed: "Closed",
};

export const RUN_STATUS_LABELS: Record<CheckRunStatus, string> = {
	passing: "passing",
	failing: "failing",
	pending: "pending",
	skipped: "skipped",
};

const REVIEW_LABELS: Record<ReviewDecision, string> = {
	"approved": "Approved",
	"changes-requested": "Changes requested",
	"review-required": "Review required",
	"none": "No review decision",
};

const REVIEW_SENTENCES: Record<ReviewDecision, string> = {
	"approved": "A reviewer approved it.",
	"changes-requested": "A reviewer asked for changes.",
	"review-required": "It needs an approving review before it can merge.",
	"none": "The repository asks for no review decision on it.",
};

const REVIEWER_STATE_LABELS: Record<ReviewerState, string> = {
	"requested": "requested",
	"approved": "approved",
	"changes-requested": "changes requested",
	"commented": "commented",
	"dismissed": "dismissed",
};

const PROBLEM_TITLES: Record<PullRequestFailureReason, string> = {
	"offline": "GitHub could not be reached",
	"sign-in-needed": "Sign-in needed",
	"not-github": "Not on GitHub",
	"failed": "The pull request could not be read",
};

/** The review decision, in a short label and a sentence. */
export interface ReviewView {
	label: string;
	sentence: string;
	/** Red, with its words: changes were requested. */
	warning: boolean;
}

/** One reviewer: its name, a word for a team or a bot, and where it stands. */
export interface ReviewerView {
	name: string;
	/** "team" or "bot", shown beside the name; null for a person. */
	kind: "team" | "bot" | null;
	state: string;
	/** Red, with its words: this reviewer asked for changes. */
	warning: boolean;
	url: string | null;
	openTitle: string;
}

/** The checks line above the list of runs. */
export interface ChecksView {
	text: string;
	warning: boolean;
}

/** What the tab shows. Each kind but `found` is a quiet note in place, never a dialog. */
export type PullRequestTabView =
	| { kind: "found"; pullRequest: PullRequest; heading: string; state: string; base: string; checks: ChecksView; review: ReviewView; reviewers: ReviewerView[]; reviewersNote: string | null; openTitle: string }
	| { kind: "none" | "waiting" | "problem"; title: string; text: string };

function describeChecks(pull: PullRequest): ChecksView {
	const { summary, passing, failing, pending, runs } = pull.checks;
	const skipped = runs.filter(run => run.status === "skipped").length;
	const parts = [failing > 0 ? `${failing} failing` : "", pending > 0 ? `${pending} pending` : "", passing > 0 ? `${passing} passing` : "", skipped > 0 ? `${skipped} skipped` : ""].filter(Boolean);
	const counts = parts.length === 0 ? "" : `: ${parts.join(", ")}`;
	switch (summary) {
		case "passing": return { text: `Checks pass${counts}.`, warning: false };
		case "failing": return { text: `Checks fail${counts}.`, warning: true };
		case "pending": return { text: `Checks still run${counts}.`, warning: false };
		case "none": return { text: runs.length === 0 ? NO_CHECKS : `No combined state was reported${counts}.`, warning: false };
	}
}

function describeReviewer(reviewer: Reviewer): ReviewerView {
	return {
		name: reviewer.name,
		kind: reviewer.kind === "user" ? null : reviewer.kind,
		state: REVIEWER_STATE_LABELS[reviewer.state],
		warning: reviewer.state === "changes-requested",
		url: reviewer.url,
		openTitle: `Open ${reviewer.name} on GitHub in the browser`,
	};
}

/** A quiet line under the reviewers: there are none, or Timber's login could not read them all. Null when the list says it all. */
function reviewersNote(pull: PullRequest): string | null {
	if (pull.reviewersComplete) return pull.reviewers.length === 0 ? NO_REVIEWERS : null;
	return pull.reviewers.length === 0
		? "No reviewers could be read with Timber's GitHub login. Some, such as a team it cannot see, may be hidden from it."
		: "Some reviewers could not be read with Timber's GitHub login, such as a team it cannot see.";
}

function describeFound(pull: PullRequest): PullRequestTabView {
	return {
		kind: "found",
		pullRequest: pull,
		heading: pull.title === "" ? `Pull request #${pull.number}` : pull.title,
		state: STATE_LABELS[pull.state],
		base: pull.state === "merged" ? `merged into ${pull.baseBranch}` : `into ${pull.baseBranch}`,
		checks: describeChecks(pull),
		review: { label: REVIEW_LABELS[pull.review], sentence: REVIEW_SENTENCES[pull.review], warning: pull.review === "changes-requested" },
		reviewers: pull.reviewers.map(describeReviewer),
		reviewersNote: reviewersNote(pull),
		openTitle: `Open pull request #${pull.number} on GitHub in the browser`,
	};
}

/**
 * What the Pull request tab shows for one worktree: its pull request, that
 * it has none yet, that none was read yet, or why it could not be read.
 * `list` is the repository's last answer, and `entry` this worktree's part
 * of it.
 */
export function describePullRequestTab(list: PullRequestList | undefined, entry: PullRequestEntry | null, branch: string | null): PullRequestTabView {
	if (list === undefined) {
		return { kind: "waiting", title: "Not read yet", text: "Pull requests are read through Timber once the repository is listed, and again after each fetch." };
	}
	if (!list.ok) {
		return { kind: "problem", title: "The pull request is unknown", text: `Pull requests could not be read with ${APP_PR_COMMAND}. ${asSentence(list.message)}` };
	}
	if (entry === null) {
		return { kind: "problem", title: "The pull request is unknown", text: `${APP_PR_COMMAND} said nothing about this worktree. The app reads it again after the next fetch.` };
	}
	switch (entry.outcome) {
		case "found": return describeFound(entry.pullRequest);
		case "failed": return { kind: "problem", title: PROBLEM_TITLES[entry.reason], text: `${pullRequestFailureSentence(entry.reason)} Timber says: ${asSentence(entry.diagnostic)}` };
		case "none": return {
			kind: "none",
			title: "No pull request yet",
			text: branch === null
				? "A detached HEAD has no branch, so it has no pull request."
				: `GitHub has no pull request for ${branch}.`,
		};
	}
}
