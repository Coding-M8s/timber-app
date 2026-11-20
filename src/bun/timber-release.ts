/**
 * The newest Timber release, and the rule that the app needs it. See
 * docs/architecture.md, "The newest Timber release is required".
 */
import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { TimberStatus } from "../shared/model";
import { REQUIRED_TIMBER_VERSION, newerTimberVersion, parseTimberVersion, readReleaseLocation, satisfiesTimberVersion } from "../shared/timber-version";

/** GitHub redirects this to the tag of the newest release. Read without a login and without the API's rate limit. */
export const LATEST_RELEASE_URL = "https://github.com/Coding-M8s/timber/releases/latest";

const LOOKUP_TIMEOUT_MS = 5_000;

/**
 * Ask GitHub for the newest release, without following its redirect. Null
 * when the answer is not a redirect to a release tag, or when there is no
 * answer in time, for example offline.
 */
export async function lookUpLatestRelease(fetcher: typeof fetch = fetch, timeoutMs = LOOKUP_TIMEOUT_MS): Promise<string | null> {
	try {
		const response = await fetcher(LATEST_RELEASE_URL, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(timeoutMs) });
		if (response.status < 300 || response.status >= 400) return null;
		return readReleaseLocation(response.headers.get("location"));
	} catch {
		return null;
	}
}

/** Where the last release seen is kept: beside the settings file, in a file of its own. */
export function releaseFilePath(settingsFile: string): string {
	return join(dirname(settingsFile), "timber-release.json");
}

/** The release saved by the last lookup that worked. Null when there is none, or the file cannot be read. */
export function readSavedRelease(file: string): string | null {
	try {
		const value: unknown = JSON.parse(readFileSync(file, "utf8"));
		const version = typeof value === "object" && value !== null ? (value as { version?: unknown }).version : undefined;
		return typeof version === "string" && parseTimberVersion(version) ? version : null;
	} catch {
		return null;
	}
}

async function saveRelease(file: string, version: string, checkedAt: Date): Promise<void> {
	await mkdir(dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify({ version, checkedAt: checkedAt.toISOString() }, null, "\t")}\n`);
	await rename(temporary, file);
}

export interface ReleaseWatcher {
	/** The newest release known: from the last lookup that worked, in this run or saved by an earlier one. */
	latest(): string | null;
	/** Look up the newest release now. True when it differs from what was known. A failed lookup changes nothing. */
	check(): Promise<boolean>;
}

export function createReleaseWatcher(options: {
	file: string;
	lookUp: () => Promise<string | null>;
	now?: () => Date;
	warn?: (message: string) => void;
}): ReleaseWatcher {
	const { file, lookUp, now = () => new Date(), warn = console.warn } = options;
	let latest = readSavedRelease(file);
	return {
		latest: () => latest,
		async check() {
			const found = await lookUp();
			if (found === null) return false;
			// Even an older answer replaces what was known, so a withdrawn release cannot lock anyone out.
			const changed = found !== latest;
			latest = found;
			try {
				await saveRelease(file, found, now());
			} catch (error) {
				warn(`Could not save the newest Timber release to ${file}: ${error instanceof Error ? error.message : String(error)}`);
			}
			return changed;
		},
	};
}

/**
 * How the app looks for Timber with the newest release required. The version
 * required is fixed while Timber is usable, so a release that comes out while
 * the app runs never takes Timber away mid-task: it is named in
 * `newerRelease` instead, and required from the next start. While Timber is
 * not usable, each look requires the newest release known. With the
 * development override, only the built-in minimum is required.
 */
export function timberFinder(options: {
	look: (required: string) => Promise<TimberStatus>;
	latest: () => string | null;
	override: boolean;
	/** Waited for before the first look, such as the lookup at start. */
	before?: Promise<unknown>;
	minimum?: string;
}): () => Promise<TimberStatus> {
	const { look, latest, override, minimum = REQUIRED_TIMBER_VERSION } = options;
	let before = options.before;
	let required: string | null = null;
	let usable = false;
	return async () => {
		if (before) {
			await before.catch(() => {});
			before = undefined;
		}
		const newest = override ? null : latest();
		if (!usable || required === null) required = newerTimberVersion(minimum, newest);
		const status = await look(required);
		usable = status.state === "ready";
		if (status.state === "too-old") return newest !== null && required === newest && required !== minimum ? { ...status, latestRelease: true } : status;
		if (status.state === "ready" && newest !== null && !satisfiesTimberVersion(status.version, newest)) {
			return { ...status, newerRelease: newest };
		}
		return status;
	};
}

/** A promise that settles when `promise` does, or after `ms`, whichever is first. */
export function atMost<T>(promise: Promise<T>, ms: number): Promise<T | undefined> {
	return Promise.race([promise, new Promise<undefined>(resolve => void setTimeout(resolve, ms))]);
}
