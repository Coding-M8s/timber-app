import type { Repository, Worktree } from "../../shared/model";
import type { PullRequest } from "../../shared/pull-requests";
import { type CreatePullRequestRequest, type CreatePullRequestResult, prResultArguments, readPrResult } from "../../shared/timber-pr";
import { RESULT_FILE_PLACEHOLDER, type TimberRun, describeTimberCommand, readTimberResult } from "../../shared/timber-result";

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
	"exists": "A pull request from the branch into that base is already open",
	"refused": "Timber refuses before it reads a login or pushes",
	"failed-login": "There is no GitHub login, so nothing is pushed",
	"failed-after-push": "The branch is published, then GitHub rejects the pull request",
	"no-result": "Timber exits with 1 but leaves no result",
} as const;

export type PullRequestEnding = keyof typeof pullRequestEndings;

export const isPullRequestEnding = (value: unknown): value is PullRequestEnding => typeof value === "string" && Object.hasOwn(pullRequestEndings, value);

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

/** What the acted run answers, and the pull request GitHub would now list for the branch, if any. */
export interface ActedPullRequest {
	result: CreatePullRequestResult;
	opened: PullRequest | null;
}

/**
 * Act out one `timber pr`. The repository is the one from the pretend list
 * and `worktree` is one it lists whose folder is there. An empty title is
 * refused whatever the ending, as Timber does. The base is the branch part of
 * what was typed, or `main` for the saved one.
 */
export function actOutPullRequest(repository: Repository, worktree: Worktree, request: CreatePullRequestRequest, ending: PullRequestEnding): ActedPullRequest {
	const shown = describeTimberCommand(prResultArguments(request, RESULT_FILE_PLACEHOLDER));
	const base = request.base === null ? "main" : request.base.replace(/^refs\/remotes\//, "").split("/").slice(1).join("/") || request.base;
	const owner = repository.name.replace(/[^A-Za-z0-9_.-]/g, "-");

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
	const none = { number: null, url: null, base, published: false };
	const refused = (diagnostic: string): ActedPullRequest =>
		({ result: written({ result: "refused", ...none }, "failed", diagnostic, `error: ${diagnostic}\n`), opened: null });

	if (request.title.trim() === "") return refused("Provide a pull request title with --title <text>.");
	const pull = (number: number, title: string, description: string, draft: boolean): PullRequest => ({
		number,
		url: `https://github.com/example/${owner}/pull/${number}`,
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
		case "created": {
			const number = nextNumber++;
			const opened = pull(number, request.title, request.body, request.draft);
			const result = written({ result: "created", number, url: opened.url, base, published: true }, "succeeded", null, `Published ${worktree.branch ?? ""}\nOpened ${opened.url}\n`);
			return { result, opened };
		}
		case "exists": {
			const number = nextNumber++;
			const opened = pull(number, "An earlier pull request for this branch", "Opened before, from another window.", false);
			const result = written({ result: "exists", number, url: opened.url, base, published: false }, "succeeded", null, `${worktree.branch ?? ""} is up to date on origin\nA pull request is already open: ${opened.url}\n`);
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
