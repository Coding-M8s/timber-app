import { type AgentSetting, agentCommand, rowAgent } from "../../shared/agent";
import { type AgentLocation, lookupOf } from "../../shared/agent-lookup";
import { type AgentId, agentByExecutable } from "../../shared/agent-registry";
import type { AgentSignIn, SignInState } from "../../shared/agent-sign-in";
import { describeCommandLine } from "../../shared/command-line";
import type { Engine } from "../../shared/engine";

export interface MockSignInControls {
	/** Set what an agent's status command comes to, without telling the interface. Signed in at first. */
	setSignIn(agent: AgentId, state: SignInState): void;
	/** Make every later question fail, as when the main process cannot answer, or work again. */
	failSignIns(fails: boolean): void;
	/** How often the interface has asked. */
	signInRequests(): number;
}

/** The sign-in states of the mock engine: the rows the main process would ask (src/bun/agent-sign-in.ts), with answers set by hand. Nothing runs, and there are no links to follow, so a shared name such as `agent` is no agent here unless it is picked, and is never asked. */
export function createMockSignIns(agents: () => readonly AgentSetting[], locate: () => Promise<readonly AgentLocation[]>): Pick<Engine, "agentSignIns"> & MockSignInControls {
	const states = new Map<AgentId, SignInState>();
	let failing = false;
	let requests = 0;
	return {
		async agentSignIns() {
			requests += 1;
			const saved = agents();
			const locations = await locate();
			if (failing) throw new Error("The main process did not answer.");
			return saved.flatMap((setting): AgentSignIn[] => {
				const built = agentCommand(setting);
				if (!built.ok || lookupOf(locations, setting)?.state !== "found") return [];
				const agent = rowAgent(setting, built.executable);
				if (agent === null) return [];
				const answer = { setting: { ...setting }, agent: agent.id };
				const { status } = agent.signIn;
				if (status === null) return [{ ...answer, shown: null, signIn: { state: "not-known", reason: "no-command" } }];
				const shown = describeCommandLine([built.executable, ...status.arguments]);
				if (agentByExecutable(built.executable)?.id !== agent.id) return [{ ...answer, shown, signIn: { state: "not-known", reason: "not-asked" } }];
				return [{ ...answer, shown, signIn: states.get(agent.id) ?? { state: "signed-in" } }];
			});
		},
		setSignIn: (agent, state) => void states.set(agent, state),
		failSignIns: fails => {
			failing = fails;
		},
		signInRequests: () => requests,
	};
}
