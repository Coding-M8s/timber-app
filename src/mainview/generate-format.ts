import type { SavedBase, Worktree } from "../shared/model";
import { type PullRequestList, pullRequestOf } from "../shared/pull-requests";
import type { CommitState } from "../shared/commit-staged";
import { type GenerateKind, type Generator, type GeneratorChoice, NO_COMMITS_AHEAD, commitGenerateBlocker, describeChanged, describeGenerateCommand, pickGenerator } from "../shared/generate-text";
import { conversationsOf } from "../shared/agent";
import { initialPullRequestBase } from "../shared/timber-pr";
import { describePullRequestTab } from "./pull-request-tab-format";
import type { AppState, GenerationRun, PullRequestForm } from "./store/state";

/**
 * Words and rules for having an agent write a commit message or a pull
 * request's text: when its buttons may be pressed, and what they say. Pure,
 * so they can be tested without a window.
 */

export const GENERATE_BUTTON = "Generate";
export const STOP_BUTTON = "Stop";
/** The button at the top of the commit box. */
export const CREATE_PULL_BUTTON = "Create pull request";
/** The same in the Pull request tab's form, beside Publish and open. */
export const GENERATE_AND_CREATE_BUTTON = "Generate and create";
export const GENERATE_FAILED: Record<GenerateKind, string> = { "commit": "Could not generate a message", "pull-request": "Could not generate the title and description" };

/** The agent that would write now, from the saved settings and the last look. */
export const generatorOf = (state: Pick<AppState, "preferences" | "agentLocations">): GeneratorChoice =>
	pickGenerator(state.preferences.agents, state.agentLocations, state.preferences.generateWith);

const GIVEN: Record<GenerateKind, string> = { "commit": "the staged diff", "pull-request": "this branch's commits and its diff with the base" };

/** What the command's arguments do not say. */
function around({ setting, agent, generate }: Generator, kind: GenerateKind): string {
	const files = generate.files.map(file => file.path.join("/")).join(", ");
	const kept = conversationsOf(agent);
	const folder = kept !== null && setting.configFolder ? ` and ${kept.folderVariable} set to ${setting.configFolder}` : "";
	return `in a new empty folder${files === "" ? "" : ` with ${files}, which denies its tools,`}${folder}, with the app's instructions and ${GIVEN[kind]} on standard input, which go to ${agent.name}'s provider`;
}

/** A Generate button's tooltip: why it cannot be pressed, or the exact command. */
export function generateTitle(choice: GeneratorChoice, kind: GenerateKind, blocker: string | null, oneClick = false): string {
	if (blocker !== null) return blocker;
	if (!choice.ok) return choice.reason;
	const writes = kind === "commit" ? "a commit message" : "the title and description";
	const then = oneClick ? "Then shows the text and the timber pr command, and publishes nothing until you agree." : kind === "commit" ? "It commits nothing." : "It opens nothing.";
	return `Writes ${writes}. Runs ${describeGenerateCommand(choice.generator)} ${around(choice.generator, kind)}. ${then}`;
}

/** Why Generate in the commit box cannot be pressed, or null. */
export function commitBlockerOf(choice: GeneratorChoice, state: CommitState, committing: boolean): string | null {
	if (committing) return "A commit is running.";
	return commitGenerateBlocker(state) ?? (choice.ok ? null : choice.reason);
}

/**
 * Why a pull request's text cannot be generated, or null: only what the
 * window knows. Whether the branch can be published is Timber's to say.
 */
export function pullRequestBlockerOf(choice: GeneratorChoice, worktree: Worktree, list: PullRequestList | undefined, form: PullRequestForm | undefined, writing = false): string | null {
	if (writing) return "An agent is already writing this pull request's text.";
	if (worktree.branch === null) return "HEAD is detached, so there is no branch to open a pull request from.";
	if (!worktree.pathExists) return "This worktree's folder is missing.";
	if (form?.running) return "A pull request is being created.";
	const entry = pullRequestOf(list, worktree.path);
	if (form?.reported) return `Pull request #${form.reported.number} is already open.`;
	if (entry?.outcome === "found") return `This branch already has pull request #${entry.pullRequest.number}.`;
	const view = describePullRequestTab(list, entry, worktree.branch);
	if (view.kind !== "none") return view.kind === "found" ? "This branch already has a pull request." : view.title;
	// The counts are with the saved base; another one typed in the form is counted by the main process.
	const own = form === undefined || form.base.trim() === initialPullRequestBaseOf(worktree.base);
	if (own && worktree.baseCounts?.kind === "counted" && worktree.baseCounts.ahead === 0) return NO_COMMITS_AHEAD;
	return choice.ok ? null : choice.reason;
}

const initialPullRequestBaseOf = (base: SavedBase | null) => initialPullRequestBase(base).trim();

/** Said while an agent writes. */
export const describeGenerating = (by: string, kind: GenerateKind) => `${by} is writing ${kind === "commit" ? "a message from the staged diff" : "the title and description"}.`;

/** Said once its text is in the field. */
export function describeGenerated(run: Pick<GenerationRun, "by" | "leftOut">): string {
	return `Written by ${run.by}. Read it before you use it.${describeLeftOut(run.leftOut)}`;
}

/** What the agent was not given, or nothing. */
export function describeLeftOut(leftOut: number | null): string {
	if (leftOut === 0) return "";
	if (leftOut === null) return " The diff was too large, so only part of it was given.";
	return ` ${leftOut === 1 ? "1 file was" : `${leftOut} files were`} too large, so only ${leftOut === 1 ? "its name was" : "their names were"} given.`;
}

/** Why text an agent wrote waits beside the field, and what its buttons say. */
export function describeHeld(run: Pick<GenerationRun, "by" | "changed">, what: string): { title: string; text: string; use: string; drop: string } {
	if (run.changed.length > 0) {
		return {
			title: "The worktree changed meanwhile",
			text: `While ${run.by} wrote, ${describeChanged(run.changed)} changed, so this may not fit what is there now. It was not filled in.`,
			use: "Use it anyway",
			drop: "Discard it",
		};
	}
	return { title: `Written by ${run.by}`, text: `The ${what} has text of yours, so nothing was replaced.`, use: "Replace mine", drop: "Keep mine" };
}

/** A line of the confirmation, when changes are left out of the pull request. Null for none. */
export function describeUncommitted(files: number): string | null {
	if (files === 0) return null;
	return `${files === 1 ? "1 uncommitted file is" : `${files} uncommitted files are`} not in this pull request.`;
}
