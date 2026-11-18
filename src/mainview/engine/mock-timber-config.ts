import type { Engine } from "../../shared/engine";
import type { TimberFailure, TimberStatus } from "../../shared/model";
import {
	type CredentialChange, type CredentialState, type TimberConfigScope, type TimberCredentialsDraft, type TimberSettingsSnapshot,
	type TimberValues, PRESERVED_KEYS, REPOSITORY_CONFIG_FILE, TRACKERS, checkConnectionRequest, checkReadRequest, checkSaveRequest, readTimberValues,
	settingsInput, settingsReadArguments, shownApplyArguments, shownCheckArguments,
} from "../../shared/timber-config";
import { describeTimberCommand } from "../../shared/timber-result";

/** The part of the engine about Timber's settings. */
export type TimberConfigCapabilities = Pick<Engine, "readTimberSettings" | "saveTimberSettings" | "checkTimberConnection">;

export interface TimberConfigControls {
	/**
	 * Change what one of Timber's files holds, as an edit outside the app
	 * would: "machine" for the machine defaults, or a repository's primary
	 * checkout. Null removes the file. A save based on an earlier read is then
	 * refused as a conflict.
	 */
	setTimberConfig(file: "machine" | string, values: TimberValues | null): void;
	/** Make reading one file fail with this diagnostic, as Timber does for a malformed file. Null to read it again. */
	breakTimberConfig(file: "machine" | string, diagnostic: string | null): void;
	/** Decide what checking a login answers from now on: whether it works, or null for the sample answers. */
	setConnection(ok: boolean | null): void;
}

/** Where the mock's machine settings are. */
export const MOCK_MACHINE_CONFIG = "/home/sam/.config/timber/config.toml";

/** The sample machine defaults: an agent that starts by itself, and the editor turned off. */
export const sampleMachineValues: TimberValues = {
	default_tracker: "github",
	editor: false,
	agent: { command: "claude", args: [], enabled: true },
};

/** Sample repository settings, by primary checkout. A repository not here has no `.timber.toml`. */
export const sampleRepositoryValues: Readonly<Record<string, TimberValues>> = {
	"/work/timber": {
		base_branch: "main",
		worktree_dir: "../timber-worktrees",
		hooks: { post_create: ["bun install", "bun run build"], pre_delete: ["bun run cleanup"] },
		editor: { command: "code", args: ["--new-window"], enabled: false },
		workflows: { review: { description: "Check out a pull request to review", post_create: ["gh pr checkout"] } },
		jira: { site_url: "https://example.atlassian.net" },
	},
};

/** Repositories whose `.timber.toml` the sample treats as tracked by Git. */
const TRACKED = new Set(["/work/timber"]);
/** A repository whose file the sample cannot read, as Timber cannot read a malformed one. */
const BROKEN: Readonly<Record<string, string>> = {
	"/work/billing": "Invalid TOML in /work/billing/.timber.toml",
};

const isTable = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const blank = (value: unknown) => typeof value !== "string" || value.trim() === "";

/** A few of Timber's checks, enough to act out a refused field. Timber itself checks everything. */
function invalidFields(values: Record<string, unknown>): string[] {
	const fields: string[] = [];
	for (const key of ["base_branch", "remote", "worktree_dir"]) if (key in values && blank(values[key])) fields.push(`${key} is invalid`);
	if ("default_tracker" in values && !TRACKERS.includes(values.default_tracker as never)) fields.push("default_tracker is invalid");
	for (const key of ["editor", "agent"]) {
		const launcher = values[key];
		if (isTable(launcher) && blank(launcher.command)) fields.push(`${key}.command is invalid`);
		if (isTable(launcher) && Array.isArray(launcher.args)) launcher.args.forEach((arg, index) => typeof arg !== "string" && fields.push(`${key}.args.${index} is invalid`));
	}
	const { hooks, jira } = values;
	if (isTable(hooks)) {
		for (const stage of ["post_create", "pre_delete"]) {
			const steps = hooks[stage];
			if (Array.isArray(steps)) steps.forEach((step, index) => blank(step) && fields.push(`hooks.${stage}.${index} is invalid`));
		}
	}
	if (isTable(jira) && !/^https:\/\/[a-z0-9-]+\.atlassian\.net\/?$/.test(String(jira.site_url))) fields.push("jira.site_url is invalid");
	if (isTable(jira) && jira.cloud_id !== undefined && !/^[0-9a-f-]{36}$/i.test(String(jira.cloud_id))) fields.push("jira.cloud_id is invalid");
	return fields;
}

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/**
 * Timber's settings acted out from sample data, for the browser build and
 * tests: reading, saving with a revision that a change in between makes
 * stale, a few of Timber's checks, a tracked file that needs the person's
 * say-so, and logins that are only ever said to be saved. `isListed` says
 * whether a path is a repository in the list, as the main process checks.
 * `onSaved` hears each save, so the repositories can say they are set up.
 */
export function createMockTimberConfig(
	isListed: (path: string) => boolean,
	timber: () => TimberStatus = () => ({ state: "ready", path: "/home/sam/.local/bin/timber", version: "0.1.2" }),
	onSaved: (scope: TimberConfigScope, repository: string | null) => void = () => {},
): TimberConfigCapabilities & TimberConfigControls {
	const files = new Map<string, { values: TimberValues | null; version: number }>();
	const broken = new Map<string, string | null>();
	const credentials: { jira: CredentialState; linear: CredentialState } = { jira: "none", linear: "saved" };
	let connection: boolean | null = null;

	const keyOf = (scope: TimberConfigScope, repository: string | null) => scope === "machine" ? "machine" : repository!;
	const fileOf = (key: string) => {
		let file = files.get(key);
		if (!file) {
			const sample = key === "machine" ? sampleMachineValues : sampleRepositoryValues[key] ?? null;
			file = { values: structuredClone(sample), version: 1 };
			files.set(key, file);
		}
		return file;
	};
	const pathOf = (key: string) => key === "machine" ? MOCK_MACHINE_CONFIG : `${key}/${REPOSITORY_CONFIG_FILE}`;
	const revisionOf = (key: string) => {
		const file = fileOf(key);
		return file.values === null ? null : `${file.version}`.padStart(64, "0");
	};
	const notRun = (diagnostic: string): TimberFailure => ({ command: null, diagnostic, output: null });
	const located = (scope: TimberConfigScope, repository: string | null): string | null => {
		const status = timber();
		if (status.state !== "ready") return "No usable Timber was found. Nothing was run.";
		if (scope === "repository" && !isListed(repository!)) return `${repository} is not a repository in this app's list. Nothing was run.`;
		return null;
	};
	const effectiveOf = (key: string): TimberValues => {
		const own = fileOf(key).values ?? {};
		if (key === "machine") return Object.fromEntries(Object.entries(own).filter(([, value]) => value !== false));
		const machine = fileOf("machine").values ?? {};
		return Object.fromEntries(Object.entries({ ...machine, ...own }).filter(([, value]) => value !== false));
	};
	const jiraSite = (values: TimberValues) => isTable(values.jira) ? String(values.jira.site_url) : null;

	return {
		async readTimberSettings(request) {
			const problem = checkReadRequest(request);
			if (problem !== null) return { outcome: "failed", failure: notRun(problem) };
			const refused = located(request.scope, request.repository);
			if (refused !== null) return { outcome: "failed", failure: notRun(refused) };
			const command = describeTimberCommand(settingsReadArguments(request.scope));
			const key = keyOf(request.scope, request.repository);
			const fault = broken.get(key) ?? (broken.has(key) ? null : BROKEN[key] ?? null);
			if (fault) return { outcome: "failed", failure: { command, diagnostic: fault, output: null } };
			const file = fileOf(key);
			const effective = effectiveOf(key);
			const settings: TimberSettingsSnapshot = {
				scope: request.scope,
				path: pathOf(key),
				exists: file.values !== null,
				tracked: request.scope === "repository" && TRACKED.has(key) && file.values !== null,
				revision: revisionOf(key),
				values: structuredClone(file.values ?? {}),
				effective: structuredClone(effective),
				credentials: {
					jira: { configured: jiraSite(effective) !== null, state: jiraSite(effective) === null ? "none" : credentials.jira, environmentOverride: false },
					linear: { state: credentials.linear, environmentOverride: false },
				},
			};
			return { outcome: "read", command, settings };
		},
		async saveTimberSettings(request) {
			const command = describeTimberCommand(shownApplyArguments(request.scope, request.editTracked));
			const problem = checkSaveRequest(request);
			if (problem !== null) return { outcome: "failed", failure: notRun(problem) };
			const refused = located(request.scope, request.repository);
			if (refused !== null) return { outcome: "failed", failure: notRun(refused) };
			const key = keyOf(request.scope, request.repository);
			const file = fileOf(key);
			const saved = file.values ?? {};
			// What Timber would read from the input file: the app leaves out what it does not edit.
			const sent = JSON.parse(settingsInput(request.revision, request.values, undefined)).values as Record<string, unknown>;
			const fields = invalidFields(sent);
			for (const kept of PRESERVED_KEYS) if (kept in sent && !same(sent[kept], saved[kept])) fields.push(`${kept} cannot be changed here`);
			const draft = readTimberValues(sent);
			if (draft === null && fields.length === 0) fields.push("<root> is invalid");
			const site = jiraSite(request.scope === "machine" ? request.values : { ...fileOf("machine").values, ...request.values });
			if (request.credentials?.jira && site === null) fields.push("credentials.jira needs a configured Jira site");
			if (request.credentials?.jira && (request.credentials.jira.email.trim() === "" || request.credentials.jira.token.trim() === "")) fields.push("credentials.jira is invalid");
			if (request.credentials?.linear && request.credentials.linear.token.trim() === "") fields.push("credentials.linear is invalid");
			if (fields.length > 0) {
				return { outcome: "invalid", invalidFields: fields, failure: { command, diagnostic: `Invalid settings draft: ${fields.join("; ")}. Nothing was saved.`, output: null } };
			}
			if (request.revision !== revisionOf(key)) {
				return { outcome: "conflict", failure: { command, diagnostic: `Settings at ${pathOf(key)} changed since they were read. Read them again before applying; nothing was saved.`, output: null } };
			}
			if (request.scope === "repository" && TRACKED.has(key) && file.values !== null && !request.editTracked) {
				return { outcome: "refused", failure: { command, diagnostic: `${pathOf(key)} is tracked by Git. Pass --edit-tracked to change the tracked file (the index stays unchanged), or apply to the global scope; nothing was saved.`, output: null } };
			}
			const change = (given: TimberCredentialsDraft[keyof TimberCredentialsDraft]): CredentialChange => given === undefined ? "unchanged" : given === null ? "removed" : "saved";
			const changes = { jira: change(request.credentials?.jira), linear: change(request.credentials?.linear) };
			if (changes.jira !== "unchanged") credentials.jira = changes.jira === "saved" ? "saved" : "none";
			if (changes.linear !== "unchanged") credentials.linear = changes.linear === "saved" ? "saved" : "none";
			const values = structuredClone(draft!);
			for (const kept of PRESERVED_KEYS) if (saved[kept] !== undefined) values[kept] = structuredClone(saved[kept]);
			files.set(key, { values, version: file.version + 1 });
			onSaved(request.scope, request.repository);
			return { outcome: "saved", command, revision: revisionOf(key), credentials: changes };
		},
		async checkTimberConnection(request) {
			const command = describeTimberCommand(shownCheckArguments(request.integration, request.scope));
			const problem = checkConnectionRequest(request);
			if (problem !== null) return { outcome: "failed", failure: notRun(problem) };
			const refused = located(request.scope, request.repository);
			if (refused !== null) return { outcome: "failed", failure: notRun(refused) };
			await new Promise(resolve => setTimeout(resolve, 300));
			const { integration } = request;
			const typed = integration === "jira" ? request.credentials?.jira : integration === "linear" ? request.credentials?.linear : undefined;
			const source = integration === "github" ? "github-cli" : typed ? "draft" : "saved";
			if (integration === "jira" && jiraSite(request.scope === "machine" ? request.values : { ...fileOf("machine").values, ...request.values }) === null) {
				return { outcome: "checked", command, check: { integration, ok: false, source: null, account: null, diagnostic: "Jira is not configured; add a Jira site first." } };
			}
			const ok = connection ?? (integration === "github" || integration === "linear");
			return {
				outcome: "checked",
				command,
				check: ok
					? { integration, ok, source, account: integration === "github" ? "sam" : null, diagnostic: null }
					: { integration, ok, source, account: null, diagnostic: `${integration === "jira" ? "Jira" : integration === "linear" ? "Linear" : "GitHub"} authentication failed; check the login.` },
			};
		},
		setTimberConfig(file, values) {
			const current = fileOf(file);
			files.set(file, { values: structuredClone(values), version: current.version + 1 });
		},
		breakTimberConfig(file, diagnostic) {
			broken.set(file, diagnostic);
		},
		setConnection(ok) {
			connection = ok;
		},
	};
}
