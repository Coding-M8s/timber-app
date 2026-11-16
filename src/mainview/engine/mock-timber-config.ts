import type { Engine } from "../../shared/engine";
import { type IntegrationStatuses, type TimberConfigFile, REPOSITORY_CONFIG_FILE } from "../../shared/timber-config";

/** The part of the engine about Timber's settings. */
export type TimberConfigCapabilities = Pick<Engine, "readTimberSettings" | "readTimberIntegrations">;

export interface TimberConfigControls {
	/**
	 * Decide what one of Timber's files holds from now on: "machine" for the
	 * machine defaults, or a repository's primary checkout for its
	 * `.timber.toml`. Pass null to go back to the sample.
	 */
	setTimberConfig(file: "machine" | string, read: TimberConfigFile | null): void;
	/** Decide what the integrations answer from now on, or null for the sample. */
	setIntegrations(statuses: IntegrationStatuses | null): void;
}

/** Where the mock's machine settings are. */
export const MOCK_MACHINE_CONFIG = "/home/sam/.config/timber/config.toml";

/** The sample machine defaults: an agent that starts by itself, and the editor turned off. */
export const sampleMachineConfig: TimberConfigFile = {
	state: "read",
	path: MOCK_MACHINE_CONFIG,
	values: {
		editor: false,
		agent: { command: "claude", argumentCount: 0, enabled: true, waitForSetup: null },
		defaultTracker: "github",
	},
	unknown: [],
};

/** Sample repository settings, by primary checkout. A repository not here has no `.timber.toml`. */
export const sampleRepositoryConfigs: Readonly<Record<string, TimberConfigFile>> = {
	"/work/timber": {
		state: "read",
		path: `/work/timber/${REPOSITORY_CONFIG_FILE}`,
		values: {
			baseBranch: "main",
			worktreeDir: "../timber-worktrees",
			hooks: { setupScripts: 2, preDoneScripts: 1 },
			editor: { command: "code", argumentCount: 1, enabled: false, integration: null },
			workflows: [{ name: "review", off: false, description: "Check out a pull request to review", setupScripts: 1 }],
			jira: { siteUrl: "https://example.atlassian.net", cloudId: false },
		},
		unknown: [],
	},
	"/work/billing": {
		state: "error",
		path: `/work/billing/${REPOSITORY_CONFIG_FILE}`,
		message: "It is not valid TOML. Timber reports where when it reads the file, for example in timber setup.",
		problems: [],
	},
};

export const sampleIntegrations: IntegrationStatuses = {
	github: { state: "configured", source: "github-cli" },
	jira: { state: "not-configured" },
	linear: { state: "configured", source: "environment" },
};

/**
 * Timber's settings acted out from sample data, for the browser build and
 * tests. `isListed` says whether a path is a repository in the list, as the
 * main process checks.
 */
export function createMockTimberConfig(isListed: (path: string) => boolean): TimberConfigCapabilities & TimberConfigControls {
	let machine: TimberConfigFile | null = null;
	const repositories = new Map<string, TimberConfigFile | null>();
	let integrations: IntegrationStatuses | null = null;

	const repositoryFile = (path: string): TimberConfigFile => {
		const file = `${path}/${REPOSITORY_CONFIG_FILE}`;
		if (!isListed(path)) return { state: "error", path: file, message: `${path} is not a repository in this app's list.`, problems: [] };
		const chosen = repositories.get(path);
		return chosen ?? sampleRepositoryConfigs[path] ?? { state: "missing", path: file };
	};

	return {
		async readTimberSettings(repository) {
			return structuredClone({ machine: machine ?? sampleMachineConfig, repository: repository === null ? null : repositoryFile(repository) });
		},
		readTimberIntegrations: async () => structuredClone(integrations ?? sampleIntegrations),
		setTimberConfig(file, read) {
			if (file === "machine") machine = structuredClone(read);
			else repositories.set(file, structuredClone(read));
		},
		setIntegrations(statuses) {
			integrations = structuredClone(statuses);
		},
	};
}
