import type { SuggestedIssue } from "../shared/issue-search";
import { issueLinkSelector } from "../shared/issue-trackers";
import type { Assignment, IssueTracker, NewWorktreeRequest, WorktreeCommandResult } from "../shared/model";
import { displayText } from "../shared/timber-record";
import { allRefused, checkOutChoice, githubLink, sameRepository } from "./check-out-format";
import { TRACKER_NAMES, issueKeyLabel } from "./issue-format";

/**
 * Start work on the issues board: which cards offer it, the `timber new`
 * request it makes, what must be asked before it runs, and the words for
 * how it went. Pure.
 *
 * Start work runs `timber new <tracker>:<key>` with the whole selector that
 * `issueLinkSelector` makes, never a bare key, which Timber would read with
 * its default tracker. So the worktree is always linked to the issue, also
 * with a branch name the person typed (`--branch`). It always passes
 * `--assign`, so the issue is assigned to the person who started it, or
 * `--reassign` once they agreed to replace someone else, and `-c` once they
 * agreed to start work on a closed issue.
 *
 * The app never predicts the branch Timber generates: that is Timber's to
 * decide (Timber's ide-contract), so an empty Branch field means Timber's
 * name.
 */

export const START_WORK_LABEL = "Start work";
export const OPEN_WORKTREE_LABEL = "Open worktree";
export const CHECK_OUT_THEIRS_LABEL = "Check out their pull request";

/** Why a card offers no runnable Start work, said on its button. */
export const START_ELSEWHERE_REFUSAL = "This issue is in another GitHub repository, so work on it cannot start here.";
export const START_KEY_REFUSAL = "Timber cannot be given this issue's key exactly, so work on it cannot start here.";

/** What Start work offers for a card without a worktree: the selector `timber new` gets, or why it cannot start here. */
export type StartWorkChoice = { ok: true; selector: string } | { ok: false; reason: string };

/**
 * What Start work offers for a card, or null for a card with a worktree
 * here, which offers Open worktree instead. A GitHub issue of another
 * repository, which a project's sprint can hold, is refused: `github:<n>`
 * names issue n of this repository. `githubRepository` is this
 * repository's github.com "owner/name", or null.
 */
export function startWorkChoice(issue: SuggestedIssue, githubRepository: string | null): StartWorkChoice | null {
	if (issue.worktree !== null) return null;
	const selector = issueLinkSelector(issue.tracker, issue.key);
	if (selector === null) return { ok: false, reason: START_KEY_REFUSAL };
	if (issue.tracker === "github") {
		const link = githubLink(issue.url);
		const here = link !== null && link.kind === "issues" && githubRepository !== null && sameRepository(link.repository, githubRepository);
		if (!here) return { ok: false, reason: START_ELSEWHERE_REFUSAL };
	}
	return { ok: true, selector };
}

/**
 * Whether the question about another assignee also offers checking out the
 * issue's open pull request: only when Check out PR has one that can be
 * opened here (see `checkOutChoice`).
 */
export function offersCheckOut(issue: SuggestedIssue, githubRepository: string | null): boolean {
	const choice = checkOutChoice(issue, githubRepository);
	return choice !== null && !allRefused(choice);
}

/**
 * The ID a branch for the issue must start with, followed by `-`:
 * `GH-<n>` for GitHub, the key in capitals for Jira and Linear. Only for the
 * Branch field's hint: Timber checks the name itself, with the key the
 * tracker answers, for example a moved Linear issue's new key.
 */
export function branchPrefix(tracker: IssueTracker, key: string): string {
	return tracker === "github" ? `GH-${key}-` : `${key.toUpperCase()}-`;
}

/**
 * What the person must agree to before Start work runs. `replace` names the
 * assignees to replace (`--reassign`), or is null when the issue is
 * unassigned, already theirs, or nobody can tell yet; `partial` is true
 * when the names came from the board, which lists only a GitHub issue's
 * first assignee. `closed` is the closed or done status's name (`-c`), or
 * null.
 */
export interface StartWorkQuestion {
	replace: string[] | null;
	partial: boolean;
	closed: string | null;
}

/**
 * What to ask from the card alone, as the dialog opens. Someone else has the
 * issue when Timber says it is not the person's and names an assignee. When
 * Timber could not tell (`assignedToMe` null), nothing is asked: Timber
 * refuses `--assign` on someone else's issue, and the dialog asks then
 * (`assigneeRefusal`).
 */
export function initialQuestion(issue: SuggestedIssue): StartWorkQuestion {
	const someoneElse = issue.assignedToMe === false && issue.assignee !== null;
	return {
		replace: someoneElse ? [issue.assignee!] : null,
		partial: someoneElse && issue.tracker === "github",
		closed: issue.status.category === "closed" ? issue.status.name : null,
	};
}

/**
 * The assignees to ask about after a run Timber refused because someone else
 * has the issue, or null when the failure is any other. Timber's record
 * says `not-attempted` and names them in `previous`. It says the same when a
 * later step failed before the write, so this counts only a run that asked
 * for `--assign` (not `--reassign`), created nothing, and whose card did
 * not say the issue is the person's, and never names the signed-in account.
 */
export function assigneeRefusal(result: WorktreeCommandResult, passed: NewWorktreeRequest["assign"], issue: Pick<SuggestedIssue, "assignedToMe">): string[] | null {
	if (result.outcome !== "failed" || result.created || passed !== "assign" || issue.assignedToMe === true) return null;
	const assignment = result.assignment;
	if (assignment === undefined || assignment.result !== "not-attempted") return null;
	const me = assignment.me.toLowerCase();
	const others = assignment.previous.filter(name => name.toLowerCase() !== me);
	return others.length > 0 && others.length === assignment.previous.length ? others : null;
}

/** What the person typed in the Start work dialog, as typed. */
export interface StartWorkFields {
	/** Empty for the branch Timber generates. */
	branch: string;
	/** "Start from". Empty for Timber's configured base. */
	base: string;
	/** The Workflow field as picked, or null for None. */
	workflow: string | null;
}

/**
 * The `timber new` request: the issue's whole selector as the name, so the
 * link is never lost, the branch and base without the spaces around them
 * (empty means Timber's), `--reassign` when the person agreed to replace
 * someone and `--assign` otherwise, and `-c` for a closed issue.
 */
export function startWorkRequest(repository: string, selector: string, fields: Omit<StartWorkFields, "workflow">, question: StartWorkQuestion, workflow: string | null): NewWorktreeRequest {
	const branch = fields.branch.trim();
	const base = fields.base.trim();
	return {
		repository,
		name: selector,
		base: base === "" ? null : base,
		...(workflow === null ? {} : { workflow }),
		...(branch === "" ? {} : { branch }),
		...(question.closed === null ? {} : { allowClosed: true as const }),
		assign: question.replace === null ? "assign" : "reassign",
	};
}

const joinNames = (names: readonly string[]) =>
	names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;

/** The question as the dialog words it, one sentence per thing to agree to, or none. */
export function describeQuestion(question: StartWorkQuestion, tracker: IssueTracker, key: string): string[] {
	const label = issueKeyLabel(tracker, key);
	const lines: string[] = [];
	if (question.closed !== null) {
		lines.push(`${label} is ${displayText(question.closed, 40)} in ${TRACKER_NAMES[tracker]}. Start work anyway creates its worktree (-c) and does not reopen it.`);
	}
	if (question.replace !== null) {
		const names = joinNames(question.replace.map(name => displayText(name, 100)));
		const more = question.partial ? " GitHub may list others beside them, and they are replaced too." : "";
		lines.push(`${label} is assigned to ${names}. Starting work replaces ${question.replace.length > 1 ? "them" : "that assignee"} with you (--reassign).${more} Cancel to leave it as it is: nothing is created or assigned.`);
	}
	return lines;
}

/** The submit button's words for a question. */
export function startWorkSubmitLabel(question: StartWorkQuestion): string {
	if (question.replace !== null) return question.replace.length === 1 ? `Replace ${displayText(question.replace[0]!, 40)} and start work` : "Replace them and start work";
	if (question.closed !== null) return "Start work anyway";
	return START_WORK_LABEL;
}

/**
 * What the toast adds about the assignee once the worktree exists, and
 * whether it is a problem: a write that failed keeps the worktree, and the
 * toast says so.
 */
export function describeAssignment(assignment: Assignment | undefined, tracker: IssueTracker, key: string): { text: string; problem: boolean } {
	const label = issueKeyLabel(tracker, key);
	if (assignment === undefined) return { text: `Timber did not say whether ${label} was assigned to you.`, problem: true };
	const { me, previous } = assignment;
	switch (assignment.result) {
		case "assigned":
			return { text: `Assigned ${label} to ${me}.`, problem: false };
		case "reassigned":
			return { text: previous.length > 0 ? `Assigned ${label} to ${me}, replacing ${joinNames(previous)}.` : `Assigned ${label} to ${me}.`, problem: false };
		case "already-mine":
			return { text: `${label} was already assigned to you.`, problem: false };
		case "failed":
			return { text: assignment.diagnostic === null ? `Could not assign ${label} to you.` : `Could not assign ${label} to you: ${assignment.diagnostic}`, problem: true };
		case "not-attempted":
			return { text: `${label} was not assigned to you.`, problem: true };
	}
}
