import { type AgentSetting, agentCommand, describeAgentCommand, findAgent } from "../../../shared/agent";
import { type AgentLocation, agentFound, agentMark, agentsLocated, isFullPath, lookupOf } from "../../../shared/agent-lookup";
import { describeCommandLine } from "../../../shared/command-line";
import type { ReportedWorktree } from "../../../shared/model";
import { WORKTREE_PLACEHOLDER, describeTimberCommand } from "../../../shared/timber-result";
import { worktreeSetupArguments } from "../../../shared/worktree-commands";
import type { SessionAgent } from "../../store/state";
import type { AppStore } from "../../store/store";
import type { SubmissionOutcome } from "../../store/submission";
import type { WorkflowOptions } from "./workflow-choice";

/**
 * What the New worktree dialog starts after it opened a worktree: setup and
 * the agent. Pure, apart from `runAndStart`, so all of it is tested without
 * a window.
 *
 * Timber always runs with `--no-agent`. The app starts the agent itself, as
 * an agent session through `openTerminal`. That is the picked agent, whose
 * command the main process takes from the saved Settings, or, when the
 * picked workflow sets an agent, that workflow's agent, whose command the
 * main process reads again from Timber. Never a command from the dialog.
 */

/**
 * What the person picked in the Agent field: a name, null for None, or
 * undefined while they have not touched it, which means the default agent
 * (`defaultAgent`).
 */
export type AgentPick = string | null | undefined;

/**
 * The agent the Agent field picks on its own: the first saved agent whose
 * executable was found. None when no agent was found, and none while any
 * agent is not known yet, so an agent that turns out to be missing is never
 * picked, and a known one is never passed over for a later one.
 */
export function defaultAgent(agents: readonly AgentSetting[], locations: readonly AgentLocation[] | null): AgentSetting | null {
	if (!agentsLocated(locations, agents)) return null;
	return agents.find(agent => agentFound(locations, agent)) ?? null;
}

/**
 * The agent that will start, or null for none. Any saved agent can be
 * picked, found or not. A picked name that is no longer saved falls back to
 * the default agent.
 */
export function chosenAgent(agents: readonly AgentSetting[], pick: AgentPick, locations: readonly AgentLocation[] | null): AgentSetting | null {
	if (pick === null) return null;
	if (pick !== undefined) {
		const picked = findAgent(agents, pick);
		if (picked) return picked;
	}
	return defaultAgent(agents, locations);
}

/**
 * Where the agent comes from, for the Agent field and the footer: the pick,
 * or the workflow, which then decides. `command` is the workflow's command as
 * Timber reports it, as one line for showing. A pick made with a workflow
 * names it in `workflow`, so the main process can still start the
 * workflow's agent if Timber reports one when it starts; `unread` is true
 * when the list cannot say yet whether the workflow sets an agent.
 */
export type AgentPlan =
	| { source: "pick"; agent: AgentSetting | null; workflow: string | null; unread: boolean }
	| { source: "workflow"; workflow: string; kind: "command"; command: string }
	| { source: "workflow"; workflow: string; kind: "none" };

/**
 * The agent plan for a run with `workflow`, or with none when null. A
 * workflow that sets a command, or turns the agent off, decides; one that
 * leaves the agent unset leaves it to the pick. A workflow the list does not
 * have, or any workflow while the list is not there, leaves it to the pick
 * too, marked `unread`: the main process reads the workflow when it starts.
 */
export function plannedAgent(agents: readonly AgentSetting[], locations: readonly AgentLocation[] | null, pick: AgentPick, workflows: WorkflowOptions, workflow: string | null): AgentPlan {
	const agent = chosenAgent(agents, pick, locations);
	if (workflow === null) return { source: "pick", agent, workflow: null, unread: false };
	const found = workflows?.ok ? workflows.workflows.find(candidate => candidate.name === workflow) : undefined;
	if (found === undefined) return { source: "pick", agent, workflow, unread: true };
	if (found.agent.kind === "command") return { source: "workflow", workflow, kind: "command", command: describeCommandLine([found.agent.command, ...found.agent.args]) };
	if (found.agent.kind === "none") return { source: "workflow", workflow, kind: "none" };
	return { source: "pick", agent, workflow, unread: false };
}

const PATH_RESTART = "A change to PATH needs a restart of the app.";

/** An agent's option in the Agent field: its name, marked when its executable was not found or cannot start. */
export function agentOptionLabel(agent: AgentSetting, locations: readonly AgentLocation[] | null): string {
	const mark = agentMark(lookupOf(locations, agent));
	return mark === null ? agent.name : `${agent.name} (${mark})`;
}

/** The hint under the Agent field while the pick decides (`plan.source` is "pick"). */
export function agentPickHint(agents: readonly AgentSetting[], locations: readonly AgentLocation[] | null, plan: Extract<AgentPlan, { source: "pick" }>): string {
	if (agents.length === 0) return "No agents are set up. Add one in Settings, Agents.";
	const chosen = plan.agent;
	if (chosen === null) {
		if (agents.some(agent => agentFound(locations, agent))) return "No agent starts. Start one later from the worktree.";
		if (agentsLocated(locations, agents)) {
			if (agents.every(agent => lookupOf(locations, agent)?.state === "not-found")) {
				return `None of the agents was found on the PATH the app was started with, so none is picked. Install one, or give its full path in Settings, Agents. ${PATH_RESTART}`;
			}
			return "None of the agents can start, so none is picked. Settings, Agents says why for each.";
		}
		return "The app has not found out yet which agents are installed, so none is picked. Pick one to start it.";
	}
	const lookup = lookupOf(locations, chosen);
	if (lookup?.state === "not-found") {
		const command = agentCommand(chosen);
		if (command.ok && isFullPath(command.executable)) return `There is no executable file at ${command.executable}, so ${chosen.name} will not start. Change its command in Settings, Agents.`;
		return `${chosen.name} was not found on the PATH the app was started with, so it will not start. Install it, or give its full path in Settings, Agents. ${PATH_RESTART}`;
	}
	if (lookup?.state === "unusable") return `${chosen.name} cannot start: ${lookup.message}`;
	if (plan.unread && plan.workflow !== null) return `The ${plan.workflow} workflow could not be read yet. If it sets an agent, that one starts instead, once this dialog has created the worktree.`;
	return "Starts in the worktree once this dialog has created it, never in one that was already there.";
}

/** The agent that starts: what to call it in the footer and toasts, its command for showing, and what the request names. */
export interface StartingAgent {
	label: string;
	command: string;
	session: SessionAgent;
}

/** The agent a plan starts, or null when it starts none. */
export function startingAgent(plan: AgentPlan): StartingAgent | null {
	if (plan.source === "pick") {
		const { agent, workflow } = plan;
		if (agent === null) return null;
		const session: SessionAgent = workflow === null ? { kind: "saved", name: agent.name } : { kind: "workflow", workflow, agent: agent.name };
		// Unread, the workflow may still set an agent, which then starts instead: the footer says so.
		const label = plan.unread && workflow !== null ? `${agent.name} (or the ${workflow} workflow's agent, if it sets one)` : agent.name;
		return { label, command: describeAgentCommand(agent) ?? agent.command, session };
	}
	if (plan.kind !== "command") return null;
	return { label: `the ${plan.workflow} workflow's agent`, command: plan.command, session: { kind: "workflow", workflow: plan.workflow } };
}

/**
 * Whether a mode starts the agent after its next run works:
 * `always` when that run finishes a worktree this dialog created,
 * `if-created` when only Timber's answer can say whether it creates one,
 * and `never` when it cannot create one.
 */
export type AgentStart = "always" | "if-created" | "never";

/** What one run of a mode came to, and what starts in the worktree it opened. */
export interface ModeRun {
	outcome: SubmissionOutcome;
	/** Set only when the run worked and the worktree is one this dialog created. The agent starts here. */
	created: ReportedWorktree | null;
	/** Set only when the run worked and the worktree's setup scripts are to run, in a session of their own. */
	setup: ReportedWorktree | null;
	/** The workflow the run passed, which the setup session passes again: Timber does not remember it. Null or left out for none. */
	workflow?: string | null;
	/** The toast once the sessions have started, in place of the outcome's, which must not claim they did. */
	startedToast?: string;
}

/** A line of the footer under the Timber command: what it says, and the command that starts. */
export interface FollowUp {
	note: string;
	command: string;
}

/**
 * Whether a mode runs setup in a session after its next run works, as
 * `AgentStart` says for the agent. `if-skipped` when only Timber's answer
 * can say whether there are setup scripts it left for the app to run.
 */
export type SetupStart = "always" | "if-skipped" | "never";

/** The setup session's command, worded for the footer: with the worktree's path when it is known, and the workflow, if any. */
export function setupCommand(worktree: string | null, workflow: string | null = null): string {
	return describeTimberCommand(worktreeSetupArguments(worktree ?? WORKTREE_PLACEHOLDER, workflow ?? undefined));
}

/** The notes and commands shown under the Timber command, in the order they start: setup, then the agent. */
export function followUps(agent: Pick<StartingAgent, "label" | "command"> | null, start: AgentStart, setup: SetupStart, worktree: string | null = null, workflow: string | null = null): FollowUp[] {
	const lines: FollowUp[] = [];
	if (setup !== "never") {
		lines.push({
			note: setup === "always"
				? "Then runs setup in a terminal in the worktree, without waiting for it:"
				: "Then, if Timber left setup scripts to run, runs them in a terminal in the worktree, without waiting for them:",
			command: setupCommand(worktree, workflow),
		});
	}
	if (agent !== null && start !== "never") {
		const where = start === "always" ? "in the new worktree" : "in it, if this creates a worktree";
		lines.push({
			note: setup === "never" ? `Then starts ${agent.label} ${where}:`
				: setup === "always" ? `And starts ${agent.label} beside setup, ${where}:`
				: `And starts ${agent.label} ${where}, without waiting for setup:`,
			command: agent.command,
		});
	}
	return lines;
}

/**
 * Run a mode, then start setup and the agent in the worktree it opened. They
 * start without waiting, so the dialog closes at once, and the agent does not
 * wait for setup either. A session that cannot start is shown in the
 * worktree's pane, never as a failure of the dialog: the worktree is there
 * either way. When the list does not have the worktree, so there is no pane,
 * the toast says what did not start.
 */
export async function runAndStart(
	store: Pick<AppStore, "startSessionsIn">,
	repository: string,
	run: () => Promise<ModeRun>,
	agent: StartingAgent | null,
): Promise<SubmissionOutcome> {
	const { outcome, created, setup, workflow = null, startedToast } = await run();
	if (!outcome.ok) return outcome;
	const startsAgent = created !== null && agent !== null;
	const worktree = setup ?? (startsAgent ? created : null);
	if (worktree === null) return outcome;
	// Setup and the agent start in the same worktree: the one the run reported.
	if (store.startSessionsIn(repository, worktree, { setup: setup !== null, ...(workflow === null ? {} : { workflow }), agent: startsAgent ? agent.session : null })) {
		return startedToast === undefined ? outcome : { ...outcome, toast: startedToast };
	}
	const joined = [setup !== null ? "Setup" : null, startsAgent ? agent.label : null].filter(name => name !== null).join(" and ");
	const missed = `${joined.charAt(0).toUpperCase()}${joined.slice(1)}`;
	// A problem the outcome already had, such as an issue that could not be assigned, stays marked.
	return { ...outcome, toast: `${outcome.toast}. ${missed} did not start: the worktree is not in the list yet. Refresh, then start it from the worktree.` };
}
