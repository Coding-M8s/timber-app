/**
 * Timber's own configuration, as the Settings dialog shows it: read-only.
 * Pure: the main process reads the files (src/bun/timber-config.ts) and
 * hands the parsed TOML here, and the interface words what comes back.
 *
 * Timber keeps two files. A repository's `.timber.toml` sits in its primary
 * checkout. The machine defaults sit in Timber's global `config.toml`. The
 * app reads them to show them and never writes them: `timber setup` is the
 * way to change them for now.
 *
 * Nothing here may show a secret. Commands are shown by their executable
 * only, with a count of their arguments, and scripts by their count, as
 * Timber's own setup screen does, because arguments and scripts can carry
 * tokens. Keys the app does not know are named but their values are never
 * shown. Credentials are never read: an integration only says whether it is
 * configured (see `IntegrationStatus`).
 */

/** Which of Timber's two files: the machine defaults, or one repository's. */
export const TIMBER_CONFIG_SCOPES = ["machine", "repository"] as const;
export type TimberConfigScope = typeof TIMBER_CONFIG_SCOPES[number];

/** The file a repository keeps its Timber settings in, in its primary checkout. */
export const REPOSITORY_CONFIG_FILE = ".timber.toml";

/** A file larger than this is not read. Timber's settings are a few lines. */
export const TIMBER_CONFIG_SIZE_LIMIT = 256 * 1024;

/** An executable Timber may start, as shown: never its arguments, which can hold tokens. */
export interface TimberLauncher {
	command: string;
	argumentCount: number;
	/** Whether Timber starts it by itself. */
	enabled: boolean;
}

export interface TimberWorkflow {
	name: string;
	/** Turned off with `name = false`. */
	off: boolean;
	description: string | null;
	setupScripts: number;
}

/**
 * The values one file sets. A key the file does not set is left out, so
 * Timber takes it from the machine defaults or its own default. `false`
 * means the file turns the feature off.
 */
export interface TimberConfigValues {
	editor?: false | (TimberLauncher & { integration: string | null });
	agent?: false | (TimberLauncher & { waitForSetup: boolean | null });
	defaultTracker?: string;
	baseBranch?: string;
	remote?: string;
	worktreeDir?: string;
	/** `preDoneScripts` is null when the file does not set `pre_delete`. */
	hooks?: false | { setupScripts: number; preDoneScripts: number | null };
	workflows?: false | TimberWorkflow[];
	jira?: false | { siteUrl: string; cloudId: boolean };
	/** The names of the arena presets, each with whether it is turned off. */
	arena?: false | { name: string; off: boolean }[];
}

/** One of Timber's files, as read. A missing or broken file is never shown as empty defaults. */
export type TimberConfigFile =
	| { state: "missing"; path: string }
	/** The file is there but could not be read, or is not settings Timber can use. */
	| { state: "error"; path: string; message: string; problems: string[] }
	/** `unknown` names keys this app does not know, by dotted path. Their values are never shown. */
	| { state: "read"; path: string; values: TimberConfigValues; unknown: string[] };

/** Both files: the machine defaults, and the repository's when one was asked for. */
export interface TimberSettings {
	machine: TimberConfigFile;
	repository: TimberConfigFile | null;
}

/** The services Timber can look up issues in. */
export const INTEGRATIONS = ["github", "jira", "linear"] as const;
export type Integration = typeof INTEGRATIONS[number];

/**
 * Whether Timber has what it needs to reach a service, found without reading
 * a secret: whether an environment variable is set, whether a credential
 * file is there, or how `gh auth status` exits.
 */
export type IntegrationStatus =
	| { state: "configured"; source: "environment" | "saved" | "github-cli" }
	| { state: "not-configured" }
	/** It could not be told, such as when the GitHub CLI is not installed. */
	| { state: "unknown"; reason: string };

export type IntegrationStatuses = Record<Integration, IntegrationStatus>;

/** The arguments after `timber` that start setup for one file. Shown before it runs, and run from the same list. */
export function timberSetupArguments(scope: TimberConfigScope): string[] {
	return scope === "machine" ? ["setup", "--global"] : ["setup"];
}

/**
 * The path of Timber's machine file, found as Timber finds it: under
 * `XDG_CONFIG_HOME` when that is a full path, otherwise under `.config` in
 * the home folder. Null when no home folder is known.
 */
export function machineConfigPath(environment: Record<string, string | undefined>, platform: string, home: string | null): string | null {
	const separator = platform === "win32" ? "\\" : "/";
	const join = (...parts: string[]) => parts.join(separator).replace(/[\\/]+/g, separator);
	const absolute = (value: string) => platform === "win32" ? /^([A-Za-z]:[\\/]|[\\/]{2})/.test(value) : value.startsWith("/");
	const xdg = environment.XDG_CONFIG_HOME;
	if (xdg && absolute(xdg)) return join(xdg, "timber", "config.toml");
	const base = environment.HOME || (platform === "win32" ? environment.USERPROFILE : undefined) || home;
	return base ? join(base, ".config", "timber", "config.toml") : null;
}

/** Text from a file, made safe to show: control characters become a replacement mark, and it is cut short. */
export function displayText(value: string, limit = 200): string {
	const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "\uFFFD");
	const characters = Array.from(clean);
	return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}\u2026` : clean;
}

type Table = Record<string, unknown>;

function isTable(value: unknown): value is Table {
	return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

const nonBlank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Reads one file's values, noting each problem and each key it does not know. */
class Reader {
	readonly problems: string[] = [];
	readonly unknown: string[] = [];

	invalid(path: string): undefined {
		this.problems.push(`${path} is invalid`);
		return undefined;
	}

	/** Note the keys of `table` that are not in `known`. */
	others(table: Table, known: readonly string[], prefix: string): void {
		for (const key of Object.keys(table)) if (!known.includes(key)) this.unknown.push(prefix ? `${prefix}.${displayText(key, 60)}` : displayText(key, 60));
	}

	string(table: Table, key: string, path: string): string | undefined {
		const value = table[key];
		if (value === undefined) return undefined;
		return nonBlank(value) ? displayText(value) : this.invalid(path);
	}

	boolean(table: Table, key: string, path: string): boolean | undefined {
		const value = table[key];
		if (value === undefined) return undefined;
		return typeof value === "boolean" ? value : this.invalid(path);
	}

	/** How many lines a list of scripts holds. */
	scripts(table: Table, key: string, path: string): number | undefined {
		const value = table[key];
		if (value === undefined) return undefined;
		if (!Array.isArray(value) || !value.every(nonBlank)) return this.invalid(path);
		return value.length;
	}

	launcher(table: Table, path: string): TimberLauncher | undefined {
		const { command, args, enabled } = table;
		if (!nonBlank(command)) return this.invalid(`${path}.command`);
		if (args !== undefined && (!Array.isArray(args) || !args.every(argument => typeof argument === "string"))) return this.invalid(`${path}.args`);
		if (enabled !== undefined && typeof enabled !== "boolean") return this.invalid(`${path}.enabled`);
		return { command: displayText(command), argumentCount: Array.isArray(args) ? args.length : 0, enabled: enabled === true };
	}

	editor(value: unknown): TimberConfigValues["editor"] {
		if (value === false) return false;
		if (!isTable(value)) return this.invalid("editor");
		this.others(value, ["command", "args", "enabled", "integration"], "editor");
		const launcher = this.launcher(value, "editor");
		const integration = this.string(value, "integration", "editor.integration");
		return launcher && { ...launcher, integration: integration ?? null };
	}

	agent(value: unknown): TimberConfigValues["agent"] {
		if (value === false) return false;
		if (!isTable(value)) return this.invalid("agent");
		this.others(value, ["command", "args", "enabled", "wait_for_setup"], "agent");
		const launcher = this.launcher(value, "agent");
		const waitForSetup = this.boolean(value, "wait_for_setup", "agent.wait_for_setup");
		return launcher && { ...launcher, waitForSetup: waitForSetup ?? null };
	}

	hooks(value: unknown): TimberConfigValues["hooks"] {
		if (value === false) return false;
		if (!isTable(value)) return this.invalid("hooks");
		this.others(value, ["post_create", "pre_delete"], "hooks");
		const setupScripts = this.scripts(value, "post_create", "hooks.post_create");
		const preDoneScripts = this.scripts(value, "pre_delete", "hooks.pre_delete");
		return { setupScripts: setupScripts ?? 0, preDoneScripts: preDoneScripts ?? null };
	}

	workflows(value: unknown): TimberConfigValues["workflows"] {
		if (value === false) return false;
		if (!isTable(value)) return this.invalid("workflows");
		const workflows: TimberWorkflow[] = [];
		for (const [key, entry] of Object.entries(value)) {
			const name = displayText(key, 60);
			const path = `workflows.${name}`;
			if (entry === false) {
				workflows.push({ name, off: true, description: null, setupScripts: 0 });
				continue;
			}
			if (!isTable(entry)) {
				this.invalid(path);
				continue;
			}
			this.others(entry, ["description", "post_create", "editor", "agent"], path);
			const description = this.string(entry, "description", `${path}.description`);
			const setupScripts = this.scripts(entry, "post_create", `${path}.post_create`);
			for (const launcher of ["editor", "agent"] as const) {
				const own = entry[launcher];
				if (own !== undefined && own !== false && !(isTable(own) && nonBlank(own.command))) this.invalid(`${path}.${launcher}`);
			}
			workflows.push({ name, off: false, description: description ?? null, setupScripts: setupScripts ?? 0 });
		}
		return workflows;
	}

	jira(value: unknown): TimberConfigValues["jira"] {
		if (value === false) return false;
		if (!isTable(value)) return this.invalid("jira");
		this.others(value, ["site_url", "cloud_id"], "jira");
		const siteUrl = this.string(value, "site_url", "jira.site_url");
		const cloudId = this.string(value, "cloud_id", "jira.cloud_id");
		if (siteUrl === undefined) return value.site_url === undefined ? this.invalid("jira.site_url") : undefined;
		return { siteUrl, cloudId: cloudId !== undefined };
	}

	arena(value: unknown): TimberConfigValues["arena"] {
		if (value === false) return false;
		if (!isTable(value)) return this.invalid("arena");
		this.others(value, ["agents"], "arena");
		if (value.agents === undefined) return [];
		if (!isTable(value.agents)) return this.invalid("arena.agents");
		const presets: { name: string; off: boolean }[] = [];
		for (const [key, entry] of Object.entries(value.agents)) {
			const name = displayText(key, 60);
			if (entry !== false && !(isTable(entry) && nonBlank(entry.command))) this.invalid(`arena.agents.${name}`);
			else presets.push({ name, off: entry === false });
		}
		return presets;
	}
}

const TRACKERS = ["github", "linear", "jira", "none"];

const KNOWN_KEYS = [
	"default_tracker", "arena", "base_branch", "remote", "worktree_dir", "hooks", "workflows", "editor", "agent", "jira",
] as const;

/**
 * One of Timber's files, from what it holds: `source` is its text, or null
 * when there is no file. `parse` reads TOML and throws when it cannot, as
 * `Bun.TOML.parse` does. A key the app knows with a value Timber cannot use
 * makes the whole file an error, as it does for Timber.
 */
export function readTimberConfig(path: string, source: string | null, parse: (source: string) => unknown): TimberConfigFile {
	if (source === null) return { state: "missing", path };
	let parsed: unknown;
	try {
		parsed = parse(source);
	} catch {
		// The parser's own words are not shown: they can quote the file. Bun's error says no place in the file either.
		return { state: "error", path, message: "It is not valid TOML. Timber reports where when it reads the file, for example in timber setup.", problems: [] };
	}
	if (!isTable(parsed)) return { state: "error", path, message: "It is not a table of settings.", problems: [] };

	const reader = new Reader();
	reader.others(parsed, KNOWN_KEYS, "");
	const values: TimberConfigValues = {};
	const set = <Key extends keyof TimberConfigValues>(key: Key, value: TimberConfigValues[Key] | undefined) => {
		if (value !== undefined) values[key] = value;
	};
	if (parsed.default_tracker !== undefined) {
		const tracker = parsed.default_tracker;
		set("defaultTracker", typeof tracker === "string" && TRACKERS.includes(tracker) ? tracker : reader.invalid("default_tracker"));
	}
	set("baseBranch", reader.string(parsed, "base_branch", "base_branch"));
	set("remote", reader.string(parsed, "remote", "remote"));
	set("worktreeDir", reader.string(parsed, "worktree_dir", "worktree_dir"));
	if (parsed.editor !== undefined) set("editor", reader.editor(parsed.editor));
	if (parsed.agent !== undefined) set("agent", reader.agent(parsed.agent));
	if (parsed.hooks !== undefined) set("hooks", reader.hooks(parsed.hooks));
	if (parsed.workflows !== undefined) set("workflows", reader.workflows(parsed.workflows));
	if (parsed.jira !== undefined) set("jira", reader.jira(parsed.jira));
	if (parsed.arena !== undefined) set("arena", reader.arena(parsed.arena));

	if (reader.problems.length > 0) {
		return { state: "error", path, message: "Timber cannot use these settings.", problems: reader.problems };
	}
	return { state: "read", path, values, unknown: reader.unknown };
}
