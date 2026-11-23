import { type AgentSetting, agentCommand } from "../../shared/agent";
import { type AgentId, agentById } from "../../shared/agent-registry";
import { agentProgram } from "../../shared/agent-resume";
import type { Engine } from "../../shared/engine";
import {
	type HookDetails, type HookState, STATUS_HOOK_SCRIPT, type StatusHookRequest, type StatusHookResult, type StatusHookView,
	hookedAgent, planHook, reportedStates,
} from "../../shared/status-hooks";

/** Where the mock's script is, as a main process on Linux would put it. */
const SCRIPT_PATH = "/home/you/.config/timber-app/status-hook";
const HOME = "/home/you";

/** How an agent's file stands in the mock, for tests and screenshots of each state. */
export interface MockHookFile {
	/** The file's text, or null when there is none. */
	text: string | null;
	/** Why the app would not write it (a link, not writable), or null. */
	byHand?: string | null;
	/** The script the entries run is missing. */
	scriptMissing?: boolean;
}

export interface StatusHookControls {
	/** Set how an agent's hook file stands, without telling the interface. */
	setStatusHookFile(agent: AgentId, file: MockHookFile): void;
	/** What the mock's file of an agent holds now. */
	statusHookFile(agent: AgentId): MockHookFile;
}

/**
 * The status hooks of the mock engine: each agent's file kept in memory,
 * planned and changed as the main process plans and changes it
 * (src/bun/status-hook-files.ts), with the same answers. Enough for the
 * interface: the script is never different or unreadable here, the
 * settings folder has no quote in its path, and the platform is not Windows.
 */
export function createMockStatusHooks(agents: () => readonly AgentSetting[]): Pick<Engine, "statusHooks" | "installStatusHook" | "removeStatusHook"> & StatusHookControls {
	const files = new Map<AgentId, MockHookFile>();
	const fileOf = (agent: AgentId) => files.get(agent) ?? { text: null };
	const tokenOf = (file: MockHookFile) => file.text === null ? "missing" : `text:${file.text.length}:${file.text}`;

	function programOf(agent: AgentSetting): AgentId | null {
		const built = agentCommand(agent);
		return built.ok ? agentProgram(built.executable, null, agent.agent ?? null) : agent.agent ?? null;
	}

	function inspect(agent: AgentId): { details: HookDetails; installed: string | null; removed: string | null | undefined } | null {
		const definition = hookedAgent(agent);
		if (definition === null) return null;
		const hook = definition.status.hook;
		const file = fileOf(agent);
		const plan = planHook(file.text, hook, SCRIPT_PATH, agent);
		const shownFile = `~/${hook.file.join("/")}`;
		let state: HookState = plan.state;
		if ((state.kind === "on" || state.kind === "changed") && file.scriptMissing) state = { kind: "broken", reason: `The script its entries run, ${SCRIPT_PATH.replace(HOME, "~")}, is missing.` };
		const byHand = file.byHand ?? (plan.comments ? `${shownFile} holds comments, which the app would drop if it wrote the file.` : plan.unsafe ? `${shownFile} holds a value the app could not write back exactly.` : null);
		return {
			details: {
				agent, agentName: definition.name, file: shownFile, exists: file.text !== null, state, byHand, token: tokenOf(file),
				entries: plan.entries, present: plan.present, script: STATUS_HOOK_SCRIPT, scriptPath: SCRIPT_PATH.replace(HOME, "~"), checked: hook.checked,
			},
			installed: byHand === null ? plan.installed : null,
			removed: byHand === null ? plan.removed : undefined,
		};
	}

	async function statusHooks(): Promise<StatusHookView[]> {
		return agents().map(row => {
			const agent = programOf(row);
			const definition = agent === null ? null : agentById(agent);
			return {
				name: row.name,
				agent,
				source: definition?.status.source ?? "none",
				reports: definition === null ? [] : reportedStates(definition),
				hook: agent === null ? null : inspect(agent)?.details ?? null,
			};
		});
	}

	async function change(request: StatusHookRequest, action: "install" | "remove"): Promise<StatusHookResult> {
		const answer = async (outcome: StatusHookResult["outcome"], message: string): Promise<StatusHookResult> => ({ outcome, message, hooks: await statusHooks() });
		if (!agents().some(row => programOf(row) === request.agent)) return answer("refused", "No saved agent in Settings, Agents runs that agent. Nothing was written.");
		const found = inspect(request.agent);
		if (found === null) return answer("refused", "That agent has no status hook. Nothing was written.");
		const { details } = found;
		if (details.token !== request.token) return answer("changed-since", `${details.file} changed since it was shown. Nothing was written; look at it again.`);
		if (details.byHand !== null && action === "install" && details.state.kind === "off") {
			files.set(request.agent, { ...fileOf(request.agent), scriptMissing: false });
			return answer("done", `The script is in place at ${details.scriptPath}. Add the entries to ${details.file} by hand.`);
		}
		if (details.byHand !== null) return answer("refused", `${details.byHand} Nothing was written.`);
		const file = fileOf(request.agent);
		if (action === "install") {
			if (details.state.kind !== "off" || found.installed === null) return answer("refused", `The ${details.agentName} status hook is not off. Nothing was written.`);
			files.set(request.agent, { ...file, text: found.installed, scriptMissing: false });
			return answer("done", `The ${details.agentName} status hook is on, in ${details.file}.`);
		}
		if (details.present.length === 0 || found.removed === undefined) return answer("refused", `The app's entries are not in ${details.file}. Nothing was written.`);
		files.set(request.agent, { ...file, text: found.removed });
		return answer("done", found.removed === null ? `The ${details.agentName} status hook is off, and ${details.file}, left empty, was deleted.` : `The ${details.agentName} status hook is off. The app's entries were taken out of ${details.file}.`);
	}

	return {
		statusHooks,
		installStatusHook: request => change(request, "install"),
		removeStatusHook: request => change(request, "remove"),
		setStatusHookFile: (agent, file) => void files.set(agent, { ...file }),
		statusHookFile: agent => ({ ...fileOf(agent) }),
	};
}
