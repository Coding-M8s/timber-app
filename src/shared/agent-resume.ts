/**
 * Which agents the app can bring back into their own conversation after a
 * restart, and with which arguments. Pure. The arguments are added when the
 * agent starts (see src/bun/terminals.ts) and never stored in Settings.
 *
 * Verified with Claude Code 2.1.330 and Codex CLI 0.171.0, from their own
 * `--help` (see docs/architecture.md, "Going back to a conversation"):
 * - Claude Code: `claude --session-id <uuid>` starts with an id the app
 *   chose, `claude --resume <uuid>` goes back to it. The two are never
 *   combined: Claude Code refuses that without `--fork-session`.
 * - Codex: `codex resume <uuid>` goes back to a conversation, and takes the
 *   same options as `codex` itself. No flag sets the id of a new one, so a
 *   fresh Codex starts as typed.
 *
 * What the app adds goes first, before the arguments from Settings, so no
 * option that takes several values (Codex's `--image`) or `--` can swallow
 * it. A command whose first argument is not an option names a subcommand
 * or a prompt, and starts as typed, as does one with `--` or with an option
 * that already picks a conversation or runs without one, also inside a group
 * of short options such as `-cp`.
 */

/** An agent the app knows how to bring back into its own conversation, or null for any other command. */
export type ResumableAgent = "claude" | "codex";

/** Arguments that already pick a conversation, or run without one. The agent is then started exactly as typed (decision H). */
const CLAUDE_PICKS = new Set(["--session-id", "--resume", "-r", "--continue", "-c", "--from-pr", "--teleport", "--print", "-p", "--fork-session", "--cloud", "--bg", "--background", "--help", "-h", "--version", "-v"]);
/** Claude Code's short options among those, as they may be grouped (`-cp`). */
const CLAUDE_PICKING_LETTERS = /[crphv]/;
const CODEX_PICKS = new Set(["resume", "fork", "exec", "e", "review", "--help", "-h", "--version", "-V"]);
const CODEX_PICKING_LETTERS = /[hV]/;
/** A group of two or more short options, such as `-cp`. */
const SHORT_GROUP = /^-[A-Za-z]{2,}$/;

/** The last part of a path, on either kind of separator. A Windows `.exe` name is cut and, as Windows reads it, in any case. */
function programName(executable: string): string {
	const last = executable.split(/[\\/]/).at(-1) ?? "";
	return last.toLowerCase().endsWith(".exe") ? last.slice(0, -4).toLowerCase() : last;
}

/** Whether the arguments start the agent in a way the app must not add to. */
function startsAsTyped(args: readonly string[], picks: ReadonlySet<string>, letters: RegExp): boolean {
	if (args.length > 0 && !args[0]!.startsWith("-")) return true;
	return args.some(arg => arg === "--"
		|| picks.has(arg)
		|| (arg.startsWith("--") && arg.includes("=") && picks.has(arg.slice(0, arg.indexOf("="))))
		|| (SHORT_GROUP.test(arg) && letters.test(arg.slice(1))));
}

/** Which agent an executable is by its name alone, whatever its arguments, or null. */
export function agentProgram(executable: string): ResumableAgent | null {
	const name = programName(executable);
	return name === "claude" || name === "codex" ? name : null;
}

/**
 * The agent an executable is, from its last path part (`claude`, `codex`,
 * with `.exe` cut on Windows), and only when the arguments leave room for
 * the app's own (see above). Words are matched exactly, so a flag that only
 * starts the same way does not count. Null for anything else.
 */
export function resumableAgent(executable: string, args: readonly string[]): ResumableAgent | null {
	const name = programName(executable);
	if (name === "claude") return startsAsTyped(args, CLAUDE_PICKS, CLAUDE_PICKING_LETTERS) ? null : "claude";
	if (name === "codex") return startsAsTyped(args, CODEX_PICKS, CODEX_PICKING_LETTERS) ? null : "codex";
	return null;
}

/**
 * The arguments to start with, the app's own first. `resume` is a
 * conversation that exists; `fresh` is a new id for an agent that takes one.
 * - claude + resume: ["--resume", id, ...args]; claude + fresh: ["--session-id", id, ...args]
 * - codex + resume: ["resume", id, ...args]; codex otherwise: args as they are
 * - any other agent: args as they are
 */
export function agentStartArguments(agent: ResumableAgent | null, args: readonly string[], conversation: { resume: string } | { fresh: string } | null): string[] {
	if (agent === "claude" && conversation !== null) {
		return "resume" in conversation ? ["--resume", conversation.resume, ...args] : ["--session-id", conversation.fresh, ...args];
	}
	if (agent === "codex" && conversation !== null && "resume" in conversation) return ["resume", conversation.resume, ...args];
	return [...args];
}

/** The line a terminal shows when a saved conversation is gone. Dim, and ends with a line break. */
export function conversationMissingNote(agentName: string): string {
	return `\x1b[2mThe saved conversation was not found, so ${agentName} started fresh.\x1b[0m\r\n`;
}
