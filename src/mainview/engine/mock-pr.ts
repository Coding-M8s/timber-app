import type { Repository, Worktree } from "../../shared/model";
import type { PullRequest, Reviewer } from "../../shared/pull-requests";
import { type CreatePullRequestRequest, type CreatePullRequestResult, type ReviewerRequestOutcome, prResultArguments, readPrResult } from "../../shared/timber-pr";
import { RESULT_FILE_PLACEHOLDER, type TimberRun, describeTimberCommand, readTimberResult } from "../../shared/timber-result";
import { samplePullRequestHosts } from "./mock-pull-requests";

/**
 * Acting out `timber pr --result-file` for the mock engine. Nothing is pushed
 * and nothing reaches GitHub. Each ending writes the record Timber would
 * write, and the record is read exactly as the main process reads a real one,
 * so the interface is tried against the same results it gets in the desktop
 * app.
 */

/** How the acted pull requests end. */
export const pullRequestEndings = {
	"created": "Timber publishes the branch and opens the pull request",
	"created-reviewer-failed": "Timber opens the pull request, but the first reviewer cannot be requested",
	"exists": "A pull request from the branch into that base is already open",
	"refused": "Timber refuses before it reads a login or pushes",
	"failed-login": "There is no GitHub login, so nothing is pushed",
	"failed-after-push": "The branch is published, then GitHub rejects the pull request",
	"no-result": "Timber exits with 1 but leaves no result",
} as const;

export type PullRequestEnding = keyof typeof pullRequestEndings;

export const isPullRequestEnding = (value: unknown): value is PullRequestEnding => typeof value === "string" && Object.hasOwn(pullRequestEndings, value);

/** Timber's wording when GitHub refuses a reviewer (422), from `timber pr --reviewer`. */
export const REVIEWER_REFUSED = "GitHub could not request this reviewer; check that they can access the repository and are not the pull request author.";

// Timber's checks of a --reviewer value: a login, or org/team with a team slug.
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9_]|-(?=[A-Za-z0-9_])){0,99}$/u;
const TEAM_SLUG = /^[A-Za-z0-9_](?:[A-Za-z0-9_-]){0,99}$/u;

/**
 * The reviewers as Timber takes them, in order: trimmed, each once whatever
 * its case, or null when one is not a login or `org/team`, which Timber
 * refuses before anything else.
 */
function takeReviewers(values: readonly string[]): { name: string; kind: "user" | "team" }[] | null {
	const taken: { name: string; kind: "user" | "team" }[] = [];
	for (const raw of values) {
		const name = raw.trim();
		const parts = name.split("/");
		const kind = parts.length === 1 && LOGIN.test(name) ? "user" : parts.length === 2 && LOGIN.test(parts[0]!) && TEAM_SLUG.test(parts[1]!) ? "team" : null;
		if (kind === null) return null;
		if (!taken.some(other => other.kind === kind && other.name.toLowerCase() === name.toLowerCase())) taken.push({ name, kind });
	}
	return taken;
}

/** The number the next acted pull request gets. */
let nextNumber = 300;

function worktreeRecord(worktree: Worktree): object {
	const { path, canonicalPath, branch, head, detached, pathExists, changes } = worktree;
	return {
		path, canonicalPath, branch, head, detached, pathExists,
		isPrimary: worktree.primary,
		locked: null,
		prunable: null,
		status: changes.kind === "known" ? { ...changes, ignored: [] } : changes,
	};
}

/** What the acted run answers, and the pull request the host would now list for the branch, if any. */
export interface ActedPullRequest {
	result: CreatePullRequestResult;
	opened: PullRequest | null;
}

/**
 * Act out one `timber pr`. The repository is the one from the pretend list
 * and `worktree` is one it lists whose folder is there. An empty title, a
 * reviewer that is not a login or `org/team`, and more than 15 reviewers are
 * refused whatever the ending, as Timber does. Created and exists request
 * each reviewer, trimmed and each once as Timber takes them, and the pull
 * request then lists the ones requested. The base is the branch part of
 * what was typed, or `main` for the saved one.
 */
export function actOutPullRequest(repository: Repository, worktree: Worktree, request: CreatePullRequestRequest, ending: PullRequestEnding): ActedPullRequest {
	const shown = describeTimberCommand(prResultArguments(request, RESULT_FILE_PLACEHOLDER));
	const base = request.base === null ? "main" : request.base.replace(/^refs\/remotes\//, "").split("/").slice(1).join("/") || request.base;
	const owner = repository.name.replace(/[^A-Za-z0-9_.-]/g, "-");
	// A sample repository on Bitbucket gets Bitbucket's link, as Timber 0.1.4 reports it.
	const link = (number: number) => samplePullRequestHosts[repository.path] === "bitbucket"
		? `https://bitbucket.org/example/${owner}/pull-requests/${number}`
		: `https://github.com/example/${owner}/pull/${number}`;

	const written = (pr: Record<string, unknown>, outcome: "succeeded" | "failed", diagnostic: string | null, printed: string): CreatePullRequestResult => {
		const failed = outcome === "failed";
		const text = JSON.stringify({
			schemaVersion: 1, command: "pr", outcome, exitCode: failed ? 1 : 0, materialized: false, diagnostic,
			repository: { commonGitDir: `${repository.path}/.git`, primaryWorktreeRoot: repository.path, currentWorktreeRoot: repository.path },
			worktree: worktreeRecord(worktree),
			pr,
		});
		const run: TimberRun = { command: shown, result: readTimberResult("pr", text, failed ? 1 : 0), output: { text: printed, truncated: false } };
		return readPrResult(run, worktree.path);
	};
	const none = { number: null, url: null, base, published: false, reviewers: [] };
	const refused = (diagnostic: string): ActedPullRequest =>
		({ result: written({ result: "refused", ...none }, "failed", diagnostic, `error: ${diagnostic}\n`), opened: null });

	if (request.title.trim() === "") return refused("Provide a pull request title with --title <text>.");
	const reviewers = takeReviewers(request.reviewers);
	if (reviewers === null) return refused("Each --reviewer must be a GitHub user login or org/team.");
	if (reviewers.length > 15) return refused("Request at most 15 reviewers with --reviewer.");
	/** What became of each reviewer: the first fails when the ending says so. */
	const outcomes = (firstFails: boolean): ReviewerRequestOutcome[] => reviewers.map((reviewer, index) => firstFails && index === 0
		? { ...reviewer, result: "failed", diagnostic: REVIEWER_REFUSED }
		: { ...reviewer, result: "requested", diagnostic: null });
	/** The requested ones, as GitHub then lists them on the pull request. The form sends none on Bitbucket, where it has no field; unlike Timber, this mock does not refuse them there. */
	const listed = (requested: readonly ReviewerRequestOutcome[]): Reviewer[] => requested.filter(outcome => outcome.result === "requested").map(({ name, kind }) => ({
		kind,
		name,
		state: "requested",
		url: kind === "team" ? `https://github.com/orgs/${name.replace("/", "/teams/")}` : `https://github.com/${name}`,
	}));
	const printedReviewers = (requested: readonly ReviewerRequestOutcome[]): string => {
		const failed = requested.filter(outcome => outcome.result === "failed").map(outcome => `warning: Could not request review from ${outcome.name}: ${outcome.diagnostic}\n`).join("");
		const names = requested.filter(outcome => outcome.result === "requested").map(outcome => outcome.name);
		return failed + (names.length > 0 ? `Requested review from ${names.join(", ")}.\n` : "");
	};
	const pull = (number: number, title: string, description: string, draft: boolean): PullRequest => ({
		number,
		url: link(number),
		title,
		state: draft ? "draft" : "open",
		baseBranch: base,
		checks: { summary: "pending", passing: 0, failing: 0, pending: 1, runs: [{ name: "test", status: "pending", url: null }] },
		review: "review-required",
		reviewers: [],
		reviewersComplete: true,
		description,
	});

	switch (ending) {
		case "created":
		case "created-reviewer-failed": {
			const number = nextNumber++;
			const requested = outcomes(ending === "created-reviewer-failed");
			const opened = { ...pull(number, request.title, request.body, request.draft), reviewers: listed(requested) };
			const result = written({ result: "created", number, url: opened.url, base, published: true, reviewers: requested }, "succeeded", null, `Published ${worktree.branch ?? ""}\nOpened ${opened.url}\n${printedReviewers(requested)}`);
			return { result, opened };
		}
		case "exists": {
			const number = nextNumber++;
			const requested = outcomes(false);
			const opened = { ...pull(number, "An earlier pull request for this branch", "Opened before, from another window.", false), reviewers: listed(requested) };
			const result = written({ result: "exists", number, url: opened.url, base, published: false, reviewers: requested }, "succeeded", null, `${worktree.branch ?? ""} is up to date on origin\nA pull request is already open: ${opened.url}\n${printedReviewers(requested)}`);
			return { result, opened };
		}
		case "refused":
			return refused(`The base remote for ${base} does not identify one github.com repository; Timber creates pull requests only on github.com.`);
		case "failed-login": {
			const diagnostic = "No GitHub login was found. Run gh auth login or set GH_TOKEN, then try again.";
			return { result: written({ result: "failed", ...none }, "failed", diagnostic, `error: ${diagnostic}\n`), opened: null };
		}
		case "failed-after-push": {
			const diagnostic = "GitHub rejected the pull request: there are no commits between the base and the branch.";
			return { result: written({ result: "failed", ...none, published: true }, "failed", diagnostic, `Published ${worktree.branch ?? ""}\nerror: ${diagnostic}\n`), opened: null };
		}
		case "no-result": {
			const run: TimberRun = { command: shown, result: readTimberResult("pr", null, 1), output: { text: "error: something went wrong\n", truncated: false } };
			return { result: readPrResult(run, worktree.path), opened: null };
		}
	}
}
