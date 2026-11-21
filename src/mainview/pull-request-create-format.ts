import type { IssueLink, TimberFailure } from "../shared/model";
import { type CreatePullRequestResult, prResultArguments, pullRequestBaseFromText } from "../shared/timber-pr";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "../shared/timber-result";

/**
 * Words for the form in the Pull request tab that opens a pull request with
 * `timber pr`, and what each way it ends shows. Pure, so it can be tested
 * without a window.
 */

export const CREATE_HEADING = "Open a pull request";
export const CREATE_NOTE = "Timber publishes the branch, then opens the pull request on GitHub with its own login. The app never pushes on its own.";
export const BASE_HINT = "Empty uses the base Timber saved for this worktree. Otherwise type a branch on the remote, such as origin/main.";
export const CREATE_SUBMIT = "Publish and open";
export const CREATE_RUNNING = "Publishing and opening";

/** What is typed in the form. */
export interface PullRequestFields {
	title: string;
	body: string;
	/** The Base field as typed. Empty means the base Timber saved. */
	base: string;
	draft: boolean;
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
	const { title, body, base, draft } = fields;
	return describeTimberCommand(prResultArguments({ worktree: worktreePath, title, body, base: pullRequestBaseFromText(base), draft }, RESULT_FILE_PLACEHOLDER));
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

/** What one ending of `timber pr` shows. */
export interface PullRequestCreationView {
	toast: string | null;
	failure: PullRequestCreationFailure | null;
	reported: ReportedPullRequestView | null;
}

const NOT_OPENED = "Timber did not open the pull request";
const RETRY_FINDS_IT = "Trying again reports a pull request that was opened as already open.";

/** Map how `timber pr` ended to what the tab shows. */
export function presentPullRequestCreation(result: CreatePullRequestResult): PullRequestCreationView {
	switch (result.outcome) {
		case "created":
			return { toast: `Pull request #${result.number} opened`, failure: null, reported: { outcome: "created", number: result.number, url: result.url, note: null } };
		case "exists": {
			const into = result.base === null ? "" : ` into ${result.base}`;
			const note = `A pull request from this branch${into} was already open, so Timber opened no other: #${result.number}.${result.published ? " Timber published the branch's new commits to it." : ""}`;
			return { toast: null, failure: null, reported: { outcome: "exists", number: result.number, url: result.url, note } };
		}
		case "refused":
			return { toast: null, reported: null, failure: { title: NOT_OPENED, note: "Nothing was pushed, and no ref changed.", failure: result.failure } };
		case "failed": {
			if (!result.ran) return { toast: null, reported: null, failure: { title: "The pull request was not opened", note: null, failure: result.failure } };
			const note = result.published === true
				? `Timber published the branch before this failed, so the branch on the remote has its commits. ${RETRY_FINDS_IT}`
				: result.published === false
					? "This run pushed nothing."
					: `What it did is unknown: the branch may have been published and a pull request opened. The pull requests were read again. ${RETRY_FINDS_IT}`;
			return { toast: null, reported: null, failure: { title: NOT_OPENED, note, failure: result.failure } };
		}
	}
}
