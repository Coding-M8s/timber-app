import { resolve } from "node:path";
import type { TimberStatus } from "../shared/model";
import { REQUIRED_TIMBER_VERSION, TIMBER_OVERRIDE_VARIABLE, readVersionOutput, satisfiesTimberVersion } from "../shared/timber-version";

const VERSION_TIMEOUT_MS = 5_000;

type Environment = Record<string, string | undefined>;

/**
 * Ask an executable for its version. Timber is always run as an executable
 * plus an argument array, never through a shell. Null when it cannot be run,
 * fails, takes too long, or does not print a version.
 */
async function askVersion(executable: string, environment: Environment): Promise<string | null> {
	try {
		const child = Bun.spawn([executable, "--version"], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "ignore",
			env: environment,
			timeout: VERSION_TIMEOUT_MS,
		});
		const [stdout, exitCode] = await Promise.all([new Response(child.stdout).text(), child.exited]);
		return exitCode === 0 ? readVersionOutput(stdout) : null;
	} catch {
		return null;
	}
}

/** Windows spells the variable "Path", and a copied environment is case-sensitive. */
function searchPath(environment: Environment): string {
	return environment.PATH ?? environment.Path ?? "";
}

/**
 * Find Timber and check that it is new enough.
 *
 * The override, when set, is the only candidate: a broken override is reported
 * instead of silently falling back to PATH. Reads the environment on every
 * call, so calling again picks up a Timber installed since the last look.
 */
export async function findTimber(
	environment: Environment = process.env,
	required: string = REQUIRED_TIMBER_VERSION,
): Promise<TimberStatus> {
	const override = environment[TIMBER_OVERRIDE_VARIABLE]?.trim() || null;
	const path = override ? resolve(override) : Bun.which("timber", { PATH: searchPath(environment) });
	if (!path) return { state: "not-found", override };

	const version = await askVersion(path, environment);
	if (version === null) return { state: "not-found", override };
	if (!satisfiesTimberVersion(version, required)) return { state: "too-old", path, found: version, required };
	return { state: "ready", path, version };
}

export interface TimberLocator {
	/** The latest answer. The first call looks for Timber; later calls reuse that answer. */
	current(): Promise<TimberStatus>;
	/** Look again, for example after the person installed Timber. */
	refresh(): Promise<TimberStatus>;
}

/** Remembers where Timber is, so the app looks once on start and again only when asked. */
export function createTimberLocator(find: () => Promise<TimberStatus> = () => findTimber()): TimberLocator {
	let latest: Promise<TimberStatus> | null = null;
	const refresh = () => latest = find();
	return {
		current: () => latest ?? refresh(),
		refresh,
	};
}

/** One line for the main process log. */
export function describeTimberStatus(status: TimberStatus): string {
	switch (status.state) {
		case "ready":
			return `Timber ${status.version} at ${status.path}`;
		case "too-old":
			return `Timber ${status.found} at ${status.path} is older than the required ${status.required}`;
		case "not-found":
			return status.override
				? `No Timber answered at ${status.override} (${TIMBER_OVERRIDE_VARIABLE})`
				: "Timber was not found on PATH";
	}
}
