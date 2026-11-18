import { isFields } from "./timber-ls";
import { displayText, readDiagnostic } from "./workflows";

/**
 * Reading each worktree's pull request from `timber __app-pr`, version 1 of
 * Timber's pull request record (docs/ide-contract.md in the Timber
 * repository). Pure: the main process runs Timber and hands the output here
 * (see src/bun/pull-requests.ts).
 *
 * Timber reads GitHub with its own login, so the app never holds a token.
 * Timber reports no reviewers, only the review decision.
 */
export const APP_PR_ARGUMENTS = ["__app-pr"] as const;
export const APP_PR_COMMAND = `timber ${APP_PR_ARGUMENTS.join(" ")}`;
export const SUPPORTED_APP_PR_SCHEMA_VERSION = 1;

export type PullRequestState = "open" | "draft" | "merged" | "closed";
/** GitHub's combined state of the checks on the head commit. `none` means none were reported. */
export type ChecksSummary = "passing" | "failing" | "pending" | "none";
/** GitHub's review decision. `none` means the repository asks for no review decision on it. */
/** How one check run or commit status ended, or that it has not yet. */
export type CheckRunStatus = "passing" | "failing" | "pending" | "skipped";
export type ReviewDecision = "approved" | "changes-requested" | "review-required" | "none";
/**
 * Why Timber could not look pull requests up. One lookup answers for the
 * whole repository, so a failure applies to every branch in it.
 * - `offline`: GitHub could not be reached, or did not answer in time.
 * - `sign-in-needed`: no usable GitHub login, or GitHub refused it.
 * - `not-github`: the repository's remote is not on github.com.
 * - `failed`: anything else, such as denied access or a rate limit.
 */
export type PullRequestFailureReason = "offline" | "sign-in-needed" | "not-github" | "failed";

/** One check run or commit status on the pull request's head commit. */
export interface CheckRun {
	/** Text from GitHub, made safe to show. */
	name: string;
	status: CheckRunStatus;
	/** An `https` link to the run, or null when there is none to follow. */
	url: string | null;
}

/** One pull request, as much of it as the interface shows. */
export interface PullRequest {
	number: number;
	/** An `https` link to the pull request on GitHub. */
	url: string;
	/** Text from GitHub, made safe to show. Never trusted markup. */
	title: string;
	state: PullRequestState;
	/** The branch it merges into, by its name on GitHub. Made safe to show. */
	baseBranch: string;
	checks: {
		summary: ChecksSummary;
		/** How many check runs and commit statuses Timber listed, by status. Timber lists at most 100. */
		passing: number;
		failing: number;
		pending: number;
		/** Each one, in Timber's order. */
		runs: CheckRun[];
	};
	review: ReviewDecision;
	/** The body as written, made safe to show as plain text: line breaks and tabs kept, other control characters replaced. Never trusted markup. May be empty. */
	description: string;
}

/** What Timber found for one worktree, named by its Git-registered path, as in `timber ls --json`. */
export type PullRequestEntry =
	| { path: string; branch: string | null; outcome: "found"; pullRequest: PullRequest }
	/** No pull request was found. Always the answer for a detached HEAD. */
	| { path: string; branch: string | null; outcome: "none" }
	| { path: string; branch: string; outcome: "failed"; reason: PullRequestFailureReason; diagnostic: string };

/** Every worktree's pull request in Timber's order, or the reason there is no answer. Never part of one. */
export type PullRequestList =
	| { ok: true; worktrees: PullRequestEntry[] }
	| { ok: false; message: string };

const STATES: readonly PullRequestState[] = ["open", "draft", "merged", "closed"];
const SUMMARIES: readonly ChecksSummary[] = ["passing", "failing", "pending", "none"];
const RUN_STATUSES: readonly CheckRunStatus[] = ["passing", "failing", "pending", "skipped"];
const REVIEWS: readonly ReviewDecision[] = ["approved", "changes-requested", "review-required", "none"];
const REASONS: readonly PullRequestFailureReason[] = ["offline", "sign-in-needed", "not-github", "failed"];

/** How much of a diagnostic is passed on. */
const DIAGNOSTIC_LIMIT = 300;
/** How much of a description is passed on, in characters. GitHub allows 65536. */
const DESCRIPTION_LIMIT = 20000;

const oneOf = <Value extends string>(values: readonly Value[], value: unknown): value is Value => typeof value === "string" && (values as readonly string[]).includes(value);

const failed = (message: string): PullRequestList => ({ ok: false, message });
const unreadable = (detail: string) => failed(`${APP_PR_COMMAND} did not answer with a record this app can read: ${detail}.`);

function readLink(value: unknown): string | null {
	if (typeof value !== "string") return null;
	try {
		const url = new URL(value);
		return url.protocol === "https:" ? value : null;
	} catch {
		return null;
	}
}

/**
 * A description as plain text that keeps its lines: Windows line endings
 * become one break, and every control character other than a line break or
 * a tab is replaced, as in any other text from GitHub. Pure.
 */
export function descriptionText(value: string, limit = DESCRIPTION_LIMIT): string {
	const clean = value
		.replace(/\r\n?/g, "\n")
		.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]/g, "\uFFFD")
		.trim();
	const characters = Array.from(clean);
	return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}\u2026` : clean;
}

function readChecks(value: unknown): PullRequest["checks"] | null {
	if (!isFields(value) || !oneOf(SUMMARIES, value.summary) || !Array.isArray(value.runs)) return null;
	const counts = { passing: 0, failing: 0, pending: 0, skipped: 0 };
	const runs: CheckRun[] = [];
	for (const run of value.runs) {
		if (!isFields(run) || typeof run.name !== "string" || !oneOf(RUN_STATUSES, run.status)) return null;
		if (run.url !== null && typeof run.url !== "string") return null;
		counts[run.status] += 1;
		// A link that is not https, which a commit status may set to anything, is not offered.
		runs.push({ name: displayText(run.name.trim()), status: run.status, url: readLink(run.url) });
	}
	return { summary: value.summary, passing: counts.passing, failing: counts.failing, pending: counts.pending, runs };
}

/** Null when the value is not one pull request. Fields this app does not use are ignored. */
function readPullRequest(value: unknown): PullRequest | null {
	if (!isFields(value)) return null;
	const { number, title, state, baseBranch, review, description } = value;
	if (typeof number !== "number" || !Number.isSafeInteger(number) || number < 1) return null;
	const url = readLink(value.url);
	if (url === null || typeof title !== "string" || typeof baseBranch !== "string" || typeof description !== "string") return null;
	if (!oneOf(STATES, state) || !oneOf(REVIEWS, review)) return null;
	const checks = readChecks(value.checks);
	if (checks === null) return null;
	return { number, url, title: displayText(title.trim()), state, baseBranch: displayText(baseBranch), checks, review, description: descriptionText(description) };
}

/** Null when the value is not one entry, or its fields do not agree with its outcome. */
function readEntry(value: unknown): PullRequestEntry | null {
	if (!isFields(value)) return null;
	const { path, branch, outcome } = value;
	if (typeof path !== "string" || path === "" || (branch !== null && typeof branch !== "string")) return null;
	if (outcome === "found") {
		if (value.reason !== null || value.diagnostic !== null) return null;
		const pullRequest = readPullRequest(value.pullRequest);
		return pullRequest === null ? null : { path, branch, outcome, pullRequest };
	}
	if (outcome === "none") {
		return value.pullRequest === null && value.reason === null && value.diagnostic === null ? { path, branch, outcome } : null;
	}
	if (outcome === "failed") {
		// A detached HEAD has no branch to look up, so it is never a failure.
		if (branch === null || value.pullRequest !== null || !oneOf(REASONS, value.reason) || typeof value.diagnostic !== "string") return null;
		const diagnostic = value.diagnostic.trim() === "" ? "Timber did not say why." : displayText(value.diagnostic.trim(), DIAGNOSTIC_LIMIT);
		return { path, branch, outcome, reason: value.reason, diagnostic };
	}
	return null;
}

/**
 * Read what one run of `timber __app-pr` printed. `exitCode` is the exit code
 * of that process, or null when it did not exit by itself.
 *
 * Timber prints its record whether it exits with 0 or with 1, and 1 means
 * that the repository could not be read or a lookup failed. An answer is
 * accepted only as a whole: one version 1 record, with every entry readable.
 * A repository Timber could not read, an exit code other than 0 or 1, or a
 * record that cannot be read is a failure with a message for the person,
 * never a shorter or empty answer.
 */
export function readPullRequestList(stdout: string, stderr: string, exitCode: number | null): PullRequestList {
	const ending = exitCode === null ? "did not exit by itself" : `exited with code ${exitCode}`;
	const explained = () => {
		const diagnostic = readDiagnostic(stderr);
		return failed(diagnostic === null ? `${APP_PR_COMMAND} ${ending} without saying why.` : `${APP_PR_COMMAND} ${ending}: ${diagnostic}`);
	};
	if (exitCode !== 0 && exitCode !== 1) return explained();

	let record: unknown;
	try {
		record = JSON.parse(stdout);
	} catch {
		// An older Timber without the command prints nothing and says so on standard error.
		if (exitCode !== 0) return explained();
		return unreadable(stdout.trim() === "" ? "it printed nothing" : "the output is not valid JSON");
	}
	if (!isFields(record)) return unreadable("the output is not a JSON object");

	if (record.schemaVersion !== SUPPORTED_APP_PR_SCHEMA_VERSION) {
		const found = typeof record.schemaVersion === "number" || typeof record.schemaVersion === "string" ? String(record.schemaVersion) : "none";
		return failed(`${APP_PR_COMMAND} answered with schema version ${found}, and this app reads version ${SUPPORTED_APP_PR_SCHEMA_VERSION} only. Update Timber app, or install a Timber that matches it.`);
	}
	if (typeof record.diagnostic === "string" && record.diagnostic.trim() !== "") {
		return failed(`${APP_PR_COMMAND} could not read the repository: ${displayText(record.diagnostic.trim(), DIAGNOSTIC_LIMIT)}`);
	}
	if (record.diagnostic !== null) return unreadable("its diagnostic is not text");
	if (!Array.isArray(record.worktrees)) return unreadable("it has no list of worktrees");

	const worktrees: PullRequestEntry[] = [];
	for (const [index, value] of record.worktrees.entries()) {
		const entry = readEntry(value);
		if (entry === null) return unreadable(`worktree ${index + 1} of ${record.worktrees.length} is not an entry this app can read`);
		worktrees.push(entry);
	}
	// Timber exits with 1 exactly when a lookup failed, so an answer that says otherwise is not trusted.
	const anyFailed = worktrees.some(entry => entry.outcome === "failed");
	if (anyFailed !== (exitCode === 1)) return unreadable(`it ${ending}, which does not match its entries`);
	return { ok: true, worktrees };
}

/** The entry for one worktree, by its Git-registered path, or null when the answer has none for it. */
export function pullRequestOf(list: PullRequestList | undefined, path: string): PullRequestEntry | null {
	if (!list?.ok) return null;
	return list.worktrees.find(entry => entry.path === path) ?? null;
}
