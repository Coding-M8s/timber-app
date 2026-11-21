import type { Engine } from "../../shared/engine";
import type { IssueSearchRequest, IssueSearchResult, SuggestedIssue } from "../../shared/issue-search";
import type { Issue, IssueFailureReason, IssueLookup } from "../../shared/issues";
import type { IssueLink, Repository, TimberStatus } from "../../shared/model";

/** The part of the engine about linked issues. */
export type IssueCapabilities = Pick<Engine, "readIssue" | "searchIssues">;

export interface IssueControls {
	/** Decide what the issue of one worktree, by its path, answers from now on: an answer, or null for the sample. */
	setIssue(worktree: string, lookup: IssueLookup | null): void;
	/** How many times the issue of a worktree was read. */
	issueReads(worktree: string): number;
	/** Decide what every issue search answers from now on, or null for the samples. */
	setIssueSearch(result: IssueSearchResult | null): void;
	/** Every search that reached Timber, in order. */
	issueSearches(): IssueSearchRequest[];
}

const link = (tracker: Issue["tracker"], key: string, url: string): IssueLink => ({ kind: "linked", tracker, key, url });

/** The issue saved for sample worktrees, by repository folder name and branch. Every other sample worktree has none. */
export const sampleIssueLinks: Readonly<Record<string, IssueLink>> = {
	"timber feat/github-issue-lookup": link("github", "41", "https://github.com/example/timber/issues/41"),
	"timber fix/macos-portability": link("jira", "TIM-88", "https://example.atlassian.net/browse/TIM-88"),
	"api-server feat/rate-limit-headers": link("linear", "API-17", "https://linear.app/example/issue/API-17/send-rate-limit-headers"),
	"billing feat/invoices": link("jira", "BILL-12", "https://example.atlassian.net/browse/BILL-12"),
	"billing feat/tax-rules": link("linear", "BILL-30", "https://linear.app/example/issue/BILL-30/tax-rules"),
	"billing fix/unreadable": { kind: "invalid", reason: "malformed" },
	"docs-site feat/search": link("github", "7", "https://github.com/example/docs-site/issues/7"),
};

const issue = (from: IssueLink & { kind: "linked" }, title: string, status: Issue["status"], assignee: string | null): Issue => ({
	tracker: from.tracker,
	key: from.key,
	url: from.url,
	title,
	status,
	assignee,
});

/** What the tracker holds for each sample link, by tracker and key. */
const sampleIssues: Readonly<Record<string, (from: IssueLink & { kind: "linked" }) => Issue>> = {
	"github 41": from => issue(from, "Look up GitHub issues by number", { name: "Open", category: "open" }, "octo-sam"),
	"jira TIM-88": from => issue(from, "Timber fails on macOS without GNU tools", { name: "In Review", category: "in-progress" }, "Alex Doe"),
	"linear API-17": from => issue(from, "Send rate limit headers", { name: "Done", category: "closed" }, null),
};

/** Sample failures, by tracker and key, as Timber would answer them. */
const sampleIssueFailures: Readonly<Record<string, { reason: IssueFailureReason; diagnostic: string }>> = {
	"jira BILL-12": { reason: "offline", diagnostic: "Jira could not be reached; check connectivity and try again." },
	"linear BILL-30": { reason: "sign-in-needed", diagnostic: "Linear credentials are missing. Run timber setup to save a personal API key, or supply LINEAR_API_KEY." },
	"github 7": { reason: "not-found", diagnostic: "GitHub has no issue at the linked address, or it is hidden from this login." },
};

/** What Timber would answer for a worktree's saved link from the samples. */
export function sampleIssueAnswer(saved: IssueLink | null): IssueLookup {
	if (saved === null || saved.kind === "none") return { ok: true, outcome: "none" };
	if (saved.kind === "invalid") {
		return { ok: true, outcome: "failed", reason: "failed", diagnostic: `The saved issue link is ${saved.reason}; inspect the worktree's private Git metadata before linking an issue again.` };
	}
	const name = `${saved.tracker} ${saved.key}`;
	const failure = sampleIssueFailures[name];
	if (failure) return { ok: true, outcome: "failed", ...failure };
	const found = sampleIssues[name];
	return found ? { ok: true, outcome: "found", issue: found(saved) } : { ok: true, outcome: "failed", reason: "not-found", diagnostic: "The tracker has no such issue." };
}

/** The issues each sample tracker holds, for searches. Every repository searches the same ones. */
const searchableIssues: readonly Issue[] = [
	{ tracker: "github", key: "41", url: "https://github.com/example/timber/issues/41", title: "Look up GitHub issues by number", status: { name: "Open", category: "open" }, assignee: "octo-sam" },
	{ tracker: "github", key: "42", url: "https://github.com/example/timber/issues/42", title: "Show the linked issue in the header", status: { name: "Open", category: "open" }, assignee: null },
	{ tracker: "github", key: "7", url: "https://github.com/example/timber/issues/7", title: "Fix the login redirect loop", status: { name: "Closed", category: "closed" }, assignee: "octo-sam" },
	{ tracker: "jira", key: "TIM-8", url: "https://example.atlassian.net/browse/TIM-8", title: "Support Windows paths in the listing", status: { name: "To Do", category: "open" }, assignee: null },
	{ tracker: "jira", key: "TIM-80", url: "https://example.atlassian.net/browse/TIM-80", title: "Read the base from the saved record", status: { name: "In Progress", category: "in-progress" }, assignee: "Alex Doe" },
	{ tracker: "jira", key: "TIM-88", url: "https://example.atlassian.net/browse/TIM-88", title: "Timber fails on macOS without GNU tools", status: { name: "In Review", category: "in-progress" }, assignee: "Alex Doe" },
	{ tracker: "jira", key: "TIM-91", url: "https://example.atlassian.net/browse/TIM-91", title: "Login fails behind a proxy", status: { name: "To Do", category: "open" }, assignee: null },
	{ tracker: "linear", key: "API-17", url: "https://linear.app/example/issue/API-17/send-rate-limit-headers", title: "Send rate limit headers", status: { name: "Done", category: "closed" }, assignee: null },
	{ tracker: "linear", key: "API-21", url: "https://linear.app/example/issue/API-21/login-tokens", title: "Rotate login tokens", status: { name: "Backlog", category: "open" }, assignee: null },
];

/** Words of a text as Timber matches them: letters and digits, in lower case. */
const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word !== "");

/** Roughly what Timber's search does: key prefixes first, then titles that hold every word. */
export function sampleIssueSearch(tracker: Issue["tracker"], text: string): Issue[] {
	const mine = searchableIssues.filter(issue => issue.tracker === tracker);
	const typed = text.trim().replace(/^#/, "").toLowerCase();
	const byKey = mine.filter(issue => issue.key.toLowerCase().startsWith(typed));
	const words = wordsOf(text);
	const byTitle = words.length === 0 ? [] : mine.filter(issue => !byKey.includes(issue) && words.every(word => issue.title.toLowerCase().includes(word)));
	return [...byKey, ...byTitle];
}

/**
 * Linked issues acted out from sample data, for the browser build and tests.
 * As the main process does, a repository must be in the list, the path must
 * be full, and Timber must be ready, with the main process's words for when
 * it is not. As Timber does, a path that is no worktree of the repository is
 * a failure.
 */
export function createMockIssues(listed: (path: string) => Repository | undefined, timber: () => TimberStatus): IssueCapabilities & IssueControls {
	const chosen = new Map<string, IssueLookup>();
	const reads = new Map<string, number>();
	let searchAnswer: IssueSearchResult | null = null;
	const searches: IssueSearchRequest[] = [];
	return {
		async searchIssues(request) {
			const { repository, tracker, text } = request;
			const found = listed(repository);
			if (!found) return { ok: false, unsupported: false, message: `${repository} is not a repository in the app's list.` };
			const status = timber();
			if (status.state === "not-found") return { ok: false, unsupported: false, message: "Timber was not found on PATH." };
			if (status.state === "too-old") return { ok: false, unsupported: false, message: `Timber ${status.found} at ${status.path} is older than the required ${status.required}.` };
			searches.push({ repository, tracker, text });
			if (searchAnswer) return structuredClone(searchAnswer);
			const issues: SuggestedIssue[] = sampleIssueSearch(tracker, text).slice(0, 10).map(issue => {
				const tree = found.worktrees.find(candidate => candidate.issue?.kind === "linked" && candidate.issue.tracker === issue.tracker && candidate.issue.key === issue.key);
				return { ...issue, worktree: tree ? { path: tree.path, branch: tree.branch } : null };
			});
			return { ok: true, outcome: "found", issues, truncated: false };
		},
		setIssueSearch(result) {
			searchAnswer = result === null ? null : structuredClone(result);
		},
		issueSearches: () => [...searches],
		async readIssue(request) {
			// In the main process's order: the request's shape, the list, then Timber. Only a read that reaches Timber counts.
			const { repository, worktree } = request;
			if (typeof worktree !== "string" || !worktree.startsWith("/")) return { ok: false, message: "The request for an issue names no full worktree path." };
			const found = listed(repository);
			if (!found) return { ok: false, message: `${repository} is not a repository in the app's list.` };
			const status = timber();
			if (status.state === "not-found") return { ok: false, message: "Timber was not found on PATH." };
			if (status.state === "too-old") return { ok: false, message: `Timber ${status.found} at ${status.path} is older than the required ${status.required}.` };
			reads.set(worktree, (reads.get(worktree) ?? 0) + 1);
			const answer = chosen.get(worktree);
			if (answer) return structuredClone(answer);
			const tree = found.worktrees.find(candidate => candidate.path === worktree);
			if (!tree) return { ok: true, outcome: "failed", reason: "failed", diagnostic: "No registered worktree matches that path or branch. Pass an absolute worktree path or an exact branch name from timber ls --json." };
			return sampleIssueAnswer(tree.issue);
		},
		setIssue(worktree, lookup) {
			if (lookup === null) chosen.delete(worktree);
			else chosen.set(worktree, structuredClone(lookup));
		},
		issueReads: worktree => reads.get(worktree) ?? 0,
	};
}
