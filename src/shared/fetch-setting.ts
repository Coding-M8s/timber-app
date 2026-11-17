/**
 * The Fetching setting: whether the app fetches every repository in the
 * background, and how often. Pure. The main process runs the fetches (see
 * src/bun/fetcher.ts); "Fetch now" works whatever this says.
 */
export interface FetchSetting {
	/** False: nothing is fetched until "Fetch now" is pressed. */
	background: boolean;
	/** Minutes between the end of one background fetch of a repository and the start of the next. */
	intervalMinutes: number;
}

/** The shortest interval that can be saved, so a typo cannot keep the network busy. */
export const MIN_FETCH_MINUTES = 1;
/** The longest interval that can be saved: one day. */
export const MAX_FETCH_MINUTES = 1440;
export const DEFAULT_FETCH_MINUTES = 5;

export function defaultFetchSetting(): FetchSetting {
	return { background: true, intervalMinutes: DEFAULT_FETCH_MINUTES };
}

/** Whether `minutes` is an interval that can be saved: a whole number of minutes within the limits. */
export function isFetchInterval(minutes: unknown): minutes is number {
	return typeof minutes === "number" && Number.isInteger(minutes) && minutes >= MIN_FETCH_MINUTES && minutes <= MAX_FETCH_MINUTES;
}

/** The setting from a value that came from outside, or undefined when it cannot be read. */
export function readFetchSetting(value: unknown): FetchSetting | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const { background, intervalMinutes } = value as Record<string, unknown>;
	if (typeof background !== "boolean" || !isFetchInterval(intervalMinutes)) return undefined;
	return { background, intervalMinutes };
}

/**
 * What can be kept of a saved setting that cannot be read whole, such as one
 * with an interval outside the limits: a readable `background`, with the
 * default interval. So a file that says background fetching is off never
 * turns it on. Undefined when not even that can be read.
 */
export function salvageFetchSetting(value: unknown): FetchSetting | undefined {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
	const { background } = value as Record<string, unknown>;
	return typeof background === "boolean" ? { background, intervalMinutes: DEFAULT_FETCH_MINUTES } : undefined;
}

export function sameFetchSetting(one: FetchSetting, other: FetchSetting): boolean {
	return one.background === other.background && one.intervalMinutes === other.intervalMinutes;
}

export function writeFetchSetting(setting: FetchSetting): unknown {
	return { background: setting.background, intervalMinutes: setting.intervalMinutes };
}
