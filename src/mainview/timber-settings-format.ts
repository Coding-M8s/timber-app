import type { Integration, IntegrationStatus, TimberConfigScope, TimberConfigValues, TimberLauncher } from "../shared/timber-config";

/**
 * Words for Timber's settings in the Settings dialog. Pure, so they can be
 * tested without a window. The values are already safe to show: commands
 * without their arguments, and scripts as counts (see
 * src/shared/timber-config.ts).
 */

/** One line of a file's settings. */
export interface TimberSettingRow {
	key: string;
	label: string;
	value: string;
	/** Where the value comes from: this file, the machine defaults, or Timber's own default. */
	source: "file" | "machine" | "default";
	/** Paths, commands, and branch names are set in the monospace face. */
	mono: boolean;
}

const TRACKER_NAMES: Record<string, string> = { github: "GitHub", linear: "Linear", jira: "Jira", none: "None" };

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

function launcher(value: TimberLauncher, automatic: string): string {
	const args = value.argumentCount === 0 ? "" : `, plus ${plural(value.argumentCount, "argument")}`;
	return `${value.command}${args} (${value.enabled ? automatic : "not started by itself"})`;
}

interface Field {
	key: string;
	label: string;
	mono: boolean;
	/** The words for the value a file sets, or undefined when it sets none. */
	words: (values: TimberConfigValues) => string | undefined;
}

const FIELDS: readonly Field[] = [
	{
		key: "editor",
		label: "Editor",
		mono: false,
		words: ({ editor }) => editor === undefined ? undefined : editor === false ? "Off"
			: `${launcher(editor, "opens by itself")}${editor.integration === "orca" ? ", Orca terminals" : ""}`,
	},
	{
		key: "agent",
		label: "Coding assistant",
		mono: false,
		words: ({ agent }) => agent === undefined ? undefined : agent === false ? "Off"
			: `${launcher(agent, "starts by itself")}${agent.waitForSetup ? ", waits for setup" : ""}`,
	},
	{
		key: "default_tracker",
		label: "Default issue tracker",
		mono: false,
		words: ({ defaultTracker }) => defaultTracker === undefined ? undefined : TRACKER_NAMES[defaultTracker] ?? defaultTracker,
	},
	{
		key: "hooks",
		label: "Setup scripts",
		mono: false,
		words: ({ hooks }) => hooks === undefined ? undefined : hooks === false ? "Off" : plural(hooks.setupScripts, "script"),
	},
	{
		key: "pre_delete",
		label: "Pre-done scripts",
		mono: false,
		words: ({ hooks }) => hooks === undefined || (hooks !== false && hooks.preDoneScripts === null) ? undefined
			: hooks === false ? "Off" : plural(hooks.preDoneScripts!, "script"),
	},
	{ key: "base_branch", label: "Starting branch", mono: true, words: ({ baseBranch }) => baseBranch },
	{ key: "remote", label: "Git remote", mono: true, words: ({ remote }) => remote },
	{ key: "worktree_dir", label: "Worktree folder", mono: true, words: ({ worktreeDir }) => worktreeDir },
	{
		key: "jira",
		label: "Jira site",
		mono: false,
		words: ({ jira }) => jira === undefined ? undefined : jira === false ? "Off" : `${jira.siteUrl}${jira.cloudId ? ", one cloud ID" : ""}`,
	},
	{
		key: "workflows",
		label: "Workflows",
		mono: false,
		words: ({ workflows }) => workflows === undefined ? undefined : workflows === false ? "Off"
			: workflows.length === 0 ? "None"
			: workflows.map(workflow => workflow.off ? `${workflow.name} (off)`
				: `${workflow.name} (${plural(workflow.setupScripts, "setup script")}${workflow.description ? `: ${workflow.description}` : ""})`).join("; "),
	},
	{
		key: "arena",
		label: "Arena presets",
		mono: false,
		words: ({ arena }) => arena === undefined ? undefined : arena === false ? "Off"
			: arena.length === 0 ? "None" : arena.map(preset => preset.off ? `${preset.name} (off)` : preset.name).join(", "),
	},
];

/** What Timber does when nothing sets a value, for the fields where it is worth saying. */
const DEFAULTS: Record<string, string> = {
	editor: "Not set",
	agent: "Not set",
	default_tracker: "Not set",
	hooks: "None",
	pre_delete: "None",
	base_branch: "Automatic",
	remote: "Automatic",
	worktree_dir: "A folder beside the repository",
	jira: "Not set",
	workflows: "None",
	arena: "None",
};

/**
 * The rows of one file, in Timber's own order. For a repository's file,
 * `machine` holds the machine defaults, so a value the file does not set
 * says what it falls back to. Machine values are shown only when the
 * machine file could be read.
 */
export function timberSettingRows(values: TimberConfigValues, scope: TimberConfigScope, machine: TimberConfigValues | null): TimberSettingRow[] {
	return FIELDS.map(field => {
		const own = field.words(values);
		if (own !== undefined) return { key: field.key, label: field.label, value: own, source: "file", mono: field.mono && own !== "Off" };
		const inherited = scope === "repository" && machine !== null ? field.words(machine) : undefined;
		if (inherited !== undefined) return { key: field.key, label: field.label, value: inherited, source: "machine", mono: field.mono && inherited !== "Off" };
		return { key: field.key, label: field.label, value: DEFAULTS[field.key]!, source: "default", mono: false };
	});
}

/** Where a row's value comes from, as a short note beside it. */
export function rowSourceNote(row: TimberSettingRow): string | null {
	switch (row.source) {
		case "file":
			return null;
		case "machine":
			return "From the machine defaults";
		case "default":
			return "Timber's default";
	}
}

export const INTEGRATION_LABELS: Record<Integration, string> = { github: "GitHub", jira: "Jira", linear: "Linear" };

const ENVIRONMENT_NAMES: Record<Integration, string> = {
	github: "GH_TOKEN or GITHUB_TOKEN is set",
	jira: "JIRA_EMAIL and JIRA_API_TOKEN are set",
	linear: "LINEAR_API_KEY is set",
};

/** Whether an integration is configured, and how, without anything secret. */
export function describeIntegration(integration: Integration, status: IntegrationStatus): { configured: boolean | null; text: string } {
	switch (status.state) {
		case "configured":
			if (status.source === "environment") return { configured: true, text: `Configured: ${ENVIRONMENT_NAMES[integration]} in the app's environment` };
			if (status.source === "github-cli") return { configured: true, text: "Configured: signed in with the GitHub CLI" };
			return { configured: true, text: "Configured: credentials saved by timber setup" };
		case "not-configured":
			return { configured: false, text: "Not configured" };
		case "unknown":
			return { configured: null, text: status.reason };
	}
}
