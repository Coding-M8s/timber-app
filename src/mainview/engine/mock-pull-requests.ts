import type { Engine } from "../../shared/engine";
import type { Repository, TimberStatus } from "../../shared/model";
import type { CheckRun, PullRequest, PullRequestEntry, PullRequestFailureReason, PullRequestList, Reviewer } from "../../shared/pull-requests";

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

/** How the acted `timber pr` tells the pretend GitHub about a pull request it opened or found. */
export interface PullRequestOpening {
	/** From now on, a worktree that has no pull request in the answer has this one. */
	openedPullRequest(repository: string, worktree: string, pull: PullRequest): void;
}

type SampleFields = Partial<Omit<PullRequest, "checks">> & { summary?: PullRequest["checks"]["summary"]; runs?: CheckRun[] };

const run = (name: string, status: CheckRun["status"], link = true): CheckRun => ({
	name,
	status,
	url: link ? `https://github.com/example/checks/${encodeURIComponent(name)}` : null,
});

const reviewer = (name: string, state: Reviewer["state"], kind: Reviewer["kind"] = "user"): Reviewer => ({
	kind,
	name,
	state,
	url: kind === "bot" ? null : kind === "team" ? `https://github.com/orgs/${name.replace("/", "/teams/")}` : `https://github.com/${name}`,
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
		reviewers: [],
		reviewersComplete: true,
		description: "",
		...rest,
	};
};

/** Sample pull requests by branch, in the repository the browser build calls timber, one in each state. */
export const samplePullRequests: Readonly<Record<string, PullRequest>> = {
	"feat/github-issue-lookup": pullRequest(42, "timber", "Look up GitHub issues by number", {
		review: "approved",
		reviewers: [reviewer("alice", "approved"), reviewer("copilot-pull-request-reviewer", "commented", "bot")],
		runs: [...SAMPLE_RUNS, run("docs", "skipped")],
		description: "Adds `timber new github:<n>`, which names the branch after the issue.\n\nCloses #41.\n\n<b>Markup</b> from GitHub shows as text.",
	}),
	"fix/macos-portability": pullRequest(38, "timber", "Run on macOS without GNU tools", {
		summary: "failing",
		runs: [run("test (ubuntu)", "passing"), run("test (macos)", "failing"), run("lint", "passing"), run("legacy status", "pending", false)],
		review: "changes-requested",
		reviewers: [reviewer("example/maintainers", "requested", "team"), reviewer("bob", "changes-requested"), reviewer("carol", "dismissed")],
		description: "Replaces `sed -i` and `readlink -f`, which differ on macOS.",
	}),
	"feat/rate-limit-headers": pullRequest(17, "api-server", "Send rate limit headers", {
		state: "merged",
		review: "none",
		reviewers: [reviewer("dana", "approved")],
		description: "Sends `RateLimit-Remaining` and `RateLimit-Reset` on every answer.",
	}),
	"feat/invoices": pullRequest(8, "billing", "Draft invoices", {
		state: "draft",
		summary: "pending",
		reviewers: [reviewer("erin", "requested")],
		reviewersComplete: false,
		runs: [run("test", "passing"), run("build", "pending"), run("deploy preview", "pending")],
	}),
	"release/2.4": pullRequest(5, "billing", "Release 2.4", { state: "closed", summary: "none", runs: [], review: "none" }),
	// The storefront repository, after several pull requests merged (issue 162).
	"feat/coupons": pullRequest(61, "storefront", "Apply coupons at checkout", { state: "merged", review: "approved" }),
	"chore/ci-cache": pullRequest(62, "storefront", "Cache dependencies in CI", { state: "merged", review: "approved" }),
	"feat/cart-redesign": pullRequest(63, "storefront", "Redesign the cart", { state: "merged", review: "approved" }),
	"fix/currency-rounding": pullRequest(64, "storefront", "Round currencies half to even", { state: "merged", review: "approved" }),
	"feat/wishlist": pullRequest(65, "storefront", "Save items to a wishlist", { review: "review-required" }),
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
export function createMockPullRequests(listed: (path: string) => Repository | undefined, timber: () => TimberStatus): PullRequestCapabilities & PullRequestControls & PullRequestOpening {
	const chosen = new Map<string, PullRequestList>();
	const reads = new Map<string, number>();
	// Pull requests the acted `timber pr` opened or found, by repository and then worktree path.
	const opened = new Map<string, Map<string, PullRequest>>();
	const withOpened = (repository: string, list: PullRequestList): PullRequestList => {
		const mine = opened.get(repository);
		if (!list.ok || !mine) return list;
		return {
			ok: true,
			worktrees: list.worktrees.map(entry => {
				const pull = entry.outcome === "none" ? mine.get(entry.path) : undefined;
				return pull ? { path: entry.path, branch: entry.branch, outcome: "found", pullRequest: pull } : entry;
			}),
		};
	};
	return {
		async readPullRequests(repository) {
			reads.set(repository, (reads.get(repository) ?? 0) + 1);
			const found = listed(repository);
			if (!found) return { ok: false, message: `${repository} is not a repository in the app's list.` };
			const status = timber();
			if (status.state === "not-found") return { ok: false, message: "Timber was not found on PATH." };
			if (status.state === "too-old") return { ok: false, message: `Timber ${status.found} at ${status.path} is older than the required ${status.required}.` };
			return structuredClone(withOpened(repository, chosen.get(repository) ?? sampleAnswer(found)));
		},
		openedPullRequest(repository, worktree, pull) {
			const mine = opened.get(repository) ?? new Map<string, PullRequest>();
			mine.set(worktree, structuredClone(pull));
			opened.set(repository, mine);
		},
		setPullRequests(repository, list) {
			if (list === null) chosen.delete(repository);
			else chosen.set(repository, structuredClone(list));
		},
		pullRequestReads: repository => reads.get(repository) ?? 0,
	};
}
