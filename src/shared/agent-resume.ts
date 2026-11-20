/**
 * Which agents the app can bring back into their own conversation after a
 * restart, and with which arguments. Pure. The arguments are added when the
 * agent starts (see src/bun/terminals.ts) and never stored in Settings.
 *
 * Verified with Claude Code 2.1.329 and Codex CLI 0.170.0 (see
 * docs/architecture.md, "Going back to a conversation"):
 * - Claude Code: `claude --session-id <uuid>` starts with an id the app
 *   chose, `claude --resume <uuid>` goes back to it. The two are never
 *   combined: Claude Code refuses that without `--fork-session`.
 * - Codex: `codex resume <uuid>` goes back to a conversation. No flag sets
 *   the id of a new one, so a fresh Codex starts as typed.
 */

/** An agent the app knows how to bring back into its own conversation, or null for any other command. */
export type ResumableAgent = "claude" | "codex";

/** Arguments that already pick a conversation, or run without one. The agent is then started exactly as typed (decision H). */
const CLAUDE_PICKS = new Set(["--session-id", "--resume", "-r", "--continue", "-c", "--from-pr", "--teleport", "--print", "-p"]);
const CODEX_PICKS = new Set(["resume", "fork", "exec", "e", "review"]);

/** The last part of a path, on either kind of separator. A Windows `.exe` name is cut and, as Windows reads it, in any case. */
function programName(executable: string): string {
	const last = executable.split(/[\\/]/).at(-1) ?? "";
	return last.toLowerCase().endsWith(".exe") ? last.slice(0, -4).toLowerCase() : last;
}

/**
 * The agent an executable is, from its last path part (`claude`, `codex`,
 * with `.exe` cut on Windows), and only when the arguments do not already
 * pick a conversation. Words are matched exactly, so a flag that only starts
 * the same way does not count. Null for anything else.
 */
export function resumableAgent(executable: string, args: readonly string[]): ResumableAgent | null {
	const name = programName(executable);
	if (name === "claude") return args.some(arg => CLAUDE_PICKS.has(arg) || arg.startsWith("--session-id=") || arg.startsWith("--resume=")) ? null : "claude";
	if (name === "codex") return args.some(arg => CODEX_PICKS.has(arg)) ? null : "codex";
	return null;
}

/**
 * The arguments to start with. `resume` is a conversation that exists;
 * `fresh` is a new id for an agent that takes one.
 * - claude + resume: [...args, "--resume", id]; claude + fresh: [...args, "--session-id", id]
 * - codex + resume: [...args, "resume", id]; codex otherwise: args as they are
 * - any other agent: args as they are
 */
export function agentStartArguments(agent: ResumableAgent | null, args: readonly string[], conversation: { resume: string } | { fresh: string } | null): string[] {
	if (agent === "claude" && conversation !== null) {
		return "resume" in conversation ? [...args, "--resume", conversation.resume] : [...args, "--session-id", conversation.fresh];
	}
	if (agent === "codex" && conversation !== null && "resume" in conversation) return [...args, "resume", conversation.resume];
	return [...args];
}

/** The line a terminal shows when a saved conversation is gone. Dim, and ends with a line break. */
export function conversationMissingNote(agentName: string): string {
	return `\x1b[2mThe saved conversation was not found, so ${agentName} started fresh.\x1b[0m\r\n`;
}
