import type { Engine } from "../../shared/engine";
import type { Repository, TimberStatus } from "../../shared/model";
import type { PullRequest, PullRequestEntry, PullRequestFailureReason, PullRequestList } from "../../shared/pull-requests";

/** The part of the engine about pull requests. */
export type PullRequestCapabilities = Pick<Engine, "readPullRequests">;

export interface PullRequestControls {
	/**
	 * Decide what the pull requests of one repository, named by its primary
	 * checkout, answer from now on: an answer, or null for the sample.
	 */
	setPullRequests(repository: string, list: PullRequestList | null): void;
	/** How many times the pull requests of a repository were read. */
	pullRequestReads(repository: string): number;
}

const pullRequest = (number: number, branch: string, title: string, fields: Partial<PullRequest> = {}): PullRequest => ({
	number,
	url: `https://github.com/example/${branch.split("/")[0]}/pull/${number}`,
	title,
	state: "open",
	baseBranch: "main",
	checks: { summary: "passing", passing: 3, failing: 0, pending: 0 },
	review: "review-required",
	...fields,
});

/** Sample pull requests by branch, in the repository the browser build calls timber. */
export const samplePullRequests: Readonly<Record<string, PullRequest>> = {
	"feat/github-issue-lookup": pullRequest(42, "timber", "Look up GitHub issues by number", { review: "approved" }),
	"fix/macos-portability": pullRequest(38, "timber", "Run on macOS without GNU tools", {
		checks: { summary: "failing", passing: 2, failing: 1, pending: 0 },
		review: "changes-requested",
	}),
	"feat/rate-limit-headers": pullRequest(17, "api-server", "Send rate limit headers", { state: "merged", review: "none" }),
	"feat/invoices": pullRequest(8, "billing", "Draft invoices", { state: "draft", checks: { summary: "pending", passing: 1, failing: 0, pending: 2 } }),
	"release/2.4": pullRequest(5, "billing", "Release 2.4", { state: "closed", checks: { summary: "none", passing: 0, failing: 0, pending: 0 }, review: "none" }),
};

/** Sample failures by primary checkout: every branch in it gets the reason, as from Timber. */
export const samplePullRequestFailures: Readonly<Record<string, { reason: PullRequestFailureReason; diagnostic: string }>> = {
	"/work/docs-site": {
		reason: "not-github",
		diagnostic: "The selected remote is not a github.com repository. Pull requests are read from github.com only; check the remote setting or the origin fetch URL.",
	},
};

/** What Timber would answer for a repository from the samples. */
export function sampleAnswer(repository: Repository): PullRequestList {
	const failure = samplePullRequestFailures[repository.path];
	const worktrees = repository.worktrees.map((worktree): PullRequestEntry => {
		const { path, branch } = worktree;
		if (branch === null) return { path, branch, outcome: "none" };
		if (failure) return { path, branch, outcome: "failed", ...failure };
		const found = samplePullRequests[branch];
		return found ? { path, branch, outcome: "found", pullRequest: found } : { path, branch, outcome: "none" };
	});
	return { ok: true, worktrees };
}

/**
 * Pull requests acted out from sample data, for the browser build and tests.
 * As the main process does, a repository must be in the list and Timber must
 * be ready, with the main process's words for when it is not.
 */
export function createMockPullRequests(listed: (path: string) => Repository | undefined, timber: () => TimberStatus): PullRequestCapabilities & PullRequestControls {
	const chosen = new Map<string, PullRequestList>();
	const reads = new Map<string, number>();
	return {
		async readPullRequests(repository) {
			reads.set(repository, (reads.get(repository) ?? 0) + 1);
			const found = listed(repository);
			if (!found) return { ok: false, message: `${repository} is not a repository in the app's list.` };
			const status = timber();
			if (status.state === "not-found") return { ok: false, message: "Timber was not found on PATH." };
			if (status.state === "too-old") return { ok: false, message: `Timber ${status.found} at ${status.path} is older than the required ${status.required}.` };
			return structuredClone(chosen.get(repository) ?? sampleAnswer(found));
		},
		setPullRequests(repository, list) {
			if (list === null) chosen.delete(repository);
			else chosen.set(repository, structuredClone(list));
		},
		pullRequestReads: repository => reads.get(repository) ?? 0,
	};
}
