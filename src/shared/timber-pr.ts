import type { SavedBase, TimberFailure } from "./model";
import { type Fields, isFields, isTextOrNull } from "./timber-ls";
import { type TimberRun, failureOf } from "./timber-result";

/**
 * `timber pr` with a result file, and what its record means to the
 * interface. Pure: the interface words the command from the same function the
 * main process runs it from (see src/bun/worktree-commands.ts), so the
 * command shown is the command that runs.
 *
 * Timber owns every rule about publishing a branch and opening a pull
 * request: the title, the base, the remote, the login, and the push. Nothing
 * here repeats one. The app never pushes or calls GitHub on its own.
 */

/** A worktree whose last commit's subject to read, for the title a pull request starts with. */
export interface HeadSubjectRequest {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. */
	worktree: string;
}

/** Publish a worktree's branch and open a pull request for it. */
export interface CreatePullRequestRequest {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. It is the selector given to Timber. */
	worktree: string;
	/** Always passed, even when empty: Timber says what a title needs. */
	title: string;
	/** Passed as `--body` unless it is empty. */
	body: string;
	/** Passed as `--base`. Null for the base Timber saved for the worktree. */
	base: string | null;
	draft: boolean;
}

/**
 * Everything after `timber`: the options first, then `--`, then the
 * worktree's registered path as one argument, so a path that starts with a
 * dash is never read as an option. Each value is its own argument after its
 * option, so a title or a description that starts with a dash stays text.
 * `resultFile` is put in as it is.
 */
export function prResultArguments(request: Pick<CreatePullRequestRequest, "worktree" | "title" | "body" | "base" | "draft">, resultFile: string): string[] {
	return [
		"pr",
		"--title", request.title,
		...(request.body === "" ? [] : ["--body", request.body]),
		...(request.base === null ? [] : ["--base", request.base]),
		...(request.draft ? ["--draft"] : []),
		"--result-file", resultFile,
		"--", request.worktree,
	];
}

/**
 * The Base field's text as Timber takes it: the spaces around it are left
 * off, and empty means the base Timber saved for the worktree.
 */
export function pullRequestBaseFromText(text: string): string | null {
	const trimmed = text.trim();
	return trimmed === "" ? null : trimmed;
}

/**
 * What the Base field starts as: the saved base in the form `timber pr
 * --base` takes, `<remote>/<branch>`. A saved local branch is not a base
 * Timber opens a pull request into, and nothing saved is not one either, so
 * those leave the field empty and Timber says what it needs.
 */
export function initialPullRequestBase(base: SavedBase | null): string {
	if (base?.kind !== "assigned" || !base.ref.startsWith("refs/remotes/")) return "";
	return base.ref.slice("refs/remotes/".length);
}

/** A pull request Timber reported, with what this run did to the branch. */
export interface ReportedPullRequest {
	number: number;
	/** `https://github.com/<owner>/<repo>/pull/<number>`, built by Timber from the validated repository. */
	url: string;
	/** The base branch as GitHub names it, such as `main`. */
	base: string | null;
	/** This run pushed commits to the remote. */
	published: boolean;
}

/** How one `timber pr` ended. */
export type CreatePullRequestResult =
	/** This run opened the pull request. */
	| ({ outcome: "created" } & ReportedPullRequest)
	/** One from the branch into the same base was already open. Nothing was created, though the branch may have been published. */
	| ({ outcome: "exists" } & ReportedPullRequest)
	/** Timber declined, or the push was refused because the remote branch moved on. Nothing was pushed. */
	| { outcome: "refused"; failure: TimberFailure }
	/**
	 * Something broke. `ran` is false only when the app refused before it ran
	 * anything. `published` is true when this run pushed before it failed,
	 * and null when what it did is unknown.
	 */
	| { outcome: "failed"; ran: boolean; published: boolean | null; failure: TimberFailure };

type Kind = "created" | "exists" | "refused" | "failed";

const KINDS: readonly string[] = ["created", "exists", "refused", "failed"];

interface PrFields {
	result: Kind;
	number: number | null;
	url: string | null;
	base: string | null;
	published: boolean;
}

/** The `pr` object of a record, or why it cannot be used. */
function readFields(value: unknown): PrFields | string {
	if (!isFields(value)) return "it has no pr object";
	const { result, number, url, base, published } = value as Fields;
	if (typeof result !== "string" || !KINDS.includes(result)) return "its pr result is not one this app knows";
	if (number !== null && (typeof number !== "number" || !Number.isSafeInteger(number) || number <= 0)) return "its pull request number is not a number";
	if (!isTextOrNull(url) || !isTextOrNull(base)) return "its link or base is not text";
	if (typeof published !== "boolean") return "it does not say whether the branch was published";
	return { result: result as Kind, number, url, base, published };
}

function isPullRequestLink(url: string): boolean {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" && parsed.hostname === "github.com";
	} catch {
		return false;
	}
}

/**
 * What one run of `timber pr --result-file` came to. `worktreePath` is the
 * registered path the pull request was asked for: a record about another
 * worktree is not used. A record counts only when its pr object is complete
 * and goes with Timber's outcome. Anything else is a failure whose effect is
 * unknown, since the branch may have been published. What Timber printed is
 * passed on for the details area and never read here.
 */
export function readPrResult(run: TimberRun, worktreePath: string): CreatePullRequestResult {
	const { result } = run;
	if (result.outcome === "failed" && result.record === null) {
		return { outcome: "failed", ran: true, published: null, failure: failureOf(run)! };
	}
	const { record } = result;
	const unreadable = (detail: string) => unknownResult(run, detail, record?.fields.exitCode as number | undefined);
	if (record === null) return unreadable("there is no record");
	if (result.outcome === "cancelled") return unreadable("it says it was cancelled, which timber pr never is");

	if (record.worktree !== null && record.worktree.path !== worktreePath) {
		return {
			outcome: "failed",
			ran: true,
			published: null,
			failure: { command: run.command, diagnostic: `Timber answered with a result for ${record.worktree.path}, not for ${worktreePath}. It was not used, so what it did is unknown. Check the branch and its pull requests before trying again.`, output: run.output },
		};
	}
	const fields = readFields(record.fields.pr);
	if (typeof fields === "string") return unreadable(fields);

	const { result: kind } = fields;
	const reported = kind === "created" || kind === "exists";
	if (reported !== (result.outcome === "succeeded")) return unreadable(`its result "${kind}" does not go with its outcome "${result.outcome}"`);
	if (reported !== (fields.number !== null) || reported !== (fields.url !== null)) {
		return unreadable(reported ? `it reports "${kind}" without a pull request` : `it names a pull request for a result of "${kind}"`);
	}
	if (fields.url !== null && !isPullRequestLink(fields.url)) return unreadable("its link is not a GitHub link");
	if (kind === "refused" && fields.published) return unreadable("it says a refused run published the branch");

	if (reported) return { outcome: kind, number: fields.number!, url: fields.url!, base: fields.base, published: fields.published };
	const failure = failureOf(run)!;
	if (kind === "refused") return { outcome: "refused", failure };
	return { outcome: "failed", ran: true, published: fields.published, failure };
}

/** A record this app cannot use, in the voice of `readTimberResult`: what the command did is unknown. */
function unknownResult(run: TimberRun, detail: string, exitCode: number | undefined): CreatePullRequestResult {
	const exited = exitCode === undefined ? "ended" : `exited with code ${exitCode}`;
	return {
		outcome: "failed",
		ran: true,
		published: null,
		failure: {
			command: run.command,
			diagnostic: `timber pr ${exited} and left a result this app cannot read (${detail}), so what it did is unknown. The details below show what it printed.`,
			output: run.output,
		},
	};
}
