import type { IssueLink, TimberFailure } from "../shared/model";
import type { PullRequestList } from "../shared/pull-requests";
import { type CreatePullRequestResult, type ReviewerRequestOutcome, prResultArguments, pullRequestBaseFromText, pullRequestReviewersFromText } from "../shared/timber-pr";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "../shared/timber-result";

/**
 * Words for the form in the Pull request tab that opens a pull request with
 * `timber pr`, and what each way it ends shows. Pure, so it can be tested
 * without a window.
 */

export const CREATE_HEADING = "Open a pull request";
export const CREATE_NOTE = "Timber publishes the branch, then opens the pull request on GitHub with its own login. The app never pushes on its own.";
export const BASE_HINT = "Empty uses the base Timber saved for this worktree. Otherwise type a branch on the remote, such as origin/main.";
export const REVIEWERS_HINT = "Logins or org/team, separated by commas or spaces. Timber asks each one for a review once the pull request is open.";
export const CREATE_SUBMIT = "Publish and open";
export const CREATE_RUNNING = "Publishing and opening";

/** What is typed in the form. */
export interface PullRequestFields {
	title: string;
	body: string;
	/** The Base field as typed. Empty means the base Timber saved. */
	base: string;
	draft: boolean;
	/** The Reviewers field as typed: logins or `org/team`, separated by commas or spaces. */
	reviewers: string;
}

/**
 * The key a title starts with for a worktree's saved issue link: the Jira or
 * Linear key, which is one way those trackers link a pull request to its
 * issue. Null for a GitHub issue, which Timber already mentions in the body,
 * and for no link, invalid metadata, or a Timber that does not say.
 */
export function titleKeyOf(issue: IssueLink | null): string | null {
	if (issue?.kind !== "linked" || issue.tracker === "github") return null;
	const key = issue.key.trim();
	return key === "" ? null : key;
}

/**
 * A quiet line under Description that says which issue Timber mentions in
 * the body, from the worktree's saved link only: `Refs ENG-42` for Jira or
 * Linear, `Refs #102` for GitHub. Timber writes `owner/repo#102` instead when
 * the pull request opens in a repository other than the issue's, which only
 * Timber knows, so the line names both. Null without a saved link, so the
 * app never guesses from the branch name.
 */
export function issueMentionHint(issue: IssueLink | null): string | null {
	if (issue?.kind !== "linked") return null;
	const key = issue.key.trim();
	if (key === "") return null;
	const unless = "unless the description already mentions it";
	if (issue.tracker !== "github") return `Timber adds Refs ${key} ${unless}.`;
	const repository = githubRepositoryOf(issue.url);
	const elsewhere = repository === null ? "" : `, or Refs ${repository}#${key} when the pull request opens in another repository`;
	return `Timber adds Refs #${key} ${unless}${elsewhere}.`;
}

/** `owner/repo` from a saved `https://github.com/<owner>/<repo>/issues/<n>` link, or null. */
function githubRepositoryOf(url: string): string | null {
	try {
		const [, owner, name] = new URL(url).pathname.split("/");
		return owner && name ? `${owner}/${name}` : null;
	} catch {
		return null;
	}
}

const isLetterOrDigit = (character: string) => /^[\p{L}\p{N}]$/u.test(character);

/** The title already starts with the key, in any case, maybe after one `[` or `(`, and not as part of a longer key such as PROJ-1234 for PROJ-123. */
function startsWithKey(title: string, key: string): boolean {
	const text = title.startsWith("[") || title.startsWith("(") ? title.slice(1) : title;
	if (text.slice(0, key.length).toLowerCase() !== key.toLowerCase()) return false;
	const next = text.charAt(key.length);
	return next === "" || !isLetterOrDigit(next);
}

/**
 * The title the form starts with: the last commit's subject, else the
 * branch, else nothing. With a saved Jira or Linear link it starts with the
 * issue's key, as `PROJ-123: subject`, unless it already does.
 */
export function defaultPullRequestTitle(subject: string | null, branch: string | null, issue: IssueLink | null): string {
	return pullRequestTitleWithKey(subject, branch, titleKeyOf(issue));
}

/** `defaultPullRequestTitle` for a key already taken from the link with `titleKeyOf`. */
export function pullRequestTitleWithKey(subject: string | null, branch: string | null, key: string | null): string {
	const title = subject ?? branch ?? "";
	if (key === null || title === "" || startsWithKey(title, key)) return title;
	return `${key}: ${title}`;
}

/**
 * The command the form shows for what is typed, worded from the same
 * arguments the main process runs, with the result file as a placeholder.
 */
export function pullRequestCommandFor(worktreePath: string, fields: PullRequestFields): string {
	const { title, body, base, draft, reviewers } = fields;
	return describeTimberCommand(prResultArguments({ worktree: worktreePath, title, body, base: pullRequestBaseFromText(base), draft, reviewers: pullRequestReviewersFromText(reviewers) }, RESULT_FILE_PLACEHOLDER));
}

/** A person or team to offer in the Reviewers field. */
export interface ReviewerSuggestion {
	/** A login, or `org/team` for a team, as GitHub lists it. */
	name: string;
	kind: "user" | "team";
}

/**
 * The people and teams the repository's pull requests already list as
 * reviewers, each once whatever its case, by name. Bots are left out: a
 * login such as Copilot's is not one `--reviewer` takes. None until the
 * pull requests are read, or when they could not be.
 */
export function reviewerSuggestions(list: PullRequestList | undefined): ReviewerSuggestion[] {
	if (!list?.ok) return [];
	const byName = new Map<string, ReviewerSuggestion>();
	for (const entry of list.worktrees) {
		if (entry.outcome !== "found") continue;
		for (const { name, kind } of entry.pullRequest.reviewers) {
			if (kind === "bot" || name === "" || byName.has(name.toLowerCase())) continue;
			byName.set(name.toLowerCase(), { name, kind });
		}
	}
	return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: "base" }));
}

const REVIEWER_SEPARATOR = /[\s,]/;

/** Where the name being typed starts: after the last comma or space. The caret is taken to be at the end. */
function tokenStart(text: string): number {
	for (let index = text.length - 1; index >= 0; index -= 1) {
		if (REVIEWER_SEPARATOR.test(text.charAt(index))) return index + 1;
	}
	return 0;
}

/** The name being typed in the Reviewers field: the text after the last comma or space. */
export function reviewerToken(text: string): string {
	return text.slice(tokenStart(text));
}

/**
 * The suggestions that contain the name being typed, whatever its case,
 * leaving out the ones already typed before it. Every one not yet typed when
 * nothing is being typed.
 */
export function matchReviewers(suggestions: readonly ReviewerSuggestion[], text: string): ReviewerSuggestion[] {
	const start = tokenStart(text);
	const query = text.slice(start).toLowerCase();
	const typed = new Set(pullRequestReviewersFromText(text.slice(0, start)).map(name => name.toLowerCase()));
	return suggestions.filter(suggestion => !typed.has(suggestion.name.toLowerCase()) && suggestion.name.toLowerCase().includes(query));
}

/** The field's text with the name being typed replaced by a picked one, ready for the next. */
export function withReviewerPicked(text: string, name: string): string {
	return `${text.slice(0, tokenStart(text))}${name}, `;
}
/** Why the latest try did not open a pull request, as the form shows it above Timber's diagnostic. */
export interface PullRequestCreationFailure {
	title: string;
	/** What happened to the branch, when that is worth saying. */
	note: string | null;
	failure: TimberFailure;
}

/** A pull request Timber reported, which the tab shows until the pull requests read again list it. */
export interface ReportedPullRequestView {
	outcome: "created" | "exists";
	number: number;
	url: string;
	/** A line above the pull request. Null when the toast said it all. */
	note: string | null;
}

/**
 * The reviewers Timber could not request on a pull request it created or
 * found, shown below what was reported about that pull request until they
 * are put away or the form runs again. Each line names the reviewer and
 * gives Timber's reason.
 */
export interface ReviewerFailuresView {
	number: number;
	lines: string[];
}

/** What one ending of `timber pr` shows. */
export interface PullRequestCreationView {
	toast: string | null;
	failure: PullRequestCreationFailure | null;
	reported: ReportedPullRequestView | null;
	reviewerFailures: ReviewerFailuresView | null;
}

/** The reviewers that could not be requested, or null when every one was, or none was asked for. */
function reviewerFailuresOf(number: number, reviewers: readonly ReviewerRequestOutcome[]): ReviewerFailuresView | null {
	const lines = reviewers.filter(reviewer => reviewer.result === "failed").map(reviewer => `Review could not be requested from ${reviewer.name}. ${reviewer.diagnostic}`);
	return lines.length === 0 ? null : { number, lines };
}

/** The end of the toast: a second sentence when some reviewers could not be requested. */
function notRequested(failures: ReviewerFailuresView | null): string {
	if (failures === null) return "";
	const count = failures.lines.length;
	return count === 1 ? ". 1 reviewer could not be requested." : `. ${count} reviewers could not be requested.`;
}

const NOT_OPENED = "Timber did not open the pull request";
const RETRY_FINDS_IT = "Trying again reports a pull request that was opened as already open.";

/** Map how `timber pr` ended to what the tab shows. */
export function presentPullRequestCreation(result: CreatePullRequestResult): PullRequestCreationView {
	switch (result.outcome) {
		case "created": {
			const reviewerFailures = reviewerFailuresOf(result.number, result.reviewers);
			return { toast: `Pull request #${result.number} opened${notRequested(reviewerFailures)}`, failure: null, reported: { outcome: "created", number: result.number, url: result.url, note: null }, reviewerFailures };
		}
		case "exists": {
			const into = result.base === null ? "" : ` into ${result.base}`;
			const note = `A pull request from this branch${into} was already open, so Timber opened no other: #${result.number}.${result.published ? " Timber published the branch's new commits to it." : ""}`;
			return { toast: null, failure: null, reported: { outcome: "exists", number: result.number, url: result.url, note }, reviewerFailures: reviewerFailuresOf(result.number, result.reviewers) };
		}
		case "refused":
			return { toast: null, reported: null, reviewerFailures: null, failure: { title: NOT_OPENED, note: "Nothing was pushed, and no ref changed.", failure: result.failure } };
		case "failed": {
			if (!result.ran) return { toast: null, reported: null, reviewerFailures: null, failure: { title: "The pull request was not opened", note: null, failure: result.failure } };
			const note = result.published === true
				? `Timber published the branch before this failed, so the branch on the remote has its commits. ${RETRY_FINDS_IT}`
				: result.published === false
					? "This run pushed nothing."
					: `What it did is unknown: the branch may have been published and a pull request opened. The pull requests were read again. ${RETRY_FINDS_IT}`;
			return { toast: null, reported: null, reviewerFailures: null, failure: { title: NOT_OPENED, note, failure: result.failure } };
		}
	}
}
