import type { Engine } from "../../shared/engine";
import type { Repository, TimberStatus } from "../../shared/model";
import type { CheckRun, PullRequest, PullRequestEntry, PullRequestFailureReason, PullRequestList } from "../../shared/pull-requests";

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

type SampleFields = Partial<Omit<PullRequest, "checks">> & { summary?: PullRequest["checks"]["summary"]; runs?: CheckRun[] };

const run = (name: string, status: CheckRun["status"], link = true): CheckRun => ({
	name,
	status,
	url: link ? `https://github.com/example/checks/${encodeURIComponent(name)}` : null,
});

const SAMPLE_RUNS: CheckRun[] = [run("test", "passing"), run("lint", "passing"), run("typecheck", "passing")];

/** A sample pull request. The check counts come from its runs, as the parser counts them. */
const pullRequest = (number: number, branch: string, title: string, fields: SampleFields = {}): PullRequest => {
	const { summary = "passing", runs = SAMPLE_RUNS, ...rest } = fields;
	const count = (status: CheckRun["status"]) => runs.filter(candidate => candidate.status === status).length;
	return {
		number,
		url: `https://github.com/example/${branch.split("/")[0]}/pull/${number}`,
		title,
		state: "open",
		baseBranch: "main",
		checks: { summary, passing: count("passing"), failing: count("failing"), pending: count("pending"), runs: structuredClone(runs) },
		review: "review-required",
		description: "",
		...rest,
	};
};

/** Sample pull requests by branch, in the repository the browser build calls timber, one in each state. */
export const samplePullRequests: Readonly<Record<string, PullRequest>> = {
	"feat/github-issue-lookup": pullRequest(42, "timber", "Look up GitHub issues by number", {
		review: "approved",
		runs: [...SAMPLE_RUNS, run("docs", "skipped")],
		description: "Adds `timber new github:<n>`, which names the branch after the issue.\n\nCloses #41.\n\n<b>Markup</b> from GitHub shows as text.",
	}),
	"fix/macos-portability": pullRequest(38, "timber", "Run on macOS without GNU tools", {
		summary: "failing",
		runs: [run("test (ubuntu)", "passing"), run("test (macos)", "failing"), run("lint", "passing"), run("legacy status", "pending", false)],
		review: "changes-requested",
		description: "Replaces `sed -i` and `readlink -f`, which differ on macOS.",
	}),
	"feat/rate-limit-headers": pullRequest(17, "api-server", "Send rate limit headers", {
		state: "merged",
		review: "none",
		description: "Sends `RateLimit-Remaining` and `RateLimit-Reset` on every answer.",
	}),
	"feat/invoices": pullRequest(8, "billing", "Draft invoices", {
		state: "draft",
		summary: "pending",
		runs: [run("test", "passing"), run("build", "pending"), run("deploy preview", "pending")],
	}),
	"release/2.4": pullRequest(5, "billing", "Release 2.4", { state: "closed", summary: "none", runs: [], review: "none" }),
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
