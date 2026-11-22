/**
 * The Pull setting: whether Pull shows its dialog, with the Git commands,
 * before it runs. Pure. Kept in the app's preferences (the `pull`
 * preference), by the primary checkout of each repository, never in the
 * repository itself.
 *
 * The dialog shows when `ask` is on and the repository is not in `skip`. With
 * `ask` off, no repository asks. Push always asks, whatever this says: it
 * runs a Timber command, and every Timber command is shown before it runs.
 *
 * A saved value that cannot be read, any part of it, takes the default and
 * asks everywhere: nothing here ever turns asking off by accident.
 */
export interface PullConfirmSetting {
	/** "Ask before pulling". Off: Pull runs at once in every repository. */
	ask: boolean;
	/** The primary checkouts whose "Skip pull confirmation" is on, sorted, each once. */
	skip: readonly string[];
}

/**
 * The most repositories that can skip the dialog. An entry goes when its
 * repository is removed from the app, so this only stops a hand-edited file
 * from growing without end.
 */
export const PULL_SKIP_LIMIT = 500;

export function defaultPullConfirmSetting(): PullConfirmSetting {
	return { ask: true, skip: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isRepositoryPath = (value: unknown): value is string => typeof value === "string" && value !== "" && !/[\0\n]/.test(value);

/** The paths sorted, each once. */
const tidy = (paths: readonly string[]): string[] => [...new Set(paths)].sort();

/** The setting from a value that came from outside, or undefined when any of it cannot be read. */
export function readPullConfirmSetting(value: unknown): PullConfirmSetting | undefined {
	if (!isRecord(value)) return undefined;
	const { ask, skip } = value;
	if (typeof ask !== "boolean" || !Array.isArray(skip) || !skip.every(isRepositoryPath)) return undefined;
	const paths = tidy(skip);
	if (paths.length > PULL_SKIP_LIMIT) return undefined;
	return { ask, skip: paths };
}

export function samePullConfirmSetting(one: PullConfirmSetting, other: PullConfirmSetting): boolean {
	return one.ask === other.ask && one.skip.length === other.skip.length && one.skip.every((path, index) => path === other.skip[index]);
}

export function writePullConfirmSetting(setting: PullConfirmSetting): unknown {
	return { ask: setting.ask, skip: [...setting.skip] };
}

/** Whether a repository's own "Skip pull confirmation" is on, whatever `ask` says. */
export function skipsPullConfirmation(setting: PullConfirmSetting, repository: string): boolean {
	return setting.skip.includes(repository);
}

/** Whether Pull in this repository, known by its primary checkout, shows its dialog before it runs. */
export function confirmsPull(setting: PullConfirmSetting, repository: string): boolean {
	return setting.ask && !skipsPullConfirmation(setting, repository);
}

/** The setting with one repository's "Skip pull confirmation" turned on or off. */
export function withPullSkipped(setting: PullConfirmSetting, repository: string, skip: boolean): PullConfirmSetting {
	const others = setting.skip.filter(path => path !== repository);
	return { ask: setting.ask, skip: skip ? tidy([...others, repository]) : others };
}

/** The setting without a repository that left the app. */
export function forgetPullRepository(setting: PullConfirmSetting, repository: string): PullConfirmSetting {
	return withPullSkipped(setting, repository, false);
}
