import { join, resolve } from "node:path";
import type { TimberSource, TimberStatus } from "../shared/model";
import type { TimberChoice } from "../shared/timber-choice";
import { timberExecutableName, timberTarget } from "../shared/timber-pin";
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

/** The Timber the app will ask: where it came from, and its path, or null when there is no timber on PATH. */
export interface TimberCandidate {
	source: TimberSource;
	path: string | null;
}

/**
 * The folder the build puts the bundled Timber in, `timber` beside the main
 * process's `bun` folder inside the installed app (see electrobun.config.ts).
 */
export function bundledTimberFolder(): string {
	return join(import.meta.dir, "..", "timber");
}

/**
 * The Timber that comes with the app, or null on a platform it ships none
 * for, or when it is not there, as in a development build that never
 * fetched it. Only checks that it is an executable file; nothing runs.
 */
export function findBundledTimber(folder: string = bundledTimberFolder(), platform: string = process.platform, arch: string = process.arch): string | null {
	const target = timberTarget(platform, arch);
	if (target === null) return null;
	return Bun.which(join(folder, timberExecutableName(target)));
}

/**
 * Which Timber to ask. The development override comes first, then the
 * person's choice. A file named by either is the only candidate: a broken one
 * is reported instead of silently falling back to PATH. The bundled choice
 * falls back to PATH only when the app ships no Timber here. Reads the
 * environment on every call, so calling again picks up a Timber installed
 * since the last look.
 */
export function chooseTimber(environment: Environment, choice: TimberChoice = { kind: "path" }, bundled: string | null = null): TimberCandidate {
	const override = environment[TIMBER_OVERRIDE_VARIABLE]?.trim() || null;
	if (override) return { source: "override", path: resolve(override) };
	if (choice.kind === "file") return { source: "setting", path: choice.path };
	if (choice.kind === "bundled" && bundled !== null) return { source: "bundled", path: bundled };
	return { source: "path", path: Bun.which("timber", { PATH: searchPath(environment) }) };
}

/** Ask a candidate for its version, and check that it is at least `required`. */
export async function checkTimber(candidate: TimberCandidate, environment: Environment, required: string = REQUIRED_TIMBER_VERSION): Promise<TimberStatus> {
	const { source, path } = candidate;
	if (path === null) return { state: "not-found", source, path };
	const version = await askVersion(path, environment);
	if (version === null) return { state: "not-found", source, path };
	if (!satisfiesTimberVersion(version, required)) return { state: "too-old", source, path, found: version, required };
	return { state: "ready", source, path, version };
}

/** Find Timber as `chooseTimber` picks it, and check that it is new enough. */
export async function findTimber(
	environment: Environment = process.env,
	required: string = REQUIRED_TIMBER_VERSION,
	choice?: TimberChoice,
	bundled?: string | null,
): Promise<TimberStatus> {
	return checkTimber(chooseTimber(environment, choice, bundled), environment, required);
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

/** Where a Timber came from, as the log and About say it. */
export const TIMBER_SOURCE_WORDS: Record<TimberSource, string> = {
	bundled: "bundled with the app",
	setting: "chosen in Settings",
	path: "found on PATH",
	override: `from ${TIMBER_OVERRIDE_VARIABLE}`,
};

/** One line for the main process log. */
export function describeTimberStatus(status: TimberStatus): string {
	switch (status.state) {
		case "ready":
			return `Timber ${status.version} at ${status.path}, ${TIMBER_SOURCE_WORDS[status.source]}`;
		case "too-old":
			return `Timber ${status.found} at ${status.path}, ${TIMBER_SOURCE_WORDS[status.source]}, is older than the required ${status.required}`;
		case "not-found":
			return status.path === null
				? "Timber was not found on PATH"
				: `No Timber answered at ${status.path}, ${TIMBER_SOURCE_WORDS[status.source]}`;
	}
}
