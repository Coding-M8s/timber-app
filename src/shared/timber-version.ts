/** The first Timber release with the machine interface the app builds on, including `timber __app-config` for Settings. */
export const REQUIRED_TIMBER_VERSION = "0.1.2";

/** Development override: names the Timber executable to use instead of the one on PATH. */
export const TIMBER_OVERRIDE_VARIABLE = "TIMBER_APP_TIMBER_PATH";

export interface TimberVersion {
	major: number;
	minor: number;
	patch: number;
	/** True for a pre-release such as 0.2.0-beta.1, which sorts before 0.2.0. */
	prerelease: boolean;
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;

/** Parse a version such as "0.1.1", "v0.1.1", or "0.2.0-beta.1". Null when the text is not a version. */
export function parseTimberVersion(text: string): TimberVersion | null {
	const match = VERSION.exec(text.trim());
	if (!match) return null;
	return {
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4] !== undefined,
	};
}

/**
 * Read the version from what `timber --version` prints: the version alone, or
 * a line ending in it such as "timber 0.1.1". Answers the version text without
 * a leading "v", or null when the output does not look like Timber's.
 */
export function readVersionOutput(output: string): string | null {
	const firstLine = output.trim().split(/\r?\n/)[0] ?? "";
	const lastWord = firstLine.trim().split(/\s+/).at(-1) ?? "";
	return parseTimberVersion(lastWord) ? lastWord.replace(/^v/, "") : null;
}

/** Negative when `left` is older than `right`, zero when equal, positive when newer. */
export function compareTimberVersions(left: TimberVersion, right: TimberVersion): number {
	return left.major - right.major
		|| left.minor - right.minor
		|| left.patch - right.patch
		|| Number(right.prerelease) - Number(left.prerelease);
}

/** Whether `found` is at least `required`. A version that cannot be read never satisfies. */
export function satisfiesTimberVersion(found: string, required: string = REQUIRED_TIMBER_VERSION): boolean {
	const foundVersion = parseTimberVersion(found);
	const requiredVersion = parseTimberVersion(required);
	return foundVersion !== null && requiredVersion !== null && compareTimberVersions(foundVersion, requiredVersion) >= 0;
}
