import { describeCommandLine } from "../shared/command-line";
import type { TimberFailure } from "../shared/model";
import {
	type ConnectionCheck, type Integration, type TimberConfigScope, type TimberConnectionCheckResult, type TimberCredentialStates, type TimberCredentialsDraft,
	type TimberSettingsSaveResult, type TimberValues, type Tracker, invalidFieldsAt,
} from "../shared/timber-config";

/**
 * The Timber sections of Settings as data: what each group of fields holds,
 * how a group's fields become the scope's settings, and the words around
 * them. Pure, so it can be tested without a window.
 *
 * Each group saves on its own: its fields replace only its own keys in the
 * settings as last read, and every other key, including ones this app does
 * not edit such as named workflows, goes back to Timber as it was read. The
 * same holds inside a table a group sets, such as `[agent]`: the group
 * replaces only the keys it draws, and keys such as `resolve_handoff` stay
 * as read.
 */

export const TIMBER_GROUPS = ["editor", "agent", "git", "scripts", "tracking"] as const;
export type TimberGroup = typeof TIMBER_GROUPS[number];

export const TIMBER_GROUP_TITLES: Record<TimberGroup, string> = {
	editor: "Editor",
	agent: "Coding assistant",
	git: "Branch, remote, and folder",
	scripts: "Scripts",
	tracking: "Issue tracking",
};

/** Where a table's value comes from: inherited, switched off here, or set here. */
export type Mode = "inherit" | "off" | "set";

export interface LauncherDraft {
	mode: Mode;
	command: string;
	args: string[];
	/** Timber starts it by itself when opening a workspace. */
	enabled: boolean;
	/** Editor only: setup and the assistant run in Orca terminals. */
	orca: boolean;
	/** Assistant only: wait for setup scripts first. Null leaves it unset. */
	waitForSetup: boolean | null;
}

/** Blank means not set here. */
export interface GitDraft {
	base_branch: string;
	remote: string;
	worktree_dir: string;
}

export interface ScriptsDraft {
	mode: Mode;
	setup: string[];
	preDone: string[];
	/** Whether the file sets `pre_delete`, so an empty list is kept as written. */
	preDoneSet: boolean;
}

/** Where Jira's current sprint comes from: a Scrum board's active sprint, a JQL query, or not set. Never both. */
export type SprintSource = "none" | "board" | "jql";

/**
 * Logins are typed only to save or check them, never filled in from what is
 * saved. The sprint and scope fields are text as typed: blank means not set.
 */
export interface TrackingDraft {
	tracker: Tracker | "";
	jiraMode: Mode;
	siteUrl: string;
	cloudId: string;
	sprintSource: SprintSource;
	board: string;
	sprintJql: string;
	jiraProject: string;
	githubProject: string;
	githubMilestone: string;
	linearTeam: string;
	jiraEmail: string;
	jiraToken: string;
	removeJira: boolean;
	linearKey: string;
	removeLinear: boolean;
}

export interface GroupDrafts {
	editor: LauncherDraft;
	agent: LauncherDraft;
	git: GitDraft;
	scripts: ScriptsDraft;
	tracking: TrackingDraft;
}

/** The keys of the settings each group writes. */
export const GROUP_KEYS: Record<TimberGroup, readonly string[]> = {
	editor: ["editor"],
	agent: ["agent"],
	git: ["base_branch", "remote", "worktree_dir"],
	scripts: ["hooks"],
	tracking: ["default_tracker", "jira", "github", "linear"],
};

function launcherDraft(value: TimberValues["editor"] | TimberValues["agent"]): LauncherDraft {
	if (value === undefined || value === false) {
		return { mode: value === false ? "off" : "inherit", command: "", args: [], enabled: false, orca: false, waitForSetup: null };
	}
	return {
		mode: "set",
		command: value.command,
		args: [...value.args],
		enabled: value.enabled,
		orca: "integration" in value && value.integration === "orca",
		waitForSetup: "wait_for_setup" in value && typeof value.wait_for_setup === "boolean" ? value.wait_for_setup : null,
	};
}

/** The Jira fields of a `[jira]` table as read: the site, the sprint source, and the project. */
function jiraFields(jira: TimberValues["jira"]): Pick<TrackingDraft, "siteUrl" | "cloudId" | "sprintSource" | "board" | "sprintJql" | "jiraProject"> {
	const table = jira || null;
	// A board wins over JQL: Timber refuses to read a file that sets both, so it never comes to that.
	const sprintSource: SprintSource = table?.board !== undefined ? "board" : table?.sprint_jql !== undefined ? "jql" : "none";
	return {
		siteUrl: table?.site_url ?? "",
		cloudId: table?.cloud_id ?? "",
		sprintSource,
		board: table?.board !== undefined ? String(table.board) : "",
		sprintJql: table?.sprint_jql ?? "",
		jiraProject: table?.project ?? "",
	};
}

/** Each group's fields as the settings that were read have them. */
export function draftsOf(values: TimberValues): GroupDrafts {
	const { hooks, jira, github, linear } = values;
	return {
		editor: launcherDraft(values.editor),
		agent: launcherDraft(values.agent),
		git: { base_branch: values.base_branch ?? "", remote: values.remote ?? "", worktree_dir: values.worktree_dir ?? "" },
		scripts: hooks === undefined || hooks === false
			? { mode: hooks === false ? "off" : "inherit", setup: [], preDone: [], preDoneSet: false }
			: { mode: "set", setup: [...hooks.post_create], preDone: [...(hooks.pre_delete ?? [])], preDoneSet: hooks.pre_delete !== undefined },
		tracking: {
			tracker: values.default_tracker ?? "",
			jiraMode: jira === undefined ? "inherit" : jira === false ? "off" : "set",
			...jiraFields(jira),
			githubProject: github ? github.project ?? "" : "",
			githubMilestone: github ? github.milestone ?? "" : "",
			linearTeam: linear ? linear.team ?? "" : "",
			jiraEmail: "",
			jiraToken: "",
			removeJira: false,
			linearKey: "",
			removeLinear: false,
		},
	};
}

/** The fields each group draws, by the path Timber names them with. Messages about other paths show for the whole group. */
export const DRAWN_PATHS: Record<TimberGroup, readonly string[]> = {
	editor: ["editor.command", "editor.args", "editor.enabled", "editor.integration"],
	agent: ["agent.command", "agent.args", "agent.enabled", "agent.wait_for_setup"],
	git: ["base_branch", "remote", "worktree_dir"],
	scripts: ["hooks.post_create", "hooks.pre_delete"],
	tracking: [
		"default_tracker", "jira.site_url", "jira.cloud_id", "jira.board", "jira.sprint_jql", "jira.project",
		"github.project", "github.milestone", "linear.team", "credentials.jira", "credentials.linear",
	],
};

/** Set or remove one key, leaving every other as it was. */
function put(values: TimberValues, key: string, value: unknown): void {
	if (value === undefined) delete values[key];
	else values[key] = value;
}

/**
 * A table as a group saves it: left out to inherit, false when off, and when
 * set, the table as read with the keys the group draws in place. A drawn key
 * that is undefined is removed; every key the group does not draw is kept.
 */
function tableValue(mode: Mode, read: unknown, drawn: Record<string, unknown>): unknown {
	if (mode === "inherit") return undefined;
	if (mode === "off") return false;
	const table: Record<string, unknown> = typeof read === "object" && read !== null && !Array.isArray(read) ? { ...read } : {};
	for (const [key, value] of Object.entries(drawn)) {
		if (value === undefined) delete table[key];
		else table[key] = value;
	}
	return table;
}

/** Text as typed without the spaces around it, or undefined when it is blank. Timber decides what it accepts. */
const typed = (text: string): string | undefined => text.trim() === "" ? undefined : text.trim();

/** A board number as Timber takes it, or the text as typed so Timber can refuse it at the field. */
function boardValue(text: string): number | string | undefined {
	const trimmed = text.trim();
	if (trimmed === "") return undefined;
	// A number past what JSON keeps exactly goes as text, so Timber refuses it rather than saving another board.
	return /^\d+$/.test(trimmed) && Number.isSafeInteger(Number(trimmed)) ? Number(trimmed) : text;
}

/**
 * A tracker scope table that has no Off or Inherit choice, such as
 * `[github]`: left as read while every field is blank and the table as read
 * sets none of them (absent, `false`, or empty, which still shadows the
 * machine's), otherwise the table as read with the fields in place, and
 * removed once that leaves it empty, so the machine's applies again.
 */
function scopeTableValue(read: unknown, drawn: Record<string, string | undefined>): unknown {
	const readTable = typeof read === "object" && read !== null && !Array.isArray(read) ? read as Record<string, unknown> : null;
	const readSetsOne = readTable !== null && Object.keys(drawn).some(key => readTable[key] !== undefined);
	if (Object.values(drawn).every(value => value === undefined) && !readSetsOne) return read;
	const table = tableValue("set", read, drawn) as Record<string, unknown>;
	return Object.keys(table).length === 0 ? undefined : table;
}

function launcherValue(draft: LauncherDraft, kind: "editor" | "agent", read: unknown): unknown {
	const common = { command: draft.command, args: [...draft.args], enabled: draft.enabled };
	return tableValue(draft.mode, read, kind === "editor"
		? { ...common, integration: draft.orca ? "orca" : undefined }
		: { ...common, wait_for_setup: draft.waitForSetup ?? undefined });
}

/**
 * The scope's settings with one group's fields in place of its keys. Every
 * other key is kept as it was read, and so is every key the group does not
 * draw inside a table it sets. Values are passed as typed: Timber decides
 * what is valid.
 */
export function valuesWith<Group extends TimberGroup>(group: Group, draft: GroupDrafts[Group], values: TimberValues): TimberValues {
	const next = structuredClone(values);
	switch (group) {
		case "editor":
		case "agent":
			put(next, group, launcherValue(draft as LauncherDraft, group, next[group]));
			break;
		case "git": {
			const git = draft as GitDraft;
			for (const key of GROUP_KEYS.git) put(next, key, git[key as keyof GitDraft] === "" ? undefined : git[key as keyof GitDraft]);
			break;
		}
		case "scripts": {
			const scripts = draft as ScriptsDraft;
			put(next, "hooks", tableValue(scripts.mode, next.hooks, {
				post_create: [...scripts.setup],
				pre_delete: scripts.preDone.length > 0 || scripts.preDoneSet ? [...scripts.preDone] : undefined,
			}));
			break;
		}
		case "tracking": {
			const tracking = draft as TrackingDraft;
			put(next, "default_tracker", tracking.tracker === "" ? undefined : tracking.tracker);
			put(next, "jira", tableValue(tracking.jiraMode, next.jira, {
				site_url: tracking.siteUrl,
				cloud_id: tracking.cloudId === "" ? undefined : tracking.cloudId,
				// Only the chosen source is drawn, so the app never saves both.
				board: tracking.sprintSource === "board" ? boardValue(tracking.board) : undefined,
				sprint_jql: tracking.sprintSource === "jql" ? typed(tracking.sprintJql) : undefined,
				project: typed(tracking.jiraProject),
			}));
			put(next, "github", scopeTableValue(next.github, { project: typed(tracking.githubProject), milestone: typed(tracking.githubMilestone) }));
			put(next, "linear", scopeTableValue(next.linear, { team: typed(tracking.linearTeam) }));
			break;
		}
	}
	return next;
}

/** The scope's settings with every group's fields in place of its keys, for one save of them all. Other keys are kept as read. */
export function valuesWithAll(drafts: GroupDrafts, values: TimberValues): TimberValues {
	return TIMBER_GROUPS.reduce((next, group) => valuesWith(group, drafts[group], next), values);
}

/**
 * The logins to save with the issue tracking group: what was typed, or null
 * to remove a saved one. Undefined when nothing changes.
 */
export function credentialsToSave(draft: TrackingDraft): TimberCredentialsDraft | undefined {
	const credentials: TimberCredentialsDraft = {};
	if (draft.removeJira) credentials.jira = null;
	else if (draft.jiraEmail !== "" || draft.jiraToken !== "") credentials.jira = { email: draft.jiraEmail, token: draft.jiraToken };
	if (draft.removeLinear) credentials.linear = null;
	else if (draft.linearKey !== "") credentials.linear = { token: draft.linearKey };
	return Object.keys(credentials).length === 0 ? undefined : credentials;
}

/** The logins typed for one service, to check them before saving. A removal is not something to check. */
export function credentialsToCheck(draft: TrackingDraft, integration: Integration): TimberCredentialsDraft | undefined {
	if (integration === "jira" && !draft.removeJira && (draft.jiraEmail !== "" || draft.jiraToken !== "")) return { jira: { email: draft.jiraEmail, token: draft.jiraToken } };
	if (integration === "linear" && !draft.removeLinear && draft.linearKey !== "") return { linear: { token: draft.linearKey } };
	return undefined;
}

/** Key order is not meaning: Timber writes its own order. */
function sameValue(left: unknown, right: unknown): boolean {
	if (Array.isArray(left) || Array.isArray(right)) {
		return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((item, index) => sameValue(item, right[index]));
	}
	if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) {
		const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
		return [...keys].every(key => sameValue((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
	}
	return left === right;
}

/** Whether saving the group would change anything. */
export function groupChanged<Group extends TimberGroup>(group: Group, draft: GroupDrafts[Group], values: TimberValues): boolean {
	if (group === "tracking" && credentialsToSave(draft as TrackingDraft) !== undefined) return true;
	return !sameValue(valuesWith(group, draft, values), values);
}

/** Timber's messages about the fields a group draws, so they show at the field. Others show for the whole group. */
export function groupMessages(messages: readonly string[], paths: readonly string[]): { at: (path: string) => string[]; rest: string[] } {
	return {
		at: path => invalidFieldsAt(messages, path),
		rest: messages.filter(message => !paths.some(path => invalidFieldsAt([message], path).length > 0)),
	};
}

/** A message from Timber in plain words for beside its field, such as "is invalid" for "editor.command is invalid". */
export function fieldMessage(message: string): string {
	const space = message.indexOf(" ");
	const rest = space === -1 ? message : message.slice(space + 1);
	return rest === "is invalid" ? "Timber does not accept this value." : `Timber: ${rest}.`;
}

/** What an inherited choice is called in each scope. */
export function inheritLabel(scope: TimberConfigScope): string {
	return scope === "repository" ? "Use the machine default" : "Not set";
}

const TRACKER_NAMES: Record<Tracker, string> = { github: "GitHub", linear: "Linear", jira: "Jira", none: "None" };
export const TRACKER_CHOICES: readonly { value: Tracker; label: string }[] = (["github", "linear", "jira", "none"] as const).map(value => ({ value, label: TRACKER_NAMES[value] }));

export interface LauncherPreset {
	label: string;
	command: string;
	args: string[];
	orca?: boolean;
}

/** The presets of `timber setup`. Each fills the fields, which stay editable. */
export const EDITOR_PRESETS: readonly LauncherPreset[] = [
	{ label: "VS Code", command: "code", args: ["--new-window"] },
	{ label: "Zed", command: "zed", args: ["--new"] },
	{ label: "Orca", command: "orca-ide", args: [], orca: true },
];
export const AGENT_PRESETS: readonly LauncherPreset[] = [
	{ label: "Claude", command: "claude", args: [] },
	{ label: "Codex", command: "codex", args: [] },
];

/** A preset in place of the launcher's command, keeping whether it starts by itself. */
export function withPreset(draft: LauncherDraft, preset: LauncherPreset): LauncherDraft {
	return { ...draft, mode: "set", command: preset.command, args: [...preset.args], orca: preset.orca === true };
}

/** A launcher as one line, such as "code --new-window (opens by itself)". */
function describeLauncher(value: TimberValues["editor"] | TimberValues["agent"], automatic: string): string | null {
	if (value === undefined) return null;
	if (value === false) return "Off";
	return `${describeCommandLine([value.command, ...value.args])} (${value.enabled ? automatic : "not started by itself"})`;
}

const plural = (count: number, one: string) => `${count} ${one}${count === 1 ? "" : "s"}`;

/**
 * What a repository falls back to for a group, from the machine defaults,
 * when it sets nothing of its own. Null when the machine sets nothing either.
 */
export function machineDefault(group: TimberGroup, machine: TimberValues): string | null {
	switch (group) {
		case "editor":
			return describeLauncher(machine.editor, "opens by itself");
		case "agent":
			return describeLauncher(machine.agent, "starts by itself");
		case "scripts": {
			const { hooks } = machine;
			if (hooks === undefined) return null;
			if (hooks === false) return "Off";
			return `${plural(hooks.post_create.length, "setup script")}, ${plural(hooks.pre_delete?.length ?? 0, "pre-done script")}`;
		}
		case "git":
		case "tracking":
			return null;
	}
}

/** The fallback for one plain value, shown as the placeholder of its field. */
export function placeholderFor(key: "base_branch" | "remote" | "worktree_dir", scope: TimberConfigScope, machine: TimberValues | null): string {
	const inherited = scope === "repository" ? machine?.[key] : undefined;
	if (inherited !== undefined) return `${inherited} (machine default)`;
	return key === "worktree_dir" ? "Automatic: <repository>-worktrees beside the repository" : "Automatic";
}

export function trackerPlaceholder(scope: TimberConfigScope, machine: TimberValues | null): string {
	const inherited = scope === "repository" ? machine?.default_tracker : undefined;
	return inherited !== undefined ? `${inheritLabel(scope)}: ${TRACKER_NAMES[inherited]}` : inheritLabel(scope);
}

/** A `[jira]` table's sprint source and project in words, such as "board 12, project TIM". */
export function describeJiraSprint(jira: { board?: number | string | undefined; sprint_jql?: string | undefined; project?: string | undefined }): string[] {
	return [
		jira.board !== undefined ? `board ${jira.board}` : jira.sprint_jql !== undefined ? "sprint from JQL" : null,
		jira.project !== undefined ? `project ${jira.project}` : null,
	].filter(part => part !== null);
}

export function jiraDefault(scope: TimberConfigScope, machine: TimberValues | null): string | null {
	if (scope !== "repository" || machine === null || machine.jira === undefined) return null;
	return machine.jira === false ? "Off" : [machine.jira.site_url, ...describeJiraSprint(machine.jira)].join(", ");
}

/**
 * The tracking fields after a new choice of where Jira comes from. A
 * repository's own `[jira]` replaces the machine's whole, site included, so
 * choosing "This site" with nothing typed starts from the machine's site,
 * sprint source, and project, to change from there.
 */
export function withJiraMode(draft: TrackingDraft, jiraMode: Mode, scope: TimberConfigScope, machine: TimberValues | null): TrackingDraft {
	const startFromMachine = jiraMode === "set" && scope === "repository" && draft.siteUrl.trim() === "" && typeof machine?.jira === "object";
	return startFromMachine ? { ...draft, jiraMode, ...jiraFields(machine!.jira) } : { ...draft, jiraMode };
}

/**
 * The fallback of a GitHub or Linear field, shown as its placeholder. A
 * repository inherits the machine's table only while it sets none of the
 * table's fields and its file has no such table of its own: one field set
 * here, or a table written by hand (`false`, or empty), replaces the
 * machine's table whole.
 */
export function scopePlaceholder(
	table: "github" | "linear",
	key: "project" | "milestone" | "team",
	draft: TrackingDraft,
	scope: TimberConfigScope,
	machine: TimberValues | null,
	values: TimberValues,
): string {
	const own = table === "github" ? [draft.githubProject, draft.githubMilestone] : [draft.linearTeam];
	const inherits = scope === "repository" && values[table] === undefined && own.every(text => text.trim() === "");
	const machineTable = inherits ? machine?.[table] : undefined;
	const inherited = typeof machineTable === "object" ? (machineTable as Record<string, unknown>)[key] : undefined;
	return typeof inherited === "string" ? `${inherited} (machine default)` : "Not set";
}

const STATE_WORDS: Record<TimberCredentialStates["linear"]["state"], string> = {
	saved: "A login is saved.",
	none: "No login is saved.",
	unreadable: "Timber's login store failed its checks (owner, permissions, or format), so it cannot tell. Fix or remove it before saving a login.",
};

/** What is saved for Jira, without anything secret. */
export function describeJiraLogin(states: TimberCredentialStates): string {
	const { jira } = states;
	const saved = jira.configured ? STATE_WORDS[jira.state].replace("A login is saved.", "A login is saved for this Jira site.") : "Add a Jira site to save a login for it.";
	return jira.environmentOverride ? `${saved} JIRA_EMAIL or JIRA_API_TOKEN is set for the app, and replaces the saved login when Timber runs.` : saved;
}

/** What is saved for Linear, without anything secret. */
export function describeLinearLogin(states: TimberCredentialStates): string {
	const saved = STATE_WORDS[states.linear.state];
	return states.linear.environmentOverride ? `${saved} LINEAR_API_KEY is set for the app, and replaces the saved key when Timber runs.` : saved;
}

export const INTEGRATION_LABELS: Record<Integration, string> = { github: "GitHub", jira: "Jira", linear: "Linear" };

const SOURCE_WORDS: Record<NonNullable<ConnectionCheck["source"]>, string> = {
	draft: "the login typed here",
	saved: "the saved login",
	environment: "the login from the app's environment",
	"github-cli": "the GitHub CLI login",
};

/** What a check found, in words. Never holds a credential: Timber's diagnostic is free of them. */
export function describeCheck(check: ConnectionCheck): string {
	const label = INTEGRATION_LABELS[check.integration];
	const source = check.source === null ? "" : ` with ${SOURCE_WORDS[check.source]}`;
	if (check.ok) return `${label} accepted${source}${check.account ? `, signed in as ${check.account}` : ""}. Nothing was saved.`;
	return `${label} did not accept${source}: ${check.diagnostic ?? "no reason was given."} Nothing was saved.`;
}

/** Where saving one group stands. A failure keeps what was typed on screen, so it can be saved again. */
export type GroupOutcome =
	| { state: "idle" }
	| { state: "saving" }
	| { state: "saved" }
	| { state: "invalid"; fields: string[]; failure: TimberFailure }
	| { state: "conflict"; failure: TimberFailure }
	| { state: "refused"; failure: TimberFailure }
	| { state: "failed"; failure: TimberFailure };

export type CheckOutcome = { state: "checking" } | { state: "done"; result: TimberConnectionCheckResult };

export const IDLE_OUTCOME: GroupOutcome = { state: "idle" };

/** What Timber's answer to a save leaves on screen. */
export function outcomeOfSave(answer: TimberSettingsSaveResult): GroupOutcome {
	switch (answer.outcome) {
		case "saved":
			return { state: "saved" };
		case "invalid":
			return { state: "invalid", fields: answer.invalidFields, failure: answer.failure };
		default:
			return { state: answer.outcome, failure: answer.failure };
	}
}

/** Whether typing puts a past outcome away: all but Timber's field messages and a conflict, which still need answering, and a save still running. */
export function typingPutsAway(outcome: GroupOutcome): boolean {
	return outcome.state !== "invalid" && outcome.state !== "conflict" && outcome.state !== "saving";
}
