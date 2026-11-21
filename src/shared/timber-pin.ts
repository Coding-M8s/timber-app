/**
 * The Timber release the app ships with, read from timber-pin.json at the
 * repository root, the one place its version and checksums are written. See
 * docs/releasing.md, "Raising the bundled Timber". Everything here is pure.
 */
import pinFile from "../../timber-pin.json";
import { parseTimberVersion } from "./timber-version";

/** The platforms Timber publishes a binary for, named as its release files name them. */
export const TIMBER_TARGETS = ["linux-x64", "windows-x64", "darwin-arm64", "darwin-x64"] as const;
export type TimberTarget = typeof TIMBER_TARGETS[number];

export interface TimberPin {
	/** Such as "0.1.4", without the tag's "v". */
	version: string;
	/** The SHA-256 of each platform's binary, in lowercase hex. */
	binaries: Readonly<Record<TimberTarget, string>>;
	/** The SHA-256 of each license and notice file that ships beside the binary, by file name. */
	notices: Readonly<Record<string, string>>;
}

/** Where Timber publishes its releases. */
export const TIMBER_RELEASES = "https://github.com/Coding-M8s/timber/releases";

const SHA256 = /^[0-9a-f]{64}$/;
const NOTICE_NAME = /^[A-Za-z0-9_.-]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The pin in `value`, or an error that says what is wrong with it. */
export function readTimberPin(value: unknown): TimberPin {
	if (!isRecord(value)) throw new Error("timber-pin.json is not an object.");
	const { version, binaries, notices } = value;
	if (typeof version !== "string" || parseTimberVersion(version) === null || version.startsWith("v")) {
		throw new Error(`timber-pin.json has version ${JSON.stringify(version)}, which is not a version such as 0.1.4.`);
	}
	if (!isRecord(binaries)) throw new Error("timber-pin.json has no binaries.");
	for (const target of TIMBER_TARGETS) {
		if (typeof binaries[target] !== "string" || !SHA256.test(binaries[target])) {
			throw new Error(`timber-pin.json has no SHA-256 for the ${target} binary.`);
		}
	}
	if (!isRecord(notices) || Object.keys(notices).length === 0) throw new Error("timber-pin.json has no notices.");
	for (const [name, sum] of Object.entries(notices)) {
		if (!NOTICE_NAME.test(name) || typeof sum !== "string" || !SHA256.test(sum)) {
			throw new Error(`timber-pin.json has no SHA-256 for the notice ${JSON.stringify(name)}.`);
		}
	}
	return {
		version,
		binaries: Object.fromEntries(TIMBER_TARGETS.map(target => [target, binaries[target]])) as Record<TimberTarget, string>,
		notices: { ...notices } as Record<string, string>,
	};
}

/** The Timber the app ships with. */
export const TIMBER_PIN: TimberPin = readTimberPin(pinFile);

/** The Timber binary for a platform and processor, or null where Timber publishes none. */
export function timberTarget(platform: string, arch: string): TimberTarget | null {
	const os = platform === "win32" ? "windows" : platform === "linux" || platform === "darwin" ? platform : null;
	if (os === null) return null;
	const target = `${os}-${arch}`;
	return (TIMBER_TARGETS as readonly string[]).includes(target) ? target as TimberTarget : null;
}

/** What the bundled binary is called inside the app. */
export function timberExecutableName(target: TimberTarget): string {
	return target === "windows-x64" ? "timber.exe" : "timber";
}

/** The name of a platform's binary in a Timber release. */
export function releaseBinaryName(version: string, target: TimberTarget): string {
	return `timber-v${version}-${target}${target === "windows-x64" ? ".exe" : ""}`;
}

/** Where a file of a Timber release is downloaded from. */
export function releaseFileUrl(version: string, name: string): string {
	return `${TIMBER_RELEASES}/download/v${version}/${name}`;
}

/** The folder, relative to the repository, that the build copies the bundled Timber from. */
export function vendorFolder(version: string, target: TimberTarget): string {
	return `vendor/timber/v${version}/${target}`;
}
