import type { IssueLink, IssueTracker, SavedBase, SavedBaseProblem, WorktreeChanges } from "./model";
import { isCommitHash } from "./file-changes";
import { describeExit, isFields, readEnvelope } from "./timber-record";

/**
 * Reading `timber ls --json`, version 1 of Timber's machine interface
 * (docs/ide-contract.md in the Timber repository). Pure: the main process
 * runs Timber and hands the output here (see src/bun/timber-ls.ts).
 */
export const TIMBER_LS_ARGUMENTS = ["ls", "--json"] as const;
export const TIMBER_LS_COMMAND = `timber ${TIMBER_LS_ARGUMENTS.join(" ")}`;
export const SUPPORTED_SCHEMA_VERSION = 1;

/** Which repository Timber found from the folder it was run in. */
export interface ListedRepository {
	/** The common Git directory, with links resolved. */
	commonGitDir: string;
	/** Absolute path of the primary checkout. */
	primaryWorktreeRoot: string;
}

/** One `WorktreeRecord`, in the app's words. Upstream state is not part of it. */
export interface ListedWorktree {
	path: string;
	canonicalPath: string | null;
	branch: string | null;
	head: string | null;
	primary: boolean;
	detached: boolean;
	locked: boolean;
	prunable: boolean;
	pathExists: boolean;
	changes: WorktreeChanges;
	/** The saved base, or null when the record has no `base` field, as from a Timber before it. */
	base: SavedBase | null;
	/** The saved issue link, or null when the record has no `issue` field, as from a Timber before it. */
	issue: IssueLink | null;
}

/** A whole list, in Timber's order, or the reason there is none. Never part of a list. */
export type TimberListing =
	| { ok: true; repository: ListedRepository; worktrees: ListedWorktree[] }
	| { ok: false; message: string };

export { type Fields, isFields } from "./timber-record";

const isText = (value: unknown): value is string => typeof value === "string";
export const isTextOrNull = (value: unknown): value is string | null => value === null || typeof value === "string";
const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);

/** `locked` and `prunable` are null, or an object holding an optional reason. */
function readFlag(value: unknown): boolean | null {
	if (value === null) return false;
	return isFields(value) && isTextOrNull(value.reason) ? true : null;
}

function readChanges(value: unknown): WorktreeChanges | null {
	if (!isFields(value)) return null;
	if (value.kind === "known" && isTextList(value.modified) && isTextList(value.untracked)) {
		return { kind: "known", modified: value.modified, untracked: value.untracked };
	}
	if (value.kind === "unknown" && isText(value.reason)) return { kind: "unknown", reason: value.reason };
	return null;
}

/**
 * The `base` field of a record. A record without the field comes from a
 * Timber before it, and reads as null: the app then shows no base. A field
 * that is there must be one of the four kinds the contract names, a commit
 * with its full lowercase hash; anything else answers "unreadable", so that a
 * base is never guessed.
 */
function readBase(value: unknown): SavedBase | null | "unreadable" {
	if (value === undefined) return null;
	if (!isFields(value)) return "unreadable";
	if (value.kind === "assigned" && isText(value.ref) && value.ref !== "") return { kind: "assigned", ref: value.ref };
	if (value.kind === "commit" && isText(value.commit) && isCommitHash(value.commit)) return { kind: "commit", commit: value.commit };
	if (value.kind === "unassigned") return { kind: "unassigned" };
	if (value.kind === "invalid" && (value.reason === "malformed" || value.reason === "stale" || value.reason === "unreadable")) {
		return { kind: "invalid", reason: value.reason };
	}
	return "unreadable";
}

const PROBLEMS: readonly SavedBaseProblem[] = ["malformed", "stale", "unreadable"];
export const ISSUE_TRACKERS: readonly IssueTracker[] = ["github", "jira", "linear"];
const isOneOf = <Value extends string>(values: readonly Value[], value: unknown): value is Value => isText(value) && (values as readonly string[]).includes(value);

/** True for an absolute `https` address, the only kind Timber saves for an issue. */
export function isHttpsLink(value: unknown): value is string {
	if (!isText(value)) return false;
	try {
		return new URL(value).protocol === "https:";
	} catch {
		return false;
	}
}

/**
 * The `issue` field of a record, read as strictly as `base`. A record
 * without the field comes from a Timber before it, and reads as null: the app
 * then shows no issue. A field that is there must be one of the three kinds
 * the contract names, with a known tracker and an `https` address; anything
 * else answers "unreadable", so that an issue is never guessed. A tracker
 * added to Timber later therefore makes an older app refuse the list.
 */
function readIssue(value: unknown): IssueLink | null | "unreadable" {
	if (value === undefined) return null;
	if (!isFields(value)) return "unreadable";
	const { kind, tracker, key, url, reason } = value;
	if (kind === "linked" && isOneOf(ISSUE_TRACKERS, tracker) && isText(key) && key.trim() !== "" && isHttpsLink(url)) return { kind, tracker, key, url };
	if (kind === "none") return { kind };
	if (kind === "invalid" && isOneOf(PROBLEMS, reason)) return { kind, reason };
	return "unreadable";
}

/** Null when the value is not a version 1 `WorktreeRecord`. Fields this app does not use are ignored. Result files carry the same record. */
export function readWorktree(value: unknown): ListedWorktree | null {
	if (!isFields(value)) return null;
	const { path, canonicalPath, branch, head, isPrimary, detached, pathExists } = value;
	const locked = readFlag(value.locked);
	const prunable = readFlag(value.prunable);
	const changes = readChanges(value.status);
	if (!isText(path) || path === "" || !isTextOrNull(canonicalPath) || !isTextOrNull(branch) || !isTextOrNull(head)) return null;
	if (typeof isPrimary !== "boolean" || typeof detached !== "boolean" || typeof pathExists !== "boolean") return null;
	const base = readBase(value.base);
	const issue = readIssue(value.issue);
	if (locked === null || prunable === null || changes === null || base === "unreadable" || issue === "unreadable") return null;
	return { path, canonicalPath, branch, head, primary: isPrimary, detached, locked, prunable, pathExists, changes, base, issue };
}

export function readRepository(value: unknown): ListedRepository | null {
	if (!isFields(value)) return null;
	const { commonGitDir, primaryWorktreeRoot } = value;
	if (!isText(commonGitDir) || commonGitDir === "" || !isText(primaryWorktreeRoot) || primaryWorktreeRoot === "") return null;
	return { commonGitDir, primaryWorktreeRoot };
}

const failed = (message: string): TimberListing => ({ ok: false, message });
const unreadable = (detail: string) => failed(`${TIMBER_LS_COMMAND} did not answer with a record this app can read: ${detail}.`);

/**
 * Read what one run of `timber ls --json` printed. `exitCode` is the exit
 * code of that process, or null when it did not exit by itself.
 *
 * A list is accepted only as a whole: the output must be one version 1 record
 * for `ls`, its exit code must be the one the process really had, and every
 * worktree in it must be readable. Anything else is a failure with a message
 * for the person, never a shorter list.
 */
export function readTimberListing(stdout: string, exitCode: number | null): TimberListing {
	const envelope = readEnvelope(stdout, TIMBER_LS_COMMAND, SUPPORTED_SCHEMA_VERSION);
	if (!envelope.ok) return envelope.problem === "version" ? failed(envelope.message) : unreadable(envelope.detail);
	const { record } = envelope;

	const { command, outcome, diagnostic, worktrees } = record;
	if (command !== "ls") return unreadable("it is not a record for ls");
	if (outcome !== "succeeded" && outcome !== "failed" && outcome !== "cancelled") return unreadable("its outcome is not one this app knows");
	if (typeof record.exitCode !== "number" || !Number.isInteger(record.exitCode)) return unreadable("it has no exit code");
	if (!isTextOrNull(diagnostic)) return unreadable("its diagnostic is not text");
	if (!Array.isArray(worktrees)) return unreadable("it has no list of worktrees");

	if (record.exitCode !== exitCode) {
		return failed(`${TIMBER_LS_COMMAND} ${describeExit(exitCode)}, but its record says exit code ${record.exitCode}. The list was not used.`);
	}
	// The contract ties the two together: succeeded exits with 0, and failed never does.
	if ((outcome === "failed") === (record.exitCode === 0)) return unreadable(`its outcome "${outcome}" does not go with exit code ${record.exitCode}`);
	if (outcome === "failed") return failed(diagnostic ?? `${TIMBER_LS_COMMAND} failed without saying why.`);
	if (outcome === "cancelled") return failed(`${TIMBER_LS_COMMAND} was cancelled.`);

	const repository = readRepository(record.repository);
	if (!repository) return unreadable("it does not say which repository it lists");
	const listed: ListedWorktree[] = [];
	for (const [index, value] of worktrees.entries()) {
		const worktree = readWorktree(value);
		if (!worktree) return unreadable(`worktree ${index + 1} of ${worktrees.length} is not a worktree record`);
		listed.push(worktree);
	}
	return { ok: true, repository, worktrees: listed };
}
