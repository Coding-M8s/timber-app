import type { TimberFailure } from "./model";
import { SETTINGS_DRAFT_PLACEHOLDER, RESULT_FILE_PLACEHOLDER } from "./timber-result";

/**
 * Timber's own settings, read, saved, and checked through Timber's settings
 * commands for app consumers (`timber __app-config`, version 1, in
 * docs/ide-contract.md of the Timber repository). Pure: the main process runs
 * Timber (src/bun/timber-settings.ts) and hands what it printed here.
 *
 * The app never reads or writes Timber's files itself. Timber validates every
 * value, detects a change made since the read, keeps settings this app does
 * not edit (such as named workflows), and keeps credentials in its private
 * store. Credentials travel to Timber only inside a private input file, never
 * as arguments, and Timber never gives them back: the app learns only whether
 * a login is saved.
 */

/** Which of Timber's two files: the machine defaults, or one repository's. */
export const TIMBER_CONFIG_SCOPES = ["machine", "repository"] as const;
export type TimberConfigScope = typeof TIMBER_CONFIG_SCOPES[number];

/** The file a repository keeps its Timber settings in, in its primary checkout. */
export const REPOSITORY_CONFIG_FILE = ".timber.toml";

/** The arguments after `timber` that start setup for one file. Shown before it runs, and run from the same list. */
export function timberSetupArguments(scope: TimberConfigScope): string[] {
	return scope === "machine" ? ["setup", "--global"] : ["setup"];
}

/**
 * The path of Timber's machine file, found as Timber finds it: under
 * `XDG_CONFIG_HOME` when that is a full path, otherwise under `.config` in
 * the home folder. Null when no home folder is known. Only for telling
 * whether the file is there (src/bun/setup-state.ts): its contents are
 * Timber's to read.
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

/** The services Timber can look up issues in, and check a login for. */
export const INTEGRATIONS = ["github", "jira", "linear"] as const;
export type Integration = typeof INTEGRATIONS[number];

export const TRACKERS = ["github", "linear", "jira", "none"] as const;
export type Tracker = typeof TRACKERS[number];

/** The largest draft the app hands Timber. Timber refuses input files over 1 MiB. */
export const SETTINGS_INPUT_LIMIT = 512 * 1024;

/** An executable Timber may start, with its arguments. */
export interface LauncherValue {
	command: string;
	args: string[];
	/** Whether Timber starts it by itself. */
	enabled: boolean;
}
export interface EditorValue extends LauncherValue {
	integration?: "orca";
}
export interface AgentValue extends LauncherValue {
	wait_for_setup?: boolean;
}
export interface HooksValue {
	post_create: string[];
	pre_delete?: string[];
}
export interface JiraValue {
	site_url: string;
	cloud_id?: string;
}

/**
 * One scope's settings, with Timber's own names. A key left out inherits: a
 * repository from the machine defaults, the machine from Timber's built-in
 * defaults. `false` switches a table off. Keys this app does not edit, such
 * as `workflows` and `arena`, are kept exactly as Timber gave them and sent
 * back unchanged.
 */
export interface TimberValues {
	default_tracker?: Tracker;
	base_branch?: string;
	remote?: string;
	worktree_dir?: string;
	editor?: false | EditorValue;
	agent?: false | AgentValue;
	hooks?: false | HooksValue;
	jira?: false | JiraValue;
	[other: string]: unknown;
}

/** Whether a login is saved. "unreadable" is a store that failed Timber's ownership, permission, or format checks. */
export type CredentialState = "saved" | "none" | "unreadable";
export type CredentialChange = "saved" | "removed" | "unchanged";

export interface TimberCredentialStates {
	/** `configured` is false when no Jira site applies; `state` is for the login of the site that applies. */
	jira: { configured: boolean; state: CredentialState; environmentOverride: boolean };
	linear: { state: CredentialState; environmentOverride: boolean };
}

/** What `timber __app-config read` answered for one scope. Never holds a credential. */
export interface TimberSettingsSnapshot {
	scope: TimberConfigScope;
	/** The file a save to this scope writes. */
	path: string;
	exists: boolean;
	/** The repository file is tracked by Git, so a save needs the person's say-so (`--edit-tracked`). */
	tracked: boolean;
	/** Opaque token for the content read, handed back on save so a change since is refused. Null when there is no file. */
	revision: string | null;
	/** What this scope's file sets. */
	values: TimberValues;
	/** What applies after inheritance. */
	effective: TimberValues;
	credentials: TimberCredentialStates;
}

/** The scope and, for a repository, the primary checkout of a repository in the app's list. */
export interface TimberSettingsRequest {
	scope: TimberConfigScope;
	repository: string | null;
}

export type TimberSettingsReadResult =
	| { outcome: "read"; command: string; settings: TimberSettingsSnapshot }
	| { outcome: "failed"; failure: TimberFailure };

/**
 * Logins to save with the settings. A provider left out keeps its saved
 * login; null removes it. Never shown again after it is sent.
 */
export interface TimberCredentialsDraft {
	jira?: { email: string; token: string } | null;
	linear?: { token: string } | null;
}

export interface TimberSettingsSaveRequest extends TimberSettingsRequest {
	/** From the read the draft is based on. */
	revision: string | null;
	/** The whole scope as it should be saved. */
	values: TimberValues;
	credentials?: TimberCredentialsDraft;
	/** The person agreed to change a `.timber.toml` that Git tracks. */
	editTracked: boolean;
}

export type TimberSettingsSaveResult =
	| { outcome: "saved"; command: string; revision: string | null; credentials: { jira: CredentialChange; linear: CredentialChange } }
	/** `invalidFields` name each rejected field, such as "editor.command is invalid", and never a value. */
	| { outcome: "invalid"; invalidFields: string[]; failure: TimberFailure }
	/** The file, its Git state, or a credential store changed since the read. */
	| { outcome: "conflict"; failure: TimberFailure }
	/** A question setup would ask was not answered, such as changing a tracked file. */
	| { outcome: "refused"; failure: TimberFailure }
	| { outcome: "failed"; failure: TimberFailure };

export interface TimberConnectionCheckRequest extends TimberSettingsRequest {
	integration: Integration;
	/** The scope's settings as drafted, so a Jira site not yet saved is the one checked. */
	values: TimberValues;
	/** Logins typed but not saved. Without them Timber uses the saved login or the environment. */
	credentials?: TimberCredentialsDraft;
}

/** What Timber's read-only login check answered. Saves nothing. */
export interface ConnectionCheck {
	integration: Integration;
	ok: boolean;
	source: "draft" | "saved" | "environment" | "github-cli" | null;
	/** The GitHub login on success; otherwise null. */
	account: string | null;
	/** Terminal-safe failure text, never a credential. */
	diagnostic: string | null;
}

export type TimberConnectionCheckResult =
	| { outcome: "checked"; command: string; check: ConnectionCheck }
	| { outcome: "failed"; failure: TimberFailure };

/** Timber's name for a scope. */
export function timberScopeName(scope: TimberConfigScope): "global" | "repository" {
	return scope === "machine" ? "global" : "repository";
}

/** The arguments after `timber` that read one scope. */
export function settingsReadArguments(scope: TimberConfigScope): string[] {
	return ["__app-config", "read", "--scope", timberScopeName(scope)];
}

/**
 * The arguments after `timber` that save one scope. `inputFile` holds the
 * draft and any credentials; shown as `SETTINGS_DRAFT_PLACEHOLDER`.
 */
export function settingsApplyArguments(scope: TimberConfigScope, editTracked: boolean, inputFile: string, resultFile: string): string[] {
	return ["__app-config", "apply", "--scope", timberScopeName(scope), ...(editTracked ? ["--edit-tracked"] : []), "--input-file", inputFile, "--result-file", resultFile];
}

/** The arguments after `timber` that check one login against the drafted settings. */
export function connectionCheckArguments(integration: Integration, scope: TimberConfigScope, inputFile: string): string[] {
	return ["__app-config", "check", integration, "--scope", timberScopeName(scope), "--input-file", inputFile];
}

/** The save command as shown, before it runs. */
export function shownApplyArguments(scope: TimberConfigScope, editTracked: boolean): string[] {
	return settingsApplyArguments(scope, editTracked, SETTINGS_DRAFT_PLACEHOLDER, RESULT_FILE_PLACEHOLDER);
}

/** The check command as shown, before it runs. */
export function shownCheckArguments(integration: Integration, scope: TimberConfigScope): string[] {
	return connectionCheckArguments(integration, scope, SETTINGS_DRAFT_PLACEHOLDER);
}

type Table = Record<string, unknown>;

function isTable(value: unknown): value is Table {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isText = (value: unknown): value is string => typeof value === "string";
const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every(isText);
const optional = (table: Table, key: string, check: (value: unknown) => boolean) => table[key] === undefined || check(table[key]);

function isLauncher(value: unknown): value is Table {
	return isTable(value) && isText(value.command) && isTextList(value.args) && typeof value.enabled === "boolean";
}

/** Each key this app edits, with the shape Timber gives it. Other keys are kept as they are. */
const SHAPES: Record<string, (value: unknown) => boolean> = {
	default_tracker: value => TRACKERS.includes(value as Tracker),
	base_branch: isText,
	remote: isText,
	worktree_dir: isText,
	editor: value => value === false || (isLauncher(value) && optional(value, "integration", integration => integration === "orca")),
	agent: value => value === false || (isLauncher(value) && optional(value, "wait_for_setup", wait => typeof wait === "boolean")),
	hooks: value => value === false || (isTable(value) && isTextList(value.post_create) && optional(value, "pre_delete", isTextList)),
	jira: value => value === false || (isTable(value) && isText(value.site_url) && optional(value, "cloud_id", isText)),
};

/** A scope's settings as Timber gave them, or null when a key this app edits has a shape it does not know. */
export function readTimberValues(value: unknown): TimberValues | null {
	if (!isTable(value)) return null;
	for (const [key, check] of Object.entries(SHAPES)) if (value[key] !== undefined && !check(value[key])) return null;
	return structuredClone(value) as TimberValues;
}

function readCredentialState(value: unknown): CredentialState | null {
	return value === "saved" || value === "none" || value === "unreadable" ? value : null;
}

export type Reading<Value> = { ok: true; value: Value } | { ok: false; message: string };

/** What `timber __app-config read` printed, checked against the scope that was asked for. */
export function readSettingsOutput(text: string, scope: TimberConfigScope): Reading<TimberSettingsSnapshot> {
	const fail = (detail: string): Reading<TimberSettingsSnapshot> => ({ ok: false, message: `Timber answered with settings this app cannot read (${detail}). Update Timber app, or install a Timber that matches it.` });
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return fail("it is not JSON");
	}
	if (!isTable(parsed)) return fail("it is not a JSON object");
	if (parsed.schemaVersion !== 1) return fail("its schema version is not 1");
	if (parsed.scope !== timberScopeName(scope)) return fail("it is for another scope");
	const { path, exists, tracked, revision, credentials } = parsed;
	if (!isText(path) || path === "") return fail("it names no file");
	if (typeof exists !== "boolean" || typeof tracked !== "boolean") return fail("it does not say whether the file exists");
	if (revision !== null && !isText(revision)) return fail("its revision is not text");
	const values = readTimberValues(parsed.values);
	const effective = readTimberValues(parsed.effective);
	if (values === null || effective === null) return fail("a value has a shape this app does not know");
	if (!isTable(credentials) || !isTable(credentials.jira) || !isTable(credentials.linear)) return fail("it does not say which logins are saved");
	const { jira, linear } = credentials;
	const jiraState = readCredentialState(jira.state);
	const linearState = readCredentialState(linear.state);
	if (jiraState === null || linearState === null || typeof jira.configured !== "boolean"
		|| typeof jira.environmentOverride !== "boolean" || typeof linear.environmentOverride !== "boolean") {
		return fail("it does not say which logins are saved");
	}
	return {
		ok: true,
		value: {
			scope, path, exists, tracked, revision, values, effective,
			credentials: {
				jira: { configured: jira.configured, state: jiraState, environmentOverride: jira.environmentOverride },
				linear: { state: linearState, environmentOverride: linear.environmentOverride },
			},
		},
	};
}

/** The `config` part of a save's result record. */
export interface ConfigRecord {
	result: "saved" | "invalid" | "conflict" | "refused" | "failed";
	path: string | null;
	revision: string | null;
	invalidFields: string[];
	credentials: { jira: CredentialChange; linear: CredentialChange };
}

const isChange = (value: unknown): value is CredentialChange => value === "saved" || value === "removed" || value === "unchanged";

/** The `config` object of a result record for `timber __app-config apply`, or null when it is not one. */
export function readConfigRecord(value: unknown, scope: TimberConfigScope): ConfigRecord | null {
	if (!isTable(value)) return null;
	const { result, path, revision, invalidFields, credentials } = value;
	if (result !== "saved" && result !== "invalid" && result !== "conflict" && result !== "refused" && result !== "failed") return null;
	if (value.scope !== timberScopeName(scope)) return null;
	if ((path !== null && !isText(path)) || (revision !== null && !isText(revision)) || !isTextList(invalidFields)) return null;
	if (!isTable(credentials) || !isChange(credentials.jira) || !isChange(credentials.linear)) return null;
	return { result, path, revision, invalidFields: [...invalidFields], credentials: { jira: credentials.jira, linear: credentials.linear } };
}

/** What `timber __app-config check` printed, checked against the integration that was asked for. */
export function readConnectionCheck(text: string, integration: Integration): Reading<ConnectionCheck> {
	const fail = (detail: string): Reading<ConnectionCheck> => ({ ok: false, message: `Timber answered the check with something this app cannot read (${detail}).` });
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return fail("it is not JSON");
	}
	if (!isTable(parsed) || parsed.schemaVersion !== 1) return fail("it is not a version 1 check");
	if (parsed.integration !== integration) return fail("it is for another integration");
	const { ok, source, account, diagnostic } = parsed;
	if (typeof ok !== "boolean") return fail("it does not say whether the login works");
	if (source !== null && source !== "draft" && source !== "saved" && source !== "environment" && source !== "github-cli") return fail("its source is not one this app knows");
	if ((account !== null && !isText(account)) || (diagnostic !== null && !isText(diagnostic))) return fail("its text is not text");
	return { ok: true, value: { integration, ok, source, account, diagnostic } };
}

/** Whether a request from the window names a scope this app knows, and a repository only for the repository scope. */
function readScopeRequest(request: Table): string | null {
	if (!TIMBER_CONFIG_SCOPES.includes(request.scope as TimberConfigScope)) return "It names no scope this app knows.";
	if (request.scope === "repository" ? !isText(request.repository) || request.repository === "" : request.repository !== null) return "It names no repository, or one where none belongs.";
	return null;
}

function readCredentialsDraft(value: unknown): string | null {
	if (value === undefined) return null;
	if (!isTable(value)) return "Its credentials are not a table.";
	for (const key of Object.keys(value)) if (key !== "jira" && key !== "linear") return "Its credentials name a service this app does not know.";
	const { jira, linear } = value;
	if (jira !== undefined && jira !== null && !(isTable(jira) && isText(jira.email) && isText(jira.token) && Object.keys(jira).length === 2)) return "Its Jira login is not an email and a token.";
	if (linear !== undefined && linear !== null && !(isTable(linear) && isText(linear.token) && Object.keys(linear).length === 1)) return "Its Linear login is not a key.";
	return null;
}

/** Why a save request from the window cannot be used, or null when it can. Never quotes a value. */
export function checkSaveRequest(request: unknown): string | null {
	if (!isTable(request)) return "It is not a request.";
	const scope = readScopeRequest(request);
	if (scope !== null) return scope;
	if (request.revision !== null && !(isText(request.revision) && /^[a-f0-9]{64}$/.test(request.revision))) return "Its revision is not one Timber gave.";
	if (!isTable(request.values)) return "Its settings are not a table.";
	if (typeof request.editTracked !== "boolean") return "It does not say whether a tracked file may change.";
	return readCredentialsDraft(request.credentials);
}

/** Why a check request from the window cannot be used, or null when it can. Never quotes a value. */
export function checkConnectionRequest(request: unknown): string | null {
	if (!isTable(request)) return "It is not a request.";
	const scope = readScopeRequest(request);
	if (scope !== null) return scope;
	if (!INTEGRATIONS.includes(request.integration as Integration)) return "It names no integration this app knows.";
	if (!isTable(request.values)) return "Its settings are not a table.";
	return readCredentialsDraft(request.credentials);
}

/** Why a read request from the window cannot be used, or null when it can. */
export function checkReadRequest(request: unknown): string | null {
	return isTable(request) ? readScopeRequest(request) : "It is not a request.";
}

/**
 * Settings this interface never edits. Timber carries them over from the
 * file as it is at save time, so a draft leaves them out: repeating them
 * would turn a change made to them outside the app into a refused field
 * instead of a conflict.
 */
export const PRESERVED_KEYS = ["workflows", "arena"] as const;

/**
 * The input file Timber reads for a save or a check. Holds credentials when
 * given, so it is written privately and never logged.
 */
export function settingsInput(revision: string | null | undefined, values: TimberValues, credentials: TimberCredentialsDraft | undefined): string {
	const draft = Object.fromEntries(Object.entries(values).filter(([key]) => !(PRESERVED_KEYS as readonly string[]).includes(key)));
	return JSON.stringify({
		schemaVersion: 1,
		...(revision === undefined ? {} : { revision }),
		values: draft,
		...(credentials === undefined || Object.keys(credentials).length === 0 ? {} : { credentials }),
	});
}

/**
 * The field a message from Timber names, such as "hooks.post_create.1" for
 * "hooks.post_create.1 is invalid". Null when it names none.
 */
export function invalidFieldPath(message: string): string | null {
	const first = message.split(" ", 1)[0] ?? "";
	return /^[a-z_]+(\.[A-Za-z0-9_-]+)*$/.test(first) ? first : null;
}

/** The messages that name `path` or a field inside it. */
export function invalidFieldsAt(messages: readonly string[], path: string): string[] {
	return messages.filter(message => {
		const field = invalidFieldPath(message);
		return field !== null && (field === path || field.startsWith(`${path}.`));
	});
}
