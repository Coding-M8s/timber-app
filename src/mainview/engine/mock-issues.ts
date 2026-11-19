import type { Engine } from "../../shared/engine";
import type { Issue, IssueFailureReason, IssueLookup } from "../../shared/issues";
import type { IssueLink, Repository, TimberStatus } from "../../shared/model";

/** The part of the engine about linked issues. */
export type IssueCapabilities = Pick<Engine, "readIssue">;

export interface IssueControls {
	/** Decide what the issue of one worktree, by its path, answers from now on: an answer, or null for the sample. */
	setIssue(worktree: string, lookup: IssueLookup | null): void;
	/** How many times the issue of a worktree was read. */
	issueReads(worktree: string): number;
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
	return {
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
