/**
 * Every coding agent the app knows by name, as one table of data. The
 * presets in Settings, Agents and in Timber's `[agent]`, the marks drawn for
 * a session, the words that go back to a conversation, and where its
 * conversations are kept all read this table. Pure, with no imports: the
 * main process and the interface both read it.
 *
 * An agent that is not here still runs from Settings, as typed, with letters
 * for its mark. Adding an agent is adding a row (see docs/architecture.md,
 * "The agent registry").
 */

/** How an agent can be brought back into its own conversation. */
export interface AgentResume {
	/**
	 * The words before an id the app chose that start a new conversation with
	 * that id, such as `--session-id`, or null when no flag sets the id of a
	 * new one and a fresh agent starts as typed.
	 */
	fresh: readonly string[] | null;
	/** The words before an id that go back to that conversation, such as `--resume` or `resume`. */
	resume: readonly string[];
	/**
	 * Arguments that already pick a conversation, or run without one, such as
	 * `--continue` or `exec`. With one of them the agent starts exactly as
	 * typed (decision H). Matched as whole words, and before an `=`.
	 */
	picks: readonly string[];
	/** The short options among `picks`, as letters, since they may be grouped (`-cp`). */
	pickingLetters: string;
	/**
	 * Where its conversations are kept, read only to know whether one is still
	 * there (see src/bun/agent-conversations.ts). `store` names the layout,
	 * which needs code of its own to read; the folder is `folderVariable` when
	 * it is set to a full path, else `folder` in the home folder.
	 */
	conversations: { store: ConversationStore; folderVariable: string; folder: string };
}

/** The layouts of conversation folders the app can read. */
export type ConversationStore = "claude-projects" | "codex-sessions";

/** An agent's official mark, as path data only. */
export interface AgentMark {
	viewBox: string;
	path: string;
	fill: string;
	/** Where the mark was taken from, and when. */
	source: string;
}

/** One agent the app knows. */
export interface AgentDefinition {
	/** Stable: a running session and an ended agent's shell carry it (`program`, `resumable`), and the mark's class names use it. */
	id: string;
	/** Its name as a preset in Settings, Agents, and in words. */
	name: string;
	/** Its name as a preset of Timber's `[agent]`, as `timber setup` calls it. */
	label: string;
	/**
	 * The executables it is known by, as the last part of a path in lower
	 * case, without `.exe`. Unique across the table.
	 */
	executables: readonly string[];
	/** The command its presets fill in, in Settings, Agents and in Timber's `[agent]`. */
	command: string;
	mark: AgentMark;
	/** How it goes back to a conversation, or null when it always starts as typed. */
	resume: AgentResume | null;
	/**
	 * Its sign-in: a command that only reads whether it is signed in, and the
	 * command that signs in, each an executable and its arguments, or null
	 * when not known yet. Nothing reads these yet.
	 */
	signIn: { status: readonly string[] | null; login: readonly string[] | null };
	/**
	 * How it reports its status: the Program Status Protocol (OSC 7501), a
	 * hook, or not at all, and the start of the `app` it reports, such as
	 * `claude` for `claude-code`, which gives its mark to any session that
	 * reports it. `source` is not read yet: any program may report.
	 */
	status: { source: "osc-7501" | "hook" | "none"; app: string | null };
}

const ROWS = [
	{
		id: "claude",
		name: "Claude Code",
		label: "Claude",
		executables: ["claude"],
		command: "claude",
		mark: {
			viewBox: "0 0 248 248",
			path: "M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z",
			// Claude's own color, part of its mark. It is the one color not from a theme (see docs/design.md, Look).
			fill: "#D97757",
			// A trademark of its maker, shown only to say which agent a session runs.
			source: "Claude's spark, from https://claude.ai/favicon.svg, taken on 2026-11-18.",
		},
		/*
		 * Verified with Claude Code 2.1.330, from its own `--help` (see
		 * docs/architecture.md, "Going back to a conversation"):
		 * `claude --session-id <uuid>` starts with an id the app chose,
		 * `claude --resume <uuid>` goes back to it. The two are never combined:
		 * Claude Code refuses that without `--fork-session`.
		 */
		resume: {
			fresh: ["--session-id"],
			resume: ["--resume"],
			picks: ["--session-id", "--resume", "-r", "--continue", "-c", "--from-pr", "--teleport", "--print", "-p", "--fork-session", "--cloud", "--bg", "--background", "--help", "-h", "--version", "-v"],
			pickingLetters: "crphv",
			conversations: { store: "claude-projects", folderVariable: "CLAUDE_CONFIG_DIR", folder: ".claude" },
		},
		signIn: { status: null, login: null },
		status: { source: "osc-7501", app: "claude" },
	},
	{
		id: "codex",
		name: "Codex",
		label: "Codex",
		executables: ["codex"],
		command: "codex",
		mark: {
			viewBox: "3.5 3.5 16.5 16.5",
			path: "M9.94494 9.59163V8.13227C9.94494 8.00935 9.99105 7.91713 10.0985 7.85575L13.0327 6.16599C13.4321 5.93558 13.9083 5.8281 14.3998 5.8281C16.2432 5.8281 17.4108 7.25677 17.4108 8.77751C17.4108 8.885 17.4108 9.00792 17.3953 9.13083L14.3537 7.34884C14.1694 7.24135 13.985 7.24135 13.8007 7.34884L9.94494 9.59163ZM16.7963 15.2755V11.7883C16.7963 11.5732 16.704 11.4196 16.5197 11.3121L12.664 9.0693L13.9236 8.34725C14.0311 8.28587 14.1234 8.28587 14.2308 8.34725L17.165 10.037C18.0099 10.5287 18.5782 11.5732 18.5782 12.587C18.5782 13.7544 17.887 14.8298 16.7963 15.2753V15.2755ZM9.03861 12.2031L7.77896 11.4658C7.67146 11.4045 7.62535 11.3122 7.62535 11.1893V7.8098C7.62535 6.16613 8.88501 4.92176 10.5902 4.92176C11.2354 4.92176 11.8344 5.13689 12.3415 5.52089L9.31526 7.27218C9.13097 7.37968 9.03875 7.53328 9.03875 7.74841V12.2033L9.03861 12.2031ZM11.75 13.77L9.94494 12.7562V10.6056L11.75 9.59178L13.5549 10.6056V12.7562L11.75 13.77ZM12.9098 18.44C12.2645 18.44 11.6655 18.2249 11.1585 17.8409L14.1847 16.0896C14.369 15.9821 14.4612 15.8285 14.4612 15.6134V11.1585L15.7363 11.8958C15.8438 11.9572 15.8899 12.0494 15.8899 12.1723V15.5519C15.8899 17.1955 14.6148 18.44 12.9098 18.44ZM9.26901 15.0144L6.33486 13.3246C5.4899 12.833 4.92161 11.7885 4.92161 10.7746C4.92161 9.59177 5.62824 8.53183 6.71886 8.0863V11.5887C6.71886 11.8039 6.81109 11.9575 6.99538 12.065L10.8359 14.2923L9.57621 15.0144C9.46872 15.0758 9.37649 15.0758 9.26901 15.0144ZM9.10013 17.5337C7.36426 17.5337 6.08919 16.2279 6.08919 14.6149C6.08919 14.492 6.1046 14.3691 6.11988 14.2462L9.1461 15.9975C9.33039 16.105 9.51483 16.105 9.69912 15.9975L13.5549 13.7702V15.2295C13.5549 15.3524 13.5088 15.4446 13.4013 15.506L10.4671 17.1958C10.0677 17.4262 9.59148 17.5337 9.09999 17.5337H9.10013ZM12.9098 19.3616C14.7685 19.3616 16.32 18.0406 16.6735 16.2893C18.3939 15.8438 19.5 14.2308 19.5 12.5872C19.5 11.5118 19.0391 10.4673 18.2096 9.71454C18.2864 9.39192 18.3326 9.0693 18.3326 8.74682C18.3326 6.55014 16.5505 4.90634 14.4921 4.90634C14.0774 4.90634 13.6779 4.96772 13.2785 5.10605C12.5872 4.43011 11.6347 4 10.5902 4C8.7314 4 7.17996 5.32103 6.8265 7.07232C5.10605 7.51786 4 9.13083 4 10.7745C4 11.8498 4.4608 12.8944 5.29035 13.6471C5.21354 13.9697 5.16743 14.2923 5.16743 14.6148C5.16743 16.8114 6.94941 18.4552 9.00792 18.4552C9.42261 18.4552 9.82204 18.3939 10.2215 18.2556C10.9127 18.9315 11.8651 19.3616 12.9098 19.3616Z",
			// OpenAI's mark is one color, black or white: here the theme's text color.
			fill: "currentColor",
			// A trademark of its maker, shown only to say which agent a session runs.
			source: "OpenAI's mark, which Codex uses, from https://developers.openai.com/favicon.svg (without the blue circle behind it), taken on 2026-11-18.",
		},
		/*
		 * Verified with Codex CLI 0.171.0, from its own `--help`: `codex resume
		 * <uuid>` goes back to a conversation, and takes the same options as
		 * `codex` itself. No flag sets the id of a new one, so a fresh Codex
		 * starts as typed.
		 */
		resume: {
			fresh: null,
			resume: ["resume"],
			picks: ["resume", "fork", "exec", "e", "review", "--help", "-h", "--version", "-V"],
			pickingLetters: "hV",
			conversations: { store: "codex-sessions", folderVariable: "CODEX_HOME", folder: ".codex" },
		},
		signIn: { status: null, login: null },
		status: { source: "osc-7501", app: "codex" },
	},
] as const satisfies readonly AgentDefinition[];

/** The id of an agent in the table. */
export type AgentId = typeof ROWS[number]["id"];

/** The agents the app knows, in the order their presets are offered. */
export const AGENTS: readonly (AgentDefinition & { id: AgentId })[] = ROWS;

/**
 * The last part of a path, on either kind of separator. A Windows `.exe`
 * name is cut and, as Windows reads it, in any case; any other name keeps
 * its case.
 */
export function executableName(executable: string): string {
	const last = executable.split(/[\\/]/).at(-1) ?? "";
	return last.toLowerCase().endsWith(".exe") ? last.slice(0, -4).toLowerCase() : last;
}

/** The agent an executable is, by the last part of its path alone, or null. */
export function agentByExecutable(executable: string): (AgentDefinition & { id: AgentId }) | null {
	const name = executableName(executable);
	return AGENTS.find(agent => agent.executables.includes(name)) ?? null;
}

/** The agent with this id. */
export function agentById(id: AgentId): AgentDefinition & { id: AgentId } {
	return AGENTS.find(agent => agent.id === id)!;
}
