import { type AgentId, type AgentResume, agentByExecutable, agentById } from "./agent-registry";

/**
 * Which agents the app can bring back into their own conversation after a
 * restart, and with which arguments. Pure. The arguments are added when the
 * agent starts (see src/bun/terminals.ts) and never stored in Settings. Each
 * agent's own words, and the versions they were verified with, are its
 * `resume` in the agent registry (src/shared/agent-registry.ts; see
 * docs/architecture.md, "Going back to a conversation").
 *
 * What the app adds goes first, before the arguments from Settings, so no
 * option that takes several values (Codex's `--image`) or `--` can swallow
 * it. A command whose first argument is not an option names a subcommand
 * or a prompt, and starts as typed, as does one with `--` or with an option
 * that already picks a conversation or runs without one, also inside a group
 * of short options such as `-cp`.
 */

/** An agent the app knows how to bring back into its own conversation, or null for any other command. */
export type ResumableAgent = AgentId;

/** A group of two or more short options, such as `-cp`. */
const SHORT_GROUP = /^-[A-Za-z]{2,}$/;

/** Whether the arguments start the agent in a way the app must not add to. */
function startsAsTyped(args: readonly string[], recipe: AgentResume): boolean {
	if (args.length > 0 && !args[0]!.startsWith("-")) return true;
	const picks = (arg: string) => recipe.picks.includes(arg);
	return args.some(arg => arg === "--"
		|| picks(arg)
		|| (arg.startsWith("--") && arg.includes("=") && picks(arg.slice(0, arg.indexOf("="))))
		|| (SHORT_GROUP.test(arg) && Array.from(arg.slice(1)).some(letter => recipe.pickingLetters.includes(letter))));
}

/** The agent picked in Settings, or else the one the executable is by its name. */
function agentOf(executable: string, realPath: string | null | undefined, chosen: AgentId | null | undefined) {
	return chosen !== undefined && chosen !== null ? agentById(chosen) : agentByExecutable(executable, realPath);
}

/**
 * Which agent an executable is by its name, whatever its arguments, or null.
 * `realPath` is the file it leads to with every link followed, which tells a
 * name other programs install too, such as `agent` (see `agentByExecutable`).
 * `chosen` is the agent picked for the row in Settings, which takes the
 * place of the name, so a wrapper such as `claude-work` is Claude Code.
 */
export function agentProgram(executable: string, realPath?: string | null, chosen?: AgentId | null): ResumableAgent | null {
	return agentOf(executable, realPath, chosen)?.id ?? null;
}

/**
 * The agent an executable is, from its last path part (`claude`, `codex`,
 * with `.exe` cut on Windows), and only when it can go back to a
 * conversation and the arguments leave room for the app's own (see above).
 * An agent picked in Settings (`chosen`) is used in place of the name; its
 * arguments are read by the same rules. Words are matched exactly, so a
 * flag that only starts the same way does not count. Null for anything else.
 */
export function resumableAgent(executable: string, args: readonly string[], realPath?: string | null, chosen?: AgentId | null): ResumableAgent | null {
	const agent = agentOf(executable, realPath, chosen);
	if (agent === null || agent.resume === null) return null;
	return startsAsTyped(args, agent.resume) ? null : agent.id;
}

/**
 * The arguments to start with, the app's own first. `resume` is a
 * conversation that exists; `fresh` is a new id for an agent that takes one.
 * - claude + resume: ["--resume", id, ...args]; claude + fresh: ["--session-id", id, ...args]
 * - codex + resume: ["resume", id, ...args]; codex otherwise: args as they are
 * - any other agent: args as they are
 */
export function agentStartArguments(agent: ResumableAgent | null, args: readonly string[], conversation: { resume: string } | { fresh: string } | null): string[] {
	const recipe = agent === null ? null : agentById(agent).resume;
	if (recipe === null || conversation === null) return [...args];
	if ("resume" in conversation) return [...recipe.resume, conversation.resume, ...args];
	return recipe.fresh === null ? [...args] : [...recipe.fresh, conversation.fresh, ...args];
}

/** The line a terminal shows when a saved conversation is gone. Dim, and ends with a line break. */
export function conversationMissingNote(agentName: string): string {
	return `\x1b[2mThe saved conversation was not found, so ${agentName} started fresh.\x1b[0m\r\n`;
}
