import { lstat, open } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
	type IntegrationStatus, type IntegrationStatuses, type TimberConfigFile, type TimberSettings, REPOSITORY_CONFIG_FILE, TIMBER_CONFIG_SIZE_LIMIT,
	machineConfigPath, readTimberConfig,
} from "../shared/timber-config";

type Environment = Record<string, string | undefined>;

/** How long `gh auth status` may take before the answer counts as unknown. */
const GITHUB_CHECK_MILLISECONDS = 10_000;

function errorCode(error: unknown): string | null {
	return typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" ? error.code : null;
}

/** Words for a file that could not be read, by the system's error code. Never the file's contents. */
function unreadable(code: string | null): string {
	switch (code) {
		case "EACCES":
		case "EPERM":
			return "The app is not allowed to read it.";
		case "EISDIR":
			return "It is a folder, not a file.";
		default:
			return `It could not be read${code ? ` (${code})` : ""}.`;
	}
}

/**
 * One of Timber's files, read from disk without changing anything. A file
 * that is not there is "missing", never empty defaults. A file that cannot
 * be read, is too large, or is not text is an error that says why.
 */
export async function readTimberConfigFile(path: string): Promise<TimberConfigFile> {
	let handle;
	try {
		handle = await open(path, "r");
	} catch (error) {
		const code = errorCode(error);
		if (code === "ENOENT" || code === "ENOTDIR") return { state: "missing", path };
		return { state: "error", path, message: unreadable(code), problems: [] };
	}
	try {
		const info = await handle.stat();
		if (!info.isFile()) return { state: "error", path, message: info.isDirectory() ? unreadable("EISDIR") : "It is not a regular file.", problems: [] };
		if (info.size > TIMBER_CONFIG_SIZE_LIMIT) return { state: "error", path, message: `It is larger than ${TIMBER_CONFIG_SIZE_LIMIT / 1024} KiB, which is too large for settings.`, problems: [] };
		const bytes = await handle.readFile();
		let source: string;
		try {
			source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
		} catch {
			return { state: "error", path, message: "It is not UTF-8 text.", problems: [] };
		}
		return readTimberConfig(path, source, text => Bun.TOML.parse(text));
	} catch (error) {
		return { state: "error", path, message: unreadable(errorCode(error)), problems: [] };
	} finally {
		await handle.close().catch(() => {});
	}
}

export interface TimberConfigDependencies {
	/** Whether a path is the primary checkout of a repository in the app's list. */
	isListed: (path: string) => Promise<boolean>;
	/** The environment the app was started with. */
	environment?: Environment;
	platform?: NodeJS.Platform;
	home?: string | null;
	/** Runs `gh auth status` and answers its exit code. Tests pass their own. */
	githubStatus?: (gh: string, environment: Environment) => Promise<number>;
}

export interface TimberConfigReader {
	/** The machine file, and the repository's when its primary checkout is given. Read-only. */
	read(repository: string | null): Promise<TimberSettings>;
	/** Whether Timber can reach each service, found without reading a secret. Read-only. */
	integrations(): Promise<IntegrationStatuses>;
}

/** Whether something is at a path, without opening it. Only for credential files: they are never read. */
async function exists(path: string): Promise<boolean> {
	try {
		return (await lstat(path)).isFile();
	} catch {
		return false;
	}
}

const isSet = (environment: Environment, name: string) => (environment[name] ?? "").trim() !== "";

/**
 * Ask the GitHub CLI whether it is signed in to github.com. Only the exit
 * code is used: what it prints is never read, never kept, and never logged.
 */
async function runGithubStatus(gh: string, environment: Environment): Promise<number> {
	const child = Bun.spawn([gh, "auth", "status", "--hostname", "github.com"], {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
		env: { ...environment, GH_PROMPT_DISABLED: "1", GH_PAGER: "", PAGER: "", GH_DEBUG: "", DEBUG: "" },
		timeout: GITHUB_CHECK_MILLISECONDS,
	});
	return await child.exited;
}

/**
 * Timber's settings as the Settings dialog shows them. Only reads: nothing
 * here writes a file, and credentials are never opened.
 */
export function createTimberConfigReader(dependencies: TimberConfigDependencies): TimberConfigReader {
	const { isListed, environment = process.env, platform = process.platform, home = safeHome(), githubStatus = runGithubStatus } = dependencies;
	const machinePath = () => machineConfigPath(environment, platform, home);

	async function machine(): Promise<TimberConfigFile> {
		const path = machinePath();
		if (path === null) return { state: "error", path: "config.toml", message: "No home folder is known, so Timber's machine settings cannot be found.", problems: [] };
		return readTimberConfigFile(path);
	}

	async function repository(path: string): Promise<TimberConfigFile> {
		const file = join(path, REPOSITORY_CONFIG_FILE);
		let listed: boolean;
		try {
			listed = await isListed(path);
		} catch {
			listed = false;
		}
		if (!listed) return { state: "error", path: file, message: `${path} is not a repository in this app's list.`, problems: [] };
		return readTimberConfigFile(file);
	}

	async function savedCredentials(name: string): Promise<boolean> {
		const path = machinePath();
		return path !== null && exists(join(dirname(path), "credentials", name));
	}

	async function github(): Promise<IntegrationStatus> {
		if (isSet(environment, "GH_TOKEN") || isSet(environment, "GITHUB_TOKEN")) return { state: "configured", source: "environment" };
		const gh = Bun.which("gh", { PATH: environment.PATH ?? "" });
		if (gh === null) return { state: "unknown", reason: "The GitHub CLI (gh) is not on the PATH the app was started with." };
		try {
			const code = await githubStatus(gh, environment);
			return code === 0 ? { state: "configured", source: "github-cli" } : { state: "not-configured" };
		} catch {
			return { state: "unknown", reason: "The GitHub CLI did not answer." };
		}
	}

	async function jira(): Promise<IntegrationStatus> {
		if (isSet(environment, "JIRA_EMAIL") && isSet(environment, "JIRA_API_TOKEN")) return { state: "configured", source: "environment" };
		return await savedCredentials("jira.json") ? { state: "configured", source: "saved" } : { state: "not-configured" };
	}

	async function linear(): Promise<IntegrationStatus> {
		if (isSet(environment, "LINEAR_API_KEY")) return { state: "configured", source: "environment" };
		return await savedCredentials("linear.json") ? { state: "configured", source: "saved" } : { state: "not-configured" };
	}

	return {
		async read(path) {
			const [machineFile, repositoryFile] = await Promise.all([machine(), path === null ? null : repository(path)]);
			return { machine: machineFile, repository: repositoryFile };
		},
		async integrations() {
			const [githubStatusNow, jiraStatus, linearStatus] = await Promise.all([github(), jira(), linear()]);
			return { github: githubStatusNow, jira: jiraStatus, linear: linearStatus };
		},
	};
}

function safeHome(): string | null {
	try {
		return homedir() || null;
	} catch {
		return null;
	}
}
