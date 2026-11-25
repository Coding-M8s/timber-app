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
	 * there and, for an agent without `fresh`, which one a session is in (see
	 * src/bun/agent-conversations.ts). `store` names the layout, which needs
	 * code of its own to read; the folder is `folderVariable` when it is set
	 * to a full path, else `xdgFolder` in `XDG_CONFIG_HOME` when the agent
	 * reads that variable and it is set to a full path, else `folder` in the
	 * home folder.
	 */
	conversations: { store: ConversationStore; folderVariable: string; folder: string; xdgFolder?: string };
}

/**
 * How an agent runs once to write text, with its tools switched off as far
 * as it lets the app: only these arguments after its executable, never the
 * ones typed in Settings, in a new empty folder, with the prompt on standard
 * input and the answer on standard output.
 */
export interface AgentGenerate {
	arguments: readonly string[];
	/** Files written to that folder first, such as a settings file that denies every tool. Paths are parts. */
	files: readonly { path: readonly string[]; text: string }[];
	/** The version this was run with, and when. */
	checked: string;
	/** What the agent keeps or can still reach that the person should know, or null for nothing. Settings says it. */
	caveat: string | null;
}

/** How an agent's own command says whether it is signed in, without changing that and without asking anything. */
export interface AgentSignInStatus {
	/** The arguments after its executable, never the ones typed in Settings. */
	arguments: readonly string[];
	/** The kind of answer, which needs code of its own to read. */
	answer: "claude-json" | "codex-text" | "cursor-json";
	/** Environment variables that hold a key the agent works with but this command does not count. */
	keysNotCounted: readonly string[];
	/** The version and system this was run with, and when. */
	checked: string;
}

/** The layouts of conversation folders the app can read. */
export type ConversationStore = "claude-projects" | "codex-sessions" | "grok-sessions" | "cursor-chats";

/** One shape of an agent's mark. */
export interface AgentMarkPath {
	d: string;
	/** How the shape's holes are filled, as SVG's `fill-rule`, when not `nonzero`. */
	fillRule?: "evenodd";
	/** How much of the fill shows, from 0 to 1, when not all of it. */
	opacity?: number;
}

/** A radial gradient a mark is filled with, as its maker drew it, in the view box's units. */
export interface AgentMarkGradient {
	/** SVG's `gradientTransform` of a gradient centered at 0,0 with radius 1. */
	transform: string;
	stops: readonly { offset: number; color: string }[];
}

/** An agent's official mark, as path data only. */
export interface AgentMark {
	viewBox: string;
	/** Its shapes, drawn in order, all in the one fill. */
	paths: readonly AgentMarkPath[];
	/** A color, `currentColor` for the theme's text color, or the maker's gradient. */
	fill: string | AgentMarkGradient;
	/** Where the mark was taken from, and when. */
	source: string;
}

/** One agent the app knows. */
export interface AgentDefinition {
	/** Stable: a running session and an ended agent's shell carry it (`program`, `resumable`), and the mark's class names use it. */
	id: string;
	/** Its name as a preset in Settings, Agents, and in words. */
	name: string;
	/** Its name as a preset of Timber's `[agent]`, as `timber setup` calls it where it has one. */
	label: string;
	/**
	 * The executables it is known by, as the last part of a path in lower
	 * case, without `.exe`. Unique across the table, with `sharedExecutables`.
	 */
	executables: readonly string[];
	/**
	 * Names other programs install too, such as `agent`, which both Cursor
	 * and Grok Build put on the PATH. Such a name is this agent only when the
	 * file it leads to, with every link followed, has one of `executables` as
	 * its name. Same form as `executables`, and unique with them.
	 */
	sharedExecutables: readonly string[];
	/** Whether it is in the list of agents before anything was saved in Settings, Agents. Every agent is offered as a preset. */
	default: boolean;
	/** The command its presets fill in, in Settings, Agents and in Timber's `[agent]`. */
	command: string;
	mark: AgentMark;
	/** How it goes back to a conversation, or null when it always starts as typed. */
	resume: AgentResume | null;
	/**
	 * Its sign-in: how its executable is asked whether it is signed in
	 * (./agent-sign-in.ts), given only after running it, and the arguments
	 * after the executable that sign in, each null when not known. Nothing
	 * reads `login` yet.
	 */
	signIn: { status: AgentSignInStatus | null; login: readonly string[] | null };
	/**
	 * How it runs once, without a session, to write text (./generate-text.ts),
	 * or null when that is not known yet. Given only after running it.
	 */
	generate: AgentGenerate | null;
	/**
	 * How it reports its status: the Program Status Protocol (OSC 7501), a
	 * status hook the person turns on in Settings, Agents, or not at all, and
	 * the start of the `app` it reports, such as `claude` for `claude-code`,
	 * which gives its mark to any session that reports it. Any program may
	 * still report through OSC 7501, whatever `source` says. `reports` lists
	 * the states it can report, for Settings to say; with a hook, they are
	 * the states of `hook.events`.
	 */
	status:
		| { source: "osc-7501"; app: string; reports: readonly ReportedState[] }
		| { source: "hook"; app: string; hook: AgentHook }
		| { source: "none"; app: null };
}

/** The states Settings names for an agent: `blocked` is said as "needs you". `idle` is never named. */
export type ReportedState = "idle" | "working" | "blocked" | "done";

/**
 * A status hook (see docs/decision-agent-status-hooks.md and
 * src/shared/status-hooks.ts), in one of two forms:
 *
 * - `cursor-hooks` and `gemini-settings`: entries the app adds to an
 *   agent's own settings file, each running the app's `status-hook` script
 *   with the agent's id and an event.
 * - `opencode-plugin`: a plugin file of the app's own in the agent's
 *   plugins folder, written and deleted whole, which appends the same line
 *   itself.
 */
export type AgentHook = EntriesHook | PluginHook;

interface HookBase {
	/** The file, as parts of a path in the home folder. */
	file: readonly string[];
	/** The version of the agent the format and events were checked against, and when. */
	checked: string;
	/** Whether the hook was checked by running the agent, or only built from its source; Turn on says so when not. */
	run: boolean;
	/** What keeps the hook from reporting that the person should know before turning it on, or absent. */
	caveat?: string;
}

/** Entries in an agent's shared settings file, each running the app's script: Cursor's `hooks.json`, Gemini's `settings.json`. */
export interface EntriesHook extends HookBase {
	/** The file's layout, which needs code of its own to read and write. */
	format: "cursor-hooks" | "gemini-settings";
	/**
	 * Each event the entries are added for, and the state it reports, in the
	 * order they are added; with `matcher`, the agent's own filter for the
	 * entry, written as it is (Gemini CLI's `matcher`).
	 */
	events: readonly { event: string; state: ReportedState; matcher?: string }[];
	/** The timeout for each entry, in seconds. A format whose agent counts in milliseconds converts it. */
	timeout: number;
}

/** A plugin file of the app's own, which reports the events itself. */
export interface PluginHook extends HookBase {
	format: "opencode-plugin";
	/** Each event the plugin reports, and the state it gives. */
	events: readonly { event: string; state: ReportedState }[];
	/**
	 * The file's parts under `XDG_CONFIG_HOME` when that is a full path,
	 * where the agent reads it instead of `file`; null when it does not move.
	 */
	xdgFile: readonly string[] | null;
}

const ROWS = [
	{
		id: "claude",
		name: "Claude Code",
		label: "Claude",
		executables: ["claude"],
		sharedExecutables: [],
		default: true,
		command: "claude",
		mark: {
			viewBox: "0 0 248 248",
			paths: [{ d: "M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" }],
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
		/*
		 * Exit code 0 with `loggedIn` true, 1 with it false. An API key, a token,
		 * or a cloud provider in the environment counts as logged in.
		 */
		signIn: {
			status: { arguments: ["auth", "status", "--json"], answer: "claude-json", keysNotCounted: [], checked: "Claude Code 2.1.332 on Linux on 2026-11-25" },
			login: null,
		},
		generate: {
			// `--tools ""` leaves no tool; the rest leaves out settings, hooks, MCP servers, CLAUDE.md, and the saved conversation.
			arguments: ["-p", "--tools", "", "--restricted", "--safe-mode", "--strict-mcp-config", "--no-session-persistence"],
			files: [],
			checked: "Claude Code 2.1.331 on 2026-11-24",
			caveat: null,
		},
		status: { source: "osc-7501", app: "claude", reports: ["working", "blocked", "done"] },
	},
	{
		id: "codex",
		name: "Codex",
		label: "Codex",
		executables: ["codex"],
		sharedExecutables: [],
		default: true,
		command: "codex",
		mark: {
			viewBox: "3.5 3.5 16.5 16.5",
			paths: [{ d: "M9.94494 9.59163V8.13227C9.94494 8.00935 9.99105 7.91713 10.0985 7.85575L13.0327 6.16599C13.4321 5.93558 13.9083 5.8281 14.3998 5.8281C16.2432 5.8281 17.4108 7.25677 17.4108 8.77751C17.4108 8.885 17.4108 9.00792 17.3953 9.13083L14.3537 7.34884C14.1694 7.24135 13.985 7.24135 13.8007 7.34884L9.94494 9.59163ZM16.7963 15.2755V11.7883C16.7963 11.5732 16.704 11.4196 16.5197 11.3121L12.664 9.0693L13.9236 8.34725C14.0311 8.28587 14.1234 8.28587 14.2308 8.34725L17.165 10.037C18.0099 10.5287 18.5782 11.5732 18.5782 12.587C18.5782 13.7544 17.887 14.8298 16.7963 15.2753V15.2755ZM9.03861 12.2031L7.77896 11.4658C7.67146 11.4045 7.62535 11.3122 7.62535 11.1893V7.8098C7.62535 6.16613 8.88501 4.92176 10.5902 4.92176C11.2354 4.92176 11.8344 5.13689 12.3415 5.52089L9.31526 7.27218C9.13097 7.37968 9.03875 7.53328 9.03875 7.74841V12.2033L9.03861 12.2031ZM11.75 13.77L9.94494 12.7562V10.6056L11.75 9.59178L13.5549 10.6056V12.7562L11.75 13.77ZM12.9098 18.44C12.2645 18.44 11.6655 18.2249 11.1585 17.8409L14.1847 16.0896C14.369 15.9821 14.4612 15.8285 14.4612 15.6134V11.1585L15.7363 11.8958C15.8438 11.9572 15.8899 12.0494 15.8899 12.1723V15.5519C15.8899 17.1955 14.6148 18.44 12.9098 18.44ZM9.26901 15.0144L6.33486 13.3246C5.4899 12.833 4.92161 11.7885 4.92161 10.7746C4.92161 9.59177 5.62824 8.53183 6.71886 8.0863V11.5887C6.71886 11.8039 6.81109 11.9575 6.99538 12.065L10.8359 14.2923L9.57621 15.0144C9.46872 15.0758 9.37649 15.0758 9.26901 15.0144ZM9.10013 17.5337C7.36426 17.5337 6.08919 16.2279 6.08919 14.6149C6.08919 14.492 6.1046 14.3691 6.11988 14.2462L9.1461 15.9975C9.33039 16.105 9.51483 16.105 9.69912 15.9975L13.5549 13.7702V15.2295C13.5549 15.3524 13.5088 15.4446 13.4013 15.506L10.4671 17.1958C10.0677 17.4262 9.59148 17.5337 9.09999 17.5337H9.10013ZM12.9098 19.3616C14.7685 19.3616 16.32 18.0406 16.6735 16.2893C18.3939 15.8438 19.5 14.2308 19.5 12.5872C19.5 11.5118 19.0391 10.4673 18.2096 9.71454C18.2864 9.39192 18.3326 9.0693 18.3326 8.74682C18.3326 6.55014 16.5505 4.90634 14.4921 4.90634C14.0774 4.90634 13.6779 4.96772 13.2785 5.10605C12.5872 4.43011 11.6347 4 10.5902 4C8.7314 4 7.17996 5.32103 6.8265 7.07232C5.10605 7.51786 4 9.13083 4 10.7745C4 11.8498 4.4608 12.8944 5.29035 13.6471C5.21354 13.9697 5.16743 14.2923 5.16743 14.6148C5.16743 16.8114 6.94941 18.4552 9.00792 18.4552C9.42261 18.4552 9.82204 18.3939 10.2215 18.2556C10.9127 18.9315 11.8651 19.3616 12.9098 19.3616Z" }],
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
		/*
		 * Exit code 0 with a line "Logged in using ..." on standard error, 1 with
		 * "Not logged in". It also ends with 1 when its settings cannot be read.
		 */
		signIn: {
			status: { arguments: ["login", "status"], answer: "codex-text", keysNotCounted: [], checked: "Codex CLI 0.169.0 on Linux on 2026-11-25" },
			login: null,
		},
		generate: {
			// Codex has no switch for every tool: the read-only sandbox stays under the ones that remain.
			arguments: [
				"exec", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--ignore-rules", "--color", "never",
				"--disable", "shell_tool", "--disable", "unified_exec", "--disable", "apps", "--disable", "plugins", "--disable", "image_generation", "--disable", "multi_agent",
				"-c", 'web_search="disabled"', "-",
			],
			files: [],
			checked: "Codex CLI 0.169.0 on 2026-11-24",
			caveat: "Codex cannot switch off every tool. Its shell, web search, and apps are off, and a read-only sandbox is under the rest.",
		},
		status: { source: "osc-7501", app: "codex", reports: ["working", "done"] },
	},
	{
		id: "cursor",
		name: "Cursor CLI",
		label: "Cursor",
		executables: ["cursor-agent"],
		sharedExecutables: ["agent"],
		default: false,
		command: "cursor-agent",
		mark: {
			viewBox: "0 0 466.73 532.09",
			paths: [
				{ d: "M457.43,125.94L244.42,2.96c-6.84-3.95-15.28-3.95-22.12,0L9.3,125.94c-5.75,3.32-9.3,9.46-9.3,16.11v247.99c0,6.65,3.55,12.79,9.3,16.11l213.01,122.98c6.84,3.95,15.28,3.95,22.12,0l213.01-122.98c5.75-3.32,9.3-9.46,9.3-16.11v-247.99c0-6.65-3.55-12.79-9.3-16.11h-.01ZM444.05,151.99l-205.63,356.16c-1.39,2.4-5.06,1.42-5.06-1.36v-233.21c0-4.66-2.49-8.97-6.53-11.31L24.87,145.67c-2.4-1.39-1.42-5.06,1.36-5.06h411.26c5.84,0,9.49,6.33,6.57,11.39h-.01Z" },
			],
			// Cursor's cube is one color, dark or light: here the theme's text color.
			fill: "currentColor",
			// A trademark of its maker, shown only to say which agent a session runs.
			source: "Cursor's cube, CUBE_2D_LIGHT.svg in the brand kit at https://cursor.com/brand, taken on 2026-11-22.",
		},
		/*
		 * Verified with Cursor CLI 2026.11.19-f005e9d and 2026.11.22-e9042b2,
		 * from its own `--help` and by running it (see docs/architecture.md,
		 * "Going back to a conversation"): `cursor-agent --resume <chat id>`
		 * goes back to a chat. No documented flag sets the id of a new one, so
		 * a fresh Cursor starts as typed and its id is read at quit from its
		 * chats folder. `--worktree` and `--workspace` move the chat to another
		 * folder, so they start as typed too.
		 */
		resume: {
			fresh: null,
			resume: ["--resume"],
			picks: ["--resume", "--continue", "--print", "-p", "--new-session-id", "--cloud", "-c", "--background", "-b", "--worktree", "-w", "--workspace", "--list-models", "--help", "-h", "--version", "-v"],
			pickingLetters: "pcbwhv",
			conversations: { store: "cursor-chats", folderVariable: "CURSOR_CONFIG_DIR", folder: ".cursor", xdgFolder: "cursor" },
		},
		/*
		 * Exit code 0 either way; `status` says which. It asks Cursor's server
		 * who is signed in, and still says signed in when that fails.
		 */
		signIn: {
			status: { arguments: ["status", "--format", "json"], answer: "cursor-json", keysNotCounted: ["CURSOR_API_KEY"], checked: "Cursor CLI 2026.11.22-e9042b2 on Linux on 2026-11-25" },
			login: null,
		},
		generate: {
			// Ask mode alone still reads files and runs commands, so a file in the folder denies every tool.
			arguments: ["-p", "--mode", "ask", "--sandbox", "enabled", "--trust", "--output-format", "text"],
			files: [{
				path: [".cursor", "cli.json"],
				text: `${JSON.stringify({ permissions: { allow: [], deny: ["Shell(*)", "Read(**)", "Read(/**)", "Write(**)", "Write(/**)", "WebFetch(*)", "Mcp(*:*)"] } })}\n`,
			}],
			checked: "Cursor CLI 2026.11.22-e9042b2 on 2026-11-24",
			caveat: "Cursor CLI has no switch for its tools: a settings file denies them. It may keep the chat, and your MCP servers may connect.",
		},
		/*
		 * Cursor CLI writes no OSC 7501. Checked with 2026.11.22-e9042b2 on
		 * 2026-11-22 by running it interactively: it reads its user hooks from
		 * `~/.cursor/hooks.json` in the home folder, whatever
		 * `CURSOR_CONFIG_DIR` names, and runs `sessionStart`,
		 * `beforeSubmitPrompt`, and `stop` with no terminal. A hook that prints
		 * nothing, leaves its input unread, or names a missing command lets the
		 * turn go on. No event ran while it waited for a shell command's
		 * approval or a question's answer, so no needs you (issue 352; edit and
		 * MCP approval not tried): `beforeShellExecution` runs for every shell command
		 * before Cursor decides whether to ask, so mapping it would alert for
		 * commands that never wait. Esc and Ctrl+C run `stop`, so an
		 * interrupted turn shows done.
		 */
		status: {
			source: "hook",
			app: "cursor",
			hook: {
				format: "cursor-hooks",
				file: [".cursor", "hooks.json"],
				events: [
					{ event: "sessionStart", state: "idle" },
					{ event: "beforeSubmitPrompt", state: "working" },
					{ event: "stop", state: "done" },
				],
				timeout: 5,
				checked: "Cursor CLI 2026.11.22 on 2026-11-22",
				run: true,
			},
		},
	},
	{
		id: "gemini",
		name: "Gemini CLI",
		label: "Gemini",
		executables: ["gemini"],
		sharedExecutables: [],
		default: false,
		command: "gemini",
		mark: {
			viewBox: "0 0 28 28",
			paths: [
				{ d: "M14 28C14 26.0633 13.6267 24.2433 12.88 22.54C12.1567 20.8367 11.165 19.355 9.905 18.095C8.645 16.835 7.16333 15.8433 5.46 15.12C3.75667 14.3733 1.93667 14 0 14C1.93667 14 3.75667 13.6383 5.46 12.915C7.16333 12.1683 8.645 11.165 9.905 9.905C11.165 8.645 12.1567 7.16333 12.88 5.46C13.6267 3.75667 14 1.93667 14 0C14 1.93667 14.3617 3.75667 15.085 5.46C15.8317 7.16333 16.835 8.645 18.095 9.905C19.355 11.165 20.8367 12.1683 22.54 12.915C24.2433 13.6383 26.0633 14 28 14C26.0633 14 24.2433 14.3733 22.54 15.12C20.8367 15.8433 19.355 16.835 18.095 18.095C16.835 19.355 15.8317 20.8367 15.085 22.54C14.3617 24.2433 14 26.0633 14 28Z" },
			],
			// Gemini's spark in its own gradient, part of its mark, as Claude's orange is (see docs/design.md, Look).
			fill: {
				transform: "translate(2.77876 11.3795) rotate(18.6832) scale(29.8025 238.737)",
				stops: [{ offset: 0.0671246, color: "#9168C0" }, { offset: 0.342551, color: "#5684D1" }, { offset: 0.672076, color: "#1BA1E3" }],
			},
			// A trademark of its maker, shown only to say which agent a session runs.
			source: "Gemini's spark, as gemini.google.com serves it, from https://www.gstatic.com/lamda/images/gemini_sparkle_v002_d4735304ff6292a690345.svg, taken on 2026-11-22. Google publishes no Gemini CLI brand kit there.",
		},
		resume: null,
		signIn: { status: null, login: null },
		generate: null,
		/*
		 * Gemini CLI writes no OSC 7501: no `]7501` in its 0.70.0 package.
		 * Not run: its hooks were read from that package's source and docs on
		 * 2026-11-22 (see docs/architecture.md, "Status hooks"). It reads them
		 * from `~/.gemini/settings.json` (`GEMINI_CLI_HOME` moves it, which the
		 * app does not follow), and only in a folder it trusts. `BeforeTool`
		 * runs before the person is asked, so `AfterTool` is what brings an
		 * approved turn back to working. `Notification` runs as it asks, and
		 * takes no matcher in 0.70.0; `ToolPermission` is its only kind.
		 */
		status: {
			source: "hook",
			app: "gemini",
			hook: {
				format: "gemini-settings",
				file: [".gemini", "settings.json"],
				events: [
					{ event: "SessionStart", state: "idle" },
					{ event: "BeforeAgent", state: "working" },
					{ event: "Notification", state: "blocked", matcher: "ToolPermission" },
					{ event: "AfterTool", state: "working" },
					{ event: "AfterAgent", state: "done" },
				],
				timeout: 5,
				checked: "Gemini CLI 0.70.0's source, read on 2026-11-22, not run",
				run: false,
				caveat: "Gemini CLI runs hooks only in a folder it trusts, so a session in a new worktree reports nothing until you trust that folder, or one above it, in Gemini CLI.",
			},
		},
	},
	{
		id: "grok",
		name: "Grok Build",
		label: "Grok",
		executables: ["grok"],
		sharedExecutables: [],
		default: false,
		command: "grok",
		mark: {
			viewBox: "56 56 400 400",
			paths: [
				{ d: "M210.484 312.759L343.465 210.383C349.984 205.364 359.302 207.322 362.408 215.117C378.758 256.231 371.454 305.64 338.925 339.563C306.397 373.487 261.137 380.927 219.768 363.983L174.577 385.803C239.394 432.008 318.104 420.581 367.289 369.251C406.303 328.564 418.386 273.104 407.088 223.091L407.19 223.198C390.807 149.726 411.218 120.359 453.03 60.3072C454.02 58.8833 455.01 57.4595 456 56L400.978 113.382V113.204L210.45 312.794" },
				{ d: "M183.042 337.641C136.519 291.294 144.54 219.567 184.236 178.203C213.59 147.59 261.683 135.096 303.666 153.464L348.755 131.75C340.632 125.627 330.221 119.042 318.275 114.414C264.277 91.2407 199.63 102.774 155.735 148.516C113.513 192.549 100.236 260.254 123.036 318.027C140.069 361.206 112.148 391.748 84.0229 422.575C74.0561 433.503 64.0553 444.431 56 456L183.007 337.677" },
			],
			// xAI's Grok mark is one color, black or white: here the theme's text color.
			fill: "currentColor",
			// A trademark of its maker, shown only to say which agent a session runs.
			source: "Grok's mark, from https://grok.com/images/favicon.svg (its two shapes, without the dark tile behind them), taken on 2026-11-22.",
		},
		/*
		 * Verified with Grok Build 1.0.92, from its own `--help` and by running
		 * it (see docs/architecture.md, "Going back to a conversation"):
		 * `grok --session-id <uuid>` starts a new conversation with an id the
		 * app chose, also in the interactive screen, and `grok --resume <uuid>`
		 * goes back to it. The two are never combined: Grok refuses that
		 * without `--fork-session`. `--worktree` and `--cwd` start it in another
		 * folder, so they start as typed.
		 */
		resume: {
			fresh: ["--session-id"],
			resume: ["--resume"],
			picks: ["--session-id", "-s", "--resume", "-r", "--continue", "-c", "--fork-session", "--single", "-p", "--prompt-file", "--prompt-json", "--worktree", "-w", "--cwd", "--help", "-h", "--version", "-v"],
			pickingLetters: "srcpwhv",
			conversations: { store: "grok-sessions", folderVariable: "GROK_HOME", folder: ".grok" },
		},
		signIn: { status: null, login: null },
		generate: {
			// `--tools ""` means every tool to Grok, so one harmless tool is all it is left.
			arguments: ["--no-memory", "--no-subagents", "--disable-web-search", "--no-plan", "--tools", "todo_write", "--permission-mode", "dontAsk", "--output-format", "plain", "-p"],
			files: [],
			checked: "Grok Build 1.0.92 on 2026-11-24",
			caveat: "Grok Build keeps each run as a session in its own folder, with the diff in it, and your MCP servers may connect.",
		},
		/*
		 * Run with Grok Build 1.0.92 on 2026-11-25 on Linux x64, through the
		 * app's own sessions (see docs/verification.md): it reports an approval,
		 * a question, and the end of a turn itself, so it gets no status hook.
		 */
		status: { source: "osc-7501", app: "grok", reports: ["working", "blocked", "done"] },
	},
	{
		id: "opencode",
		name: "OpenCode",
		label: "OpenCode",
		executables: ["opencode"],
		sharedExecutables: [],
		default: false,
		command: "opencode",
		mark: {
			viewBox: "0 0 240 300",
			paths: [
				{ d: "M180 240H60V120H180V240Z", opacity: 0.2 },
				{ d: "M180 60H60V240H180V60ZM240 300H0V0H240V300Z" },
			],
			// OpenCode's mark is one color, dark or light, with its inner square faint: here the theme's text color.
			fill: "currentColor",
			// A trademark of its maker, shown only to say which agent a session runs.
			source: "OpenCode's mark, opencode-logo-transparent-light.svg in the brand kit at https://opencode.ai/brand, taken on 2026-11-22.",
		},
		resume: null,
		signIn: { status: null, login: null },
		generate: null,
		/*
		 * OpenCode writes no OSC 7501 that is known of. Built from the source
		 * of OpenCode 1.19.6 (github.com/anomalyco/opencode, tag v1.19.6) on
		 * 2026-11-22, not run: OpenCode was not installed where it was built.
		 * It loads every `.js` file in `plugins` of its config folder,
		 * `XDG_CONFIG_HOME/opencode` or `~/.config/opencode`, and gives a
		 * plugin `session.status` (busy, idle), `permission.asked` and
		 * `.replied`, and `question.asked`, `.replied`, and `.rejected`. The
		 * plugin (`OPENCODE_STATUS_PLUGIN`) turns those into the events here.
		 * OpenCode 2 renames its events, so this is for OpenCode 1 only.
		 */
		status: {
			source: "hook",
			app: "opencode",
			hook: {
				format: "opencode-plugin",
				file: [".config", "opencode", "plugins", "timber-app-status.js"],
				xdgFile: ["opencode", "plugins", "timber-app-status.js"],
				events: [
					{ event: "busy", state: "working" },
					{ event: "permission.asked", state: "blocked" },
					{ event: "question.asked", state: "blocked" },
					{ event: "answered", state: "working" },
					{ event: "idle", state: "done" },
				],
				checked: "OpenCode 1.19.6's source on 2026-11-22",
				run: false,
			},
		},
	},
	{
		id: "copilot",
		name: "GitHub Copilot CLI",
		label: "Copilot",
		executables: ["copilot"],
		sharedExecutables: [],
		default: false,
		command: "copilot",
		mark: {
			viewBox: "0 0 96 96",
			paths: [
				{ d: "M95.6877 67.9677C92.2446 73.9488 72.2522 88.0617 48 88.0617C23.7478 88.0617 3.75535 73.9488 0.312312 67.9677C0.0605215 67.5303 -0.0207525 67.031 -0.0207525 66.5263L-0.0207524 55.8787C-0.0207524 55.4373 0.0473833 54.9986 0.210699 54.5885C1.69959 50.8499 5.59895 45.4192 10.6313 43.9621C11.2985 42.2494 12.2867 39.7456 13.2087 37.8974C13.0543 36.4833 13 35.0248 13 33.5512C13 28.2274 14.1285 23.5576 17.5288 20.0801C19.117 18.4559 21.0876 17.21 23.4246 16.2735C29.0217 11.7264 36.992 7.90112 47.9136 7.90112C58.8352 7.90112 66.9783 11.7264 72.5754 16.2735C74.9124 17.21 76.883 18.4559 78.4712 20.0801C81.8715 23.5576 83 28.2274 83 33.5512C83 35.0248 82.9457 36.4833 82.7913 37.8974C83.7133 39.7456 84.7015 42.2494 85.3687 43.9621C90.401 45.4192 94.3004 50.8499 95.7893 54.5885C95.9526 54.9986 96.0208 55.4373 96.0208 55.8787L96.0208 66.5263C96.0208 67.031 95.9395 67.5303 95.6877 67.9677ZM51.253 32.2606C51.0828 30.9345 51.0018 29.747 50.9995 28.686L50.9995 28.6021C51.0048 25.5242 51.6776 23.5215 52.7524 22.2914C54.1172 20.7295 56.9379 19.5328 62.8829 20.1762C68.9059 20.828 72.2725 22.3229 74.1812 24.2749C76.0291 26.1648 76.9999 28.9922 76.9999 33.5512C76.9999 38.3951 76.3018 41.2568 74.767 42.9977C73.3075 44.6531 70.4335 46 64.1386 46C59.2994 46 56.5326 44.4261 54.7637 42.2493C52.8644 39.912 51.7955 36.4878 51.253 32.2606ZM44.747 32.2606C44.9172 30.9344 44.9982 29.747 45.0005 28.686L45.0005 28.6021C44.9952 25.5242 44.3224 23.5214 43.2476 22.2914C41.8828 20.7295 39.0621 19.5328 33.1171 20.1762C27.0941 20.828 23.7275 22.3229 21.8188 24.2749C19.9709 26.1647 19.0001 28.9922 19.0001 33.5512C19.0001 38.3951 19.6982 41.2568 21.233 42.9977C22.6925 44.6531 25.5665 46 31.8614 46C36.7006 46 39.4674 44.4261 41.2363 42.2493C43.1356 39.9119 44.2045 36.4878 44.747 32.2606ZM48.6889 43.9983C48.4592 43.9995 48.9185 43.9983 48.6889 43.9983C48.4594 43.9983 47.5408 43.9995 47.3111 43.9983C46.8877 44.7075 46.4168 45.3882 45.8926 46.0332C42.8139 49.8219 38.2182 52 31.8613 52C24.9615 52 19.9049 50.564 16.7324 46.9657C16.552 46.7611 16.3906 46.5469 16.3906 46.5469L16 46.9657L16 73.3023C21.7392 76.4213 34.0576 82.0184 48 82.0184C61.9424 82.0184 74.2608 76.4213 80 73.3023L80 46.9657L79.6094 46.5469C79.6094 46.5469 79.4772 46.728 79.2676 46.9657C76.0951 50.564 71.0385 52 64.1387 52C57.7818 52 53.1861 49.8219 50.1074 46.0332C49.5832 45.3882 49.1123 44.7075 48.6889 43.9983Z", fillRule: "evenodd" },
				{ d: "M58 57C60.2091 57 62 58.7909 62 61L62 69C62 71.2092 60.2091 73 58 73C55.7909 73 54 71.2092 54 69L54 61C54 58.7909 55.7909 57 58 57Z", fillRule: "evenodd" },
				{ d: "M38 57C40.2091 57 42 58.7909 42 61L42 69C42 71.2092 40.2091 73 38 73C35.7909 73 34 71.2092 34 69L34 61C34 58.7909 35.7909 57 38 57Z", fillRule: "evenodd" },
			],
			// GitHub's Copilot mark is one color, black or white: here the theme's text color.
			fill: "currentColor",
			// A trademark of its maker, shown only to say which agent a session runs.
			source: "GitHub's Copilot mark, Copilot_Icon_Black.svg in https://brand.github.com/GitHub_Logos.zip (from https://brand.github.com/brand-identity/copilot), taken on 2026-11-22.",
		},
		resume: null,
		signIn: { status: null, login: null },
		generate: null,
		/*
		 * Run with 1.0.116 on Linux x64 on 2026-11-25 (see docs/architecture.md,
		 * "Agent status"): it reports without a probe. Its changelog first lists
		 * this in 1.0.106, which was not run, so an older one should show only
		 * running or exited. While it asks whether to trust a folder it reports `idle`.
		 */
		status: { source: "osc-7501", app: "copilot", reports: ["working", "blocked", "done"] },
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

/**
 * The agent an executable is, by the last part of its path, or null. A name
 * other programs install too (`sharedExecutables`, such as `agent`) is the
 * agent only when `realPath`, the file the executable leads to with every
 * link followed, is named as one of its own `executables`; without
 * `realPath` it is no agent.
 */
export function agentByExecutable(executable: string, realPath?: string | null): (AgentDefinition & { id: AgentId }) | null {
	const name = executableName(executable);
	const own = AGENTS.find(agent => agent.executables.includes(name));
	if (own !== undefined) return own;
	if (realPath === undefined || realPath === null) return null;
	const real = executableName(realPath);
	return AGENTS.find(agent => agent.sharedExecutables.includes(name) && agent.executables.includes(real)) ?? null;
}

/** The agent with this id. */
export function agentById(id: AgentId): AgentDefinition & { id: AgentId } {
	return AGENTS.find(agent => agent.id === id)!;
}
